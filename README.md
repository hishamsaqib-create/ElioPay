# Aura Dental Clinic - Payslip Generator v4.0

Automatically generates payslips for dentists by pulling data from Dentally.

## What's New in v4.0

### 🔧 Bug Fixes
- **Fixed duplicate "DISCREPANCIES TO REVIEW" header** - The section was appearing twice on each payslip
- **Fixed percentage display** - Now shows "50%" instead of "£0.50" in cell E12
- **Fixed patient sorting** - Now sorted chronologically (start to end of month)

### 🧪 Lab Bill Automation
- **Automatic lab bill extraction from Google Drive** - Just upload PDFs to the lab bills folder
- **Intelligent dentist detection** - Scans PDFs for dentist names automatically
- **Duplicate prevention** - Tracks assigned bills in "Lab Bills Log" sheet
- **Manual assignment fallback** - Unrecognised bills flagged in "Unassigned Lab Bills" tab

### 📋 NHS Statement Processing (Peter, Priyanka, Moneeb)
- **Upload NHS statements** to a shared folder
- **Auto-extracts UDAs** per dentist from the statement
- **Adds NHS income** to individual payslips
- **Tracks processed statements** in "NHS Statements Log" tab

### 🔄 4-Way Reconciliation
- **Previous Payslips** - What was already paid to dentist historically
- **Current Claim** - What's being claimed now in Dentally
- **Private Log** - What dentist recorded in their takings log
- **Cumulative Total** - Running total per patient
- Flags potential duplicates and mismatches in "Reconciliation" tab

### 📝 Discrepancy Actions
- **Add to Pay** - Adds amount to gross total
- **Remove from Pay** - Removes amount from gross total  
- **Update Amount** - Replaces with new amount
- Tick "Confirm" and re-run to apply changes

### 📄 PDF Generation & Email
- **Generate PDF payslips** with `--generate-pdfs` flag
- **Email payslips directly to you** with `--email` flag
- **PDF-only mode** for re-generating without running Dentally API

## Features

- 🦷 Pulls patient/invoice data from Dentally API
- 💰 Calculates splits (45% Zeeshan & Ankush, 50% others)
- 🧪 **Auto-extracts lab bills from PDFs** - just upload to Google Drive
- 📋 **Auto-processes NHS statements** for UDA income
- 🔄 **4-way reconciliation** to catch duplicates
- 💳 Deducts finance fees (Tabeo) with term-specific rates
- 🦷 Deducts therapy time (£35/hour for NHS referrals)
- 📊 Updates Google Sheets automatically
- 📄 Generates PDF payslips
- 📧 Emails payslips on demand
- 🚫 Excludes CBCT fees (goes to practice)
- 🔍 Cross-references dentist private takings logs
- ⚠️ Flags items needing manual input

## Google Drive Folders Required

| Folder | Purpose | Share with Service Account |
|--------|---------|---------------------------|
| Lab Bills | Upload lab invoices (subfolders by lab name) | ✅ Viewer |
| Historical Payslips | Previous payslip PDFs (subfolders by dentist) | ✅ Viewer |
| NHS Statements | Upload NHS statement PDFs | ✅ Viewer |

## Google Sheets Tabs

| Tab | Purpose |
|-----|---------|
| Dashboard | Summary of all dentist payouts |
| Cross-Reference | Comparison with dentist logs |
| **Reconciliation** | 4-way comparison (NEW) |
| Finance Flags | Items needing finance term entry |
| Duplicate Check | Potential duplicate payments |
| Lab Bills Log | Assigned lab bills (prevents duplicates) |
| Unassigned Lab Bills | Lab bills needing manual assignment |
| **NHS Statements Log** | Processed NHS statements (NEW) |
| Config | System settings and rates |
| [Name] Payslip | Individual dentist payslip |

## Command Line Options

```bash
# Full payslip generation (default)
python payslip_generator_v4.py

# Specific month
python payslip_generator_v4.py --year 2025 --month 12

# Generate PDFs after calculation
python payslip_generator_v4.py --generate-pdfs

# Generate PDFs and email them
python payslip_generator_v4.py --generate-pdfs --email

# PDF-only mode (skip Dentally API, read from sheets)
python payslip_generator_v4.py --pdf-only

# Email PDFs directly
python payslip_generator_v4.py --pdf-only --email
```

## Setup

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `DENTALLY_API_TOKEN` | Your Dentally API token |
| `DENTALLY_SITE_ID` | `212f9c01-f4f2-446d-b7a3-0162b135e9d3` |
| `GOOGLE_SHEETS_CREDENTIALS` | Base64-encoded service account JSON |
| `PAYSLIP_SPREADSHEET_ID` | Your Google Sheet ID |
| `EMAIL_SENDER` | Gmail address for sending emails |
| `EMAIL_PASSWORD` | Gmail app password |
| `HISHAM_EMAIL` | Your email address |
| `NHS_STATEMENTS_FOLDER_ID` | Google Drive folder ID for NHS statements |

### NHS Dentists

| Dentist | UDA Rate |
|---------|----------|
| Peter Throw | £16 |
| Priyanka Kapoor | £15 |
| Moneeb Ahmad | £15 |

## How Reconciliation Works

For each patient, the system compares:

1. **Previously Paid** - Scans all historical payslip PDFs to find payments made
2. **Current Claim** - What Dentally shows as the current invoice amount
3. **Private Log** - What the dentist recorded in their private takings spreadsheet
4. **Cumulative Total** - Sum of all historical + current

**Flags:**
- ⚠️ DUPLICATE - Same amount paid before (exact match)
- 🔍 CHECK - Patient paid before, verify this is new work
- 📊 MISMATCH - Log amount differs from claim amount
- ✅ OK - All sources agree

## Files

| File | Description |
|------|-------------|
| `payslip_generator_v4.py` | Main script with all features |
| `setup_sheets_v4.py` | Creates professional sheet structure |
| `main.yml` | GitHub Actions workflow |
