import { createClient, type Client, type Row } from "@libsql/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

let _client: Client | null = null;
let _initialized = false;
let _initializingPromise: Promise<void> | null = null;

// Validate database configuration
function validateDbConfig(): { url: string; authToken?: string } {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CRITICAL: TURSO_DATABASE_URL environment variable is required in production");
    }
    console.warn("WARNING: Using local SQLite database. Set TURSO_DATABASE_URL for production.");
    return { url: "file:eliopay.db" };
  }

  // Validate URL format
  if (!url.startsWith("libsql://") && !url.startsWith("file:") && !url.startsWith("http")) {
    throw new Error("Invalid TURSO_DATABASE_URL format. Must start with libsql://, file:, or http(s)://");
  }

  // Turso cloud requires auth token
  if (url.startsWith("libsql://") && !authToken) {
    throw new Error("TURSO_AUTH_TOKEN is required for Turso cloud database");
  }

  return { url, authToken };
}

export function getClient(): Client {
  if (!_client) {
    const config = validateDbConfig();
    _client = createClient({
      url: config.url,
      authToken: config.authToken,
    });
  }
  return _client;
}

// Use mutex pattern to prevent race condition during initialization
export async function getDb(): Promise<Client> {
  const client = getClient();

  if (_initialized) {
    return client;
  }

  // If already initializing, wait for it
  if (_initializingPromise) {
    await _initializingPromise;
    return client;
  }

  // Start initialization
  _initializingPromise = initializeDb(client)
    .then(() => {
      _initialized = true;
    })
    .catch((error) => {
      _initializingPromise = null;
      throw error;
    });

  await _initializingPromise;
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
      must_change_password INTEGER NOT NULL DEFAULT 1,
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
      weekly_hours REAL DEFAULT 40,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pay_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12),
      year INTEGER NOT NULL CHECK(year >= 2020 AND year <= 2100),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'finalized')),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      finalized_at TEXT,
      nhs_period_start TEXT,
      nhs_period_end TEXT,
      UNIQUE(month, year)
    )`,
    `CREATE TABLE IF NOT EXISTS payslip_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_id INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
      dentist_id INTEGER NOT NULL REFERENCES dentists(id),
      gross_private REAL NOT NULL DEFAULT 0 CHECK(gross_private >= 0),
      nhs_udas REAL NOT NULL DEFAULT 0 CHECK(nhs_udas >= 0),
      lab_bills_json TEXT DEFAULT '[]',
      finance_fees REAL NOT NULL DEFAULT 0 CHECK(finance_fees >= 0),
      therapy_minutes REAL NOT NULL DEFAULT 0 CHECK(therapy_minutes >= 0),
      therapy_rate REAL NOT NULL DEFAULT 0.5833,
      adjustments_json TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      private_patients_json TEXT DEFAULT '[]',
      discrepancies_json TEXT DEFAULT '[]',
      dentist_log_json TEXT DEFAULT '[]',
      nhs_period_json TEXT DEFAULT '{}',
      analytics_json TEXT DEFAULT '{}',
      therapy_breakdown_json TEXT DEFAULT '[]',
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
    try {
      await db.execute(sql);
    } catch (error) {
      console.error("Failed to create table:", error);
      throw error;
    }
  }

  // Run migrations for existing databases
  const migrations = [
    "ALTER TABLE payslip_entries ADD COLUMN discrepancies_json TEXT DEFAULT '[]'",
    "ALTER TABLE payslip_entries ADD COLUMN dentist_log_json TEXT DEFAULT '[]'",
    "ALTER TABLE pay_periods ADD COLUMN nhs_period_start TEXT",
    "ALTER TABLE pay_periods ADD COLUMN nhs_period_end TEXT",
    "ALTER TABLE payslip_entries ADD COLUMN nhs_period_json TEXT DEFAULT '{}'",
    "ALTER TABLE payslip_entries ADD COLUMN analytics_json TEXT DEFAULT '{}'",
    "ALTER TABLE dentists ADD COLUMN weekly_hours REAL DEFAULT 40",
    "ALTER TABLE payslip_entries ADD COLUMN therapy_breakdown_json TEXT DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
    "UPDATE dentists SET is_nhs = 1, uda_rate = 35.45, performer_number = '110271' WHERE name = 'Hisham Saqib'",
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch {
      // Column/table already exists, ignore
    }
  }

  // Seed default users if none exist
  const userCount = await db.execute("SELECT COUNT(*) as c FROM users");
  if (Number(userCount.rows[0].c) === 0) {
    // Default admin credentials
    const adminEmail = "drhish@eliopay.co.uk";
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || "eliopay2025";
    const hash = bcrypt.hashSync(adminPassword, 12);

    await db.execute({
      sql: "INSERT INTO users (email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, ?, ?)",
      args: [adminEmail, hash, "Dr Hisham", "owner", 0],
    });

    console.log("=".repeat(60));
    console.log("IMPORTANT: Admin user created");
    console.log("Email:", adminEmail);
    console.log("Password:", adminPassword);
    console.log("=".repeat(60));
  }

  // Migration: Update existing admin user to new credentials
  const existingAdmin = await db.execute("SELECT id FROM users WHERE email = 'admin@eliodental.co.uk'");
  if (existingAdmin.rows.length > 0) {
    const newHash = bcrypt.hashSync("eliopay2025", 12);
    await db.execute({
      sql: "UPDATE users SET email = ?, password_hash = ?, name = ?, must_change_password = 0 WHERE email = 'admin@eliodental.co.uk'",
      args: ["drhish@eliopay.co.uk", newHash, "Dr Hisham"],
    });
    console.log("[Migration] Updated admin user to drhish@eliopay.co.uk");
  }

  // Seed dentists if none exist
  const dentistCount = await db.execute("SELECT COUNT(*) as c FROM dentists");
  if (Number(dentistCount.rows[0].c) === 0) {
    const dentists = [
      { name: "Zeeshan Abbas", split: 45, nhs: 0, uda: 0, perf: null, prac: "484388" },
      { name: "Ankush Patel", split: 45, nhs: 0, uda: 0, perf: null, prac: "285115" },
      { name: "Peter Throw", split: 50, nhs: 1, uda: 16, perf: "780995", prac: "396225" },
      { name: "Priyanka Kapoor", split: 50, nhs: 1, uda: 15, perf: "112376", prac: "396229" },
      { name: "Moneeb Ahmad", split: 50, nhs: 1, uda: 15, perf: "701874", prac: "497281" },
      { name: "Hani Dalati", split: 50, nhs: 0, uda: 0, perf: null, prac: "462017" },
      { name: "Hisham Saqib", split: 50, nhs: 1, uda: 35.45, perf: "110271", prac: "276544" },
    ];
    for (const d of dentists) {
      await db.execute({
        sql: "INSERT INTO dentists (name, split_percentage, is_nhs, uda_rate, performer_number, practitioner_id) VALUES (?, ?, ?, ?, ?, ?)",
        args: [d.name, d.split, d.nhs, d.uda, d.perf, d.prac],
      });
    }
  }

  // Fix dentist IDs for existing databases (migration)
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
    const defaults: [string, string][] = [
      // Clinic branding
      ["clinic_name", "Your Dental Clinic"],
      ["clinic_address_line1", ""],
      ["clinic_address_line2", ""],
      ["clinic_city", ""],
      ["clinic_postcode", ""],
      ["clinic_phone", ""],
      ["clinic_email", ""],
      ["clinic_website", ""],
      ["clinic_logo_url", ""],
      // Pay calculation settings
      ["therapy_rate", "0.5833"],
      ["lab_bill_split", "0.5"],
      ["finance_fee_split", "0.5"],
      ["finance_rate_3m", "4.5"],
      ["finance_rate_6m", "6.0"],
      ["finance_rate_10m", "7.0"],
      ["finance_rate_12m", "8.0"],
      // SMTP credentials should be in environment variables
      ["smtp_host", process.env.SMTP_HOST || "smtp.gmail.com"],
      ["smtp_port", process.env.SMTP_PORT || "587"],
      ["smtp_user", process.env.SMTP_USER || ""],
      ["smtp_pass", process.env.SMTP_PASS || ""],
      ["email_from", process.env.EMAIL_FROM || "payslips@eliopay.co.uk"],
    ];
    for (const [k, v] of defaults) {
      await db.execute({ sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", args: [k, v] });
    }
  }
}

// Helper to get settings with caching
let _settingsCache: Map<string, string> | null = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60000; // 1 minute

export async function getSettings(): Promise<Map<string, string>> {
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheTime < SETTINGS_CACHE_TTL) {
    return _settingsCache;
  }

  const db = await getDb();
  const result = await db.execute("SELECT key, value FROM settings");
  const settings = new Map<string, string>();
  for (const row of result.rows) {
    settings.set(String(row.key), String(row.value));
  }

  _settingsCache = settings;
  _settingsCacheTime = now;
  return settings;
}

export function clearSettingsCache() {
  _settingsCache = null;
  _settingsCacheTime = 0;
}

// Get a setting with type conversion and default
export async function getSetting(key: string, defaultValue: string): Promise<string>;
export async function getSetting(key: string, defaultValue: number): Promise<number>;
export async function getSetting(key: string, defaultValue: string | number): Promise<string | number> {
  const settings = await getSettings();
  const value = settings.get(key);

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof defaultValue === "number") {
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
  }

  return value;
}

// Helper to convert Row to typed object
export function rowTo<T>(row: Row): T {
  return row as unknown as T;
}

export function rowsTo<T>(rows: Row[]): T[] {
  return rows as unknown as T[];
}

// Safe JSON parse with fallback
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    console.warn("Failed to parse JSON, using fallback:", json.substring(0, 100));
    return fallback;
  }
}

// Validation helpers
export function validateMonth(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

export function validateYear(year: number): boolean {
  return Number.isInteger(year) && year >= 2020 && year <= 2100;
}

export function validatePercentage(pct: number): boolean {
  return typeof pct === "number" && pct >= 0 && pct <= 100;
}

export function validatePositiveNumber(num: number): boolean {
  return typeof num === "number" && num >= 0 && isFinite(num);
}

export function validatePerformerNumber(num: string | null): boolean {
  if (num === null) return true;
  return /^\d{6}$/.test(num);
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
  weekly_hours?: number;
}

export interface PayPeriod {
  id: number;
  month: number;
  year: number;
  status: "draft" | "finalized";
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
  invoiceId?: string;
  patientId?: string;
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
  analytics_json: string;
  therapy_breakdown_json: string;
  nhs_period_json?: string;
  created_at: string;
  updated_at: string;
}

export interface TherapyAppointment {
  patientName: string;
  patientId: string;
  date: string;
  minutes: number;
  treatment?: string;
  therapistName?: string;
  cost?: number;
}
