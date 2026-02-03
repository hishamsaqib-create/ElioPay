import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const result = await db.execute("SELECT * FROM dentists ORDER BY name");
  return NextResponse.json({ dentists: rowsTo<Dentist>(result.rows) });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO dentists (name, email, split_percentage, is_nhs, uda_rate, performer_number, practitioner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [body.name, body.email || null, body.split_percentage, body.is_nhs ? 1 : 0, body.uda_rate || 0, body.performer_number || null, body.practitioner_id || null],
  });
  const row = await db.execute({ sql: "SELECT * FROM dentists WHERE id = ?", args: [result.lastInsertRowid!] });
  return NextResponse.json({ dentist: rowTo<Dentist>(row.rows[0]) }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = await getDb();
  await db.execute({
    sql: `UPDATE dentists SET name=?, email=?, split_percentage=?, is_nhs=?, uda_rate=?, performer_number=?, practitioner_id=?, active=? WHERE id=?`,
    args: [body.name, body.email || null, body.split_percentage, body.is_nhs ? 1 : 0, body.uda_rate || 0, body.performer_number || null, body.practitioner_id || null, body.active ? 1 : 0, body.id],
  });
  const row = await db.execute({ sql: "SELECT * FROM dentists WHERE id = ?", args: [body.id] });
  return NextResponse.json({ dentist: rowTo<Dentist>(row.rows[0]) });
}
