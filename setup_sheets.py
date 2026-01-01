#!/usr/bin/env python3
"""
Aura Dental Clinic - Google Sheet Setup Script
Creates the proper structure for the Payslip Generator

Run this once to set up all tabs and formatting.
"""

import os
import json
import base64
import gspread
from google.oauth2.service_account import Credentials

# Configuration
SPREADSHEET_ID = os.environ.get("PAYSLIP_SPREADSHEET_ID", "1BANM1mdxxtjLAHHc8jSkchHHNbiRC474phtMEINeYHs")
GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")

# Dentists
DENTISTS = [
    "Zeeshan Abbas",
    "Peter Throw", 
    "Priyanka Kapoor",
    "Moneeb Ahmad",
    "Hani Dalati",
    "Ankush Patel",
    "Hisham Saqib"
]

# Labs
LABS = [
    "Furze", "Halo", "Straumann", "Robinsons", "Queensway",
    "Richley", "Priory", "Jordent", "Boutique", "Costech",
    "Optadent", "Scan Digital", "Invisalign"
]


def get_sheets_client():
    """Get authenticated Google Sheets client"""
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("❌ GOOGLE_SHEETS_CREDENTIALS environment variable not set")
        print("   Set it to the base64-encoded service account JSON")
        return None
    
    try:
        creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        creds = Credentials.from_service_account_info(creds_dict, scopes=scopes)
        client = gspread.authorize(creds)
        print("✅ Connected to Google Sheets")
        return client
    except Exception as e:
        print(f"❌ Google Sheets auth error: {e}")
        return None


def setup_dashboard(spreadsheet):
    """Create the Dashboard tab"""
    print("   Creating Dashboard...")
    
    try:
        sheet = spreadsheet.worksheet("Dashboard")
        sheet.clear()
    except:
        sheet = spreadsheet.add_worksheet(title="Dashboard", rows=20, cols=15)
    
    # Headers
    headers = [
        ["AURA DENTAL CLINIC - PAYSLIP DASHBOARD"],
        [""],
        ["Pay Period:", "", "Status:", ""],
        [""],
        ["Dentist", "Gross Private", "Split", "Net Private", "Lab Bills 50%", "Finance 50%", "Therapy", "Total Deductions", "Net Pay", "Status"],
    ]
    
    # Add dentist rows
    for dentist in DENTISTS:
        split = "45%" if dentist == "Zeeshan Abbas" else "50%"
        headers.append([dentist, "£0", split, "£0", "£0", "£0", "£0", "£0", "£0", "⏳ Pending"])
    
    # Totals row
    headers.append([""])
    headers.append(["TOTAL", "", "", "", "", "", "", "", "£0", ""])
    
    sheet.update('A1', headers)
    
    # Formatting
    sheet.format('A1', {'textFormat': {'bold': True, 'fontSize': 16}})
    sheet.format('A5:J5', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})
    
    print("   ✅ Dashboard created")
    return sheet


def setup_lab_bills(spreadsheet):
    """Create the Lab Bills Input tab"""
    print("   Creating Lab Bills Input...")
    
    try:
        sheet = spreadsheet.worksheet("Lab Bills")
        sheet.clear()
    except:
        sheet = spreadsheet.add_worksheet(title="Lab Bills", rows=200, cols=10)
    
    headers = [
        ["LAB BILLS INPUT"],
        ["Upload lab bill PDFs to Google Drive folder, or enter manually below"],
        [""],
        ["Month", "Lab Name", "Patient Name", "Dentist", "Amount", "Invoice Link", "Status", "Notes"],
    ]
    
    # Add some example rows
    headers.append(["Nov 2025", "Furze", "John Smith", "Zeeshan Abbas", "£500", "", "✅ Assigned", ""])
    headers.append(["Nov 2025", "Halo", "Jane Doe", "Peter Throw", "£350", "", "✅ Assigned", ""])
    headers.append(["Nov 2025", "Straumann", "", "", "£200", "", "⚠️ Need dentist", "No patient name on invoice"])
    
    sheet.update('A1', headers)
    
    # Formatting
    sheet.format('A1', {'textFormat': {'bold': True, 'fontSize': 14}})
    sheet.format('A4:H4', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.8, 'green': 0.9, 'blue': 1.0}})
    
    # Data validation for Lab Name
    # (Would need gspread-formatting for full validation)
    
    print("   ✅ Lab Bills created")
    return sheet


def setup_finance_flags(spreadsheet):
    """Create the Finance Flags tab"""
    print("   Creating Finance Flags...")
    
    try:
        sheet = spreadsheet.worksheet("Finance Flags")
        sheet.clear()
    except:
        sheet = spreadsheet.add_worksheet(title="Finance Flags", rows=100, cols=10)
    
    headers = [
        ["FINANCE PAYMENTS - ENTER TERM LENGTH"],
        ["The system detected these finance payments. Enter the term (months) to calculate correct Tabeo fee."],
        [""],
        ["Patient Name", "Dentist", "Amount", "Payment Date", "Term (months)", "Subsidy %", "Fee Amount", "Status"],
        ["", "", "", "", "", "", "", ""],
        ["TERM REFERENCE:"],
        ["3 months = 4.5%"],
        ["12 months = 8.0%"],
        ["36 months = 3.4%"],
        ["60 months = 3.7%"],
    ]
    
    sheet.update('A1', headers)
    
    # Formatting
    sheet.format('A1', {'textFormat': {'bold': True, 'fontSize': 14}})
    sheet.format('A4:H4', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 1.0, 'green': 0.9, 'blue': 0.8}})
    sheet.format('A6:A10', {'textFormat': {'italic': True}})
    
    print("   ✅ Finance Flags created")
    return sheet


def setup_discrepancies(spreadsheet):
    """Create the Discrepancies tab"""
    print("   Creating Discrepancies...")
    
    try:
        sheet = spreadsheet.worksheet("Discrepancies")
        sheet.clear()
    except:
        sheet = spreadsheet.add_worksheet(title="Discrepancies", rows=100, cols=10)
    
    headers = [
        ["DISCREPANCIES - REVIEW REQUIRED"],
        ["Cross-reference between Dentally and Private Takings Logs"],
        [""],
        ["Dentist", "Patient", "In Dentally", "In Takings Log", "Difference", "Issue", "Action Needed", "Status"],
    ]
    
    sheet.update('A1', headers)
    
    # Formatting
    sheet.format('A1', {'textFormat': {'bold': True, 'fontSize': 14}})
    sheet.format('A4:H4', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 1.0, 'green': 0.8, 'blue': 0.8}})
    
    print("   ✅ Discrepancies created")
    return sheet


def setup_incomplete_treatment(spreadsheet):
    """Create the Incomplete Treatment tab"""
    print("   Creating Incomplete Treatment...")
    
    try:
        sheet = spreadsheet.worksheet("Incomplete Treatment")
        sheet.clear()
    except:
        sheet = spreadsheet.add_worksheet(title="Incomplete Treatment", rows=100, cols=10)
    
    headers = [
        ["INCOMPLETE TREATMENT - ACTION REQUIRED"],
        ["These items are PAID but not marked COMPLETE in Dentally"],
        [""],
        ["Patient", "Dentist", "Amount", "Paid Date", "In Takings Log", "Action", "Status"],
    ]
    
    sheet.update('A1', headers)
    
    # Formatting  
    sheet.format('A1', {'textFormat': {'bold': True, 'fontSize': 14}})
    sheet.format('A4:G4', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 1.0, 'green': 1.0, 'blue': 0.7}})
    
    print("   ✅ Incomplete Treatment created")
    return sheet


def setup_dentist_payslip(spreadsheet, dentist_name):
    """Create a payslip tab for a dentist"""
    
    # Short name for tab
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sheet = spreadsheet.worksheet(tab_name)
        sheet.clear()
    except:
        sheet = spreadsheet.add_worksheet(title=tab_name, rows=100, cols=10)
    
    split = "45%" if dentist_name == "Zeeshan Abbas" else "50%"
    
    headers = [
        ["", "", "", "", "", "", "", ""],
        ["Payslip Date:", "", "", "", "", "", "", ""],
        ["Private Period:", "", "", "", "", "", "", ""],
        ["Performer:", "", f"Dr {dentist_name}", "", "", "", "", ""],
        ["Practice:", "", "Aura Dental Clinic", "", "", "", "", ""],
        ["Superannuation:", "", "Opted Out", "", "", "", "", ""],
        [""],
        ["Section 1: Private Fees"],
        ["", "", "", "", "Gross Private by Dentist", "", "", "£0"],
        ["", "", "", "", "Gross Private by Therapist", "", "", "£0"],
        ["", "", "", "", "Gross Total", "", "", "£0"],
        ["Subtotal", "", "", "", split, "", "", "£0"],
        [""],
        ["Section 2: Deductions"],
        ["", "", "", "Labs", "", "", "", ""],
        ["", "", "", "", "Lab Bills Total", "", "", "£0"],
        ["", "", "", "", "Lab Bills 50%", "", "", "£0"],
        [""],
        ["", "", "", "Finance Fees", "", "", "", "£0"],
        ["", "", "", "50%", "", "", "", "£0"],
        [""],
        ["", "", "", "Therapy", "Taryn", "", "", "0 mins"],
        ["", "", "", "", "@ £0.583/min", "", "", "£0"],
        [""],
        ["Total Deductions", "", "", "", "", "", "", "£0"],
        [""],
        ["Total Payment", "", "", "", "", "", "", "£0"],
        [""],
        ["Patient Breakdown"],
        ["Name", "", "", "", "Finance Fee", "Finance 50%", "Therapist", "Paid"],
    ]
    
    sheet.update('A1', headers)
    
    # Formatting
    sheet.format('A8', {'textFormat': {'bold': True, 'fontSize': 12}})
    sheet.format('A14', {'textFormat': {'bold': True, 'fontSize': 12}})
    sheet.format('A25', {'textFormat': {'bold': True}})
    sheet.format('A27', {'textFormat': {'bold': True, 'fontSize': 14}, 'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})
    sheet.format('A29', {'textFormat': {'bold': True}})
    sheet.format('A30:H30', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})
    
    return sheet


def setup_config(spreadsheet):
    """Create the Config tab"""
    print("   Creating Config...")
    
    try:
        sheet = spreadsheet.worksheet("Config")
        sheet.clear()
    except:
        sheet = spreadsheet.add_worksheet(title="Config", rows=50, cols=5)
    
    headers = [
        ["CONFIGURATION"],
        [""],
        ["Setting", "Value", "Notes"],
        ["Pay Period", "December 2025", "Month being processed"],
        [""],
        ["TABEO FEE RATES"],
        ["3 months", "4.5%", ""],
        ["12 months", "8.0%", "Most common"],
        ["36 months", "3.4%", ""],
        ["60 months", "3.7%", ""],
        [""],
        ["OTHER RATES"],
        ["Lab Bill Split", "50%", "Dentist pays half"],
        ["Finance Fee Split", "50%", "Dentist pays half"],
        ["Therapy Rate", "£0.583/min", "£35/hour"],
        [""],
        ["DENTIST SPLITS"],
        ["Zeeshan Abbas", "45%", ""],
        ["Peter Throw", "50%", "UDA: £16"],
        ["Priyanka Kapoor", "50%", "UDA: £15"],
        ["Moneeb Ahmad", "50%", "UDA: £15"],
        ["Hani Dalati", "50%", "UDA: £15"],
        ["Ankush Patel", "50%", "UDA: £15"],
        ["Hisham Saqib", "50%", "Owner"],
        [""],
        ["EXCLUDED ITEMS"],
        ["CBCT", "Goes to practice", ""],
        ["CT Scan", "Goes to practice", ""],
    ]
    
    sheet.update('A1', headers)
    
    # Formatting
    sheet.format('A1', {'textFormat': {'bold': True, 'fontSize': 14}})
    sheet.format('A3:C3', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})
    sheet.format('A6', {'textFormat': {'bold': True}})
    sheet.format('A12', {'textFormat': {'bold': True}})
    sheet.format('A17', {'textFormat': {'bold': True}})
    sheet.format('A26', {'textFormat': {'bold': True}})
    
    print("   ✅ Config created")
    return sheet


def main():
    """Set up the complete Google Sheet structure"""
    print("=" * 60)
    print("🦷 AURA DENTAL - GOOGLE SHEET SETUP")
    print("=" * 60)
    
    client = get_sheets_client()
    if not client:
        return
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        print(f"✅ Opened spreadsheet: {spreadsheet.title}")
    except Exception as e:
        print(f"❌ Could not open spreadsheet: {e}")
        print("   Make sure you've shared the sheet with the service account email")
        return
    
    # Delete default Sheet1 if it exists
    try:
        sheet1 = spreadsheet.worksheet("Sheet1")
        spreadsheet.del_worksheet(sheet1)
        print("   Removed default Sheet1")
    except:
        pass
    
    print("\n📊 Creating tabs...")
    
    # Create all tabs
    setup_dashboard(spreadsheet)
    setup_lab_bills(spreadsheet)
    setup_finance_flags(spreadsheet)
    setup_discrepancies(spreadsheet)
    setup_incomplete_treatment(spreadsheet)
    setup_config(spreadsheet)
    
    # Create individual payslip tabs
    print("   Creating dentist payslips...")
    for dentist in DENTISTS:
        setup_dentist_payslip(spreadsheet, dentist)
        print(f"   ✅ {dentist.split()[0]} Payslip created")
    
    print("\n" + "=" * 60)
    print("✅ SETUP COMPLETE!")
    print("=" * 60)
    print(f"\nYour sheet is ready: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")
    print("\nTabs created:")
    print("  • Dashboard - Summary of all dentists")
    print("  • Lab Bills - Input lab bills here")
    print("  • Finance Flags - Enter finance term lengths")
    print("  • Discrepancies - Review cross-reference issues")
    print("  • Incomplete Treatment - Items needing completion")
    print("  • Config - Settings and rates")
    print("  • [Dentist] Payslip - Individual payslips for each dentist")


if __name__ == "__main__":
    main()
