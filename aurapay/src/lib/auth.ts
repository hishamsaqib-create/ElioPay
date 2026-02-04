import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

// SECURITY: JWT_SECRET is required in production - no fallback
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CRITICAL: JWT_SECRET environment variable is required in production");
    }
    // Only allow fallback in development with warning
    console.warn("WARNING: Using default JWT secret. Set JWT_SECRET environment variable!");
    return "dev-only-secret-not-for-production";
  }
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return secret;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "owner" | "manager" | "viewer";
  clinic_id?: number | null;
  is_super_admin?: boolean;
}

// Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<string, number> = {
  owner: 3,
  manager: 2,
  viewer: 1,
};

export function signToken(user: AuthUser): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AuthUser;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("eliopay_token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

// Check if user has required role or higher
export function hasRole(user: AuthUser | null, requiredRole: "owner" | "manager" | "viewer"): boolean {
  if (!user) return false;
  return (ROLE_HIERARCHY[user.role] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}

// Check if user can perform write operations
export function canWrite(user: AuthUser | null): boolean {
  return hasRole(user, "manager");
}

// Check if user can perform admin operations
export function isOwner(user: AuthUser | null): boolean {
  return hasRole(user, "owner");
}
