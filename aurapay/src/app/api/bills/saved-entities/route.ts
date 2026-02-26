import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const labs = await db.execute("SELECT * FROM saved_labs ORDER BY name");
  const suppliers = await db.execute("SELECT * FROM saved_suppliers ORDER BY name");

  return NextResponse.json({ labs: labs.rows, suppliers: suppliers.rows });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { type, name, account_name, sort_code, account_number } = body;

  if (!type || !name) {
    return NextResponse.json({ error: "type and name are required" }, { status: 400 });
  }

  const db = await getDb();
  const table = type === "lab" ? "saved_labs" : "saved_suppliers";

  try {
    const result = await db.execute({
      sql: `INSERT INTO ${table} (name, account_name, sort_code, account_number) VALUES (?, ?, ?, ?)`,
      args: [name, account_name || "", sort_code || "", account_number || ""],
    });
    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (error: unknown) {
    if (error instanceof Error && error.message?.includes("UNIQUE")) {
      return NextResponse.json({ error: "Name already exists" }, { status: 409 });
    }
    throw error;
  }
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { type, id, name, account_name, sort_code, account_number } = body;

  if (!type || !id) return NextResponse.json({ error: "type and id are required" }, { status: 400 });

  const db = await getDb();
  const table = type === "lab" ? "saved_labs" : "saved_suppliers";

  await db.execute({
    sql: `UPDATE ${table} SET name = ?, account_name = ?, sort_code = ?, account_number = ? WHERE id = ?`,
    args: [name, account_name || "", sort_code || "", account_number || "", id],
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !id) return NextResponse.json({ error: "type and id are required" }, { status: 400 });

  const db = await getDb();
  const table = type === "lab" ? "saved_labs" : "saved_suppliers";
  await db.execute({ sql: `DELETE FROM ${table} WHERE id = ?`, args: [parseInt(id)] });

  return NextResponse.json({ ok: true });
}
