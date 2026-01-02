#!/usr/bin/env python3
"""
Aura Dental Clinic - Professional Google Sheet Setup
Corporate-level design with brand colors and clean UX
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

# =============================================================================
# DESIGN SYSTEM - Aura Brand Colors (Black & White)
# =============================================================================

COLORS = {
    # Primary palette (black and white)
    'primary': {'red': 0.1, 'green': 0.1, 'blue': 0.1},           # Near black
    'primary_light': {'red': 0.3, 'green': 0.3, 'blue': 0.3},     # Dark gray
    'primary_lighter': {'red': 0.93, 'green': 0.93, 'blue': 0.93}, # Light gray
    
    # Accent colors (subtle gray)
    'accent': {'red': 0.4, 'green': 0.4, 'blue': 0.4},
    'accent_light': {'red': 0.95, 'green': 0.95, 'blue': 0.95},
    
    # Neutrals
    'white': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
    'off_white': {'red': 0.98, 'green': 0.98, 'blue': 0.98},
    'light_gray': {'red': 0.95, 'green': 0.95, 'blue': 0.95},
    'medium_gray': {'red': 0.85, 'green': 0.85, 'blue': 0.85},
    'dark_gray': {'red': 0.3, 'green': 0.3, 'blue': 0.3},
    
    # Status colors (muted)
    'success': {'red': 0.9, 'green': 0.95, 'blue': 0.9},
    'success_text': {'red': 0.2, 'green': 0.5, 'blue': 0.2},
    'warning': {'red': 1.0, 'green': 0.95, 'blue': 0.85},
    'warning_text': {'red': 0.6, 'green': 0.4, 'blue': 0.0},
    'error': {'red': 1.0, 'green': 0.92, 'blue': 0.92},
    'error_text': {'red': 0.7, 'green': 0.2, 'blue': 0.2},
    'info': {'red': 0.93, 'green': 0.95, 'blue': 0.98},
    'info_text': {'red': 0.2, 'green': 0.3, 'blue': 0.5},
}

DENTISTS = {
    "Zeeshan Abbas": {"split": "45%", "uda_rate": None, "has_nhs": False, "display": "Dr Zeeshan Abbas"},
    "Peter Throw": {"split": "50%", "uda_rate": 16, "has_nhs": True, "display": "Dr Peter Throw"},
    "Priyanka Kapoor": {"split": "50%", "uda_rate": 15, "has_nhs": True, "display": "Dr Priyanka Kapoor"},
    "Moneeb Ahmad": {"split": "50%", "uda_rate": 15, "has_nhs": True, "display": "Dr Moneeb Ahmad"},
    "Hani Dalati": {"split": "50%", "uda_rate": None, "has_nhs": False, "display": "Dr Hani Dalati"},
    "Ankush Patel": {"split": "50%", "uda_rate": None, "has_nhs": False, "display": "Dr Ankush Patel"},
    "Hisham Saqib": {"split": "50%", "uda_rate": None, "has_nhs": False, "display": "Dr Hisham Saqib"},
}

LOGO_URL = "https://drive.google.com/uc?export=view&id=1Z4d-u7P8XzOOm3IKyssYrRD0o_jZ5fjd"


def get_client():
    """Get authenticated Google Sheets client"""
    creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
    creds = Credentials.from_service_account_info(creds_dict, scopes=[
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ])
    return gspread.authorize(creds)


def apply_base_formatting(spreadsheet, sheet):
    """Apply professional base formatting to a sheet"""
    sheet_id = sheet.id
    
    # First clear ALL existing formatting
    clear_requests = [
        {
            'updateCells': {
                'range': {'sheetId': sheet_id},
                'fields': 'userEnteredFormat'
            }
        }
    ]
    
    try:
        spreadsheet.batch_update({'requests': clear_requests})
    except:
        pass
    
    # Now apply base formatting
    requests = [
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id},
                'cell': {'userEnteredFormat': {'textFormat': {'fontFamily': 'Arial', 'fontSize': 11}}},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        {
            'updateSheetProperties': {
                'properties': {'sheetId': sheet_id, 'gridProperties': {'hideGridlines': True}},
                'fields': 'gridProperties.hideGridlines'
            }
        }
    ]
    
    try:
        spreadsheet.batch_update({'requests': requests})
    except:
        pass


def setup_dashboard(spreadsheet):
    """Create professional executive Dashboard"""
    print("Creating Dashboard...")
    
    # Delete and recreate to clear all formatting
    try:
        old_sheet = spreadsheet.worksheet("Dashboard")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Dashboard", 50, 16)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [
        [""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "AURA DENTAL CLINIC", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Payroll Dashboard", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        [""],
        ["", "Pay Period", "", "December 2025", "", "", "Generated", "", "02/01/2026", "", "", "", "", "", ""],
        [""], [""],
        ["", "KEY METRICS", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        [""],
        ["", "£0.00", "", "", "£0.00", "", "", "0", "", "", "0", "", "", "", ""],
        ["", "Total Payout", "", "", "Gross Revenue", "", "", "Invoices", "", "", "Finance Cases", "", "", "", ""],
        [""], [""],
        ["", "DENTIST SUMMARY", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        [""],
        ["", "Dentist", "", "Gross Private", "", "Split", "", "Net Pay", "", "Deductions", "", "Total Payment", "", "", ""],
    ]
    
    for name in DENTISTS.keys():
        data.append(["", name, "", "£0.00", "", DENTISTS[name]['split'], "", "£0.00", "", "£0.00", "", "£0.00", "", "", ""])
    
    data.extend([[""], ["", "TOTAL", "", "", "", "", "", "", "", "", "", "£0.00", "", "", ""]])
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 5, 'startColumnIndex': 0, 'endColumnIndex': 16},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 2, 'endRowIndex': 3, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 22}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 3, 'endRowIndex': 4, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'fontSize': 14}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 8, 'endRowIndex': 9, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 14, 'foregroundColor': COLORS['primary']}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 10, 'endRowIndex': 11, 'startColumnIndex': 1, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 24}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 11, 'endRowIndex': 12, 'startColumnIndex': 1, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {'textFormat': {'fontSize': 10, 'foregroundColor': COLORS['dark_gray']}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 14, 'endRowIndex': 15, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 14, 'foregroundColor': COLORS['primary']}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 16, 'endRowIndex': 17, 'startColumnIndex': 1, 'endColumnIndex': 13},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['primary']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    
    for i in range(len(DENTISTS)):
        if i % 2 == 0:
            requests.append({'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 17 + i, 'endRowIndex': 18 + i, 'startColumnIndex': 1, 'endColumnIndex': 13},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['off_white']}}, 'fields': 'userEnteredFormat.backgroundColor'}})
    
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=7)
    print("   ✅ Dashboard created")


def setup_dentist_payslip(spreadsheet, name, config):
    """Create professional individual dentist payslip"""
    first_name = name.split()[0]
    tab_name = f"{first_name} Payslip"
    print(f"Creating {tab_name}...")
    
    # Delete and recreate to clear all formatting
    try:
        old_sheet = spreadsheet.worksheet(tab_name)
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet(tab_name, 150, 7)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [
        ["", "", "", "", "", f'=IMAGE("{LOGO_URL}", 2)', ""],
        ["", "PAYSLIP", "", "", "", "", ""],
        [""],
        ["", "Payslip Date:", "15th January 2026", "", "", "", ""],
        ["", "Private Period:", "December 2025", "", "", "", ""],
        ["", "Performer:", config['display'], "", "", "", ""],
        ["", "Practice:", "Aura Dental Clinic", "", "", "", ""],
        [""],
        ["", "PRIVATE FEES", "", "", "", "", ""],
        [""],
        ["", "Gross Private (Dentist)", "", "", "£0.00", "", ""],
        ["", "Gross Private (Therapist)", "", "", "£0.00", "", ""],
        ["", "Gross Total", "", "", "£0.00", "", ""],
        [""],
        ["", "SUBTOTAL", config['split'], "", "£0.00", "", ""],
        [""],
        ["", "DEDUCTIONS", "", "", "", "", ""],
        [""],
        ["", "Lab Bills 50%", "", "", "£0.00", "", ""],
        ["", "Finance Fees 50%", "", "", "£0.00", "", ""],
        ["", "Therapy", "", "", "£0.00", "", ""],
        [""],
        ["", "TOTAL DEDUCTIONS", "", "", "£0.00", "", ""],
        [""],
        ["", "TOTAL PAYMENT", "", "", "£0.00", "", ""],
        [""], [""],
        ["", "PATIENT BREAKDOWN", "", "", "", "", ""],
        [""],
        ["", "Patient Name", "Date", "Status", "Amount", "", ""],
    ]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        # Column widths
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 20}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 200}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 150}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 4}, 'properties': {'pixelSize': 80}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 4, 'endIndex': 5}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 5, 'endIndex': 6}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 6, 'endIndex': 7}, 'properties': {'pixelSize': 20}, 'fields': 'pixelSize'}},
        # Row height for logo
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 60}, 'fields': 'pixelSize'}},
        # Header - black
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 3, 'startColumnIndex': 0, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 4},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 22, 'fontFamily': 'Arial'}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 3, 'endRowIndex': 7, 'startColumnIndex': 1, 'endColumnIndex': 2},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontFamily': 'Arial'}}}, 'fields': 'userEnteredFormat.textFormat'}},
        # Section headers
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 8, 'endRowIndex': 9, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 16, 'endRowIndex': 17, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'}},
        # Total payment highlight
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 24, 'endRowIndex': 25, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['light_gray'], 'textFormat': {'bold': True, 'fontSize': 14},
                'borders': {'top': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}, 'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        # Patient breakdown header
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 27, 'endRowIndex': 28, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 29, 'endRowIndex': 30, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['light_gray'], 'textFormat': {'bold': True},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['medium_gray']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    
    spreadsheet.batch_update({'requests': requests})
    print(f"   ✅ {tab_name} created")


def setup_finance_flags(spreadsheet):
    """Create professional Finance Flags tab"""
    print("Creating Finance Flags...")
    
    try:
        old_sheet = spreadsheet.worksheet("Finance Flags")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Finance Flags", 100, 12)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [[""], ["", "FINANCE PAYMENTS", "", "", "", "", "", "", "", "", "", ""],
        ["", "Enter term length to calculate subsidy", "", "", "", "", "", "", "", "", "", ""], [""],
        ["", "Patient", "Dentist", "Amount", "Date", "Term", "Subsidy %", "Fee", "Status", "", "", ""]]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 12},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 18}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['primary']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Finance Flags created")


def setup_discrepancies(spreadsheet):
    """Create professional Discrepancies tab"""
    print("Creating Discrepancies...")
    
    try:
        old_sheet = spreadsheet.worksheet("Discrepancies")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Discrepancies", 200, 12)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [[""], ["", "DISCREPANCIES", "", "", "", "", "", "", "", "", "", ""],
        ["", "Items requiring review and action", "", "", "", "", "", "", "", "", "", ""], [""],
        ["", "Dentist", "Patient", "Dentally £", "Log £", "Difference", "Issue", "Action", "Status", "", "", ""]]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 12},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['warning']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['warning_text'], 'bold': True, 'fontSize': 18}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['accent_light'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['warning_text']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['accent']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Discrepancies created")


def setup_cross_reference(spreadsheet):
    """Create professional Cross-Reference tab"""
    print("Creating Cross-Reference...")
    
    try:
        old_sheet = spreadsheet.worksheet("Cross-Reference")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Cross-Reference", 500, 14)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [[""], ["", "CROSS-REFERENCE", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Dentally vs Dentist Takings Logs", "", "", "", "", "", "", "", "", "", "", "", ""], [""],
        ["", "Dentist", "Dentally Total", "Log Total", "Difference", "Matched", "Mismatched", "Dentally Only", "Log Only", "Flags", "", "", "", ""]]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['info']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['info_text'], 'bold': True, 'fontSize': 18}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 11},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['primary']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Cross-Reference created")


def setup_duplicate_check(spreadsheet):
    """Create professional Duplicate Check tab"""
    print("Creating Duplicate Check...")
    
    try:
        old_sheet = spreadsheet.worksheet("Duplicate Check")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Duplicate Check", 200, 12)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [[""], ["", "DUPLICATE CHECK", "", "", "", "", "", "", "", "", "", ""],
        ["", "Comparing against historical payslips", "", "", "", "", "", "", "", "", "", ""], [""],
        ["", "Patient", "Dentist", "Current £", "Current Date", "Previous £", "Previous Period", "Match Type", "Status", "", "", ""]]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 12},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['error']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['error_text'], 'bold': True, 'fontSize': 18}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['error'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['error_text']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['error_text']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Duplicate Check created")


def setup_paid_invoices(spreadsheet):
    """Create professional Paid Invoices log tab"""
    print("Creating Paid Invoices...")
    
    try:
        old_sheet = spreadsheet.worksheet("Paid Invoices")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Paid Invoices", 5000, 10)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [[""], ["", "PAID INVOICES LOG", "", "", "", "", "", "", "", ""],
        ["", "Running record for duplicate detection", "", "", "", "", "", "", "", ""], [""],
        ["", "Invoice ID", "Patient", "Dentist", "Amount", "Date", "Period", "Added On", "Treatment", ""]]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['success']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['success_text'], 'bold': True, 'fontSize': 18}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['success'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['success_text']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['success_text']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Paid Invoices created")


def setup_config(spreadsheet):
    """Create professional Config tab"""
    print("Creating Config...")
    
    try:
        old_sheet = spreadsheet.worksheet("Config")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Config", 50, 8)
    
    apply_base_formatting(spreadsheet, sh)
    
    data = [[""], ["", "CONFIGURATION", "", "", "", "", "", ""],
        ["", "System settings and dentist rates", "", "", "", "", "", ""], [""],
        ["", "TABEO SUBSIDY RATES", "", "", "", "", "", ""],
        ["", "Term", "Subsidy %", "", "", "", "", ""],
        ["", "3 months", "4.5%", "", "", "", "", ""],
        ["", "12 months", "8.0%", "", "", "", "", ""],
        ["", "36 months", "3.4%", "", "", "", "", ""],
        ["", "60 months", "3.7%", "", "", "", "", ""], [""],
        ["", "DENTIST CONFIGURATION", "", "", "", "", "", ""],
        ["", "Dentist", "Split", "UDA Rate", "NHS?", "", "", ""]]
    
    for name, config in DENTISTS.items():
        uda_rate = f"£{config['uda_rate']}" if config['uda_rate'] else "-"
        has_nhs = "Yes" if config['has_nhs'] else "No"
        data.append(["", name, config['split'], uda_rate, has_nhs, "", "", ""])
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 8},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 18}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 4},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'foregroundColor': COLORS['primary']}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 11, 'endRowIndex': 12, 'startColumnIndex': 1, 'endColumnIndex': 4},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'foregroundColor': COLORS['primary']}}}, 'fields': 'userEnteredFormat.textFormat'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    print("   ✅ Config created")


def main():
    """Main setup function"""
    print("=" * 60)
    print("🦷 AURA DENTAL - PROFESSIONAL SHEET SETUP")
    print("=" * 60)
    
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("❌ No credentials found")
        return
    
    client = get_client()
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    
    print(f"\n📊 Setting up: {spreadsheet.title}")
    
    setup_dashboard(spreadsheet)
    time.sleep(1)
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
    
    print("\n📋 Creating dentist payslips...")
    for name, config in DENTISTS.items():
        setup_dentist_payslip(spreadsheet, name, config)
        time.sleep(2)
    
    print("\n" + "=" * 60)
    print("✅ PROFESSIONAL SETUP COMPLETE!")
    print("=" * 60)
    print(f"\n🔗 https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")


if __name__ == "__main__":
    main()
