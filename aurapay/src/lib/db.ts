import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcryptjs";

const DB_PATH = path.join(process.cwd(), "aurapay.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initializeDb(_db);
  }
  return _db;
}

function initializeDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dentists (
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
    );

    CREATE TABLE IF NOT EXISTS pay_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      finalized_at TEXT,
      UNIQUE(month, year)
    );

    CREATE TABLE IF NOT EXISTS payslip_entries (
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(period_id, dentist_id)
    );

    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payslip_entry_id INTEGER REFERENCES payslip_entries(id),
      dentist_id INTEGER REFERENCES dentists(id),
      sent_at TEXT DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed default users if none exist
  const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (userCount.c === 0) {
    const hash = bcrypt.hashSync("aurapay2025", 10);
    db.prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)").run(
      "hisham@aurapay.cloud", hash, "Hisham Saqib", "owner"
    );
    db.prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)").run(
      "manager@aurapay.cloud", hash, "Practice Manager", "manager"
    );
  }

  // Seed dentists if none exist
  const dentistCount = db.prepare("SELECT COUNT(*) as c FROM dentists").get() as { c: number };
  if (dentistCount.c === 0) {
    const dentists = [
      { name: "Zeeshan Abbas", split: 45, nhs: 0, uda: 0, perf: null, prac: "283516" },
      { name: "Ankush Patel", split: 45, nhs: 0, uda: 0, perf: null, prac: "110701" },
      { name: "Peter Throw", split: 50, nhs: 1, uda: 16, perf: "780995", prac: "189357" },
      { name: "Priyanka Kapoor", split: 50, nhs: 1, uda: 15, perf: "112376", prac: "189361" },
      { name: "Moneeb Ahmad", split: 50, nhs: 1, uda: 15, perf: "701874", prac: "293046" },
      { name: "Hani Dalati", split: 50, nhs: 0, uda: 0, perf: null, prac: "263970" },
      { name: "Hisham Saqib", split: 50, nhs: 0, uda: 0, perf: null, prac: "127844" },
    ];
    const stmt = db.prepare(
      "INSERT INTO dentists (name, split_percentage, is_nhs, uda_rate, performer_number, practitioner_id) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const d of dentists) {
      stmt.run(d.name, d.split, d.nhs, d.uda, d.perf, d.prac);
    }
  }

  // Seed default settings
  const settingsCount = db.prepare("SELECT COUNT(*) as c FROM settings").get() as { c: number };
  if (settingsCount.c === 0) {
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
    const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [k, v] of defaults) {
      stmt.run(k, v);
    }
  }
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
  finance: boolean;
  finance_term?: number;
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
  created_at: string;
  updated_at: string;
}
