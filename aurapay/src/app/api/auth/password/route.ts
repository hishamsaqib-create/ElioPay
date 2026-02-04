import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { getDb, rowTo } from "@/lib/db";

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body;

  // Validate input
  if (!currentPassword || typeof currentPassword !== "string") {
    return NextResponse.json({ error: "Current password is required" }, { status: 400 });
  }
  if (!newPassword || typeof newPassword !== "string") {
    return NextResponse.json({ error: "New password is required" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Get current user's password hash
    const result = await db.execute({
      sql: "SELECT password_hash FROM users WHERE id = ?",
      args: [user.id],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const dbUser = rowTo<{ password_hash: string }>(result.rows[0]);

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, dbUser.password_hash);
    if (!validPassword) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await db.execute({
      sql: "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
      args: [newHash, user.id],
    });

    return NextResponse.json({ ok: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("[Auth] Password change error:", error);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
