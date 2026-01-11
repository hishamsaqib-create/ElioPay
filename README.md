# Aura Dental Clinic - Payslip Generator v4.0

Automatically generates payslips for dentists by pulling data from Dentally.

## What's New in v4.0

### 🔧 Bug Fixes
- **Fixed duplicate "DISCREPANCIES TO REVIEW" header** - The section was appearing twice on each payslip

### 🧪 Lab Bill Automation
- **Automatic lab bill extraction from Google Drive** - Just upload PDFs to the lab bills folder
- **Intelligent dentist detection** - Scans PDFs for dentist names automatically
- **Duplicate prevention** - Tracks assigned bills in "Lab Bills Log" sheet
- **Manual assignment fallback** - Unrecognised bills flagged in "Unassigned Lab Bills" tab

### 📄 PDF Generation & Email
- **Generate PDF payslips** with `--generate-pdfs` flag
- **Email payslips directly to you** with `--email` flag
- **PDF-only mode** for re-generating without running Dentally API

## Features

- 🦷 Pulls patient/invoice data from Dentally API
- 💰 Calculates splits (45% Zeeshan & Ankush, 50% others)
- 🧪 **Auto-extracts lab bills from PDFs** - just upload to Google Drive
- 💳 Deducts finance fees (Tabeo) with term-specific rates
- 🦷 Deducts therapy time (£35/hour for NHS referrals)
- 📊 Updates Google Sheets automatically
- 📄 Generates PDF payslips
- 📧 Emails payslips on demand
- 🚫 Excludes CBCT fees (goes to practice)
- 🔍 Cross-references dentist private takings logs
- ⚠️ Flags items needing manual input
- 🔄 Detects duplicate payments across months

## Lab Bill Processing

### How It Works
1. Jennie uploads lab bill PDFs to: `Lab Bills` folder in Google Drive
2. Organise by lab name in subfolders (Halo, Straumann, Invisalign, etc.)
3. The system automatically:
   - Scans all PDFs in the folder
   - Extracts total amount from each invoice
   - Identifies the dentist from the PDF text
   - Assigns the bill to their payslip (50% deduction)
   - Logs the assignment to prevent double-counting

### Supported Labs
Halo, Straumann, Invisalign, Priory, Scan Digital, Robinsons, Furze, Queensway, Richley, Jordent, Boutique, Costech, Optadent

### Unassigned Bills
If a lab bill cannot be automatically matched to a dentist:
- It appears in the "Unassigned Lab Bills" tab
- Select the dentist from the dropdown
- Tick "Confirm" to assign
- Re-run the generator to apply

## Tabeo Fee Rates (Auto-calculated)

| Term | Subsidy Fee |
|------|-------------|
| 3 months | 4.5% |
| 12 months | 8.0% |
| 36 months | 3.4% |
| 60 months | 3.7% |

## Dentists Configured

| Dentist | Split | UDA Rate |
|---------|-------|----------|
| Zeeshan Abbas | 45% | N/A |
| Peter Throw | 50% | £16 |
| Priyanka Kapoor | 50% | £15 |
| Moneeb Ahmad | 50% | £15 |
| Hani Dalati | 50% | N/A |
| Ankush Patel | 45% | N/A |
| Hisham Saqib | 50% | N/A (Owner) |

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

# Override email recipient
python payslip_generator_v4.py --pdf-only --email --email-to someone@example.com
```

## Setup

### 1. GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DENTALLY_API_TOKEN` | Your Dentally API token |
| `DENTALLY_SITE_ID` | `212f9c01-f4f2-446d-b7a3-0162b135e9d3` |
| `GOOGLE_SHEETS_CREDENTIALS` | Base64-encoded service account JSON |
| `PAYSLIP_SPREADSHEET_ID` | Your Google Sheet ID |
| `EMAIL_SENDER` | Gmail address for sending emails |
| `EMAIL_PASSWORD` | Gmail app password (not your regular password) |
| `HISHAM_EMAIL` | Your email address |

### 2. Google Drive Folders

| Folder | ID | Purpose |
|--------|-----|---------|
| Lab Bills | `16VsBkxhg1DgKYC-SQJtRH9erJdt3v1zR` | Upload lab invoices here |
| Historical Payslips | `1rcE4JFqnNj8jXHUCmQyoPn5DYDKSjNpJ` | For duplicate detection |

### 3. Running the Generator

**Via GitHub Actions:**
1. Go to **Actions** tab
2. Click **Generate Payslips**
3. Click **Run workflow**
4. Select options:
   - Leave year/month empty for previous month
   - Tick `generate_pdfs` to create PDF files
   - Tick `send_email` to email payslips

**Via iPhone Shortcut:**
Send a webhook to:
- `generate-payslips` - Full generation
- `generate-pdfs` - PDF only
- `email-payslips` - Generate and email PDFs

## Google Sheets Structure

| Tab | Purpose |
|-----|---------|
| Dashboard | Summary of all dentist payouts |
| Cross-Reference | Comparison with dentist logs |
| Finance Flags | Items needing finance term entry |
| Duplicate Check | Potential duplicate payments |
| Lab Bills Log | Assigned lab bills (prevents duplicates) |
| Unassigned Lab Bills | Lab bills needing manual assignment |
| Config | System settings and rates |
| [Name] Payslip | Individual dentist payslip |

## Email Setup (Gmail)

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable 2-Step Verification
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Create a new app password for "Mail"
5. Use this password (not your regular Gmail password) as `EMAIL_PASSWORD`

## Troubleshooting

**"Lab bill not assigned to dentist"**
- Check the PDF contains the dentist's name
- If not, assign manually in "Unassigned Lab Bills" tab

**"Email failed to send"**
- Verify `EMAIL_SENDER` and `EMAIL_PASSWORD` are set
- Ensure app password is correct (not regular password)
- Check Gmail didn't block the sign-in

**"Duplicate discrepancies header"**
- You're using v3 - update to v4

## Files in This Package

| File | Description |
|------|-------------|
| `payslip_generator_v4.py` | Main script with all features |
| `setup_sheets_v4.py` | Creates professional sheet structure |
| `main.yml` | GitHub Actions workflow |
| `push_to_sheets.py` | Manual push (unchanged) |
| `requirements.txt` | Python dependencies |
