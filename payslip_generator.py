#!/usr/bin/env python3
"""
Aura Dental Clinic - Payslip Generator
Automatically generates payslips from Dentally data

Author: Claude (for Hisham)
"""

import os
import json
import requests
import re
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from collections import defaultdict
import gspread
from google.oauth2.service_account import Credentials
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
import io
import base64

# For PDF extraction
try:
    import fitz  # PyMuPDF
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False
    print("⚠️ PyMuPDF not installed - PDF extraction disabled")

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

# Email (optional)
GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS", "drhish@auradentalclinic.co.uk")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

# Practice Info
PRACTICE_NAME = "Aura Dental Clinic"
PRACTICE_ADDRESS = "East Avenue, Billingham, TS23 1BY"

# Private Takings Logs (Google Sheets - read only)
# Note: Hani Dalati doesn't maintain a takings log
PRIVATE_TAKINGS_LOGS = {
    "Moneeb Ahmad": "1Y-cSU-8rZHr3uHswaZjY2MA0umZT3rxcws6nvwGIMFo",
    "Peter Throw": "1vdKw3_hDWHaenh7OUjrwTdvN-zvf1a8dR45K08HLxr0",
    "Priyanka Kapoor": "13EDcD6zfOdrBwUzQmn9rPXboCTUFeYiuaRHO-gCrjlo",
    "Zeeshan Abbas": "1NWwKzMO7B12WjDnkp-MiKF4j1ge4T6yICSE1anKJhxQ",
    "Ankush Patel": "111HtVp2ShaJm9fxzuaRHNGBWUGRq831joUfawCfevUg",
    # Hani Dalati - no takings log (trusts practice)
}

# Dentist Configuration
DENTISTS = {
    "Zeeshan Abbas": {
        "split": 0.45,
        "uda_rate": 0,  # No NHS
        "display_name": "Dr Zeeshan Abbas",
        "superannuation": "Opted Out",
        "aliases": ["zeeshan", "zee", "abbas"]
    },
    "Peter Throw": {
        "split": 0.50,
        "uda_rate": 16,
        "display_name": "Dr Peter Throw",
        "superannuation": "Opted Out",
        "aliases": ["peter", "throw"]
    },
    "Priyanka Kapoor": {
        "split": 0.50,
        "uda_rate": 15,
        "display_name": "Dr Priyanka Kapoor",
        "superannuation": "Opted Out",
        "aliases": ["priyanka", "kapoor"]
    },
    "Moneeb Ahmad": {
        "split": 0.50,
        "uda_rate": 15,
        "display_name": "Dr Moneeb Ahmad",
        "superannuation": "Opted Out",
        "aliases": ["moneeb", "ahmad"]
    },
    "Hani Dalati": {
        "split": 0.50,
        "uda_rate": 15,
        "display_name": "Dr Hani Dalati",
        "superannuation": "Opted Out",
        "aliases": ["hani", "dalati"]
    },
    "Hisham Saqib": {
        "split": 0.50,
        "uda_rate": 0,  # Owner
        "display_name": "Dr Hisham Saqib",
        "superannuation": "Opted Out",
        "aliases": ["hisham", "saqib", "hish"]
    },
    "Ankush Patel": {
        "split": 0.50,
        "uda_rate": 15,
        "display_name": "Dr Ankush Patel",
        "superannuation": "Opted Out",
        "aliases": ["ankush", "patel"]
    }
}

# Deduction rates
LAB_BILL_SPLIT = 0.50  # Dentist pays 50% of lab bills
FINANCE_FEE_SPLIT = 0.50  # Dentist pays 50% of finance fees
THERAPY_RATE_PER_MINUTE = 0.583333  # £35/hour = £0.583/minute

# Tabeo subsidy fees by term length
# If we can't determine the term, we default to 8% (12 month rate - most common)
TABEO_FEE_RATES = {
    3: 0.045,   # 3 months = 4.5%
    12: 0.08,   # 12 months = 8.0%
    36: 0.034,  # 36 months = 3.4%
    60: 0.037,  # 60 months = 3.7%
}
TABEO_DEFAULT_RATE = 0.08  # Default to 12 month rate if unknown

# Items to exclude from dentist earnings (go to practice)
EXCLUDED_TREATMENTS = ["CBCT", "CT Scan", "Cone Beam"]

# =============================================================================
# DENTALLY API FUNCTIONS
# =============================================================================

def dentally_request(endpoint, params=None):
    """Make a request to the Dentally API"""
    url = f"{DENTALLY_API_BASE}/{endpoint}"
    headers = {
        "Authorization": f"Bearer {DENTALLY_API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "AuraPayslipGenerator/1.0"
    }
    
    try:
        response = requests.get(url, headers=headers, params=params)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"   ⚠️ Dentally API error: {response.status_code} - {response.text[:200]}")
            return None
    except Exception as e:
        print(f"   ⚠️ Dentally API exception: {e}")
        return None


def get_practitioners():
    """Get all practitioners from Dentally"""
    print("   Fetching practitioners...")
    data = dentally_request("practitioners")
    if data:
        practitioners = {}
        for p in data.get("practitioners", []):
            name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
            practitioners[p.get("id")] = {
                "name": name,
                "id": p.get("id"),
                "type": p.get("practitioner_type"),
                "active": p.get("active", True)
            }
        print(f"   Found {len(practitioners)} practitioners")
        return practitioners
    return {}


def get_invoices_for_period(start_date, end_date):
    """Get all invoices with payments in the given period"""
    print(f"   Fetching invoices for {start_date} to {end_date}...")
    
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
        
        # Check for more pages
        if len(invoices) < 100:
            break
        page += 1
    
    print(f"   Found {len(all_invoices)} invoices")
    return all_invoices


def get_invoice_details(invoice_id):
    """Get detailed invoice with line items"""
    return dentally_request(f"invoices/{invoice_id}")


def get_payments_for_period(start_date, end_date):
    """Get all payments in the given period"""
    print(f"   Fetching payments for {start_date} to {end_date}...")
    
    all_payments = []
    page = 1
    
    while True:
        params = {
            "from": start_date.strftime("%Y-%m-%d"),
            "to": end_date.strftime("%Y-%m-%d"),
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
        
        if len(payments) < 100:
            break
        page += 1
    
    print(f"   Found {len(all_payments)} payments")
    return all_payments


def get_patient_details(patient_id):
    """Get patient name from ID"""
    data = dentally_request(f"patients/{patient_id}")
    if data and data.get("patient"):
        p = data["patient"]
        return f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
    return "Unknown Patient"


def get_appointments_for_period(start_date, end_date, practitioner_id=None):
    """Get appointments for a period, optionally filtered by practitioner"""
    print(f"   Fetching appointments...")
    
    all_appointments = []
    page = 1
    
    while True:
        params = {
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "page": page,
            "per_page": 100
        }
        if practitioner_id:
            params["practitioner_id"] = practitioner_id
        
        data = dentally_request("appointments", params)
        if not data:
            break
            
        appointments = data.get("appointments", [])
        if not appointments:
            break
            
        all_appointments.extend(appointments)
        
        if len(appointments) < 100:
            break
        page += 1
    
    print(f"   Found {len(all_appointments)} appointments")
    return all_appointments


# =============================================================================
# LAB BILL PDF EXTRACTION
# =============================================================================

# Known lab names and their variations
LAB_IDENTIFIERS = {
    "Furze": ["furze", "furze dental laboratory"],
    "Halo": ["halo", "halo dental"],
    "Straumann": ["straumann"],
    "Robinsons": ["robinsons", "robinson"],
    "Queensway": ["queensway"],
    "Richley": ["richley"],
    "Priory": ["priory"],
    "Jordent": ["jordent"],
    "Boutique": ["boutique"],
    "Costech": ["costech"],
    "Optadent": ["optadent"],
    "Scan Digital": ["scan digital", "scandigital"],
    "Invisalign": ["invisalign"],
}


def identify_dentist_from_text(text):
    """Try to identify which dentist a lab bill belongs to"""
    text_lower = text.lower()
    
    for dentist_name, config in DENTISTS.items():
        # Check full name
        if dentist_name.lower() in text_lower:
            return dentist_name
        
        # Check aliases
        aliases = config.get("aliases", [])
        for alias in aliases:
            # Look for the alias as a whole word
            if re.search(r'\b' + re.escape(alias) + r'\b', text_lower):
                return dentist_name
    
    return None


def identify_lab_from_text(text):
    """Identify which lab the bill is from"""
    text_lower = text.lower()
    
    for lab_name, identifiers in LAB_IDENTIFIERS.items():
        for identifier in identifiers:
            if identifier in text_lower:
                return lab_name
    
    return None


def extract_amount_from_text(text):
    """Extract total amount from lab bill text"""
    # Look for common patterns
    patterns = [
        r'total\s*outstanding[:\s]*[£$]?\s*([\d,]+\.?\d*)',
        r'amount\s*due[:\s]*[£$]?\s*([\d,]+\.?\d*)',
        r'total[:\s]*[£$]?\s*([\d,]+\.?\d*)',
        r'balance[:\s]*[£$]?\s*([\d,]+\.?\d*)',
        r'[£$]\s*([\d,]+\.?\d*)\s*$',  # Amount at end of line
    ]
    
    text_lower = text.lower()
    amounts = []
    
    for pattern in patterns:
        matches = re.findall(pattern, text_lower)
        for match in matches:
            try:
                amount = float(match.replace(',', ''))
                if amount > 0:
                    amounts.append(amount)
            except ValueError:
                continue
    
    # Return the largest amount found (usually the total)
    if amounts:
        return max(amounts)
    
    return None


def extract_month_from_text(text):
    """Extract statement month from lab bill text"""
    # Look for month patterns
    months = {
        'january': 1, 'february': 2, 'march': 3, 'april': 4,
        'may': 5, 'june': 6, 'july': 7, 'august': 8,
        'september': 9, 'october': 10, 'november': 11, 'december': 12,
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
        'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
    }
    
    text_lower = text.lower()
    
    # Look for "Statement Month: December 2025" pattern
    match = re.search(r'statement\s*month[:\s]*(\w+)\s*(\d{4})', text_lower)
    if match:
        month_name = match.group(1)
        year = int(match.group(2))
        if month_name in months:
            return datetime(year, months[month_name], 1)
    
    # Look for date patterns like "30-Dec-25" or "December 2025"
    for month_name, month_num in months.items():
        pattern = rf'\b{month_name}\b.*?(\d{{2,4}})'
        match = re.search(pattern, text_lower)
        if match:
            year = int(match.group(1))
            if year < 100:
                year += 2000
            return datetime(year, month_num, 1)
    
    return None


def extract_lab_bill_from_pdf(pdf_path):
    """
    Extract lab bill information from a PDF file
    
    Returns:
        dict with keys: lab_name, dentist_name, amount, month, raw_text, flags
    """
    if not PDF_SUPPORT:
        return {"error": "PDF support not available - install PyMuPDF"}
    
    result = {
        "lab_name": None,
        "dentist_name": None,
        "amount": None,
        "month": None,
        "raw_text": "",
        "flags": [],
        "source_file": pdf_path
    }
    
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        
        result["raw_text"] = text
        
        # Extract information
        result["lab_name"] = identify_lab_from_text(text)
        result["dentist_name"] = identify_dentist_from_text(text)
        result["amount"] = extract_amount_from_text(text)
        result["month"] = extract_month_from_text(text)
        
        # Add flags for missing information
        if not result["lab_name"]:
            result["flags"].append("Could not identify lab - manual entry required")
        if not result["dentist_name"]:
            result["flags"].append("Could not identify dentist - manual assignment required")
        if not result["amount"]:
            result["flags"].append("Could not extract amount - manual entry required")
        if not result["month"]:
            result["flags"].append("Could not determine month - manual entry required")
        
        print(f"   📄 Extracted: {result['lab_name']} → {result['dentist_name']} £{result['amount']}")
        
    except Exception as e:
        result["flags"].append(f"PDF extraction error: {str(e)}")
        print(f"   ⚠️ PDF extraction error: {e}")
    
    return result


def process_lab_bill_folder(folder_path):
    """Process all PDFs in a folder and extract lab bill data"""
    print(f"\n📁 Processing lab bills from: {folder_path}")
    
    lab_bills = {}  # {dentist_name: {lab_name: amount}}
    flags = []
    
    if not os.path.exists(folder_path):
        print(f"   ⚠️ Folder not found: {folder_path}")
        return lab_bills, flags
    
    pdf_files = [f for f in os.listdir(folder_path) if f.lower().endswith('.pdf')]
    print(f"   Found {len(pdf_files)} PDF files")
    
    for pdf_file in pdf_files:
        pdf_path = os.path.join(folder_path, pdf_file)
        result = extract_lab_bill_from_pdf(pdf_path)
        
        if result["flags"]:
            flags.extend([f"{pdf_file}: {flag}" for flag in result["flags"]])
        
        if result["dentist_name"] and result["lab_name"] and result["amount"]:
            dentist = result["dentist_name"]
            lab = result["lab_name"]
            amount = result["amount"]
            
            if dentist not in lab_bills:
                lab_bills[dentist] = {}
            
            if lab in lab_bills[dentist]:
                lab_bills[dentist][lab] += amount
            else:
                lab_bills[dentist][lab] = amount
    
    return lab_bills, flags


# =============================================================================
# PRIVATE TAKINGS LOG FUNCTIONS
# =============================================================================

def read_private_takings_log(spreadsheet_id, month_year):
    """
    Read a dentist's private takings log for a specific month
    
    Args:
        spreadsheet_id: Google Sheet ID
        month_year: datetime object for the month to read
    
    Returns:
        List of patient entries: [{name, amount, date, treatment}, ...]
    """
    print(f"   Reading private takings log: {spreadsheet_id[:20]}...")
    
    client = get_sheets_client()
    if not client:
        return []
    
    try:
        spreadsheet = client.open_by_key(spreadsheet_id)
        
        # Try to find the right sheet/tab for this month
        # Common formats: "November 2025", "Nov 25", "Nov-25", "2025-11"
        month_names = [
            month_year.strftime("%B %Y"),      # November 2025
            month_year.strftime("%b %Y"),      # Nov 2025
            month_year.strftime("%b %y"),      # Nov 25
            month_year.strftime("%B %y"),      # November 25
            month_year.strftime("%Y-%m"),      # 2025-11
            month_year.strftime("%m-%Y"),      # 11-2025
        ]
        
        target_sheet = None
        for sheet in spreadsheet.worksheets():
            sheet_title = sheet.title.strip()
            for month_name in month_names:
                if month_name.lower() in sheet_title.lower():
                    target_sheet = sheet
                    break
            if target_sheet:
                break
        
        # If no month-specific sheet, try the first sheet
        if not target_sheet:
            target_sheet = spreadsheet.sheet1
        
        # Read all data
        data = target_sheet.get_all_values()
        
        # Parse the data - look for patient names and amounts
        entries = []
        header_row = None
        
        for i, row in enumerate(data):
            # Try to find header row
            row_lower = [str(cell).lower() for cell in row]
            if any('patient' in cell or 'name' in cell for cell in row_lower):
                header_row = i
                continue
            
            # Skip if we haven't found header yet
            if header_row is None:
                continue
            
            # Try to extract patient name and amount
            # This is heuristic - may need adjustment based on actual sheet format
            if len(row) >= 2:
                patient_name = str(row[0]).strip() if row[0] else ""
                
                # Look for amount in the row (first number-like value)
                amount = None
                for cell in row[1:]:
                    cell_str = str(cell).replace('£', '').replace(',', '').strip()
                    try:
                        amount = float(cell_str)
                        if amount > 0:
                            break
                    except ValueError:
                        continue
                
                if patient_name and amount and amount > 0:
                    entries.append({
                        "name": patient_name,
                        "amount": amount,
                        "raw_row": row
                    })
        
        print(f"   Found {len(entries)} entries in takings log")
        return entries
        
    except Exception as e:
        print(f"   ⚠️ Error reading takings log: {e}")
        return []


def cross_reference_takings(dentist_name, dentally_patients, takings_log_entries):
    """
    Cross-reference Dentally data with private takings log
    
    Returns:
        dict with: matched, in_log_not_dentally, in_dentally_not_log, amount_mismatches
    """
    result = {
        "matched": [],
        "in_log_not_dentally": [],
        "in_dentally_not_log": [],
        "amount_mismatches": []
    }
    
    # Normalize names for matching
    def normalize_name(name):
        return ' '.join(name.lower().split())
    
    dentally_dict = {normalize_name(p["name"]): p for p in dentally_patients}
    log_dict = {normalize_name(e["name"]): e for e in takings_log_entries}
    
    # Check each log entry against Dentally
    for log_name, log_entry in log_dict.items():
        if log_name in dentally_dict:
            dentally_entry = dentally_dict[log_name]
            
            # Check if amounts match (within £1 tolerance)
            if abs(log_entry["amount"] - dentally_entry["amount"]) <= 1:
                result["matched"].append({
                    "name": log_entry["name"],
                    "amount": log_entry["amount"]
                })
            else:
                result["amount_mismatches"].append({
                    "name": log_entry["name"],
                    "log_amount": log_entry["amount"],
                    "dentally_amount": dentally_entry["amount"],
                    "difference": log_entry["amount"] - dentally_entry["amount"]
                })
        else:
            result["in_log_not_dentally"].append({
                "name": log_entry["name"],
                "amount": log_entry["amount"]
            })
    
    # Check for entries in Dentally but not in log
    for dentally_name, dentally_entry in dentally_dict.items():
        if dentally_name not in log_dict:
            result["in_dentally_not_log"].append({
                "name": dentally_entry["name"],
                "amount": dentally_entry["amount"]
            })
    
    return result


# =============================================================================
# PAYSLIP CALCULATION FUNCTIONS
# =============================================================================

def calculate_payslips(start_date, end_date, lab_bills=None, therapy_minutes=None):
    """
    Calculate payslips for all dentists for the given period
    
    Args:
        start_date: First day of pay period
        end_date: Last day of pay period
        lab_bills: Dict of {dentist_name: {lab_name: amount, ...}, ...}
        therapy_minutes: Dict of {dentist_name: minutes, ...}
    
    Returns:
        Dict of payslip data for each dentist
    """
    print(f"\n📊 Calculating payslips for {start_date.strftime('%B %Y')}...")
    
    # Initialize lab_bills and therapy_minutes if not provided
    if lab_bills is None:
        lab_bills = {}
    if therapy_minutes is None:
        therapy_minutes = {}
    
    # Get practitioners mapping
    practitioners = get_practitioners()
    
    # Create reverse mapping: name -> dentist config
    practitioner_to_dentist = {}
    for prac_id, prac_info in practitioners.items():
        prac_name = prac_info["name"]
        for dentist_name, dentist_config in DENTISTS.items():
            # Fuzzy match - check if names are similar
            if dentist_name.lower() in prac_name.lower() or prac_name.lower() in dentist_name.lower():
                practitioner_to_dentist[prac_id] = dentist_name
                break
    
    # Initialize payslip data for each dentist
    payslips = {}
    for dentist_name in DENTISTS:
        payslips[dentist_name] = {
            "dentist_name": dentist_name,
            "display_name": DENTISTS[dentist_name]["display_name"],
            "split": DENTISTS[dentist_name]["split"],
            "superannuation": DENTISTS[dentist_name]["superannuation"],
            "period": f"{start_date.strftime('%B %Y')}",
            "payslip_date": (end_date + timedelta(days=15)).strftime("%B %dth %Y"),
            
            # Private
            "gross_private_dentist": 0,
            "gross_private_therapist": 0,
            "gross_total": 0,
            "net_private": 0,
            
            # NHS (if applicable)
            "udas": 0,
            "uda_rate": DENTISTS[dentist_name]["uda_rate"],
            "uda_income": 0,
            
            # Deductions
            "lab_bills": lab_bills.get(dentist_name, {}),
            "lab_bills_total": 0,
            "lab_bills_50": 0,
            "finance_fees_total": 0,
            "finance_fees_50": 0,
            "therapy_minutes": therapy_minutes.get(dentist_name, 0),
            "therapy_total": 0,
            "total_deductions": 0,
            
            # Final
            "total_payment": 0,
            
            # Patient breakdown
            "patients": []
        }
    
    # Get invoices and payments
    invoices = get_invoices_for_period(start_date, end_date)
    payments = get_payments_for_period(start_date, end_date)
    
    # Build payment method lookup (to identify finance payments)
    payment_methods = {}
    for payment in payments:
        invoice_id = payment.get("invoice_id")
        if invoice_id:
            method = payment.get("payment_method", "").lower()
            amount = float(payment.get("amount", 0))
            if invoice_id not in payment_methods:
                payment_methods[invoice_id] = []
            payment_methods[invoice_id].append({
                "method": method,
                "amount": amount
            })
    
    # Process each invoice
    for invoice in invoices:
        invoice_id = invoice.get("id")
        patient_id = invoice.get("patient_id")
        practitioner_id = invoice.get("practitioner_id")
        
        # Get patient name
        patient_name = get_patient_details(patient_id) if patient_id else "Unknown"
        
        # Find which dentist this belongs to
        dentist_name = practitioner_to_dentist.get(practitioner_id)
        if not dentist_name:
            continue
        
        # Get invoice details
        invoice_details = get_invoice_details(invoice_id)
        if not invoice_details:
            continue
        
        invoice_data = invoice_details.get("invoice", {})
        line_items = invoice_data.get("line_items", [])
        
        # Calculate totals for this invoice
        total_amount = 0
        is_therapist = False
        excluded_amount = 0
        finance_fee = 0
        
        for item in line_items:
            item_name = item.get("description", "")
            item_amount = float(item.get("amount", 0))
            item_status = item.get("status", "")
            
            # Only count paid items
            if item_status.lower() != "paid":
                continue
            
            # Check if this is an excluded treatment (CBCT, etc.)
            is_excluded = any(excl.lower() in item_name.lower() for excl in EXCLUDED_TREATMENTS)
            if is_excluded:
                excluded_amount += item_amount
                continue
            
            # Check if this is therapist work
            if "therapist" in item_name.lower() or "hygiene" in item_name.lower():
                is_therapist = True
            
            total_amount += item_amount
        
        # Check for finance payments
        inv_payments = payment_methods.get(invoice_id, [])
        for p in inv_payments:
            if "finance" in p["method"] or "tabeo" in p["method"]:
                # Calculate finance fee (Tabeo subsidy)
                # Try to determine term from payment notes, default to 12 month rate
                # TODO: Could integrate with Tabeo API for exact term info
                term_months = p.get("term_months", 12)
                fee_rate = TABEO_FEE_RATES.get(term_months, TABEO_DEFAULT_RATE)
                finance_fee += p["amount"] * fee_rate
        
        # Add to dentist's totals
        if total_amount > 0:
            if is_therapist:
                payslips[dentist_name]["gross_private_therapist"] += total_amount
            else:
                payslips[dentist_name]["gross_private_dentist"] += total_amount
            
            payslips[dentist_name]["finance_fees_total"] += finance_fee
            
            # Add to patient breakdown
            payslips[dentist_name]["patients"].append({
                "name": patient_name,
                "amount": total_amount,
                "finance_fee": finance_fee,
                "finance_fee_50": finance_fee * FINANCE_FEE_SPLIT,
                "therapist": is_therapist
            })
    
    # Calculate final figures for each dentist
    for dentist_name, payslip in payslips.items():
        # Gross total
        payslip["gross_total"] = payslip["gross_private_dentist"] + payslip["gross_private_therapist"]
        
        # Net private (after split)
        payslip["net_private"] = payslip["gross_total"] * payslip["split"]
        
        # UDA income
        payslip["uda_income"] = payslip["udas"] * payslip["uda_rate"]
        
        # Lab bills
        payslip["lab_bills_total"] = sum(payslip["lab_bills"].values())
        payslip["lab_bills_50"] = payslip["lab_bills_total"] * LAB_BILL_SPLIT
        
        # Finance fees
        payslip["finance_fees_50"] = payslip["finance_fees_total"] * FINANCE_FEE_SPLIT
        
        # Therapy
        payslip["therapy_total"] = payslip["therapy_minutes"] * THERAPY_RATE_PER_MINUTE
        
        # Total deductions
        payslip["total_deductions"] = (
            payslip["lab_bills_50"] +
            payslip["finance_fees_50"] +
            payslip["therapy_total"]
        )
        
        # Total payment
        payslip["total_payment"] = (
            payslip["net_private"] +
            payslip["uda_income"] -
            payslip["total_deductions"]
        )
        
        print(f"   {dentist_name}: £{payslip['total_payment']:.2f}")
    
    return payslips


# =============================================================================
# PDF GENERATION
# =============================================================================

def generate_payslip_pdf(payslip, output_path=None):
    """Generate a PDF payslip"""
    
    if output_path is None:
        output_path = f"payslip_{payslip['dentist_name'].replace(' ', '_')}_{payslip['period'].replace(' ', '_')}.pdf"
    
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=20*mm,
        leftMargin=20*mm,
        topMargin=20*mm,
        bottomMargin=20*mm
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'Title',
        parent=styles['Heading1'],
        fontSize=16,
        alignment=TA_CENTER,
        spaceAfter=20
    )
    
    header_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontSize=10,
        spaceAfter=5
    )
    
    section_style = ParagraphStyle(
        'Section',
        parent=styles['Heading2'],
        fontSize=12,
        spaceBefore=15,
        spaceAfter=10,
        textColor=colors.darkblue
    )
    
    elements = []
    
    # Header
    elements.append(Paragraph(PRACTICE_NAME, title_style))
    elements.append(Spacer(1, 10))
    
    # Payslip info
    header_data = [
        ["Payslip Date:", payslip["payslip_date"]],
        ["Private Period:", payslip["period"]],
        ["Performer:", payslip["display_name"]],
        ["Practice:", PRACTICE_NAME],
        ["Superannuation Status:", payslip["superannuation"]]
    ]
    
    header_table = Table(header_data, colWidths=[120, 300])
    header_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 20))
    
    # Section 1: Private Fees
    elements.append(Paragraph("Section 1: Private Fees", section_style))
    
    fees_data = [
        ["Gross Private by Dentist", "", f"£{payslip['gross_private_dentist']:,.2f}"],
        ["Gross Private by Therapist", "", f"£{payslip['gross_private_therapist']:,.2f}" if payslip['gross_private_therapist'] > 0 else ""],
        ["Gross Total", "", f"£{payslip['gross_total']:,.2f}"],
        [f"Subtotal ({int(payslip['split']*100)}%)", "", f"£{payslip['net_private']:,.2f}"],
    ]
    
    fees_table = Table(fees_data, colWidths=[200, 100, 120])
    fees_table.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LINEBELOW', (0, -1), (-1, -1), 1, colors.black),
    ]))
    elements.append(fees_table)
    elements.append(Spacer(1, 15))
    
    # Section 2: Deductions
    elements.append(Paragraph("Section 2: Deductions", section_style))
    
    deductions_data = []
    
    # Lab bills
    if payslip["lab_bills"]:
        for lab_name, amount in payslip["lab_bills"].items():
            deductions_data.append(["", lab_name, f"£{amount:,.2f}"])
        deductions_data.append(["Labs", "Lab Bills Total", f"£{payslip['lab_bills_total']:,.2f}"])
        deductions_data.append(["", "Lab Bills 50%", f"£{payslip['lab_bills_50']:,.2f}"])
    
    # Finance fees
    if payslip["finance_fees_total"] > 0:
        deductions_data.append(["Finance Fees", "", f"£{payslip['finance_fees_total']:,.2f}"])
        deductions_data.append(["50%", "", f"£{payslip['finance_fees_50']:,.2f}"])
    
    # Therapy
    if payslip["therapy_minutes"] > 0:
        deductions_data.append(["Therapy", "Taryn", f"{payslip['therapy_minutes']} mins"])
        deductions_data.append(["", f"@ £{THERAPY_RATE_PER_MINUTE:.4f}/min", f"£{payslip['therapy_total']:,.2f}"])
    
    # Total deductions
    deductions_data.append(["Total Deductions", "", f"£{payslip['total_deductions']:,.2f}"])
    
    if deductions_data:
        deductions_table = Table(deductions_data, colWidths=[100, 200, 120])
        deductions_table.setStyle(TableStyle([
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LINEBELOW', (0, -1), (-1, -1), 1, colors.black),
        ]))
        elements.append(deductions_table)
    
    elements.append(Spacer(1, 20))
    
    # Total Payment
    total_data = [
        ["Total Payment", "", f"£{payslip['total_payment']:,.2f}"]
    ]
    total_table = Table(total_data, colWidths=[200, 100, 120])
    total_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 12),
        ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ('BACKGROUND', (0, 0), (-1, -1), colors.lightgrey),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(total_table)
    elements.append(Spacer(1, 30))
    
    # Patient Breakdown
    if payslip["patients"]:
        elements.append(Paragraph("Patient Breakdown", section_style))
        
        patient_header = ["Patient Name", "Finance Fee", "Finance 50%", "Paid"]
        patient_data = [patient_header]
        
        for patient in payslip["patients"]:
            patient_data.append([
                patient["name"],
                f"£{patient['finance_fee']:,.2f}" if patient["finance_fee"] > 0 else "",
                f"£{patient['finance_fee_50']:,.2f}" if patient["finance_fee_50"] > 0 else "",
                f"£{patient['amount']:,.2f}"
            ])
        
        patient_table = Table(patient_data, colWidths=[180, 80, 80, 80])
        patient_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(patient_table)
    
    # Build PDF
    doc.build(elements)
    print(f"   Generated: {output_path}")
    return output_path


# =============================================================================
# GOOGLE SHEETS FUNCTIONS
# =============================================================================

def get_sheets_client():
    """Get authenticated Google Sheets client"""
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("   ⚠️ Google Sheets credentials not configured")
        return None
    
    try:
        creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        creds = Credentials.from_service_account_info(creds_dict, scopes=scopes)
        client = gspread.authorize(creds)
        return client
    except Exception as e:
        print(f"   ⚠️ Google Sheets auth error: {e}")
        return None


def update_google_sheets(payslips):
    """Update Google Sheets with payslip data"""
    print("\n📊 Updating Google Sheets...")
    
    client = get_sheets_client()
    if not client:
        return False
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        
        # Update Master Sheet
        try:
            master_sheet = spreadsheet.worksheet("Master Sheet")
        except:
            master_sheet = spreadsheet.add_worksheet(title="Master Sheet", rows=20, cols=40)
        
        # Clear and set headers
        master_sheet.clear()
        headers = [
            "Clinician", "Gross Private", "Split %", "Net Private",
            "Lab Bills Total", "Lab Bills 50%", "Finance Fees", "Finance 50%",
            "Therapy Mins", "Therapy Total", "Total Deductions", "Net Pay"
        ]
        master_sheet.update('A1', [headers])
        
        # Add data for each dentist
        row = 2
        for dentist_name, payslip in payslips.items():
            data = [
                dentist_name,
                payslip["gross_total"],
                payslip["split"],
                payslip["net_private"],
                payslip["lab_bills_total"],
                payslip["lab_bills_50"],
                payslip["finance_fees_total"],
                payslip["finance_fees_50"],
                payslip["therapy_minutes"],
                payslip["therapy_total"],
                payslip["total_deductions"],
                payslip["total_payment"]
            ]
            master_sheet.update(f'A{row}', [data])
            row += 1
        
        print("   ✅ Master Sheet updated")
        
        # Update individual dentist sheets
        for dentist_name, payslip in payslips.items():
            sheet_name = f"{dentist_name.split()[0]} Payslip"
            
            try:
                dentist_sheet = spreadsheet.worksheet(sheet_name)
            except:
                dentist_sheet = spreadsheet.add_worksheet(title=sheet_name, rows=100, cols=10)
            
            # Clear and populate
            dentist_sheet.clear()
            
            # Header info
            dentist_sheet.update('A1', [
                ["Payslip Date:", payslip["payslip_date"]],
                ["Private Period:", payslip["period"]],
                ["Performer:", payslip["display_name"]],
                ["Practice:", PRACTICE_NAME],
                ["Superannuation:", payslip["superannuation"]],
                [""],
                ["Section 1: Private Fees"],
                ["Gross Private by Dentist", "", payslip["gross_private_dentist"]],
                ["Gross Private by Therapist", "", payslip["gross_private_therapist"]],
                ["Gross Total", "", payslip["gross_total"]],
                [f"Subtotal ({int(payslip['split']*100)}%)", "", payslip["net_private"]],
                [""],
                ["Section 2: Deductions"],
                ["Lab Bills Total", "", payslip["lab_bills_total"]],
                ["Lab Bills 50%", "", payslip["lab_bills_50"]],
                ["Finance Fees", "", payslip["finance_fees_total"]],
                ["Finance 50%", "", payslip["finance_fees_50"]],
                ["Therapy Total", "", payslip["therapy_total"]],
                ["Total Deductions", "", payslip["total_deductions"]],
                [""],
                ["Total Payment", "", payslip["total_payment"]],
                [""],
                ["Patient Breakdown"],
                ["Name", "Finance Fee", "Finance 50%", "Paid"]
            ])
            
            # Add patient breakdown
            row = 25
            for patient in payslip["patients"]:
                dentist_sheet.update(f'A{row}', [[
                    patient["name"],
                    patient["finance_fee"],
                    patient["finance_fee_50"],
                    patient["amount"]
                ]])
                row += 1
            
            print(f"   ✅ {sheet_name} updated")
        
        return True
        
    except Exception as e:
        print(f"   ⚠️ Google Sheets error: {e}")
        return False


# =============================================================================
# MAIN FUNCTION
# =============================================================================

def run_payslip_generator(year=None, month=None, lab_bills=None, therapy_minutes=None):
    """
    Main function to generate payslips
    
    Args:
        year: Year of pay period (default: previous month)
        month: Month of pay period (default: previous month)
        lab_bills: Dict of lab bills per dentist
        therapy_minutes: Dict of therapy minutes per dentist
    """
    print("=" * 60)
    print("🦷 AURA DENTAL CLINIC - PAYSLIP GENERATOR")
    print("=" * 60)
    
    # Determine pay period
    if year is None or month is None:
        # Default to previous month
        today = datetime.now()
        pay_period = today.replace(day=1) - timedelta(days=1)
        year = pay_period.year
        month = pay_period.month
    
    start_date = datetime(year, month, 1)
    # Last day of month
    if month == 12:
        end_date = datetime(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = datetime(year, month + 1, 1) - timedelta(days=1)
    
    print(f"\n📅 Pay Period: {start_date.strftime('%d %B %Y')} - {end_date.strftime('%d %B %Y')}")
    print(f"📅 Payslip Date: {(end_date + timedelta(days=15)).strftime('%d %B %Y')}")
    
    # Validate API token
    if not DENTALLY_API_TOKEN:
        print("\n❌ Error: DENTALLY_API_TOKEN not set")
        return None
    
    # Calculate payslips
    payslips = calculate_payslips(start_date, end_date, lab_bills, therapy_minutes)
    
    # Generate PDFs
    print("\n📄 Generating PDFs...")
    pdf_dir = "payslips"
    os.makedirs(pdf_dir, exist_ok=True)
    
    for dentist_name, payslip in payslips.items():
        if payslip["total_payment"] > 0:  # Only generate if there's payment
            output_path = os.path.join(pdf_dir, f"{dentist_name.replace(' ', '_')}_{start_date.strftime('%B_%Y')}.pdf")
            generate_payslip_pdf(payslip, output_path)
    
    # Update Google Sheets
    if SPREADSHEET_ID:
        update_google_sheets(payslips)
    
    print("\n" + "=" * 60)
    print("✅ PAYSLIP GENERATION COMPLETE")
    print("=" * 60)
    
    # Summary
    print("\n📊 Summary:")
    total_payout = 0
    for dentist_name, payslip in payslips.items():
        if payslip["total_payment"] > 0:
            print(f"   {dentist_name}: £{payslip['total_payment']:,.2f}")
            total_payout += payslip["total_payment"]
    print(f"\n   Total Payout: £{total_payout:,.2f}")
    
    return payslips


# =============================================================================
# ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate dental practice payslips")
    parser.add_argument("--year", type=int, help="Year of pay period")
    parser.add_argument("--month", type=int, help="Month of pay period (1-12)")
    parser.add_argument("--lab-bills", type=str, help="JSON file with lab bills data")
    parser.add_argument("--therapy", type=str, help="JSON file with therapy minutes data")
    
    args = parser.parse_args()
    
    # Load lab bills if provided
    lab_bills = None
    if args.lab_bills and os.path.exists(args.lab_bills):
        with open(args.lab_bills) as f:
            lab_bills = json.load(f)
    
    # Load therapy minutes if provided
    therapy_minutes = None
    if args.therapy and os.path.exists(args.therapy):
        with open(args.therapy) as f:
            therapy_minutes = json.load(f)
    
    run_payslip_generator(args.year, args.month, lab_bills, therapy_minutes)
