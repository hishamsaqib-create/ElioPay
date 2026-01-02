#!/usr/bin/env python3
"""
Aura Dental Clinic - Payslip Generator v2.1
Pulls from Dentally, updates Google Sheets
Aura branding: Black/White/Beige

Author: Built for Hisham @ Aura Dental
"""

import os
import json
import base64
import requests
import re
import time
import io
from datetime import datetime, timedelta
from collections import defaultdict

# Google Sheets & Drive
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# PDF parsing
import pdfplumber

# =============================================================================
# CONFIGURATION
# =============================================================================

# Dentally API
DENTALLY_API_TOKEN = os.environ.get("DENTALLY_API_TOKEN", "")
DENTALLY_SITE_ID = os.environ.get("DENTALLY_SITE_ID", "212f9c01-f4f2-446d-b7a3-0162b135e9d3")
DENTALLY_API_BASE = "https://api.dentally.co/v1"

# Google Sheets
GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
SPREADSHEET_ID = os.environ.get("PAYSLIP_SPREADSHEET_ID", "1BANM1mdxxtjLAHHc8jSkchHHNbiRC474phtMEINeYHs")

# Historical Payslips Folder (for duplicate detection)
HISTORICAL_PAYSLIPS_FOLDER_ID = "1rcE4JFqnNj8jXHUCmQyoPn5DYDKSjNpJ"

# Practice Info
PRACTICE_NAME = "Aura Dental Clinic"
PRACTICE_ADDRESS = "East Avenue, Billingham, TS23 1BY"

# Aura Brand Colors (for formatting)
COLORS = {
    'black': {'red': 0.1, 'green': 0.1, 'blue': 0.1},
    'white': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
    'beige': {'red': 0.96, 'green': 0.93, 'blue': 0.88},
    'beige_light': {'red': 0.98, 'green': 0.96, 'blue': 0.93},
    'gold': {'red': 0.83, 'green': 0.65, 'blue': 0.45},
    'gold_light': {'red': 0.96, 'green': 0.90, 'blue': 0.83},
    'green_light': {'red': 0.85, 'green': 0.92, 'blue': 0.85},
    'yellow_light': {'red': 1.0, 'green': 1.0, 'blue': 0.8},
    'gray_light': {'red': 0.95, 'green': 0.95, 'blue': 0.95},
}

# Dentist Configuration
DENTISTS = {
    "Zeeshan Abbas": {
        "practitioner_id": 283516,
        "split": 0.45,
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Zeeshan Abbas",
    },
    "Peter Throw": {
        "practitioner_id": 189357,
        "split": 0.50,
        "uda_rate": 16,
        "has_nhs": True,
        "display_name": "Dr Peter Throw",
    },
    "Priyanka Kapoor": {
        "practitioner_id": 189361,
        "split": 0.50,
        "uda_rate": 15,
        "has_nhs": True,
        "display_name": "Dr Priyanka Kapoor",
    },
    "Moneeb Ahmad": {
        "practitioner_id": 293046,
        "split": 0.50,
        "uda_rate": 15,
        "has_nhs": True,
        "display_name": "Dr Moneeb Ahmad",
    },
    "Hani Dalati": {
        "practitioner_id": 263970,
        "split": 0.50,
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Hani Dalati",
    },
    "Ankush Patel": {
        "practitioner_id": 110701,
        "split": 0.45,
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Ankush Patel",
    },
    "Hisham Saqib": {
        "practitioner_id": 127844,
        "split": 0.50,
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Hisham Saqib",
    }
}

# Therapist
THERAPIST_ID = 288298

# Reverse lookup
PRACTITIONER_TO_DENTIST = {
    config["practitioner_id"]: name 
    for name, config in DENTISTS.items() 
    if config["practitioner_id"]
}

# Private Takings Logs
PRIVATE_TAKINGS_LOGS = {
    "Moneeb Ahmad": "1Y-cSU-8rZHr3uHswaZjY2MA0umZT3rxcws6nvwGIMFo",
    "Peter Throw": "1vdKw3_hDWHaenh7OUjrwTdvN-zvf1a8dR45K08HLxr0",
    "Priyanka Kapoor": "13EDcD6zfOdrBwUzQmn9rPXboCTUFeYiuaRHO-gCrjlo",
    "Zeeshan Abbas": "1NWwKzMO7B12WjDnkp-MiKF4j1ge4T6yICSE1anKJhxQ",
    "Ankush Patel": "111HtVp2ShaJm9fxzuaRHNGBWUGRq831joUfawCfevUg",
}

# Rates
LAB_BILL_SPLIT = 0.50
FINANCE_FEE_SPLIT = 0.50
THERAPY_RATE_PER_MINUTE = 0.583333

TABEO_FEE_RATES = {
    3: 0.045,
    12: 0.08,
    36: 0.034,
    60: 0.037,
}

# Excluded treatments
EXCLUDED_TREATMENTS = ["CBCT", "CT Scan", "Cone Beam"]

# NHS detection
NHS_BAND_KEYWORDS = [
    "band 1", "band 2", "band 3", "band urgent",
    "nhs band", "nhs urgent", "nhs examination",
    "urgent band", "band one", "band two", "band three",
    "nhs exam", "nhs scale", "nhs polish", "nhs filling",
    "nhs extraction", "nhs root", "nhs crown", "nhs denture"
]

NHS_BAND_AMOUNTS = [
    27.40, 75.30, 326.70, 47.90, 299.30, 251.40,
    26.80, 73.50, 319.10, 23.80, 46.70,
]


def is_nhs_treatment(item_name, item_amount, item_data=None):
    """Check if a line item is an NHS treatment"""
    item_name_lower = item_name.lower() if item_name else ""
    
    for keyword in NHS_BAND_KEYWORDS:
        if keyword in item_name_lower:
            return True
    
    for band_amount in NHS_BAND_AMOUNTS:
        if abs(item_amount - band_amount) < 0.01:
            return True
    
    if item_data:
        payment_type = str(item_data.get("payment_type", "")).lower()
        if "nhs" in payment_type:
            return True
        if item_data.get("nhs", False) or item_data.get("nhs_charge", False):
            return True
    
    if item_amount == 0:
        return True
    
    return False


# =============================================================================
# DENTALLY API
# =============================================================================

def dentally_request(endpoint, params=None):
    """Make a request to Dentally API"""
    url = f"{DENTALLY_API_BASE}/{endpoint}"
    headers = {
        "Authorization": f"Bearer {DENTALLY_API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "AuraPayslipGenerator/2.1"
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"   ⚠️ API error {response.status_code}: {response.text[:100]}")
            return None
    except Exception as e:
        print(f"   ⚠️ API exception: {e}")
        return None


def get_invoices_for_period(start_date, end_date):
    """Get all paid invoices in period"""
    print(f"   Fetching invoices {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}...")
    
    all_invoices = []
    page = 1
    
    while True:
        params = {
            "dated_on_after": start_date.strftime("%Y-%m-%d"),
            "dated_on_before": end_date.strftime("%Y-%m-%d"),
            "site_id": DENTALLY_SITE_ID,
            "page": page,
            "per_page": 100
        }
        
        data = dentally_request("invoices", params)
        if not data:
            break
        
        invoices = data.get("invoices", [])
        if not invoices:
            break
        
        for inv in invoices:
            amount = float(inv.get("amount", 0))
            balance = float(inv.get("balance", 0))
            is_paid = inv.get("paid", False)
            
            if amount > 0:
                inv["_amount"] = amount
                inv["_balance"] = balance
                inv["_is_paid"] = is_paid
                inv["_invoice_date"] = inv.get("dated_on", "")
                inv["_paid_date"] = inv.get("paid_on", "")
                inv["_payment_flag"] = f"⚠️ £{balance:.2f}" if balance > 0 else None
                all_invoices.append(inv)
        
        print(f"   Page {page}: {len(invoices)} invoices...")
        
        if len(invoices) < 100:
            break
        page += 1
    
    print(f"   Found {len(all_invoices)} invoices")
    return all_invoices


def get_invoice_details(invoice_id):
    """Get full invoice with line items"""
    return dentally_request(f"invoices/{invoice_id}")


def get_patient_name(patient_id):
    """Get patient name from ID"""
    data = dentally_request(f"patients/{patient_id}")
    if data and data.get("patient"):
        p = data["patient"]
        return f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
    return "Unknown"


def get_payments_for_period(start_date, end_date):
    """Get all payments for a period"""
    all_payments = []
    page = 1
    
    while True:
        params = {
            "dated_after": start_date.strftime("%Y-%m-%d"),
            "dated_before": end_date.strftime("%Y-%m-%d"),
            "page": page,
            "per_page": 100
        }
        
        data = dentally_request("payments", params)
        if not data:
            break
        
        payments = data.get("payments", [])
        if not payments:
            break
        
        all_payments.extend(payments)
        
        meta = data.get("meta", {})
        if page >= meta.get("total_pages", 1):
            break
        page += 1
    
    return all_payments


def build_invoice_payment_map(payments):
    """Build map of invoice_id -> payment_method"""
    invoice_payment_map = {}
    for payment in payments:
        method = payment.get("method", "Unknown")
        for explanation in payment.get("explanations", []):
            invoice_id = explanation.get("invoice_id")
            if invoice_id:
                invoice_payment_map[invoice_id] = method
    return invoice_payment_map


# =============================================================================
# GOOGLE SHEETS
# =============================================================================

def get_sheets_client():
    """Get authenticated Google Sheets client"""
    if not GOOGLE_SHEETS_CREDENTIALS:
        return None
    
    try:
        creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
        creds = Credentials.from_service_account_info(creds_dict, scopes=[
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ])
        return gspread.authorize(creds)
    except Exception as e:
        print(f"   ⚠️ Sheets auth error: {e}")
        return None


def get_drive_service():
    """Get authenticated Google Drive service"""
    if not GOOGLE_SHEETS_CREDENTIALS:
        return None
    
    try:
        creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
        creds = Credentials.from_service_account_info(creds_dict, scopes=[
            'https://www.googleapis.com/auth/drive.readonly'
        ])
        return build('drive', 'v3', credentials=creds)
    except Exception as e:
        print(f"   ⚠️ Drive auth error: {e}")
        return None


def update_dashboard(spreadsheet, payslips, period_str):
    """Update Dashboard with Aura branding"""
    print("   Updating Dashboard...")
    
    try:
        sh = spreadsheet.worksheet("Dashboard")
    except:
        return
    
    # Update period cells
    sh.update_acell('C5', period_str)
    sh.update_acell('G5', datetime.now().strftime('%d/%m/%Y'))
    
    # Build dentist rows
    all_rows = []
    row = 8
    totals = {'nhs': 0, 'gross': 0, 'net': 0, 'deductions': 0, 'payment': 0}
    
    for name in DENTISTS.keys():
        if name in payslips:
            p = payslips[name]
            config = DENTISTS[name]
            
            nhs_udas = str(p.get('udas', 0)) if config['has_nhs'] else "-"
            uda_rate = f"£{config['uda_rate']}" if config['uda_rate'] else "-"
            nhs_income = f"£{p.get('uda_income', 0):,.2f}" if config['has_nhs'] else "-"
            
            row_data = [
                "",
                name,
                nhs_udas,
                uda_rate,
                nhs_income,
                f"£{p['gross_total']:,.2f}",
                f"{int(config['split']*100)}%",
                f"£{p['net_private']:,.2f}",
                f"£{p['lab_bills_50']:,.2f}",
                f"£{p['finance_fees_50']:,.2f}",
                f"£{p['therapy_total']:,.2f}",
                f"£{p['total_deductions']:,.2f}",
                f"£{p['total_payment']:,.2f}",
                "✅" if p['total_payment'] > 0 else "⏳"
            ]
            all_rows.append(row_data)
            
            if config['has_nhs']:
                totals['nhs'] += p.get('uda_income', 0)
            totals['gross'] += p['gross_total']
            totals['net'] += p['net_private']
            totals['deductions'] += p['total_deductions']
            totals['payment'] += p['total_payment']
        else:
            all_rows.append([""] * 14)
    
    # Totals row
    all_rows.append([])
    all_rows.append([
        "", "TOTAL", "", "",
        f"£{totals['nhs']:,.2f}",
        f"£{totals['gross']:,.2f}",
        "",
        f"£{totals['net']:,.2f}",
        "", "", "",
        f"£{totals['deductions']:,.2f}",
        f"£{totals['payment']:,.2f}",
        ""
    ])
    
    sh.update(values=all_rows, range_name='A8')
    time.sleep(1)


def update_dentist_payslip(spreadsheet, dentist_name, payslip, period_str):
    """Update individual dentist payslip with Aura branding"""
    
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
    except:
        print(f"   ⚠️ Tab not found: {tab_name}")
        return
    
    config = DENTISTS[dentist_name]
    split_pct = int(config['split'] * 100)
    
    # Calculate payment date
    try:
        period_date = datetime.strptime(period_str, "%B %Y")
        if period_date.month == 12:
            payment_date = datetime(period_date.year + 1, 1, 15)
        else:
            payment_date = datetime(period_date.year, period_date.month + 1, 15)
        payment_str = payment_date.strftime("%d %B %Y")
    except:
        payment_str = "15th of following month"
    
    # Build payslip
    rows = [
        ["", "", "", "", "", "", "", ""],
        ["", "PAYSLIP", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Payslip Date:", payment_str, "", "", "", "", ""],
        ["", "Private Period:", period_str, "", "", "", "", ""],
        ["", "Performer:", config['display_name'], "", "", "", "", ""],
        ["", "Practice:", PRACTICE_NAME, "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ]
    
    # NHS Section
    if config['has_nhs']:
        rows.extend([
            ["", "", "", "", "", "", "", ""],
            ["", "NHS INCOME", "", "", "", "", "", ""],
            ["", "", "", "", "", "", "", ""],
            ["", "", "", "", "UDAs Achieved", "", "", str(payslip.get('udas', 0))],
            ["", "", "", "", "UDA Rate", "", "", f"£{config['uda_rate']}"],
            ["", "", "", "", "NHS Income", "", "", f"£{payslip.get('uda_income', 0):,.2f}"],
            ["", "", "", "", "", "", "", ""],
        ])
    
    # Private Fees Section
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "PRIVATE FEES", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "Gross Private (Dentist)", "", "", f"£{payslip['gross_private_dentist']:,.2f}"],
        ["", "", "", "", "Gross Private (Therapist)", "", "", f"£{payslip['gross_private_therapist']:,.2f}"],
        ["", "", "", "", "Gross Total", "", "", f"£{payslip['gross_total']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "Subtotal", "", "", f"{split_pct}%", "", "", f"£{payslip['net_private']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Deductions Section
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "DEDUCTIONS", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "Lab Bills 50%", "", "", f"£{payslip['lab_bills_50']:,.2f}"],
        ["", "", "", "", "Finance Fees 50%", "", "", f"£{payslip['finance_fees_50']:,.2f}"],
        ["", "", "", "", "Therapy", "", "", f"£{payslip['therapy_total']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "Total Deductions", "", "", "", "", "", f"£{payslip['total_deductions']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Total Payment
    total_with_nhs = payslip['total_payment']
    if config['has_nhs']:
        total_with_nhs += payslip.get('uda_income', 0)
    
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "TOTAL PAYMENT", "", "", "", "", "", f"£{total_with_nhs:,.2f}"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Patient Breakdown Header
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "PATIENT BREAKDOWN", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Patient Name", "Date", "Status", "Amount", "", "", ""],
    ])
    
    # Track patient rows for formatting
    patient_start_row = len(rows) + 1
    
    # Patient rows - columns: B=Name, C=Date, D=Status, E=Amount
    for patient in payslip.get('patients', []):
        status = "✅" if not patient.get('payment_flag') else patient.get('payment_flag', '')
        rows.append([
            "",
            patient['name'],
            patient.get('date', ''),
            status,
            patient['amount'],  # Raw number for formulas
            "",
            "",
            ""
        ])
    
    patient_end_row = len(rows)
    
    # Clear and update sheet
    sh.clear()
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Apply Aura formatting
    sheet_id = sh.id
    requests = [
        # Black header band
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 3, 'startColumnIndex': 0, 'endColumnIndex': 8},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['black']}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        },
        # PAYSLIP title - white text
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 4},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 24}
                }},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Info labels
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 3, 'endRowIndex': 8, 'startColumnIndex': 1, 'endColumnIndex': 2},
                'cell': {'userEnteredFormat': {'textFormat': {'bold': True}}},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Patient breakdown header - beige with gold underline
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': patient_start_row - 2, 'endRowIndex': patient_start_row - 1, 'startColumnIndex': 1, 'endColumnIndex': 5},
                'cell': {'userEnteredFormat': {
                    'backgroundColor': COLORS['beige'],
                    'textFormat': {'bold': True},
                    'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['gold']}}
                }},
                'fields': 'userEnteredFormat'
            }
        },
        # Amount column - currency format
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': patient_start_row - 1, 'endRowIndex': patient_end_row, 'startColumnIndex': 4, 'endColumnIndex': 5},
                'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
                'fields': 'userEnteredFormat.numberFormat'
            }
        },
        # Hide gridlines
        {
            'updateSheetProperties': {
                'properties': {'sheetId': sheet_id, 'gridProperties': {'hideGridlines': True}},
                'fields': 'gridProperties.hideGridlines'
            }
        },
    ]
    
    # Alternating rows for patients
    for i in range(patient_start_row - 1, patient_end_row):
        bg = COLORS['white'] if (i - patient_start_row) % 2 == 0 else COLORS['beige_light']
        requests.append({
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': i, 'endRowIndex': i + 1, 'startColumnIndex': 1, 'endColumnIndex': 5},
                'cell': {'userEnteredFormat': {'backgroundColor': bg}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        })
    
    try:
        spreadsheet.batch_update({'requests': requests})
    except Exception as e:
        print(f"      Formatting note: {e}")


def update_payslip_discrepancies(spreadsheet, dentist_name, xref):
    """Add discrepancies section to payslip with Correct £ column"""
    
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
    except:
        print(f"   ⚠️ Tab not found: {tab_name}")
        return
    
    # Find where to append
    existing = sh.get_all_values()
    next_row = len(existing) + 3
    
    rows = []
    checkbox_rows = []
    correct_amount_rows = []
    current_row = next_row
    
    # Header
    rows.extend([
        ["", "", "", "", "", "", "", "", ""],
        ["", "DISCREPANCIES TO REVIEW", "", "", "", "", "", "", ""],
        ["", "Enter amount in Correct £, then tick checkbox to add", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
    ])
    current_row += 4
    
    has_discrepancies = False
    
    # 1. Items in log but NOT in Dentally
    log_only = xref.get("log_only", [])
    if log_only:
        has_discrepancies = True
        rows.append(["", "🔴 IN LOG BUT NOT IN DENTALLY", "", "", "", "", "", "", ""])
        current_row += 1
        rows.append(["", "Add?", "Patient Name", "Treatment", "Date", "", "Original £", "Correct £", ""])
        current_row += 1
        for item in log_only:
            rows.append([
                "",
                False,
                item.get("patient", ""),
                item.get("treatment", ""),
                item.get("date", ""),
                "",
                item.get('amount', 0),
                "",
                ""
            ])
            checkbox_rows.append(current_row)
            correct_amount_rows.append(current_row)
            current_row += 1
        rows.append(["", "", "", "", "", "", "", "", ""])
        current_row += 1
    
    # 2. Amount mismatches
    amount_mismatch = xref.get("amount_mismatch", [])
    if amount_mismatch:
        has_discrepancies = True
        rows.append(["", "🟡 AMOUNT MISMATCHES", "", "", "", "", "", "", ""])
        current_row += 1
        rows.append(["", "Add?", "Patient Name", "Treatment", "Date", "Dentally £", "Log £", "Correct £", ""])
        current_row += 1
        for item in amount_mismatch:
            rows.append([
                "",
                False,
                item.get("patient", ""),
                "",
                item.get("date", ""),
                item.get('dentally_amount', 0),
                item.get('log_amount', 0),
                "",
                ""
            ])
            checkbox_rows.append(current_row)
            correct_amount_rows.append(current_row)
            current_row += 1
        rows.append(["", "", "", "", "", "", "", "", ""])
        current_row += 1
    
    # 3. Items in Dentally but NOT in log - with REMOVE option
    dentally_only = xref.get("dentally_only", [])
    if dentally_only:
        has_discrepancies = True
        rows.append(["", "🔵 IN DENTALLY BUT NOT IN LOG (included above)", "", "", "", "", "", "", ""])
        current_row += 1
        rows.append(["", "Remove?", "Patient Name", "Treatment", "Date", "", "Amount", "Adjust £", ""])
        current_row += 1
        for item in dentally_only:
            rows.append([
                "",
                False,
                item.get("patient", ""),
                "",
                item.get("date", ""),
                "",
                item.get('amount', 0),
                "",
                ""
            ])
            checkbox_rows.append(current_row)
            correct_amount_rows.append(current_row)
            current_row += 1
        rows.append(["", "", "", "", "", "", "", "", ""])
        current_row += 1
    
    # 4. Unpaid flags
    unpaid_flags = xref.get("unpaid_flags", [])
    if unpaid_flags:
        has_discrepancies = True
        rows.append(["", "🟠 UNPAID / BALANCE", "", "", "", "", "", "", ""])
        current_row += 1
        rows.append(["", "Add?", "Patient Name", "", "Date", "", "Amount", "Correct £", "Flag"])
        current_row += 1
        for item in unpaid_flags:
            rows.append([
                "",
                False,
                item.get("patient", ""),
                "",
                "",
                "",
                item.get('amount', 0),
                "",
                item.get("flag", "")
            ])
            checkbox_rows.append(current_row)
            correct_amount_rows.append(current_row)
            current_row += 1
        rows.append(["", "", "", "", "", "", "", "", ""])
        current_row += 1
    
    if not has_discrepancies:
        rows.append(["", "✅ No discrepancies - all items match!", "", "", "", "", "", "", ""])
    
    # Update sheet
    if rows:
        sh.update(values=rows, range_name=f'A{next_row}')
        
        # Add checkboxes and formatting
        if checkbox_rows or correct_amount_rows:
            try:
                requests = []
                sheet_id = sh.id
                
                # Checkboxes
                for row_num in checkbox_rows:
                    requests.append({
                        'repeatCell': {
                            'range': {'sheetId': sheet_id, 'startRowIndex': row_num - 1, 'endRowIndex': row_num, 'startColumnIndex': 1, 'endColumnIndex': 2},
                            'cell': {'dataValidation': {'condition': {'type': 'BOOLEAN'}}},
                            'fields': 'dataValidation'
                        }
                    })
                
                # Yellow background for Correct £ column (H)
                for row_num in correct_amount_rows:
                    requests.append({
                        'repeatCell': {
                            'range': {'sheetId': sheet_id, 'startRowIndex': row_num - 1, 'endRowIndex': row_num, 'startColumnIndex': 7, 'endColumnIndex': 8},
                            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['yellow_light']}},
                            'fields': 'userEnteredFormat.backgroundColor'
                        }
                    })
                
                # Currency format for amount columns
                for row_num in correct_amount_rows:
                    requests.append({
                        'repeatCell': {
                            'range': {'sheetId': sheet_id, 'startRowIndex': row_num - 1, 'endRowIndex': row_num, 'startColumnIndex': 6, 'endColumnIndex': 8},
                            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
                            'fields': 'userEnteredFormat.numberFormat'
                        }
                    })
                
                if requests:
                    spreadsheet.batch_update({'requests': requests})
            except Exception as e:
                print(f"      Note: {e}")
        
        time.sleep(1)
    
    print(f"   ✅ Discrepancies added to {tab_name}")


def update_finance_flags(spreadsheet, finance_flags):
    """Update Finance Flags tab"""
    print("   Updating Finance Flags...")
    
    try:
        sh = spreadsheet.worksheet("Finance Flags")
    except:
        return
    
    if finance_flags:
        rows = []
        for flag in finance_flags:
            rows.append([
                "",
                flag['patient'],
                flag['dentist'],
                flag['amount'],
                flag['date'],
                "",  # Term dropdown
                "",  # Rate (calculated)
                "",  # Fee (calculated)
                "⚠️ Select term"
            ])
        sh.update(values=rows, range_name='B6')
        
        # Currency format for amount
        try:
            sheet_id = sh.id
            spreadsheet.batch_update({'requests': [{
                'repeatCell': {
                    'range': {'sheetId': sheet_id, 'startRowIndex': 5, 'endRowIndex': 5 + len(rows), 'startColumnIndex': 3, 'endColumnIndex': 4},
                    'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
                    'fields': 'userEnteredFormat.numberFormat'
                }
            }]})
        except:
            pass
        
        time.sleep(1)


def update_cross_reference(spreadsheet, xref_results, period_str):
    """Update Cross-Reference tab"""
    print("   Updating Cross-Reference...")
    
    try:
        sh = spreadsheet.worksheet("Cross-Reference")
        sh.batch_clear(['A6:K500'])
    except:
        return
    
    rows = []
    
    for dentist_name, xref in xref_results.items():
        if "error" in xref:
            rows.append([
                "",
                dentist_name,
                f"£{xref.get('dentally_total', 0):,.2f}",
                "⚠️ " + xref["error"],
                "", "", "", "", "", "", ""
            ])
        else:
            diff = xref["difference"]
            status = "✅" if abs(diff) <= 10 else "⚠️"
            rows.append([
                "",
                dentist_name,
                f"£{xref['dentally_total']:,.2f}",
                f"£{xref['log_total']:,.2f}",
                f"£{diff:,.2f}",
                status,
                len(xref["matched"]),
                len(xref["amount_mismatch"]),
                len(xref["log_only"]),
                len(xref["dentally_only"]),
                ""
            ])
    
    if rows:
        sh.update(values=rows, range_name='A6')
    
    time.sleep(1)
    print("   ✅ Cross-Reference updated")


def update_duplicate_check_tab(spreadsheet, duplicates, period_str):
    """Update Duplicate Check tab"""
    print("   Updating Duplicate Check...")
    
    try:
        sh = spreadsheet.worksheet("Duplicate Check")
        sh.batch_clear(['A6:J500'])
    except:
        return
    
    if duplicates:
        rows = []
        for dup in duplicates:
            rows.append([
                "",
                dup['patient'],
                dup['dentist'],
                f"£{dup['current_amount']:,.2f}",
                dup['current_date'],
                f"£{dup['previous_amount']:,.2f}",
                dup['previous_period'],
                dup['match_type'],
                dup['status'],
                ""
            ])
        sh.update(values=rows, range_name='A6')
    else:
        sh.update_acell('B6', '✅ No duplicates found')
    
    time.sleep(1)
    print(f"   ✅ Duplicate Check updated ({len(duplicates)} items)")


def update_paid_invoices_log(spreadsheet, payslips, period_str):
    """Log paid invoices"""
    print("   Updating Paid Invoices log...")
    
    try:
        sh = spreadsheet.worksheet("Paid Invoices")
    except:
        return
    
    existing = sh.get_all_values()
    next_row = len(existing) + 1
    
    new_records = []
    added_on = datetime.now().strftime('%d/%m/%Y %H:%M')
    
    for dentist_name, payslip in payslips.items():
        for patient in payslip.get('patients', []):
            new_records.append([
                str(patient.get('invoice_id', '')),
                patient.get('name', ''),
                dentist_name,
                patient.get('amount', 0),
                patient.get('date', ''),
                period_str,
                added_on,
                patient.get('treatment', '')
            ])
    
    if new_records:
        sh.update(values=new_records, range_name=f'A{next_row}')
        time.sleep(1)
    
    print(f"   ✅ Logged {len(new_records)} invoices")


# =============================================================================
# CROSS-REFERENCE
# =============================================================================

def normalize_name(name):
    """Normalize patient name for comparison"""
    if not name:
        return ""
    name = str(name).lower().strip()
    name = " ".join(name.split())
    return name


def fuzzy_match_name(name1, name2):
    """Check if two names match (fuzzy)"""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    
    if not n1 or not n2:
        return 0.0, "empty"
    
    if n1 == n2:
        return 1.0, "exact"
    
    if n1 in n2 or n2 in n1:
        return 0.8, "partial"
    
    parts1 = n1.split()
    parts2 = n2.split()
    if len(parts1) > 0 and len(parts2) > 0:
        if parts1[-1] == parts2[-1]:
            return 0.7, "lastname"
    
    return 0.0, "none"


def read_dentist_log(client, spreadsheet_id, month, year):
    """Read dentist's private takings log"""
    try:
        spreadsheet = client.open_by_key(spreadsheet_id)
    except Exception as e:
        print(f"      ⚠️ Cannot access log: {e}")
        return None
    
    month_names = {
        1: ["JANUARY", "JAN"], 2: ["FEBRUARY", "FEB"], 3: ["MARCH", "MAR"],
        4: ["APRIL", "APR"], 5: ["MAY"], 6: ["JUNE", "JUN"],
        7: ["JULY", "JUL"], 8: ["AUGUST", "AUG"], 9: ["SEPTEMBER", "SEP"],
        10: ["OCTOBER", "OCT"], 11: ["NOVEMBER", "NOV"], 12: ["DECEMBER", "DEC"],
    }
    
    year_short = str(year)[2:]
    
    possible_names = []
    for name in month_names.get(month, []):
        possible_names.extend([
            f"{name} {year_short}", f"{name} {year}",
            f"{name}{year_short}", f"{name.lower()} {year_short}"
        ])
    
    sheet = None
    all_sheets = [ws.title for ws in spreadsheet.worksheets()]
    
    for tab_name in possible_names:
        for ws_name in all_sheets:
            if ws_name.lower().strip() == tab_name.lower().strip():
                sheet = spreadsheet.worksheet(ws_name)
                break
        if sheet:
            break
    
    if not sheet:
        print(f"      ⚠️ No tab for {month}/{year}")
        return None
    
    print(f"      Found: {sheet.title}")
    
    data = sheet.get_all_values()
    
    header_row = None
    for i, row in enumerate(data):
        row_lower = [str(cell).lower() for cell in row]
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
        if any("total" in str(cell).lower() for cell in row):
            break
        
        date_val = row[0] if len(row) > 0 else ""
        patient_val = row[1] if len(row) > 1 else ""
        treatment_val = row[2] if len(row) > 2 else ""
        amount_val = row[3] if len(row) > 3 else ""
        
        if date_val and str(date_val).strip():
            current_date = str(date_val).strip()
        
        if not patient_val or not str(patient_val).strip():
            continue
        
        try:
            amount_str = str(amount_val).replace("£", "").replace(",", "").strip()
            amount = float(amount_str) if amount_str else 0
        except:
            amount = 0
        
        if amount > 0:
            entries.append({
                "patient": str(patient_val).strip(),
                "amount": amount,
                "date": current_date,
                "treatment": str(treatment_val).strip()
            })
    
    print(f"      {len(entries)} entries, £{sum(e['amount'] for e in entries):,.2f}")
    return entries


def cross_reference_dentist(dentist_name, dentally_patients, log_entries):
    """Cross-reference Dentally data with log"""
    result = {
        "dentist": dentist_name,
        "dentally_total": sum(p["amount"] for p in dentally_patients),
        "log_total": sum(e["amount"] for e in log_entries) if log_entries else 0,
        "matched": [],
        "dentally_only": [],
        "log_only": [],
        "amount_mismatch": [],
        "unpaid_flags": []
    }
    
    result["difference"] = result["dentally_total"] - result["log_total"]
    
    if not log_entries:
        result["dentally_only"] = [
            {"patient": dp["name"], "amount": dp["amount"], "date": dp.get("date", "")}
            for dp in dentally_patients
        ]
        for dp in dentally_patients:
            if dp.get("payment_flag"):
                result["unpaid_flags"].append({
                    "patient": dp["name"],
                    "amount": dp["amount"],
                    "flag": dp["payment_flag"]
                })
        return result
    
    log_matched = [False] * len(log_entries)
    
    for dp in dentally_patients:
        best_match = None
        best_score = 0
        best_idx = -1
        
        for i, le in enumerate(log_entries):
            if log_matched[i]:
                continue
            score, _ = fuzzy_match_name(dp["name"], le["patient"])
            if score > best_score:
                best_score = score
                best_match = le
                best_idx = i
        
        if best_score >= 0.6:
            log_matched[best_idx] = True
            if abs(dp["amount"] - best_match["amount"]) <= 1:
                result["matched"].append({
                    "patient": dp["name"],
                    "dentally_amount": dp["amount"],
                    "log_amount": best_match["amount"]
                })
            else:
                result["amount_mismatch"].append({
                    "patient": dp["name"],
                    "dentally_amount": dp["amount"],
                    "log_amount": best_match["amount"],
                    "date": dp.get("date", "")
                })
        else:
            result["dentally_only"].append({
                "patient": dp["name"],
                "amount": dp["amount"],
                "date": dp.get("date", "")
            })
        
        if dp.get("payment_flag"):
            result["unpaid_flags"].append({
                "patient": dp["name"],
                "amount": dp["amount"],
                "flag": dp["payment_flag"]
            })
    
    for i, le in enumerate(log_entries):
        if not log_matched[i]:
            result["log_only"].append({
                "patient": le["patient"],
                "amount": le["amount"],
                "date": le.get("date", ""),
                "treatment": le.get("treatment", "")
            })
    
    return result


def perform_cross_reference(client, payslips, month, year):
    """Perform cross-reference for all dentists"""
    print("\n🔍 CROSS-REFERENCING...")
    
    results = {}
    
    for dentist_name, log_id in PRIVATE_TAKINGS_LOGS.items():
        if dentist_name not in payslips:
            continue
        
        print(f"\n   {dentist_name}:")
        
        dentally_patients = payslips[dentist_name].get("patients", [])
        log_entries = read_dentist_log(client, log_id, month, year)
        
        if log_entries is None:
            results[dentist_name] = {
                "dentist": dentist_name,
                "error": "Could not read log",
                "dentally_total": payslips[dentist_name].get("gross_total", 0)
            }
            continue
        
        xref = cross_reference_dentist(dentist_name, dentally_patients, log_entries)
        results[dentist_name] = xref
        
        print(f"      Dentally: £{xref['dentally_total']:,.2f} | Log: £{xref['log_total']:,.2f}")
        print(f"      Diff: £{xref['difference']:,.2f} {'⚠️' if abs(xref['difference']) > 10 else '✅'}")
    
    return results


# =============================================================================
# DUPLICATE CHECK (simplified)
# =============================================================================

def normalize_dentist_name(name):
    """Normalize dentist name"""
    if not name:
        return ""
    name = re.sub(r'^(Dr\.?\s*)', '', name, flags=re.IGNORECASE)
    return name.strip()


def check_for_duplicates(current_patients, historical_db, dentist_name, current_period):
    """Check for duplicate payments"""
    duplicates = []
    dentist_normalized = normalize_dentist_name(dentist_name)
    historical = historical_db.get(dentist_normalized, [])
    
    if not historical:
        return duplicates
    
    historical_lookup = defaultdict(list)
    for h in historical:
        historical_lookup[normalize_name(h['patient'])].append(h)
    
    for cp in current_patients:
        cp_name_normalized = normalize_name(cp['name'])
        cp_amount = cp.get('amount', 0)
        
        if cp_name_normalized in historical_lookup:
            for hist in historical_lookup[cp_name_normalized]:
                if abs(hist['amount'] - cp_amount) < 1:
                    duplicates.append({
                        'patient': cp['name'],
                        'dentist': dentist_name,
                        'current_amount': cp_amount,
                        'current_date': cp.get('date', ''),
                        'previous_amount': hist['amount'],
                        'previous_period': hist['period'],
                        'match_type': 'EXACT',
                        'status': '⚠️ CHECK'
                    })
    
    return duplicates


# =============================================================================
# PAYSLIP CALCULATION
# =============================================================================

def calculate_payslips(start_date, end_date, lab_bills=None, therapy_minutes=None, nhs_udas=None):
    """Calculate payslips for all dentists"""
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
            "finance_fees_total": 0,
            "finance_fees_50": 0,
            "therapy_minutes": therapy_minutes.get(name, 0),
            "therapy_total": 0,
            "total_deductions": 0,
            "total_payment": 0,
            "invoice_count": 0,
            "patient_totals": {},
            "patients": [],
            "payment_flags": [],
        }
    
    finance_flags = []
    invoices = get_invoices_for_period(start_date, end_date)
    
    payment_start = start_date - timedelta(days=180)
    payment_end = end_date + timedelta(days=30)
    payments = get_payments_for_period(payment_start, payment_end)
    invoice_payment_map = build_invoice_payment_map(payments)
    
    patient_cache = {}
    processed = 0
    
    print(f"   Processing {len(invoices)} invoices...")
    
    for invoice in invoices:
        invoice_id = invoice.get("id")
        patient_id = invoice.get("patient_id")
        is_paid = invoice.get("_is_paid", False)
        balance = invoice.get("_balance", 0)
        payment_flag = invoice.get("_payment_flag")
        invoice_date = invoice.get("_invoice_date", "")
        
        details = get_invoice_details(invoice_id)
        if not details:
            continue
        
        invoice_data = details.get("invoice", {})
        line_items = invoice_data.get("invoice_items", [])
        
        payment_method = invoice_payment_map.get(invoice_id, "Unknown")
        is_finance = payment_method.lower() == "finance"
        
        for item in line_items:
            practitioner_id = item.get("practitioner_id")
            item_name = item.get("name", "")
            item_amount = float(item.get("total_price", 0))
            
            if item_amount <= 0:
                continue
            
            if any(excl.lower() in item_name.lower() for excl in EXCLUDED_TREATMENTS):
                continue
            
            if is_nhs_treatment(item_name, item_amount, item):
                continue
            
            if practitioner_id == THERAPIST_ID:
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
            else:
                payslips[dentist_name]["payment_flags"].append({
                    "patient": patient_name,
                    "amount": item_amount,
                    "flag": payment_flag or "⚠️ Unpaid"
                })
            
            if is_finance and is_paid:
                finance_flags.append({
                    "patient": patient_name,
                    "dentist": dentist_name,
                    "amount": item_amount,
                    "date": invoice_date,
                })
            
            if patient_id not in payslips[dentist_name]["patient_totals"]:
                payslips[dentist_name]["patient_totals"][patient_id] = {
                    "name": patient_name,
                    "total": 0,
                    "paid_total": 0,
                    "last_date": invoice_date,
                    "payment_flag": None
                }
            
            payslips[dentist_name]["patient_totals"][patient_id]["total"] += item_amount
            payslips[dentist_name]["patient_totals"][patient_id]["last_date"] = invoice_date
            
            if is_paid and balance <= 0:
                payslips[dentist_name]["patient_totals"][patient_id]["paid_total"] += item_amount
            else:
                payslips[dentist_name]["patient_totals"][patient_id]["payment_flag"] = payment_flag
        
        processed += 1
        if processed % 100 == 0:
            print(f"   {processed}/{len(invoices)}...")
    
    print(f"   ✅ Processed {processed} invoices")
    
    # Calculate totals
    print("\n📋 RESULTS:")
    
    for name, p in payslips.items():
        config = DENTISTS[name]
        
        p["patients"] = sorted([
            {
                "name": pt["name"],
                "amount": pt["total"],
                "paid_amount": pt["paid_total"],
                "date": pt["last_date"],
                "payment_flag": pt["payment_flag"]
            }
            for pt in p["patient_totals"].values()
        ], key=lambda x: x["date"] or "9999")
        
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
    """Main function"""
    
    print("=" * 60)
    print("🦷 AURA DENTAL - PAYSLIP GENERATOR")
    print("=" * 60)
    
    if year is None or month is None:
        today = datetime.now()
        if today.month == 1:
            year = today.year - 1
            month = 12
        else:
            year = today.year
            month = today.month - 1
    
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = datetime(year, month + 1, 1) - timedelta(days=1)
    
    period_str = start_date.strftime("%B %Y")
    
    print(f"\n📅 Period: {period_str}")
    
    if not DENTALLY_API_TOKEN:
        print("\n❌ DENTALLY_API_TOKEN not set")
        return None
    
    payslips, finance_flags = calculate_payslips(
        start_date, end_date, lab_bills, therapy_minutes, nhs_udas
    )
    
    # Update Google Sheets
    xref_results = None
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
                
                xref_results = perform_cross_reference(client, payslips, month, year)
                
                if xref_results:
                    update_cross_reference(spreadsheet, xref_results, period_str)
                    
                    print("\n   Adding discrepancies to payslips...")
                    for dentist_name, xref in xref_results.items():
                        if "error" not in xref:
                            update_payslip_discrepancies(spreadsheet, dentist_name, xref)
                            time.sleep(1)
                
                update_paid_invoices_log(spreadsheet, payslips, period_str)
                
            except Exception as e:
                print(f"   ⚠️ Error: {e}")
                import traceback
                traceback.print_exc()
    
    # Summary
    print("\n" + "=" * 60)
    print("✅ COMPLETE")
    print("=" * 60)
    
    total = sum(p['total_payment'] for p in payslips.values())
    print(f"\n💰 Total: £{total:,.2f}")
    print(f"🔗 https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")
    
    return payslips


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int)
    parser.add_argument("--month", type=int)
    args = parser.parse_args()
    run_payslip_generator(args.year, args.month)
