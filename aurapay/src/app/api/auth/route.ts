import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, rowTo } from "@/lib/db";
import { signToken, AuthUser } from "@/lib/auth";

// Simple in-memory rate limiting (resets on cold start, but good enough for basic protection)
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW = 5 * 60 * 1000; // 5 minutes

function isRateLimited(ip: string): { limited: boolean; retryAfter?: number } {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (!attempts) return { limited: false };

  // Reset if outside window
  if (now - attempts.lastAttempt > ATTEMPT_WINDOW) {
    loginAttempts.delete(ip);
    return { limited: false };
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((LOCKOUT_DURATION - (now - attempts.lastAttempt)) / 1000);
    if (retryAfter > 0) {
      return { limited: true, retryAfter };
    }
    loginAttempts.delete(ip);
  }

  return { limited: false };
}

function recordAttempt(ip: string, success: boolean) {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }

  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (!attempts || now - attempts.lastAttempt > ATTEMPT_WINDOW) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
  } else {
    attempts.count++;
    attempts.lastAttempt = now;
  }
}

export async function POST(req: NextRequest) {
  // Get client IP for rate limiting
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  // Check rate limit
  const rateLimitCheck = isRateLimited(ip);
  if (rateLimitCheck.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimitCheck.retryAfter || 900) },
      }
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password } = body;

  // Validate input
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  // Normalize email
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail.includes("@")) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Find user by email (case-insensitive)
    const result = await db.execute({
      sql: "SELECT * FROM users WHERE LOWER(email) = ?",
      args: [normalizedEmail],
    });

    if (result.rows.length === 0) {
      recordAttempt(ip, false);
      // Use same error message to prevent email enumeration
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const user = rowTo<{
      id: number;
      email: string;
      password_hash: string;
      name: string;
      role: string;
    }>(result.rows[0]);

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      recordAttempt(ip, false);
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Successful login
    recordAttempt(ip, true);

    // Validate role before signing
    const validRoles = ["owner", "manager", "viewer"];
    const role = validRoles.includes(user.role) ? user.role : "viewer";

    const token = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: role as AuthUser["role"],
    });

    const res = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role },
    });

    res.cookies.set("aurapay_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (error) {
    console.error("[Auth] Login error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("aurapay_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
    expires: new Date(0),
  });
  return res;
}
