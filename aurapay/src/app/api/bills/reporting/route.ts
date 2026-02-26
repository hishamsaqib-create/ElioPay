import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();

  // Lab bills by month
  const labByMonth = await db.execute(`
    SELECT month, year, lab_name, SUM(amount) as total, COUNT(*) as count,
      SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) as paid_count,
      SUM(CASE WHEN paid = 1 THEN amount ELSE 0 END) as paid_total,
      SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END) as unpaid_total
    FROM lab_bill_entries
    GROUP BY year, month, lab_name
    ORDER BY year DESC, month DESC, lab_name
  `);

  // Supplier invoices by month
  const supplierByMonth = await db.execute(`
    SELECT month, year, supplier_name, SUM(amount) as total, COUNT(*) as count,
      SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) as paid_count,
      SUM(CASE WHEN paid = 1 THEN amount ELSE 0 END) as paid_total,
      SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END) as unpaid_total
    FROM supplier_invoice_entries
    GROUP BY year, month, supplier_name
    ORDER BY year DESC, month DESC, supplier_name
  `);

  // Lab bills by dentist
  const labByDentist = await db.execute(`
    SELECT d.name as dentist_name, lb.lab_name, SUM(lb.amount) as total, COUNT(*) as count
    FROM lab_bill_entries lb
    LEFT JOIN dentists d ON lb.dentist_id = d.id
    GROUP BY lb.dentist_id, lb.lab_name
    ORDER BY d.name, lb.lab_name
  `);

  // Monthly totals for trend line
  const monthlyTotals = await db.execute(`
    SELECT year, month,
      (SELECT COALESCE(SUM(amount), 0) FROM lab_bill_entries WHERE year = m.year AND month = m.month) as lab_total,
      (SELECT COALESCE(SUM(amount), 0) FROM supplier_invoice_entries WHERE year = m.year AND month = m.month) as supplier_total
    FROM (
      SELECT DISTINCT year, month FROM lab_bill_entries
      UNION
      SELECT DISTINCT year, month FROM supplier_invoice_entries
    ) m
    ORDER BY year, month
  `);

  // Dentist pay from finalized periods (for the pay trend line)
  const dentistPay = await db.execute(`
    SELECT pp.month, pp.year, d.name as dentist_name, pe.gross_private,
      pe.lab_bills_json, pe.finance_fees, pe.therapy_minutes, pe.therapy_rate,
      pe.superannuation_deduction, pe.adjustments_json, d.split_percentage,
      d.is_nhs, d.uda_rate, pe.nhs_udas
    FROM payslip_entries pe
    JOIN pay_periods pp ON pe.period_id = pp.id
    JOIN dentists d ON pe.dentist_id = d.id
    WHERE pp.status = 'finalized'
    ORDER BY pp.year, pp.month, d.name
  `);

  // Summary stats
  const labSummary = await db.execute(`
    SELECT COUNT(*) as total_count, COALESCE(SUM(amount), 0) as total_amount,
      SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) as paid_count,
      SUM(CASE WHEN paid = 1 THEN amount ELSE 0 END) as paid_amount,
      SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) as unpaid_count,
      SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END) as unpaid_amount
    FROM lab_bill_entries
  `);

  const supplierSummary = await db.execute(`
    SELECT COUNT(*) as total_count, COALESCE(SUM(amount), 0) as total_amount,
      SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) as paid_count,
      SUM(CASE WHEN paid = 1 THEN amount ELSE 0 END) as paid_amount,
      SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) as unpaid_count,
      SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END) as unpaid_amount
    FROM supplier_invoice_entries
  `);

  return NextResponse.json({
    labByMonth: labByMonth.rows,
    supplierByMonth: supplierByMonth.rows,
    labByDentist: labByDentist.rows,
    monthlyTotals: monthlyTotals.rows,
    dentistPay: dentistPay.rows,
    labSummary: labSummary.rows[0],
    supplierSummary: supplierSummary.rows[0],
  });
}
