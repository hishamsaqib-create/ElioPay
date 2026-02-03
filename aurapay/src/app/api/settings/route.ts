import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const result = await db.execute("SELECT key, value FROM settings");
  const rows = rowsTo<{ key: string; value: string }>(result.rows);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = await getDb();
  for (const [k, v] of Object.entries(body)) {
    await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [k, String(v)] });
  }
  return NextResponse.json({ ok: true });
}
