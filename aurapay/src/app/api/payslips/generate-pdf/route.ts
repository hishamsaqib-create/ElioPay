import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generatePayslipPdf } from "@/lib/pdf-generator";
import { PayslipCalculation } from "@/lib/calculations";

export async function POST(req: NextRequest) {
  return generatePdf(req, true);
}

export async function GET(req: NextRequest) {
  return generatePdf(req, false);
}

async function generatePdf(req: NextRequest, isPost: boolean) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let entryId: string | null = null;
  let clientCalc: PayslipCalculation | null = null;

  if (isPost) {
    const body = await req.json();
    entryId = String(body.entry_id);
    if (body.calculation) clientCalc = body.calculation as PayslipCalculation;
  } else {
    entryId = req.nextUrl.searchParams.get("entry_id");
  }

  if (!entryId) return NextResponse.json({ error: "entry_id required" }, { status: 400 });

  try {
    const { buffer: pdfBuffer, filename } = await generatePayslipPdf(entryId, clientCalc);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
    });
  } catch (error) {
    console.error("[PDF] Generation error:", error);
    return NextResponse.json({
      error: "PDF generation failed",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}
