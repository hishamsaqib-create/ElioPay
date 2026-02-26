import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Seed historical lab bills and supplier invoices from the spreadsheet data
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();

  // Look up dentist IDs by name
  const dentistResult = await db.execute("SELECT id, name FROM dentists");
  const dentistMap = new Map<string, number>();
  for (const row of dentistResult.rows) {
    dentistMap.set(String(row.name), Number(row.id));
  }

  const getId = (name: string): number | null => {
    // Support short names
    const mapping: Record<string, string> = {
      "Zeeshan": "Zeeshan Abbas",
      "Ankush": "Ankush Patel",
      "Peter": "Peter Throw",
      "Priyanka": "Priyanka Kapoor",
      "Moneeb": "Moneeb Ahmad",
      "Hisham": "Hisham Saqib",
      "Hish": "Hisham Saqib",
      "Hani": "Hani Dalati",
    };
    const fullName = mapping[name] || name;
    return dentistMap.get(fullName) || null;
  };

  // Check if already seeded
  const existingLabs = await db.execute("SELECT COUNT(*) as c FROM lab_bill_entries");
  const existingSuppliers = await db.execute("SELECT COUNT(*) as c FROM supplier_invoice_entries");
  if (Number(existingLabs.rows[0].c) > 0 || Number(existingSuppliers.rows[0].c) > 0) {
    return NextResponse.json({ error: "Data already seeded. Delete existing entries first if you want to re-seed.", already_seeded: true }, { status: 409 });
  }

  // ============================================================
  // SAVED LABS
  // ============================================================
  const savedLabs = [
    "Halo Dental Lab", "Robinsons", "Furze", "Boutique Practice", "Queensway",
    "Richley", "Mango / Akira", "S4S", "Costech", "Jordent", "Priory",
    "Optadent", "Woodford", "scan digital",
  ];
  for (const name of savedLabs) {
    try {
      await db.execute({
        sql: "INSERT INTO saved_labs (name) VALUES (?)",
        args: [name],
      });
    } catch { /* Already exists */ }
  }

  // ============================================================
  // SAVED SUPPLIERS
  // ============================================================
  const savedSuppliers = [
    "ADT ALARMS", "YU ENERGY", "ECLIPSE PHONES", "TV License",
    "Breckon Services", "Sunderland Dental", "Stockton Council", "General Medical",
    "Hull University (RPA)", "Orthocare", "Wrights", "HE Woolley",
    "Dentsply Sirona", "Henry Schein", "Enlighten", "Damas",
    "hu mac (legionella man)", "Bio Horizons", "Trycare",
    "ORANGE BOX - BLS TRAINING", "Eurodontics", "PHS", "Acorn Polymers",
    "Stoves plumbing and heating",
  ];
  for (const name of savedSuppliers) {
    try {
      await db.execute({
        sql: "INSERT INTO saved_suppliers (name) VALUES (?)",
        args: [name],
      });
    } catch { /* Already exists */ }
  }

  // ============================================================
  // LAB BILL ENTRIES
  // Format: [date, lab_name, dentist_short_name, amount, paid]
  // ============================================================
  const labBills: [string, string, string, number, number][] = [
    // December 2024
    ["2024-12-15", "Robinsons", "Priyanka", 420.01, 1],

    // January 2025
    ["2025-01-15", "Robinsons", "Priyanka", 514.85, 1],
    ["2025-01-15", "Robinsons", "Peter", 45.90, 1],
    ["2025-01-15", "Furze", "Priyanka", 364.00, 1],
    ["2025-01-15", "Queensway", "Hisham", 719.00, 1],
    ["2025-01-15", "Mango / Akira", "Ankush", 1100.50, 1],
    ["2025-01-15", "Costech", "Priyanka", 42.50, 1],

    // February 2025
    ["2025-02-15", "Robinsons", "Priyanka", 793.37, 1],
    ["2025-02-15", "Robinsons", "Peter", 159.00, 1],
    ["2025-02-15", "Furze", "Priyanka", 432.00, 1],
    ["2025-02-15", "Mango / Akira", "Ankush", 659.00, 1],
    ["2025-02-15", "Costech", "Priyanka", 127.50, 1],

    // March 2025 (first batch)
    ["2025-03-15", "Halo Dental Lab", "Ankush", 133.30, 1],
    ["2025-03-15", "Robinsons", "Priyanka", 961.69, 1],
    ["2025-03-15", "Robinsons", "Peter", 604.05, 1],
    ["2025-03-15", "Furze", "Priyanka", 126.00, 1],
    ["2025-03-15", "Furze", "Peter", 237.00, 1],
    ["2025-03-15", "Boutique Practice", "Ankush", 329.00, 1],
    ["2025-03-15", "Mango / Akira", "Ankush", 4293.13, 1],
    ["2025-03-15", "Costech", "Priyanka", 127.50, 1],

    // March 2025 (second batch)
    ["2025-03-20", "Boutique Practice", "Ankush", 1771.20, 1],
    ["2025-03-20", "Queensway", "Hisham", 202.00, 1],
    ["2025-03-20", "Richley", "Ankush", 148.84, 1],
    ["2025-03-20", "Mango / Akira", "Ankush", 1237.77, 1],

    // April 2025
    ["2025-04-15", "Robinsons", "Priyanka", 549.83, 1],
    ["2025-04-15", "Robinsons", "Peter", 618.67, 1],
    ["2025-04-15", "Furze", "Priyanka", 64.14, 1],
    ["2025-04-15", "Furze", "Peter", 130.00, 1],
    ["2025-04-15", "Boutique Practice", "Ankush", 98.00, 1],
    ["2025-04-15", "Boutique Practice", "Ankush", 500.80, 1],
    ["2025-04-15", "Queensway", "Ankush", 670.00, 1],
    ["2025-04-15", "Costech", "Priyanka", 42.50, 1],

    // May 2025
    ["2025-05-15", "Halo Dental Lab", "Ankush", 28.50, 1],
    ["2025-05-15", "Robinsons", "Priyanka", 1186.43, 1],
    ["2025-05-15", "Robinsons", "Peter", 231.07, 1],
    ["2025-05-15", "Furze", "Priyanka", 767.66, 1],
    ["2025-05-15", "Boutique Practice", "Ankush", 607.20, 1],
    ["2025-05-15", "Queensway", "Ankush", 68.00, 1],
    ["2025-05-15", "Costech", "Priyanka", 105.00, 1],

    // June 2025
    ["2025-06-15", "Robinsons", "Priyanka", 259.71, 1],
    ["2025-06-15", "Robinsons", "Peter", 132.91, 1],
    ["2025-06-15", "Furze", "Priyanka", 457.10, 1],
    ["2025-06-15", "Furze", "Peter", 575.00, 1],
    ["2025-06-15", "Furze", "Peter", 208.00, 1],
    ["2025-06-15", "Boutique Practice", "Ankush", 607.20, 1],
    ["2025-06-15", "Costech", "Priyanka", 149.50, 1],

    // July 2025
    ["2025-07-15", "Robinsons", "Priyanka", 48.54, 1],
    ["2025-07-15", "Robinsons", "Peter", 76.08, 1],
    ["2025-07-15", "Furze", "Priyanka", 663.00, 1],
    ["2025-07-15", "Furze", "Peter", 534.00, 1],
    ["2025-07-15", "Boutique Practice", "Ankush", 144.00, 1],
    ["2025-07-15", "Boutique Practice", "Ankush", 650.40, 1],
    ["2025-07-15", "Queensway", "Hisham", 368.00, 1],
    ["2025-07-15", "Queensway", "Zeeshan", 309.00, 1],
    ["2025-07-15", "S4S", "Hisham", 396.00, 1],

    // August 2025
    ["2025-08-15", "Robinsons", "Priyanka", 76.08, 1],
    ["2025-08-15", "Furze", "Priyanka", 356.00, 1],
    ["2025-08-15", "Furze", "Peter", 118.00, 1],
    ["2025-08-15", "Boutique Practice", "Ankush", 52.00, 1],
    ["2025-08-15", "Jordent", "Priyanka", 118.00, 1],
    ["2025-08-15", "Priory", "Peter", 36.00, 1],
    ["2025-08-15", "Optadent", "Priyanka", 126.50, 1],

    // September 2025
    ["2025-09-15", "Boutique Practice", "Ankush", 35.00, 1],
    ["2025-09-15", "S4S", "Ankush", 156.25, 1],
    ["2025-09-15", "Jordent", "Priyanka", 106.00, 1],
    ["2025-09-15", "Priory", "Peter", 393.50, 1],

    // October 2025
    ["2025-10-15", "Robinsons", "Priyanka", 124.62, 1],
    ["2025-10-15", "Furze", "Priyanka", 354.00, 1],
    ["2025-10-15", "Furze", "Peter", 393.00, 1],
    ["2025-10-15", "Queensway", "Ankush", 1076.00, 1],
    ["2025-10-15", "Costech", "Priyanka", 119.00, 1],
    ["2025-10-15", "Jordent", "Priyanka", 582.00, 1],

    // November 2025
    ["2025-11-15", "Robinsons", "Priyanka", 99.80, 1],
    ["2025-11-15", "Furze", "Priyanka", 24.00, 1],
    ["2025-11-15", "Furze", "Peter", 473.00, 1],
    ["2025-11-15", "Boutique Practice", "Ankush", 2233.80, 1],
    ["2025-11-15", "Costech", "Priyanka", 45.00, 1],
    ["2025-11-15", "Jordent", "Priyanka", 62.00, 1],
    ["2025-11-15", "Priory", "Peter", 320.50, 1],
    ["2025-11-15", "Optadent", "Priyanka", 495.00, 1],

    // December 2025
    ["2025-12-15", "Robinsons", "Priyanka", 173.16, 1],
    ["2025-12-15", "Furze", "Peter", 472.00, 1],
    ["2025-12-15", "Boutique Practice", "Ankush", 673.00, 1],
    ["2025-12-15", "Boutique Practice", "Ankush", 547.28, 1],
    ["2025-12-15", "Richley", "Ankush", 309.00, 1],
    ["2025-12-15", "Mango / Akira", "Ankush", 755.00, 1],
    ["2025-12-15", "Jordent", "Priyanka", 137.00, 1],
    ["2025-12-15", "Priory", "Peter", 380.50, 1],
    ["2025-12-15", "Optadent", "Moneeb", 1271.50, 1],

    // January 2026
    ["2026-01-15", "Halo Dental Lab", "Ankush", 5664.00, 1],
    ["2026-01-15", "Robinsons", "Priyanka", 931.00, 1],
    ["2026-01-15", "Furze", "Priyanka", 238.00, 1],
    ["2026-01-15", "Furze", "Peter", 120.00, 1],
    ["2026-01-15", "Boutique Practice", "Ankush", 107.00, 1],
    ["2026-01-15", "Boutique Practice", "Ankush", 237.00, 1],
    ["2026-01-15", "Richley", "Ankush", 63.00, 1],
    ["2026-01-15", "Mango / Akira", "Ankush", 317.13, 1],
    ["2026-01-15", "Jordent", "Priyanka", 518.00, 1],
  ];

  // ============================================================
  // SUPPLIER INVOICE ENTRIES (Utility & Maintenance Bills)
  // Format: [date, supplier_name, amount, paid]
  // ============================================================
  const supplierInvoices: [string, string, number, number][] = [
    // March 2025 (first batch)
    ["2025-03-15", "Breckon Services", 178.14, 1],
    ["2025-03-15", "Sunderland Dental", 205.20, 1],
    ["2025-03-15", "Stockton Council", 820.00, 1],
    ["2025-03-15", "General Medical", 317.76, 1],
    ["2025-03-15", "Hull University (RPA)", 180.00, 1],
    ["2025-03-15", "Orthocare", 35.88, 1],
    ["2025-03-15", "HE Woolley", 125.00, 1],
    ["2025-03-15", "Dentsply Sirona", 136.32, 1],

    // March 2025 (second batch)
    ["2025-03-20", "Breckon Services", 106.20, 1],
    ["2025-03-20", "HE Woolley", 3333.34, 1],

    // April 2025
    ["2025-04-15", "Breckon Services", 324.00, 1],
    ["2025-04-15", "Stockton Council", 4241.50, 1],
    ["2025-04-15", "Hull University (RPA)", 180.00, 1],
    ["2025-04-15", "HE Woolley", 2897.54, 1],
    ["2025-04-15", "Henry Schein", 578.29, 1],

    // May 2025
    ["2025-05-15", "Breckon Services", 318.00, 1],
    ["2025-05-15", "Hull University (RPA)", 366.00, 1],
    ["2025-05-15", "Orthocare", 124.67, 1],
    ["2025-05-15", "HE Woolley", 5627.89, 1],
    ["2025-05-15", "Enlighten", 53.40, 1],

    // June 2025
    ["2025-06-15", "Breckon Services", 427.80, 1],
    ["2025-06-15", "Hull University (RPA)", 180.00, 1],
    ["2025-06-15", "HE Woolley", 5303.06, 1],

    // July 2025
    ["2025-07-15", "Hull University (RPA)", 1176.00, 1],
    ["2025-07-15", "Damas", 275.00, 1],
    ["2025-07-15", "hu mac (legionella man)", 230.00, 1],
    ["2025-07-15", "Bio Horizons", 625.20, 1],
    ["2025-07-15", "Trycare", 277.80, 1],

    // August 2025
    ["2025-08-15", "HE Woolley", 11077.22, 1],

    // September 2025
    ["2025-09-15", "Breckon Services", 554.40, 1],

    // October 2025
    ["2025-10-15", "Breckon Services", 70.80, 1],
    ["2025-10-15", "HE Woolley", 2910.00, 1],
    ["2025-10-15", "Dentsply Sirona", 306.00, 1],

    // November 2025
    ["2025-11-15", "Breckon Services", 100.20, 1],
    ["2025-11-15", "HE Woolley", 9437.29, 1],
    ["2025-11-15", "Trycare", 237.60, 1],
    ["2025-11-15", "ORANGE BOX - BLS TRAINING", 480.00, 1],
    ["2025-11-15", "PHS", 350.92, 1],

    // December 2025
    ["2025-12-15", "ADT ALARMS", 892.67, 1],
    ["2025-12-15", "Breckon Services", 225.00, 1],
    ["2025-12-15", "HE Woolley", 4886.37, 1],
    ["2025-12-15", "Damas", 835.20, 1],
    ["2025-12-15", "Eurodontics", 147.54, 1],

    // December 2025 (additional)
    ["2025-12-20", "Breckon Services", 7554.00, 1],
    ["2025-12-20", "Eurodontics", 410.58, 1],

    // Additional (undated - assign to December 2025)
    ["2025-12-25", "Breckon Services", 1308.00, 1],

    // January 2026
    ["2026-01-15", "Breckon Services", 807.24, 1],
    ["2026-01-15", "HE Woolley", 5852.00, 1],
    ["2026-01-15", "Dentsply Sirona", 70.21, 1],
    ["2026-01-15", "Damas", 288.00, 1],

    // February 2026
    ["2026-02-15", "Breckon Services", 676.94, 0],

    // February 2026 (additional)
    ["2026-02-20", "Orthocare", 22.20, 0],
  ];

  // Insert all lab bills
  let labCount = 0;
  for (const [date, lab_name, dentist, amount, paid] of labBills) {
    const d = new Date(date);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const dentistId = getId(dentist);

    await db.execute({
      sql: `INSERT INTO lab_bill_entries (lab_name, dentist_id, amount, description, date, month, year, paid, paid_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [lab_name, dentistId, amount, "", date, month, year, paid, paid ? date : null],
    });
    labCount++;
  }

  // Insert all supplier invoices
  let supplierCount = 0;
  for (const [date, supplier_name, amount, paid] of supplierInvoices) {
    const d = new Date(date);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    await db.execute({
      sql: `INSERT INTO supplier_invoice_entries (supplier_name, amount, description, date, month, year, paid, paid_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [supplier_name, amount, "", date, month, year, paid, paid ? date : null],
    });
    supplierCount++;
  }

  return NextResponse.json({
    ok: true,
    seeded: {
      saved_labs: savedLabs.length,
      saved_suppliers: savedSuppliers.length,
      lab_bills: labCount,
      supplier_invoices: supplierCount,
    },
  });
}
