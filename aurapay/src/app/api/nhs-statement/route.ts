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
  // "Period: 01/01/2026 - 31/01/2026"
  // "Statement Period: 1 January 2026 to 31 January 2026"
  // "From: 01/01/2026 To: 31/01/2026"
  // "Schedule Period 1st January 2026 - 31st January 2026"

  // Pattern 1: DD/MM/YYYY - DD/MM/YYYY
  const dateRangePattern1 = /(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–to]+\s*(\d{1,2}\/\d{1,2}\/\d{4})/i;
  const match1 = text.match(dateRangePattern1);
  if (match1) {
    const [, start, end] = match1;
    result.periodStart = convertToISODate(start);
    result.periodEnd = convertToISODate(end);
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

// Convert DD/MM/YYYY to YYYY-MM-DD
function convertToISODate(dateStr: string): string {
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts;
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

// Extract UDAs from NHS statement text for dentists from database
function extractUdasFromText(text: string, nhsDentists: Dentist[]): UdaExtraction[] {
  const results: UdaExtraction[] = [];
  const lines = text.split("\n");

  console.log("[NHS] Extracting UDAs from text, searching for dentists:", nhsDentists.map(d => d.name));

  for (const dentist of nhsDentists) {
    // Build search patterns for this dentist
    const namePatterns = [
      dentist.name.toLowerCase(),
      dentist.name.split(" ").reverse().join(" ").toLowerCase(), // "Throw Peter"
      dentist.name.split(" ").map(n => n[0]).join("").toLowerCase(), // Initials
    ];

    if (dentist.performer_number) {
      namePatterns.push(dentist.performer_number);
    }

    let foundUdas = 0;
    let foundLine = "";

    // Search line by line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      const originalLine = lines[i];

      // Check if this line contains the dentist
      const hasMatch = namePatterns.some(pattern => pattern && line.includes(pattern));

      if (hasMatch) {
        console.log(`[NHS] Found match for ${dentist.name} on line: ${originalLine.substring(0, 100)}`);

        // Look at this line and following lines for UDA values
        const searchLines = [originalLine];
        for (let j = 1; j <= 3 && i + j < lines.length; j++) {
          searchLines.push(lines[i + j]);
        }

        const searchText = searchLines.join(" ");

        // Try different patterns to find UDA values

        // Pattern 1: Look for "UDA" near a number
        const udaPattern = /(\d+(?:\.\d+)?)\s*(?:UDA|uda)/i;
        const udaMatch = searchText.match(udaPattern);
        if (udaMatch) {
          const num = parseFloat(udaMatch[1]);
          if (num >= 0.1 && num <= 5000) {
            foundUdas = num;
            foundLine = searchText;
          }
        }

        // Pattern 2: Look for numbers after performer number (table format)
        if (!foundUdas && dentist.performer_number) {
          const perfPattern = new RegExp(dentist.performer_number + "[\\s,]+(\\d+(?:\\.\\d+)?)", "i");
          const perfMatch = searchText.match(perfPattern);
          if (perfMatch) {
            const num = parseFloat(perfMatch[1]);
            if (num >= 0.1 && num <= 5000) {
              foundUdas = num;
              foundLine = searchText;
            }
          }
        }

        // Pattern 3: Look for decimal numbers in a reasonable range on the same line
        if (!foundUdas) {
          const numbers = searchText.match(/\d+\.\d{1,2}/g);
          if (numbers) {
            for (const numStr of numbers) {
              const num = parseFloat(numStr);
              // UDAs are typically between 0.1 and 500 for a month
              if (num >= 0.1 && num <= 500 && !searchText.includes(`£${numStr}`)) {
                foundUdas = num;
                foundLine = searchText;
                break;
              }
            }
          }
        }

        if (foundUdas > 0) break;
      }
    }

    if (foundUdas > 0) {
      console.log(`[NHS] Extracted ${foundUdas} UDAs for ${dentist.name}`);
      results.push({
        dentistName: dentist.name,
        performerNumber: dentist.performer_number || undefined,
        udas: foundUdas,
        udaRate: dentist.uda_rate,
        nhsIncome: Math.round(foundUdas * dentist.uda_rate * 100) / 100,
      });
    }
  }

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
