import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo, rowTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface Clinic {
  id: number;
  name: string;
  logo_url: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  website: string | null;
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();

  // Get global settings
  const result = await db.execute("SELECT key, value FROM settings");
  const rows = rowsTo<{ key: string; value: string }>(result.rows);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;

  // If user has a clinic, override with clinic-specific branding
  if (user.clinic_id) {
    const clinicResult = await db.execute({
      sql: "SELECT id, name, logo_url, email, phone, address_line1, address_line2, city, postcode, website FROM clinics WHERE id = ?",
      args: [user.clinic_id],
    });

    if (clinicResult.rows.length > 0) {
      const clinic = rowTo<Clinic>(clinicResult.rows[0]);
      // Override settings with clinic-specific values
      if (clinic.name) settings.clinic_name = clinic.name;
      if (clinic.logo_url) settings.clinic_logo_url = clinic.logo_url;
      if (clinic.email) settings.clinic_email = clinic.email;
      if (clinic.phone) settings.clinic_phone = clinic.phone;
      if (clinic.address_line1) settings.clinic_address_line1 = clinic.address_line1;
      if (clinic.address_line2) settings.clinic_address_line2 = clinic.address_line2;
      if (clinic.city) settings.clinic_city = clinic.city;
      if (clinic.postcode) settings.clinic_postcode = clinic.postcode;
      if (clinic.website) settings.clinic_website = clinic.website;
    }
  }

  return NextResponse.json({ settings, clinic_id: user.clinic_id });
}

// Map of settings keys to clinic table columns
const CLINIC_SETTINGS_MAP: Record<string, string> = {
  clinic_name: "name",
  clinic_logo_url: "logo_url",
  clinic_email: "email",
  clinic_phone: "phone",
  clinic_address_line1: "address_line1",
  clinic_address_line2: "address_line2",
  clinic_city: "city",
  clinic_postcode: "postcode",
  clinic_website: "website",
};

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = await getDb();

  // Separate clinic-specific settings from global settings
  const clinicUpdates: Record<string, string> = {};
  const globalUpdates: Record<string, string> = {};

  for (const [k, v] of Object.entries(body)) {
    const clinicColumn = CLINIC_SETTINGS_MAP[k];
    if (clinicColumn && user.clinic_id) {
      // This is a clinic-specific setting and user has a clinic
      clinicUpdates[clinicColumn] = String(v);
    } else {
      // Global setting
      globalUpdates[k] = String(v);
    }
  }

  // Update clinic-specific settings in clinics table
  if (user.clinic_id && Object.keys(clinicUpdates).length > 0) {
    const setClauses = Object.keys(clinicUpdates).map(col => `${col} = ?`).join(", ");
    const values = Object.values(clinicUpdates);
    values.push(String(user.clinic_id));

    await db.execute({
      sql: `UPDATE clinics SET ${setClauses} WHERE id = ?`,
      args: values,
    });
  }

  // Update global settings
  for (const [k, v] of Object.entries(globalUpdates)) {
    await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", args: [k, v] });
  }

  return NextResponse.json({ ok: true });
}
