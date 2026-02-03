import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";

// NHS dentists and their UDA rates
const NHS_DENTISTS: Record<string, { performer_number?: string; uda_rate: number }> = {
  "Peter Throw": { performer_number: "780995", uda_rate: 16 },
  "Priyanka Kapoor": { performer_number: "112376", uda_rate: 15 },
  "Moneeb Ahmad": { performer_number: "701874", uda_rate: 15 },
};

interface UdaExtraction {
  dentistName: string;
  performerNumber?: string;
  udas: number;
  udaRate: number;
  nhsIncome: number;
}

// Parse NHS statement text to extract UDAs
function parseNhsStatement(text: string): UdaExtraction[] {
  const results: UdaExtraction[] = [];
  const lines = text.split("\n");

  // Look for patterns like "Peter Throw" or performer numbers followed by UDA values
  // NHS statements typically show: Performer Name | Performer Number | UDAs Claimed | UDAs Approved | Value

  for (const [dentistName, config] of Object.entries(NHS_DENTISTS)) {
    // Try to find this dentist in the text
    const namePatterns = [
      dentistName.toLowerCase(),
      dentistName.split(" ").reverse().join(" ").toLowerCase(), // "Throw Peter"
      config.performer_number,
    ].filter(Boolean);

    let foundUdas = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      const originalLine = lines[i];

      // Check if this line contains the dentist
      const hasMatch = namePatterns.some(pattern => pattern && line.includes(pattern.toLowerCase()));

      if (hasMatch) {
        // Try to extract UDA numbers from this line and surrounding lines
        // Look for patterns like: 123.45 UDAs, 123 UDA, UDA: 123, etc.

        // Check this line and next few lines for numbers
        const searchLines = [originalLine];
        if (i + 1 < lines.length) searchLines.push(lines[i + 1]);
        if (i + 2 < lines.length) searchLines.push(lines[i + 2]);

        const searchText = searchLines.join(" ");

        // Extract numbers that could be UDAs (typically between 0 and 5000)
        const numbers = searchText.match(/\d+(?:\.\d+)?/g);
        if (numbers) {
          for (const numStr of numbers) {
            const num = parseFloat(numStr);
            // UDAs are typically between 1 and 5000, and often have decimal places
            if (num >= 1 && num <= 5000 && !searchText.includes(`£${numStr}`)) {
              // Check if this looks like a UDA value (not a date, not currency)
              const context = searchText.slice(Math.max(0, searchText.indexOf(numStr) - 10), searchText.indexOf(numStr) + numStr.length + 10);
              if (!context.includes("/") && !context.includes("£")) {
                foundUdas = Math.max(foundUdas, num);
              }
            }
          }
        }
      }
    }

    if (foundUdas > 0) {
      results.push({
        dentistName,
        performerNumber: config.performer_number,
        udas: foundUdas,
        udaRate: config.uda_rate,
        nhsIncome: Math.round(foundUdas * config.uda_rate * 100) / 100,
      });
    }
  }

  return results;
}

// Try different extraction patterns for NHS statement
function extractUdasFromText(text: string): UdaExtraction[] {
  const results: UdaExtraction[] = [];

  // Pattern 1: Table format with columns
  // Look for rows with performer info and UDA values

  // Pattern 2: Look for specific section headers
  const sectionPatterns = [
    /performer.*?uda/i,
    /nhs.*?activity/i,
    /uda.*?claim/i,
    /dental.*?activity/i,
  ];

  // Pattern 3: Look for UDA totals per performer
  // Example: "Dr Peter Throw - 156.75 UDAs"

  for (const [dentistName, config] of Object.entries(NHS_DENTISTS)) {
    // Create regex patterns for this dentist
    const nameRegex = new RegExp(
      dentistName.replace(/\s+/g, "\\s*") + "[^\\d]*(\\d+(?:\\.\\d+)?)",
      "i"
    );

    const performerRegex = config.performer_number
      ? new RegExp(config.performer_number + "[^\\d]*(\\d+(?:\\.\\d+)?)", "i")
      : null;

    let udas = 0;

    // Try to match by name
    const nameMatch = text.match(nameRegex);
    if (nameMatch && nameMatch[1]) {
      const num = parseFloat(nameMatch[1]);
      if (num >= 0.1 && num <= 5000) {
        udas = num;
      }
    }

    // Try to match by performer number
    if (!udas && performerRegex) {
      const perfMatch = text.match(performerRegex);
      if (perfMatch && perfMatch[1]) {
        const num = parseFloat(perfMatch[1]);
        if (num >= 0.1 && num <= 5000) {
          udas = num;
        }
      }
    }

    if (udas > 0) {
      results.push({
        dentistName,
        performerNumber: config.performer_number,
        udas,
        udaRate: config.uda_rate,
        nhsIncome: Math.round(udas * config.uda_rate * 100) / 100,
      });
    }
  }

  // Also try the line-by-line parsing
  if (results.length === 0) {
    return parseNhsStatement(text);
  }

  return results;
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const period_id_raw = formData.get("period_id");
  const statement_text = formData.get("statement_text") as string;
  const manual_udas = formData.get("manual_udas") as string; // JSON: { "dentist_name": uda_value }

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

  // If manual UDAs provided, use those
  if (manual_udas) {
    try {
      const manualData = JSON.parse(manual_udas);
      for (const dentist of nhsDentists) {
        const udas = manualData[dentist.name];
        if (udas !== undefined && udas > 0) {
          extractions.push({
            dentistName: dentist.name,
            performerNumber: dentist.performer_number || undefined,
            udas: parseFloat(udas),
            udaRate: dentist.uda_rate,
            nhsIncome: Math.round(parseFloat(udas) * dentist.uda_rate * 100) / 100,
          });
        }
      }
    } catch (e) {
      console.error("[NHS] Failed to parse manual UDAs:", e);
    }
  }

  // If statement text provided, try to extract UDAs
  if (statement_text && extractions.length === 0) {
    extractions = extractUdasFromText(statement_text);
  }

  // Update payslip entries with UDA values
  const updates: string[] = [];

  for (const extraction of extractions) {
    // Find the dentist
    const dentist = nhsDentists.find(d =>
      d.name.toLowerCase() === extraction.dentistName.toLowerCase() ||
      (d.performer_number && d.performer_number === extraction.performerNumber)
    );

    if (dentist) {
      // Update the payslip entry
      await db.execute({
        sql: `UPDATE payslip_entries SET nhs_udas = ? WHERE period_id = ? AND dentist_id = ?`,
        args: [extraction.udas, period_id, dentist.id],
      });
      updates.push(`${dentist.name}: ${extraction.udas} UDAs = £${extraction.nhsIncome.toFixed(2)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    message: `Updated NHS UDAs for ${updates.length} dentist(s)`,
    extractions,
    updates,
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
