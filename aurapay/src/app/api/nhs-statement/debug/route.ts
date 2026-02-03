import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Debug endpoint to see what text is extracted from NHS PDF
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const pdf_file = formData.get("pdf_file") as File | null;

  if (!pdf_file || pdf_file.size === 0) {
    return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await pdf_file.arrayBuffer());

    // Extract text using pdf-parse
    const { PDFParse } = await import("pdf-parse");
    const pdfParser = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await pdfParser.getText();

    // Get text from each page
    const pages = textResult.pages.map((p, i) => ({
      pageNumber: i + 1,
      text: p.text,
      length: p.text.length,
    }));

    const fullText = pages.map(p => p.text).join("\n\n--- PAGE BREAK ---\n\n");

    // Look for key patterns
    const patterns = {
      hasPerClinicianSection: /Units\s+of\s+Dental\s+Activity\s+per\s+Clinician/i.test(fullText),
      hasCurrentFinancialYear: /Current\s+Financial\s+Year/i.test(fullText),
      performerNumbers: fullText.match(/\d{6}\s+[A-Z][A-Z\s]+/g) || [],
      allDecimalNumbers: fullText.match(/\d+\.\d{2}/g) || [],
    };

    // Find lines containing performer numbers we care about
    const targetPerformers = ["701874", "112376", "780995", "110271"];
    const performerLines: Record<string, string[]> = {};

    const lines = fullText.split(/[\n\r]+/);
    for (const perf of targetPerformers) {
      performerLines[perf] = lines
        .map((line, idx) => ({ line: line.trim(), idx }))
        .filter(({ line }) => line.includes(perf))
        .map(({ line, idx }) => `Line ${idx}: ${line}`);
    }

    return NextResponse.json({
      ok: true,
      fileName: pdf_file.name,
      fileSize: pdf_file.size,
      totalPages: pages.length,
      totalTextLength: fullText.length,
      pages: pages.map(p => ({ pageNumber: p.pageNumber, length: p.length, preview: p.text.substring(0, 500) })),
      fullText: fullText,
      patterns,
      performerLines,
    });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to parse PDF",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
