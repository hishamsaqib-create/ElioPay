import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, Dentist, PayslipEntry } from "@/lib/db";
import { getSession } from "@/lib/auth";

const DENTALLY_API = "https://api.dentally.co/v1";
const SITE_ID = "212f9c01-f4f2-446d-b7a3-0162b135e9d3";

// NHS band amounts to exclude (as numbers for comparison)
const NHS_AMOUNTS = new Set([27.40, 75.30, 326.70, 47.90, 299.30, 251.40, 23.80, 65.20, 282.80]);
const NHS_KEYWORDS = [
  "band 1", "band 2", "band 3", "nhs exam", "nhs scale", "nhs polish",
  "nhs fluoride", "nhs fissure", "urgent dental", "nhs extraction",
  "nhs filling", "nhs root", "nhs crown", "nhs denture", "nhs bridge",
];
const CBCT_KEYWORDS = ["cbct", "ct scan", "cone beam"];

// Therapist/Hygienist/Nurse IDs to exclude (updated Dentally user IDs)
const THERAPIST_IDS = new Set([
  "396210", // Colin Pritchard (Therapist)
  "396211", // Taryn Dawson (Therapist)
  "396217", // Karen Wraight (Hygienist)
  "396226", // Student Student (Therapist)
  "395937", // Bethany Harris (Nurse)
  "395938", // Amanda Durham (Nurse)
]);

// Helper to safely parse amount (handles string or number)
function parseAmount(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

// Check if amount matches NHS band (with tolerance for floating point)
function isNhsAmount(amount: number): boolean {
  for (const nhsAmt of NHS_AMOUNTS) {
    if (Math.abs(amount - nhsAmt) < 0.01) return true;
  }
  return false;
}

function isNhsItem(item: { name?: string; amount?: unknown; nhs_charge?: boolean }): boolean {
  if (item.nhs_charge) return true;
  const lower = (item.name || "").toLowerCase();
  if (NHS_KEYWORDS.some((k) => lower.includes(k))) return true;
  const amt = parseAmount(item.amount);
  if (isNhsAmount(amt)) return true;
  return false;
}

function isCbctItem(item: { name?: string }): boolean {
  const lower = (item.name || "").toLowerCase();
  return CBCT_KEYWORDS.some((k) => lower.includes(k));
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
  created_at?: string;
  dated_on?: string;
  invoice_items?: Array<{ name?: string; amount?: unknown; nhs_charge?: boolean; practitioner_id?: string | number }>;
  payment_explanation?: { links?: { payments?: string } };
}

async function fetchAllPages(url: string, token: string): Promise<DentallyInvoice[]> {
  const all: DentallyInvoice[] = [];
  let nextUrl: string | null = url;
  let page = 0;
  const maxPages = 100;

  while (nextUrl && page < maxPages) {
    console.log(`[Dentally] Fetching page ${page + 1}: ${nextUrl.substring(0, 100)}...`);

    const fetchRes: Response = await fetch(nextUrl, {
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
    all.push(...invoices);
    console.log(`[Dentally] Page ${page + 1}: Got ${invoices.length} invoices (total: ${all.length})`);

    // Check for pagination - Dentally uses links.next
    nextUrl = data.links?.next || null;
    page++;

    // If no more invoices on this page, stop
    if (invoices.length === 0) break;
  }

  return all;
}

// Fetch patient details from Dentally
async function fetchPatientName(patientId: string | number, token: string): Promise<string> {
  try {
    const res = await fetch(`${DENTALLY_API}/patients/${patientId}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      const patient = data.patient || data;
      const firstName = patient.first_name || patient.firstName || "";
      const lastName = patient.last_name || patient.lastName || "";
      return `${firstName} ${lastName}`.trim() || `Patient ${patientId}`;
    }
  } catch (e) {
    console.error(`[Dentally] Failed to fetch patient ${patientId}:`, e);
  }
  return `Patient ${patientId}`;
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { period_id } = await req.json();
  const db = await getDb();

  // Get the period
  const periodResult = await db.execute({ sql: "SELECT * FROM pay_periods WHERE id = ?", args: [period_id] });
  if (periodResult.rows.length === 0) return NextResponse.json({ error: "Period not found" }, { status: 404 });
  const period = rowTo<{ id: number; month: number; year: number }>(periodResult.rows[0]);

  // Calculate date range for the period
  const startDate = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const endMonth = period.month === 12 ? 1 : period.month + 1;
  const endYear = period.month === 12 ? period.year + 1 : period.year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  console.log(`[Dentally] Fetching invoices for period: ${startDate} to ${endDate}`);

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) return NextResponse.json({ error: "DENTALLY_API_TOKEN not configured" }, { status: 400 });

  // Get all active dentists and build lookup map
  const dentistsResult = await db.execute("SELECT * FROM dentists WHERE active = 1");
  const dentists = rowsTo<Dentist>(dentistsResult.rows);

  // Map by practitioner_id (which is actually Dentally user_id)
  const dentistByUserId = new Map<string, Dentist>();
  for (const d of dentists) {
    if (d.practitioner_id) {
      dentistByUserId.set(String(d.practitioner_id), d);
      console.log(`[Dentally] Mapped dentist: ${d.name} -> user_id ${d.practitioner_id}`);
    }
  }

  try {
    // Fetch invoices from Dentally for the date range
    const url = `${DENTALLY_API}/invoices?created_from=${startDate}&created_to=${endDate}&site_id=${SITE_ID}&per_page=100`;
    const invoices = await fetchAllPages(url, token);

    console.log(`[Dentally] Total invoices fetched: ${invoices.length}`);

    // Group private income by dentist
    type PatientData = { name: string; date: string; amount: number; finance: boolean; patientId: string };
    const dentistTotals = new Map<number, { gross: number; patients: PatientData[] }>();
    const unmatchedUserIds = new Set<string>();
    const patientNameCache = new Map<string, string>();

    let skippedZeroAmount = 0;
    let skippedTherapist = 0;
    let skippedNhs = 0;
    let processedCount = 0;

    for (const inv of invoices) {
      // Parse amount safely (Dentally returns strings)
      const totalAmount = parseAmount(inv.amount);

      // Skip zero/negative amounts
      if (totalAmount <= 0) {
        skippedZeroAmount++;
        continue;
      }

      // Get user_id (this is the practitioner who owns the invoice)
      // IMPORTANT: Dentally uses user_id on invoices, not practitioner_id
      const userId = String(inv.user_id || inv.practitioner_id || "");

      if (!userId) {
        console.log(`[Dentally] Invoice ${inv.id} has no user_id or practitioner_id`);
        continue;
      }

      // Skip therapists/hygienists/nurses
      if (THERAPIST_IDS.has(userId)) {
        skippedTherapist++;
        continue;
      }

      // Find dentist by user_id
      const dentist = dentistByUserId.get(userId);
      if (!dentist) {
        unmatchedUserIds.add(userId);
        continue;
      }

      // Calculate private amount (exclude NHS and CBCT items)
      let privateAmount = 0;
      const items = inv.invoice_items || [];

      if (items.length > 0) {
        // Process each line item
        for (const item of items) {
          const itemAmount = parseAmount(item.amount);
          if (itemAmount <= 0) continue;
          if (isNhsItem(item)) { skippedNhs++; continue; }
          if (isCbctItem(item)) continue;
          privateAmount += itemAmount;
        }
      } else {
        // No line items - use total amount if it's not an NHS band amount
        if (!isNhsAmount(totalAmount)) {
          privateAmount = totalAmount;
        } else {
          skippedNhs++;
          continue;
        }
      }

      if (privateAmount <= 0) continue;

      // Initialize dentist totals if not exists
      if (!dentistTotals.has(dentist.id)) {
        dentistTotals.set(dentist.id, { gross: 0, patients: [] });
      }
      const totals = dentistTotals.get(dentist.id)!;
      totals.gross += privateAmount;

      // Get patient name (with caching to reduce API calls)
      const patientId = String(inv.patient_id);
      let patientName = patientNameCache.get(patientId);
      if (!patientName) {
        // Batch patient lookups - for now just use ID, we'll fetch names in a second pass
        patientName = `Patient ${patientId}`;
        patientNameCache.set(patientId, patientName);
      }

      // Check if this is a finance payment (has payment links)
      const isFinance = !!(inv.payment_explanation?.links?.payments);

      // Use dated_on (invoice date) or created_at
      const invoiceDate = inv.dated_on || inv.created_at?.substring(0, 10) || "";

      totals.patients.push({
        name: patientName,
        date: invoiceDate,
        amount: Math.round(privateAmount * 100) / 100,
        finance: isFinance,
        patientId: patientId,
      });

      processedCount++;
    }

    console.log(`[Dentally] Processed ${processedCount} invoices for ${dentistTotals.size} dentists`);
    console.log(`[Dentally] Skipped: ${skippedZeroAmount} zero-amount, ${skippedTherapist} therapist, ${skippedNhs} NHS`);
    console.log(`[Dentally] Unmatched user IDs: ${Array.from(unmatchedUserIds).join(", ")}`);

    // Fetch patient names for all patients (batch)
    const allPatientIds = new Set<string>();
    for (const [, data] of dentistTotals) {
      for (const p of data.patients) {
        allPatientIds.add(p.patientId);
      }
    }

    // Fetch patient names (limit to avoid too many API calls)
    const patientIdsToFetch = Array.from(allPatientIds).slice(0, 200);
    console.log(`[Dentally] Fetching names for ${patientIdsToFetch.length} patients...`);

    for (const patientId of patientIdsToFetch) {
      const name = await fetchPatientName(patientId, token);
      patientNameCache.set(patientId, name);
    }

    // Update patient names in totals
    for (const [, data] of dentistTotals) {
      for (const p of data.patients) {
        p.name = patientNameCache.get(p.patientId) || p.name;
      }
      // Sort patients by date
      data.patients.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Update payslip entries in database
    let updated = 0;
    for (const [dentistId, data] of dentistTotals) {
      // Get or create entry
      const entryResult = await db.execute({
        sql: "SELECT * FROM payslip_entries WHERE period_id = ? AND dentist_id = ?",
        args: [period_id, dentistId],
      });

      // Prepare patient data (remove patientId field for storage)
      const patientsForStorage = data.patients.map(({ name, date, amount, finance }) => ({
        name, date, amount, finance
      }));

      if (entryResult.rows.length > 0) {
        // Update existing entry
        await db.execute({
          sql: `UPDATE payslip_entries SET
            gross_private = ?,
            private_patients_json = ?,
            updated_at = datetime('now')
          WHERE period_id = ? AND dentist_id = ?`,
          args: [
            Math.round(data.gross * 100) / 100,
            JSON.stringify(patientsForStorage),
            period_id,
            dentistId,
          ],
        });
        updated++;
        console.log(`[Dentally] Updated ${dentists.find(d => d.id === dentistId)?.name}: £${data.gross.toFixed(2)} (${data.patients.length} patients)`);
      }
    }

    // Build summary for response
    const summary: Record<string, { gross: number; patients: number }> = {};
    for (const [dentistId, data] of dentistTotals) {
      const d = dentists.find((d) => d.id === dentistId);
      if (d) {
        summary[d.name] = {
          gross: Math.round(data.gross * 100) / 100,
          patients: data.patients.length,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Fetched ${invoices.length} invoices, updated ${updated} dentists`,
      debug: {
        totalInvoices: invoices.length,
        processedInvoices: processedCount,
        skippedZeroAmount,
        skippedTherapist,
        skippedNhs,
        unmatchedUserIds: Array.from(unmatchedUserIds),
        knownUserIds: dentists.map((d) => ({ name: d.name, user_id: d.practitioner_id })),
        dateRange: { start: startDate, end: endDate },
        sampleInvoice: invoices[0] ? {
          id: invoices[0].id,
          user_id: invoices[0].user_id,
          amount: invoices[0].amount,
          patient_id: invoices[0].patient_id,
          dated_on: invoices[0].dated_on,
        } : null,
      },
      summary,
    });
  } catch (err: unknown) {
    console.error("[Dentally] Error:", err);
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Dentally fetch failed: ${errMsg}` }, { status: 500 });
  }
}
