#!/usr/bin/env python3
"""
Aura Dental Clinic - Payslip Generator v2.0
Pulls from Dentally, updates Google Sheets, generates PDFs

Author: Built for Hisham @ Aura Dental
"""

import os
import json
import base64
import requests
import re
from datetime import datetime, timedelta
from collections import defaultdict

# Google Sheets
import gspread
from google.oauth2.service_account import Credentials

# PDF Generation
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

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

# Logo
LOGO_URL = "https://drive.google.com/uc?export=view&id=1Z4d-u7P8XzOOm3IKyssYrRD0o_jZ5fjd"

# Practice Info
PRACTICE_NAME = "Aura Dental Clinic"
PRACTICE_ADDRESS = "East Avenue, Billingham, TS23 1BY"

# Dentist Configuration
DENTISTS = {
    "Zeeshan Abbas": {
        "split": 0.45,
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Zeeshan Abbas",
        "aliases": ["zeeshan", "zee", "abbas"]
    },
    "Peter Throw": {
        "split": 0.50,
        "uda_rate": 16,
        "has_nhs": True,
        "display_name": "Dr Peter Throw",
        "aliases": ["peter", "throw"]
    },
    "Priyanka Kapoor": {
        "split": 0.50,
        "uda_rate": 15,
        "has_nhs": True,
        "display_name": "Dr Priyanka Kapoor",
        "aliases": ["priyanka", "kapoor"]
    },
    "Moneeb Ahmad": {
        "split": 0.50,
        "uda_rate": 15,
        "has_nhs": True,
        "display_name": "Dr Moneeb Ahmad",
        "aliases": ["moneeb", "ahmad"]
    },
    "Hani Dalati": {
        "split": 0.50,
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Hani Dalati",
        "aliases": ["hani", "dalati"]
    },
    "Ankush Patel": {
        "split": 0.50,
        "uda_rate": 15,
        "has_nhs": False,
        "display_name": "Dr Ankush Patel",
        "aliases": ["ankush", "patel"]
    },
    "Hisham Saqib": {
        "split": 0.50,
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Hisham Saqib",
        "aliases": ["hisham", "saqib", "hish"]
    }
}

# Private Takings Logs (read-only)
PRIVATE_TAKINGS_LOGS = {
    "Moneeb Ahmad": "1Y-cSU-8rZHr3uHswaZjY2MA0umZT3rxcws6nvwGIMFo",
    "Peter Throw": "1vdKw3_hDWHaenh7OUjrwTdvN-zvf1a8dR45K08HLxr0",
    "Priyanka Kapoor": "13EDcD6zfOdrBwUzQmn9rPXboCTUFeYiuaRHO-gCrjlo",
    "Zeeshan Abbas": "1NWwKzMO7B12WjDnkp-MiKF4j1ge4T6yICSE1anKJhxQ",
    "Ankush Patel": "111HtVp2ShaJm9fxzuaRHNGBWUGRq831joUfawCfevUg",
    # Hani Dalati - no takings log (trusts practice)
}

# Deduction rates
LAB_BILL_SPLIT = 0.50
FINANCE_FEE_SPLIT = 0.50
THERAPY_RATE_PER_MINUTE = 0.583333  # £35/hour

# Tabeo rates by term
TABEO_FEE_RATES = {
    3: 0.045,   # 4.5%
    12: 0.08,   # 8.0%
    36: 0.034,  # 3.4%
    60: 0.037,  # 3.7%
}
TABEO_DEFAULT_RATE = 0.08  # Default to 12 month

# Excluded treatments (go to practice)
EXCLUDED_TREATMENTS = ["CBCT", "CT Scan", "Cone Beam"]


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
        "User-Agent": "AuraPayslipGenerator/2.0"
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


def get_practitioners():
    """Get all practitioners from Dentally"""
    print("   Fetching practitioners...")
    data = dentally_request("practitioners")
    if not data:
        return {}
    
    practitioners = {}
    for p in data.get("practitioners", []):
        full_name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        practitioners[p.get("id")] = {
            "name": full_name,
            "id": p.get("id"),
            "active": p.get("active", True)
        }
    
    print(f"   Found {len(practitioners)} practitioners")
    return practitioners


def match_practitioner_to_dentist(practitioner_name):
    """Match a Dentally practitioner to our dentist config"""
    name_lower = practitioner_name.lower()
    
    for dentist_name, config in DENTISTS.items():
        # Check full name match
        if dentist_name.lower() in name_lower or name_lower in dentist_name.lower():
            return dentist_name
        
        # Check aliases
        for alias in config.get("aliases", []):
            if alias.lower() in name_lower:
                return dentist_name
    
    return None


def get_invoices_for_period(start_date, end_date):
    """Get all paid invoices in period"""
    print(f"   Fetching invoices {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}...")
    
    all_invoices = []
    page = 1
    
    while True:
        params = {
            "paid_at_from": start_date.strftime("%Y-%m-%d"),
            "paid_at_to": end_date.strftime("%Y-%m-%d"),
            "page": page,
            "per_page": 100
        }
        
        data = dentally_request("invoices", params)
        if not data:
            break
        
        invoices = data.get("invoices", [])
        if not invoices:
            break
        
        all_invoices.extend(invoices)
        
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


def get_payments_for_invoice(invoice_id):
    """Get payments for an invoice"""
    data = dentally_request(f"invoices/{invoice_id}/payments")
    if data:
        return data.get("payments", [])
    return []


# =============================================================================
# GOOGLE SHEETS
# =============================================================================

def get_sheets_client():
    """Get authenticated Google Sheets client"""
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("   ⚠️ No Google Sheets credentials")
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


def update_dashboard(spreadsheet, payslips, period_str):
    """Update the Dashboard tab"""
    print("   Updating Dashboard...")
    
    try:
        sh = spreadsheet.worksheet("Dashboard")
    except:
        return
    
    # Update period
    sh.update_acell('C5', period_str)
    sh.update_acell('H5', datetime.now().strftime('%d/%m/%Y'))
    
    # Update each dentist row (starting at row 8)
    row = 8
    total_nhs = 0
    total_private_gross = 0
    total_private_net = 0
    total_deductions = 0
    total_net_pay = 0
    
    for name in DENTISTS.keys():
        if name in payslips:
            p = payslips[name]
            nhs_udas = str(p.get('udas', 0)) if DENTISTS[name]['has_nhs'] else "-"
            uda_rate = f"£{DENTISTS[name]['uda_rate']}" if DENTISTS[name]['uda_rate'] else "-"
            nhs_income = f"£{p.get('uda_income', 0):,.2f}" if DENTISTS[name]['has_nhs'] else "-"
            
            row_data = [
                "",
                name,
                nhs_udas,
                uda_rate,
                nhs_income,
                f"£{p['gross_total']:,.2f}",
                f"{int(DENTISTS[name]['split']*100)}%",
                f"£{p['net_private']:,.2f}",
                f"£{p['lab_bills_50']:,.2f}",
                f"£{p['finance_fees_50']:,.2f}",
                f"£{p['therapy_total']:,.2f}",
                f"£{p['total_deductions']:,.2f}",
                f"£{p['total_payment']:,.2f}",
                "✅" if p['total_payment'] > 0 else "⏳"
            ]
            sh.update(values=[row_data], range_name=f'A{row}')
            
            # Totals
            if DENTISTS[name]['has_nhs']:
                total_nhs += p.get('uda_income', 0)
            total_private_gross += p['gross_total']
            total_private_net += p['net_private']
            total_deductions += p['total_deductions']
            total_net_pay += p['total_payment']
        
        row += 1
    
    # Update totals row
    totals_row = row + 1
    sh.update(values=[[
        "", "TOTAL", "", "",
        f"£{total_nhs:,.2f}",
        f"£{total_private_gross:,.2f}",
        "",
        f"£{total_private_net:,.2f}",
        "", "", "",
        f"£{total_deductions:,.2f}",
        f"£{total_net_pay:,.2f}",
        ""
    ]], range_name=f'A{totals_row}')


def update_dentist_payslip(spreadsheet, dentist_name, payslip, period_str):
    """Update individual dentist payslip tab"""
    
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
    except:
        print(f"   ⚠️ Tab not found: {tab_name}")
        return
    
    config = DENTISTS[dentist_name]
    
    # Calculate payment date (15th of following month)
    # Parse period to get month/year
    try:
        period_date = datetime.strptime(period_str, "%B %Y")
        if period_date.month == 12:
            payment_date = datetime(period_date.year + 1, 1, 15)
        else:
            payment_date = datetime(period_date.year, period_date.month + 1, 15)
        payment_str = payment_date.strftime("%dth %B %Y")
    except:
        payment_str = "15th of following month"
    
    # Build the payslip data
    rows = [
        ["", "", "", "", "", "", "", ""],
        [f'=IMAGE("{LOGO_URL}", 1)', "", "", "", "", "", "", ""],
        ["", "PAYSLIP", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Payslip Date:", "", payment_str, "", "", "", ""],
        ["", "Private Period:", "", period_str, "", "", "", ""],
        ["", "Performer:", "", config['display_name'], "", "", "", ""],
        ["", "Practice:", "", PRACTICE_NAME, "", "", "", ""],
        ["", "Superannuation:", "", "Opted Out", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ]
    
    current_row = 11
    
    # NHS Section
    if config['has_nhs']:
        rows.extend([
            ["", "─────────────────────────────────────", "", "", "", "", "", ""],
            ["", "SECTION 1: NHS INCOME", "", "", "", "", "", ""],
            ["", "", "", "", "", "", "", ""],
            ["", "", "", "", "UDAs Achieved", "", "", str(payslip.get('udas', 0))],
            ["", "", "", "", "UDA Rate", "", "", f"£{config['uda_rate']}"],
            ["", "", "", "", "NHS Income", "", "", f"£{payslip.get('uda_income', 0):,.2f}"],
            ["", "", "", "", "", "", "", ""],
        ])
        current_row += 7
        priv_section = "SECTION 2: PRIVATE FEES"
        ded_section = "SECTION 3: DEDUCTIONS"
    else:
        priv_section = "SECTION 1: PRIVATE FEES"
        ded_section = "SECTION 2: DEDUCTIONS"
    
    # Private Section
    rows.extend([
        ["", "─────────────────────────────────────", "", "", "", "", "", ""],
        ["", priv_section, "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "Gross Private (Dentist)", "", "", f"£{payslip['gross_private_dentist']:,.2f}"],
        ["", "", "", "", "Gross Private (Therapist)", "", "", f"£{payslip['gross_private_therapist']:,.2f}"],
        ["", "", "", "", "Gross Total", "", "", f"£{payslip['gross_total']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "Subtotal", "", "", f"{int(config['split']*100)}%", "", "", f"£{payslip['net_private']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Deductions Section
    rows.extend([
        ["", "─────────────────────────────────────", "", "", "", "", "", ""],
        ["", ded_section, "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Labs", "", "", "", "", ""],
    ])
    
    # Lab bills breakdown
    if payslip.get('lab_bills'):
        for lab_name, amount in payslip['lab_bills'].items():
            rows.append(["", "", "", "", lab_name, "", "", f"£{amount:,.2f}"])
    
    rows.extend([
        ["", "", "", "", "Lab Bills Total", "", "", f"£{payslip['lab_bills_total']:,.2f}"],
        ["", "", "", "", "Lab Bills 50%", "", "", f"£{payslip['lab_bills_50']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Finance", "", "", "", "", ""],
        ["", "", "", "", "Finance Fees Total", "", "", f"£{payslip['finance_fees_total']:,.2f}"],
        ["", "", "", "", "Finance Fees 50%", "", "", f"£{payslip['finance_fees_50']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Therapy", "", "Taryn", "", "", ""],
        ["", "", "", "", "Minutes", "", "", str(payslip.get('therapy_minutes', 0))],
        ["", "", "", "", "@ £0.583/min", "", "", f"£{payslip['therapy_total']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "Total Deductions", "", "", "", "", "", f"£{payslip['total_deductions']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Add NHS income to total if applicable
    total_with_nhs = payslip['total_payment']
    if config['has_nhs']:
        total_with_nhs += payslip.get('uda_income', 0)
    
    # Total Payment
    rows.extend([
        ["", "─────────────────────────────────────", "", "", "", "", "", ""],
        ["", "TOTAL PAYMENT", "", "", "", "", "", f"£{total_with_nhs:,.2f}"],
        ["", "─────────────────────────────────────", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "PATIENT BREAKDOWN", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Patient Name", "", "Date", "Finance Fee", "Finance 50%", "Therapist", "Paid"],
    ])
    
    # Patient breakdown
    for patient in payslip.get('patients', []):
        rows.append([
            "",
            patient['name'],
            "",
            patient.get('date', ''),
            f"£{patient.get('finance_fee', 0):,.2f}" if patient.get('finance_fee', 0) > 0 else "",
            f"£{patient.get('finance_fee_50', 0):,.2f}" if patient.get('finance_fee_50', 0) > 0 else "",
            "Yes" if patient.get('therapist') else "",
            f"£{patient['amount']:,.2f}"
        ])
    
    # Update the sheet
    sh.clear()
    sh.update(values=rows, range_name='A1')
    
    # Formatting
    sh.format('B3', {'textFormat': {'bold': True, 'fontSize': 18}})
    sh.format('B5:B9', {'textFormat': {'bold': True}})


def update_finance_flags(spreadsheet, finance_flags):
    """Update Finance Flags tab with items needing term length"""
    print("   Updating Finance Flags...")
    
    try:
        sh = spreadsheet.worksheet("Finance Flags")
    except:
        return
    
    # Keep header rows, update from row 6
    if finance_flags:
        rows = []
        for flag in finance_flags:
            rows.append([
                "",
                flag['patient'],
                flag['dentist'],
                f"£{flag['amount']:,.2f}",
                flag['date'],
                "",  # Term to be entered
                "",  # Subsidy %
                "",  # Fee
                "⚠️ Enter term"
            ])
        sh.update(values=rows, range_name='A6')


# =============================================================================
# PAYSLIP CALCULATION
# =============================================================================

def calculate_payslips(start_date, end_date, lab_bills=None, therapy_minutes=None, nhs_udas=None):
    """
    Calculate payslips for all dentists
    
    Args:
        start_date: First day of period
        end_date: Last day of period
        lab_bills: {dentist: {lab: amount}}
        therapy_minutes: {dentist: minutes}
        nhs_udas: {dentist: uda_count}
    """
    print(f"\n📊 Calculating payslips for {start_date.strftime('%B %Y')}...")
    
    lab_bills = lab_bills or {}
    therapy_minutes = therapy_minutes or {}
    nhs_udas = nhs_udas or {}
    
    # Get practitioners
    practitioners = get_practitioners()
    
    # Map practitioner IDs to dentist names
    prac_to_dentist = {}
    for prac_id, prac_info in practitioners.items():
        dentist = match_practitioner_to_dentist(prac_info['name'])
        if dentist:
            prac_to_dentist[prac_id] = dentist
    
    # Initialize payslips
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
            "patients": []
        }
    
    # Track finance payments needing term length
    finance_flags = []
    
    # Get invoices
    invoices = get_invoices_for_period(start_date, end_date)
    
    # Process each invoice
    patient_cache = {}
    for invoice in invoices:
        invoice_id = invoice.get("id")
        patient_id = invoice.get("patient_id")
        practitioner_id = invoice.get("practitioner_id")
        
        # Find dentist
        dentist_name = prac_to_dentist.get(practitioner_id)
        if not dentist_name:
            continue
        
        # Get patient name (with caching)
        if patient_id not in patient_cache:
            patient_cache[patient_id] = get_patient_name(patient_id)
        patient_name = patient_cache[patient_id]
        
        # Get invoice details
        details = get_invoice_details(invoice_id)
        if not details:
            continue
        
        invoice_data = details.get("invoice", {})
        line_items = invoice_data.get("line_items", [])
        
        # Calculate invoice totals
        total_amount = 0
        is_therapist = False
        paid_date = invoice.get("paid_at", "")[:10]
        
        for item in line_items:
            item_name = item.get("description", "")
            item_amount = float(item.get("amount", 0))
            item_status = item.get("status", "").lower()
            
            # Skip unpaid items
            if item_status != "paid":
                continue
            
            # Skip excluded treatments (CBCT etc)
            if any(excl.lower() in item_name.lower() for excl in EXCLUDED_TREATMENTS):
                continue
            
            # Check for therapist work
            if "therapist" in item_name.lower() or "hygiene" in item_name.lower():
                is_therapist = True
            
            total_amount += item_amount
        
        # Check for finance payments
        payments = get_payments_for_invoice(invoice_id)
        finance_fee = 0
        for payment in payments:
            method = payment.get("payment_method", "").lower()
            if "finance" in method or "tabeo" in method:
                amount = float(payment.get("amount", 0))
                # Flag for manual term entry
                finance_flags.append({
                    "patient": patient_name,
                    "dentist": dentist_name,
                    "amount": amount,
                    "date": paid_date
                })
                # Use default rate for now
                finance_fee += amount * TABEO_DEFAULT_RATE
        
        # Add to dentist totals
        if total_amount > 0:
            if is_therapist:
                payslips[dentist_name]["gross_private_therapist"] += total_amount
            else:
                payslips[dentist_name]["gross_private_dentist"] += total_amount
            
            payslips[dentist_name]["finance_fees_total"] += finance_fee
            
            payslips[dentist_name]["patients"].append({
                "name": patient_name,
                "amount": total_amount,
                "date": paid_date,
                "finance_fee": finance_fee,
                "finance_fee_50": finance_fee * FINANCE_FEE_SPLIT,
                "therapist": is_therapist
            })
    
    # Calculate final figures
    for name, p in payslips.items():
        config = DENTISTS[name]
        
        p["gross_total"] = p["gross_private_dentist"] + p["gross_private_therapist"]
        p["net_private"] = p["gross_total"] * config["split"]
        
        p["lab_bills_total"] = sum(p["lab_bills"].values())
        p["lab_bills_50"] = p["lab_bills_total"] * LAB_BILL_SPLIT
        
        p["finance_fees_50"] = p["finance_fees_total"] * FINANCE_FEE_SPLIT
        
        p["therapy_total"] = p["therapy_minutes"] * THERAPY_RATE_PER_MINUTE
        
        p["total_deductions"] = (
            p["lab_bills_50"] +
            p["finance_fees_50"] +
            p["therapy_total"]
        )
        
        p["total_payment"] = p["net_private"] - p["total_deductions"]
        
        print(f"   {name}: £{p['total_payment']:,.2f}")
    
    return payslips, finance_flags


# =============================================================================
# MAIN
# =============================================================================

def run_payslip_generator(year=None, month=None, lab_bills=None, therapy_minutes=None, nhs_udas=None):
    """Main function to generate payslips"""
    
    print("=" * 60)
    print("🦷 AURA DENTAL CLINIC - PAYSLIP GENERATOR")
    print("=" * 60)
    
    # Determine period
    if year is None or month is None:
        today = datetime.now()
        # Default to previous month
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
    print(f"📅 {start_date.strftime('%d/%m/%Y')} to {end_date.strftime('%d/%m/%Y')}")
    
    # Validate credentials
    if not DENTALLY_API_TOKEN:
        print("\n❌ DENTALLY_API_TOKEN not set")
        return None
    
    # Calculate payslips
    payslips, finance_flags = calculate_payslips(
        start_date, end_date,
        lab_bills, therapy_minutes, nhs_udas
    )
    
    # Update Google Sheets
    if GOOGLE_SHEETS_CREDENTIALS:
        print("\n📊 Updating Google Sheets...")
        client = get_sheets_client()
        if client:
            try:
                spreadsheet = client.open_by_key(SPREADSHEET_ID)
                
                # Update Dashboard
                update_dashboard(spreadsheet, payslips, period_str)
                
                # Update individual payslips
                for name, payslip in payslips.items():
                    update_dentist_payslip(spreadsheet, name, payslip, period_str)
                    print(f"   ✅ {name.split()[0]} Payslip")
                
                # Update finance flags
                if finance_flags:
                    update_finance_flags(spreadsheet, finance_flags)
                    print(f"   ⚠️ {len(finance_flags)} finance payments need term length")
                
            except Exception as e:
                print(f"   ⚠️ Sheets error: {e}")
    
    # Summary
    print("\n" + "=" * 60)
    print("✅ PAYSLIP GENERATION COMPLETE")
    print("=" * 60)
    
    total_payout = sum(p['total_payment'] for p in payslips.values())
    print(f"\n💰 Total Payout: £{total_payout:,.2f}")
    print(f"\n🔗 View: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")
    
    if finance_flags:
        print(f"\n⚠️ ACTION REQUIRED: Enter term lengths for {len(finance_flags)} finance payments")
    
    return payslips


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate dental practice payslips")
    parser.add_argument("--year", type=int, help="Year (default: previous month)")
    parser.add_argument("--month", type=int, help="Month 1-12 (default: previous month)")
    
    args = parser.parse_args()
    
    run_payslip_generator(args.year, args.month)
