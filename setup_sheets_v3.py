#!/usr/bin/env python3
"""
Aura Dental Clinic - Professional Google Sheet Setup v3.0
Corporate-level design with consistent formatting and improved payslip layout

Fixes:
- Dashboard font sizes now consistent
- Payslip design matches existing Zee Payslip template
- Column widths optimized for readability
- Logo 1:1 aspect ratio
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
    
    # Section backgrounds
    'section_bg': {'red': 0.96, 'green': 0.96, 'blue': 0.96},      # Very light gray for sections
    'highlight_bg': {'red': 0.85, 'green': 0.95, 'blue': 0.85},    # Light green for totals
    
    # Neutrals
    'white': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
    'off_white': {'red': 0.98, 'green': 0.98, 'blue': 0.98},
    'light_gray': {'red': 0.95, 'green': 0.95, 'blue': 0.95},
    'medium_gray': {'red': 0.85, 'green': 0.85, 'blue': 0.85},
    'dark_gray': {'red': 0.3, 'green': 0.3, 'blue': 0.3},
    'border_gray': {'red': 0.75, 'green': 0.75, 'blue': 0.75},
    
    # Status colors (muted)
    'success': {'red': 0.85, 'green': 0.95, 'blue': 0.85},
    'success_text': {'red': 0.2, 'green': 0.5, 'blue': 0.2},
    'success_dark': {'red': 0.13, 'green': 0.55, 'blue': 0.13},
    'warning': {'red': 1.0, 'green': 0.95, 'blue': 0.85},
    'warning_text': {'red': 0.6, 'green': 0.4, 'blue': 0.0},
    'error': {'red': 1.0, 'green': 0.92, 'blue': 0.92},
    'error_text': {'red': 0.7, 'green': 0.2, 'blue': 0.2},
    'info': {'red': 0.93, 'green': 0.95, 'blue': 0.98},
    'info_text': {'red': 0.2, 'green': 0.3, 'blue': 0.5},
}

DENTISTS = {
    "Zeeshan Abbas": {"split": "45%", "split_decimal": 0.45, "uda_rate": None, "has_nhs": False, "display": "Dr Zeeshan Abbas"},
    "Peter Throw": {"split": "50%", "split_decimal": 0.50, "uda_rate": 16, "has_nhs": True, "display": "Dr Peter Throw"},
    "Priyanka Kapoor": {"split": "50%", "split_decimal": 0.50, "uda_rate": 15, "has_nhs": True, "display": "Dr Priyanka Kapoor"},
    "Moneeb Ahmad": {"split": "50%", "split_decimal": 0.50, "uda_rate": 15, "has_nhs": True, "display": "Dr Moneeb Ahmad"},
    "Hani Dalati": {"split": "50%", "split_decimal": 0.50, "uda_rate": None, "has_nhs": False, "display": "Dr Hani Dalati"},
    "Ankush Patel": {"split": "45%", "split_decimal": 0.45, "uda_rate": None, "has_nhs": False, "display": "Dr Ankush Patel"},
    "Hisham Saqib": {"split": "50%", "split_decimal": 0.50, "uda_rate": None, "has_nhs": False, "display": "Dr Hisham Saqib"},
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
    
    # Clear existing formatting
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
    
    # Apply base formatting - CONSISTENT 10pt font
    requests = [
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id},
                'cell': {'userEnteredFormat': {'textFormat': {'fontFamily': 'Arial', 'fontSize': 10}}},
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
    """Create professional executive Dashboard with CONSISTENT font sizing"""
    print("Creating Dashboard...")
    
    # Delete and recreate to clear all formatting
    try:
        old_sheet = spreadsheet.worksheet("Dashboard")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Dashboard", 50, 14)
    
    apply_base_formatting(spreadsheet, sh)
    
    # Dashboard data - clean layout
    data = [
        [""],  # Row 1 - spacer
        ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],  # Row 2 - header band
        ["", "AURA DENTAL CLINIC", "", "", "", "", "", "", "", "", "", "", "", ""],  # Row 3
        ["", "Payroll Dashboard", "", "", "", "", "", "", "", "", "", "", "", ""],  # Row 4
        [""],  # Row 5 - spacer
        ["", "Pay Period", "", "December 2025", "", "", "", "Generated", "", "02/01/2026", "", "", "", ""],  # Row 6
        [""],  # Row 7 - spacer
        # Row 8 - DENTIST SUMMARY header
        ["", "DENTIST SUMMARY", "", "", "", "", "", "", "", "", "", "", "", ""],
        # Row 9 - Column headers
        ["", "Dentist", "UDAs", "UDA Rate", "NHS Income", "Gross Private", "Split", "Net Pay", "Lab Bills", "Finance Fees", "Therapy", "Deductions", "Total Payment", "Status"],
    ]
    
    # Add dentist rows
    for name in DENTISTS.keys():
        data.append(["", name, "-", "-", "-", "£0.00", DENTISTS[name]['split'], "£0.00", "£0.00", "£0.00", "£0.00", "£0.00", "£0.00", "⏳"])
    
    # Totals row
    data.append([""])
    data.append(["", "TOTAL", "", "", "£0.00", "£0.00", "", "£0.00", "", "", "", "£0.00", "£0.00", ""])
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        # Column widths - ALL columns defined
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 15}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 130}, 'fields': 'pixelSize'}},  # Dentist
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 55}, 'fields': 'pixelSize'}},   # UDAs
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 4}, 'properties': {'pixelSize': 70}, 'fields': 'pixelSize'}},   # UDA Rate
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 4, 'endIndex': 5}, 'properties': {'pixelSize': 90}, 'fields': 'pixelSize'}},   # NHS Income
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 5, 'endIndex': 6}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},  # Gross Private
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 6, 'endIndex': 7}, 'properties': {'pixelSize': 50}, 'fields': 'pixelSize'}},   # Split
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 7, 'endIndex': 8}, 'properties': {'pixelSize': 90}, 'fields': 'pixelSize'}},   # Net Pay
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 8, 'endIndex': 9}, 'properties': {'pixelSize': 80}, 'fields': 'pixelSize'}},   # Lab Bills
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 9, 'endIndex': 10}, 'properties': {'pixelSize': 90}, 'fields': 'pixelSize'}},  # Finance Fees
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 10, 'endIndex': 11}, 'properties': {'pixelSize': 70}, 'fields': 'pixelSize'}}, # Therapy
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 11, 'endIndex': 12}, 'properties': {'pixelSize': 90}, 'fields': 'pixelSize'}}, # Deductions
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 12, 'endIndex': 13}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},# Total Payment
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 13, 'endIndex': 14}, 'properties': {'pixelSize': 55}, 'fields': 'pixelSize'}}, # Status
        
        # Header band - BLACK background (rows 2-4)
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 5, 'startColumnIndex': 0, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        
        # Title - White, 16pt, bold
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 2, 'endRowIndex': 3, 'startColumnIndex': 1, 'endColumnIndex': 8},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 16}}}, 'fields': 'userEnteredFormat.textFormat'}},
        
        # Subtitle - White, 11pt
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 3, 'endRowIndex': 4, 'startColumnIndex': 1, 'endColumnIndex': 8},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'fontSize': 11}}}, 'fields': 'userEnteredFormat.textFormat'}},
        
        # Pay Period labels - 10pt, bold
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 5, 'endRowIndex': 6, 'startColumnIndex': 1, 'endColumnIndex': 2},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 10}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 5, 'endRowIndex': 6, 'startColumnIndex': 7, 'endColumnIndex': 8},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 10}}}, 'fields': 'userEnteredFormat.textFormat'}},
        
        # DENTIST SUMMARY section header - 12pt, bold
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 7, 'endRowIndex': 8, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 12, 'foregroundColor': COLORS['primary']}}}, 'fields': 'userEnteredFormat.textFormat'}},
        
        # Column headers row (row 9) - gray bg, 10pt, bold, border
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 8, 'endRowIndex': 9, 'startColumnIndex': 1, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {
                'backgroundColor': COLORS['primary_lighter'],
                'textFormat': {'bold': True, 'fontSize': 10, 'foregroundColor': COLORS['primary']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}}
            }}, 'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Data rows - 10pt (all dentists + total)
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 9, 'endRowIndex': 9 + len(DENTISTS) + 2, 'startColumnIndex': 1, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {'textFormat': {'fontSize': 10}}}, 'fields': 'userEnteredFormat.textFormat'}},
        
        # Total row - bold
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 10 + len(DENTISTS), 'endRowIndex': 11 + len(DENTISTS), 'startColumnIndex': 1, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 10}}}, 'fields': 'userEnteredFormat.textFormat'}},
    ]
    
    # Alternating row colors for dentist rows
    for i in range(len(DENTISTS)):
        if i % 2 == 0:
            requests.append({'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 9 + i, 'endRowIndex': 10 + i, 'startColumnIndex': 1, 'endColumnIndex': 14},
                'cell': {'userEnteredFormat': {'backgroundColor': COLORS['off_white']}}, 'fields': 'userEnteredFormat.backgroundColor'}})
    
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=9)
    print("   ✅ Dashboard created")


def setup_dentist_payslip(spreadsheet, name, config):
    """
    Create professional individual dentist payslip matching the Zee Payslip template design
    
    Layout:
    - Header with logo (1:1 ratio)
    - Info section (Payslip Date, Private Period, Performer, Practice, Superannuation Status)
    - Section 1: Private Fees
    - Section 2: Deductions (Labs breakdown)
    - Total Deductions, Total Payment
    - Patient Breakdown
    - Discrepancies section (for manager to review/add)
    """
    first_name = name.split()[0]
    tab_name = f"{first_name} Payslip"
    print(f"Creating {tab_name}...")
    
    # Delete and recreate
    try:
        old_sheet = spreadsheet.worksheet(tab_name)
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    # 8 columns: A=spacer, B-G=content, H=spacer
    sh = spreadsheet.add_worksheet(tab_name, 200, 8)
    
    apply_base_formatting(spreadsheet, sh)
    
    # Data matching Zee Payslip template style
    data = [
        # Row 1: Logo (will span F1:G2)
        ["", "", "", "", "", "", f'=IMAGE("{LOGO_URL}", 4, 80, 80)', ""],
        # Row 2: Payslip Date
        ["", "Payslip Date:", "15th January 2026", "", "", "", "", ""],
        # Row 3: Private Period
        ["", "Private Period:", "December 2025", "", "", "", "", ""],
        # Row 4: Performer
        ["", "Performer:", config['display'], "", "", "", "", ""],
        # Row 5: Practice
        ["", "Practice:", "Aura Dental Clinic", "", "", "", "", ""],
        # Row 6: Superannuation Status
        ["", "Superannuation Status:", "Opted Out", "", "", "", "", ""],
        # Row 7: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 8: Section 1 - Private Fees header
        ["", "Section 1: Private Fees", "", "", "", "", "", ""],
        # Row 9: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 10: Gross Private by Dentist
        ["", "", "", "", "Gross Private by Dentist", "", "£0.00", ""],
        # Row 11: Gross Private by Therapist
        ["", "", "", "", "Gross Private by Therapist", "", "", ""],
        # Row 12: Gross Total
        ["", "", "", "", "Gross Total", "", "£0.00", ""],
        # Row 13: Subtotal (with split %)
        ["", "Subtotal", "", "", config['split'], "", "£0.00", ""],
        # Row 14: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 15: Section 2 - Deductions header
        ["", "Section 2: Deductions", "", "", "", "", "", ""],
        # Row 16: Empty
        ["", "", "", "", "", "Halo", "", ""],
        # Row 17-20: Labs
        ["", "", "", "", "", "Straumann", "", ""],
        ["", "", "", "Labs", "", "Invisalign", "", ""],
        ["", "", "", "", "", "Priory", "", ""],
        ["", "", "", "", "", "Scan Digital", "", ""],
        # Row 21: Lab Bills Total
        ["", "", "", "", "", "Lab Bills Total", "", ""],
        # Row 22: Lab Bills 50%
        ["", "", "", "", "", "Lab Bills 50%", "", ""],
        # Row 23: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 24: Finance Fees
        ["", "", "", "Finance Fees", "", "", "", ""],
        # Row 25: Finance 50%
        ["", "", "", "50%", "", "", "", ""],
        # Row 26: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 27: Therapy
        ["", "", "", "Therapy", "Taryn", "", "", ""],
        # Row 28: Total Deductions
        ["", "Total Deductions", "", "", "", "", "£0.00", ""],
        # Row 29: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 30: Total Payment
        ["", "Total Payment", "", "", "", "", "£0.00", ""],
        # Row 31: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 32: Patient Breakdown header
        ["", "Patient Breakdown", "", "", "", "", "Paid", ""],
        # Row 33: Empty
        ["", "", "", "", "", "", "", ""],
        # Row 34: Patient column headers
        ["", "Patient Name", "Completion Date", "Treatment", "Lab Bills", "Finance Fee", "Amount", ""],
    ]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    
    # Column widths for readability
    requests = [
        # Column A - left spacer (narrow)
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 30}, 'fields': 'pixelSize'}},
        # Column B - Main content/Patient Name
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 180}, 'fields': 'pixelSize'}},
        # Column C - Date
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 110}, 'fields': 'pixelSize'}},
        # Column D - Treatment/Labels
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 4}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        # Column E - Description/Labels
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 4, 'endIndex': 5}, 'properties': {'pixelSize': 160}, 'fields': 'pixelSize'}},
        # Column F - Lab info
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 5, 'endIndex': 6}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        # Column G - Amounts
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 6, 'endIndex': 7}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        # Column H - right spacer
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 7, 'endIndex': 8}, 'properties': {'pixelSize': 30}, 'fields': 'pixelSize'}},
        
        # Row 1 height for logo - 80px for 1:1 ratio with 80px wide logo
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 80}, 'fields': 'pixelSize'}},
        
        # Info labels (B2-B6) - bold
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 6, 'startColumnIndex': 1, 'endColumnIndex': 2},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 10}}}, 'fields': 'userEnteredFormat.textFormat'}},
        
        # Section 1 header (row 8) - bold with border
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 7, 'endRowIndex': 8, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'textFormat': {'bold': True, 'fontSize': 10},
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': COLORS['border_gray']}}
            }}, 'fields': 'userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Subtotal row (row 13) - green highlight
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 12, 'endRowIndex': 13, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'backgroundColor': COLORS['success'],
                'textFormat': {'bold': True, 'foregroundColor': COLORS['success_dark']},
                'borders': {'top': {'style': 'SOLID', 'width': 1, 'color': COLORS['success_dark']}, 'bottom': {'style': 'SOLID', 'width': 1, 'color': COLORS['success_dark']}}
            }}, 'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Section 2 header (row 15) - bold with border
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 14, 'endRowIndex': 15, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'textFormat': {'bold': True, 'fontSize': 10},
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': COLORS['border_gray']}}
            }}, 'fields': 'userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Total Deductions row (row 28) - green highlight
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 27, 'endRowIndex': 28, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'backgroundColor': COLORS['success'],
                'textFormat': {'bold': True, 'foregroundColor': COLORS['success_dark']},
                'borders': {'top': {'style': 'SOLID', 'width': 1, 'color': COLORS['success_dark']}, 'bottom': {'style': 'SOLID', 'width': 1, 'color': COLORS['success_dark']}}
            }}, 'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Total Payment row (row 30) - green highlight, slightly larger
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 29, 'endRowIndex': 30, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'backgroundColor': COLORS['success'],
                'textFormat': {'bold': True, 'fontSize': 11, 'foregroundColor': COLORS['success_dark']},
                'borders': {'top': {'style': 'SOLID', 'width': 2, 'color': COLORS['success_dark']}, 'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['success_dark']}}
            }}, 'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Patient Breakdown header (row 32) - bold
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 31, 'endRowIndex': 32, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'textFormat': {'bold': True, 'fontSize': 10},
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': COLORS['border_gray']}}
            }}, 'fields': 'userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Patient column headers (row 34) - gray bg, bold
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 33, 'endRowIndex': 34, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'backgroundColor': COLORS['light_gray'],
                'textFormat': {'bold': True, 'fontSize': 10},
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': COLORS['medium_gray']}}
            }}, 'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Amount column (G) - currency format
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 9, 'endRowIndex': 100, 'startColumnIndex': 6, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
            'fields': 'userEnteredFormat.numberFormat'}},
    ]
    
    spreadsheet.batch_update({'requests': requests})
    print(f"   ✅ {tab_name} created")


def setup_cross_reference(spreadsheet):
    """Create Cross-Reference tab"""
    print("Creating Cross-Reference...")
    
    try:
        old_sheet = spreadsheet.worksheet("Cross-Reference")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Cross-Reference", 500, 14)
    apply_base_formatting(spreadsheet, sh)
    
    data = [
        [""],
        ["", "CROSS-REFERENCE", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Dentally vs Dentist Takings Logs", "", "", "", "", "", "", "", "", "", "", "", ""],
        [""],
        ["", "Dentist", "Dentally Total", "Log Total", "Difference", "Matched", "Mismatched", "Dentally Only", "Log Only", "Flags", "", "", "", ""]
    ]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        # Column widths
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 130}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 4}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 4, 'endIndex': 5}, 'properties': {'pixelSize': 90}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 5, 'endIndex': 10}, 'properties': {'pixelSize': 80}, 'fields': 'pixelSize'}},
        
        # Header styling
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 14},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['info']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['info_text'], 'bold': True, 'fontSize': 14}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 11},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['primary']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Cross-Reference created")


def setup_finance_flags(spreadsheet):
    """Create Finance Flags tab"""
    print("Creating Finance Flags...")
    
    try:
        old_sheet = spreadsheet.worksheet("Finance Flags")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Finance Flags", 100, 12)
    apply_base_formatting(spreadsheet, sh)
    
    data = [
        [""],
        ["", "FINANCE PAYMENTS", "", "", "", "", "", "", "", "", "", ""],
        ["", "Enter term length to calculate subsidy", "", "", "", "", "", "", "", "", "", ""],
        [""],
        ["", "Patient", "Dentist", "Amount", "Date", "Term", "Subsidy %", "Fee", "Status", "", "", ""]
    ]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        # Column widths
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 150}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 120}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 9}, 'properties': {'pixelSize': 80}, 'fields': 'pixelSize'}},
        
        # Header styling
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 12},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 14}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['primary_lighter'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['primary']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['primary']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Finance Flags created")


def setup_duplicate_check(spreadsheet):
    """Create Duplicate Check tab"""
    print("Creating Duplicate Check...")
    
    try:
        old_sheet = spreadsheet.worksheet("Duplicate Check")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Duplicate Check", 200, 12)
    apply_base_formatting(spreadsheet, sh)
    
    data = [
        [""],
        ["", "DUPLICATE CHECK", "", "", "", "", "", "", "", "", "", ""],
        ["", "Comparing against historical payslips", "", "", "", "", "", "", "", "", "", ""],
        [""],
        ["", "Patient", "Dentist", "Current £", "Current Date", "Previous £", "Previous Period", "Match Type", "Status", "", "", ""]
    ]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 150}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 9}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 12},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['error']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['error_text'], 'bold': True, 'fontSize': 14}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['error'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['error_text']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['error_text']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Duplicate Check created")


def setup_paid_invoices(spreadsheet):
    """Create Paid Invoices log tab"""
    print("Creating Paid Invoices...")
    
    try:
        old_sheet = spreadsheet.worksheet("Paid Invoices")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Paid Invoices", 5000, 10)
    apply_base_formatting(spreadsheet, sh)
    
    data = [
        [""],
        ["", "PAID INVOICES LOG", "", "", "", "", "", "", "", ""],
        ["", "Running record for duplicate detection", "", "", "", "", "", "", "", ""],
        [""],
        ["", "Invoice ID", "Patient", "Dentist", "Amount", "Date", "Period", "Added On", "Treatment", ""]
    ]
    
    sh.update(values=data, range_name='A1')
    
    sheet_id = sh.id
    requests = [
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 150}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 9}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 4, 'startColumnIndex': 0, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['success']}}, 'fields': 'userEnteredFormat.backgroundColor'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 2, 'startColumnIndex': 1, 'endColumnIndex': 6},
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['success_text'], 'bold': True, 'fontSize': 14}}}, 'fields': 'userEnteredFormat.textFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 4, 'endRowIndex': 5, 'startColumnIndex': 1, 'endColumnIndex': 10},
            'cell': {'userEnteredFormat': {'backgroundColor': COLORS['success'], 'textFormat': {'bold': True, 'foregroundColor': COLORS['success_text']},
                'borders': {'bottom': {'style': 'SOLID', 'width': 2, 'color': COLORS['success_text']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
    ]
    spreadsheet.batch_update({'requests': requests})
    sh.freeze(rows=5)
    print("   ✅ Paid Invoices created")


def setup_config(spreadsheet):
    """Create Config tab"""
    print("Creating Config...")
    
    try:
        old_sheet = spreadsheet.worksheet("Config")
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet("Config", 50, 8)
    apply_base_formatting(spreadsheet, sh)
    
    data = [
        [""],
        ["", "CONFIGURATION", "", "", "", "", "", ""],
        ["", "System settings and dentist rates", "", "", "", "", "", ""],
        [""],
        ["", "TABEO SUBSIDY RATES", "", "", "", "", "", ""],
        ["", "Term", "Subsidy %", "", "", "", "", ""],
        ["", "3 months", "4.5%", "", "", "", "", ""],
        ["", "12 months", "8.0%", "", "", "", "", ""],
        ["", "36 months", "3.4%", "", "", "", "", ""],
        ["", "60 months", "3.7%", "", "", "", "", ""],
        [""],
        ["", "DENTIST CONFIGURATION", "", "", "", "", "", ""],
        ["", "Dentist", "Split", "UDA Rate", "NHS?", "", "", ""]
    ]
    
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
            'cell': {'userEnteredFormat': {'textFormat': {'foregroundColor': COLORS['white'], 'bold': True, 'fontSize': 14}}}, 'fields': 'userEnteredFormat.textFormat'}},
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
    print("🦷 AURA DENTAL - PROFESSIONAL SHEET SETUP v3.0")
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
    print("✅ PROFESSIONAL SETUP v3.0 COMPLETE!")
    print("=" * 60)
    print(f"\n🔗 https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")


if __name__ == "__main__":
    main()
