import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Patient record interface
interface PatientRecord {
  name: string;
  date: string;
  amount: number;
  amountPaid: number;
  amountOutstanding: number;
  status: "paid" | "partial" | "unpaid";
  finance: boolean;
  invoiceId: string;
  patientId: string;
  flagged?: boolean;
  flagReason?: string;
  financeFee?: number;
  resolved?: boolean;
  resolvedNote?: string;
}

// Update a patient record (status, finance fee, resolved, etc.)
export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entry_id, patient_index, updates } = await req.json();

  if (typeof entry_id !== "number" || typeof patient_index !== "number") {
    return NextResponse.json({ error: "entry_id and patient_index are required" }, { status: 400 });
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
  let patients: PatientRecord[] = [];

  try {
    patients = JSON.parse(String(entry.private_patients_json || "[]"));
  } catch {
    return NextResponse.json({ error: "Invalid patient data" }, { status: 500 });
  }

  if (patient_index < 0 || patient_index >= patients.length) {
    return NextResponse.json({ error: "Patient index out of range" }, { status: 400 });
  }

  // Apply updates
  const patient = patients[patient_index];

  if (updates.status !== undefined) {
    patient.status = updates.status;
    // Update amounts based on new status
    if (updates.status === "paid") {
      patient.amountPaid = patient.amount;
      patient.amountOutstanding = 0;
      patient.flagged = patient.finance; // Keep flagged if finance
      if (!patient.finance) {
        patient.flagReason = undefined;
      }
    } else if (updates.status === "unpaid") {
      patient.amountPaid = 0;
      patient.amountOutstanding = patient.amount;
      patient.flagged = true;
      patient.flagReason = "Invoice not paid";
    }
  }

  if (updates.finance !== undefined) {
    patient.finance = updates.finance;
    if (updates.finance && patient.status === "paid") {
      patient.flagged = true;
      patient.flagReason = "Paid via finance - verify fee deduction";
    }
  }

  if (updates.financeFee !== undefined) {
    patient.financeFee = updates.financeFee;
  }

  if (updates.resolved !== undefined) {
    patient.resolved = updates.resolved;
    if (updates.resolved) {
      patient.flagged = false;
    }
  }

  if (updates.resolvedNote !== undefined) {
    patient.resolvedNote = updates.resolvedNote;
  }

  if (updates.amount !== undefined) {
    const oldAmount = patient.amount;
    patient.amount = updates.amount;
    // Adjust paid/outstanding proportionally
    if (patient.status === "paid") {
      patient.amountPaid = updates.amount;
      patient.amountOutstanding = 0;
    } else if (patient.status === "unpaid") {
      patient.amountPaid = 0;
      patient.amountOutstanding = updates.amount;
    } else {
      // Partial - adjust proportionally
      const ratio = oldAmount > 0 ? patient.amountPaid / oldAmount : 0;
      patient.amountPaid = Math.round(updates.amount * ratio * 100) / 100;
      patient.amountOutstanding = Math.round((updates.amount - patient.amountPaid) * 100) / 100;
    }
  }

  // Recalculate gross_private (sum of paid amounts minus finance fees)
  let grossPrivate = 0;
  let totalFinanceFees = 0;
  for (const p of patients) {
    grossPrivate += p.amountPaid || 0;
    if (p.finance && p.financeFee) {
      totalFinanceFees += p.financeFee;
    }
  }

  // Update the entry
  await db.execute({
    sql: `UPDATE payslip_entries SET
      private_patients_json = ?,
      gross_private = ?,
      finance_fees = ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    args: [
      JSON.stringify(patients),
      Math.round(grossPrivate * 100) / 100,
      Math.round(totalFinanceFees * 100) / 100,
      entry_id,
    ],
  });

  return NextResponse.json({
    ok: true,
    patient: patient,
    totals: {
      grossPrivate: Math.round(grossPrivate * 100) / 100,
      financeFees: Math.round(totalFinanceFees * 100) / 100,
    },
  });
}

// Add a new patient record manually
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entry_id, patient } = await req.json();

  if (typeof entry_id !== "number" || !patient) {
    return NextResponse.json({ error: "entry_id and patient are required" }, { status: 400 });
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
  let patients: PatientRecord[] = [];

  try {
    patients = JSON.parse(String(entry.private_patients_json || "[]"));
  } catch {
    patients = [];
  }

  // Create new patient record
  const newPatient: PatientRecord = {
    name: patient.name || "Manual Entry",
    date: patient.date || new Date().toISOString().substring(0, 10),
    amount: patient.amount || 0,
    amountPaid: patient.status === "paid" ? (patient.amount || 0) : 0,
    amountOutstanding: patient.status !== "paid" ? (patient.amount || 0) : 0,
    status: patient.status || "paid",
    finance: patient.finance || false,
    invoiceId: patient.invoiceId || `manual-${Date.now()}`,
    patientId: patient.patientId || `manual-${Date.now()}`,
    flagged: patient.finance || patient.status !== "paid",
    financeFee: patient.financeFee,
  };

  patients.push(newPatient);

  // Sort by date
  patients.sort((a, b) => a.date.localeCompare(b.date));

  // Recalculate totals
  let grossPrivate = 0;
  let totalFinanceFees = 0;
  for (const p of patients) {
    grossPrivate += p.amountPaid || 0;
    if (p.finance && p.financeFee) {
      totalFinanceFees += p.financeFee;
    }
  }

  // Update the entry
  await db.execute({
    sql: `UPDATE payslip_entries SET
      private_patients_json = ?,
      gross_private = ?,
      finance_fees = ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    args: [
      JSON.stringify(patients),
      Math.round(grossPrivate * 100) / 100,
      Math.round(totalFinanceFees * 100) / 100,
      entry_id,
    ],
  });

  return NextResponse.json({
    ok: true,
    patient: newPatient,
    patientIndex: patients.length - 1,
    totals: {
      grossPrivate: Math.round(grossPrivate * 100) / 100,
      financeFees: Math.round(totalFinanceFees * 100) / 100,
    },
  });
}

// Delete a patient record
export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const entry_id = parseInt(searchParams.get("entry_id") || "0");
  const patient_index = parseInt(searchParams.get("patient_index") || "-1");

  if (!entry_id || patient_index < 0) {
    return NextResponse.json({ error: "entry_id and patient_index are required" }, { status: 400 });
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
  let patients: PatientRecord[] = [];

  try {
    patients = JSON.parse(String(entry.private_patients_json || "[]"));
  } catch {
    return NextResponse.json({ error: "Invalid patient data" }, { status: 500 });
  }

  if (patient_index >= patients.length) {
    return NextResponse.json({ error: "Patient index out of range" }, { status: 400 });
  }

  // Remove the patient
  const removed = patients.splice(patient_index, 1)[0];

  // Recalculate totals
  let grossPrivate = 0;
  let totalFinanceFees = 0;
  for (const p of patients) {
    grossPrivate += p.amountPaid || 0;
    if (p.finance && p.financeFee) {
      totalFinanceFees += p.financeFee;
    }
  }

  // Update the entry
  await db.execute({
    sql: `UPDATE payslip_entries SET
      private_patients_json = ?,
      gross_private = ?,
      finance_fees = ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    args: [
      JSON.stringify(patients),
      Math.round(grossPrivate * 100) / 100,
      Math.round(totalFinanceFees * 100) / 100,
      entry_id,
    ],
  });

  return NextResponse.json({
    ok: true,
    removed: removed,
    totals: {
      grossPrivate: Math.round(grossPrivate * 100) / 100,
      financeFees: Math.round(totalFinanceFees * 100) / 100,
    },
  });
}
