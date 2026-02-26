import { NextRequest, NextResponse } from "next/server";
import { getSession, signToken, AuthUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user });
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, email } = body;

  // Validate input
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const trimmedName = name.trim();

  try {
    const db = await getDb();

    // Check if email is already taken by another user
    const existing = await db.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ? AND id != ?",
      args: [normalizedEmail, user.id],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "Email is already in use" }, { status: 400 });
    }

    // Update user
    await db.execute({
      sql: "UPDATE users SET name = ?, email = ? WHERE id = ?",
      args: [trimmedName, normalizedEmail, user.id],
    });

    // Create new token with updated info (preserve clinic_id and is_super_admin)
    const updatedUser: AuthUser = {
      id: user.id,
      email: normalizedEmail,
      name: trimmedName,
      role: user.role,
      clinic_id: user.clinic_id,
      is_super_admin: user.is_super_admin,
    };

    const token = signToken(updatedUser);

    const res = NextResponse.json({ user: updatedUser });
    res.cookies.set("aurapay_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (error) {
    console.error("[Auth] Profile update error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
