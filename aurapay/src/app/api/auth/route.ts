import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, rowTo } from "@/lib/db";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const db = await getDb();
  const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const user = rowTo<{ id: number; email: string; password_hash: string; name: string; role: string }>(result.rows[0]);

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
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
