# Aura Dental Payslip Generator - System Design

## Overview

A fully automated payslip generation system that:
1. Pulls data from Dentally API
2. Extracts lab bills from uploaded PDFs
3. Cross-references dentist private takings logs
4. Flags items needing manual input
5. Generates payslips (Google Sheets + PDF)

---

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Dentally API  │     │  Lab Bill PDFs  │     │ Private Takings │
│  (invoices,     │     │  (uploaded by   │     │ Logs (Google    │
│   payments)     │     │   PM)           │     │  Sheets)        │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PAYSLIP GENERATOR SCRIPT                     │
│  • Pulls Dentally data                                          │
│  • Extracts text from lab PDFs                                  │
│  • Reads private takings logs                                   │
│  • Cross-references & flags discrepancies                       │
│  • Calculates payslips                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Google Sheets  │ │   PDF Payslips  │ │   Flags Report  │
│  (live view)    │ │   (download)    │ │   (manual items)│
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Google Sheet Structure

### Tab 1: Dashboard
Summary view of all dentists for current period:
| Dentist | Gross Private | Split | Net Private | Lab Bills | Finance Fees | Therapy | Total Deductions | Net Pay | Status |
|---------|---------------|-------|-------------|-----------|--------------|---------|------------------|---------|--------|
| Zeeshan | £42,420 | 45% | £19,089 | £2,245 | £223 | £0 | £2,468 | £16,621 | ✅ Ready |
| Peter | £4,365 | 50% | £2,183 | £524 | £0 | £548 | £1,072 | £1,111 | ⚠️ 2 flags |

### Tab 2: Lab Bills Input
Where PM uploads/enters lab bills:
| Month | Lab Name | Patient Name | Dentist | Amount | Invoice Link | Status |
|-------|----------|--------------|---------|--------|--------------|--------|
| Nov 25 | Halo | John Smith | Zeeshan | £500 | [link] | ✅ Assigned |
| Nov 25 | Straumann | Jane Doe | Zeeshan | £350 | [link] | ✅ Assigned |
| Nov 25 | Furze | Unknown | - | £200 | [link] | ⚠️ Need dentist |

### Tab 3: Finance Flags
Items needing manual term duration:
| Patient Name | Amount | Payment Date | Term (months) | Subsidy % | Status |
|--------------|--------|--------------|---------------|-----------|--------|
| John Bareham | £9,770 | 15/10/2025 | - | - | ⚠️ Enter term |
| Sarah Smith | £4,150 | 18/10/2025 | 12 | 8% | ✅ Done |

### Tab 4: Discrepancies
Cross-reference results:
| Dentist | Patient | In Dentally | In Takings Log | Difference | Issue |
|---------|---------|-------------|----------------|------------|-------|
| Peter | John Doe | £450 | £500 | £50 | Amount mismatch |
| Zeeshan | Jane Doe | £0 | £800 | £800 | Not in Dentally |
| Priyanka | Bob Smith | £300 (unpaid) | £300 | £0 | Not marked complete |

### Tab 5: Incomplete Treatment
Items paid but not marked complete:
| Patient | Dentist | Amount | Paid Date | In Takings Log | Action Needed |
|---------|---------|--------|-----------|----------------|---------------|
| John Smith | Zeeshan | £450 | 10/10/25 | ✅ Yes | Mark complete in Dentally |

### Tabs 6-11: Individual Payslips
One tab per dentist with full payslip format matching your current design.

### Tab 12: Config
Settings and configuration:
| Setting | Value |
|---------|-------|
| Pay Period | November 2025 |
| Tabeo 3mo Rate | 4.5% |
| Tabeo 12mo Rate | 8.0% |
| Tabeo 36mo Rate | 3.4% |
| Tabeo 60mo Rate | 3.7% |
| Therapy Rate/Min | £0.583 |
| Lab Bill Split | 50% |
| Finance Fee Split | 50% |

---

## Lab Bill PDF Processing

### How it works:
1. PM uploads lab bill PDF to designated Google Drive folder
2. Script detects new PDFs
3. Extracts text using OCR/PDF parsing
4. Identifies:
   - Lab name (from header/letterhead)
   - Patient names
   - Amounts
   - Dates
5. Auto-matches patients to dentists (via Dentally patient records)
6. Any unmatched items flagged for manual assignment

### Supported Labs:
- Halo
- Straumann
- Robinsons
- Furze
- Queensway
- Richley
- Priory
- Jordent
- Boutique
- Costech
- Optadent
- Scan Digital

---

## Private Takings Log Integration

### Required Access:
Links to each dentist's private takings Google Sheet (read-only)

### What we check:
1. Patient names in their log vs Dentally
2. Amounts match
3. Dates match
4. Treatment marked complete in Dentally

### Flags generated:
- "In log but not in Dentally" → Might need to mark complete
- "Amount mismatch" → Investigate
- "In Dentally but not in log" → Dentist forgot to log

---

## Manual Input Flags

### Finance Terms
For each finance payment, we need the term to calculate correct subsidy:
- 3 months → 4.5%
- 12 months → 8.0%
- 36 months → 3.4%
- 60 months → 3.7%

Script will:
1. Detect all finance payments in period
2. Create list in "Finance Flags" tab
3. PM enters term for each
4. Script recalculates with correct rate

### Other Manual Items
- Lab bills without patient names
- Unusual adjustments
- Refunds/credits

---

## Workflow

### Monthly Process (around 10th-14th):

1. **PM uploads lab bills** (throughout month or at end)
   - Drop PDFs into Google Drive folder
   - Script extracts and populates Lab Bills tab

2. **Run payslip generator** (click button / shortcut)
   - Pulls Dentally data for previous month
   - Reads lab bills from sheet
   - Reads private takings logs
   - Generates flags report

3. **Review flags** (PM/Hisham)
   - Enter missing finance terms
   - Assign unmatched lab bills
   - Review discrepancies
   - Mark incomplete treatments as complete in Dentally

4. **Re-run generator** (if needed)
   - Updates calculations with manual inputs

5. **Generate final payslips**
   - PDFs created
   - Email to Hisham for review
   - Forward to dentists

---

## Setup Requirements

### 1. Google Cloud Service Account
- Create project
- Enable Sheets API, Drive API
- Create service account
- Share spreadsheet with service account email

### 2. Google Drive Folder
- Create "Lab Bills" folder
- Share with service account
- PM uploads PDFs here

### 3. Private Takings Logs
- Get share links for each dentist's log
- Add as read-only to config

### 4. GitHub Secrets
```
DENTALLY_API_TOKEN=0GTtAUwjjP7SAfn-k_l2a-_fxBz0PIoDt5vPq8xgwmU
DENTALLY_SITE_ID=212f9c01-f4f2-446d-b7a3-0162b135e9d3
GOOGLE_SHEETS_CREDENTIALS=[base64 encoded JSON]
PAYSLIP_SPREADSHEET_ID=[sheet ID]
LAB_BILLS_FOLDER_ID=[Google Drive folder ID]
```

---

## Next Steps

1. ✅ Core script created
2. ⏳ Test Dentally API connection
3. ⏳ Create Google Sheet with proper structure
4. ⏳ Add lab bill PDF extraction
5. ⏳ Add private takings log reading
6. ⏳ Add cross-reference logic
7. ⏳ Add flags system
8. ⏳ Create iPhone shortcut
