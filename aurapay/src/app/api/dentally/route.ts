import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, Dentist, PayslipEntry } from "@/lib/db";
import { getSession } from "@/lib/auth";

const DENTALLY_API = "https://api.dentally.co/v1";
const SITE_ID = "212f9c01-f4f2-446d-b7a3-0162b135e9d3";

// NHS band amounts to exclude
const NHS_AMOUNTS = new Set([27.40, 75.30, 326.70, 47.90, 299.30, 251.40, 23.80, 65.20, 282.80]);
const NHS_KEYWORDS = [
  "band 1", "band 2", "band 3", "nhs exam", "nhs scale", "nhs polish",
  "nhs fluoride", "nhs fissure", "urgent dental", "nhs extraction",
  "nhs filling", "nhs root", "nhs crown", "nhs denture", "nhs bridge",
];
const CBCT_KEYWORDS = ["cbct", "ct scan", "cone beam"];

// Therapist practitioner IDs to exclude
const THERAPIST_IDS = new Set(["189343", "288298", "189342", "189349", "189358", "191534", "209545"]);

interface DentallyInvoice {
  id: string;
  patient_id: string;
  patient?: { first_name?: string; last_name?: string };
  practitioner_id: string;
  amount: number;
  balance: number;
  paid: boolean;
  created_at: string;
  invoice_items?: { name: string; amount: number; nhs_charge?: boolean }[];
  payment_explanation?: { links?: { payments?: string } };
}

function isNhsItem(item: { name: string; amount: number; nhs_charge?: boolean }): boolean {
  if (item.nhs_charge) return true;
  const lower = item.name.toLowerCase();
  if (NHS_KEYWORDS.some((k) => lower.includes(k))) return true;
  if (NHS_AMOUNTS.has(item.amount)) return true;
  return false;
}

function isCbctItem(item: { name: string }): boolean {
  const lower = item.name.toLowerCase();
  return CBCT_KEYWORDS.some((k) => lower.includes(k));
}

async function fetchAllPages(url: string, token: string): Promise<DentallyInvoice[]> {
  const all: DentallyInvoice[] = [];
  let nextUrl: string | null = url;
  let page = 0;

  while (nextUrl && page < 50) {
    const fetchRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    if (!fetchRes.ok) {
      const text = await fetchRes.text();
      throw new Error(`Dentally API error ${fetchRes.status}: ${text}`);
    }

    const data = await fetchRes.json();
    const invoices = data.invoices || data.data || [];
    all.push(...invoices);

    // Check for pagination
    nextUrl = data.links?.next || data.meta?.next_page_url || null;
    page++;
  }

  return all;
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

  // Calculate date range
  const startDate = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const endMonth = period.month === 12 ? 1 : period.month + 1;
  const endYear = period.month === 12 ? period.year + 1 : period.year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) return NextResponse.json({ error: "DENTALLY_API_TOKEN not configured" }, { status: 400 });

  // Get all dentists
  const dentistsResult = await db.execute("SELECT * FROM dentists WHERE active = 1");
  const dentists = rowsTo<Dentist>(dentistsResult.rows);
  const dentistByPracId = new Map<string, Dentist>();
  for (const d of dentists) {
    if (d.practitioner_id) dentistByPracId.set(d.practitioner_id, d);
  }

  try {
    // Fetch invoices from Dentally
    const url = `${DENTALLY_API}/invoices?created_from=${startDate}&created_to=${endDate}&site_id=${SITE_ID}&per_page=100`;
    const invoices = await fetchAllPages(url, token);

    // Group private income by dentist
    const dentistTotals = new Map<number, { gross: number; patients: { name: string; date: string; amount: number; finance: boolean }[] }>();
    const unmatchedPracIds = new Set<string>();
    let skippedUnpaid = 0;
    let skippedTherapist = 0;

    for (const inv of invoices) {
      // Skip unpaid or zero balance
      if (!inv.paid || inv.balance > 0 || inv.amount <= 0) { skippedUnpaid++; continue; }

      // Extract practitioner ID - handle various Dentally response formats
      const pracId = String(inv.practitioner_id || "");

      // Skip therapists
      if (THERAPIST_IDS.has(pracId)) { skippedTherapist++; continue; }

      // Find dentist
      const dentist = dentistByPracId.get(pracId);
      if (!dentist) { unmatchedPracIds.add(pracId); continue; }

      // Calculate private amount (exclude NHS and CBCT items)
      let privateAmount = 0;
      const items = inv.invoice_items || [];

      if (items.length > 0) {
        for (const item of items) {
          if (isNhsItem(item)) continue;
          if (isCbctItem(item)) continue;
          privateAmount += item.amount;
        }
      } else {
        // No line items, use total if it's not an NHS amount
        if (!NHS_AMOUNTS.has(inv.amount)) {
          privateAmount = inv.amount;
        }
      }

      if (privateAmount <= 0) continue;

      if (!dentistTotals.has(dentist.id)) {
        dentistTotals.set(dentist.id, { gross: 0, patients: [] });
      }
      const totals = dentistTotals.get(dentist.id)!;
      totals.gross += privateAmount;

      // Check if finance payment
      const isFinance = !!(inv.payment_explanation?.links?.payments);

      const patientName = inv.patient
        ? `${inv.patient.first_name || ""} ${inv.patient.last_name || ""}`.trim()
        : `Patient ${inv.patient_id}`;

      totals.patients.push({
        name: patientName,
        date: inv.created_at?.substring(0, 10) || "",
        amount: privateAmount,
        finance: isFinance,
      });
    }

    // Update payslip entries
    let updated = 0;
    for (const [dentistId, data] of dentistTotals) {
      // Get existing entry
      const entryResult = await db.execute({
        sql: "SELECT * FROM payslip_entries WHERE period_id = ? AND dentist_id = ?",
        args: [period_id, dentistId],
      });

      if (entryResult.rows.length > 0) {
        const entry = rowTo<PayslipEntry>(entryResult.rows[0]);
        // Only update if gross_private is 0 (don't overwrite manual edits)
        const existingPatients = JSON.parse(String(entry.private_patients_json) || "[]");
        const shouldUpdatePatients = existingPatients.length === 0;

        await db.execute({
          sql: `UPDATE payslip_entries SET
            gross_private = ?,
            private_patients_json = CASE WHEN ? = 1 THEN ? ELSE private_patients_json END,
            updated_at = datetime('now')
          WHERE period_id = ? AND dentist_id = ?`,
          args: [
            data.gross,
            shouldUpdatePatients ? 1 : 0,
            JSON.stringify(data.patients),
            period_id,
            dentistId,
          ],
        });
        updated++;
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Fetched ${invoices.length} invoices, updated ${updated} dentists`,
      debug: {
        totalInvoices: invoices.length,
        skippedUnpaid,
        skippedTherapist,
        unmatchedPracIds: Array.from(unmatchedPracIds),
        knownPracIds: dentists.map((d) => ({ name: d.name, practitioner_id: d.practitioner_id })),
        sampleInvoice: invoices[0] ? { practitioner_id: invoices[0].practitioner_id, amount: invoices[0].amount, paid: invoices[0].paid } : null,
      },
      summary: Object.fromEntries(
        Array.from(dentistTotals.entries()).map(([id, data]) => {
          const d = dentists.find((d) => d.id === id);
          return [d?.name || id, { gross: Math.round(data.gross * 100) / 100, patients: data.patients.length }];
        })
      ),
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Dentally fetch failed: ${errMsg}` }, { status: 500 });
  }
}
