import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, PayPeriod } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const result = await db.execute("SELECT * FROM pay_periods ORDER BY year DESC, month DESC");
  return NextResponse.json({ periods: rowsTo<PayPeriod>(result.rows) });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { month, year } = await req.json();
  const db = await getDb();

  const existing = await db.execute({ sql: "SELECT * FROM pay_periods WHERE month = ? AND year = ?", args: [month, year] });
  if (existing.rows.length > 0) {
    return NextResponse.json({ period: rowTo<PayPeriod>(existing.rows[0]) });
  }

  const result = await db.execute({
    sql: "INSERT INTO pay_periods (month, year, status, created_by) VALUES (?, ?, 'draft', ?)",
    args: [month, year, user.id],
  });

  const dentists = await db.execute("SELECT id FROM dentists WHERE active = 1");
  for (const d of dentists.rows) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO payslip_entries (period_id, dentist_id) VALUES (?, ?)",
      args: [result.lastInsertRowid!, (d as unknown as { id: number }).id],
    });
  }

  const period = await db.execute({ sql: "SELECT * FROM pay_periods WHERE id = ?", args: [result.lastInsertRowid!] });
  return NextResponse.json({ period: rowTo<PayPeriod>(period.rows[0]) }, { status: 201 });
}
