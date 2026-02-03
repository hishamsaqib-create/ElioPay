import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

const DENTALLY_API = "https://api.dentally.co/v1";
const SITE_ID = "212f9c01-f4f2-446d-b7a3-0162b135e9d3";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) return NextResponse.json({ error: "No DENTALLY_API_TOKEN" }, { status: 400 });

  const db = await getDb();
  const dentistsResult = await db.execute("SELECT * FROM dentists WHERE active = 1");
  const dentists = rowsTo<Dentist>(dentistsResult.rows);

  // Fetch a small sample of recent invoices
  const url = `${DENTALLY_API}/invoices?created_from=2025-01-01&created_to=2025-02-01&site_id=${SITE_ID}&per_page=5`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `API ${res.status}: ${text}` }, { status: 500 });
  }

  const raw = await res.json();

  return NextResponse.json({
    raw_response_keys: Object.keys(raw),
    raw_first_invoice: raw.invoices?.[0] || raw.data?.[0] || null,
    raw_first_invoice_keys: Object.keys(raw.invoices?.[0] || raw.data?.[0] || {}),
    total_in_page: (raw.invoices || raw.data || []).length,
    links: raw.links || null,
    meta: raw.meta || null,
    stored_dentists: dentists.map(d => ({ id: d.id, name: d.name, practitioner_id: d.practitioner_id })),
  });
}
