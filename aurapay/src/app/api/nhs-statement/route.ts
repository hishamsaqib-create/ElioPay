import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface UdaExtraction {
  dentistName: string;
  performerNumber?: string;
  udas: number;
  udaRate: number;
  nhsIncome: number;
}

interface NhsPeriodExtraction {
  periodStart?: string;
  periodEnd?: string;
}

// Extract NHS period dates from statement text
function extractNhsPeriodDates(text: string): NhsPeriodExtraction {
  const result: NhsPeriodExtraction = {};

  // Common patterns in NHS statements:
  // "Activity for January (18/12/2025 - 20/01/2026)"
  // "Period: 01/01/2026 - 31/01/2026"
  // "Statement Period: 1 January 2026 to 31 January 2026"
  // "From: 01/01/2026 To: 31/01/2026"
  // "Schedule Period 1st January 2026 - 31st January 2026"

  console.log("[NHS] Extracting period dates from text preview:", text.substring(0, 500));

  // Pattern 1: DD/MM/YYYY - DD/MM/YYYY (possibly in parentheses)
  // Matches: "(18/12/2025 - 20/01/2026)" or "18/12/2025 - 20/01/2026"
  const dateRangePattern1 = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
  const match1 = text.match(dateRangePattern1);
  if (match1) {
    const [, start, end] = match1;
    result.periodStart = convertToISODate(start);
    result.periodEnd = convertToISODate(end);
    console.log(`[NHS] Found period dates (pattern 1): ${start} to ${end} -> ${result.periodStart} to ${result.periodEnd}`);
    return result;
  }

  // Pattern 2: "1st January 2026" style dates
  const monthNames = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
  const dateRangePattern2 = new RegExp(
    `(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthNames}\\s+(\\d{4})\\s*[-–to]+\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthNames}\\s+(\\d{4})`,
    "i"
  );
  const match2 = text.match(dateRangePattern2);
  if (match2) {
    result.periodStart = parseEnglishDate(match2[0].split(/[-–to]+/)[0].trim());
    result.periodEnd = parseEnglishDate(match2[0].split(/[-–to]+/)[1].trim());
    return result;
  }

  // Pattern 3: Look for "Period" followed by dates
  const periodPattern = /period[:\s]+(.+?)(?:\n|$)/i;
  const periodMatch = text.match(periodPattern);
  if (periodMatch) {
    const periodText = periodMatch[1];
    const dates = periodText.match(/\d{1,2}\/\d{1,2}\/\d{4}/g);
    if (dates && dates.length >= 2) {
      result.periodStart = convertToISODate(dates[0]);
      result.periodEnd = convertToISODate(dates[1]);
    }
  }

  return result;
}

// Convert DD/MM/YYYY or DD/MM/YY to YYYY-MM-DD
function convertToISODate(dateStr: string): string {
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [day, month, yearStr] = parts;
    // Handle 2-digit years (assume 20xx for years 00-99)
    let year = yearStr;
    if (yearStr.length === 2) {
      const yearNum = parseInt(yearStr, 10);
      year = yearNum >= 50 ? `19${yearStr}` : `20${yearStr}`;
    }
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return dateStr;
}

// Parse English date format "1st January 2026"
function parseEnglishDate(dateStr: string): string {
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12"
  };

  const match = dateStr.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/i);
  if (match) {
    const [, day, month, year] = match;
    const monthNum = months[month.toLowerCase()];
    if (monthNum) {
      return `${year}-${monthNum}-${day.padStart(2, "0")}`;
    }
  }
  return dateStr;
}

// Extract UDAs from NHS Activity Statement text
// Format: "Units of Dental Activity per Clinician" section with performer numbers
// Each clinician has: "PERFORMER_NUM NAME" followed by "Current Financial Year YYYY/YY: VALUE"
function extractUdasFromText(text: string, nhsDentists: Dentist[]): UdaExtraction[] {
  const results: UdaExtraction[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  console.log("[NHS] Extracting UDAs from text, searching for dentists:", nhsDentists.map(d => `${d.name} (${d.performer_number})`));
  console.log("[NHS] Text preview (first 1000 chars):", text.substring(0, 1000));

  // Method 1: Parse NHS Activity Statement format (performer number based)
  // Look for sections like:
  // "701874 M AHMAD"
  // "Current Financial Year 2025/26    232.40"
  for (const dentist of nhsDentists) {
    if (!dentist.performer_number) continue;

    let foundUdas = 0;
    const perfNum = dentist.performer_number;

    // Find the line containing this performer number
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if line starts with or contains the performer number
      if (line.includes(perfNum)) {
        console.log(`[NHS] Found performer ${perfNum} (${dentist.name}) on line ${i}: "${line}"`);

        // Look at subsequent lines for "Current Financial Year" value
        for (let j = 1; j <= 5 && i + j < lines.length; j++) {
          const nextLine = lines[i + j];

          // Check if we hit another performer number (next clinician section)
          if (/^\d{5,6}\s+[A-Z]/.test(nextLine)) {
            console.log(`[NHS] Hit next clinician at line ${i + j}, stopping search for ${dentist.name}`);
            break;
          }

          // Look for "Current Financial Year" line with the UDA value
          if (/current\s+financial\s+year/i.test(nextLine)) {
            console.log(`[NHS] Found Current Financial Year line: "${nextLine}"`);

            // Case 1: Value is on the same line (format: "Current Financial Year 2025/26    232.40")
            // Look for a decimal number that's NOT part of the year pattern (2025/26)
            const sameLineMatch = nextLine.match(/\s(\d{1,3}(?:,\d{3})*\.\d{1,2})\s*$/);
            if (sameLineMatch) {
              const numStr = sameLineMatch[1].replace(/,/g, "");
              const num = parseFloat(numStr);
              if (num >= 0 && num <= 10000) {
                foundUdas = num;
                console.log(`[NHS] Extracted ${foundUdas} UDAs for ${dentist.name} from same line: "${nextLine}"`);
                break;
              }
            }

            // Case 2: Value is on the NEXT line (PDF text might split lines)
            if (!foundUdas && i + j + 1 < lines.length) {
              const valueLine = lines[i + j + 1];
              // Value line should be just a number (possibly with commas)
              const nextLineMatch = valueLine.match(/^(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})$/);
              if (nextLineMatch) {
                const numStr = nextLineMatch[1].replace(/,/g, "");
                const num = parseFloat(numStr);
                if (num >= 0 && num <= 10000) {
                  foundUdas = num;
                  console.log(`[NHS] Extracted ${foundUdas} UDAs for ${dentist.name} from next line: "${valueLine}"`);
                  break;
                }
              }
            }

            // Case 3: Fallback - find any decimal number on the line
            if (!foundUdas) {
              const anyNumberMatch = nextLine.match(/(\d+\.\d{1,2})/);
              if (anyNumberMatch) {
                const num = parseFloat(anyNumberMatch[1]);
                if (num >= 0.1 && num <= 10000) {
                  foundUdas = num;
                  console.log(`[NHS] Extracted ${foundUdas} UDAs for ${dentist.name} (fallback) from: "${nextLine}"`);
                  break;
                }
              }
            }
          }
        }

        if (foundUdas > 0) break;
      }
    }

    if (foundUdas > 0) {
      results.push({
        dentistName: dentist.name,
        performerNumber: perfNum,
        udas: foundUdas,
        udaRate: dentist.uda_rate,
        nhsIncome: Math.round(foundUdas * dentist.uda_rate * 100) / 100,
      });
    } else {
      console.log(`[NHS] No UDAs found for ${dentist.name} (${perfNum})`);
    }
  }

  // Method 2: Fallback - search by name patterns if performer number not found
  for (const dentist of nhsDentists) {
    // Skip if already found via performer number
    if (results.some(r => r.dentistName === dentist.name)) continue;

    const nameParts = dentist.name.toLowerCase().split(" ");
    const lastName = nameParts[nameParts.length - 1];
    const firstInitial = nameParts[0][0];

    // Search patterns: "KAPOOR", "M AHMAD", "PE THROW"
    const patterns = [
      lastName.toUpperCase(),
      `${firstInitial} ${lastName}`.toUpperCase(),
      `${firstInitial.toUpperCase()}${firstInitial.toUpperCase()} ${lastName.toUpperCase()}`, // PE THROW pattern
    ];

    let foundUdas = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toUpperCase();

      // Check if line contains any name pattern (typically after a performer number)
      const hasNameMatch = patterns.some(p => line.includes(p));
      const hasPerformerFormat = /^\d{5,6}\s+/.test(line);

      if (hasNameMatch && hasPerformerFormat) {
        console.log(`[NHS] Found name match for ${dentist.name} on line: "${lines[i]}"`);

        // Look for Current Financial Year value in subsequent lines
        for (let j = 1; j <= 5 && i + j < lines.length; j++) {
          const nextLine = lines[i + j];

          if (/^\d{5,6}\s+[A-Z]/.test(nextLine)) break;

          if (/current\s+financial\s+year/i.test(nextLine)) {
            const numberMatch = nextLine.match(/(\d+\.\d{1,2})\s*$/);
            if (numberMatch) {
              foundUdas = parseFloat(numberMatch[1]);
              console.log(`[NHS] Extracted ${foundUdas} UDAs for ${dentist.name} (by name)`);
              break;
            }
          }
        }

        if (foundUdas > 0) break;
      }
    }

    if (foundUdas > 0) {
      results.push({
        dentistName: dentist.name,
        performerNumber: dentist.performer_number || undefined,
        udas: foundUdas,
        udaRate: dentist.uda_rate,
        nhsIncome: Math.round(foundUdas * dentist.uda_rate * 100) / 100,
      });
    }
  }

  console.log(`[NHS] Total extractions: ${results.length}`, results);
  return results;
}

// Parse PDF and extract text
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    // pdf-parse v2 uses PDFParse class with LoadParameters
    const { PDFParse } = await import("pdf-parse");
    const pdfParser = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await pdfParser.getText();
    const fullText = textResult.pages.map(p => p.text).join("\n");
    console.log(`[NHS] Extracted ${fullText.length} characters from PDF`);
    return fullText;
  } catch (error) {
    console.error("[NHS] PDF parsing error:", error);
    throw new Error("Failed to parse PDF file");
  }
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const period_id_raw = formData.get("period_id");
  const pdf_file = formData.get("pdf_file") as File | null;
  const statement_text = formData.get("statement_text") as string;
  const manual_udas = formData.get("manual_udas") as string;
  let nhs_period_start = formData.get("nhs_period_start") as string;
  let nhs_period_end = formData.get("nhs_period_end") as string;

  if (!period_id_raw) {
    return NextResponse.json({ error: "period_id is required" }, { status: 400 });
  }

  const period_id = parseInt(period_id_raw as string, 10);
  if (isNaN(period_id)) {
    return NextResponse.json({ error: "period_id must be a valid number" }, { status: 400 });
  }

  const db = await getDb();

  // Get NHS dentists from database
  const dentistsResult = await db.execute("SELECT * FROM dentists WHERE is_nhs = 1 AND active = 1");
  const nhsDentists = rowsTo<Dentist>(dentistsResult.rows);

  let extractions: UdaExtraction[] = [];
  let extractedText = "";

  // If PDF file provided, extract text from it
  if (pdf_file && pdf_file.size > 0) {
    console.log(`[NHS] Processing PDF file: ${pdf_file.name}, size: ${pdf_file.size} bytes`);
    try {
      const buffer = Buffer.from(await pdf_file.arrayBuffer());
      extractedText = await extractTextFromPdf(buffer);

      // Try to extract period dates from the PDF
      if (!nhs_period_start || !nhs_period_end) {
        const periodDates = extractNhsPeriodDates(extractedText);
        if (periodDates.periodStart) nhs_period_start = periodDates.periodStart;
        if (periodDates.periodEnd) nhs_period_end = periodDates.periodEnd;
        console.log(`[NHS] Extracted period dates: ${nhs_period_start} to ${nhs_period_end}`);
      }

      // Extract UDAs from the PDF text
      extractions = extractUdasFromText(extractedText, nhsDentists);
    } catch (error) {
      console.error("[NHS] PDF processing error:", error);
      return NextResponse.json({
        error: "Failed to process PDF file",
        details: error instanceof Error ? error.message : "Unknown error"
      }, { status: 400 });
    }
  }

  // If manual UDAs provided, use those (override PDF extractions)
  if (manual_udas) {
    try {
      const manualData = JSON.parse(manual_udas);
      const manualExtractions: UdaExtraction[] = [];
      for (const dentist of nhsDentists) {
        const udas = manualData[dentist.name];
        if (udas !== undefined && udas > 0) {
          manualExtractions.push({
            dentistName: dentist.name,
            performerNumber: dentist.performer_number || undefined,
            udas: parseFloat(udas),
            udaRate: dentist.uda_rate,
            nhsIncome: Math.round(parseFloat(udas) * dentist.uda_rate * 100) / 100,
          });
        }
      }
      // Manual entries override PDF extractions for the same dentist
      for (const manual of manualExtractions) {
        const idx = extractions.findIndex(e => e.dentistName === manual.dentistName);
        if (idx >= 0) {
          extractions[idx] = manual;
        } else {
          extractions.push(manual);
        }
      }
    } catch (e) {
      console.error("[NHS] Failed to parse manual UDAs:", e);
    }
  }

  // If statement text provided and no extractions yet, try to extract from text
  if (statement_text && extractions.length === 0) {
    extractions = extractUdasFromText(statement_text, nhsDentists);
    // Also try to extract period dates
    if (!nhs_period_start || !nhs_period_end) {
      const periodDates = extractNhsPeriodDates(statement_text);
      if (periodDates.periodStart) nhs_period_start = periodDates.periodStart;
      if (periodDates.periodEnd) nhs_period_end = periodDates.periodEnd;
    }
  }

  // Update NHS period dates on the pay_period if provided
  if (nhs_period_start || nhs_period_end) {
    await db.execute({
      sql: `UPDATE pay_periods SET nhs_period_start = ?, nhs_period_end = ? WHERE id = ?`,
      args: [nhs_period_start || null, nhs_period_end || null, period_id],
    });
    console.log(`[NHS] Updated period dates: ${nhs_period_start} to ${nhs_period_end}`);
  }

  // Update payslip entries with UDA values and store NHS period info
  const updates: string[] = [];

  for (const extraction of extractions) {
    const dentist = nhsDentists.find(d =>
      d.name.toLowerCase() === extraction.dentistName.toLowerCase() ||
      (d.performer_number && d.performer_number === extraction.performerNumber)
    );

    if (dentist) {
      // Store NHS period info per entry as well
      const nhsPeriodInfo = JSON.stringify({
        period_start: nhs_period_start || null,
        period_end: nhs_period_end || null,
        udas: extraction.udas,
        extracted_from: pdf_file ? "pdf" : statement_text ? "text" : "manual",
      });

      await db.execute({
        sql: `UPDATE payslip_entries SET nhs_udas = ?, nhs_period_json = ? WHERE period_id = ? AND dentist_id = ?`,
        args: [extraction.udas, nhsPeriodInfo, period_id, dentist.id],
      });
      updates.push(`${dentist.name}: ${extraction.udas} UDAs = £${extraction.nhsIncome.toFixed(2)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    message: `Updated NHS UDAs for ${updates.length} dentist(s)`,
    extractions,
    updates,
    period: {
      start: nhs_period_start || null,
      end: nhs_period_end || null,
    },
    extractedText: extractedText.length > 0 ? extractedText.substring(0, 500) + "..." : null,
  });
}

// GET endpoint to return NHS dentist configuration
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const dentistsResult = await db.execute("SELECT * FROM dentists WHERE is_nhs = 1 AND active = 1");
  const nhsDentists = rowsTo<Dentist>(dentistsResult.rows);

  return NextResponse.json({
    nhsDentists: nhsDentists.map(d => ({
      id: d.id,
      name: d.name,
      performer_number: d.performer_number,
      uda_rate: d.uda_rate,
    })),
  });
}
