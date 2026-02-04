import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Helper to generate slug from name
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// GET /api/admin/clinics - Get all clinics (super admin only)
export async function GET() {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const db = await getDb();
    const result = await db.execute(`
      SELECT c.*,
        (SELECT COUNT(*) FROM users WHERE clinic_id = c.id) as user_count,
        (SELECT COUNT(*) FROM dentists WHERE clinic_id = c.id) as dentist_count
      FROM clinics c
      ORDER BY c.created_at DESC
    `);

    return NextResponse.json({ clinics: result.rows });
  } catch (error) {
    console.error("[Admin Clinics] Error:", error);
    return NextResponse.json({ error: "Failed to fetch clinics" }, { status: 500 });
  }
}

// POST /api/admin/clinics - Create a new clinic
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    name?: string;
    email?: string;
    phone?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    postcode?: string;
    website?: string;
    dentally_site_id?: string;
    dentally_api_token?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, email, phone, address_line1, address_line2, city, postcode, website, dentally_site_id, dentally_api_token } = body;

  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: "Clinic name is required" }, { status: 400 });
  }

  const slug = slugify(name.trim());
  if (slug.length < 2) {
    return NextResponse.json({ error: "Clinic name is too short" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Check for duplicate slug
    const existing = await db.execute({
      sql: "SELECT id FROM clinics WHERE slug = ?",
      args: [slug],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "A clinic with a similar name already exists" }, { status: 400 });
    }

    // Create clinic
    const result = await db.execute({
      sql: `INSERT INTO clinics (name, slug, email, phone, address_line1, address_line2, city, postcode, website, dentally_site_id, dentally_api_token, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      args: [
        name.trim(),
        slug,
        email?.trim() || null,
        phone?.trim() || null,
        address_line1?.trim() || null,
        address_line2?.trim() || null,
        city?.trim() || null,
        postcode?.trim() || null,
        website?.trim() || null,
        dentally_site_id?.trim() || null,
        dentally_api_token?.trim() || null,
      ],
    });

    // Log the action
    await logAuditAction(db, user.id, "clinic_created", "clinic", Number(result.lastInsertRowid), { name: name.trim() });

    return NextResponse.json({
      success: true,
      clinic: {
        id: Number(result.lastInsertRowid),
        name: name.trim(),
        slug,
      },
    });
  } catch (error) {
    console.error("[Admin Clinics] Create error:", error);
    return NextResponse.json({ error: "Failed to create clinic" }, { status: 500 });
  }
}

// PUT /api/admin/clinics - Update a clinic
export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    id?: number;
    name?: string;
    email?: string;
    phone?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    postcode?: string;
    website?: string;
    dentally_site_id?: string;
    dentally_api_token?: string;
    active?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id, name, email, phone, address_line1, address_line2, city, postcode, website, dentally_site_id, dentally_api_token, active } = body;

  if (!id) {
    return NextResponse.json({ error: "Clinic ID is required" }, { status: 400 });
  }

  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: "Clinic name is required" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Update clinic
    await db.execute({
      sql: `UPDATE clinics SET
        name = ?, email = ?, phone = ?,
        address_line1 = ?, address_line2 = ?, city = ?, postcode = ?,
        website = ?, dentally_site_id = ?, dentally_api_token = ?, active = ?
        WHERE id = ?`,
      args: [
        name.trim(),
        email?.trim() || null,
        phone?.trim() || null,
        address_line1?.trim() || null,
        address_line2?.trim() || null,
        city?.trim() || null,
        postcode?.trim() || null,
        website?.trim() || null,
        dentally_site_id?.trim() || null,
        dentally_api_token?.trim() || null,
        active !== false ? 1 : 0,
        id,
      ],
    });

    // Log the action
    await logAuditAction(db, user.id, "clinic_updated", "clinic", id, { name: name.trim() });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Clinics] Update error:", error);
    return NextResponse.json({ error: "Failed to update clinic" }, { status: 500 });
  }
}

// DELETE /api/admin/clinics - Delete a clinic
export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Clinic ID is required" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Check if clinic has users
    const users = await db.execute({
      sql: "SELECT COUNT(*) as count FROM users WHERE clinic_id = ?",
      args: [Number(id)],
    });

    if (Number(users.rows[0]?.count || 0) > 0) {
      return NextResponse.json({ error: "Cannot delete clinic with assigned users" }, { status: 400 });
    }

    // Get clinic name for audit log
    const clinic = await db.execute({
      sql: "SELECT name FROM clinics WHERE id = ?",
      args: [Number(id)],
    });

    const clinicName = String(clinic.rows[0]?.name || "Unknown");

    // Delete clinic
    await db.execute({
      sql: "DELETE FROM clinics WHERE id = ?",
      args: [Number(id)],
    });

    // Log the action
    await logAuditAction(db, user.id, "clinic_deleted", "clinic", Number(id), { name: clinicName });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Clinics] Delete error:", error);
    return NextResponse.json({ error: "Failed to delete clinic" }, { status: 500 });
  }
}

// Helper to log audit actions
async function logAuditAction(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  userId: number,
  action: string,
  entityType: string,
  entityId: number,
  details?: Record<string, unknown>
) {
  try {
    await db.execute({
      sql: `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      args: [userId, action, entityType, entityId, JSON.stringify(details || {})],
    });
  } catch (error) {
    // Audit log table might not exist yet, silently fail
    console.warn("[Audit] Failed to log action:", error);
  }
}
