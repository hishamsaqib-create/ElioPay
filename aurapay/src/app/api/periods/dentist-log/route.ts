import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Interface for dentist's private takings log entry
interface DentistLogEntry {
  patientName: string;
  date: string;
  amount: number;
  treatment?: string;
  notes?: string;
}

// Interface for system patient record
interface SystemPatient {
  name: string;
  date: string;
  amount: number;
  amountPaid?: number;
  status?: string;
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

// POST - Import dentist log and compare with system data
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entry_id, log_entries, csv_data } = await req.json();

  if (!entry_id) {
    return NextResponse.json({ error: "entry_id required" }, { status: 400 });
  }

  const db = await getDb();

  // Get the entry
  const entryResult = await db.execute({
    sql: "SELECT * FROM payslip_entries WHERE id = ?",
    args: [entry_id],
  });

  if (entryResult.rows.length === 0) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const entry = entryResult.rows[0];

  // Parse log entries from CSV if provided
  let parsedLogEntries: DentistLogEntry[] = [];

  if (csv_data) {
    // Parse CSV format: patientName, date, amount, treatment (optional)
    const lines = csv_data.trim().split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || i === 0 && line.toLowerCase().includes("patient")) continue; // Skip header

      const parts = line.split(",").map((p: string) => p.trim());
      if (parts.length >= 3) {
        const [patientName, date, amountStr, treatment] = parts;
        const amount = parseFloat(amountStr.replace("£", "").replace(",", "")) || 0;

        if (patientName && amount > 0) {
          parsedLogEntries.push({
            patientName,
            date: formatDate(date),
            amount,
            treatment: treatment || undefined,
          });
        }
      }
    }
  } else if (log_entries && Array.isArray(log_entries)) {
    parsedLogEntries = log_entries;
  }

  if (parsedLogEntries.length === 0) {
    return NextResponse.json({ error: "No valid log entries found" }, { status: 400 });
  }

  // Get current system patients and discrepancies
  const systemPatients: SystemPatient[] = JSON.parse(String(entry.private_patients_json) || "[]");
  const existingDiscrepancies: Discrepancy[] = JSON.parse(String(entry.discrepancies_json) || "[]");

  // Compare log with system data
  const newDiscrepancies: Discrepancy[] = [];
  const matchedSystemIndices = new Set<number>();
  const matchedLogIndices = new Set<number>();

  // For each log entry, try to find matching system patient
  for (let logIdx = 0; logIdx < parsedLogEntries.length; logIdx++) {
    const logEntry = parsedLogEntries[logIdx];
    let bestMatch: { idx: number; score: number } | null = null;

    for (let sysIdx = 0; sysIdx < systemPatients.length; sysIdx++) {
      if (matchedSystemIndices.has(sysIdx)) continue;

      const sysPatient = systemPatients[sysIdx];
      const score = calculateMatchScore(logEntry, sysPatient);

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { idx: sysIdx, score };
      }
    }

    if (bestMatch && bestMatch.score >= 50) {
      // Found a match - check for amount discrepancy
      const sysPatient = systemPatients[bestMatch.idx];
      matchedSystemIndices.add(bestMatch.idx);
      matchedLogIndices.add(logIdx);

      const amountDiff = Math.abs(logEntry.amount - sysPatient.amount);
      if (amountDiff > 0.01) {
        newDiscrepancies.push({
          type: "log_mismatch",
          patientName: logEntry.patientName,
          invoicedAmount: sysPatient.amount,
          paidAmount: sysPatient.amountPaid ?? sysPatient.amount,
          logAmount: logEntry.amount,
          date: logEntry.date,
          notes: `Log amount (£${logEntry.amount.toFixed(2)}) differs from system (£${sysPatient.amount.toFixed(2)}) by £${amountDiff.toFixed(2)}`,
        });
      }
    } else {
      // No match found - in log but not in system
      newDiscrepancies.push({
        type: "in_log_not_system",
        patientName: logEntry.patientName,
        invoicedAmount: 0,
        paidAmount: 0,
        logAmount: logEntry.amount,
        date: logEntry.date,
        notes: `In dentist log (£${logEntry.amount.toFixed(2)}) but not found in Dentally data`,
      });
    }
  }

  // Find system patients not in log
  for (let sysIdx = 0; sysIdx < systemPatients.length; sysIdx++) {
    if (matchedSystemIndices.has(sysIdx)) continue;

    const sysPatient = systemPatients[sysIdx];
    newDiscrepancies.push({
      type: "in_system_not_log",
      patientName: sysPatient.name,
      invoicedAmount: sysPatient.amount,
      paidAmount: sysPatient.amountPaid ?? sysPatient.amount,
      date: sysPatient.date,
      notes: `In Dentally (£${sysPatient.amount.toFixed(2)}) but not in dentist's log - verify treatment was done`,
    });
  }

  // Merge with existing discrepancies (keep payment status ones, add log comparison ones)
  const paymentDiscrepancies = existingDiscrepancies.filter(d =>
    d.type === "invoiced_not_paid" || d.type === "partial_payment"
  );
  const allDiscrepancies = [...paymentDiscrepancies, ...newDiscrepancies];

  // Update database
  await db.execute({
    sql: `UPDATE payslip_entries SET
      dentist_log_json = ?,
      discrepancies_json = ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    args: [
      JSON.stringify(parsedLogEntries),
      JSON.stringify(allDiscrepancies),
      entry_id,
    ],
  });

  return NextResponse.json({
    ok: true,
    message: `Imported ${parsedLogEntries.length} log entries, found ${newDiscrepancies.length} discrepancies`,
    summary: {
      logEntries: parsedLogEntries.length,
      systemPatients: systemPatients.length,
      matched: matchedLogIndices.size,
      inLogNotSystem: newDiscrepancies.filter(d => d.type === "in_log_not_system").length,
      inSystemNotLog: newDiscrepancies.filter(d => d.type === "in_system_not_log").length,
      amountMismatches: newDiscrepancies.filter(d => d.type === "log_mismatch").length,
    },
    discrepancies: newDiscrepancies,
  });
}

// Helper: Format date to YYYY-MM-DD
function formatDate(dateStr: string): string {
  // Try various date formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split("T")[0];
  }

  // Try DD/MM/YYYY format
  const parts = dateStr.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    // If first part is > 12, assume DD/MM/YYYY
    if (parseInt(a) > 12) {
      return `${c.length === 2 ? "20" + c : c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
    }
    // Otherwise assume MM/DD/YYYY or already YYYY-MM-DD
    if (a.length === 4) {
      return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
    }
    return `${c.length === 2 ? "20" + c : c}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
  }

  return dateStr;
}

// Helper: Calculate match score between log entry and system patient
function calculateMatchScore(log: DentistLogEntry, sys: SystemPatient): number {
  let score = 0;

  // Name similarity (fuzzy match)
  const logName = log.patientName.toLowerCase().trim();
  const sysName = sys.name.toLowerCase().trim();

  if (logName === sysName) {
    score += 50;
  } else {
    // Check partial matches
    const logParts = logName.split(/\s+/);
    const sysParts = sysName.split(/\s+/);

    let matchedParts = 0;
    for (const lp of logParts) {
      if (sysParts.some(sp => sp.includes(lp) || lp.includes(sp))) {
        matchedParts++;
      }
    }

    if (matchedParts > 0) {
      score += Math.min(40, matchedParts * 20);
    }
  }

  // Date match
  if (log.date === sys.date) {
    score += 30;
  } else {
    // Check if within a few days (same week)
    const logDate = new Date(log.date);
    const sysDate = new Date(sys.date);
    const diffDays = Math.abs((logDate.getTime() - sysDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 7) {
      score += 15;
    }
  }

  // Amount similarity
  const amountDiff = Math.abs(log.amount - sys.amount);
  if (amountDiff < 0.01) {
    score += 20;
  } else if (amountDiff / sys.amount < 0.1) {
    score += 10;
  }

  return score;
}

// GET - Retrieve current dentist log
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const entryId = url.searchParams.get("entry_id");

  if (!entryId) {
    return NextResponse.json({ error: "entry_id required" }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT dentist_log_json, discrepancies_json FROM payslip_entries WHERE id = ?",
    args: [entryId],
  });

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const row = result.rows[0];
  return NextResponse.json({
    log: JSON.parse(String(row.dentist_log_json) || "[]"),
    discrepancies: JSON.parse(String(row.discrepancies_json) || "[]"),
  });
}
