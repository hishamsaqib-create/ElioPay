#!/usr/bin/env python3
"""
Push existing payslip data to Google Sheets (no Dentally API calls)
Use this when you already have the numbers and just need to update Sheets
"""

import os
import json
import base64
import gspread
from google.oauth2.service_account import Credentials

# Google Sheets
GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
SPREADSHEET_ID = os.environ.get("PAYSLIP_SPREADSHEET_ID", "1BANM1mdxxtjLAHHc8jSkchHHNbiRC474phtMEINeYHs")

# Practice Info
PRACTICE_NAME = "Aura Dental Clinic"
LOGO_URL = "https://drive.google.com/uc?export=view&id=1Z4d-u7P8XzOOm3IKyssYrRD0o_jZ5fjd"

# December 2025 Results (from successful Dentally run)
PERIOD = "December 2025"

DENTISTS = {
    "Zeeshan Abbas": {"split": 0.45, "has_nhs": False, "uda_rate": None, "display_name": "Dr Zeeshan Abbas"},
    "Peter Throw": {"split": 0.50, "has_nhs": True, "uda_rate": 16, "display_name": "Dr Peter Throw"},
    "Priyanka Kapoor": {"split": 0.50, "has_nhs": True, "uda_rate": 15, "display_name": "Dr Priyanka Kapoor"},
    "Moneeb Ahmad": {"split": 0.50, "has_nhs": True, "uda_rate": 15, "display_name": "Dr Moneeb Ahmad"},
    "Ankush Patel": {"split": 0.45, "has_nhs": False, "uda_rate": None, "display_name": "Dr Ankush Patel"},
    "Hisham Saqib": {"split": 0.50, "has_nhs": False, "uda_rate": None, "display_name": "Dr Hisham Saqib"},
    "Hani Dalati": {"split": 0.50, "has_nhs": False, "uda_rate": None, "display_name": "Dr Hani Dalati"},
}

# Data from successful run
PAYSLIPS = {
    "Zeeshan Abbas": {
        "gross_total": 53040.00,
        "net_private": 23868.00,
        "gross_private_dentist": 53040.00,
        "gross_private_therapist": 0,
        "patients_count": 19,
        "udas": 0,
        "uda_income": 0,
        "lab_bills_50": 0,
        "finance_fees_50": 0,
        "therapy_total": 0,
        "total_deductions": 0,
        "total_payment": 23868.00,
    },
    "Peter Throw": {
        "gross_total": 6526.10,
        "net_private": 3263.05,
        "gross_private_dentist": 6526.10,
        "gross_private_therapist": 0,
        "patients_count": 113,
        "udas": 0,  # Enter manually
        "uda_income": 0,  # Enter manually
        "lab_bills_50": 0,
        "finance_fees_50": 0,
        "therapy_total": 0,
        "total_deductions": 0,
        "total_payment": 3263.05,
    },
    "Priyanka Kapoor": {
        "gross_total": 3911.90,
        "net_private": 1955.95,
        "gross_private_dentist": 3911.90,
        "gross_private_therapist": 0,
        "patients_count": 70,
        "udas": 0,  # Enter manually
        "uda_income": 0,  # Enter manually
        "lab_bills_50": 0,
        "finance_fees_50": 0,
        "therapy_total": 0,
        "total_deductions": 0,
        "total_payment": 1955.95,
    },
    "Moneeb Ahmad": {
        "gross_total": 40304.30,
        "net_private": 20152.15,
        "gross_private_dentist": 40304.30,
        "gross_private_therapist": 0,
        "patients_count": 92,
        "udas": 0,  # Enter manually
        "uda_income": 0,  # Enter manually
        "lab_bills_50": 0,
        "finance_fees_50": 0,
        "therapy_total": 0,
        "total_deductions": 0,
        "total_payment": 20152.15,
    },
    "Ankush Patel": {
        "gross_total": 3325.00,
        "net_private": 1496.25,
        "gross_private_dentist": 3325.00,
        "gross_private_therapist": 0,
        "patients_count": 5,
        "udas": 0,
        "uda_income": 0,
        "lab_bills_50": 0,
        "finance_fees_50": 0,
        "therapy_total": 0,
        "total_deductions": 0,
        "total_payment": 1496.25,
    },
    "Hisham Saqib": {
        "gross_total": 38507.90,
        "net_private": 19253.95,
        "gross_private_dentist": 38507.90,
        "gross_private_therapist": 0,
        "patients_count": 16,
        "udas": 0,
        "uda_income": 0,
        "lab_bills_50": 0,
        "finance_fees_50": 0,
        "therapy_total": 0,
        "total_deductions": 0,
        "total_payment": 19253.95,
    },
    "Hani Dalati": {
        "gross_total": 0,
        "net_private": 0,
        "gross_private_dentist": 0,
        "gross_private_therapist": 0,
        "patients_count": 0,
        "udas": 0,
        "uda_income": 0,
        "lab_bills_50": 0,
        "finance_fees_50": 0,
        "therapy_total": 0,
        "total_deductions": 0,
        "total_payment": 0,
    },
}


def get_sheets_client():
    """Get authenticated Google Sheets client"""
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("❌ No Google Sheets credentials")
        return None
    
    try:
        creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
        creds = Credentials.from_service_account_info(creds_dict, scopes=[
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ])
        return gspread.authorize(creds)
    except Exception as e:
        print(f"❌ Sheets auth error: {e}")
        return None


def update_dashboard(spreadsheet):
    """Update the Dashboard tab"""
    print("📊 Updating Dashboard...")
    
    try:
        sh = spreadsheet.worksheet("Dashboard")
    except:
        print("   ⚠️ Dashboard tab not found")
        return
    
    from datetime import datetime
    
    # Update period
    sh.update_acell('C5', PERIOD)
    sh.update_acell('H5', datetime.now().strftime('%d/%m/%Y'))
    
    # Update each dentist row (starting at row 8)
    row = 8
    total_nhs = 0
    total_private_gross = 0
    total_private_net = 0
    total_deductions = 0
    total_net_pay = 0
    
    for name in DENTISTS.keys():
        config = DENTISTS[name]
        if name in PAYSLIPS:
            p = PAYSLIPS[name]
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
            sh.update(values=[row_data], range_name=f'A{row}')
            
            # Totals
            if config['has_nhs']:
                total_nhs += p.get('uda_income', 0)
            total_private_gross += p['gross_total']
            total_private_net += p['net_private']
            total_deductions += p['total_deductions']
            total_net_pay += p['total_payment']
        
        row += 1
    
    print("   ✅ Dashboard updated")


def update_dentist_payslip(spreadsheet, dentist_name):
    """Update individual dentist payslip tab"""
    
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
    except:
        print(f"   ⚠️ Tab not found: {tab_name}")
        return
    
    config = DENTISTS[dentist_name]
    payslip = PAYSLIPS[dentist_name]
    
    # Build the payslip data
    rows = [
        ["", "", "", "", "", "", "", ""],
        [f'=IMAGE("{LOGO_URL}", 1)', "", "", "", "", "", "", ""],
        ["", "PAYSLIP", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Payslip Date:", "", "15th January 2026", "", "", "", ""],
        ["", "Private Period:", "", PERIOD, "", "", "", ""],
        ["", "Performer:", "", config['display_name'], "", "", "", ""],
        ["", "Practice:", "", PRACTICE_NAME, "", "", "", ""],
        ["", "Superannuation:", "", "Opted Out", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ]
    
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
        ["", "", "", "", "Lab Bills Total", "", "", f"£{payslip.get('lab_bills_total', 0):,.2f}"],
        ["", "", "", "", "Lab Bills 50%", "", "", f"£{payslip['lab_bills_50']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Finance", "", "", "", "", ""],
        ["", "", "", "", "Finance Fees Total", "", "", f"£{payslip.get('finance_fees_total', 0):,.2f}"],
        ["", "", "", "", "Finance Fees 50%", "", "", f"£{payslip['finance_fees_50']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Therapy", "", "Taryn", "", "", ""],
        ["", "", "", "", "Minutes", "", "", str(payslip.get('therapy_minutes', 0))],
        ["", "", "", "", "@ £0.583/min", "", "", f"£{payslip['therapy_total']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
        ["", "Total Deductions", "", "", "", "", "", f"£{payslip['total_deductions']:,.2f}"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Total Payment
    total_with_nhs = payslip['total_payment']
    if config['has_nhs']:
        total_with_nhs += payslip.get('uda_income', 0)
    
    rows.extend([
        ["", "─────────────────────────────────────", "", "", "", "", "", ""],
        ["", "TOTAL PAYMENT", "", "", "", "", "", f"£{total_with_nhs:,.2f}"],
        ["", "─────────────────────────────────────", "", "", "", "", "", ""],
    ])
    
    # Update the sheet
    sh.clear()
    sh.update(values=rows, range_name='A1')
    
    # Formatting
    sh.format('B3', {'textFormat': {'bold': True, 'fontSize': 18}})
    sh.format('B5:B9', {'textFormat': {'bold': True}})
    
    print(f"   ✅ {first_name} Payslip")


def main():
    print("=" * 60)
    print("🦷 PUSHING DECEMBER 2025 DATA TO GOOGLE SHEETS")
    print("=" * 60)
    print(f"\n📅 Period: {PERIOD}")
    print("💰 Total Payout: £69,989.35")
    
    client = get_sheets_client()
    if not client:
        return
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        
        # Update Dashboard
        update_dashboard(spreadsheet)
        
        # Update individual payslips
        for name in PAYSLIPS.keys():
            if PAYSLIPS[name]['gross_total'] > 0:
                update_dentist_payslip(spreadsheet, name)
        
        print("\n" + "=" * 60)
        print("✅ SHEETS UPDATED SUCCESSFULLY")
        print("=" * 60)
        print(f"\n🔗 View: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")
        
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()
