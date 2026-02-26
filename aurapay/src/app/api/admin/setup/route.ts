import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";

// POST /api/admin/setup - Setup or reset admin account
// Protected by a setup key that must match environment variable
export async function POST(req: NextRequest) {
  let body: { setupKey?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { setupKey, email, password } = body;

  // Validate setup key - must match environment variable or default
  const expectedKey = process.env.ADMIN_SETUP_KEY || "aurapay-setup-2025";
  if (setupKey !== expectedKey) {
    return NextResponse.json({ error: "Invalid setup key" }, { status: 403 });
  }

  // Use provided credentials or defaults
  const adminEmail = email || "drhish@auradentalclinic.co.uk";
  const adminPassword = password || "Epsckayu1";

  if (adminPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const hash = bcrypt.hashSync(adminPassword, 12);

    // Check if user exists
    const existing = await db.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [adminEmail.toLowerCase()],
    });

    if (existing.rows.length > 0) {
      // Update existing user to be super admin with new password
      await db.execute({
        sql: "UPDATE users SET password_hash = ?, is_super_admin = 1, must_change_password = 0 WHERE LOWER(email) = ?",
        args: [hash, adminEmail.toLowerCase()],
      });

      return NextResponse.json({
        success: true,
        message: "Admin account updated",
        email: adminEmail,
        action: "updated",
      });
    } else {
      // Create new super admin user
      await db.execute({
        sql: "INSERT INTO users (email, password_hash, name, role, is_super_admin, must_change_password) VALUES (?, ?, ?, ?, ?, ?)",
        args: [adminEmail, hash, "Admin", "owner", 1, 0],
      });

      return NextResponse.json({
        success: true,
        message: "Admin account created",
        email: adminEmail,
        action: "created",
      });
    }
  } catch (error) {
    console.error("[Setup] Error:", error);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}

// GET /api/admin/setup - Check admin account status
export async function GET(req: NextRequest) {
  const setupKey = req.nextUrl.searchParams.get("key");

  const expectedKey = process.env.ADMIN_SETUP_KEY || "aurapay-setup-2025";
  if (setupKey !== expectedKey) {
    return NextResponse.json({ error: "Invalid setup key" }, { status: 403 });
  }

  try {
    const db = await getDb();

    // Check for super admin users
    const admins = await db.execute("SELECT id, email, name, is_super_admin FROM users WHERE is_super_admin = 1");

    return NextResponse.json({
      hasSuperAdmin: admins.rows.length > 0,
      superAdmins: admins.rows.map(r => ({
        id: r.id,
        email: r.email,
        name: r.name,
      })),
    });
  } catch (error) {
    console.error("[Setup] Error checking status:", error);
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
