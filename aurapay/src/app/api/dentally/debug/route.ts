import { NextResponse } from "next/server";
import { getDb, rowsTo, Dentist } from "@/lib/db";
import { getSession, isOwner } from "@/lib/auth";

const DENTALLY_API = "https://api.dentally.co/v1";

// Get site ID from env var or use default
function getSiteId(): string {
  return process.env.DENTALLY_SITE_ID || "212f9c01-f4f2-446d-b7a3-0162b135e9d3";
}

interface DentallyUser {
  id: string;
  name: string;
  email?: string;
  role?: string;
  active?: boolean;
  first_name?: string;
  last_name?: string;
}

export async function GET() {
  // SECURITY: Only allow in development or for owners
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if production and not owner
  if (process.env.NODE_ENV === "production" && !isOwner(user)) {
    return NextResponse.json(
      { error: "Debug endpoints are restricted to owners in production" },
      { status: 403 }
    );
  }

  const token = process.env.DENTALLY_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "DENTALLY_API_TOKEN environment variable not configured" },
      { status: 400 }
    );
  }

  const siteId = getSiteId();
  const db = await getDb();
  const dentistsResult = await db.execute("SELECT * FROM dentists");
  const dentists = rowsTo<Dentist>(dentistsResult.rows);

  // Fetch ALL users from Dentally with full details
  let dentallyUsers: DentallyUser[] = [];
  let rawUsersResponse: unknown = null;
  try {
    const usersRes = await fetch(`${DENTALLY_API}/users?site_id=${siteId}&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (usersRes.ok) {
      const usersData = await usersRes.json();
      rawUsersResponse = usersData;
      const users = usersData.users || usersData.data || [];
      dentallyUsers = users.map((u: Record<string, unknown>) => ({
        id: String(u.id),
        first_name: String(u.first_name || ""),
        last_name: String(u.last_name || ""),
        name: `${u.first_name || ""} ${u.last_name || ""}`.trim() || String(u.name || u.email || "Unknown"),
        email: String(u.email || ""),
        role: String(u.role || u.user_type || u.job_title || ""),
        active: u.active !== false && u.status !== "inactive",
      }));
    }
  } catch (e) {
    console.error("Failed to fetch users", e);
  }

  // Try fetching practitioners endpoint as well (some systems use this)
  let practitioners: DentallyUser[] = [];
  try {
    const pracRes = await fetch(`${DENTALLY_API}/practitioners?site_id=${siteId}&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (pracRes.ok) {
      const pracData = await pracRes.json();
      const pracs = pracData.practitioners || pracData.data || [];
      practitioners = pracs.map((p: Record<string, unknown>) => ({
        id: String(p.id),
        name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || String(p.name || "Unknown"),
        email: String(p.email || ""),
        role: String(p.role || p.practitioner_type || "practitioner"),
      }));
    }
  } catch (e) {
    console.error("Failed to fetch practitioners", e);
  }

  // Fetch sample invoices from recent date ranges to find user IDs
  const now = new Date();
  const dateRanges = [
    {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0],
      to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0],
    },
    {
      from: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split("T")[0],
      to: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0],
    },
  ];

  const allInvoiceUserIds: Record<string, { count: number; totalAmount: number; name?: string }> = {};
  let sampleInvoice: Record<string, unknown> | null = null;

  for (const range of dateRanges) {
    try {
      const url = `${DENTALLY_API}/invoices?created_from=${range.from}&created_to=${range.to}&site_id=${siteId}&per_page=50`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (res.ok) {
        const raw = await res.json();
        const invoices = raw.invoices || raw.data || [];
        if (!sampleInvoice && invoices.length > 0) {
          sampleInvoice = invoices[0];
        }
        for (const inv of invoices) {
          const uid = String(inv.user_id || inv.practitioner_id || "");
          if (uid) {
            if (!allInvoiceUserIds[uid]) allInvoiceUserIds[uid] = { count: 0, totalAmount: 0 };
            allInvoiceUserIds[uid].count++;
            allInvoiceUserIds[uid].totalAmount += parseFloat(inv.amount || 0);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to fetch invoices for ${range.from}`, e);
    }
  }

  // Match invoice user IDs with Dentally users
  for (const uid of Object.keys(allInvoiceUserIds)) {
    const matchedUser = dentallyUsers.find(u => u.id === uid);
    if (matchedUser) {
      allInvoiceUserIds[uid].name = matchedUser.name;
    }
  }

  // Build stored dentist mapping
  const storedDentistIds = new Set(dentists.map(d => d.practitioner_id).filter(Boolean));

  // Find unmatched user IDs (in invoices but not in our database)
  const unmatchedIds: Array<{ id: string; name?: string; count: number; totalAmount: number }> = [];
  for (const [uid, data] of Object.entries(allInvoiceUserIds)) {
    if (!storedDentistIds.has(uid)) {
      unmatchedIds.push({ id: uid, name: data.name, count: data.count, totalAmount: data.totalAmount });
    }
  }

  return NextResponse.json({
    // Debug info
    _debug: {
      environment: process.env.NODE_ENV,
      user: { id: user.id, email: user.email, role: user.role },
      site_id: siteId,
    },

    // All users from Dentally (sorted by name)
    dentally_users: dentallyUsers.sort((a, b) => a.name.localeCompare(b.name)),
    dentally_users_count: dentallyUsers.length,

    // Practitioners endpoint (if different)
    practitioners: practitioners.length > 0 ? practitioners : "No practitioners endpoint or empty",

    // User IDs found in invoices
    invoice_user_ids: allInvoiceUserIds,

    // User IDs in invoices that don't match any stored dentist
    unmatched_invoice_ids: unmatchedIds.sort((a, b) => b.count - a.count),

    // Our stored dentists
    stored_dentists: dentists.map(d => ({
      id: d.id,
      name: d.name,
      practitioner_id: d.practitioner_id,
      active: d.active,
    })),

    // Sample invoice structure (redact patient data in production)
    sample_invoice: process.env.NODE_ENV === "production"
      ? (sampleInvoice ? { keys: Object.keys(sampleInvoice) } : null)
      : sampleInvoice,

    // Raw response for debugging
    raw_users_response_keys: rawUsersResponse ? Object.keys(rawUsersResponse as object) : [],
  });
}
