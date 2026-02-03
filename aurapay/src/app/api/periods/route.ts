import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, PayPeriod, validateMonth, validateYear } from "@/lib/db";
import { getSession, canWrite } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDb();
    const result = await db.execute("SELECT * FROM pay_periods ORDER BY year DESC, month DESC");
    return NextResponse.json({ periods: rowsTo<PayPeriod>(result.rows) });
  } catch (error) {
    console.error("[Periods] Error fetching periods:", error);
    return NextResponse.json({ error: "Failed to fetch periods" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check write permission
  if (!canWrite(user)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { month?: number; year?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { month, year } = body;

  // Validate inputs
  if (typeof month !== "number" || typeof year !== "number") {
    return NextResponse.json({ error: "month and year are required and must be numbers" }, { status: 400 });
  }

  if (!validateMonth(month)) {
    return NextResponse.json({ error: "Invalid month (must be 1-12)" }, { status: 400 });
  }

  if (!validateYear(year)) {
    return NextResponse.json({ error: "Invalid year (must be 2020-2100)" }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Check for existing period
    const existing = await db.execute({
      sql: "SELECT * FROM pay_periods WHERE month = ? AND year = ?",
      args: [month, year],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json({
        period: rowTo<PayPeriod>(existing.rows[0]),
        message: "Period already exists",
      });
    }

    // Create new period
    const result = await db.execute({
      sql: "INSERT INTO pay_periods (month, year, status, created_by) VALUES (?, ?, 'draft', ?)",
      args: [month, year, user.id],
    });

    if (!result.lastInsertRowid) {
      throw new Error("Failed to insert period - no row ID returned");
    }

    const periodId = result.lastInsertRowid;

    // Create payslip entries for all active dentists
    const dentists = await db.execute("SELECT id FROM dentists WHERE active = 1");
    let entriesCreated = 0;

    for (const d of dentists.rows) {
      const dentistId = (d as unknown as { id: number }).id;
      try {
        await db.execute({
          sql: "INSERT OR IGNORE INTO payslip_entries (period_id, dentist_id) VALUES (?, ?)",
          args: [periodId, dentistId],
        });
        entriesCreated++;
      } catch (e) {
        console.error(`[Periods] Failed to create entry for dentist ${dentistId}:`, e);
      }
    }

    // Fetch the created period
    const period = await db.execute({
      sql: "SELECT * FROM pay_periods WHERE id = ?",
      args: [periodId],
    });

    if (period.rows.length === 0) {
      throw new Error("Period created but could not be retrieved");
    }

    return NextResponse.json(
      {
        period: rowTo<PayPeriod>(period.rows[0]),
        entriesCreated,
        message: `Created period for ${month}/${year} with ${entriesCreated} payslip entries`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Periods] Error creating period:", error);

    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "Period already exists for this month/year" }, { status: 409 });
    }

    return NextResponse.json({ error: "Failed to create period" }, { status: 500 });
  }
}
