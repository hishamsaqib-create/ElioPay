import { createClient, type Client, type Row } from "@libsql/client";
import bcrypt from "bcryptjs";

let _client: Client | null = null;
let _initialized = false;

export function getClient(): Client {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:aurapay.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

export async function getDb(): Promise<Client> {
  const client = getClient();
  if (!_initialized) {
    await initializeDb(client);
    _initialized = true;
  }
  return client;
}

async function initializeDb(db: Client) {
  // Create tables one at a time (libsql doesn't support multi-statement exec reliably)
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS dentists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      split_percentage REAL NOT NULL DEFAULT 50,
      is_nhs INTEGER NOT NULL DEFAULT 0,
      uda_rate REAL DEFAULT 0,
      performer_number TEXT,
      practitioner_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pay_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      finalized_at TEXT,
      UNIQUE(month, year)
    )`,
    `CREATE TABLE IF NOT EXISTS payslip_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_id INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
      dentist_id INTEGER NOT NULL REFERENCES dentists(id),
      gross_private REAL NOT NULL DEFAULT 0,
      nhs_udas REAL NOT NULL DEFAULT 0,
      lab_bills_json TEXT DEFAULT '[]',
      finance_fees REAL NOT NULL DEFAULT 0,
      therapy_minutes REAL NOT NULL DEFAULT 0,
      therapy_rate REAL NOT NULL DEFAULT 0.5833,
      adjustments_json TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      private_patients_json TEXT DEFAULT '[]',
      discrepancies_json TEXT DEFAULT '[]',
      dentist_log_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(period_id, dentist_id)
    )`,
    `CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payslip_entry_id INTEGER REFERENCES payslip_entries(id),
      dentist_id INTEGER REFERENCES dentists(id),
      sent_at TEXT DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  // Run migrations for existing databases
  const migrations = [
    "ALTER TABLE payslip_entries ADD COLUMN discrepancies_json TEXT DEFAULT '[]'",
    "ALTER TABLE payslip_entries ADD COLUMN dentist_log_json TEXT DEFAULT '[]'",
    "ALTER TABLE pay_periods ADD COLUMN nhs_period_start TEXT",
    "ALTER TABLE pay_periods ADD COLUMN nhs_period_end TEXT",
    "ALTER TABLE payslip_entries ADD COLUMN nhs_period_json TEXT DEFAULT '{}'",
  ];
  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch {
      // Column already exists, ignore
    }
  }

  // Seed default users if none exist
  const userCount = await db.execute("SELECT COUNT(*) as c FROM users");
  if (Number(userCount.rows[0].c) === 0) {
    const hash = bcrypt.hashSync("aurapay2025", 10);
    await db.execute({
      sql: "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
      args: ["hisham@aurapay.cloud", hash, "Hisham Saqib", "owner"],
    });
    await db.execute({
      sql: "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
      args: ["manager@aurapay.cloud", hash, "Practice Manager", "manager"],
    });
  }

  // Seed dentists if none exist
  // NOTE: practitioner_id = Dentally user_id (appears on invoices)
  const dentistCount = await db.execute("SELECT COUNT(*) as c FROM dentists");
  if (Number(dentistCount.rows[0].c) === 0) {
    const dentists = [
      { name: "Zeeshan Abbas", split: 45, nhs: 0, uda: 0, perf: null, prac: "484388" },
      { name: "Ankush Patel", split: 45, nhs: 0, uda: 0, perf: null, prac: "285115" },
      { name: "Peter Throw", split: 50, nhs: 1, uda: 16, perf: "780995", prac: "396225" },
      { name: "Priyanka Kapoor", split: 50, nhs: 1, uda: 15, perf: "112376", prac: "396229" },
      { name: "Moneeb Ahmad", split: 50, nhs: 1, uda: 15, perf: "701874", prac: "497281" },
      { name: "Hani Dalati", split: 50, nhs: 0, uda: 0, perf: null, prac: "462017" },
      { name: "Hisham Saqib", split: 50, nhs: 0, uda: 0, perf: null, prac: "276544" },
    ];
    for (const d of dentists) {
      await db.execute({
        sql: "INSERT INTO dentists (name, split_percentage, is_nhs, uda_rate, performer_number, practitioner_id) VALUES (?, ?, ?, ?, ?, ?)",
        args: [d.name, d.split, d.nhs, d.uda, d.perf, d.prac],
      });
    }
  }

  // Fix dentist IDs for existing databases (migration)
  // These are the correct Dentally user_ids that appear on invoices
  const idFixes: Record<string, string> = {
    "Zeeshan Abbas": "484388",
    "Ankush Patel": "285115",
    "Peter Throw": "396225",
    "Priyanka Kapoor": "396229",
    "Moneeb Ahmad": "497281",
    "Hani Dalati": "462017",
    "Hisham Saqib": "276544",
  };
  for (const [name, id] of Object.entries(idFixes)) {
    await db.execute({
      sql: "UPDATE dentists SET practitioner_id = ? WHERE name = ? AND (practitioner_id IS NULL OR practitioner_id != ?)",
      args: [id, name, id],
    });
  }

  // Seed default settings
  const settingsCount = await db.execute("SELECT COUNT(*) as c FROM settings");
  if (Number(settingsCount.rows[0].c) === 0) {
    const defaults = [
      ["practice_name", "Aura Dental Clinic"],
      ["therapy_rate", "0.5833"],
      ["lab_bill_split", "0.5"],
      ["finance_fee_split", "0.5"],
      ["finance_rate_3m", "4.5"],
      ["finance_rate_6m", "6.0"],
      ["finance_rate_10m", "7.0"],
      ["finance_rate_12m", "8.0"],
      ["smtp_host", "smtp.gmail.com"],
      ["smtp_port", "587"],
      ["smtp_user", ""],
      ["smtp_pass", ""],
      ["email_from", "payslips@aurapay.cloud"],
    ];
    for (const [k, v] of defaults) {
      await db.execute({ sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", args: [k, v] });
    }
  }
}

// Helper to convert Row to typed object
export function rowTo<T>(row: Row): T {
  return row as unknown as T;
}

export function rowsTo<T>(rows: Row[]): T[] {
  return rows as unknown as T[];
}

// Helper types
export interface Dentist {
  id: number;
  name: string;
  email: string | null;
  split_percentage: number;
  is_nhs: number;
  uda_rate: number;
  performer_number: string | null;
  practitioner_id: string | null;
  active: number;
}

export interface PayPeriod {
  id: number;
  month: number;
  year: number;
  status: string;
  created_by: number | null;
  created_at: string;
  finalized_at: string | null;
  nhs_period_start: string | null;
  nhs_period_end: string | null;
}

export interface NhsPeriodInfo {
  period_start?: string;
  period_end?: string;
  udas?: number;
  extracted_from?: string;
}

export interface LabBillItem {
  lab_name: string;
  amount: number;
  description?: string;
}

export interface AdjustmentItem {
  description: string;
  amount: number;
  type: "addition" | "deduction";
}

export interface PrivatePatient {
  name: string;
  date: string;
  amount: number;
  amountPaid?: number;
  amountOutstanding?: number;
  status?: "paid" | "partial" | "unpaid";
  finance: boolean;
  finance_term?: number;
  flagged?: boolean;
  flagReason?: string;
  notes?: string;
}

export interface Discrepancy {
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

export interface DentistLogEntry {
  patientName: string;
  date: string;
  amount: number;
  treatment?: string;
  notes?: string;
}

export interface PayslipEntry {
  id: number;
  period_id: number;
  dentist_id: number;
  gross_private: number;
  nhs_udas: number;
  lab_bills_json: string;
  finance_fees: number;
  therapy_minutes: number;
  therapy_rate: number;
  adjustments_json: string;
  notes: string;
  private_patients_json: string;
  discrepancies_json: string;
  dentist_log_json: string;
  created_at: string;
  updated_at: string;
}
