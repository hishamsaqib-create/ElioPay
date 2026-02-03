import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET - Fetch lab bills for an entry
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entryId = req.nextUrl.searchParams.get("entry_id");
  if (!entryId) {
    return NextResponse.json({ error: "entry_id required" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const entry = await db.execute({
      sql: `SELECT e.lab_bills_json, d.name as dentist_name, p.month, p.year
            FROM payslip_entries e
            JOIN dentists d ON d.id = e.dentist_id
            JOIN pay_periods p ON p.id = e.period_id
            WHERE e.id = ?`,
      args: [entryId],
    });

    if (entry.rows.length === 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const labBills = JSON.parse(String(entry.rows[0].lab_bills_json || "[]"));

    return NextResponse.json({
      lab_bills: labBills,
      dentist_name: entry.rows[0].dentist_name,
      month: entry.rows[0].month,
      year: entry.rows[0].year,
    });
  } catch (error) {
    console.error("[Lab Bills] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch lab bills" },
      { status: 500 }
    );
  }
}

// DELETE - Remove a lab bill
export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { entry_id, index, file_url } = await req.json();

    if (!entry_id || index === undefined) {
      return NextResponse.json(
        { error: "entry_id and index required" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const entry = await db.execute({
      sql: "SELECT lab_bills_json FROM payslip_entries WHERE id = ?",
      args: [entry_id],
    });

    if (entry.rows.length === 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const labBills = JSON.parse(String(entry.rows[0].lab_bills_json || "[]"));

    if (index < 0 || index >= labBills.length) {
      return NextResponse.json({ error: "Invalid index" }, { status: 400 });
    }

    // Delete file from Vercel Blob if URL exists
    if (file_url) {
      try {
        await del(file_url);
      } catch {
        // File might already be deleted, continue
      }
    }

    // Remove from array
    labBills.splice(index, 1);

    // Update database
    await db.execute({
      sql: "UPDATE payslip_entries SET lab_bills_json = ?, updated_at = datetime('now') WHERE id = ?",
      args: [JSON.stringify(labBills), entry_id],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Lab Bills Delete] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete lab bill" },
      { status: 500 }
    );
  }
}
