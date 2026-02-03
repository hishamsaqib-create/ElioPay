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

    // Extract text using unpdf (same as main extraction code)
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(buffer));

    // result.text can be string or string[] depending on version
    const fullText = Array.isArray(result.text) ? result.text.join("\n") : (result.text || "");

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

    // Find the per-clinician section
    const perClinicianMatch = fullText.match(/Units\s+of\s+Dental\s+Activity\s+per\s+Clinician/i);
    const perClinicianIndex = perClinicianMatch ? fullText.indexOf(perClinicianMatch[0]) : -1;
    const clinicianSection = perClinicianIndex >= 0 ? fullText.substring(perClinicianIndex) : null;

    return NextResponse.json({
      ok: true,
      fileName: pdf_file.name,
      fileSize: pdf_file.size,
      totalPages: result.totalPages,
      totalTextLength: fullText.length,
      fullText: fullText,
      patterns,
      performerLines,
      perClinicianSectionFound: perClinicianIndex >= 0,
      perClinicianSectionIndex: perClinicianIndex,
      clinicianSectionPreview: clinicianSection ? clinicianSection.substring(0, 2000) : null,
    });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to parse PDF",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
