#!/usr/bin/env python3
"""
Aura Dental Clinic - Professional Sheet Setup v2.0
Black/White/Beige branding matching Aura website
"""

import os
import json
import base64
import time
import gspread
from google.oauth2.service_account import Credentials

# Configuration
SPREADSHEET_ID = os.environ.get("PAYSLIP_SPREADSHEET_ID", "1BANM1mdxxtjLAHHc8jSkchHHNbiRC474phtMEINeYHs")
GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")

# Aura Brand Colors
COLORS = {
    'black': {'red': 0.1, 'green': 0.1, 'blue': 0.1},
    'white': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
    'beige': {'red': 0.96, 'green': 0.93, 'blue': 0.88},      # #F5EDE1
    'beige_light': {'red': 0.98, 'green': 0.96, 'blue': 0.93}, # #FAF5EE
    'gold': {'red': 0.83, 'green': 0.65, 'blue': 0.45},        # #D4A574
    'gold_light': {'red': 0.96, 'green': 0.90, 'blue': 0.83},  # #F5E6D3
    'green': {'red': 0.85, 'green': 0.92, 'blue': 0.85},       # Success
    'red_light': {'red': 0.99, 'green': 0.90, 'blue': 0.90},   # Warning
    'gray': {'red': 0.95, 'green': 0.95, 'blue': 0.95},
    'gray_dark': {'red': 0.3, 'green': 0.3, 'blue': 0.3},
}

# Dentists config
DENTISTS = {
    "Zeeshan Abbas": {"split": "45%", "uda_rate": None, "has_nhs": False},
    "Peter Throw": {"split": "50%", "uda_rate": 16, "has_nhs": True},
    "Priyanka Kapoor": {"split": "50%", "uda_rate": 15, "has_nhs": True},
    "Moneeb Ahmad": {"split": "50%", "uda_rate": 15, "has_nhs": True},
    "Hani Dalati": {"split": "50%", "uda_rate": None, "has_nhs": False},
    "Ankush Patel": {"split": "45%", "uda_rate": None, "has_nhs": False},
    "Hisham Saqib": {"split": "50%", "uda_rate": None, "has_nhs": False},
}

# Logo - share this file with the service account email
LOGO_FILE_ID = "1Z4d-u7P8XzOOm3IKyssYrRD0o_jZ5fjd"


def get_client():
    """Get authenticated Google Sheets client"""
    creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
    creds = Credentials.from_service_account_info(creds_dict, scopes=[
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ])
    return gspread.authorize(creds)


def setup_dashboard(spreadsheet):
    """Setup Dashboard with Aura branding"""
    print("   Setting up Dashboard...")
    
    try:
        sh = spreadsheet.worksheet("Dashboard")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(title="Dashboard", rows=100, cols=20)
    
    # Header data
    rows = [
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "AURA DENTAL CLINIC", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Payroll Dashboard", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Pay Period", "", "", "", "Generated", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        # Headers
        ["", "Dentist", "UDAs", "Rate", "NHS", "Gross Private", "Split", "Net Pay", "Labs", "Finance", "Therapy", "Deductions", "Total", "Status"],
    ]
    
    # Dentist rows
    for name in DENTISTS.keys():
        rows.append(["", name, "-", "-", "-", "£0.00", DENTISTS[name]["split"], "£0.00", "£0.00", "£0.00", "£0.00", "£0.00", "£0.00", "⏳"])
    
    # Totals
    rows.append(["", "", "", "", "", "", "", "", "", "", "", "", "", ""])
    rows.append(["", "TOTAL", "", "", "", "", "", "", "", "", "", "", "£0.00", ""])
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Formatting
    sheet_id = sh.id
    requests = [
        # Black header band
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 15},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['black']}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        },
        # Title - white text
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 22}
                }},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Subtitle - gold text
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 2, 'endRowIndex': 3, 'startColumnIndex': 1, 'endColumnIndex': 6},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'foregroundColor': COLORS['gold'], 'bold': False, 'fontSize': 12}
                }},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Column headers - beige background
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 7, 'endRowIndex': 8, 'startColumnIndex': 1, 'endColumnIndex': 15},
                'cell': {'userEnteredFormat': {
                    'backgroundColor': COLORS['beige'],
                    'textFormat': {'bold': True, 'fontSize': 10},
                    'borders': {
                        'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['gold']}
                    }
                }},
                'fields': 'userEnteredFormat'
            }
        },
        # Freeze header rows
        {
            'updateSheetProperties': {
                'properties': {'sheetId': sheet_id, 'gridProperties': {'frozenRowCount': 8}},
                'fields': 'gridProperties.frozenRowCount'
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
    
    # Alternating rows for dentists
    for i in range(len(DENTISTS)):
        row_idx = 8 + i
        bg = COLORS['white'] if i % 2 == 0 else COLORS['beige_light']
        requests.append({
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': row_idx, 'endRowIndex': row_idx + 1, 'startColumnIndex': 1, 'endColumnIndex': 15},
                'cell': {'userEnteredFormat': {'backgroundColor': bg}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        })
    
    spreadsheet.batch_update({'requests': requests})
    print("   ✅ Dashboard ready")


def setup_dentist_payslip(spreadsheet, dentist_name, config):
    """Setup individual dentist payslip with Aura branding"""
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(title=tab_name, rows=300, cols=10)
    
    split_pct = config["split"]
    
    # Build payslip structure
    rows = [
        ["", "", "", "", "", "", "", ""],
        ["", "PAYSLIP", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Payslip Date:", "", "", "", "", "", ""],
        ["", "Private Period:", "", "", "", "", "", ""],
        ["", "Performer:", f"Dr {dentist_name}", "", "", "", "", ""],
        ["", "Practice:", "Aura Dental Clinic", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ]
    
    current_row = 9
    
    # NHS Section (if applicable)
    if config["has_nhs"]:
        rows.extend([
            ["", "", "", "", "", "", "", ""],
            ["", "NHS INCOME", "", "", "", "", "", ""],
            ["", "", "", "", "", "", "", ""],
            ["", "", "", "", "UDAs Achieved", "", "", "0"],
            ["", "", "", "", "UDA Rate", "", "", f"£{config['uda_rate']}"],
            ["", "", "", "", "NHS Income", "", "", "£0.00"],
            ["", "", "", "", "", "", "", ""],
        ])
        current_row += 7
    
    # Private Fees Section
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "PRIVATE FEES", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "Gross Private (Dentist)", "", "", "£0.00"],
        ["", "", "", "", "Gross Private (Therapist)", "", "", "£0.00"],
        ["", "", "", "", "Gross Total", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
        ["", "Subtotal", "", "", split_pct, "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Deductions Section
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "DEDUCTIONS", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "Lab Bills 50%", "", "", "£0.00"],
        ["", "", "", "", "Finance Fees 50%", "", "", "£0.00"],
        ["", "", "", "", "Therapy", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
        ["", "Total Deductions", "", "", "", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Total Payment
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "TOTAL PAYMENT", "", "", "", "", "", "£0.00"],
        ["", "", "", "", "", "", "", ""],
    ])
    
    # Patient Breakdown Section
    rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "PATIENT BREAKDOWN", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "Patient Name", "Date", "Status", "Amount", "", "", ""],
    ])
    
    # Empty rows for patients (will be filled by generator)
    for _ in range(30):
        rows.append(["", "", "", "", "", "", "", ""])
    
    # Discrepancies Section
    rows.extend([
        ["", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "DISCREPANCIES TO REVIEW", "", "", "", "", "", "", ""],
        ["", "Enter correct £ in yellow column, then tick checkbox", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
    ])
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Apply formatting
    sheet_id = sh.id
    requests = [
        # Black header
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 3, 'startColumnIndex': 0, 'endColumnIndex': 8},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['black']}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        },
        # PAYSLIP title - white
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 4},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 24}
                }},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Section headers - gold underline
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 9, 'endRowIndex': 10, 'startColumnIndex': 1, 'endColumnIndex': 5},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'bold': True, 'fontSize': 12},
                    'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['gold']}}
                }},
                'fields': 'userEnteredFormat'
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
    
    spreadsheet.batch_update({'requests': requests})
    print(f"   ✅ {tab_name}")


def setup_finance_flags(spreadsheet):
    """Setup Finance Flags with dropdown for term months"""
    print("   Setting up Finance Flags...")
    
    try:
        sh = spreadsheet.worksheet("Finance Flags")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(title="Finance Flags", rows=200, cols=12)
    
    rows = [
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["", "FINANCE PAYMENTS", "", "", "", "", "", "", "", "", ""],
        ["", "Select term length to calculate fee", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["", "Patient", "Dentist", "Amount", "Date", "Term (months)", "Rate", "Fee", "Status", "", ""],
    ]
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Formatting
    sheet_id = sh.id
    requests = [
        # Black header
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 2, 'startColumnIndex': 0, 'endColumnIndex': 11},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['black']}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        },
        # Title white
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 5},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 16}
                }},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Column headers - beige
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
                'cell': {'userEnteredFormat': {
                    'backgroundColor': COLORS['beige'],
                    'textFormat': {'bold': True},
                    'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['gold']}}
                }},
                'fields': 'userEnteredFormat'
            }
        },
        # Dropdown validation for Term column (F6:F200)
        {
            'setDataValidation': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 5, 'endRowIndex': 200, 'startColumnIndex': 5, 'endColumnIndex': 6},
                'rule': {
                    'condition': {
                        'type': 'ONE_OF_LIST',
                        'values': [
                            {'userEnteredValue': '3'},
                            {'userEnteredValue': '12'},
                            {'userEnteredValue': '36'},
                            {'userEnteredValue': '60'}
                        ]
                    },
                    'showCustomUi': True,
                    'strict': True
                }
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
    
    spreadsheet.batch_update({'requests': requests})
    print("   ✅ Finance Flags ready (with dropdown)")


def setup_cross_reference(spreadsheet):
    """Setup Cross-Reference tab"""
    print("   Setting up Cross-Reference...")
    
    try:
        sh = spreadsheet.worksheet("Cross-Reference")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(title="Cross-Reference", rows=500, cols=12)
    
    rows = [
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["", "CROSS-REFERENCE REPORT", "", "", "", "", "", "", "", "", ""],
        ["", "Dentally vs Dentist Logs comparison", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["", "Dentist", "Dentally Total", "Log Total", "Difference", "Status", "Matched", "Mismatched", "Log Only", "Dentally Only", ""],
    ]
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Formatting
    sheet_id = sh.id
    requests = [
        # Black header
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 2, 'startColumnIndex': 0, 'endColumnIndex': 11},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['black']}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        },
        # Title
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 16}
                }},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Column headers
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 11},
                'cell': {'userEnteredFormat': {
                    'backgroundColor': COLORS['beige'],
                    'textFormat': {'bold': True},
                    'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['gold']}}
                }},
                'fields': 'userEnteredFormat'
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
    
    spreadsheet.batch_update({'requests': requests})
    print("   ✅ Cross-Reference ready")


def setup_duplicate_check(spreadsheet):
    """Setup Duplicate Check tab"""
    print("   Setting up Duplicate Check...")
    
    try:
        sh = spreadsheet.worksheet("Duplicate Check")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(title="Duplicate Check", rows=200, cols=12)
    
    rows = [
        ["", "", "", "", "", "", "", "", "", ""],
        ["", "DUPLICATE CHECK", "", "", "", "", "", "", "", ""],
        ["", "Checks against historical payslips", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", ""],
        ["", "Patient", "Dentist", "Current £", "Date", "Previous £", "Period", "Match Type", "Status", ""],
    ]
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Formatting
    sheet_id = sh.id
    requests = [
        # Black header
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 2, 'startColumnIndex': 0, 'endColumnIndex': 10},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['black']}},
                'fields': 'userEnteredFormat.backgroundColor'
            }
        },
        # Title
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 5},
                'cell': {'userEnteredFormat': {
                    'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 16}
                }},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        # Column headers
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
                'cell': {'userEnteredFormat': {
                    'backgroundColor': COLORS['beige'],
                    'textFormat': {'bold': True},
                    'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['gold']}}
                }},
                'fields': 'userEnteredFormat'
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
    
    spreadsheet.batch_update({'requests': requests})
    print("   ✅ Duplicate Check ready")


def setup_paid_invoices(spreadsheet):
    """Setup Paid Invoices log"""
    print("   Setting up Paid Invoices...")
    
    try:
        sh = spreadsheet.worksheet("Paid Invoices")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(title="Paid Invoices", rows=5000, cols=10)
    
    rows = [
        ["Invoice ID", "Patient", "Dentist", "Amount", "Date", "Period", "Added On", "Treatment", "", ""],
    ]
    
    sh.update(values=rows, range_name='A1')
    sh.format('A1:H1', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.96, 'green': 0.93, 'blue': 0.88}})
    print("   ✅ Paid Invoices ready")


def setup_config(spreadsheet):
    """Setup Config tab"""
    print("   Setting up Config...")
    
    try:
        sh = spreadsheet.worksheet("Config")
        sh.clear()
    except:
        sh = spreadsheet.add_worksheet(title="Config", rows=50, cols=6)
    
    rows = [
        ["Configuration", "", "", "", "", ""],
        ["", "", "", "", "", ""],
        ["Dentist", "Split %", "UDA Rate", "Has NHS", "Practitioner ID", ""],
    ]
    
    for name, config in DENTISTS.items():
        rows.append([
            name,
            config["split"],
            f"£{config['uda_rate']}" if config['uda_rate'] else "-",
            "Yes" if config["has_nhs"] else "No",
            "",
            ""
        ])
    
    sh.update(values=rows, range_name='A1')
    sh.format('A1', {'textFormat': {'bold': True, 'fontSize': 14}})
    sh.format('A3:E3', {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.96, 'green': 0.93, 'blue': 0.88}})
    print("   ✅ Config ready")


def delete_discrepancies_tab(spreadsheet):
    """Delete the standalone Discrepancies tab if it exists"""
    print("   Removing standalone Discrepancies tab...")
    try:
        sh = spreadsheet.worksheet("Discrepancies")
        spreadsheet.del_worksheet(sh)
        print("   ✅ Discrepancies tab removed")
    except:
        print("   ℹ️ No Discrepancies tab found")


def run_setup():
    """Run full sheet setup with Aura branding"""
    print("=" * 50)
    print("🦷 AURA DENTAL - SHEET SETUP")
    print("=" * 50)
    
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("❌ No credentials found")
        return
    
    client = get_client()
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    
    print("\n📋 Setting up tabs with Aura branding...")
    
    # Delete old Discrepancies tab
    delete_discrepancies_tab(spreadsheet)
    time.sleep(1)
    
    # Setup main tabs
    setup_dashboard(spreadsheet)
    time.sleep(2)
    
    setup_cross_reference(spreadsheet)
    time.sleep(1)
    
    setup_finance_flags(spreadsheet)
    time.sleep(1)
    
    setup_duplicate_check(spreadsheet)
    time.sleep(1)
    
    setup_paid_invoices(spreadsheet)
    time.sleep(1)
    
    setup_config(spreadsheet)
    time.sleep(1)
    
    # Setup individual payslips
    print("\n📋 Setting up individual payslips...")
    for name, config in DENTISTS.items():
        setup_dentist_payslip(spreadsheet, name, config)
        time.sleep(2)
    
    print("\n" + "=" * 50)
    print("✅ SETUP COMPLETE")
    print("=" * 50)
    print(f"\n🔗 View: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")
    print("\n📝 Remember to share the logo file with the service account!")


if __name__ == "__main__":
    run_setup()
