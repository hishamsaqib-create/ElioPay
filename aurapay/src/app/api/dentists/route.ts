import { NextRequest, NextResponse } from "next/server";
import { getDb, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const dentists = db.prepare("SELECT * FROM dentists ORDER BY name").all() as Dentist[];
  return NextResponse.json({ dentists });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO dentists (name, email, split_percentage, is_nhs, uda_rate, performer_number, practitioner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(body.name, body.email || null, body.split_percentage, body.is_nhs ? 1 : 0, body.uda_rate || 0, body.performer_number || null, body.practitioner_id || null);
  const dentist = db.prepare("SELECT * FROM dentists WHERE id = ?").get(result.lastInsertRowid) as Dentist;
  return NextResponse.json({ dentist }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();
  db.prepare(
    `UPDATE dentists SET name=?, email=?, split_percentage=?, is_nhs=?, uda_rate=?, performer_number=?, practitioner_id=?, active=? WHERE id=?`
  ).run(body.name, body.email || null, body.split_percentage, body.is_nhs ? 1 : 0, body.uda_rate || 0, body.performer_number || null, body.practitioner_id || null, body.active ? 1 : 0, body.id);
  const dentist = db.prepare("SELECT * FROM dentists WHERE id = ?").get(body.id) as Dentist;
  return NextResponse.json({ dentist });
}
