import { NextResponse } from "next/server";
import { getDb, rowsTo, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

const DENTALLY_API = "https://api.dentally.co/v1";
const SITE_ID = "212f9c01-f4f2-446d-b7a3-0162b135e9d3";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) return NextResponse.json({ error: "No DENTALLY_API_TOKEN" }, { status: 400 });

  const db = await getDb();
  const dentistsResult = await db.execute("SELECT * FROM dentists WHERE active = 1");
  const dentists = rowsTo<Dentist>(dentistsResult.rows);

  // Try to fetch users/practitioners from Dentally
  let dentallyUsers: Array<{ id: string; name: string; role?: string }> = [];
  try {
    const usersRes = await fetch(`${DENTALLY_API}/users?site_id=${SITE_ID}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (usersRes.ok) {
      const usersData = await usersRes.json();
      const users = usersData.users || usersData.data || [];
      dentallyUsers = users.map((u: Record<string, unknown>) => ({
        id: String(u.id),
        name: `${u.first_name || ""} ${u.last_name || ""}`.trim() || String(u.name || u.email || "Unknown"),
        role: String(u.role || u.user_type || ""),
      }));
    }
  } catch (e) {
    console.error("Failed to fetch users", e);
  }

  // Fetch a small sample of recent invoices
  const url = `${DENTALLY_API}/invoices?created_from=2025-01-01&created_to=2025-02-01&site_id=${SITE_ID}&per_page=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `API ${res.status}: ${text}` }, { status: 500 });
  }

  const raw = await res.json();
  const invoices = raw.invoices || raw.data || [];

  // Extract unique user_ids from invoices with their amounts
  const userIdSummary: Record<string, { count: number; totalAmount: number }> = {};
  for (const inv of invoices) {
    const uid = String(inv.user_id || inv.practitioner_id || "");
    if (uid) {
      if (!userIdSummary[uid]) userIdSummary[uid] = { count: 0, totalAmount: 0 };
      userIdSummary[uid].count++;
      userIdSummary[uid].totalAmount += parseFloat(inv.amount || 0);
    }
  }

  return NextResponse.json({
    dentally_users: dentallyUsers,
    invoice_user_ids: userIdSummary,
    raw_first_invoice: invoices[0] || null,
    raw_first_invoice_keys: Object.keys(invoices[0] || {}),
    total_invoices_in_page: invoices.length,
    stored_dentists: dentists.map(d => ({ id: d.id, name: d.name, practitioner_id: d.practitioner_id })),
  });
}
