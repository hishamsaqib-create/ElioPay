import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, rowTo, rowsTo } from "@/lib/db";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const db = await getDb();

  // Try all users, find one whose password matches
  const result = await db.execute("SELECT * FROM users");
  const users = rowsTo<{ id: number; email: string; password_hash: string; name: string; role: string }>(result.rows);

  const user = users.find((u) => bcrypt.compareSync(password, u.password_hash));
  if (!user) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.cookies.set("aurapay_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("aurapay_token");
  return res;
}
