import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  const year = searchParams.get("year");

  const db = await getDb();

  let sql = `SELECT lb.*, d.name as dentist_name FROM lab_bill_entries lb
    LEFT JOIN dentists d ON lb.dentist_id = d.id`;
  const args: (string | number)[] = [];
  const conditions: string[] = [];

  if (month && year) {
    conditions.push("lb.month = ? AND lb.year = ?");
    args.push(parseInt(month), parseInt(year));
  } else if (year) {
    conditions.push("lb.year = ?");
    args.push(parseInt(year));
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY lb.date DESC, lb.created_at DESC";

  const result = await db.execute({ sql, args });
  return NextResponse.json({ bills: result.rows });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { lab_name, dentist_id, amount, description, date, file_url } = body;

  if (!lab_name || !date || amount === undefined) {
    return NextResponse.json({ error: "lab_name, date, and amount are required" }, { status: 400 });
  }

  const d = new Date(date);
  const month = d.getMonth() + 1;
  const year = d.getFullYear();

  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO lab_bill_entries (lab_name, dentist_id, amount, description, file_url, date, month, year)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [lab_name, dentist_id || null, amount, description || "", file_url || null, date, month, year],
  });

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = await getDb();
  const fields: string[] = [];
  const args: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (["lab_name", "dentist_id", "amount", "description", "file_url", "date", "paid", "paid_date"].includes(key)) {
      fields.push(`${key} = ?`);
      args.push(value as string | number | null);
    }
  }

  if (updates.date) {
    const d = new Date(updates.date as string);
    fields.push("month = ?", "year = ?");
    args.push(d.getMonth() + 1, d.getFullYear());
  }

  if (fields.length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });

  args.push(id);
  await db.execute({
    sql: `UPDATE lab_bill_entries SET ${fields.join(", ")} WHERE id = ?`,
    args,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = await getDb();
  await db.execute({ sql: "DELETE FROM lab_bill_entries WHERE id = ?", args: [parseInt(id)] });
  return NextResponse.json({ ok: true });
}
