import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, rowTo, rowsTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/admin/users - List all users
export async function GET() {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const db = await getDb();
    const result = await db.execute(`
      SELECT u.id, u.email, u.name, u.role, u.clinic_id, u.is_super_admin, u.created_at,
             c.name as clinic_name
      FROM users u
      LEFT JOIN clinics c ON c.id = u.clinic_id
      ORDER BY u.created_at DESC
    `);

    const users = rowsTo<{
      id: number;
      email: string;
      name: string;
      role: string;
      clinic_id: number | null;
      clinic_name: string | null;
      is_super_admin: number;
      created_at: string;
    }>(result.rows);

    return NextResponse.json({
      users: users.map(u => ({
        ...u,
        is_super_admin: u.is_super_admin === 1,
      })),
    });
  } catch (error) {
    console.error("[Admin] Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

// POST /api/admin/users - Create a new user
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
    clinic_id?: number | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password, name, role, clinic_id } = body;

  // Validate required fields
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const validRoles = ["owner", "manager", "viewer"];
  const userRole = validRoles.includes(role || "") ? role : "manager";

  try {
    const db = await getDb();

    // Check if email already exists
    const existing = await db.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [email.toLowerCase().trim()],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "Email already in use" }, { status: 400 });
    }

    // Hash password
    const passwordHash = bcrypt.hashSync(password, 12);

    // Create user
    const result = await db.execute({
      sql: `INSERT INTO users (email, password_hash, name, role, clinic_id, is_super_admin, must_change_password)
            VALUES (?, ?, ?, ?, ?, 0, 1)`,
      args: [email.toLowerCase().trim(), passwordHash, name.trim(), userRole, clinic_id || null],
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: Number(result.lastInsertRowid),
        email: email.toLowerCase().trim(),
        name: name.trim(),
        role: userRole,
        clinic_id: clinic_id || null,
        is_super_admin: false,
      },
    });
  } catch (error) {
    console.error("[Admin] Error creating user:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

// PUT /api/admin/users - Update a user
export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    id?: number;
    email?: string;
    name?: string;
    role?: string;
    clinic_id?: number | null;
    password?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id, email, name, role, clinic_id, password } = body;

  if (!id || typeof id !== "number") {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Check user exists
    const existing = await db.execute({
      sql: "SELECT * FROM users WHERE id = ?",
      args: [id],
    });

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existingUser = rowTo<{ is_super_admin: number }>(existing.rows[0]);

    // Don't allow modifying super admins (except yourself)
    if (existingUser.is_super_admin === 1 && id !== user.id) {
      return NextResponse.json({ error: "Cannot modify other super admins" }, { status: 403 });
    }

    // Check email uniqueness if changing
    if (email) {
      const emailCheck = await db.execute({
        sql: "SELECT id FROM users WHERE LOWER(email) = ? AND id != ?",
        args: [email.toLowerCase().trim(), id],
      });
      if (emailCheck.rows.length > 0) {
        return NextResponse.json({ error: "Email already in use" }, { status: 400 });
      }
    }

    // Build update query
    const updates: string[] = [];
    const args: (string | number | null)[] = [];

    if (email) {
      updates.push("email = ?");
      args.push(email.toLowerCase().trim());
    }
    if (name) {
      updates.push("name = ?");
      args.push(name.trim());
    }
    if (role && ["owner", "manager", "viewer"].includes(role)) {
      updates.push("role = ?");
      args.push(role);
    }
    if (clinic_id !== undefined) {
      updates.push("clinic_id = ?");
      args.push(clinic_id);
    }
    if (password && password.length >= 8) {
      updates.push("password_hash = ?");
      args.push(bcrypt.hashSync(password, 12));
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    args.push(id);
    await db.execute({
      sql: `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
      args,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Admin] Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// DELETE /api/admin/users - Delete a user
export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get("id");
  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  const id = parseInt(userId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  // Don't allow deleting yourself
  if (id === user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Check if user is super admin
    const existing = await db.execute({
      sql: "SELECT is_super_admin FROM users WHERE id = ?",
      args: [id],
    });

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const targetUser = rowTo<{ is_super_admin: number }>(existing.rows[0]);
    if (targetUser.is_super_admin === 1) {
      return NextResponse.json({ error: "Cannot delete super admin users" }, { status: 403 });
    }

    await db.execute({
      sql: "DELETE FROM users WHERE id = ?",
      args: [id],
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Admin] Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
