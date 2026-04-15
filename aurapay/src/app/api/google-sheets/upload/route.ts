import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface SheetRow {
  patientName: string;
  date: string;
  amount: number;
  treatment?: string;
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
  resolved?: boolean;
}

interface PrivatePatient {
  name: string;
  date: string;
  amount: number;
  amountPaid?: number;
  status?: string;
}

// Parse various date formats to YYYY-MM-DD
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

// Parse CSV text into rows
function parseCsvText(csvText: string, month: number, year: number): SheetRow[] {
  const lines = csvText.split("\n").filter(line => line.trim());
  const values = lines.map(line => {
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

// Parse sheet values array into typed rows
function parseSheetValues(values: string[][], month: number, year: number): SheetRow[] {
  const rows: SheetRow[] = [];

  // Find header row
  let headerIndex = -1;
  let nameCol = -1;
  let dateCol = -1;
  let amountCol = -1;
  let treatmentCol = -1;

  for (let i = 0; i < Math.min(20, values.length); i++) {
    const row = values[i] || [];
    const lowerRow = row.map(cell => (cell || "").toString().toLowerCase().trim());

    let foundDate = -1, foundName = -1, foundAmount = -1, foundTreatment = -1;

    for (let j = 0; j < lowerRow.length; j++) {
      const cell = lowerRow[j];
      if (cell.includes("patient") || cell === "name" || cell.includes("initials")) {
        foundName = j;
      }
      if (cell === "date" || cell.includes("date")) {
        foundDate = j;
      }
      if (cell.includes("fee") || cell.includes("invoiced") || cell.includes("amount") || cell.includes("total") || cell === "£") {
        foundAmount = j;
      }
      if (cell.includes("treatment") || cell.includes("procedure") || cell.includes("description") || cell.includes("completed")) {
        foundTreatment = j;
      }
    }

    if (foundDate >= 0 && (foundName >= 0 || foundAmount >= 0)) {
      headerIndex = i;
      dateCol = foundDate;
      nameCol = foundName >= 0 ? foundName : 1;
      amountCol = foundAmount >= 0 ? foundAmount : 3;
      treatmentCol = foundTreatment >= 0 ? foundTreatment : 2;
      break;
    }
  }

  // Default columns if headers not found
  if (nameCol < 0) nameCol = 0;
  if (dateCol < 0) dateCol = 1;
  if (amountCol < 0) amountCol = 2;
  if (treatmentCol < 0) treatmentCol = 3;

  const startRow = headerIndex >= 0 ? headerIndex + 1 : 0;

  for (let i = startRow; i < values.length; i++) {
    const row = values[i] || [];
    if (row.length < Math.max(nameCol, dateCol, amountCol) + 1) continue;

    const patientName = (row[nameCol] || "").toString().trim();
    const dateStr = (row[dateCol] || "").toString().trim();
    const amountStr = (row[amountCol] || "").toString().trim();
    const treatment = treatmentCol >= 0 && row[treatmentCol] ? row[treatmentCol].toString().trim() : undefined;

    if (!patientName || !dateStr) continue;
    if (patientName.toLowerCase().includes("total") || patientName.toLowerCase().includes("gross")) continue;

    const amount = parseFloat(amountStr.replace(/[£,]/g, "")) || 0;
    if (amount <= 0) continue;

    const parsedDate = parseDate(dateStr);
    if (!parsedDate) continue;

    const [pYear, pMonth] = parsedDate.split("-").map(Number);
    if (pMonth === month && pYear === year) {
      rows.push({ patientName, date: parsedDate, amount, treatment });
    }
  }

  return rows;
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const entryId = formData.get("entry_id") as string;
  const periodId = formData.get("period_id") as string;

  if (!file || !entryId || !periodId) {
    return NextResponse.json({ error: "file, entry_id, and period_id are required" }, { status: 400 });
  }

  // Validate file type
  const allowedTypes = [
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/tab-separated-values",
  ];
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!allowedTypes.includes(file.type) && !["csv", "tsv", "txt"].includes(ext || "")) {
    return NextResponse.json({
      error: "Unsupported file type. Please upload a CSV file (export your Google Sheet as CSV first)."
    }, { status: 400 });
  }

  // Max 5MB
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large. Maximum 5MB." }, { status: 400 });
  }

  const db = await getDb();

  // Get the period
  const periodResult = await db.execute({ sql: "SELECT * FROM pay_periods WHERE id = ?", args: [Number(periodId)] });
  if (periodResult.rows.length === 0) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  const period = rowTo<{ id: number; month: number; year: number }>(periodResult.rows[0]);

  // Get the entry
  const entryResult = await db.execute({
    sql: "SELECT * FROM payslip_entries WHERE id = ?",
    args: [Number(entryId)],
  });
  if (entryResult.rows.length === 0) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  const entry = entryResult.rows[0];

  try {
    // Read file contents
    const text = await file.text();

    // Handle TSV (tab-separated) files by converting to CSV
    let csvText = text;
    if (ext === "tsv" || file.type === "text/tab-separated-values") {
      csvText = text.split("\n").map(line => line.split("\t").join(",")).join("\n");
    }

    // Parse the CSV data
    const sheetData = parseCsvText(csvText, period.month, period.year);

    if (sheetData.length === 0) {
      return NextResponse.json({
        error: `No valid entries found for ${period.month}/${period.year}. Make sure your file has columns for Patient Name, Date, and Amount, and that dates match the period month.`,
        hint: "Export your Google Sheet as CSV: File > Download > Comma Separated Values (.csv)"
      }, { status: 400 });
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

    const systemPatientsMap = new Map<string, PrivatePatient[]>();
    for (const p of systemPatients) {
      const normalized = normalizeNameForMatch(p.name);
      if (!systemPatientsMap.has(normalized)) {
        systemPatientsMap.set(normalized, []);
      }
      systemPatientsMap.get(normalized)!.push(p);
    }

    const newDiscrepancies: Discrepancy[] = [];
    const matchedLogEntries = new Set<number>();
    const matchedSystemPatients = new Set<string>();

    for (let i = 0; i < dentistLog.length; i++) {
      const logEntry = dentistLog[i];
      const normalizedName = normalizeNameForMatch(logEntry.patientName);
      const systemMatches = systemPatientsMap.get(normalizedName) || [];

      let matched = false;
      for (const systemPatient of systemMatches) {
        const amountDiff = Math.abs(systemPatient.amount - logEntry.amount);
        const amountMatch = amountDiff < 1;
        const dateMatch = systemPatient.date === logEntry.date;

        if (amountMatch && dateMatch) {
          matchedLogEntries.add(i);
          matchedSystemPatients.add(`${systemPatient.name}-${systemPatient.date}-${systemPatient.amount}`);
          matched = true;
          break;
        }

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

      if (!matched) {
        newDiscrepancies.push({
          type: "in_log_not_system",
          patientName: logEntry.patientName,
          invoicedAmount: 0,
          paidAmount: 0,
          logAmount: logEntry.amount,
          date: logEntry.date,
          notes: `In uploaded sheet (£${logEntry.amount.toFixed(2)}) but not found in Dentally`,
        });
      }
    }

    // Check for system entries not in uploaded sheet
    for (const systemPatient of systemPatients) {
      const key = `${systemPatient.name}-${systemPatient.date}-${systemPatient.amount}`;
      if (!matchedSystemPatients.has(key)) {
        const normalizedName = normalizeNameForMatch(systemPatient.name);
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
            notes: `In Dentally (£${systemPatient.amount.toFixed(2)}) but not in uploaded sheet`,
          });
        }
      }
    }

    // Merge with existing discrepancies - keep payment status ones, add new log comparison ones
    const paymentDiscrepancies = existingDiscrepancies.filter(d =>
      d.type === "invoiced_not_paid" || d.type === "partial_payment"
    );
    // Also preserve resolved discrepancies
    const resolvedDiscrepancies = existingDiscrepancies.filter(d => d.resolved);
    const resolvedKeys = new Set(resolvedDiscrepancies.map(d => `${d.type}-${d.patientName}-${d.date}`));

    const allDiscrepancies = [
      ...paymentDiscrepancies,
      ...newDiscrepancies.filter(d => !resolvedKeys.has(`${d.type}-${d.patientName}-${d.date}`)),
      ...resolvedDiscrepancies.filter(d =>
        d.type !== "invoiced_not_paid" && d.type !== "partial_payment"
      ),
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
        JSON.stringify(allDiscrepancies),
        Number(entryId),
      ],
    });

    const logTotal = dentistLog.reduce((s, l) => s + l.amount, 0);
    const systemTotal = systemPatients.reduce((s, p) => s + p.amount, 0);

    return NextResponse.json({
      ok: true,
      message: `Uploaded ${dentistLog.length} entries from spreadsheet. Found ${newDiscrepancies.length} discrepancies.`,
      count: dentistLog.length,
      discrepancies: newDiscrepancies.length,
      summary: {
        logEntries: dentistLog.length,
        logTotal: Math.round(logTotal * 100) / 100,
        systemPatients: systemPatients.length,
        systemTotal: Math.round(systemTotal * 100) / 100,
        matched: matchedLogEntries.size,
        inLogNotSystem: newDiscrepancies.filter(d => d.type === "in_log_not_system").length,
        inSystemNotLog: newDiscrepancies.filter(d => d.type === "in_system_not_log").length,
        amountMismatches: newDiscrepancies.filter(d => d.type === "log_mismatch").length,
      },
    });
  } catch (err: unknown) {
    console.error("[SheetUpload] Error:", err);
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `File processing failed: ${errMsg}` }, { status: 500 });
  }
}
