import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { period_id, status } = await req.json();
  const db = getDb();
  db.prepare(
    "UPDATE pay_periods SET status = ?, finalized_at = CASE WHEN ? = 'finalized' THEN datetime('now') ELSE NULL END WHERE id = ?"
  ).run(status, status, period_id);
  return NextResponse.json({ ok: true });
}
