#!/usr/bin/env python3
"""
Aura Dental Clinic - Enhanced Google Sheet Setup
Better UX, logo, and NHS UDA tracking
"""

import os
import json
import base64
import time
import gspread
from google.oauth2.service_account import Credentials

# Configuration
SPREADSHEET_ID = os.environ.get("PAYSLIP_SPREADSHEET_ID", "1BANM1mdxxtjLAHHc8jSkchHHNbiRC474phtMEINeYHs")
GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GO OGLE_SHEETS_CREDENTIALS", "")

# Dentists with their config
DENTISTS = {
    "Zeeshan Abbas": {"split": "45%", "uda_rate": None, "has_nhs": False},
    "Peter Throw": {"split": "50%", "uda_rate": 16, "has_nhs": True},
    "Priyanka Kapoor": {"split": "50%", "uda_rate": 15, "has_nhs": True},
    "Moneeb Ahmad": {"split": "50%", "uda_rate": 15, "has_nhs": True},
    "Hani Dalati": {"split": "50%", "uda_rate": None, "has_nhs": False},
    "Ankush Patel": {"split": "50%", "uda_rate": None, "has_nhs": False},
    "Hisham Saqib": {"split": "50%", "uda_rate": None, "has_nhs": False},
}

# Logo URL (hosted on Google Drive or web)
LOGO_URL = "https://drive.google.com/uc?export=view&id=YOUR_LOGO_ID"


def get_client():
    """Get authenticated Google Sheets client"""
    creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
    creds = Credentials.from_service_account_info(creds_dict, scopes=[
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ])
    return gspread.authorize(creds)


def setup_dashboard(spreadsheet):
    """Create enhanced Dashboard"""
    print("Creating Dashboard...")
    
    try:
        sh = spreadsheet.worksheet("Dashboard")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet("Dashboard", 30, 20)
    
    # Header section
    data = [
        ["", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "🦷 AURA DENTAL CLINIC", "", "", "", "", "", "", "", "", "", ""],
        ["", "PAYSLIP DASHBOARD", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Pay Period:", "December 2025", "", "", "Generated:", "01/01/2026", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", ""],
        # Column headers
        ["", "DENTIST", "NHS UDAs", "UDA Rate", "NHS Income", "PRIVATE GROSS", "SPLIT", "PRIVATE NET", "LAB 50%", "FINANCE 50%", "THERAPY", "DEDUCTIONS", "NET PAY", "STATUS"],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]
    
    # Add dentist rows
    for name, config in DENTISTS.items():
        uda_rate = f"£{config['uda_rate']}" if config['uda_rate'] else "-"
        has_nhs = "0" if config['has_nhs'] else "-"
        nhs_income = "£0" if config['has_nhs'] else "-"
        
        data.append([
            "",
            name,
            has_nhs,
            uda_rate,
            nhs_income,
            "£0",
            config['split'],
            "£0",
            "£0",
            "£0",
            "£0",
            "£0",
            "£0",
            "⏳ Pending"
        ])
    
    # Totals row
    data.append(["", "", "", "", "", "", "", "", "", "", "", "", "", ""])
    data.append(["", "TOTAL", "", "", "£0", "£0", "", "£0", "£0", "£0", "£0", "£0", "£0", ""])
    
    sh.update(values=data, range_name='A1')
    
    # Apply formatting
    sh.format('B2:B3', {
        'textFormat': {'bold': True, 'fontSize': 18},
        'horizontalAlignment': 'LEFT'
    })
    sh.format('B8:N8', {
        'textFormat': {'bold': True, 'fontSize': 10},
        'backgroundColor': {'red': 0.2, 'green': 0.2, 'blue': 0.2},
        'horizontalAlignment': 'CENTER',
        'textFormat': {'foregroundColor': {'red': 1, 'green': 1, 'blue': 1}, 'bold': True}
    })
    
    # Freeze header row
    sh.freeze(rows=8)
    
    print("   ✅ Dashboard created")


def setup_lab_bills(spreadsheet):
    """Create Lab Bills input tab"""
    print("Creating Lab Bills...")
    
    try:
        sh = spreadsheet.worksheet("Lab Bills")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet("Lab Bills", 200, 12)
    
    data = [
        ["", "", "", "", "", "", "", "", ""],
        ["", "🧪 LAB BILLS", "", "", "", "", "", "", ""],
        ["", "Enter lab bills below. Script auto-extracts from PDFs uploaded to Drive.", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "MONTH", "LAB", "PATIENT", "DENTIST", "AMOUNT", "INVOICE LINK", "STATUS", "NOTES"],
        ["", "", "", "", "", "", "", "", ""],
        ["", "Dec 2025", "Furze", "John Smith", "Zeeshan Abbas", "£500.00", "", "✅ Assigned", ""],
        ["", "Dec 2025", "Halo", "Jane Doe", "Peter Throw", "£350.00", "", "✅ Assigned", ""],
        ["", "Dec 2025", "Straumann", "(Unknown)", "", "£200.00", "", "⚠️ Assign dentist", "No patient name"],
    ]
    
    sh.update(values=data, range_name='A1')
    
    sh.format('B2', {'textFormat': {'bold': True, 'fontSize': 16}})
    sh.format('B5:I5', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 0.8, 'green': 0.9, 'blue': 1.0}
    })
    
    print("   ✅ Lab Bills created")


def setup_finance_flags(spreadsheet):
    """Create Finance Flags tab"""
    print("Creating Finance Flags...")
    
    try:
        sh = spreadsheet.worksheet("Finance Flags")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet("Finance Flags", 100, 12)
    
    data = [
        ["", "", "", "", "", "", "", "", ""],
        ["", "💳 FINANCE PAYMENTS", "", "", "", "", "", "", ""],
        ["", "Enter the term length for each finance payment to calculate correct Tabeo fee", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "PATIENT", "DENTIST", "AMOUNT", "DATE", "TERM (months)", "SUBSIDY %", "FEE AMOUNT", "STATUS"],
        ["", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "📋 RATE REFERENCE:", "", "", "", "", "", "", ""],
        ["", "3 months", "4.5%", "", "", "", "", "", ""],
        ["", "12 months", "8.0%", "(most common)", "", "", "", "", ""],
        ["", "36 months", "3.4%", "", "", "", "", "", ""],
        ["", "60 months", "3.7%", "", "", "", "", "", ""],
    ]
    
    sh.update(values=data, range_name='A1')
    
    sh.format('B2', {'textFormat': {'bold': True, 'fontSize': 16}})
    sh.format('B5:I5', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 1.0, 'green': 0.9, 'blue': 0.8}
    })
    sh.format('B9:C13', {'textFormat': {'italic': True, 'fontSize': 9}})
    
    print("   ✅ Finance Flags created")


def setup_discrepancies(spreadsheet):
    """Create Discrepancies tab"""
    print("Creating Discrepancies...")
    
    try:
        sh = spreadsheet.worksheet("Discrepancies")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet("Discrepancies", 100, 12)
    
    data = [
        ["", "", "", "", "", "", "", "", ""],
        ["", "🔍 DISCREPANCIES", "", "", "", "", "", "", ""],
        ["", "Cross-reference between Dentally and Private Takings Logs", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "DENTIST", "PATIENT", "IN DENTALLY", "IN TAKINGS LOG", "DIFFERENCE", "ISSUE", "ACTION", "STATUS"],
    ]
    
    sh.update(values=data, range_name='A1')
    
    sh.format('B2', {'textFormat': {'bold': True, 'fontSize': 16}})
    sh.format('B5:I5', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 1.0, 'green': 0.85, 'blue': 0.85}
    })
    
    print("   ✅ Discrepancies created")


def setup_incomplete(spreadsheet):
    """Create Incomplete Treatment tab"""
    print("Creating Incomplete Treatment...")
    
    try:
        sh = spreadsheet.worksheet("Incomplete Treatment")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet("Incomplete Treatment", 100, 12)
    
    data = [
        ["", "", "", "", "", "", "", ""],
        ["", "⚠️ INCOMPLETE TREATMENT", "", "", "", "", "", ""],
        ["", "Items that are PAID but not marked COMPLETE in Dentally", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "PATIENT", "DENTIST", "AMOUNT", "PAID DATE", "IN TAKINGS LOG", "ACTION NEEDED", "STATUS"],
    ]
    
    sh.update(values=data, range_name='A1')
    
    sh.format('B2', {'textFormat': {'bold': True, 'fontSize': 16}})
    sh.format('B5:H5', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 1.0, 'green': 1.0, 'blue': 0.7}
    })
    
    print("   ✅ Incomplete Treatment created")


def setup_config(spreadsheet):
    """Create Config tab"""
    print("Creating Config...")
    
    try:
        sh = spreadsheet.worksheet("Config")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet("Config", 50, 6)
    
    data = [
        ["", "", "", "", ""],
        ["", "⚙️ CONFIGURATION", "", "", ""],
        ["", "", "", "", ""],
        ["", "SETTING", "VALUE", "NOTES", ""],
        ["", "Pay Period", "December 2025", "Month being processed", ""],
        ["", "", "", "", ""],
        ["", "💳 TABEO SUBSIDY RATES", "", "", ""],
        ["", "3 months", "4.5%", "", ""],
        ["", "12 months", "8.0%", "Most common", ""],
        ["", "36 months", "3.4%", "", ""],
        ["", "60 months", "3.7%", "", ""],
        ["", "", "", "", ""],
        ["", "📊 DEDUCTION SPLITS", "", "", ""],
        ["", "Lab Bills", "50%", "Dentist pays half", ""],
        ["", "Finance Fees", "50%", "Dentist pays half", ""],
        ["", "Therapy Rate", "£0.583/min", "£35/hour (Taryn)", ""],
        ["", "", "", "", ""],
        ["", "👨‍⚕️ DENTIST CONFIGURATION", "", "", ""],
        ["", "DENTIST", "PRIVATE SPLIT", "UDA RATE", "NHS?"],
    ]
    
    for name, config in DENTISTS.items():
        uda_rate = f"£{config['uda_rate']}" if config['uda_rate'] else "-"
        has_nhs = "Yes" if config['has_nhs'] else "No"
        data.append(["", name, config['split'], uda_rate, has_nhs])
    
    data.append(["", "", "", "", ""])
    data.append(["", "🚫 EXCLUDED FROM DENTIST PAY", "", "", ""])
    data.append(["", "CBCT / CT Scan", "Goes to practice", "", ""])
    
    sh.update(values=data, range_name='A1')
    
    sh.format('B2', {'textFormat': {'bold': True, 'fontSize': 16}})
    sh.format('B4:D4', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})
    sh.format('B7', {'textFormat': {'bold': True}})
    sh.format('B13', {'textFormat': {'bold': True}})
    sh.format('B18', {'textFormat': {'bold': True}})
    sh.format('B19:E19', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})
    
    print("   ✅ Config created")


def setup_dentist_payslip(spreadsheet, name, config):
    """Create individual dentist payslip with enhanced design"""
    
    first_name = name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(tab_name, 100, 12)
    
    # Build payslip data
    data = [
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "PAYSLIP", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Payslip Date:", "", "15th January 2026", "", "", "", ""],
        ["", "Private Period:", "", "December 2025", "", "", "", ""],
        ["", "Performer:", "", f"Dr {name}", "", "", "", ""],
        ["", "Practice:", "", "Aura Dental Clinic", "", "", "", ""],
        ["", "Superannuation:", "", "Opted Out", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ]
    
    # NHS Section (only for dentists with UDAs)
    if config['has_nhs']:
        data.extend([
            ["", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "", "", "", "", "", ""],
            ["", "SECTION 1: NHS INCOME", "", "", "", "", "", ""],
            ["", "", "", "", "", "", "", ""],
            ["", "", "", "", "UDAs Achieved", "", "", "0"],
            ["", "", "", "", f"UDA Rate", "", "", f"£{config['uda_rate']}"],
            ["", "", "", "", "NHS Income", "", "", "£0.00"],
            ["", "", "", "", "", "", "", ""],
        ])
        private_section = "SECTION 2: PRIVATE FEES"
    else:
        private_section = "SECTION 1: PRIVATE FEES"
    
    # Private Section
    data.extend([
        ["", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "", "", "", "", "", ""],
        ["", private_section, "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "Gross Private by Dentist", "", "", "£0.00"],
        ["", "", "", "", "Gross Private by Therapist", "", "", "£0.00"],
        ["", "", "", "", "Gross Total", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
        ["", "Subtotal", "", "", config['split'], "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Deductions Section
    section_num = "3" if config['has_nhs'] else "2"
    data.extend([
        ["", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "", "", "", "", "", ""],
        ["", f"SECTION {section_num}: DEDUCTIONS", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Labs", "", "", "", "", ""],
        ["", "", "", "", "Lab Bills Total", "", "", "£0.00"],
        ["", "", "", "", "Lab Bills 50%", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Finance", "", "", "", "", ""],
        ["", "", "", "", "Finance Fees Total", "", "", "£0.00"],
        ["", "", "", "", "Finance Fees 50%", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "Therapy", "", "Taryn", "", "", ""],
        ["", "", "", "", "Minutes", "", "", "0"],
        ["", "", "", "", "@ £0.583/min", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
        ["", "Total Deductions", "", "", "", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Total Payment
    data.extend([
        ["", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "", "", "", "", "", ""],
        ["", "TOTAL PAYMENT", "", "", "", "", "", "£0.00"],
        ["", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Patient Breakdown
    data.extend([
        ["", "PATIENT BREAKDOWN", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Patient Name", "", "Completion Date", "Finance Fee", "Finance 50%", "Therapist", "Paid"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    sh.update(values=data, range_name='A1')
    
    # Formatting
    sh.format('B3', {'textFormat': {'bold': True, 'fontSize': 20}})
    sh.format('B5:B9', {'textFormat': {'bold': True}})
    
    # Find and format section headers
    for i, row in enumerate(data):
        if len(row) > 1:
            if "SECTION" in str(row[1]):
                sh.format(f'B{i+1}', {'textFormat': {'bold': True, 'fontSize': 12}})
            if "TOTAL PAYMENT" in str(row[1]):
                sh.format(f'B{i+1}:H{i+1}', {
                    'textFormat': {'bold': True, 'fontSize': 14},
                    'backgroundColor': {'red': 0.9, 'green': 0.95, 'blue': 0.9}
                })
            if "PATIENT BREAKDOWN" in str(row[1]):
                sh.format(f'B{i+1}', {'textFormat': {'bold': True, 'fontSize': 12}})
    
    return sh


def main():
    """Set up the complete enhanced Google Sheet"""
    print("=" * 60)
    print("🦷 AURA DENTAL - ENHANCED SHEET SETUP")
    print("=" * 60)
    
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("❌ GOOGLE_SHEETS_CREDENTIALS not set")
        return
    
    client = get_client()
    print("✅ Connected to Google Sheets")
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        print(f"✅ Opened: {spreadsheet.title}")
    except Exception as e:
        print(f"❌ Could not open spreadsheet: {e}")
        return
    
    # Delete default Sheet1 if exists
    try:
        spreadsheet.del_worksheet(spreadsheet.worksheet("Sheet1"))
    except:
        pass
    
    print("\n📊 Creating tabs...")
    
    # Create main tabs
    setup_dashboard(spreadsheet)
    time.sleep(1)
    setup_lab_bills(spreadsheet)
    time.sleep(1)
    setup_finance_flags(spreadsheet)
    time.sleep(1)
    setup_discrepancies(spreadsheet)
    time.sleep(1)
    setup_incomplete(spreadsheet)
    time.sleep(1)
    setup_config(spreadsheet)
    time.sleep(1)
    
    # Create individual payslips
    print("\nCreating individual payslips...")
    for name, config in DENTISTS.items():
        setup_dentist_payslip(spreadsheet, name, config)
        print(f"   ✅ {name.split()[0]} Payslip")
        time.sleep(2)  # Rate limit protection
    
    print("\n" + "=" * 60)
    print("✅ SETUP COMPLETE!")
    print("=" * 60)
    print(f"\n🔗 View your sheet:")
    print(f"   https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")


if __name__ == "__main__":
    main()
