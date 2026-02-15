import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb, rowsTo } from "@/lib/db";
import { generatePayslipPdf } from "@/lib/pdf-generator";
import { getMonthName } from "@/lib/calculations";
import JSZip from "jszip";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { period_id } = await req.json();
  if (!period_id) return NextResponse.json({ error: "period_id required" }, { status: 400 });

  const db = await getDb();

  // Get period info
  const periodResult = await db.execute({
    sql: "SELECT * FROM pay_periods WHERE id = ?",
    args: [period_id],
  });
  if (periodResult.rows.length === 0) return NextResponse.json({ error: "Period not found" }, { status: 404 });
  const period = periodResult.rows[0] as unknown as { id: number; month: number; year: number };

  // Get all entries for this period
  const entriesResult = await db.execute({
    sql: "SELECT id FROM payslip_entries WHERE period_id = ?",
    args: [period_id],
  });
  const entries = rowsTo<{ id: number }>(entriesResult.rows);

  if (entries.length === 0) return NextResponse.json({ error: "No entries found for this period" }, { status: 404 });

  try {
    const zip = new JSZip();

    for (const entry of entries) {
      const { buffer, filename } = await generatePayslipPdf(String(entry.id));
      zip.file(filename, buffer);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipFilename = `Payslips_${getMonthName(period.month)}_${period.year}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFilename}"`,
      },
    });
  } catch (error) {
    console.error("[Download All] Error:", error);
    return NextResponse.json({
      error: "Failed to generate PDFs",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
