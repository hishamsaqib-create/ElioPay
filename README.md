# Aura Dental Clinic - Payslip Generator

Automatically generates payslips for dentists by pulling data from Dentally.

## Features

- 🦷 Pulls patient/invoice data from Dentally API
- 💰 Calculates splits (45% Zeeshan, 50% others)
- 🧪 **Auto-extracts lab bills from PDFs** - just upload the PDF!
- 💳 Deducts finance fees (Tabeo) with term-specific rates
- 🦷 Deducts therapy time (£35/hour for NHS referrals)
- 📊 Updates Google Sheets automatically
- 📄 Generates PDF payslips
- 🚫 Excludes CBCT fees (goes to practice)
- 🔍 Cross-references dentist private takings logs
- ⚠️ Flags items needing manual input

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
| Hani Dalati | 50% | £15 |
| Ankush Patel | 50% | £15 |
| Hisham Saqib | 50% | N/A (Owner) |

## Setup

### 1. Create GitHub Repository

1. Create a new private repository on GitHub
2. Upload all files from this folder

### 2. Configure Secrets

Go to **Settings → Secrets → Actions** and add:

| Secret | Value |
|--------|-------|
| `DENTALLY_API_TOKEN` | Your Dentally API token |
| `DENTALLY_SITE_ID` | `212f9c01-f4f2-446d-b7a3-0162b135e9d3` |
| `GOOGLE_SHEETS_CREDENTIALS` | Base64-encoded service account JSON |
| `PAYSLIP_SPREADSHEET_ID` | Your Google Sheet ID |

### 3. Google Sheets Setup

1. Create a new Google Sheet
2. Create a Google Cloud service account:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable "Google Sheets API" and "Google Drive API"
   - Create a Service Account (IAM & Admin → Service Accounts)
   - Create a key (JSON format)
   - Base64 encode it: `base64 -i credentials.json`
   - Add as `GOOGLE_SHEETS_CREDENTIALS` secret
3. Share your Google Sheet with the service account email

### 4. Run the Generator

1. Go to **Actions** tab in GitHub
2. Click **Generate Payslips**
3. Click **Run workflow**
4. Optionally enter year/month (leave empty for previous month)
5. Download PDFs from the workflow artifacts

## Lab Bill Processing

Just upload lab bill PDFs to the designated folder. The system automatically extracts:
- Lab name (from letterhead)
- Dentist name
- Total amount
- Statement month

Supported labs: Furze, Halo, Straumann, Robinsons, Queensway, Richley, Priory, Jordent, Boutique, Costech, Optadent, Scan Digital, Invisalign

## Private Takings Logs (Pre-configured)

The system reads from each dentist's Google Sheet:
- Moneeb Ahmad
- Peter Throw
- Priyanka Kapoor
- Zeeshan Abbas
- Ankush Patel

## Flags System

The system generates flags for items needing manual attention:
- Finance payments without term length → enter 3/12/36/60 months
- Lab bills that couldn't identify dentist → manual assignment
- Discrepancies between Dentally and private takings logs
- Treatment marked paid but not complete

## Troubleshooting

**"Dentally API error"**
- Check your API token is correct
- Ensure token has permissions: patients, invoices, payments, practitioners

**"Google Sheets error"**
- Check service account has access to the sheet
- Verify base64 encoding is correct

**Missing dentist data**
- Ensure dentist names in DENTISTS match Dentally practitioner names
