import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, Dentist } from "@/lib/db";
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

// Roles that count as clinicians/dentists (case-insensitive match)
const CLINICIAN_ROLES = ["dentist", "clinician", "associate", "principal"];

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

// Patient record with payment status
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

async function fetchAllUsers(token: string): Promise<Map<string, { name: string; role?: string; isClinician: boolean }>> {
  const userMap = new Map<string, { name: string; role?: string; isClinician: boolean }>();

  try {
    // Fetch users for the site
    const res = await fetch(`${DENTALLY_API}/users?site_id=${SITE_ID}&per_page=100`, {
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
    const allUsers = await fetchAllUsers(token);

    // Fetch invoices from Dentally WITH date filtering
    // Use dated_on_from and dated_on_to to filter by invoice date (not created_at)
    // This significantly reduces the number of invoices fetched
    const url = `${DENTALLY_API}/invoices?site_id=${SITE_ID}&dated_on_from=${startDate}&dated_on_to=${endDate}`;
    console.log(`[Dentally] Fetching invoices with date filter: ${startDate} to ${endDate}`);
    const allInvoices = await fetchAllPages(url, token);

    console.log(`[Dentally] Total invoices from API (with date filter): ${allInvoices.length}`);

    // Additional client-side date filtering as safety net (in case API filter is loose)
    const invoices = allInvoices.filter(inv => isInvoiceInDateRange(inv, startDate, endDate));
    console.log(`[Dentally] Invoices after client-side verification: ${invoices.length}`);

    // Track data per dentist
    type DentistData = {
      patients: PatientRecord[];
      discrepancies: Discrepancy[];
      totalInvoiced: number;
      totalPaid: number;
      totalOutstanding: number;
      financeCount: number;
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
          if (isNhsItem(item)) { skippedNhs++; continue; }
          if (isCbctItem(item)) continue;
          privateAmount += itemAmount;
        }
      } else {
        if (!isNhsAmount(totalAmount)) {
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
    }

    console.log(`[Dentally] Processed ${processedCount} invoices, ${flaggedCount} flagged for review, ${financeCount} finance payments`);

    // Update database
    let updated = 0;
    for (const [dentistId, data] of dentistTotals) {
      const entryResult = await db.execute({
        sql: "SELECT * FROM payslip_entries WHERE period_id = ? AND dentist_id = ?",
        args: [period_id, dentistId],
      });

      // Prepare patient data for storage (include payment status)
      const patientsForStorage = data.patients.map(({ name, date, amount, amountPaid, amountOutstanding, status, finance, flagged, flagReason, invoiceId, patientId }) => ({
        name, date, amount, amountPaid, amountOutstanding, status, finance, flagged, flagReason, invoiceId, patientId
      }));

      // Store discrepancies as JSON
      const discrepanciesJson = JSON.stringify(data.discrepancies);

      if (entryResult.rows.length > 0) {
        await db.execute({
          sql: `UPDATE payslip_entries SET
            gross_private = ?,
            private_patients_json = ?,
            discrepancies_json = ?,
            updated_at = datetime('now')
          WHERE period_id = ? AND dentist_id = ?`,
          args: [
            Math.round(data.totalPaid * 100) / 100, // Only count PAID amount as gross
            JSON.stringify(patientsForStorage),
            discrepanciesJson,
            period_id,
            dentistId,
          ],
        });
        updated++;
        const dentistName = dentists.find(d => d.id === dentistId)?.name;
        console.log(`[Dentally] Updated ${dentistName}: £${data.totalPaid.toFixed(2)} paid, £${data.totalOutstanding.toFixed(2)} outstanding (${data.patients.length} patients, ${data.discrepancies.length} flagged, ${data.financeCount} finance)`);
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

    // Build summary
    const summary: Record<string, {
      invoiced: number;
      paid: number;
      outstanding: number;
      patients: number;
      flagged: number;
      finance: number;
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
