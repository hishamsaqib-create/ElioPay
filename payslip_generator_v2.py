#!/usr/bin/env python3
"""
Aura Dental Clinic - Payslip Generator v2.3
Matches original PDF design exactly - clean, professional, no messy colors
"""

import os
import json
import base64
import requests
import time
from datetime import datetime, timedelta
from collections import defaultdict

import gspread
from google.oauth2.service_account import Credentials

# =============================================================================
# CONFIGURATION
# =============================================================================

DENTALLY_API_TOKEN = os.environ.get("DENTALLY_API_TOKEN", "")
DENTALLY_SITE_ID = os.environ.get("DENTALLY_SITE_ID", "212f9c01-f4f2-446d-b7a3-0162b135e9d3")
DENTALLY_API_BASE = "https://api.dentally.co/v1"

GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
SPREADSHEET_ID = os.environ.get("PAYSLIP_SPREADSHEET_ID", "1BANM1mdxxtjLAHHc8jSkchHHNbiRC474phtMEINeYHs")

PRACTICE_NAME = "Aura Dental Clinic"
LOGO_FILE_ID = "1Z4d-u7P8XzOOm3IKyssYrRD0o_jZ5fjd"

DENTISTS = {
    "Zeeshan Abbas": {"practitioner_id": 283516, "split": 0.45, "uda_rate": None, "has_nhs": False},
    "Peter Throw": {"practitioner_id": 189357, "split": 0.50, "uda_rate": 16, "has_nhs": True},
    "Priyanka Kapoor": {"practitioner_id": 189361, "split": 0.50, "uda_rate": 15, "has_nhs": True},
    "Moneeb Ahmad": {"practitioner_id": 293046, "split": 0.50, "uda_rate": 15, "has_nhs": True},
    "Hani Dalati": {"practitioner_id": 263970, "split": 0.50, "uda_rate": None, "has_nhs": False},
    "Ankush Patel": {"practitioner_id": 110701, "split": 0.45, "uda_rate": None, "has_nhs": False},
    "Hisham Saqib": {"practitioner_id": 127844, "split": 0.50, "uda_rate": None, "has_nhs": False},
}

THERAPIST_ID = 288298
PRACTITIONER_TO_DENTIST = {config["practitioner_id"]: name for name, config in DENTISTS.items() if config["practitioner_id"]}

PRIVATE_TAKINGS_LOGS = {
    "Moneeb Ahmad": "1Y-cSU-8rZHr3uHswaZjY2MA0umZT3rxcws6nvwGIMFo",
    "Peter Throw": "1vdKw3_hDWHaenh7OUjrwTdvN-zvf1a8dR45K08HLxr0",
    "Priyanka Kapoor": "13EDcD6zfOdrBwUzQmn9rPXboCTUFeYiuaRHO-gCrjlo",
    "Zeeshan Abbas": "1NWwKzMO7B12WjDnkp-MiKF4j1ge4T6yICSE1anKJhxQ",
    "Ankush Patel": "111HtVp2ShaJm9fxzuaRHNGBWUGRq831joUfawCfevUg",
}

LAB_BILL_SPLIT = 0.50
FINANCE_FEE_SPLIT = 0.50
THERAPY_RATE_PER_MINUTE = 0.583333

EXCLUDED_TREATMENTS = ["CBCT", "CT Scan", "Cone Beam"]
NHS_BAND_KEYWORDS = ["band 1", "band 2", "band 3", "band urgent", "nhs band", "nhs urgent"]
NHS_BAND_AMOUNTS = [27.40, 75.30, 326.70, 47.90, 299.30, 251.40, 26.80, 73.50, 319.10, 23.80, 46.70]


def is_nhs_treatment(item_name, item_amount):
    item_name_lower = item_name.lower() if item_name else ""
    for kw in NHS_BAND_KEYWORDS:
        if kw in item_name_lower:
            return True
    for amt in NHS_BAND_AMOUNTS:
        if abs(item_amount - amt) < 0.01:
            return True
    return item_amount == 0


# =============================================================================
# API FUNCTIONS
# =============================================================================

def dentally_request(endpoint, params=None):
    url = f"{DENTALLY_API_BASE}/{endpoint}"
    headers = {"Authorization": f"Bearer {DENTALLY_API_TOKEN}", "Content-Type": "application/json"}
    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        return response.json() if response.status_code == 200 else None
    except:
        return None


def get_invoices_for_period(start_date, end_date):
    print(f"   Fetching invoices...")
    all_invoices = []
    page = 1
    while True:
        params = {"dated_on_after": start_date.strftime("%Y-%m-%d"), "dated_on_before": end_date.strftime("%Y-%m-%d"), "site_id": DENTALLY_SITE_ID, "page": page, "per_page": 100}
        data = dentally_request("invoices", params)
        if not data:
            break
        invoices = data.get("invoices", [])
        if not invoices:
            break
        for inv in invoices:
            amount = float(inv.get("amount", 0))
            balance = float(inv.get("balance", 0))
            if amount > 0:
                inv["_amount"] = amount
                inv["_balance"] = balance
                inv["_is_paid"] = inv.get("paid", False)
                inv["_invoice_date"] = inv.get("dated_on", "")
                all_invoices.append(inv)
        if len(invoices) < 100:
            break
        page += 1
    print(f"   Found {len(all_invoices)} invoices")
    return all_invoices


def get_invoice_details(invoice_id):
    return dentally_request(f"invoices/{invoice_id}")


def get_patient_name(patient_id):
    data = dentally_request(f"patients/{patient_id}")
    if data and data.get("patient"):
        p = data["patient"]
        return f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
    return "Unknown"


def get_payments_for_period(start_date, end_date):
    all_payments = []
    page = 1
    while True:
        params = {"dated_after": start_date.strftime("%Y-%m-%d"), "dated_before": end_date.strftime("%Y-%m-%d"), "page": page, "per_page": 100}
        data = dentally_request("payments", params)
        if not data:
            break
        payments = data.get("payments", [])
        if not payments:
            break
        all_payments.extend(payments)
        if page >= data.get("meta", {}).get("total_pages", 1):
            break
        page += 1
    return all_payments


def build_invoice_payment_map(payments):
    m = {}
    for p in payments:
        method = p.get("method", "Unknown")
        for ex in p.get("explanations", []):
            inv_id = ex.get("invoice_id")
            if inv_id:
                m[inv_id] = method
    return m


# =============================================================================
# GOOGLE SHEETS
# =============================================================================

def get_sheets_client():
    if not GOOGLE_SHEETS_CREDENTIALS:
        return None
    try:
        creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
        creds = Credentials.from_service_account_info(creds_dict, scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'])
        return gspread.authorize(creds)
    except Exception as e:
        print(f"   ⚠️ Auth error: {e}")
        return None


def update_dashboard(spreadsheet, payslips, period_str):
    """Update Dashboard"""
    print("   Updating Dashboard...")
    try:
        sh = spreadsheet.worksheet("Dashboard")
    except:
        sh = spreadsheet.add_worksheet(title="Dashboard", rows=50, cols=15)
    sh.clear()
    
    rows = [
        ["AURA DENTAL CLINIC - PAYROLL", "", "", "", "", "", f'=IMAGE("https://drive.google.com/uc?export=view&id={LOGO_FILE_ID}", 2)'],
        [""],
        ["Pay Period:", period_str, "", "Generated:", datetime.now().strftime('%d/%m/%Y')],
        [""],
        ["Dentist", "Gross Private", "Split", "Subtotal", "Deductions", "Total Payment", "Status"],
    ]
    
    total_gross = 0
    total_payment = 0
    
    for name in DENTISTS.keys():
        if name in payslips:
            p = payslips[name]
            config = DENTISTS[name]
            rows.append([
                name,
                f"£{p['gross_total']:,.2f}",
                f"{int(config['split']*100)}%",
                f"£{p['net_private']:,.2f}",
                f"£{p['total_deductions']:,.2f}",
                f"£{p['total_payment']:,.2f}",
                "✅" if p['total_payment'] > 0 else "⏳"
            ])
            total_gross += p['gross_total']
            total_payment += p['total_payment']
    
    rows.append([""])
    rows.append(["TOTAL", f"£{total_gross:,.2f}", "", "", "", f"£{total_payment:,.2f}"])
    
    sh.update(values=rows, range_name='A1')
    sh.format('A1', {'textFormat': {'bold': True, 'fontSize': 14}})
    sh.format('A5:G5', {'textFormat': {'bold': True}})
    time.sleep(1)


def update_dentist_payslip(spreadsheet, dentist_name, payslip, period_str):
    """
    Create payslip matching ORIGINAL PDF design exactly:
    - Logo top right
    - Clean sections
    - Patient Breakdown table with proper columns
    - No random colors
    """
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
    except:
        sh = spreadsheet.add_worksheet(title=tab_name, rows=500, cols=8)
    sh.clear()
    
    config = DENTISTS[dentist_name]
    split_pct = int(config['split'] * 100)
    
    # Payment date = 15th of next month
    try:
        period_date = datetime.strptime(period_str, "%B %Y")
        if period_date.month == 12:
            payment_date = datetime(period_date.year + 1, 1, 15)
        else:
            payment_date = datetime(period_date.year, period_date.month + 1, 15)
        payment_str = payment_date.strftime("%d %B %Y")
    except:
        payment_str = "15th of following month"
    
    # Build payslip matching PDF exactly
    rows = [
        # Header with logo in column G
        ["Payslip Date:", payment_str, "", "", "", "", f'=IMAGE("https://drive.google.com/uc?export=view&id={LOGO_FILE_ID}", 2)'],
        ["Private Period", period_str],
        ["Performer:", f"Dr {dentist_name}"],
        ["Practice:", PRACTICE_NAME],
        ["Superannuation Status:", "Opted Out"],
        [""],
        # Section 1: Private Fees
        ["Section 1: Private Fees"],
        ["", "", "", "Gross Private by Dentist", "", "", f"£{payslip['gross_private_dentist']:,.2f}"],
        ["", "", "", "Gross Private by Therapist", "", "", f"£{payslip['gross_private_therapist']:,.2f}"],
        ["", "", "", "Gross Total", "", "", f"£{payslip['gross_total']:,.2f}"],
        [f"Subtotal", "", "", f"{split_pct}%", "", "", f"£{payslip['net_private']:,.2f}"],
        [""],
        # Section 2: Deductions
        ["Section 2: Deductions"],
        ["", "", "Labs", "Halo", "", "", f"£{payslip.get('lab_halo', 0):,.2f}"],
        ["", "", "", "Straumann", "", "", f"£{payslip.get('lab_straumann', 0):,.2f}"],
        ["", "", "", "Robinsons", "", "", f"£{payslip.get('lab_robinsons', 0):,.2f}"],
        ["", "", "", "Lab Bills Total", "", "", f"£{payslip['lab_bills_total']:,.2f}"],
        [""],
        ["", "", "", "Lab Bills 50%", "", "", f"£{payslip['lab_bills_50']:,.2f}"],
        [""],
        ["", "", "Finance Fees", "", "", "", f"£{payslip['finance_fees_total']:,.2f}"],
        ["", "", "", "50%", "", "", f"£{payslip['finance_fees_50']:,.2f}"],
        [""],
        ["", "", "Therapy", "Taryn", f"£{THERAPY_RATE_PER_MINUTE:.2f}", "", f"£{payslip['therapy_total']:,.2f}"],
        ["Total Deductions", "", "", "", "", "", f"£{payslip['total_deductions']:,.2f}"],
        [""],
        # Total Payment
        ["Total Payment", "", "", "", "", "", f"£{payslip['total_payment']:,.2f}"],
        [""],
        # Patient Breakdown
        ["Patient Breakdown", "Completion Date", "Lab Bills", "Finance Fee", "Finance Fee 50%", "Therapist", "Paid"],
        [""],
    ]
    
    # Add patient rows
    for patient in payslip.get('patients', []):
        rows.append([
            patient['name'],
            patient.get('date', ''),
            "",  # Lab Bills
            "",  # Finance Fee
            "",  # Finance Fee 50%
            "",  # Therapist
            f"£{patient['amount']:,.2f}"
        ])
    
    # Add blank rows before discrepancies
    rows.append([""])
    rows.append([""])
    
    sh.update(values=rows, range_name='A1')
    
    # Minimal formatting - just bold headers, no random colors
    sh.format('A7', {'textFormat': {'bold': True}})  # Section 1
    sh.format('A13', {'textFormat': {'bold': True}})  # Section 2
    sh.format('A25', {'textFormat': {'bold': True}})  # Total Deductions
    sh.format('A27', {'textFormat': {'bold': True}})  # Total Payment
    sh.format('A29:G29', {'textFormat': {'bold': True}})  # Patient Breakdown header
    
    time.sleep(1)
    return len(rows)


def update_payslip_discrepancies(spreadsheet, dentist_name, xref):
    """Add discrepancies section - clean, no random colors"""
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
    except:
        return
    
    existing = sh.get_all_values()
    next_row = len(existing) + 2
    
    rows = []
    yellow_cells = []  # Track cells needing yellow background
    current_row = next_row
    
    # Header
    rows.append(["═" * 50])
    current_row += 1
    rows.append(["DISCREPANCIES TO REVIEW"])
    current_row += 1
    rows.append(["Enter correct amount in yellow column, then use menu to add"])
    current_row += 1
    rows.append([""])
    current_row += 1
    
    has_any = False
    
    # 1. IN LOG BUT NOT IN DENTALLY
    log_only = xref.get("log_only", [])
    if log_only:
        has_any = True
        rows.append(["🔴 IN LOG BUT NOT IN DENTALLY"])
        current_row += 1
        rows.append(["Patient", "Treatment", "Date", "Original £", "Correct £"])
        current_row += 1
        for item in log_only:
            rows.append([item.get("patient", ""), item.get("treatment", ""), item.get("date", ""), f"£{item.get('amount', 0):,.2f}", ""])
            yellow_cells.append((current_row, 5))  # Column E
            current_row += 1
        rows.append([""])
        current_row += 1
    
    # 2. AMOUNT MISMATCHES
    amount_mismatch = xref.get("amount_mismatch", [])
    if amount_mismatch:
        has_any = True
        rows.append(["🟡 AMOUNT MISMATCHES"])
        current_row += 1
        rows.append(["Patient", "Date", "Dentally £", "Log £", "Correct £"])
        current_row += 1
        for item in amount_mismatch:
            rows.append([item.get("patient", ""), item.get("date", ""), f"£{item.get('dentally_amount', 0):,.2f}", f"£{item.get('log_amount', 0):,.2f}", ""])
            yellow_cells.append((current_row, 5))  # Column E
            current_row += 1
        rows.append([""])
        current_row += 1
    
    # 3. IN DENTALLY BUT NOT IN LOG
    dentally_only = xref.get("dentally_only", [])
    if dentally_only:
        has_any = True
        rows.append(["🔵 IN DENTALLY BUT NOT IN LOG (already included - remove if needed)"])
        current_row += 1
        rows.append(["Patient", "Date", "Amount", "Adjust £"])
        current_row += 1
        for item in dentally_only:
            rows.append([item.get("patient", ""), item.get("date", ""), f"£{item.get('amount', 0):,.2f}", ""])
            yellow_cells.append((current_row, 4))  # Column D
            current_row += 1
        rows.append([""])
        current_row += 1
    
    if not has_any:
        rows.append(["✅ No discrepancies - all items match!"])
    
    # Write data
    sh.update(values=rows, range_name=f'A{next_row}')
    
    # Apply yellow background ONLY to Correct £ cells
    if yellow_cells:
        try:
            sheet_id = sh.id
            requests = []
            for row_num, col_num in yellow_cells:
                requests.append({
                    'repeatCell': {
                        'range': {'sheetId': sheet_id, 'startRowIndex': row_num - 1, 'endRowIndex': row_num, 'startColumnIndex': col_num - 1, 'endColumnIndex': col_num},
                        'cell': {'userEnteredFormat': {'backgroundColor': {'red': 1.0, 'green': 1.0, 'blue': 0.7}}},
                        'fields': 'userEnteredFormat.backgroundColor'
                    }
                })
            if requests:
                spreadsheet.batch_update({'requests': requests})
        except Exception as e:
            print(f"      Note: {e}")
    
    # Bold the header
    sh.format(f'A{next_row + 1}', {'textFormat': {'bold': True}})
    
    time.sleep(1)
    print(f"   ✅ Discrepancies added to {tab_name}")


def update_finance_flags(spreadsheet, finance_flags):
    """Update Finance Flags with dropdown"""
    print("   Updating Finance Flags...")
    try:
        sh = spreadsheet.worksheet("Finance Flags")
    except:
        sh = spreadsheet.add_worksheet(title="Finance Flags", rows=200, cols=10)
    sh.clear()
    
    rows = [
        ["FINANCE PAYMENTS"],
        ["Select term (months) to calculate fee"],
        [""],
        ["Patient", "Dentist", "Amount", "Date", "Term", "Rate %", "Fee", "Status"],
    ]
    
    for flag in finance_flags:
        rows.append([flag['patient'], flag['dentist'], f"£{flag['amount']:,.2f}", flag['date'], "", "", "", "Select term"])
    
    sh.update(values=rows, range_name='A1')
    
    # Add dropdown
    if finance_flags:
        try:
            sheet_id = sh.id
            spreadsheet.batch_update({'requests': [{
                'setDataValidation': {
                    'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 4 + len(finance_flags), 'startColumnIndex': 4, 'endColumnIndex': 5},
                    'rule': {'condition': {'type': 'ONE_OF_LIST', 'values': [{'userEnteredValue': '3'}, {'userEnteredValue': '12'}, {'userEnteredValue': '36'}, {'userEnteredValue': '60'}]}, 'showCustomUi': True}
                }
            }]})
        except:
            pass
    
    sh.format('A1', {'textFormat': {'bold': True}})
    sh.format('A4:H4', {'textFormat': {'bold': True}})
    time.sleep(1)


def update_cross_reference(spreadsheet, xref_results, period_str):
    """Update Cross-Reference tab"""
    print("   Updating Cross-Reference...")
    try:
        sh = spreadsheet.worksheet("Cross-Reference")
    except:
        sh = spreadsheet.add_worksheet(title="Cross-Reference", rows=100, cols=12)
    sh.clear()
    
    rows = [
        ["CROSS-REFERENCE REPORT", "", f"Period: {period_str}"],
        [""],
        ["Dentist", "Dentally", "Log", "Difference", "Status", "Matched", "Mismatched", "Log Only", "Dentally Only"],
    ]
    
    for name, xref in xref_results.items():
        if "error" in xref:
            rows.append([name, f"£{xref.get('dentally_total', 0):,.2f}", "⚠️ " + xref["error"]])
        else:
            diff = xref["difference"]
            rows.append([
                name,
                f"£{xref['dentally_total']:,.2f}",
                f"£{xref['log_total']:,.2f}",
                f"£{diff:,.2f}",
                "✅" if abs(diff) <= 10 else "⚠️",
                len(xref["matched"]),
                len(xref["amount_mismatch"]),
                len(xref["log_only"]),
                len(xref["dentally_only"])
            ])
    
    sh.update(values=rows, range_name='A1')
    sh.format('A1', {'textFormat': {'bold': True}})
    sh.format('A3:I3', {'textFormat': {'bold': True}})
    time.sleep(1)


# =============================================================================
# CROSS-REFERENCE
# =============================================================================

def normalize_name(name):
    return " ".join(str(name or "").lower().strip().split())


def fuzzy_match_name(n1, n2):
    n1, n2 = normalize_name(n1), normalize_name(n2)
    if not n1 or not n2:
        return 0.0
    if n1 == n2:
        return 1.0
    if n1 in n2 or n2 in n1:
        return 0.8
    p1, p2 = n1.split(), n2.split()
    if p1 and p2 and p1[-1] == p2[-1]:
        return 0.7
    return 0.0


def read_dentist_log(client, spreadsheet_id, month, year, max_retries=3):
    """Read dentist log with retry for 503 errors"""
    for attempt in range(max_retries):
        try:
            spreadsheet = client.open_by_key(spreadsheet_id)
            break
        except Exception as e:
            if '503' in str(e) or 'unavailable' in str(e).lower():
                if attempt < max_retries - 1:
                    wait = (attempt + 1) * 5
                    print(f"      ⏳ Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                    continue
            print(f"      ⚠️ Error: {e}")
            return None
    else:
        return None
    
    month_names = {1: ["JANUARY", "JAN"], 2: ["FEBRUARY", "FEB"], 3: ["MARCH", "MAR"], 4: ["APRIL", "APR"], 5: ["MAY"], 6: ["JUNE", "JUN"], 7: ["JULY", "JUL"], 8: ["AUGUST", "AUG"], 9: ["SEPTEMBER", "SEP"], 10: ["OCTOBER", "OCT"], 11: ["NOVEMBER", "NOV"], 12: ["DECEMBER", "DEC"]}
    year_short = str(year)[2:]
    
    possible = []
    for name in month_names.get(month, []):
        possible.extend([f"{name} {year_short}", f"{name} {year}", f"{name.lower()} {year_short}"])
    
    sheet = None
    for tab in possible:
        for ws in spreadsheet.worksheets():
            if ws.title.lower().strip() == tab.lower().strip():
                sheet = ws
                break
        if sheet:
            break
    
    if not sheet:
        return None
    
    print(f"      Found: {sheet.title}")
    data = sheet.get_all_values()
    
    header_row = None
    for i, row in enumerate(data):
        row_lower = [str(c).lower() for c in row]
        if "date" in row_lower and "patient" in " ".join(row_lower):
            header_row = i
            break
    
    if header_row is None:
        return None
    
    entries = []
    current_date = None
    for row in data[header_row + 1:]:
        if len(row) < 4:
            continue
        if any("total" in str(c).lower() for c in row):
            break
        
        date_val, patient_val, treatment_val, amount_val = row[0], row[1], row[2], row[3]
        if date_val and str(date_val).strip():
            current_date = str(date_val).strip()
        if not patient_val or not str(patient_val).strip():
            continue
        
        try:
            amount = float(str(amount_val).replace("£", "").replace(",", "").strip() or 0)
        except:
            amount = 0
        
        if amount > 0:
            entries.append({"patient": str(patient_val).strip(), "amount": amount, "date": current_date, "treatment": str(treatment_val).strip()})
    
    print(f"      {len(entries)} entries, £{sum(e['amount'] for e in entries):,.2f}")
    return entries


def cross_reference_dentist(dentist_name, dentally_patients, log_entries):
    result = {"dentist": dentist_name, "dentally_total": sum(p["amount"] for p in dentally_patients), "log_total": sum(e["amount"] for e in log_entries) if log_entries else 0, "matched": [], "dentally_only": [], "log_only": [], "amount_mismatch": []}
    result["difference"] = result["dentally_total"] - result["log_total"]
    
    if not log_entries:
        result["dentally_only"] = [{"patient": dp["name"], "amount": dp["amount"], "date": dp.get("date", "")} for dp in dentally_patients]
        return result
    
    log_matched = [False] * len(log_entries)
    for dp in dentally_patients:
        best_match, best_score, best_idx = None, 0, -1
        for i, le in enumerate(log_entries):
            if log_matched[i]:
                continue
            score = fuzzy_match_name(dp["name"], le["patient"])
            if score > best_score:
                best_score, best_match, best_idx = score, le, i
        
        if best_score >= 0.6:
            log_matched[best_idx] = True
            if abs(dp["amount"] - best_match["amount"]) <= 1:
                result["matched"].append({"patient": dp["name"], "dentally_amount": dp["amount"], "log_amount": best_match["amount"]})
            else:
                result["amount_mismatch"].append({"patient": dp["name"], "dentally_amount": dp["amount"], "log_amount": best_match["amount"], "date": dp.get("date", "")})
        else:
            result["dentally_only"].append({"patient": dp["name"], "amount": dp["amount"], "date": dp.get("date", "")})
    
    for i, le in enumerate(log_entries):
        if not log_matched[i]:
            result["log_only"].append({"patient": le["patient"], "amount": le["amount"], "date": le.get("date", ""), "treatment": le.get("treatment", "")})
    
    return result


def perform_cross_reference(client, payslips, month, year):
    print("\n🔍 CROSS-REFERENCING...")
    results = {}
    for dentist_name, log_id in PRIVATE_TAKINGS_LOGS.items():
        if dentist_name not in payslips:
            continue
        print(f"\n   {dentist_name}:")
        dentally_patients = payslips[dentist_name].get("patients", [])
        log_entries = read_dentist_log(client, log_id, month, year)
        if log_entries is None:
            results[dentist_name] = {"dentist": dentist_name, "error": "Could not read log", "dentally_total": payslips[dentist_name].get("gross_total", 0)}
            time.sleep(3)
            continue
        xref = cross_reference_dentist(dentist_name, dentally_patients, log_entries)
        results[dentist_name] = xref
        print(f"      Diff: £{xref['difference']:,.2f} {'⚠️' if abs(xref['difference']) > 10 else '✅'}")
        time.sleep(3)
    return results


# =============================================================================
# PAYSLIP CALCULATION
# =============================================================================

def calculate_payslips(start_date, end_date, lab_bills=None, therapy_minutes=None, nhs_udas=None):
    print(f"\n📊 Calculating payslips for {start_date.strftime('%B %Y')}...")
    lab_bills = lab_bills or {}
    therapy_minutes = therapy_minutes or {}
    nhs_udas = nhs_udas or {}
    
    payslips = {}
    for name, config in DENTISTS.items():
        payslips[name] = {
            "dentist_name": name,
            "gross_private_dentist": 0,
            "gross_private_therapist": 0,
            "gross_total": 0,
            "net_private": 0,
            "udas": nhs_udas.get(name, 0),
            "uda_income": nhs_udas.get(name, 0) * (config['uda_rate'] or 0),
            "lab_bills": lab_bills.get(name, {}),
            "lab_bills_total": 0,
            "lab_bills_50": 0,
            "lab_halo": 0,
            "lab_straumann": 0,
            "lab_robinsons": 0,
            "finance_fees_total": 0,
            "finance_fees_50": 0,
            "therapy_minutes": therapy_minutes.get(name, 0),
            "therapy_total": 0,
            "total_deductions": 0,
            "total_payment": 0,
            "invoice_count": 0,
            "patient_totals": {},
            "patients": [],
        }
    
    finance_flags = []
    invoices = get_invoices_for_period(start_date, end_date)
    payments = get_payments_for_period(start_date - timedelta(days=180), end_date + timedelta(days=30))
    invoice_payment_map = build_invoice_payment_map(payments)
    patient_cache = {}
    processed = 0
    
    for invoice in invoices:
        invoice_id = invoice.get("id")
        patient_id = invoice.get("patient_id")
        is_paid = invoice.get("_is_paid", False)
        balance = invoice.get("_balance", 0)
        invoice_date = invoice.get("_invoice_date", "")
        
        details = get_invoice_details(invoice_id)
        if not details:
            continue
        
        for item in details.get("invoice", {}).get("invoice_items", []):
            practitioner_id = item.get("practitioner_id")
            item_name = item.get("name", "")
            item_amount = float(item.get("total_price", 0))
            
            if item_amount <= 0 or any(ex.lower() in item_name.lower() for ex in EXCLUDED_TREATMENTS) or is_nhs_treatment(item_name, item_amount) or practitioner_id == THERAPIST_ID:
                continue
            
            dentist_name = PRACTITIONER_TO_DENTIST.get(practitioner_id)
            if not dentist_name:
                continue
            
            if patient_id not in patient_cache:
                patient_cache[patient_id] = get_patient_name(patient_id)
            patient_name = patient_cache[patient_id]
            
            if is_paid and balance <= 0:
                payslips[dentist_name]["gross_private_dentist"] += item_amount
                payslips[dentist_name]["invoice_count"] += 1
            
            if invoice_payment_map.get(invoice_id, "").lower() == "finance" and is_paid:
                finance_flags.append({"patient": patient_name, "dentist": dentist_name, "amount": item_amount, "date": invoice_date})
            
            if patient_id not in payslips[dentist_name]["patient_totals"]:
                payslips[dentist_name]["patient_totals"][patient_id] = {"name": patient_name, "total": 0, "last_date": invoice_date}
            
            payslips[dentist_name]["patient_totals"][patient_id]["total"] += item_amount
            payslips[dentist_name]["patient_totals"][patient_id]["last_date"] = invoice_date
        
        processed += 1
        if processed % 100 == 0:
            print(f"   {processed}/{len(invoices)}...")
    
    print(f"   ✅ Processed {processed} invoices")
    
    # Calculate totals
    for name, p in payslips.items():
        config = DENTISTS[name]
        p["patients"] = sorted([{"name": pt["name"], "amount": pt["total"], "date": pt["last_date"]} for pt in p["patient_totals"].values()], key=lambda x: x["date"] or "9999")
        del p["patient_totals"]
        
        p["gross_total"] = p["gross_private_dentist"] + p["gross_private_therapist"]
        p["net_private"] = p["gross_total"] * config["split"]
        p["lab_bills_total"] = sum(p["lab_bills"].values())
        p["lab_bills_50"] = p["lab_bills_total"] * LAB_BILL_SPLIT
        p["finance_fees_50"] = p["finance_fees_total"] * FINANCE_FEE_SPLIT
        p["therapy_total"] = p["therapy_minutes"] * THERAPY_RATE_PER_MINUTE
        p["total_deductions"] = p["lab_bills_50"] + p["finance_fees_50"] + p["therapy_total"]
        p["total_payment"] = p["net_private"] - p["total_deductions"]
        
        if p["gross_total"] > 0:
            print(f"   {name}: £{p['gross_total']:,.2f} → £{p['total_payment']:,.2f}")
    
    return payslips, finance_flags


# =============================================================================
# MAIN
# =============================================================================

def run_payslip_generator(year=None, month=None, lab_bills=None, therapy_minutes=None, nhs_udas=None):
    print("=" * 60)
    print("🦷 AURA DENTAL - PAYSLIP GENERATOR v2.3")
    print("=" * 60)
    
    if year is None or month is None:
        today = datetime.now()
        year, month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
    
    start_date = datetime(year, month, 1)
    end_date = datetime(year + 1, 1, 1) - timedelta(days=1) if month == 12 else datetime(year, month + 1, 1) - timedelta(days=1)
    period_str = start_date.strftime("%B %Y")
    
    print(f"\n📅 Period: {period_str}")
    
    if not DENTALLY_API_TOKEN:
        print("\n❌ DENTALLY_API_TOKEN not set")
        return None
    
    payslips, finance_flags = calculate_payslips(start_date, end_date, lab_bills, therapy_minutes, nhs_udas)
    
    if GOOGLE_SHEETS_CREDENTIALS:
        print("\n📊 Updating Google Sheets...")
        client = get_sheets_client()
        if client:
            try:
                spreadsheet = client.open_by_key(SPREADSHEET_ID)
                update_dashboard(spreadsheet, payslips, period_str)
                
                for name, payslip in payslips.items():
                    update_dentist_payslip(spreadsheet, name, payslip, period_str)
                    print(f"   ✅ {name.split()[0]} Payslip")
                    time.sleep(2)
                
                if finance_flags:
                    update_finance_flags(spreadsheet, finance_flags)
                    print(f"   ✅ Finance Flags ({len(finance_flags)} items)")
                
                xref_results = perform_cross_reference(client, payslips, month, year)
                
                if xref_results:
                    update_cross_reference(spreadsheet, xref_results, period_str)
                    print("\n   Adding discrepancies to payslips...")
                    for dentist_name, xref in xref_results.items():
                        if "error" not in xref:
                            update_payslip_discrepancies(spreadsheet, dentist_name, xref)
                            time.sleep(1)
                    print("   ✅ All discrepancies added")
                
            except Exception as e:
                print(f"   ⚠️ Error: {e}")
                import traceback
                traceback.print_exc()
    
    print("\n" + "=" * 60)
    print("✅ COMPLETE")
    print("=" * 60)
    print(f"\n💰 Total: £{sum(p['total_payment'] for p in payslips.values()):,.2f}")
    print(f"🔗 https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")
    
    return payslips


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int)
    parser.add_argument("--month", type=int)
    args = parser.parse_args()
    run_payslip_generator(args.year, args.month)
