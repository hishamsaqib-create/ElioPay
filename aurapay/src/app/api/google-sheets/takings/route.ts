import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Private takings log spreadsheet IDs for each dentist
const PRIVATE_TAKINGS_LOGS: Record<string, string> = {
  "Moneeb Ahmad": "1Y-cSU-8rZHr3uHswaZjY2MA0umZT3rxcws6nvwGIMFo",
  "Peter Throw": "1vdKw3_hDWHaenh7OUjrwTdvN-zvf1a8dR45K08HLxr0",
  "Priyanka Kapoor": "13EDcD6zfOdrBwUzQmn9rPXboCTUFeYiuaRHO-gCrjlo",
  "Zeeshan Abbas": "1NWwKzMO7B12WjDnkp-MiKF4j1ge4T6yICSE1anKJhxQ",
  "Ankush Patel": "111HtVp2ShaJm9fxzuaRHNGBWUGRq831joUfawCfevUg",
  // Hani Dalati - no takings log (trusts practice)
  // Hisham Saqib - no takings log (owner)
};

interface SheetRow {
  patientName: string;
  date: string;
  amount: number;
  treatment?: string;
}

// Fetch data from Google Sheets using the public API (for sheets shared with "anyone with link")
// Or using API key if available
async function fetchGoogleSheetData(spreadsheetId: string, month: number, year: number): Promise<SheetRow[]> {
  // Try to use Google Sheets API key if available
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

  // Use the public CSV export URL (works for sheets shared with "anyone with link")
  // Try multiple common sheet names/structures
  const sheetNames = ["Sheet1", "Takings", "Private Takings", "Log", "Main", "Data"];

  let allRows: SheetRow[] = [];

  for (const sheetName of sheetNames) {
    try {
      let url: string;

      if (apiKey) {
        // Use official API with key
        url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}?key=${apiKey}`;
      } else {
        // Use public CSV export (requires sheet to be shared publicly)
        url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
      }

      const res = await fetch(url);

      if (!res.ok) {
        console.log(`[GoogleSheets] Sheet "${sheetName}" not found or not accessible`);
        continue;
      }

      const text = await res.text();

      if (apiKey) {
        // Parse JSON response from official API
        const data = JSON.parse(text);
        const values = data.values || [];
        allRows = parseSheetValues(values, month, year);
      } else {
        // Parse CSV response
        allRows = parseCsvData(text, month, year);
      }

      if (allRows.length > 0) {
        console.log(`[GoogleSheets] Found ${allRows.length} rows in sheet "${sheetName}"`);
        break;
      }
    } catch (e) {
      console.log(`[GoogleSheets] Error fetching sheet "${sheetName}":`, e);
      continue;
    }
  }

  return allRows;
}

// Parse sheet values (from API response)
function parseSheetValues(values: string[][], month: number, year: number): SheetRow[] {
  const rows: SheetRow[] = [];

  // Find header row (look for "Patient", "Name", "Date", "Amount" etc.)
  let headerIndex = -1;
  let nameCol = -1;
  let dateCol = -1;
  let amountCol = -1;
  let treatmentCol = -1;

  for (let i = 0; i < Math.min(10, values.length); i++) {
    const row = values[i] || [];
    const lowerRow = row.map(cell => (cell || "").toString().toLowerCase().trim());

    // Look for header columns
    for (let j = 0; j < lowerRow.length; j++) {
      const cell = lowerRow[j];
      if (cell.includes("patient") || cell.includes("name")) {
        nameCol = j;
        headerIndex = i;
      }
      if (cell.includes("date")) {
        dateCol = j;
        headerIndex = i;
      }
      if (cell.includes("amount") || cell.includes("total") || cell.includes("fee") || cell === "£") {
        amountCol = j;
        headerIndex = i;
      }
      if (cell.includes("treatment") || cell.includes("procedure") || cell.includes("description")) {
        treatmentCol = j;
        headerIndex = i;
      }
    }

    if (nameCol >= 0 && dateCol >= 0 && amountCol >= 0) break;
  }

  // Default columns if headers not found
  if (nameCol < 0) nameCol = 0;
  if (dateCol < 0) dateCol = 1;
  if (amountCol < 0) amountCol = 2;
  if (treatmentCol < 0) treatmentCol = 3;

  const startRow = headerIndex >= 0 ? headerIndex + 1 : 0;

  // Parse data rows
  for (let i = startRow; i < values.length; i++) {
    const row = values[i] || [];
    if (row.length < Math.max(nameCol, dateCol, amountCol) + 1) continue;

    const patientName = (row[nameCol] || "").toString().trim();
    const dateStr = (row[dateCol] || "").toString().trim();
    const amountStr = (row[amountCol] || "").toString().trim();
    const treatment = treatmentCol >= 0 && row[treatmentCol] ? row[treatmentCol].toString().trim() : undefined;

    if (!patientName || !dateStr) continue;

    // Parse amount (remove £ sign and commas)
    const amount = parseFloat(amountStr.replace(/[£,]/g, "")) || 0;
    if (amount <= 0) continue;

    // Parse date and check if it's in the target month
    const parsedDate = parseDate(dateStr);
    if (!parsedDate) continue;

    const [pYear, pMonth] = parsedDate.split("-").map(Number);
    if (pMonth === month && pYear === year) {
      rows.push({ patientName, date: parsedDate, amount, treatment });
    }
  }

  return rows;
}

// Parse CSV data
function parseCsvData(csvText: string, month: number, year: number): SheetRow[] {
  const lines = csvText.split("\n").filter(line => line.trim());
  const values = lines.map(line => {
    // Parse CSV properly (handle quoted fields)
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());

    return cells;
  });

  return parseSheetValues(values, month, year);
}

// Parse various date formats
function parseDate(dateStr: string): string | null {
  // Try DD/MM/YYYY
  let match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    let year = parseInt(match[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Try YYYY-MM-DD
  match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  // Try DD-MM-YYYY
  match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    let year = parseInt(match[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Try DD Month YYYY or DD Mon YYYY
  const monthNames: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  const textMatch = dateStr.toLowerCase().match(/^(\d{1,2})\s*([a-z]+)\s*(\d{2,4})$/);
  if (textMatch) {
    const day = parseInt(textMatch[1]);
    const monthNum = monthNames[textMatch[2]];
    let year = parseInt(textMatch[3]);
    if (year < 100) year += 2000;
    if (monthNum) {
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

interface DentistLogEntry {
  patientName: string;
  date: string;
  amount: number;
  treatment?: string;
}

interface Discrepancy {
  type: "invoiced_not_paid" | "partial_payment" | "log_mismatch" | "in_log_not_system" | "in_system_not_log";
  patientName: string;
  patientId?: string;
  invoiceId?: string;
  invoicedAmount: number;
  paidAmount: number;
  logAmount?: number;
  date: string;
  notes: string;
}

interface PrivatePatient {
  name: string;
  date: string;
  amount: number;
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entry_id, dentist_name, period_id } = await req.json();

  if (!entry_id || !dentist_name || !period_id) {
    return NextResponse.json({ error: "entry_id, dentist_name, and period_id are required" }, { status: 400 });
  }

  // Get spreadsheet ID for this dentist
  const spreadsheetId = PRIVATE_TAKINGS_LOGS[dentist_name];
  if (!spreadsheetId) {
    return NextResponse.json({
      error: `No private takings log configured for ${dentist_name}`,
      note: "This dentist may not have a Google Sheets log"
    }, { status: 404 });
  }

  const db = await getDb();

  // Get the period to know the month/year
  const periodResult = await db.execute({ sql: "SELECT * FROM pay_periods WHERE id = ?", args: [period_id] });
  if (periodResult.rows.length === 0) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  const period = rowTo<{ id: number; month: number; year: number }>(periodResult.rows[0]);

  // Get the entry
  const entryResult = await db.execute({
    sql: "SELECT * FROM payslip_entries WHERE id = ?",
    args: [entry_id],
  });
  if (entryResult.rows.length === 0) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  const entry = entryResult.rows[0];

  try {
    console.log(`[GoogleSheets] Fetching takings log for ${dentist_name} (${period.month}/${period.year})`);
    console.log(`[GoogleSheets] Spreadsheet ID: ${spreadsheetId}`);

    // Fetch data from Google Sheets
    const sheetData = await fetchGoogleSheetData(spreadsheetId, period.month, period.year);

    if (sheetData.length === 0) {
      return NextResponse.json({
        ok: true,
        message: `No entries found in ${dentist_name}'s private log for ${period.month}/${period.year}`,
        count: 0,
      });
    }

    // Store as dentist log
    const dentistLog: DentistLogEntry[] = sheetData.map(row => ({
      patientName: row.patientName,
      date: row.date,
      amount: row.amount,
      treatment: row.treatment,
    }));

    // Cross-reference with system patients to find discrepancies
    const systemPatients: PrivatePatient[] = JSON.parse(String(entry.private_patients_json || "[]"));
    const existingDiscrepancies: Discrepancy[] = JSON.parse(String(entry.discrepancies_json || "[]"));

    // Create name lookup maps (fuzzy matching)
    const normalizeNameForMatch = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

    // Build map of system patients by normalized name
    const systemPatientsMap = new Map<string, PrivatePatient[]>();
    for (const p of systemPatients) {
      const normalized = normalizeNameForMatch(p.name);
      if (!systemPatientsMap.has(normalized)) {
        systemPatientsMap.set(normalized, []);
      }
      systemPatientsMap.get(normalized)!.push(p);
    }

    // Check each log entry against system
    const newDiscrepancies: Discrepancy[] = [];
    const matchedLogEntries = new Set<number>();
    const matchedSystemPatients = new Set<string>();

    for (let i = 0; i < dentistLog.length; i++) {
      const logEntry = dentistLog[i];
      const normalizedName = normalizeNameForMatch(logEntry.patientName);
      const systemMatches = systemPatientsMap.get(normalizedName) || [];

      // Try to find a matching amount and date
      let matched = false;
      for (const systemPatient of systemMatches) {
        const amountDiff = Math.abs(systemPatient.amount - logEntry.amount);
        const amountMatch = amountDiff < 1; // Within £1
        const dateMatch = systemPatient.date === logEntry.date;

        if (amountMatch && dateMatch) {
          matchedLogEntries.add(i);
          matchedSystemPatients.add(`${systemPatient.name}-${systemPatient.date}-${systemPatient.amount}`);
          matched = true;
          break;
        }

        // Partial match - same patient but different amount
        if (dateMatch && !amountMatch) {
          newDiscrepancies.push({
            type: "log_mismatch",
            patientName: logEntry.patientName,
            invoicedAmount: systemPatient.amount,
            paidAmount: systemPatient.amount,
            logAmount: logEntry.amount,
            date: logEntry.date,
            notes: `Log shows £${logEntry.amount.toFixed(2)}, system shows £${systemPatient.amount.toFixed(2)}`,
          });
          matchedLogEntries.add(i);
          matchedSystemPatients.add(`${systemPatient.name}-${systemPatient.date}-${systemPatient.amount}`);
          matched = true;
          break;
        }
      }

      // Entry in log but not in system
      if (!matched) {
        newDiscrepancies.push({
          type: "in_log_not_system",
          patientName: logEntry.patientName,
          invoicedAmount: 0,
          paidAmount: 0,
          logAmount: logEntry.amount,
          date: logEntry.date,
          notes: `In dentist log (£${logEntry.amount.toFixed(2)}) but not found in Dentally`,
        });
      }
    }

    // Check for system entries not in log
    for (const systemPatient of systemPatients) {
      const key = `${systemPatient.name}-${systemPatient.date}-${systemPatient.amount}`;
      if (!matchedSystemPatients.has(key)) {
        const normalizedName = normalizeNameForMatch(systemPatient.name);
        // Check if any log entry has this name (might be different date/amount)
        const hasAnyMatch = dentistLog.some(log =>
          normalizeNameForMatch(log.patientName) === normalizedName
        );

        if (!hasAnyMatch) {
          newDiscrepancies.push({
            type: "in_system_not_log",
            patientName: systemPatient.name,
            invoicedAmount: systemPatient.amount,
            paidAmount: systemPatient.amount,
            date: systemPatient.date,
            notes: `In Dentally (£${systemPatient.amount.toFixed(2)}) but not in dentist's log`,
          });
        }
      }
    }

    // Merge with existing discrepancies (avoid duplicates)
    const existingTypes = new Set(
      existingDiscrepancies.map(d => `${d.type}-${d.patientName}-${d.date}`)
    );
    const mergedDiscrepancies = [
      ...existingDiscrepancies,
      ...newDiscrepancies.filter(d => !existingTypes.has(`${d.type}-${d.patientName}-${d.date}`))
    ];

    // Update the entry
    await db.execute({
      sql: `UPDATE payslip_entries SET
        dentist_log_json = ?,
        discrepancies_json = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      args: [
        JSON.stringify(dentistLog),
        JSON.stringify(mergedDiscrepancies),
        entry_id,
      ],
    });

    return NextResponse.json({
      ok: true,
      message: `Imported ${dentistLog.length} entries from ${dentist_name}'s Google Sheets log. Found ${newDiscrepancies.length} new discrepancies.`,
      count: dentistLog.length,
      discrepancies: newDiscrepancies.length,
      logEntries: dentistLog,
    });
  } catch (err: unknown) {
    console.error("[GoogleSheets] Error:", err);
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Google Sheets fetch failed: ${errMsg}` }, { status: 500 });
  }
}
