import { NextResponse } from "next/server";
import { getDb, rowsTo } from "@/lib/db";

// GET /api/favicon - Returns the favicon URL (logo or default)
export async function GET() {
  try {
    const db = await getDb();
    const result = await db.execute({
      sql: "SELECT value FROM settings WHERE key = ?",
      args: ["clinic_logo_url"],
    });

    const rows = rowsTo<{ value: string }>(result.rows);
    const logoUrl = rows[0]?.value;

    if (logoUrl && logoUrl.trim()) {
      // Redirect to the logo URL
      return NextResponse.redirect(logoUrl, { status: 302 });
    }

    // Return default icon - redirect to static icon
    return NextResponse.redirect(new URL("/icon.svg", process.env.NEXT_PUBLIC_APP_URL || "https://aurapay.co.uk"), { status: 302 });
  } catch (error) {
    console.error("[Favicon] Error:", error);
    // Fallback to default icon
    return NextResponse.redirect(new URL("/icon.svg", process.env.NEXT_PUBLIC_APP_URL || "https://aurapay.co.uk"), { status: 302 });
  }
}
