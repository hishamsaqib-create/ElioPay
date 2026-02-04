import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

const DENTALLY_API = "https://api.dentally.co/v1";

// NHS keywords (these are universal)
const NHS_KEYWORDS = [
  "band 1", "band 2", "band 3", "nhs exam", "nhs scale", "nhs polish",
  "nhs fluoride", "nhs fissure", "urgent dental", "nhs extraction",
  "nhs filling", "nhs root", "nhs crown", "nhs denture", "nhs bridge",
];
const CBCT_KEYWORDS = ["cbct", "ct scan", "cone beam"];

// Roles that count as clinicians/dentists (case-insensitive match)
const CLINICIAN_ROLES = ["dentist", "clinician", "associate", "principal"];

// Default therapy rate per minute (£35/hour = £0.5833/min)
const DEFAULT_THERAPY_RATE_PER_MINUTE = 0.5833;

// Helper to load clinic settings from database
async function getClinicSettings(): Promise<{
  siteId: string;
  therapistIds: Set<string>;
  nhsAmounts: Set<number>;
  therapyRate: number;
}> {
  const db = await getDb();
  const result = await db.execute("SELECT key, value FROM settings");
  const rows = rowsTo<{ key: string; value: string }>(result.rows);

  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;

  // Parse therapist IDs (comma-separated string)
  const therapistIdsStr = settings.therapist_ids || "";
  const therapistIds = new Set(
    therapistIdsStr.split(",").map(s => s.trim()).filter(s => s.length > 0)
  );

  // Parse NHS amounts (comma-separated string)
  const nhsAmountsStr = settings.nhs_amounts || "";
  const nhsAmounts = new Set(
    nhsAmountsStr.split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0)
  );

  // Parse therapy rate (defaults to £35/hour = £0.5833/min)
  const therapyRate = parseFloat(settings.therapy_rate || "") || DEFAULT_THERAPY_RATE_PER_MINUTE;

  return {
    siteId: settings.dentally_site_id || "",
    therapistIds,
    nhsAmounts,
    therapyRate,
  };
}

// Therapy breakdown appointment record
interface TherapyBreakdownItem {
  patientName: string;
  patientId: string;
  date: string;
  minutes: number;
  treatment?: string;
  therapistName?: string;
  cost: number;
}

// Check if a role is a clinician role
function isClinicianRole(role?: string): boolean {
  if (!role) return false;
  const lower = role.toLowerCase();
  return CLINICIAN_ROLES.some(r => lower.includes(r));
}

function parseAmount(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

function isNhsAmount(amount: number, nhsAmounts: Set<number>): boolean {
  for (const nhsAmt of nhsAmounts) {
    if (Math.abs(amount - nhsAmt) < 0.01) return true;
  }
  return false;
}

function isNhsItem(item: { name?: string; amount?: unknown; nhs_charge?: boolean }, nhsAmounts: Set<number>): boolean {
  if (item.nhs_charge) return true;
  const lower = (item.name || "").toLowerCase();
  if (NHS_KEYWORDS.some((k) => lower.includes(k))) return true;
  const amt = parseAmount(item.amount);
  if (isNhsAmount(amt, nhsAmounts)) return true;
  return false;
}

function isCbctItem(item: { name?: string }): boolean {
  const lower = (item.name || "").toLowerCase();
  return CBCT_KEYWORDS.some((k) => lower.includes(k));
}

// Check if invoice is within date range (client-side filter since API filter doesn't work reliably)
function isInvoiceInDateRange(inv: DentallyInvoice, startDate: string, endDate: string): boolean {
  // Get the invoice date (dated_on is the invoice date, created_at is when it was created in system)
  const invoiceDate = inv.dated_on || inv.created_at?.substring(0, 10) || "";
  if (!invoiceDate) return false;

  // Compare dates (YYYY-MM-DD format)
  return invoiceDate >= startDate && invoiceDate < endDate;
}

// Check if invoice was paid via finance/payment plan
function isFinancePayment(inv: DentallyInvoice): boolean {
  // Check various indicators of finance/payment plan
  if (inv.payment_plan_id) return true;
  if (inv.finance === true) return true;
  if (inv.payment_method?.toLowerCase().includes("finance")) return true;
  if (inv.payment_method?.toLowerCase().includes("payment plan")) return true;
  if (inv.payment_explanation?.links?.payments) return true;

  // Check invoice items for finance indicators
  const items = inv.invoice_items || [];
  for (const item of items) {
    const name = (item.name || "").toLowerCase();
    if (name.includes("finance") || name.includes("payment plan")) return true;
  }

  return false;
}

interface DentallyInvoice {
  id: number | string;
  patient_id: number | string;
  user_id?: number | string;
  practitioner_id?: number | string;
  amount: number | string;
  amount_outstanding?: number | string;
  balance?: number | string;
  paid?: boolean;
  state?: string;
  created_at?: string;
  dated_on?: string;
  payment_plan_id?: number | string;
  finance?: boolean;
  payment_method?: string;
  invoice_items?: Array<{ name?: string; amount?: unknown; nhs_charge?: boolean; practitioner_id?: string | number }>;
  payment_explanation?: { links?: { payments?: string } };
}

// Dentally appointment interface
interface DentallyAppointment {
  id: number | string;
  patient_id: number | string;
  user_id?: number | string;
  practitioner_id?: number | string;
  starts_at?: string;
  finish_at?: string;
  duration?: number; // Duration in minutes
  treatment_description?: string;
  reason?: string;
  state?: string;
}

// Patient record with payment status and duration
interface PatientRecord {
  name: string;
  date: string;
  amount: number;
  amountPaid: number;
  amountOutstanding: number;
  status: "paid" | "partial" | "unpaid";
  finance: boolean;
  invoiceId: string;
  patientId: string;
  flagged?: boolean;
  flagReason?: string;
  durationMins?: number;
  treatment?: string;
  hourlyRate?: number; // £/hour for this appointment
}

// Analytics data per dentist
interface DentistAnalytics {
  totalChairMins: number;
  totalPatients: number;
  grossPerHour: number;
  netPerHour: number;
  avgAppointmentMins: number;
  utilizationPercent: number; // Based on assumed available hours
  topPatientsByHourlyRate: Array<{ name: string; amount: number; durationMins: number; hourlyRate: number }>;
  topTreatmentsByHourlyRate: Array<{ treatment: string; totalAmount: number; totalMins: number; hourlyRate: number; count: number }>;
}

// Discrepancy record
interface Discrepancy {
  type: "invoiced_not_paid" | "partial_payment" | "log_mismatch";
  patientName: string;
  patientId: string;
  invoiceId?: string;
  invoicedAmount: number;
  paidAmount: number;
  date: string;
  notes: string;
}

async function fetchAllPages(baseUrl: string, token: string): Promise<DentallyInvoice[]> {
  const all: DentallyInvoice[] = [];
  let page = 1;
  const perPage = 100;
  const maxPages = 100; // Higher limit to ensure we get all invoices

  while (page <= maxPages) {
    // Build URL with page number
    const url = `${baseUrl}&page=${page}&per_page=${perPage}`;
    console.log(`[Dentally] Fetching page ${page}: ${url.substring(0, 120)}...`);

    const fetchRes: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    if (!fetchRes.ok) {
      const text = await fetchRes.text();
      throw new Error(`Dentally API error ${fetchRes.status}: ${text.substring(0, 200)}`);
    }

    const data = await fetchRes.json();
    const invoices = data.invoices || data.data || [];

    if (invoices.length === 0) {
      console.log(`[Dentally] Page ${page}: No more invoices, stopping.`);
      break;
    }

    all.push(...invoices);
    console.log(`[Dentally] Page ${page}: Got ${invoices.length} invoices (total: ${all.length})`);

    // If we got fewer than perPage, we've reached the end
    if (invoices.length < perPage) {
      console.log(`[Dentally] Page ${page}: Got ${invoices.length} < ${perPage}, last page.`);
      break;
    }

    page++;
  }

  console.log(`[Dentally] Finished fetching. Total: ${all.length} invoices across ${page} pages.`);
  return all;
}

// Fetch appointments from Dentally
async function fetchAppointments(startDate: string, endDate: string, token: string, siteId: string): Promise<DentallyAppointment[]> {
  const all: DentallyAppointment[] = [];
  let page = 1;
  const perPage = 100;
  const maxPages = 50;

  console.log(`[Dentally] Fetching appointments from ${startDate} to ${endDate}`);

  while (page <= maxPages) {
    // Dentally appointments API - try different parameter names
    const url = `${DENTALLY_API}/appointments?site_id=${siteId}&start_date=${startDate}&end_date=${endDate}&page=${page}&per_page=${perPage}`;
    console.log(`[Dentally] Appointments page ${page}: ${url.substring(0, 100)}...`);

    try {
      const fetchRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!fetchRes.ok) {
        // Try alternative API path if first fails
        if (page === 1) {
          console.log(`[Dentally] Appointments API returned ${fetchRes.status}, trying alternative path...`);
          // Try /calendar/appointments endpoint
          const altUrl = `${DENTALLY_API}/calendar/appointments?site_id=${siteId}&from=${startDate}&to=${endDate}`;
          const altRes = await fetch(altUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          });
          if (altRes.ok) {
            const altData = await altRes.json();
            const appointments = altData.appointments || altData.data || [];
            all.push(...appointments);
            console.log(`[Dentally] Got ${appointments.length} appointments from alternative endpoint`);
          }
        }
        break;
      }

      const data = await fetchRes.json();
      const appointments = data.appointments || data.data || [];

      if (appointments.length === 0) break;

      all.push(...appointments);
      console.log(`[Dentally] Page ${page}: Got ${appointments.length} appointments (total: ${all.length})`);

      if (appointments.length < perPage) break;
      page++;
    } catch (e) {
      console.error(`[Dentally] Error fetching appointments:`, e);
      break;
    }
  }

  console.log(`[Dentally] Total appointments fetched: ${all.length}`);
  return all;
}

// Calculate appointment duration in minutes
function getAppointmentDuration(apt: DentallyAppointment): number {
  // If duration is provided directly
  if (apt.duration && apt.duration > 0) return apt.duration;

  // Calculate from starts_at and finish_at
  if (apt.starts_at && apt.finish_at) {
    const start = new Date(apt.starts_at);
    const end = new Date(apt.finish_at);
    const mins = Math.round((end.getTime() - start.getTime()) / 60000);
    if (mins > 0 && mins < 480) return mins; // Sanity check: max 8 hours
  }

  return 0; // Unknown duration
}

// Build appointment lookup map by patient_id and date
function buildAppointmentMap(appointments: DentallyAppointment[]): Map<string, DentallyAppointment[]> {
  const map = new Map<string, DentallyAppointment[]>();

  for (const apt of appointments) {
    const patientId = String(apt.patient_id);
    const dateStr = apt.starts_at?.substring(0, 10) || "";
    if (!patientId || !dateStr) continue;

    const key = `${patientId}_${dateStr}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(apt);
  }

  return map;
}

// Calculate analytics for a dentist
function calculateDentistAnalytics(
  patients: PatientRecord[],
  splitPercentage: number,
  weeklyHours: number = 40
): DentistAnalytics {
  const patientsWithDuration = patients.filter(p => p.durationMins && p.durationMins > 0);
  const totalChairMins = patientsWithDuration.reduce((sum, p) => sum + (p.durationMins || 0), 0);
  const totalAmount = patients.reduce((sum, p) => sum + p.amount, 0);

  // Calculate hourly rates
  const totalHours = totalChairMins / 60;
  const grossPerHour = totalHours > 0 ? totalAmount / totalHours : 0;
  const netPerHour = totalHours > 0 ? (totalAmount * (splitPercentage / 100)) / totalHours : 0;

  // Average appointment length
  const avgAppointmentMins = patientsWithDuration.length > 0
    ? totalChairMins / patientsWithDuration.length
    : 0;

  // Utilization: assume ~4.3 weeks per month, calculate available hours
  const monthlyAvailableHours = weeklyHours * 4.3;
  const utilizationPercent = monthlyAvailableHours > 0 ? (totalHours / monthlyAvailableHours) * 100 : 0;

  // Top patients by hourly rate (only those with duration data)
  const topPatientsByHourlyRate = patientsWithDuration
    .map(p => ({
      name: p.name,
      amount: p.amount,
      durationMins: p.durationMins || 0,
      hourlyRate: p.hourlyRate || 0,
    }))
    .filter(p => p.hourlyRate > 0)
    .sort((a, b) => b.hourlyRate - a.hourlyRate)
    .slice(0, 10);

  // Top treatments by hourly rate
  const treatmentMap = new Map<string, { totalAmount: number; totalMins: number; count: number }>();
  for (const p of patientsWithDuration) {
    if (!p.treatment || !p.durationMins) continue;
    const treatment = p.treatment.toLowerCase().trim();
    const existing = treatmentMap.get(treatment) || { totalAmount: 0, totalMins: 0, count: 0 };
    existing.totalAmount += p.amount;
    existing.totalMins += p.durationMins;
    existing.count++;
    treatmentMap.set(treatment, existing);
  }

  const topTreatmentsByHourlyRate = Array.from(treatmentMap.entries())
    .map(([treatment, data]) => ({
      treatment,
      totalAmount: data.totalAmount,
      totalMins: data.totalMins,
      hourlyRate: data.totalMins > 0 ? (data.totalAmount / (data.totalMins / 60)) : 0,
      count: data.count,
    }))
    .sort((a, b) => b.hourlyRate - a.hourlyRate)
    .slice(0, 10);

  return {
    totalChairMins,
    totalPatients: patients.length,
    grossPerHour: Math.round(grossPerHour * 100) / 100,
    netPerHour: Math.round(netPerHour * 100) / 100,
    avgAppointmentMins: Math.round(avgAppointmentMins),
    utilizationPercent: Math.round(utilizationPercent * 10) / 10,
    topPatientsByHourlyRate,
    topTreatmentsByHourlyRate,
  };
}

// Fetch patient's appointment history to find referring dentist
async function fetchPatientAppointments(
  patientId: string,
  beforeDate: string,
  token: string,
  siteId: string
): Promise<DentallyAppointment[]> {
  try {
    // Fetch appointments for this patient before the given date
    const url = `${DENTALLY_API}/appointments?site_id=${siteId}&patient_id=${patientId}&end_date=${beforeDate}&per_page=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (res.ok) {
      const data = await res.json();
      return data.appointments || data.data || [];
    }
  } catch (e) {
    console.error(`[Dentally] Failed to fetch appointments for patient ${patientId}:`, e);
  }
  return [];
}

// Find referring dentist for a therapy appointment
// Looks for the most recent exam/check-up with a dentist before the therapy date
async function findReferringDentist(
  patientId: string,
  therapyDate: string,
  token: string,
  siteId: string,
  therapistIds: Set<string>,
  dentistByUserId: Map<string, Dentist>,
  allUsers: Map<string, { name: string; role?: string; isClinician: boolean }>
): Promise<Dentist | null> {
  const appointments = await fetchPatientAppointments(patientId, therapyDate, token, siteId);

  if (!appointments || appointments.length === 0) return null;

  // Sort by date descending to find most recent
  appointments.sort((a, b) => {
    const dateA = a.starts_at || "";
    const dateB = b.starts_at || "";
    return dateB.localeCompare(dateA);
  });

  // Look for the most recent dentist appointment (not a therapist)
  for (const apt of appointments) {
    const practitionerId = String(apt.practitioner_id || apt.user_id || "");

    // Skip if it's a therapist/hygienist
    if (therapistIds.has(practitionerId)) continue;

    // Check if this is a known dentist
    const dentist = dentistByUserId.get(practitionerId);
    if (dentist) return dentist;

    // Check if user is a clinician (could be unmapped dentist)
    const userInfo = allUsers.get(practitionerId);
    if (userInfo && userInfo.isClinician) {
      // It's a clinician but not mapped to a dentist - log for debugging
      console.log(`[Dentally] Found unmapped clinician ${practitionerId} (${userInfo.name}) as potential referrer`);
    }
  }

  return null;
}

// Calculate therapy breakdown for all dentists
async function calculateTherapyBreakdown(
  appointments: DentallyAppointment[],
  startDate: string,
  endDate: string,
  token: string,
  siteId: string,
  therapistIds: Set<string>,
  therapyRate: number,
  dentistByUserId: Map<string, Dentist>,
  dentists: Dentist[],
  allUsers: Map<string, { name: string; role?: string; isClinician: boolean }>,
  patientNames: Map<string, string>
): Promise<Map<number, TherapyBreakdownItem[]>> {
  const therapyByDentist = new Map<number, TherapyBreakdownItem[]>();

  // Initialize empty arrays for all dentists
  for (const d of dentists) {
    therapyByDentist.set(d.id, []);
  }

  // Filter appointments to therapist appointments in the date range
  const therapistAppointments = appointments.filter(apt => {
    const practId = String(apt.practitioner_id || apt.user_id || "");
    if (!therapistIds.has(practId)) return false;

    const aptDate = apt.starts_at?.substring(0, 10) || "";
    return aptDate >= startDate && aptDate < endDate;
  });

  console.log(`[Dentally] Found ${therapistAppointments.length} therapist appointments to process`);

  // Get therapist names
  const therapistNames = new Map<string, string>();
  for (const uid of therapistIds) {
    const userInfo = allUsers.get(uid);
    if (userInfo) therapistNames.set(uid, userInfo.name);
  }

  // Process each therapy appointment
  let assigned = 0;
  let unassigned = 0;

  for (const apt of therapistAppointments) {
    const patientId = String(apt.patient_id);
    const aptDate = apt.starts_at?.substring(0, 10) || "";
    const practId = String(apt.practitioner_id || apt.user_id || "");
    const duration = getAppointmentDuration(apt);

    if (duration <= 0) continue;

    // Find referring dentist
    const referringDentist = await findReferringDentist(
      patientId,
      aptDate,
      token,
      siteId,
      therapistIds,
      dentistByUserId,
      allUsers
    );

    const patientName = patientNames.get(patientId) || `Patient ${patientId}`;
    const therapistName = therapistNames.get(practId) || "Therapist";
    const treatment = apt.treatment_description || apt.reason || "";
    const cost = Math.round(duration * therapyRate * 100) / 100;

    const item: TherapyBreakdownItem = {
      patientName,
      patientId,
      date: aptDate,
      minutes: duration,
      treatment: treatment || undefined,
      therapistName,
      cost,
    };

    if (referringDentist) {
      const existing = therapyByDentist.get(referringDentist.id) || [];
      existing.push(item);
      therapyByDentist.set(referringDentist.id, existing);
      assigned++;
    } else {
      unassigned++;
      console.log(`[Dentally] Unassigned therapy: ${patientName} on ${aptDate} (${duration} mins)`);
    }
  }

  console.log(`[Dentally] Therapy breakdown: ${assigned} assigned, ${unassigned} unassigned`);

  return therapyByDentist;
}

// Batch fetch patient names for efficiency
async function fetchPatientNames(patientIds: string[], token: string): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();

  console.log(`[Dentally] Fetching names for ${patientIds.length} patients...`);

  // Fetch in parallel batches of 10
  const batchSize = 10;
  for (let i = 0; i < patientIds.length; i += batchSize) {
    const batch = patientIds.slice(i, i + batchSize);
    const promises = batch.map(async (patientId) => {
      try {
        const res = await fetch(`${DENTALLY_API}/patients/${patientId}`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          const patient = data.patient || data;
          const firstName = patient.first_name || patient.firstName || "";
          const lastName = patient.last_name || patient.lastName || "";
          const name = `${firstName} ${lastName}`.trim();
          if (name) {
            nameMap.set(patientId, name);
            return;
          }
        }
      } catch (e) {
        console.error(`[Dentally] Failed to fetch patient ${patientId}:`, e);
      }
      nameMap.set(patientId, `Patient ${patientId}`);
    });

    await Promise.all(promises);

    // Log progress
    if ((i + batchSize) % 50 === 0 || i + batchSize >= patientIds.length) {
      console.log(`[Dentally] Fetched ${Math.min(i + batchSize, patientIds.length)}/${patientIds.length} patient names`);
    }
  }

  return nameMap;
}

// Fetch user info from Dentally to identify unknown user IDs
async function fetchUserInfo(userId: string, token: string): Promise<{ name: string; role?: string } | null> {
  try {
    const res = await fetch(`${DENTALLY_API}/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      const user = data.user || data;
      const firstName = user.first_name || "";
      const lastName = user.last_name || "";
      return {
        name: `${firstName} ${lastName}`.trim() || user.email || `User ${userId}`,
        role: user.role || user.user_type || user.job_title || undefined,
      };
    }
  } catch (e) {
    console.error(`[Dentally] Failed to fetch user ${userId}:`, e);
  }
  return null;
}

// Fetch all site users to get their roles
interface DentallyUser {
  id: string | number;
  first_name?: string;
  last_name?: string;
  role?: string;
  user_type?: string;
  job_title?: string;
}

async function fetchAllUsers(token: string, siteId: string): Promise<Map<string, { name: string; role?: string; isClinician: boolean }>> {
  const userMap = new Map<string, { name: string; role?: string; isClinician: boolean }>();

  try {
    // Fetch users for the site
    const res = await fetch(`${DENTALLY_API}/users?site_id=${siteId}&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    if (res.ok) {
      const data = await res.json();
      const users: DentallyUser[] = data.users || data.data || [];

      for (const user of users) {
        const userId = String(user.id);
        const firstName = user.first_name || "";
        const lastName = user.last_name || "";
        const name = `${firstName} ${lastName}`.trim() || `User ${userId}`;
        const role = user.role || user.user_type || user.job_title || undefined;
        const isClinician = isClinicianRole(role);

        userMap.set(userId, { name, role, isClinician });
        console.log(`[Dentally] User ${userId}: ${name} (${role || "no role"}) - ${isClinician ? "CLINICIAN" : "non-clinician"}`);
      }

      console.log(`[Dentally] Loaded ${users.length} users, ${Array.from(userMap.values()).filter(u => u.isClinician).length} are clinicians`);
    }
  } catch (e) {
    console.error(`[Dentally] Failed to fetch users:`, e);
  }

  return userMap;
}

// Determine payment status from invoice
function getPaymentStatus(inv: DentallyInvoice, privateAmount: number): { status: "paid" | "partial" | "unpaid"; amountPaid: number; amountOutstanding: number } {
  const totalAmount = parseAmount(inv.amount);
  const outstanding = parseAmount(inv.amount_outstanding || inv.balance || 0);

  // If invoice is marked as paid
  if (inv.paid === true || inv.state === "paid") {
    return { status: "paid", amountPaid: privateAmount, amountOutstanding: 0 };
  }

  // If there's outstanding balance
  if (outstanding > 0) {
    const paidRatio = totalAmount > 0 ? (totalAmount - outstanding) / totalAmount : 0;
    const amountPaid = Math.round(privateAmount * paidRatio * 100) / 100;
    const amountOutstanding = Math.round((privateAmount - amountPaid) * 100) / 100;

    if (amountPaid <= 0) {
      return { status: "unpaid", amountPaid: 0, amountOutstanding: privateAmount };
    }
    return { status: "partial", amountPaid, amountOutstanding };
  }

  // No outstanding = fully paid
  return { status: "paid", amountPaid: privateAmount, amountOutstanding: 0 };
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { period_id } = await req.json();
  const db = await getDb();

  // Load clinic settings from database
  const clinicSettings = await getClinicSettings();
  const { siteId, therapistIds, nhsAmounts, therapyRate } = clinicSettings;

  // Validate required settings
  if (!siteId) {
    return NextResponse.json({
      error: "Dentally Site ID not configured. Please set it in Settings > Dentally Integration."
    }, { status: 400 });
  }

  // Get the period
  const periodResult = await db.execute({ sql: "SELECT * FROM pay_periods WHERE id = ?", args: [period_id] });
  if (periodResult.rows.length === 0) return NextResponse.json({ error: "Period not found" }, { status: 404 });
  const period = rowTo<{ id: number; month: number; year: number }>(periodResult.rows[0]);

  // Calculate date range for the period (first day to last day of the month)
  const startDate = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  // For end date, use the first day of the NEXT month (exclusive)
  const endMonth = period.month === 12 ? 1 : period.month + 1;
  const endYear = period.month === 12 ? period.year + 1 : period.year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  console.log(`[Dentally] Fetching invoices for period: ${startDate} to ${endDate} (exclusive)`);
  console.log(`[Dentally] Using Site ID: ${siteId}`);
  console.log(`[Dentally] Therapist IDs: ${therapistIds.size > 0 ? Array.from(therapistIds).join(", ") : "(none configured)"}`);
  console.log(`[Dentally] NHS Amounts: ${nhsAmounts.size > 0 ? Array.from(nhsAmounts).join(", ") : "(none configured)"}`);

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) return NextResponse.json({ error: "DENTALLY_API_TOKEN not configured" }, { status: 400 });

  // Get all active dentists
  const dentistsResult = await db.execute("SELECT * FROM dentists WHERE active = 1");
  const dentists = rowsTo<Dentist>(dentistsResult.rows);

  // Map by user_id
  const dentistByUserId = new Map<string, Dentist>();
  for (const d of dentists) {
    if (d.practitioner_id) {
      dentistByUserId.set(String(d.practitioner_id), d);
      console.log(`[Dentally] Mapped dentist: ${d.name} -> user_id ${d.practitioner_id}`);
    }
  }

  try {
    // Fetch all users first to identify clinicians by role
    const allUsers = await fetchAllUsers(token, siteId);

    // Fetch invoices from Dentally WITH date filtering
    // Use dated_on_from and dated_on_to to filter by invoice date (not created_at)
    // This significantly reduces the number of invoices fetched
    const url = `${DENTALLY_API}/invoices?site_id=${siteId}&dated_on_from=${startDate}&dated_on_to=${endDate}`;
    console.log(`[Dentally] Fetching invoices with date filter: ${startDate} to ${endDate}`);
    const allInvoices = await fetchAllPages(url, token);

    console.log(`[Dentally] Total invoices from API (with date filter): ${allInvoices.length}`);

    // Additional client-side date filtering as safety net (in case API filter is loose)
    const invoices = allInvoices.filter(inv => isInvoiceInDateRange(inv, startDate, endDate));
    console.log(`[Dentally] Invoices after client-side verification: ${invoices.length}`);

    // Fetch appointments for duration data
    const appointments = await fetchAppointments(startDate, endDate, token, siteId);
    const appointmentMap = buildAppointmentMap(appointments);
    console.log(`[Dentally] Built appointment map with ${appointmentMap.size} patient-date combinations`);

    // Track data per dentist
    type DentistData = {
      patients: PatientRecord[];
      discrepancies: Discrepancy[];
      totalInvoiced: number;
      totalPaid: number;
      totalOutstanding: number;
      financeCount: number;
      analytics?: DentistAnalytics;
    };

    const dentistTotals = new Map<number, DentistData>();
    const unmatchedUserIds = new Set<string>();
    const allPatientIds = new Set<string>();

    let skippedZeroAmount = 0;
    let skippedNonClinician = 0;
    let skippedNhs = 0;
    let processedCount = 0;
    let flaggedCount = 0;
    let financeCount = 0;

    // First pass: process invoices and collect patient IDs
    const invoiceDataByDentist = new Map<number, Array<{ inv: DentallyInvoice; privateAmount: number; patientId: string }>>();

    for (const inv of invoices) {
      const totalAmount = parseAmount(inv.amount);

      if (totalAmount <= 0) {
        skippedZeroAmount++;
        continue;
      }

      const userId = String(inv.user_id || inv.practitioner_id || "");
      if (!userId) continue;

      // Check if user is a clinician by role
      const userInfo = allUsers.get(userId);
      if (userInfo && !userInfo.isClinician) {
        // User is known but not a clinician - skip
        skippedNonClinician++;
        continue;
      }

      const dentist = dentistByUserId.get(userId);
      if (!dentist) {
        unmatchedUserIds.add(userId);
        continue;
      }

      // Calculate private amount
      let privateAmount = 0;
      const items = inv.invoice_items || [];

      if (items.length > 0) {
        for (const item of items) {
          const itemAmount = parseAmount(item.amount);
          if (itemAmount <= 0) continue;
          if (isNhsItem(item, nhsAmounts)) { skippedNhs++; continue; }
          if (isCbctItem(item)) continue;
          privateAmount += itemAmount;
        }
      } else {
        if (!isNhsAmount(totalAmount, nhsAmounts)) {
          privateAmount = totalAmount;
        } else {
          skippedNhs++;
          continue;
        }
      }

      if (privateAmount <= 0) continue;

      const patientId = String(inv.patient_id);
      allPatientIds.add(patientId);

      if (!invoiceDataByDentist.has(dentist.id)) {
        invoiceDataByDentist.set(dentist.id, []);
      }
      invoiceDataByDentist.get(dentist.id)!.push({ inv, privateAmount, patientId });
    }

    // Fetch ALL patient names upfront
    const patientNames = await fetchPatientNames(Array.from(allPatientIds), token);

    // Second pass: create patient records with names
    for (const [dentistId, invoiceData] of invoiceDataByDentist) {
      if (!dentistTotals.has(dentistId)) {
        dentistTotals.set(dentistId, {
          patients: [],
          discrepancies: [],
          totalInvoiced: 0,
          totalPaid: 0,
          totalOutstanding: 0,
          financeCount: 0,
        });
      }
      const data = dentistTotals.get(dentistId)!;

      for (const { inv, privateAmount, patientId } of invoiceData) {
        // Get payment status
        const paymentInfo = getPaymentStatus(inv, privateAmount);
        const invoiceDate = inv.dated_on || inv.created_at?.substring(0, 10) || "";
        const isFinance = isFinancePayment(inv);
        const patientName = patientNames.get(patientId) || `Patient ${patientId}`;

        if (isFinance) {
          financeCount++;
          data.financeCount++;
        }

        // Look up appointment for duration and treatment
        const aptKey = `${patientId}_${invoiceDate}`;
        const patientAppointments = appointmentMap.get(aptKey) || [];
        let durationMins = 0;
        let treatment = "";

        if (patientAppointments.length > 0) {
          // Sum all appointments for this patient on this date
          for (const apt of patientAppointments) {
            durationMins += getAppointmentDuration(apt);
            if (!treatment && (apt.treatment_description || apt.reason)) {
              treatment = apt.treatment_description || apt.reason || "";
            }
          }
        }

        // Also try to get treatment from invoice items
        if (!treatment && inv.invoice_items && inv.invoice_items.length > 0) {
          const mainItem = inv.invoice_items.find(item => !isNhsItem(item, nhsAmounts) && !isCbctItem(item));
          if (mainItem?.name) treatment = mainItem.name;
        }

        // Calculate hourly rate if we have duration
        const hourlyRate = durationMins > 0 ? (privateAmount / (durationMins / 60)) : 0;

        // Create patient record
        const patientRecord: PatientRecord = {
          name: patientName,
          date: invoiceDate,
          amount: Math.round(privateAmount * 100) / 100,
          amountPaid: paymentInfo.amountPaid,
          amountOutstanding: paymentInfo.amountOutstanding,
          status: paymentInfo.status,
          finance: isFinance,
          invoiceId: String(inv.id),
          patientId,
          durationMins: durationMins > 0 ? durationMins : undefined,
          treatment: treatment || undefined,
          hourlyRate: hourlyRate > 0 ? Math.round(hourlyRate * 100) / 100 : undefined,
        };

        // Flag if not fully paid OR if finance (for review)
        if (paymentInfo.status !== "paid") {
          patientRecord.flagged = true;
          patientRecord.flagReason = paymentInfo.status === "unpaid"
            ? "Invoice not paid"
            : `Partial payment: £${paymentInfo.amountPaid} of £${privateAmount}`;
          flaggedCount++;

          // Add to discrepancies
          data.discrepancies.push({
            type: paymentInfo.status === "unpaid" ? "invoiced_not_paid" : "partial_payment",
            patientName: patientName,
            patientId,
            invoiceId: String(inv.id),
            invoicedAmount: privateAmount,
            paidAmount: paymentInfo.amountPaid,
            date: invoiceDate,
            notes: patientRecord.flagReason,
          });
        } else if (isFinance) {
          // Flag finance payments for review even if paid
          patientRecord.flagged = true;
          patientRecord.flagReason = "Paid via finance - verify fee deduction";
        }

        data.patients.push(patientRecord);
        data.totalInvoiced += privateAmount;
        data.totalPaid += paymentInfo.amountPaid;
        data.totalOutstanding += paymentInfo.amountOutstanding;

        processedCount++;
      }

      // Sort patients by date
      data.patients.sort((a, b) => a.date.localeCompare(b.date));

      // Calculate analytics for this dentist
      const dentist = dentists.find(d => d.id === dentistId);
      if (dentist) {
        const weeklyHours = (dentist as Dentist & { weekly_hours?: number }).weekly_hours || 40;
        data.analytics = calculateDentistAnalytics(data.patients, dentist.split_percentage, weeklyHours);
      }
    }

    console.log(`[Dentally] Processed ${processedCount} invoices, ${flaggedCount} flagged for review, ${financeCount} finance payments`);

    // Calculate therapy breakdown (find referring dentist for each therapy appointment)
    console.log(`[Dentally] Calculating therapy breakdown...`);
    const therapyBreakdown = await calculateTherapyBreakdown(
      appointments,
      startDate,
      endDate,
      token,
      siteId,
      therapistIds,
      therapyRate,
      dentistByUserId,
      dentists,
      allUsers,
      patientNames
    );

    // Update database
    let updated = 0;
    for (const [dentistId, data] of dentistTotals) {
      const entryResult = await db.execute({
        sql: "SELECT * FROM payslip_entries WHERE period_id = ? AND dentist_id = ?",
        args: [period_id, dentistId],
      });

      // Prepare patient data for storage (include payment status, duration, treatment, hourly rate)
      const patientsForStorage = data.patients.map(({ name, date, amount, amountPaid, amountOutstanding, status, finance, flagged, flagReason, invoiceId, patientId, durationMins, treatment, hourlyRate }) => ({
        name, date, amount, amountPaid, amountOutstanding, status, finance, flagged, flagReason, invoiceId, patientId, durationMins, treatment, hourlyRate
      }));

      // Store discrepancies as JSON
      const discrepanciesJson = JSON.stringify(data.discrepancies);

      // Store analytics as JSON
      const analyticsJson = JSON.stringify(data.analytics || {});

      // Get therapy breakdown for this dentist
      const therapyItems = therapyBreakdown.get(dentistId) || [];
      const therapyBreakdownJson = JSON.stringify(therapyItems);
      const totalTherapyMinutes = therapyItems.reduce((sum, item) => sum + item.minutes, 0);

      if (entryResult.rows.length > 0) {
        await db.execute({
          sql: `UPDATE payslip_entries SET
            gross_private = ?,
            private_patients_json = ?,
            discrepancies_json = ?,
            analytics_json = ?,
            therapy_breakdown_json = ?,
            therapy_minutes = ?,
            updated_at = datetime('now')
          WHERE period_id = ? AND dentist_id = ?`,
          args: [
            Math.round(data.totalPaid * 100) / 100, // Only count PAID amount as gross
            JSON.stringify(patientsForStorage),
            discrepanciesJson,
            analyticsJson,
            therapyBreakdownJson,
            totalTherapyMinutes,
            period_id,
            dentistId,
          ],
        });
        updated++;
        const dentistName = dentists.find(d => d.id === dentistId)?.name;
        const analytics = data.analytics;
        const therapyCost = Math.round(totalTherapyMinutes * therapyRate * 100) / 100;
        console.log(`[Dentally] Updated ${dentistName}: £${data.totalPaid.toFixed(2)} paid, ${data.patients.length} patients, ${analytics?.totalChairMins || 0} mins chair time, ${totalTherapyMinutes} therapy mins (£${therapyCost})`);
      }
    }

    // Look up names for unmatched user IDs (only clinicians)
    const unmatchedClinicians: Array<{ id: string; name?: string; role?: string }> = [];
    for (const uid of unmatchedUserIds) {
      // First check if we already have this user info
      let info = allUsers.get(uid);
      if (!info) {
        // Fetch individual user info
        const fetchedInfo = await fetchUserInfo(uid, token);
        if (fetchedInfo) {
          const isClinician = isClinicianRole(fetchedInfo.role);
          info = { name: fetchedInfo.name, role: fetchedInfo.role, isClinician };
        }
      }

      // Only report clinicians as unmatched - non-clinicians are expected to be unmatched
      if (info && info.isClinician) {
        unmatchedClinicians.push({
          id: uid,
          name: info.name,
          role: info.role,
        });
      }
    }

    // Build summary with analytics
    const summary: Record<string, {
      invoiced: number;
      paid: number;
      outstanding: number;
      patients: number;
      flagged: number;
      finance: number;
      chairMins: number;
      grossPerHour: number;
      netPerHour: number;
      utilization: number;
    }> = {};

    for (const [dentistId, data] of dentistTotals) {
      const d = dentists.find((d) => d.id === dentistId);
      if (d) {
        summary[d.name] = {
          invoiced: Math.round(data.totalInvoiced * 100) / 100,
          paid: Math.round(data.totalPaid * 100) / 100,
          outstanding: Math.round(data.totalOutstanding * 100) / 100,
          patients: data.patients.length,
          flagged: data.discrepancies.length,
          finance: data.financeCount,
          chairMins: data.analytics?.totalChairMins || 0,
          grossPerHour: data.analytics?.grossPerHour || 0,
          netPerHour: data.analytics?.netPerHour || 0,
          utilization: data.analytics?.utilizationPercent || 0,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Found ${allInvoices.length} total invoices, ${invoices.length} in ${startDate} to ${endDate}. Updated ${updated} dentists. ${flaggedCount} items need review, ${financeCount} finance payments.`,
      debug: {
        totalInvoicesFromApi: allInvoices.length,
        invoicesInDateRange: invoices.length,
        processedInvoices: processedCount,
        flaggedForReview: flaggedCount,
        financePayments: financeCount,
        skippedZeroAmount,
        skippedNonClinician,
        skippedNhs,
        unmatchedClinicianIds: unmatchedClinicians,
        dateRange: { start: startDate, end: endDate },
      },
      summary,
    });
  } catch (err: unknown) {
    console.error("[Dentally] Error:", err);
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Dentally fetch failed: ${errMsg}` }, { status: 500 });
  }
}
