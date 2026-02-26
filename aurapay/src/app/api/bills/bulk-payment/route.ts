import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET unpaid bills for bulk payment generation
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();

  // Get all unpaid lab bills with bank details
  const labBills = await db.execute(`
    SELECT lb.id, lb.lab_name as entity_name, 'lab' as type, lb.amount, lb.date, lb.description,
      sl.account_name, sl.sort_code, sl.account_number
    FROM lab_bill_entries lb
    LEFT JOIN saved_labs sl ON lb.lab_name = sl.name
    WHERE lb.paid = 0
    ORDER BY lb.lab_name, lb.date
  `);

  // Get all unpaid supplier invoices with bank details
  const supplierInvoices = await db.execute(`
    SELECT si.id, si.supplier_name as entity_name, 'supplier' as type, si.amount, si.date, si.description,
      ss.account_name, ss.sort_code, ss.account_number
    FROM supplier_invoice_entries si
    LEFT JOIN saved_suppliers ss ON si.supplier_name = ss.name
    WHERE si.paid = 0
    ORDER BY si.supplier_name, si.date
  `);

  return NextResponse.json({
    lab_bills: labBills.rows,
    supplier_invoices: supplierInvoices.rows,
  });
}

// POST - mark bills as paid and generate Starling CSV
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action, bill_ids } = body;

  if (action === "mark_paid") {
    const { type, ids } = body;
    if (!type || !ids || !Array.isArray(ids)) {
      return NextResponse.json({ error: "type and ids are required" }, { status: 400 });
    }

    const db = await getDb();
    const table = type === "lab" ? "lab_bill_entries" : "supplier_invoice_entries";
    const today = new Date().toISOString().substring(0, 10);

    for (const id of ids) {
      await db.execute({
        sql: `UPDATE ${table} SET paid = 1, paid_date = ? WHERE id = ?`,
        args: [today, id],
      });
    }

    return NextResponse.json({ ok: true, count: ids.length });
  }

  if (action === "generate_csv") {
    // Generate Starling Bank bulk payment CSV
    // Format: payee_name, sort_code, account_number, amount, reference
    const { payments } = body;
    if (!payments || !Array.isArray(payments)) {
      return NextResponse.json({ error: "payments array is required" }, { status: 400 });
    }

    const rows = ["Payee Name,Sort Code,Account Number,Amount,Reference"];
    for (const p of payments) {
      const sortCode = (p.sort_code || "").replace(/-/g, "");
      rows.push(`"${p.account_name || p.entity_name}","${sortCode}","${p.account_number || ""}","${p.amount.toFixed(2)}","${p.reference || p.entity_name}"`);
    }

    return NextResponse.json({ ok: true, csv: rows.join("\n") });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
