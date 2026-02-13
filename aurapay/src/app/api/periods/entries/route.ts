import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo, PayslipEntry, Dentist, getSetting } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { calculatePayslipWithSettings } from "@/lib/calculations";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const periodId = req.nextUrl.searchParams.get("period_id");
  if (!periodId) return NextResponse.json({ error: "period_id required" }, { status: 400 });

  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT e.*, d.name as dentist_name, d.email as dentist_email,
            d.split_percentage, d.is_nhs, d.uda_rate, d.performer_number
     FROM payslip_entries e
     JOIN dentists d ON d.id = e.dentist_id
     WHERE e.period_id = ?
     ORDER BY d.name`,
    args: [periodId],
  });

  type EntryRow = PayslipEntry & { dentist_name: string; dentist_email: string | null; split_percentage: number; is_nhs: number; uda_rate: number; performer_number: string | null };
  const entries = rowsTo<EntryRow>(result.rows);

  const results = await Promise.all(entries.map(async (entry) => {
    const dentist: Dentist = {
      id: entry.dentist_id,
      name: entry.dentist_name,
      email: entry.dentist_email,
      split_percentage: entry.split_percentage,
      is_nhs: entry.is_nhs,
      uda_rate: entry.uda_rate,
      performer_number: entry.performer_number,
      practitioner_id: null,
      active: 1,
    };
    const calc = await calculatePayslipWithSettings(entry, dentist);
    return { ...entry, calculation: calc, dentist };
  }));

  // Return split settings so client-side recalculation can use them
  const labBillSplit = await getSetting("lab_bill_split", 0.5);
  const financeFeeSplit = await getSetting("finance_fee_split", 0.5);

  return NextResponse.json({ entries: results, settings: { labBillSplit, financeFeeSplit } });
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const db = await getDb();

  await db.execute({
    sql: `UPDATE payslip_entries SET
      gross_private = ?,
      nhs_udas = ?,
      lab_bills_json = ?,
      finance_fees = ?,
      therapy_minutes = ?,
      therapy_rate = ?,
      adjustments_json = ?,
      notes = ?,
      private_patients_json = ?,
      discrepancies_json = ?,
      dentist_log_json = ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    args: [
      body.gross_private ?? 0,
      body.nhs_udas ?? 0,
      JSON.stringify(body.lab_bills || []),
      body.finance_fees ?? 0,
      body.therapy_minutes ?? 0,
      body.therapy_rate ?? 0.5833,
      JSON.stringify(body.adjustments || []),
      body.notes ?? "",
      JSON.stringify(body.private_patients || []),
      JSON.stringify(body.discrepancies || []),
      JSON.stringify(body.dentist_log || []),
      body.id,
    ],
  });

  return NextResponse.json({ ok: true });
}
