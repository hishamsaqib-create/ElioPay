import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

const DENTALLY_API = "https://api.dentally.co/v1";
const SITE_ID = "212f9c01-f4f2-446d-b7a3-0162b135e9d3";

// Diary slot from Dentally
interface DiarySlot {
  id: string | number;
  practitioner_id: string | number;
  starts_at: string;
  finish_at: string;
  state?: string;
  slot_type?: string;
  reason?: string;
  patient_id?: string | number;
  appointment_id?: string | number;
}

// Availability block (working hours)
interface AvailabilityBlock {
  practitioner_id: string;
  date: string;
  start_time: string;
  end_time: string;
  available_minutes: number;
}

// Calculated diary metrics
interface DiaryMetrics {
  totalAvailableMins: number;
  totalBookedMins: number;
  totalWhiteSpaceMins: number;
  occupancyPercent: number;
  whiteSpacePercent: number;
  dailyBreakdown: Array<{
    date: string;
    availableMins: number;
    bookedMins: number;
    whiteSpaceMins: number;
    occupancyPercent: number;
  }>;
}

// Fetch diary entries (appointments + blocks) for a practitioner
async function fetchDiaryEntries(
  practitionerId: string,
  startDate: string,
  endDate: string,
  token: string
): Promise<DiarySlot[]> {
  const all: DiarySlot[] = [];
  let page = 1;
  const perPage = 100;
  const maxPages = 20;

  while (page <= maxPages) {
    // Try appointments endpoint first
    const url = `${DENTALLY_API}/appointments?site_id=${SITE_ID}&practitioner_id=${practitionerId}&start_date=${startDate}&end_date=${endDate}&page=${page}&per_page=${perPage}`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        console.log(`[Dentally] Appointments API returned ${res.status} for practitioner ${practitionerId}`);
        break;
      }

      const data = await res.json();
      const appointments = data.appointments || data.data || [];

      if (appointments.length === 0) break;

      // Filter to only completed/attended appointments
      const validAppointments = appointments.filter((apt: DiarySlot) => {
        const state = apt.state?.toLowerCase() || "";
        // Include completed, attended, or appointments without a cancelled state
        return !state.includes("cancel") && !state.includes("dna") && !state.includes("failed");
      });

      all.push(...validAppointments);

      if (appointments.length < perPage) break;
      page++;
    } catch (e) {
      console.error(`[Dentally] Error fetching diary for ${practitionerId}:`, e);
      break;
    }
  }

  return all;
}

// Fetch practitioner availability/schedule blocks
async function fetchAvailabilityBlocks(
  practitionerId: string,
  startDate: string,
  endDate: string,
  token: string
): Promise<AvailabilityBlock[]> {
  const blocks: AvailabilityBlock[] = [];

  try {
    // Try the schedule/rota endpoint
    const url = `${DENTALLY_API}/practitioners/${practitionerId}/schedule?site_id=${SITE_ID}&from=${startDate}&to=${endDate}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (res.ok) {
      const data = await res.json();
      const schedule = data.schedule || data.shifts || data.availability || data.data || [];

      for (const shift of schedule) {
        const startTime = shift.starts_at || shift.start_time || shift.from;
        const endTime = shift.finish_at || shift.end_time || shift.to;

        if (startTime && endTime) {
          const start = new Date(startTime);
          const end = new Date(endTime);
          const mins = Math.round((end.getTime() - start.getTime()) / 60000);

          if (mins > 0 && mins < 720) { // Max 12 hours
            blocks.push({
              practitioner_id: practitionerId,
              date: startTime.substring(0, 10),
              start_time: startTime,
              end_time: endTime,
              available_minutes: mins,
            });
          }
        }
      }
    } else {
      console.log(`[Dentally] Schedule API returned ${res.status}, using default working hours`);
    }
  } catch (e) {
    console.log(`[Dentally] Schedule fetch failed, using default hours:`, e);
  }

  return blocks;
}

// Generate default working hours if schedule not available
function generateDefaultWorkingHours(
  practitionerId: string,
  startDate: string,
  endDate: string,
  weeklyHours: number = 40
): AvailabilityBlock[] {
  const blocks: AvailabilityBlock[] = [];
  const dailyHours = weeklyHours / 5; // Assume 5-day work week

  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (current < end) {
    const dayOfWeek = current.getDay();

    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const dateStr = current.toISOString().substring(0, 10);
      blocks.push({
        practitioner_id: practitionerId,
        date: dateStr,
        start_time: `${dateStr}T09:00:00`,
        end_time: `${dateStr}T${9 + dailyHours}:00:00`,
        available_minutes: dailyHours * 60,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return blocks;
}

// Calculate diary metrics for a practitioner
function calculateDiaryMetrics(
  appointments: DiarySlot[],
  availabilityBlocks: AvailabilityBlock[]
): DiaryMetrics {
  // Group appointments by date
  const appointmentsByDate = new Map<string, number>();

  for (const apt of appointments) {
    if (!apt.starts_at || !apt.finish_at) continue;

    const date = apt.starts_at.substring(0, 10);
    const start = new Date(apt.starts_at);
    const end = new Date(apt.finish_at);
    const mins = Math.round((end.getTime() - start.getTime()) / 60000);

    if (mins > 0 && mins < 480) { // Max 8 hours per appointment
      const existing = appointmentsByDate.get(date) || 0;
      appointmentsByDate.set(date, existing + mins);
    }
  }

  // Calculate metrics per day
  const dailyBreakdown: DiaryMetrics["dailyBreakdown"] = [];
  let totalAvailableMins = 0;
  let totalBookedMins = 0;

  for (const block of availabilityBlocks) {
    const bookedMins = appointmentsByDate.get(block.date) || 0;
    const whiteSpaceMins = Math.max(0, block.available_minutes - bookedMins);
    const occupancy = block.available_minutes > 0 ? (bookedMins / block.available_minutes) * 100 : 0;

    dailyBreakdown.push({
      date: block.date,
      availableMins: block.available_minutes,
      bookedMins,
      whiteSpaceMins,
      occupancyPercent: Math.round(occupancy * 10) / 10,
    });

    totalAvailableMins += block.available_minutes;
    totalBookedMins += bookedMins;
  }

  const totalWhiteSpaceMins = Math.max(0, totalAvailableMins - totalBookedMins);
  const occupancyPercent = totalAvailableMins > 0 ? (totalBookedMins / totalAvailableMins) * 100 : 0;
  const whiteSpacePercent = totalAvailableMins > 0 ? (totalWhiteSpaceMins / totalAvailableMins) * 100 : 0;

  return {
    totalAvailableMins,
    totalBookedMins,
    totalWhiteSpaceMins,
    occupancyPercent: Math.round(occupancyPercent * 10) / 10,
    whiteSpacePercent: Math.round(whiteSpacePercent * 10) / 10,
    dailyBreakdown: dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { period_id, dentist_id } = await req.json();
  const db = await getDb();

  // Get the period
  const periodResult = await db.execute({
    sql: "SELECT * FROM pay_periods WHERE id = ?",
    args: [period_id],
  });
  if (periodResult.rows.length === 0) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  const period = periodResult.rows[0] as { id: number; month: number; year: number };

  // Calculate date range
  const startDate = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const endMonth = period.month === 12 ? 1 : period.month + 1;
  const endYear = period.month === 12 ? period.year + 1 : period.year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "DENTALLY_API_TOKEN not configured" }, { status: 400 });
  }

  // Get dentists to process
  let dentistsToProcess: Dentist[];
  if (dentist_id) {
    const dentistResult = await db.execute({
      sql: "SELECT * FROM dentists WHERE id = ? AND active = 1",
      args: [dentist_id],
    });
    dentistsToProcess = rowsTo<Dentist>(dentistResult.rows);
  } else {
    const dentistsResult = await db.execute("SELECT * FROM dentists WHERE active = 1");
    dentistsToProcess = rowsTo<Dentist>(dentistsResult.rows);
  }

  const results: Record<string, DiaryMetrics & { dentistName: string }> = {};

  for (const dentist of dentistsToProcess) {
    if (!dentist.practitioner_id) {
      console.log(`[Dentally] Skipping ${dentist.name}: no practitioner_id`);
      continue;
    }

    const practitionerId = String(dentist.practitioner_id);
    console.log(`[Dentally] Fetching diary for ${dentist.name} (${practitionerId})...`);

    // Fetch appointments
    const appointments = await fetchDiaryEntries(practitionerId, startDate, endDate, token);
    console.log(`[Dentally] ${dentist.name}: ${appointments.length} appointments`);

    // Try to fetch actual schedule, fall back to default hours
    let availabilityBlocks = await fetchAvailabilityBlocks(practitionerId, startDate, endDate, token);

    if (availabilityBlocks.length === 0) {
      // Use default working hours based on dentist's weekly_hours setting
      const weeklyHours = (dentist as Dentist & { weekly_hours?: number }).weekly_hours || 40;
      availabilityBlocks = generateDefaultWorkingHours(practitionerId, startDate, endDate, weeklyHours);
      console.log(`[Dentally] ${dentist.name}: Using default ${weeklyHours}h/week schedule`);
    } else {
      console.log(`[Dentally] ${dentist.name}: Found ${availabilityBlocks.length} schedule blocks`);
    }

    // Calculate metrics
    const metrics = calculateDiaryMetrics(appointments, availabilityBlocks);

    results[dentist.name] = {
      ...metrics,
      dentistName: dentist.name,
    };

    console.log(`[Dentally] ${dentist.name}: ${metrics.occupancyPercent}% occupancy, ${metrics.whiteSpacePercent}% white space`);
  }

  return NextResponse.json({
    ok: true,
    period: { month: period.month, year: period.year },
    dateRange: { start: startDate, end: endDate },
    metrics: results,
  });
}

// GET endpoint to fetch availability for display
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const periodId = req.nextUrl.searchParams.get("period_id");
  const dentistId = req.nextUrl.searchParams.get("dentist_id");

  if (!periodId) {
    return NextResponse.json({ error: "period_id required" }, { status: 400 });
  }

  // Forward to POST handler with same logic
  const body = { period_id: Number(periodId), dentist_id: dentistId ? Number(dentistId) : undefined };

  const db = await getDb();

  // Get the period
  const periodResult = await db.execute({
    sql: "SELECT * FROM pay_periods WHERE id = ?",
    args: [body.period_id],
  });
  if (periodResult.rows.length === 0) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  const period = periodResult.rows[0] as { id: number; month: number; year: number };

  // Calculate date range
  const startDate = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const endMonth = period.month === 12 ? 1 : period.month + 1;
  const endYear = period.month === 12 ? period.year + 1 : period.year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "DENTALLY_API_TOKEN not configured" }, { status: 400 });
  }

  // Get dentists to process
  let dentistsToProcess: Dentist[];
  if (body.dentist_id) {
    const dentistResult = await db.execute({
      sql: "SELECT * FROM dentists WHERE id = ? AND active = 1",
      args: [body.dentist_id],
    });
    dentistsToProcess = rowsTo<Dentist>(dentistResult.rows);
  } else {
    const dentistsResult = await db.execute("SELECT * FROM dentists WHERE active = 1");
    dentistsToProcess = rowsTo<Dentist>(dentistsResult.rows);
  }

  const results: Record<string, DiaryMetrics & { dentistName: string }> = {};

  for (const dentist of dentistsToProcess) {
    if (!dentist.practitioner_id) continue;

    const practitionerId = String(dentist.practitioner_id);
    const appointments = await fetchDiaryEntries(practitionerId, startDate, endDate, token);

    let availabilityBlocks = await fetchAvailabilityBlocks(practitionerId, startDate, endDate, token);
    if (availabilityBlocks.length === 0) {
      const weeklyHours = (dentist as Dentist & { weekly_hours?: number }).weekly_hours || 40;
      availabilityBlocks = generateDefaultWorkingHours(practitionerId, startDate, endDate, weeklyHours);
    }

    const metrics = calculateDiaryMetrics(appointments, availabilityBlocks);
    results[dentist.name] = { ...metrics, dentistName: dentist.name };
  }

  return NextResponse.json({
    ok: true,
    period: { month: period.month, year: period.year },
    dateRange: { start: startDate, end: endDate },
    metrics: results,
  });
}
