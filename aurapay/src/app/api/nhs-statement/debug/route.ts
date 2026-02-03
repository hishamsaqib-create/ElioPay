import { NextRequest, NextResponse } from "next/server";
import { getSession, isOwner } from "@/lib/auth";

// Debug endpoint to see what text is extracted from NHS PDF
// SECURITY: Only available to owners in production
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if production and not owner
  if (process.env.NODE_ENV === "production" && !isOwner(user)) {
    return NextResponse.json(
      { error: "Debug endpoints are restricted to owners in production" },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const pdf_file = formData.get("pdf_file") as File | null;

  if (!pdf_file || pdf_file.size === 0) {
    return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
  }

  // Limit file size to 10MB
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  if (pdf_file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 10MB." },
      { status: 400 }
    );
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
      _debug: {
        user: { id: user.id, email: user.email, role: user.role },
        environment: process.env.NODE_ENV,
      },
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
    console.error("[NHS-Debug] PDF parsing error:", error);
    return NextResponse.json({
      error: "Failed to parse PDF",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
