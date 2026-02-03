import { NextRequest, NextResponse } from "next/server";
import { getDb, PayPeriod } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const periods = db.prepare("SELECT * FROM pay_periods ORDER BY year DESC, month DESC").all() as PayPeriod[];
  return NextResponse.json({ periods });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { month, year } = await req.json();
  const db = getDb();

  // Check if period exists
  const existing = db.prepare("SELECT * FROM pay_periods WHERE month = ? AND year = ?").get(month, year) as PayPeriod | undefined;
  if (existing) {
    return NextResponse.json({ period: existing });
  }

  const result = db.prepare(
    "INSERT INTO pay_periods (month, year, status, created_by) VALUES (?, ?, 'draft', ?)"
  ).run(month, year, user.id);

  // Create entries for all active dentists
  const dentists = db.prepare("SELECT id FROM dentists WHERE active = 1").all() as { id: number }[];
  const entryStmt = db.prepare(
    "INSERT OR IGNORE INTO payslip_entries (period_id, dentist_id) VALUES (?, ?)"
  );
  for (const d of dentists) {
    entryStmt.run(result.lastInsertRowid, d.id);
  }

  const period = db.prepare("SELECT * FROM pay_periods WHERE id = ?").get(result.lastInsertRowid) as PayPeriod;
  return NextResponse.json({ period }, { status: 201 });
}
