#!/usr/bin/env python3
"""
Aura Dental Clinic - Payslip Generator v4.0
Pulls from Dentally, updates Google Sheets, generates PDFs

v4.0 Changes:
- Fixed duplicate "DISCREPANCIES TO REVIEW" header bug
- Added automatic lab bill processing from Google Drive
- Lab bills now tracked in "Lab Bills Log" to prevent double-counting
- Unassigned lab bills flagged for manual dentist selection
- Added PDF generation and email functionality

v3.0 Changes:
- Dashboard: Consistent 10pt font throughout (was inconsistent)
- Payslips: Match Zee Payslip template design with sections
- Column widths: Properly sized so all data is visible
- Logo: 80x80px (1:1 ratio, was squashed)
- Discrepancies: Appear at bottom of each payslip

Author: Built for Hisham @ Aura Dental
"""

import os
import json
import base64
import requests
import re
import time
import io
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
from datetime import datetime, timedelta
from collections import defaultdict

# Google Sheets & Drive
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# PDF parsing
import pdfplumber

# PDF Generation
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
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

# Historical Payslips Folder (for duplicate detection)
HISTORICAL_PAYSLIPS_FOLDER_ID = "1rcE4JFqnNj8jXHUCmQyoPn5DYDKSjNpJ"

# Lab Bills Folder (Jennie uploads lab invoices here)
LAB_BILLS_FOLDER_ID = "16VsBkxhg1DgKYC-SQJtRH9erJdt3v1zR"

# NHS Statements Folder (for UDA data - Peter, Priyanka, Moneeb)
NHS_STATEMENTS_FOLDER_ID = os.environ.get("NHS_STATEMENTS_FOLDER_ID", "1I581BCY2NpGiOz-94pId2tRFvvGP1oHV")  # Set this after creating folder

# Email Configuration (for sending PDF payslips)
EMAIL_SENDER = os.environ.get("EMAIL_SENDER", "")  # e.g., payslips@auradental.co.uk
EMAIL_PASSWORD = os.environ.get("EMAIL_PASSWORD", "")  # App password
EMAIL_SMTP_SERVER = os.environ.get("EMAIL_SMTP_SERVER", "smtp.gmail.com")
EMAIL_SMTP_PORT = int(os.environ.get("EMAIL_SMTP_PORT", "587"))
HISHAM_EMAIL = os.environ.get("HISHAM_EMAIL", "hisham@auradental.co.uk")

# Logo
LOGO_URL = "https://drive.google.com/uc?export=view&id=1Z4d-u7P8XzOOm3IKyssYrRD0o_jZ5fjd"

# Practice Info
PRACTICE_NAME = "Aura Dental Clinic"
PRACTICE_ADDRESS = "East Avenue, Billingham, TS23 1BY"

# Dentist Configuration - with Dentally practitioner_id mapping
DENTISTS = {
    "Zeeshan Abbas": {
        "practitioner_id": 283516,
        "split": 0.45,  # 45%
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Zeeshan Abbas",
    },
    "Peter Throw": {
        "practitioner_id": 189357,
        "split": 0.50,  # 50%
        "uda_rate": 16,
        "has_nhs": True,  # NHS
        "display_name": "Dr Peter Throw",
    },
    "Priyanka Kapoor": {
        "practitioner_id": 189361,
        "split": 0.50,  # 50%
        "uda_rate": 15,
        "has_nhs": True,  # NHS
        "display_name": "Dr Priyanka Kapoor",
    },
    "Moneeb Ahmad": {
        "practitioner_id": 293046,
        "split": 0.50,  # 50%
        "uda_rate": 15,
        "has_nhs": True,  # NHS
        "display_name": "Dr Moneeb Ahmad",
    },
    "Hani Dalati": {
        "practitioner_id": 263970,
        "split": 0.50,  # 50%
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Hani Dalati",
    },
    "Ankush Patel": {
        "practitioner_id": 110701,
        "split": 0.45,  # 45%
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Ankush Patel",
    },
    "Hisham Saqib": {
        "practitioner_id": 127844,
        "split": 0.50,  # 50%
        "uda_rate": None,
        "has_nhs": False,
        "display_name": "Dr Hisham Saqib",
    }
}

# Therapist (for tracking therapy work)
THERAPIST_ID = 288298  # Taryn Dawson

# Reverse lookup: practitioner_id -> dentist_name
PRACTITIONER_TO_DENTIST = {
    config["practitioner_id"]: name 
    for name, config in DENTISTS.items() 
    if config["practitioner_id"]
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

# Excluded treatments (go to practice, not dentist)
EXCLUDED_TREATMENTS = ["CBCT", "CT Scan", "Cone Beam"]

# NHS Band treatments to exclude (dentists paid via UDAs, not invoice amount)
NHS_BAND_KEYWORDS = [
    "band 1", "band 2", "band 3", "band urgent",
    "nhs band", "nhs urgent", "nhs examination",
    "urgent band", "band one", "band two", "band three",
    "nhs exam", "nhs scale", "nhs polish", "nhs filling",
    "nhs extraction", "nhs root", "nhs crown", "nhs denture"
]

# NHS Band charge amounts (what patients pay) - exclude these exact amounts
# Includes full band charges AND differential payments (upgrades)
NHS_BAND_AMOUNTS = [
    # Current rates (from April 2025)
    27.40,   # Band 1 / Urgent
    75.30,   # Band 2
    326.70,  # Band 3
    # Differential payments (upgrades between bands)
    47.90,   # Band 2 - Band 1 (75.30 - 27.40)
    299.30,  # Band 3 - Band 1 (326.70 - 27.40)
    251.40,  # Band 3 - Band 2 (326.70 - 75.30)
    # Previous rates (before April 2025)
    26.80,   # Old Band 1
    73.50,   # Old Band 2
    319.10,  # Old Band 3
    23.80,   # Old Urgent
    46.70,   # Old Band 2 - Band 1
]

# NHS treatment codes (from Dentally treatment list)
NHS_TREATMENT_CODES = [
    "100", "102", "103", "104", "105", "106", "107", "108", "109", "110",
    "116", "117", "118", "119", "120", "1001"
]


def is_nhs_treatment(item_name, item_amount, item_data=None):
    """
    Check if a line item is an NHS treatment that should be excluded.
    
    NHS treatments:
    - Usually have £0 price (patient pays NHS charge separately)
    - Have "Band 1/2/3" or similar in the name
    - Have specific NHS band amounts (£27.40, £47.90, £75.30, £23.80)
    - May have payment_type = "nhs" or similar
    
    Private treatments on NHS patients (whitening, white fillings) have different
    amounts (not band charges) - these are included.
    """
    item_name_lower = item_name.lower() if item_name else ""
    
    # Check for NHS band keywords in name
    for keyword in NHS_BAND_KEYWORDS:
        if keyword in item_name_lower:
            return True
    
    # Check for exact NHS band amounts
    for band_amount in NHS_BAND_AMOUNTS:
        if abs(item_amount - band_amount) < 0.01:  # Within 1p tolerance
            return True
    
    # Check if item has NHS payment type (if available in item_data)
    if item_data:
        payment_type = str(item_data.get("payment_type", "")).lower()
        payment_plan = str(item_data.get("payment_plan", "")).lower()
        payment_plan_name = str(item_data.get("payment_plan_name", "")).lower()
        nhs_flag = item_data.get("nhs", False)
        # Dentally API uses nhs_charge boolean on invoice_items
        nhs_charge = item_data.get("nhs_charge", False)
        
        if "nhs" in payment_type or "nhs" in payment_plan or "nhs" in payment_plan_name or nhs_flag or nhs_charge:
            return True
    
    # £0 items are typically NHS (patient pays band charge separately)
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


def get_invoices_for_period(start_date, end_date):
    """Get all paid invoices in period - filtered for Aura site and non-zero amounts
    
    Uses dated_on (invoice/treatment date) for period filtering
    Also captures paid_on and balance for validation
    """
    print(f"   Fetching invoices {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}...")
    
    all_invoices = []
    page = 1
    
    while True:
        params = {
            "dated_on_after": start_date.strftime("%Y-%m-%d"),
            "dated_on_before": end_date.strftime("%Y-%m-%d"),
            "site_id": DENTALLY_SITE_ID,  # Only Aura Dental
            "page": page,
            "per_page": 100
        }
        
        data = dentally_request("invoices", params)
        if not data:
            break
        
        invoices = data.get("invoices", [])
        if not invoices:
            break
        
        # Filter: only paid invoices with amount > 0
        for inv in invoices:
            amount = float(inv.get("amount", 0))
            balance = float(inv.get("balance", 0))
            is_paid = inv.get("paid", False)
            
            if amount > 0:
                # Track payment status for flagging
                inv["_amount"] = amount
                inv["_balance"] = balance
                inv["_is_paid"] = is_paid
                inv["_invoice_date"] = inv.get("dated_on", "")  # Treatment/invoice date
                inv["_paid_date"] = inv.get("paid_on", "")  # Payment date
                
                # Flag unpaid or partial payments
                if not is_paid or balance > 0:
                    inv["_payment_flag"] = f"⚠️ Balance: £{balance:.2f}" if balance > 0 else "⚠️ Not marked paid"
                else:
                    inv["_payment_flag"] = None
                
                all_invoices.append(inv)
        
        print(f"   Page {page}: {len(invoices)} invoices, {len(all_invoices)} valid so far...")
        
        if len(invoices) < 100:
            break
        page += 1
    
    # Summary
    paid_count = sum(1 for inv in all_invoices if inv["_is_paid"] and inv["_balance"] <= 0)
    unpaid_count = len(all_invoices) - paid_count
    
    print(f"   Found {len(all_invoices)} invoices (£>0): {paid_count} fully paid, {unpaid_count} with balance/unpaid")
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
    """Get all payments for a period - used to identify payment methods"""
    all_payments = []
    page = 1
    
    print(f"   Fetching payments from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}...")
    
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
        
        # Check if more pages
        meta = data.get("meta", {})
        total_pages = meta.get("total_pages", 1)
        if page >= total_pages:
            break
        page += 1
    
    print(f"   Found {len(all_payments)} payments")
    return all_payments


def build_invoice_payment_map(payments):
    """Build map of invoice_id -> payment_method from payments"""
    invoice_payment_map = {}
    
    for payment in payments:
        method = payment.get("method", "Unknown")
        # Get invoice IDs from explanations
        for explanation in payment.get("explanations", []):
            invoice_id = explanation.get("invoice_id")
            if invoice_id:
                invoice_payment_map[invoice_id] = method
    
    return invoice_payment_map


# =============================================================================
# GOOGLE DRIVE & HISTORICAL PAYSLIP PARSING
# =============================================================================

def get_drive_service():
    """Get authenticated Google Drive service"""
    if not GOOGLE_SHEETS_CREDENTIALS:
        print("   ⚠️ No Google credentials for Drive")
        return None
    
    try:
        creds_dict = json.loads(base64.b64decode(GOOGLE_SHEETS_CREDENTIALS))
        creds = Credentials.from_service_account_info(creds_dict, scopes=[
            'https://www.googleapis.com/auth/drive.readonly'
        ])
        service = build('drive', 'v3', credentials=creds)
        return service
    except Exception as e:
        print(f"   ⚠️ Drive auth error: {e}")
        return None


def list_payslip_pdfs(service, folder_id):
    """Recursively list all PDF payslips in the folder"""
    all_pdfs = []
    
    def search_folder(fid, dentist_name=None):
        query = f"'{fid}' in parents and trashed = false"
        results = service.files().list(
            q=query,
            fields="files(id, name, mimeType)",
            pageSize=100
        ).execute()
        
        files = results.get('files', [])
        
        for f in files:
            if f['mimeType'] == 'application/vnd.google-apps.folder':
                # It's a subfolder - use folder name as dentist name
                search_folder(f['id'], f['name'])
            elif f['mimeType'] == 'application/pdf' and 'payslip' in f['name'].lower():
                all_pdfs.append({
                    'id': f['id'],
                    'name': f['name'],
                    'dentist_folder': dentist_name
                })
    
    search_folder(folder_id)
    return all_pdfs


def download_pdf_content(service, file_id):
    """Download PDF content as bytes"""
    try:
        request = service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
        fh.seek(0)
        return fh
    except Exception as e:
        print(f"      ⚠️ Download error: {e}")
        return None


def parse_payslip_pdf(pdf_content, filename, dentist_folder=None):
    """
    Parse a payslip PDF and extract patient payments.
    
    Returns:
        {
            'dentist': str,
            'period': str,
            'patients': [{'name': str, 'date': str, 'amount': float}]
        }
    """
    result = {
        'dentist': dentist_folder,
        'period': None,
        'patients': [],
        'filename': filename
    }
    
    try:
        with pdfplumber.open(pdf_content) as pdf:
            text = ""
            for page in pdf.pages:
                text += page.extract_text() or ""
            
            # Extract dentist name from "Performer:" line
            performer_match = re.search(r'Performer[:\s]+(?:Dr\.?\s+)?(.+?)(?:\n|Practice)', text, re.IGNORECASE)
            if performer_match:
                result['dentist'] = performer_match.group(1).strip()
            
            # Extract period from "Private Period" line
            period_match = re.search(r'Private\s+Period[:\s]+(\w+\s+\d{4})', text, re.IGNORECASE)
            if period_match:
                result['period'] = period_match.group(1).strip()
            
            # Extract patient breakdown section
            # Look for lines with: Name, Date (DD/MM/YYYY), and Amount (£X,XXX.XX)
            # Pattern: Name followed by date and amount at end
            lines = text.split('\n')
            in_breakdown = False
            
            for line in lines:
                # Check if we're in patient breakdown section
                if 'patient breakdown' in line.lower():
                    in_breakdown = True
                    continue
                
                if not in_breakdown:
                    continue
                
                # Stop at section 3 or other sections
                if re.match(r'^Section\s+\d', line, re.IGNORECASE):
                    break
                
                # Try to extract patient line: Name Date Amount
                # Date format: DD/MM/YYYY
                # Amount format: £X,XXX.XX or (£X,XXX.XX)
                patient_match = re.match(
                    r'^([A-Za-z][A-Za-z\s\'\-]+?)\s+(\d{2}/\d{2}/\d{4}).*?[\(£]?\s*([\d,]+\.?\d*)\s*\)?$',
                    line.strip()
                )
                
                if patient_match:
                    name = patient_match.group(1).strip()
                    date = patient_match.group(2)
                    amount_str = patient_match.group(3).replace(',', '')
                    
                    try:
                        amount = float(amount_str)
                        if amount > 0:  # Only include positive amounts
                            result['patients'].append({
                                'name': name,
                                'date': date,
                                'amount': amount
                            })
                    except ValueError:
                        pass
    
    except Exception as e:
        print(f"      ⚠️ PDF parse error ({filename}): {e}")
    
    return result


def build_historical_database(service, folder_id, exclude_period=None):
    """
    Build a database of all previously paid patients from historical payslips.
    
    Args:
        service: Google Drive service
        folder_id: Root folder ID containing payslip PDFs
        exclude_period: Period to exclude (e.g., "December 2025" - current month)
    
    Returns:
        {
            'dentist_name': [
                {'patient': str, 'amount': float, 'date': str, 'period': str}
            ]
        }
    """
    print("\n📂 BUILDING HISTORICAL PAYMENT DATABASE...")
    print("=" * 50)
    
    historical_db = defaultdict(list)
    
    # List all payslip PDFs
    print("   Scanning folders for payslip PDFs...")
    pdfs = list_payslip_pdfs(service, folder_id)
    print(f"   Found {len(pdfs)} payslip PDFs")
    
    # Parse each PDF
    for i, pdf_info in enumerate(pdfs):
        print(f"   Processing {i+1}/{len(pdfs)}: {pdf_info['name'][:50]}...")
        
        # Download PDF
        content = download_pdf_content(service, pdf_info['id'])
        if not content:
            continue
        
        # Parse PDF
        parsed = parse_payslip_pdf(content, pdf_info['name'], pdf_info['dentist_folder'])
        
        # Skip if current period (we're generating this one now)
        if exclude_period and parsed['period'] and exclude_period.lower() in parsed['period'].lower():
            print(f"      ⏭️ Skipping current period: {parsed['period']}")
            continue
        
        dentist = parsed.get('dentist')
        period = parsed.get('period', 'Unknown')
        
        if not dentist:
            print(f"      ⚠️ Could not determine dentist")
            continue
        
        # Normalize dentist name
        dentist_normalized = normalize_dentist_name(dentist)
        
        # Add patients to database
        for patient in parsed['patients']:
            historical_db[dentist_normalized].append({
                'patient': patient['name'],
                'amount': patient['amount'],
                'date': patient['date'],
                'period': period,
                'source_file': pdf_info['name']
            })
        
        print(f"      ✅ {dentist}: {len(parsed['patients'])} patients from {period}")
    
    # Summary
    print("\n   📊 Historical Database Summary:")
    total_records = 0
    for dentist, records in historical_db.items():
        print(f"      {dentist}: {len(records)} historical payments")
        total_records += len(records)
    print(f"   Total: {total_records} historical payment records")
    
    return dict(historical_db)


# =============================================================================
# LAB BILL PROCESSING
# =============================================================================

# Lab name variations mapping
LAB_NAME_VARIATIONS = {
    'halo': 'Halo',
    'straumann': 'Straumann',
    'invisalign': 'Invisalign',
    'priory': 'Priory',
    'scan digital': 'Scan Digital',
    'scandigital': 'Scan Digital',
    'robinsons': 'Robinsons',
    'robinson': 'Robinsons',
    'furze': 'Furze',
    'queensway': 'Queensway',
    'richley': 'Richley',
    'jordent': 'Jordent',
    'boutique': 'Boutique',
    'costech': 'Costech',
    'optadent': 'Optadent',
}

def normalize_lab_name(name):
    """Normalize lab name to standard format"""
    if not name:
        return "Unknown"
    name_lower = name.lower().strip()
    for key, value in LAB_NAME_VARIATIONS.items():
        if key in name_lower:
            return value
    return name.strip().title()


def list_lab_bill_pdfs(service, folder_id):
    """
    List all PDF files in the lab bills folder and subfolders.
    Returns list of {id, name, lab_name (from folder), modified_time}
    """
    all_pdfs = []
    
    print(f"   📁 Accessing folder ID: {folder_id}")
    
    def search_folder(fid, lab_name=None, depth=0):
        indent = "   " + "  " * depth
        query = f"'{fid}' in parents and trashed = false"
        try:
            results = service.files().list(
                q=query,
                fields="files(id, name, mimeType, modifiedTime)",
                pageSize=200
            ).execute()
        except Exception as e:
            print(f"{indent}⚠️ Error listing folder {fid}: {e}")
            return
        
        files = results.get('files', [])
        print(f"{indent}Found {len(files)} items in {'root' if not lab_name else lab_name}")
        
        for f in files:
            if f['mimeType'] == 'application/vnd.google-apps.folder':
                # It's a subfolder - use folder name as lab name
                print(f"{indent}📁 Subfolder: {f['name']}")
                search_folder(f['id'], f['name'], depth + 1)
            elif f['mimeType'] == 'application/pdf':
                all_pdfs.append({
                    'id': f['id'],
                    'name': f['name'],
                    'lab_name': normalize_lab_name(lab_name) if lab_name else "Unknown",
                    'modified_time': f.get('modifiedTime', '')
                })
                print(f"{indent}📄 PDF: {f['name'][:40]}... (Lab: {lab_name or 'Unknown'})")
    
    search_folder(folder_id)
    return all_pdfs


def parse_lab_bill_pdf(pdf_content, filename, lab_name):
    """
    Parse a lab bill PDF to extract:
    - Dentist name
    - Total amount
    - Statement date/period
    - Patient breakdown (if available)
    
    Returns:
        {
            'lab_name': str,
            'dentist': str or None,
            'total_amount': float,
            'statement_date': str,
            'patients': [{'name': str, 'amount': float}],
            'raw_text': str (for debugging)
        }
    """
    result = {
        'lab_name': lab_name,
        'dentist': None,
        'total_amount': 0,
        'statement_date': None,
        'patients': [],
        'filename': filename,
        'raw_text': ''
    }
    
    try:
        with pdfplumber.open(pdf_content) as pdf:
            text = ""
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                text += page_text + "\n"
            
            result['raw_text'] = text[:2000]  # Keep first 2000 chars for debugging
            
            # Extract dentist name - look for common patterns
            dentist_patterns = [
                r'(?:Dr\.?\s*|Doctor\s+)?(Zeeshan\s*Abbas)',
                r'(?:Dr\.?\s*|Doctor\s+)?(Peter\s*Throw)',
                r'(?:Dr\.?\s*|Doctor\s+)?(Priyanka\s*Kapoor)',
                r'(?:Dr\.?\s*|Doctor\s+)?(Moneeb\s*Ahmad)',
                r'(?:Dr\.?\s*|Doctor\s+)?(Hani\s*Dalati)',
                r'(?:Dr\.?\s*|Doctor\s+)?(Ankush\s*Patel)',
                r'(?:Dr\.?\s*|Doctor\s+)?(Hisham\s*Saqib)',
                r'Dentist[:\s]+(?:Dr\.?\s*)?([A-Z][a-z]+\s+[A-Z][a-z]+)',
                r'Prescriber[:\s]+(?:Dr\.?\s*)?([A-Z][a-z]+\s+[A-Z][a-z]+)',
                r'For[:\s]+(?:Dr\.?\s*)?([A-Z][a-z]+\s+[A-Z][a-z]+)',
            ]
            
            for pattern in dentist_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    result['dentist'] = match.group(1).strip()
                    break
            
            # Normalize dentist name if found
            if result['dentist']:
                result['dentist'] = normalize_dentist_name(result['dentist'])
            
            # Extract total amount - look for various patterns
            total_patterns = [
                r'(?:Total|Grand\s*Total|Balance\s*Due|Amount\s*Due|Invoice\s*Total)[:\s]*[£$]?\s*([\d,]+\.?\d*)',
                r'[£$]\s*([\d,]+\.\d{2})\s*(?:Total|Due|Balance)',
                r'(?:^|\s)[£$]\s*([\d,]+\.\d{2})\s*$',  # Line ending with amount
            ]
            
            amounts = []
            for pattern in total_patterns:
                matches = re.findall(pattern, text, re.IGNORECASE | re.MULTILINE)
                for m in matches:
                    try:
                        amount = float(m.replace(',', ''))
                        if amount > 0:
                            amounts.append(amount)
                    except:
                        pass
            
            # Take the largest amount found (usually the total)
            if amounts:
                result['total_amount'] = max(amounts)
            
            # Extract statement date
            date_patterns = [
                r'(?:Statement|Invoice|Date)[:\s]*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})',
                r'(?:Statement|Invoice|Date)[:\s]*(\d{1,2}\s+\w+\s+\d{4})',
                r'(\w+\s+\d{4})\s+Statement',
                r'Period[:\s]*(\w+\s+\d{4})',
            ]
            
            for pattern in date_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    result['statement_date'] = match.group(1).strip()
                    break
            
            # Try to extract patient breakdown
            # Look for lines with patient names and amounts
            patient_pattern = r'^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)[:\s]+[£$]?\s*([\d,]+\.?\d*)'
            for line in text.split('\n'):
                match = re.match(patient_pattern, line.strip())
                if match:
                    try:
                        amount = float(match.group(2).replace(',', ''))
                        if amount > 0:
                            result['patients'].append({
                                'name': match.group(1).strip(),
                                'amount': amount
                            })
                    except:
                        pass
    
    except Exception as e:
        print(f"      ⚠️ PDF parse error ({filename}): {e}")
    
    return result


def get_assigned_lab_bills(spreadsheet):
    """
    Get list of already assigned lab bill file IDs from Lab Bills Log sheet.
    Returns dict: {file_id: {dentist, amount, period, lab_name}}
    """
    assigned = {}
    
    try:
        sh = spreadsheet.worksheet("Lab Bills Log")
        data = sh.get_all_values()
        
        # Skip header rows (first 5)
        for row in data[5:]:
            if len(row) >= 6 and row[1]:  # File ID in column B
                file_id = row[1]
                assigned[file_id] = {
                    'lab_name': row[2] if len(row) > 2 else '',
                    'dentist': row[3] if len(row) > 3 else '',
                    'amount': row[4] if len(row) > 4 else '',
                    'period': row[5] if len(row) > 5 else '',
                }
    except Exception as e:
        print(f"      Note: Lab Bills Log not found or error: {e}")
    
    return assigned


def process_lab_bills(drive_service, spreadsheet, period_str, target_month, target_year):
    """
    Process lab bills from Google Drive folder.
    
    1. List all PDFs in lab bills folder
    2. Check which are already assigned
    3. Parse new PDFs to extract dentist and amount
    4. Return dict of lab bills per dentist
    
    Returns:
        {
            'dentist_name': {
                'lab_name': amount,
                ...
            }
        }
    """
    print("\n📂 PROCESSING LAB BILLS...")
    print("=" * 50)
    
    lab_bills_by_dentist = defaultdict(lambda: defaultdict(float))
    unassigned_bills = []
    new_assignments = []
    
    # Get already assigned bills
    assigned = get_assigned_lab_bills(spreadsheet)
    print(f"   Found {len(assigned)} previously assigned lab bills")
    
    # List all PDFs
    print("   Scanning lab bills folder...")
    pdfs = list_lab_bill_pdfs(drive_service, LAB_BILLS_FOLDER_ID)
    print(f"   Found {len(pdfs)} PDF files")
    
    # Process each PDF
    for pdf_info in pdfs:
        file_id = pdf_info['id']
        
        # Check if already assigned
        if file_id in assigned:
            # Add to dentist's lab bills if we have the info
            prev = assigned[file_id]
            if prev.get('dentist') and prev.get('amount'):
                try:
                    amount = float(prev['amount'].replace('£', '').replace(',', ''))
                    lab_name = prev.get('lab_name', pdf_info['lab_name'])
                    lab_bills_by_dentist[prev['dentist']][lab_name] += amount
                except:
                    pass
            continue
        
        # New bill - parse it
        print(f"   Parsing: {pdf_info['name'][:40]}...")
        
        content = download_pdf_content(drive_service, file_id)
        if not content:
            continue
        
        parsed = parse_lab_bill_pdf(content, pdf_info['name'], pdf_info['lab_name'])
        
        if parsed['dentist'] and parsed['total_amount'] > 0:
            # Successfully identified - add to dentist's bills
            dentist = parsed['dentist']
            lab_name = parsed['lab_name']
            amount = parsed['total_amount']
            
            lab_bills_by_dentist[dentist][lab_name] += amount
            
            # Track for logging
            new_assignments.append({
                'file_id': file_id,
                'filename': pdf_info['name'],
                'lab_name': lab_name,
                'dentist': dentist,
                'amount': amount,
                'statement_date': parsed.get('statement_date', ''),
                'period': period_str
            })
            
            print(f"      ✅ {dentist}: {lab_name} £{amount:,.2f}")
        
        elif parsed['total_amount'] > 0:
            # Amount found but no dentist - flag for manual assignment
            unassigned_bills.append({
                'file_id': file_id,
                'filename': pdf_info['name'],
                'lab_name': parsed['lab_name'],
                'amount': parsed['total_amount'],
                'statement_date': parsed.get('statement_date', ''),
                'raw_text_snippet': parsed.get('raw_text', '')[:500]
            })
            print(f"      ⚠️ Need dentist assignment: {parsed['lab_name']} £{parsed['total_amount']:,.2f}")
        else:
            print(f"      ⚠️ Could not parse: {pdf_info['name'][:30]}")
    
    # Update Lab Bills Log with new assignments
    if new_assignments:
        update_lab_bills_log(spreadsheet, new_assignments)
    
    # Update unassigned bills tab
    if unassigned_bills:
        update_unassigned_lab_bills(spreadsheet, unassigned_bills, period_str)
    
    # Summary
    print("\n   📊 Lab Bills Summary:")
    for dentist, labs in lab_bills_by_dentist.items():
        total = sum(labs.values())
        print(f"      {dentist}: £{total:,.2f} total ({len(labs)} labs)")
    
    if unassigned_bills:
        print(f"\n   ⚠️ {len(unassigned_bills)} bills need manual dentist assignment")
    
    return dict(lab_bills_by_dentist)


def update_lab_bills_log(spreadsheet, new_assignments):
    """Log newly assigned lab bills to prevent double-counting"""
    print("   Updating Lab Bills Log...")
    
    try:
        sh = spreadsheet.worksheet("Lab Bills Log")
    except:
        try:
            sh = spreadsheet.add_worksheet(title="Lab Bills Log", rows=1000, cols=10)
            # Add headers
            headers = [
                ["", "LAB BILLS LOG", "", "", "", "", "", "", ""],
                ["", "Tracks assigned lab bills to prevent double-counting", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", "", ""],
                ["", "File ID", "Lab Name", "Dentist", "Amount", "Period", "Filename", "Statement Date", "Added On"],
            ]
            sh.update(values=headers, range_name='A1')
            time.sleep(1)
        except Exception as e:
            print(f"      ⚠️ Cannot create Lab Bills Log: {e}")
            return
    
    # Get next row
    existing = sh.get_all_values()
    next_row = max(len(existing) + 1, 6)
    
    # Add new assignments
    rows = []
    added_on = datetime.now().strftime('%d/%m/%Y %H:%M')
    
    for bill in new_assignments:
        rows.append([
            "",
            bill['file_id'],
            bill['lab_name'],
            bill['dentist'],
            f"£{bill['amount']:,.2f}",
            bill['period'],
            bill['filename'][:50],
            bill.get('statement_date', ''),
            added_on
        ])
    
    if rows:
        sh.update(values=rows, range_name=f'A{next_row}')
        print(f"   ✅ Logged {len(rows)} new lab bill assignments")


def update_unassigned_lab_bills(spreadsheet, unassigned_bills, period_str):
    """Update tab with lab bills needing manual dentist assignment"""
    print("   Updating Unassigned Lab Bills tab...")
    
    try:
        sh = spreadsheet.worksheet("Unassigned Lab Bills")
        sh.clear()
    except:
        try:
            sh = spreadsheet.add_worksheet(title="Unassigned Lab Bills", rows=200, cols=10)
        except Exception as e:
            print(f"      ⚠️ Cannot create Unassigned Lab Bills tab: {e}")
            return
    
    rows = [
        ["", "UNASSIGNED LAB BILLS", "", "", "", "", "", "", ""],
        ["", f"Period: {period_str}", "", f"Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "⚠️ These bills could not be automatically assigned - please select dentist", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", ""],
        ["", "Filename", "Lab Name", "Amount", "Statement Date", "Assign to Dentist", "Confirm", "File ID", ""],
    ]
    
    for bill in unassigned_bills:
        rows.append([
            "",
            bill['filename'][:50],
            bill['lab_name'],
            f"£{bill['amount']:,.2f}",
            bill.get('statement_date', ''),
            "",  # Dropdown for dentist selection
            False,  # Confirm checkbox
            bill['file_id'],
            ""
        ])
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Add dentist dropdown
    if unassigned_bills:
        try:
            sheet_id = sh.id
            dentist_names = list(DENTISTS.keys())
            
            requests = []
            for i in range(len(unassigned_bills)):
                row_num = 7 + i  # Data starts at row 7
                requests.append({
                    'setDataValidation': {
                        'range': {
                            'sheetId': sheet_id,
                            'startRowIndex': row_num - 1,
                            'endRowIndex': row_num,
                            'startColumnIndex': 5,
                            'endColumnIndex': 6
                        },
                        'rule': {
                            'condition': {
                                'type': 'ONE_OF_LIST',
                                'values': [{'userEnteredValue': d} for d in dentist_names]
                            },
                            'showCustomUi': True,
                            'strict': True
                        }
                    }
                })
                # Checkbox for confirm
                requests.append({
                    'setDataValidation': {
                        'range': {
                            'sheetId': sheet_id,
                            'startRowIndex': row_num - 1,
                            'endRowIndex': row_num,
                            'startColumnIndex': 6,
                            'endColumnIndex': 7
                        },
                        'rule': {
                            'condition': {'type': 'BOOLEAN'},
                            'showCustomUi': True
                        }
                    }
                })
            
            if requests:
                spreadsheet.batch_update({'requests': requests})
        except Exception as e:
            print(f"      Note: Could not add dropdowns: {e}")
    
    print(f"   ✅ Unassigned Lab Bills tab updated ({len(unassigned_bills)} items)")


# =============================================================================
# NHS STATEMENT PROCESSING
# =============================================================================

# NHS dentists and their performer numbers from NHS statements
NHS_DENTISTS = {
    "Peter Throw": {
        "uda_rate": 16, 
        "performer_numbers": ["780995"],
        "name_patterns": ["pe throw", "peter", "throw", "p throw"]
    },
    "Priyanka Kapoor": {
        "uda_rate": 15, 
        "performer_numbers": ["112376"],
        "name_patterns": ["kapoor", "priyanka", "p kapoor"]
    },
    "Moneeb Ahmad": {
        "uda_rate": 15, 
        "performer_numbers": ["701874"],
        "name_patterns": ["m ahmad", "moneeb", "ahmad"]
    },
}


def parse_nhs_statement_pdf(pdf_content, filename):
    """
    Parse an NHS statement PDF to extract UDA data per dentist.
    
    NHS statement format:
    - "Activity for December (19/11/2025 - 17/12/2025)"
    - "Units of Dental Activity per Clinician"
    - "701874 M AHMAD"
    - "Current Financial Year 2025/26    46.20"
    
    Returns:
        {
            'period_month': str (e.g., "December"),
            'period_year': int,
            'period_range': str (e.g., "19/11/2025 - 17/12/2025"),
            'dentists': {
                'Peter Throw': {'udas': float, 'uda_rate': float, 'uda_income': float},
                ...
            },
            'filename': str,
        }
    """
    result = {
        'period_month': None,
        'period_year': None,
        'period_range': None,
        'dentists': {},
        'filename': filename,
    }
    
    try:
        with pdfplumber.open(pdf_content) as pdf:
            text = ""
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                text += page_text + "\n"
            
            # Debug: print first part of text
            print(f"      📄 PDF text preview: {text[:300]}...")
            
            # Extract period from "Activity for December (19/11/2025 - 17/12/2025)"
            period_match = re.search(
                r'Activity\s+for\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*\((\d{1,2}/\d{1,2}/\d{4})\s*-\s*(\d{1,2}/\d{1,2}/\d{4})\)',
                text, re.IGNORECASE
            )
            if period_match:
                result['period_month'] = period_match.group(1)
                start_date = period_match.group(2)
                end_date = period_match.group(3)
                result['period_range'] = f"{start_date} - {end_date}"
                # Extract year from end date
                result['period_year'] = int(end_date.split('/')[-1])
                print(f"      📅 Found period: {result['period_month']} ({result['period_range']})")
            
            # Find "Units of Dental Activity per Clinician" section
            uda_section_match = re.search(
                r'Units\s+of\s+Dental\s+Activity\s+per\s+Clinician(.+?)(?:THIS STATEMENT|PROVIDER SUMMARY|$)',
                text, re.IGNORECASE | re.DOTALL
            )
            
            if uda_section_match:
                uda_section = uda_section_match.group(1)
                print(f"      📊 Found UDA section ({len(uda_section)} chars)")
                
                # Look for each NHS dentist by performer number or name
                for dentist_name, config in NHS_DENTISTS.items():
                    udas = None
                    
                    # Try performer number first (e.g., "701874 M AHMAD")
                    for perf_num in config['performer_numbers']:
                        # Pattern: performer number, then name, then "Current Financial Year 2025/26" then number
                        pattern = rf'{perf_num}[^\n]*\n\s*Current\s+Financial\s+Year\s+\d{{4}}/\d{{2}}\s+([\d,]+\.?\d*)'
                        match = re.search(pattern, uda_section, re.IGNORECASE)
                        if match:
                            udas = float(match.group(1).replace(',', ''))
                            print(f"      ✅ Found {dentist_name} by performer #{perf_num}: {udas} UDAs")
                            break
                    
                    # Try name patterns if performer number didn't work
                    if udas is None:
                        for name_pattern in config['name_patterns']:
                            pattern = rf'{name_pattern}[^\n]*\n\s*Current\s+Financial\s+Year\s+\d{{4}}/\d{{2}}\s+([\d,]+\.?\d*)'
                            match = re.search(pattern, uda_section, re.IGNORECASE)
                            if match:
                                udas = float(match.group(1).replace(',', ''))
                                print(f"      ✅ Found {dentist_name} by name pattern: {udas} UDAs")
                                break
                    
                    if udas and udas > 0:
                        result['dentists'][dentist_name] = {
                            'udas': udas,
                            'uda_rate': config['uda_rate'],
                            'uda_income': udas * config['uda_rate']
                        }
            else:
                print(f"      ⚠️ Could not find 'Units of Dental Activity per Clinician' section")
    
    except Exception as e:
        print(f"      ⚠️ NHS statement parse error ({filename}): {e}")
        import traceback
        traceback.print_exc()
    
    return result


def get_processed_nhs_statements(spreadsheet):
    """Get list of already processed NHS statement file IDs"""
    processed = set()
    
    try:
        sh = spreadsheet.worksheet("NHS Statements Log")
        data = sh.get_all_values()
        
        # Skip header rows
        for row in data[5:]:
            if len(row) >= 2 and row[1]:
                processed.add(row[1])  # File ID in column B
    except:
        pass
    
    return processed


def process_nhs_statements(drive_service, spreadsheet, period_str, target_month, target_year):
    """
    Process NHS statements from Google Drive folder.
    
    Returns:
        {
            'dentist_name': {
                'udas': float,
                'uda_rate': float,
                'uda_income': float
            }
        }
    """
    if not NHS_STATEMENTS_FOLDER_ID:
        print("\n📋 NHS STATEMENTS: Folder not configured (NHS_STATEMENTS_FOLDER_ID)")
        return {}
    
    print("\n📋 PROCESSING NHS STATEMENTS...")
    print("=" * 50)
    
    # Get target month name
    target_month_name = datetime(target_year, target_month, 1).strftime("%B")
    print(f"   Looking for: {target_month_name} {target_year}")
    
    nhs_data = {}
    new_statements = []
    
    # Get already processed statements
    processed = get_processed_nhs_statements(spreadsheet)
    print(f"   Found {len(processed)} previously processed statements")
    
    # List all PDFs in NHS folder
    print(f"   Scanning NHS statements folder...")
    
    try:
        query = f"'{NHS_STATEMENTS_FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false"
        results = drive_service.files().list(
            q=query,
            fields="files(id, name, modifiedTime)",
            pageSize=100
        ).execute()
        
        pdfs = results.get('files', [])
        print(f"   Found {len(pdfs)} PDF files")
        
        for pdf_info in pdfs:
            file_id = pdf_info['id']
            
            if file_id in processed:
                print(f"   ⏭️ Already processed: {pdf_info['name'][:40]}")
                continue
            
            print(f"   Parsing: {pdf_info['name'][:40]}...")
            
            content = download_pdf_content(drive_service, file_id)
            if not content:
                continue
            
            parsed = parse_nhs_statement_pdf(content, pdf_info['name'])
            
            # Check if this statement is for the current period
            if parsed['period_month'] and parsed['period_year']:
                # Match month name (case-insensitive) and year
                if (parsed['period_month'].lower() == target_month_name.lower() and 
                    parsed['period_year'] == target_year):
                    
                    print(f"      ✅ Period matches: {parsed['period_month']} {parsed['period_year']}")
                    
                    # This is for the current period
                    for dentist, data in parsed['dentists'].items():
                        # Include the NHS period range in the data
                        data['nhs_period'] = parsed.get('period_range', '')
                        nhs_data[dentist] = data
                        print(f"      💰 {dentist}: {data['udas']} UDAs × £{data['uda_rate']} = £{data['uda_income']:,.2f}")
                    
                    new_statements.append({
                        'file_id': file_id,
                        'filename': pdf_info['name'],
                        'period': f"{parsed['period_month']} {parsed['period_year']}",
                        'dentists': parsed['dentists']
                    })
                else:
                    print(f"      ⏭️ Different period: {parsed['period_month']} {parsed['period_year']} (looking for {target_month_name} {target_year})")
            else:
                print(f"      ⚠️ Could not determine period from PDF")
        
        # Log new statements
        if new_statements:
            update_nhs_statements_log(spreadsheet, new_statements, period_str)
    
    except Exception as e:
        print(f"   ⚠️ NHS statement processing error: {e}")
        import traceback
        traceback.print_exc()
    
    # Summary
    if nhs_data:
        print("\n   📊 NHS Summary:")
        total_nhs = 0
        for dentist, data in nhs_data.items():
            print(f"      {dentist}: {data['udas']} UDAs × £{data['uda_rate']} = £{data['uda_income']:,.2f}")
            total_nhs += data['uda_income']
        print(f"      TOTAL NHS: £{total_nhs:,.2f}")
    else:
        print("   ℹ️ No NHS data found for this period")
    
    return nhs_data


def update_nhs_statements_log(spreadsheet, new_statements, period_str):
    """Log processed NHS statements"""
    print("   Updating NHS Statements Log...")
    
    try:
        sh = spreadsheet.worksheet("NHS Statements Log")
    except:
        try:
            sh = spreadsheet.add_worksheet(title="NHS Statements Log", rows=500, cols=10)
            headers = [
                ["", "NHS STATEMENTS LOG", "", "", "", "", "", "", "", ""],
                ["", "Tracks processed NHS statements", "", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", "", "", ""],
                ["", "File ID", "Filename", "Period", "Peter UDAs", "Peter £", "Priyanka UDAs", "Priyanka £", "Moneeb UDAs", "Moneeb £"],
            ]
            sh.update(values=headers, range_name='A1')
            time.sleep(1)
        except Exception as e:
            print(f"      ⚠️ Cannot create NHS Statements Log: {e}")
            return
    
    # Get next row
    existing = sh.get_all_values()
    next_row = max(len(existing) + 1, 6)
    
    rows = []
    for stmt in new_statements:
        peter = stmt['dentists'].get('Peter Throw', {})
        priyanka = stmt['dentists'].get('Priyanka Kapoor', {})
        moneeb = stmt['dentists'].get('Moneeb Ahmad', {})
        
        rows.append([
            "",
            stmt['file_id'],
            stmt['filename'][:50],
            stmt['period'],
            peter.get('udas', ''),
            f"£{peter.get('uda_income', 0):,.2f}" if peter else '',
            priyanka.get('udas', ''),
            f"£{priyanka.get('uda_income', 0):,.2f}" if priyanka else '',
            moneeb.get('udas', ''),
            f"£{moneeb.get('uda_income', 0):,.2f}" if moneeb else '',
        ])
    
    if rows:
        sh.update(values=rows, range_name=f'A{next_row}')
        print(f"   ✅ Logged {len(rows)} NHS statements")


def normalize_dentist_name(name):
    """Normalize dentist name for matching"""
    if not name:
        return ""
    # Remove Dr., titles, extra spaces
    name = re.sub(r'^(Dr\.?\s*)', '', name, flags=re.IGNORECASE)
    name = name.strip()
    
    # Map common variations
    name_map = {
        'zee': 'Zeeshan Abbas',
        'zeeshan': 'Zeeshan Abbas',
        'peter': 'Peter Throw',
        'priyanka': 'Priyanka Kapoor',
        'moneeb': 'Moneeb Ahmad',
        'hani': 'Hani Dalati',
        'ankush': 'Ankush Patel',
        'hisham': 'Hisham Saqib',
    }
    
    for key, value in name_map.items():
        if key in name.lower():
            return value
    
    return name


def check_for_duplicates(current_patients, historical_db, dentist_name, current_period):
    """
    Check if any current patients were already paid in previous periods.
    
    Args:
        current_patients: List of current month's patients
        historical_db: Historical payment database
        dentist_name: Current dentist name
        current_period: Current period string (e.g., "December 2025")
    
    Returns:
        List of potential duplicates with details
    """
    duplicates = []
    
    # Get historical records for this dentist
    dentist_normalized = normalize_dentist_name(dentist_name)
    historical = historical_db.get(dentist_normalized, [])
    
    if not historical:
        return duplicates
    
    # Build lookup by patient name (normalized)
    historical_lookup = defaultdict(list)
    for h in historical:
        patient_normalized = normalize_name(h['patient'])
        historical_lookup[patient_normalized].append(h)
    
    # Check each current patient
    for cp in current_patients:
        cp_name_normalized = normalize_name(cp['name'])
        cp_amount = cp.get('amount', 0)
        
        # Look for matches in historical data
        if cp_name_normalized in historical_lookup:
            for hist in historical_lookup[cp_name_normalized]:
                # Check if same amount (potential duplicate)
                if abs(hist['amount'] - cp_amount) < 1:  # Within £1
                    duplicates.append({
                        'patient': cp['name'],
                        'dentist': dentist_name,
                        'current_amount': cp_amount,
                        'current_date': cp.get('date', ''),
                        'previous_amount': hist['amount'],
                        'previous_period': hist['period'],
                        'previous_date': hist['date'],
                        'source_file': hist.get('source_file', ''),
                        'match_type': 'EXACT_AMOUNT',
                        'status': '⚠️ POTENTIAL DUPLICATE'
                    })
                elif abs(hist['amount'] - cp_amount) < cp_amount * 0.1:  # Within 10%
                    duplicates.append({
                        'patient': cp['name'],
                        'dentist': dentist_name,
                        'current_amount': cp_amount,
                        'current_date': cp.get('date', ''),
                        'previous_amount': hist['amount'],
                        'previous_period': hist['period'],
                        'previous_date': hist['date'],
                        'source_file': hist.get('source_file', ''),
                        'match_type': 'SIMILAR_AMOUNT',
                        'status': '🔍 CHECK'
                    })
    
    return duplicates


def perform_4way_reconciliation(payslips, historical_db, xref_results, period_str):
    """
    Perform 4-way reconciliation for each patient:
    1. Previous payslips - what was already paid historically
    2. Current Dentally invoice - what's being claimed now
    3. Private takings log - what dentist recorded
    4. Total paid by patient - cumulative payments
    
    Returns:
        Dict of reconciliation results per dentist with discrepancies flagged
    """
    print("\n🔄 PERFORMING 4-WAY RECONCILIATION...")
    print("=" * 50)
    
    reconciliation = {}
    
    for dentist_name, payslip in payslips.items():
        dentist_recon = {
            'patients': [],
            'total_previously_paid': 0,
            'total_current_claim': 0,
            'total_in_log': 0,
            'discrepancies': []
        }
        
        dentist_normalized = normalize_dentist_name(dentist_name)
        historical = historical_db.get(dentist_normalized, [])
        xref = xref_results.get(dentist_name, {}) if xref_results else {}
        
        # Build historical lookup by patient
        hist_by_patient = defaultdict(lambda: {'total_paid': 0, 'payments': []})
        for h in historical:
            patient_norm = normalize_name(h['patient'])
            hist_by_patient[patient_norm]['total_paid'] += h['amount']
            hist_by_patient[patient_norm]['payments'].append({
                'amount': h['amount'],
                'period': h['period'],
                'date': h['date']
            })
        
        # Build log lookup by patient (from xref)
        log_by_patient = {}
        if xref and 'matched' in xref:
            for m in xref.get('matched', []):
                patient_norm = normalize_name(m.get('patient', ''))
                log_by_patient[patient_norm] = m.get('log_amount', 0)
        if xref and 'log_only' in xref:
            for m in xref.get('log_only', []):
                patient_norm = normalize_name(m.get('patient', ''))
                log_by_patient[patient_norm] = m.get('amount', 0)
        
        # Reconcile each current patient
        for patient in payslip.get('patients', []):
            patient_name = patient.get('name', '')
            patient_norm = normalize_name(patient_name)
            current_amount = patient.get('paid_amount', patient.get('amount', 0))
            
            # Get historical total for this patient
            hist_data = hist_by_patient.get(patient_norm, {'total_paid': 0, 'payments': []})
            previously_paid = hist_data['total_paid']
            
            # Get log amount
            log_amount = log_by_patient.get(patient_norm, 0)
            
            # Calculate cumulative
            cumulative_with_current = previously_paid + current_amount
            
            # Check for discrepancies
            discrepancy = None
            status = '✅'
            
            if previously_paid > 0 and abs(current_amount - previously_paid) < 1:
                # Exact same amount paid before - likely duplicate
                discrepancy = f"⚠️ DUPLICATE? Same amount (£{previously_paid:,.2f}) paid in previous period"
                status = '⚠️ DUPLICATE'
            elif previously_paid > 0 and current_amount > 0:
                # Patient has been paid before - verify this is additional work
                discrepancy = f"🔍 Previously paid £{previously_paid:,.2f} - verify this is new work"
                status = '🔍 CHECK'
            elif log_amount > 0 and abs(log_amount - current_amount) > 10:
                # Mismatch between log and claim
                discrepancy = f"📊 Log shows £{log_amount:,.2f}, claiming £{current_amount:,.2f}"
                status = '📊 MISMATCH'
            
            patient_recon = {
                'patient': patient_name,
                'current_claim': current_amount,
                'previously_paid': previously_paid,
                'log_amount': log_amount,
                'cumulative_total': cumulative_with_current,
                'status': status,
                'discrepancy': discrepancy,
                'previous_payments': hist_data['payments'][-3:] if hist_data['payments'] else []  # Last 3
            }
            
            dentist_recon['patients'].append(patient_recon)
            dentist_recon['total_current_claim'] += current_amount
            dentist_recon['total_previously_paid'] += previously_paid
            dentist_recon['total_in_log'] += log_amount
            
            if discrepancy:
                dentist_recon['discrepancies'].append(patient_recon)
        
        reconciliation[dentist_name] = dentist_recon
        
        # Print summary
        disc_count = len(dentist_recon['discrepancies'])
        if disc_count > 0:
            print(f"   ⚠️ {dentist_name}: {disc_count} items need review")
        else:
            print(f"   ✅ {dentist_name}: All reconciled")
    
    return reconciliation


def update_reconciliation_tab(spreadsheet, reconciliation, period_str):
    """Update a Reconciliation tab with 4-way comparison results"""
    print("   Updating Reconciliation tab...")
    
    try:
        sh = spreadsheet.worksheet("Reconciliation")
        sh.clear()
    except:
        try:
            sh = spreadsheet.add_worksheet(title="Reconciliation", rows=500, cols=12)
        except Exception as e:
            print(f"      ⚠️ Cannot create Reconciliation tab: {e}")
            return
    
    rows = [
        ["", "4-WAY RECONCILIATION REPORT", "", "", "", "", "", "", "", "", "", ""],
        ["", f"Period: {period_str}", "", f"Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Compares: Previous Payslips | Current Claim | Private Log | Cumulative Total", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", ""],
    ]
    
    for dentist_name, recon in reconciliation.items():
        # Dentist header
        rows.append(["", f"═══ {dentist_name.upper()} ═══", "", "", "", "", "", "", "", "", "", ""])
        rows.append(["", f"Current Claim: £{recon['total_current_claim']:,.2f}", "", 
                    f"Previously Paid: £{recon['total_previously_paid']:,.2f}", "",
                    f"In Log: £{recon['total_in_log']:,.2f}", "", "", "", "", "", ""])
        rows.append(["", "", "", "", "", "", "", "", "", "", "", ""])
        
        # Discrepancies first
        if recon['discrepancies']:
            rows.append(["", "⚠️ ITEMS NEEDING REVIEW", "", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "Patient", "Current £", "Previously Paid £", "Log £", "Cumulative £", "Status", "Issue", "", "", "", ""])
            
            for p in recon['discrepancies']:
                rows.append([
                    "",
                    p['patient'],
                    f"£{p['current_claim']:,.2f}",
                    f"£{p['previously_paid']:,.2f}" if p['previously_paid'] > 0 else "-",
                    f"£{p['log_amount']:,.2f}" if p['log_amount'] > 0 else "-",
                    f"£{p['cumulative_total']:,.2f}",
                    p['status'],
                    p['discrepancy'] or "",
                    "", "", "", ""
                ])
            rows.append(["", "", "", "", "", "", "", "", "", "", "", ""])
        
        # Summary of all patients
        rows.append(["", "All Patients", "", "", "", "", "", "", "", "", "", ""])
        rows.append(["", "Patient", "Current £", "Prev Paid £", "Log £", "Cumulative £", "Status", "", "", "", "", ""])
        
        for p in recon['patients'][:50]:  # Limit to 50
            rows.append([
                "",
                p['patient'][:30],
                f"£{p['current_claim']:,.2f}",
                f"£{p['previously_paid']:,.2f}" if p['previously_paid'] > 0 else "-",
                f"£{p['log_amount']:,.2f}" if p['log_amount'] > 0 else "-",
                f"£{p['cumulative_total']:,.2f}",
                p['status'],
                "", "", "", "", ""
            ])
        
        if len(recon['patients']) > 50:
            rows.append(["", f"... and {len(recon['patients']) - 50} more patients", "", "", "", "", "", "", "", "", "", ""])
        
        rows.append(["", "", "", "", "", "", "", "", "", "", "", ""])
        rows.append(["", "─" * 80, "", "", "", "", "", "", "", "", "", ""])
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Formatting
    sh.format('B1', {'textFormat': {'bold': True, 'fontSize': 16}})
    
    print(f"   ✅ Reconciliation tab updated")


def update_duplicate_check_tab(spreadsheet, duplicates, period_str):
    """Update the Duplicate Check tab with potential duplicates"""
    print("   Updating Duplicate Check tab...")
    
    try:
        sh = spreadsheet.worksheet("Duplicate Check")
        sh.clear()
    except:
        try:
            sh = spreadsheet.add_worksheet(title="Duplicate Check", rows=200, cols=12)
        except Exception as e:
            print(f"      ⚠️ Cannot create Duplicate Check tab: {e}")
            return
    
    rows = [
        ["", "🔍 DUPLICATE CHECK", "", "", "", "", "", "", "", ""],
        ["", f"Period: {period_str}", "", f"Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", ""],
        ["", "Checks current payslip patients against historical payments", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", ""],
        ["", "Patient", "Dentist", "Current £", "Current Date", "Previous £", "Previous Period", "Previous Date", "Match Type", "Status"],
    ]
    
    if duplicates:
        for dup in duplicates:
            rows.append([
                "",
                dup['patient'],
                dup['dentist'],
                f"£{dup['current_amount']:,.2f}",
                dup['current_date'],
                f"£{dup['previous_amount']:,.2f}",
                dup['previous_period'],
                dup['previous_date'],
                dup['match_type'],
                dup['status']
            ])
    else:
        rows.append(["", "✅ No potential duplicates found", "", "", "", "", "", "", "", ""])
    
    sh.update(values=rows, range_name='A1')
    time.sleep(1)
    
    # Formatting
    sh.format('B1', {'textFormat': {'bold': True, 'fontSize': 16}})
    sh.format('B6:J6', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 1.0, 'green': 0.9, 'blue': 0.6}
    })
    
    print(f"   ✅ Duplicate Check tab updated ({len(duplicates)} potential duplicates)")


def update_paid_invoices_log(spreadsheet, payslips, period_str):
    """
    Log all paid invoices for future duplicate detection.
    This creates a running log of invoice_id -> payment record.
    """
    print("   Updating Paid Invoices log...")
    
    try:
        sh = spreadsheet.worksheet("Paid Invoices")
    except:
        try:
            sh = spreadsheet.add_worksheet(title="Paid Invoices", rows=5000, cols=8)
            # Add headers
            sh.update(values=[["Invoice ID", "Patient", "Dentist", "Amount", "Date", "Period", "Added On", "Treatment"]], range_name='A1')
            sh.format('A1:H1', {'textFormat': {'bold': True}})
        except Exception as e:
            print(f"      ⚠️ Cannot create Paid Invoices tab: {e}")
            return
    
    # Get existing data to find next empty row
    existing = sh.get_all_values()
    next_row = len(existing) + 1
    
    # Collect all new invoice records
    new_records = []
    added_on = datetime.now().strftime('%d/%m/%Y %H:%M')
    
    for dentist_name, payslip in payslips.items():
        for patient in payslip.get('patients', []):
            invoice_id = patient.get('invoice_id', '')
            new_records.append([
                str(invoice_id),
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
    
    print(f"   ✅ Logged {len(new_records)} invoices to Paid Invoices")

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



# =============================================================================
# SHEET FORMATTING COLORS (v3.0 - Consistent styling)
# =============================================================================

SHEET_COLORS = {
    'primary': {'red': 0.1, 'green': 0.1, 'blue': 0.1},
    'white': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
    'off_white': {'red': 0.98, 'green': 0.98, 'blue': 0.98},
    'light_gray': {'red': 0.95, 'green': 0.95, 'blue': 0.95},
    'medium_gray': {'red': 0.85, 'green': 0.85, 'blue': 0.85},
    'border_gray': {'red': 0.75, 'green': 0.75, 'blue': 0.75},
    'success': {'red': 0.85, 'green': 0.95, 'blue': 0.85},
    'success_dark': {'red': 0.13, 'green': 0.55, 'blue': 0.13},
    'warning_bg': {'red': 1.0, 'green': 0.95, 'blue': 0.8},
    'warning_text': {'red': 0.7, 'green': 0.5, 'blue': 0.0},
}


def update_dashboard(spreadsheet, payslips, period_str):
    """
    Update the Dashboard tab with CONSISTENT font sizing (v3.0)
    - All data: 10pt
    - Title: 16pt
    - Section headers: 12pt
    """
    print("   Updating Dashboard...")
    
    try:
        sh = spreadsheet.worksheet("Dashboard")
    except:
        return
    
    # Update period and date
    sh.update_acell('D6', period_str)
    sh.update_acell('J6', datetime.now().strftime('%d/%m/%Y'))
    
    # Collect all row data
    all_rows = []
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
            all_rows.append(row_data)
            
            if DENTISTS[name]['has_nhs']:
                total_nhs += p.get('uda_income', 0)
            total_private_gross += p['gross_total']
            total_private_net += p['net_private']
            total_deductions += p['total_deductions']
            total_net_pay += p['total_payment']
        else:
            all_rows.append([""] * 14)
    
    # Add totals row
    all_rows.append([])
    all_rows.append([
        "", "TOTAL", "", "",
        f"£{total_nhs:,.2f}",
        f"£{total_private_gross:,.2f}",
        "",
        f"£{total_private_net:,.2f}",
        "", "", "",
        f"£{total_deductions:,.2f}",
        f"£{total_net_pay:,.2f}",
        ""
    ])
    
    # Batch update all rows
    sh.update(values=all_rows, range_name='A10')
    time.sleep(1)


def update_dentist_payslip(spreadsheet, dentist_name, payslip, period_str):
    """
    Update individual dentist payslip tab - v3.0 matching Zee Payslip template
    
    Layout:
    - Row 1: Logo (80x80 - 1:1 ratio)
    - Rows 2-6: Info (Payslip Date, Private Period, Performer, Practice, Superannuation)
    - Row 8: Section 1: Private Fees header
    - Rows 9-12: Gross Private by Dentist/Therapist, Total, Subtotal
    - Row 14: Section 2: Deductions header
    - Rows 15-27: Labs breakdown, Finance, Therapy
    - Row 28: Total Deductions (green)
    - Row 30: Total Payment (green)
    - Row 32+: Patient Breakdown
    - Bottom: Discrepancies section
    """
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    # Delete and recreate sheet
    try:
        old_sheet = spreadsheet.worksheet(tab_name)
        spreadsheet.del_worksheet(old_sheet)
    except:
        pass
    
    sh = spreadsheet.add_worksheet(tab_name, 300, 8)
    
    config = DENTISTS[dentist_name]
    
    # Calculate payment date (15th of following month)
    try:
        period_date = datetime.strptime(period_str, "%B %Y")
        if period_date.month == 12:
            payment_date = datetime(period_date.year + 1, 1, 15)
        else:
            payment_date = datetime(period_date.year, period_date.month + 1, 15)
        payment_str = payment_date.strftime("%dth %B %Y")
    except:
        payment_str = "15th of following month"
    
    split_pct = int(config['split'] * 100)
    split_str = f"{split_pct}%"
    
    # Get lab bills breakdown
    lab_bills = payslip.get('lab_bills', {})
    lab_halo = lab_bills.get('Halo', 0)
    lab_straumann = lab_bills.get('Straumann', 0)
    lab_invisalign = lab_bills.get('Invisalign', 0)
    lab_priory = lab_bills.get('Priory', 0)
    lab_scan = lab_bills.get('Scan Digital', 0)
    lab_robinsons = lab_bills.get('Robinsons', 0)
    
    patients = payslip.get('patients', [])
    num_patients = len(patients)
    
    # ============================================
    # BUILD SHEET DATA
    # ============================================
    
    rows = []
    
    # Row 1: Logo (80x80 for 1:1 ratio)
    rows.append(["", "", "", "", "", "", f'=IMAGE("{LOGO_URL}", 4, 80, 80)', ""])
    
    # Rows 2-6: Info section
    rows.append(["", "Payslip Date:", payment_str, "", "", "", "", ""])
    rows.append(["", "Private Period:", period_str, "", "", "", "", ""])
    rows.append(["", "Performer:", config['display_name'], "", "", "", "", ""])
    rows.append(["", "Practice:", PRACTICE_NAME, "", "", "", "", ""])
    
    # Show NHS period for NHS dentists
    nhs_period = payslip.get('nhs_period', '')
    if dentist_name in NHS_DENTISTS and nhs_period:
        rows.append(["", "NHS Period:", nhs_period, "", "", "", "", ""])
    
    rows.append(["", "Superannuation Status:", "Opted Out", "", "", "", "", ""])
    
    rows.append(["", "", "", "", "", "", "", ""])  # Row 7 spacer
    
    # Row 8: Section 1 header
    rows.append(["", "Section 1: Private Fees", "", "", "", "", "", ""])
    
    # Rows 9-12: Private fees detail
    rows.append(["", "", "", "", "Gross Private by Dentist", "", payslip.get('gross_private_dentist', 0), ""])
    rows.append(["", "", "", "", "Gross Private by Therapist", "", payslip.get('gross_private_therapist', 0), ""])
    rows.append(["", "", "", "", "Gross Total", "", payslip.get('gross_total', 0), ""])
    rows.append(["", "Subtotal", "", "", split_str, "", payslip.get('net_private', 0), ""])  # Row 12
    
    rows.append(["", "", "", "", "", "", "", ""])  # Row 13 spacer
    
    # NHS Section (only for NHS dentists: Peter, Priyanka, Moneeb)
    nhs_income = payslip.get('nhs_income', 0)
    nhs_udas = payslip.get('nhs_udas', 0)
    nhs_uda_rate = payslip.get('nhs_uda_rate', 0)
    
    if nhs_income > 0 or dentist_name in NHS_DENTISTS:
        rows.append(["", "Section 1b: NHS Income", "", "", "", "", "", ""])
        rows.append(["", "", "", "", "UDAs Achieved", nhs_udas if nhs_udas else "Enter manually", "", ""])
        rows.append(["", "", "", "", "UDA Rate (£ per UDA)", nhs_uda_rate if nhs_uda_rate else "15/16", "", ""])
        rows.append(["", "NHS Total", "", "", "", "", nhs_income if nhs_income else 0, ""])
        rows.append(["", "", "", "", "", "", "", ""])  # spacer
    
    # Row 14: Section 2 header
    rows.append(["", "Section 2: Deductions", "", "", "", "", "", ""])
    
    # Labs breakdown (rows 15-22)
    rows.append(["", "", "", "", "", "Halo", lab_halo if lab_halo else "", ""])
    rows.append(["", "", "", "", "", "Straumann", lab_straumann if lab_straumann else "", ""])
    rows.append(["", "", "", "Labs", "", "Invisalign", lab_invisalign if lab_invisalign else "", ""])
    rows.append(["", "", "", "", "", "Priory", lab_priory if lab_priory else "", ""])
    rows.append(["", "", "", "", "", "Scan Digital", lab_scan if lab_scan else "", ""])
    rows.append(["", "", "", "", "", "Robinsons", lab_robinsons if lab_robinsons else "", ""])
    rows.append(["", "", "", "", "", "Lab Bills Total", payslip.get('lab_bills_total', 0), ""])
    rows.append(["", "", "", "", "", "Lab Bills 50%", payslip.get('lab_bills_50', 0), ""])
    
    rows.append(["", "", "", "", "", "", "", ""])  # spacer
    
    # Finance fees
    rows.append(["", "", "", "Finance Fees", "", "", payslip.get('finance_fees_total', 0), ""])
    rows.append(["", "", "", "50%", "", "", payslip.get('finance_fees_50', 0), ""])
    
    rows.append(["", "", "", "", "", "", "", ""])  # spacer
    
    # Therapy
    therapy_mins = payslip.get('therapy_minutes', 0)
    rows.append(["", "", "", "Therapy", f"Taryn ({therapy_mins} mins)", "", payslip.get('therapy_total', 0), ""])
    
    # Total Deductions
    total_ded_row = len(rows) + 1
    rows.append(["", "Total Deductions", "", "", "", "", payslip.get('total_deductions', 0), ""])
    
    rows.append(["", "", "", "", "", "", "", ""])  # spacer
    
    # Total Payment (Private + NHS - Deductions)
    nhs_income = payslip.get('nhs_income', 0)
    private_net = payslip.get('net_private', 0)
    deductions = payslip.get('total_deductions', 0)
    total_payment = private_net + nhs_income - deductions
    
    total_pay_row = len(rows) + 1
    if nhs_income > 0:
        rows.append(["", "Private Net", "", "", "", "", payslip.get('net_private', 0), ""])
        rows.append(["", "NHS Income", "", "", "", "", nhs_income, ""])
        rows.append(["", "Less Deductions", "", "", "", "", -deductions, ""])
        total_pay_row = len(rows) + 1
        rows.append(["", "TOTAL PAYMENT", "", "", "", "", total_payment, ""])
    else:
        rows.append(["", "Total Payment", "", "", "", "", payslip.get('total_payment', 0), ""])
    
    rows.append(["", "", "", "", "", "", "", ""])
    rows.append(["", "", "", "", "", "", "", ""])
    
    # Patient Breakdown section
    patient_header_row = len(rows) + 1
    rows.append(["", "Patient Breakdown", "", "", "", "", "", ""])
    
    rows.append(["", "", "", "", "", "", "", ""])
    
    # Patient column headers
    patient_col_row = len(rows) + 1
    rows.append(["", "Patient Name", "Date", "Status", "Amount", "", "", ""])
    
    # Patient data rows
    patient_start_row = len(rows) + 1
    for patient in patients:
        status = "✅" if not patient.get('payment_flag') else "⚠️ Not matched"
        rows.append([
            "",
            patient.get('name', ''),
            patient.get('date', ''),
            status,
            patient.get('paid_amount', patient.get('amount', 0)),
            "",
            "",
            ""
        ])
    patient_end_row = len(rows)
    
    rows.append(["", "", "", "", "", "", "", ""])
    
    # Write all data (discrepancies section added separately by update_payslip_discrepancies)
    sh.update(values=rows, range_name='A1', value_input_option='USER_ENTERED')
    
    # Track the row where discrepancies should start
    discrep_header_row = len(rows) + 3  # Leave space for discrepancies to be added later
    
    # ============================================
    # APPLY FORMATTING
    # ============================================
    
    sheet_id = sh.id
    
    format_requests = [
        # Base font - 10pt Arial
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id},
                'cell': {'userEnteredFormat': {'textFormat': {'fontFamily': 'Arial', 'fontSize': 10}}},
                'fields': 'userEnteredFormat.textFormat'
            }
        },
        
        # Column widths
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 30}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 200}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 120}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 4}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 4, 'endIndex': 5}, 'properties': {'pixelSize': 180}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 5, 'endIndex': 6}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 6, 'endIndex': 7}, 'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 7, 'endIndex': 8}, 'properties': {'pixelSize': 120}, 'fields': 'pixelSize'}},
        
        # Row 1 height for logo (80px for 1:1 ratio)
        {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 80}, 'fields': 'pixelSize'}},
        
        # Info labels bold (B2-B6)
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 1, 'endRowIndex': 6, 'startColumnIndex': 1, 'endColumnIndex': 2},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True}}}, 'fields': 'userEnteredFormat.textFormat'}},
        
        # Section 1 header (row 8) - bold with border
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 7, 'endRowIndex': 8, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True}, 
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['border_gray']}}}},
            'fields': 'userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Subtotal row (row 12) - green highlight
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 11, 'endRowIndex': 12, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'backgroundColor': SHEET_COLORS['success'],
                'textFormat': {'bold': True, 'foregroundColor': SHEET_COLORS['success_dark']},
                'borders': {'top': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['success_dark']}, 
                           'bottom': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['success_dark']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Section 2 header (row 14) - bold with border
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 13, 'endRowIndex': 14, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True},
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['border_gray']}}}},
            'fields': 'userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Total Deductions row - green highlight
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': total_ded_row - 1, 'endRowIndex': total_ded_row, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'backgroundColor': SHEET_COLORS['success'],
                'textFormat': {'bold': True, 'foregroundColor': SHEET_COLORS['success_dark']},
                'borders': {'top': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['success_dark']}, 
                           'bottom': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['success_dark']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Total Payment row - green highlight, larger font
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': total_pay_row - 1, 'endRowIndex': total_pay_row, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {
                'backgroundColor': SHEET_COLORS['success'],
                'textFormat': {'bold': True, 'fontSize': 11, 'foregroundColor': SHEET_COLORS['success_dark']},
                'borders': {'top': {'style': 'SOLID', 'width': 2, 'color': SHEET_COLORS['success_dark']}, 
                           'bottom': {'style': 'SOLID', 'width': 2, 'color': SHEET_COLORS['success_dark']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Patient Breakdown header
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': patient_header_row - 1, 'endRowIndex': patient_header_row, 'startColumnIndex': 1, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {'textFormat': {'bold': True},
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['border_gray']}}}},
            'fields': 'userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Patient column headers - gray background
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': patient_col_row - 1, 'endRowIndex': patient_col_row, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {
                'backgroundColor': SHEET_COLORS['light_gray'],
                'textFormat': {'bold': True},
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['medium_gray']}}}},
            'fields': 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.borders'}},
        
        # Patient rows - light border between each
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': patient_start_row - 1, 'endRowIndex': patient_end_row, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {
                'borders': {'bottom': {'style': 'SOLID', 'width': 1, 'color': SHEET_COLORS['light_gray']}}}},
            'fields': 'userEnteredFormat.borders'}},
        
        # Amount column G - currency format (for fees section)
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 8, 'endRowIndex': patient_end_row + 10, 'startColumnIndex': 6, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
            'fields': 'userEnteredFormat.numberFormat'}},
        
        # Amount column E - currency format (for patient breakdown only, not the fees section)
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': patient_start_row - 1, 'endRowIndex': patient_end_row, 'startColumnIndex': 4, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
            'fields': 'userEnteredFormat.numberFormat'}},
    ]
    
    try:
        spreadsheet.batch_update({'requests': format_requests})
    except Exception as e:
        print(f"      Note: Formatting error: {e}")


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
        time.sleep(1)  # Rate limit protection


def read_confirmed_adjustments(spreadsheet, dentist_name):
    """
    Read confirmed discrepancy adjustments from a dentist's payslip sheet.
    Returns list of adjustments to apply.
    
    Looks for rows in the discrepancies section where:
    - Action dropdown has a value
    - Confirm checkbox is TRUE
    
    Returns: [
        {'action': 'Add to Pay'|'Remove from Pay'|'Update Amount', 
         'patient': str, 'amount': float, 'new_amount': float}
    ]
    """
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    adjustments = []
    
    try:
        sh = spreadsheet.worksheet(tab_name)
        data = sh.get_all_values()
        
        in_discrepancies = False
        
        for row in data:
            # Check if we're in discrepancies section
            if len(row) > 1 and "DISCREPANCIES TO REVIEW" in str(row[1]):
                in_discrepancies = True
                continue
            
            if not in_discrepancies:
                continue
            
            # Look for rows with confirmed adjustments
            # Structure: ["", Patient, Date, Amount, New £, Action, Confirm, ...]
            if len(row) >= 7:
                patient = str(row[1]).strip()
                action = str(row[5]).strip()
                confirm = str(row[6]).strip().upper()
                
                # Check if confirmed (TRUE or checkbox checked)
                if confirm in ['TRUE', 'YES', '✓', '☑']:
                    if action in ['Add to Pay', 'Remove from Pay', 'Update Amount']:
                        # Parse amounts
                        amount = 0
                        new_amount = 0
                        
                        try:
                            amount_str = str(row[3]).replace('£', '').replace(',', '').strip()
                            if amount_str and amount_str not in ['-', '']:
                                amount = float(amount_str)
                        except:
                            pass
                        
                        try:
                            new_amount_str = str(row[4]).replace('£', '').replace(',', '').strip()
                            if new_amount_str and new_amount_str not in ['-', '']:
                                new_amount = float(new_amount_str)
                        except:
                            pass
                        
                        if patient and (amount > 0 or new_amount > 0):
                            adjustments.append({
                                'action': action,
                                'patient': patient,
                                'amount': amount,
                                'new_amount': new_amount
                            })
                            print(f"      Found adjustment: {action} - {patient}: £{amount} → £{new_amount}")
    
    except Exception as e:
        print(f"   Note: Could not read adjustments for {dentist_name}: {e}")
    
    return adjustments


def apply_adjustments_to_payslip(payslip, adjustments, dentist_name):
    """
    Apply confirmed discrepancy adjustments to a payslip.
    
    - Add to Pay: Add amount to gross total
    - Remove from Pay: Subtract amount from gross total
    - Update Amount: Replace old amount with new amount
    """
    if not adjustments:
        return payslip
    
    config = DENTISTS.get(dentist_name, {})
    split = config.get('split', 0.5)
    
    print(f"   Applying {len(adjustments)} adjustments to {dentist_name}...")
    
    for adj in adjustments:
        action = adj['action']
        amount = adj['amount']
        new_amount = adj['new_amount']
        
        if action == 'Add to Pay':
            # Add new amount to gross (use new_amount if provided, else amount)
            add_amount = new_amount if new_amount > 0 else amount
            payslip['gross_private_dentist'] += add_amount
            print(f"      + Adding £{add_amount:,.2f} ({adj['patient']})")
        
        elif action == 'Remove from Pay':
            # Subtract amount from gross
            payslip['gross_private_dentist'] -= amount
            print(f"      - Removing £{amount:,.2f} ({adj['patient']})")
        
        elif action == 'Update Amount':
            # Replace: subtract old amount, add new amount
            if amount > 0 and new_amount > 0:
                diff = new_amount - amount
                payslip['gross_private_dentist'] += diff
                print(f"      ~ Updating £{amount:,.2f} → £{new_amount:,.2f} ({adj['patient']})")
    
    # Recalculate all downstream figures
    payslip['gross_total'] = payslip['gross_private_dentist'] + payslip['gross_private_therapist']
    payslip['net_private'] = payslip['gross_total'] * split
    payslip['total_deductions'] = (
        payslip['lab_bills_50'] +
        payslip['finance_fees_50'] +
        payslip['therapy_total']
    )
    payslip['total_payment'] = payslip['net_private'] - payslip['total_deductions']
    
    return payslip


def update_payslip_discrepancies(spreadsheet, dentist_name, xref):
    """
    Add discrepancies section to individual dentist payslip.
    New format with action dropdown and confirm button.
    
    Columns: Patient Name | Date | Amount | New £ | Action | Confirm
    Actions: Add to Pay, Remove from Pay, Update Amount
    """
    first_name = dentist_name.split()[0]
    tab_name = f"{first_name} Payslip"
    
    try:
        sh = spreadsheet.worksheet(tab_name)
    except:
        print(f"   ⚠️ Tab not found: {tab_name}")
        return
    
    # Get current data to find where to append
    existing = sh.get_all_values()
    next_row = len(existing) + 3  # Leave 2 blank rows
    
    discrepancy_rows = []
    action_dropdown_rows = []  # Track rows that need action dropdowns
    confirm_checkbox_rows = []  # Track rows that need confirm checkboxes
    
    # Header section
    discrepancy_rows.extend([
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "─────────────────────────────────────", "", "", "", "", "", ""],
        ["", "⚠️ DISCREPANCIES TO REVIEW", "", "", "", "", "", ""],
        ["", "Select action, enter amount if needed, tick Confirm to apply", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ])
    
    has_discrepancies = False
    
    # 1. Items in dentist log but NOT in Dentally (PM needs to check - may need to ADD)
    log_only = xref.get("log_only", [])
    if log_only:
        has_discrepancies = True
        discrepancy_rows.append(["", "🔴 IN LOG BUT NOT IN DENTALLY (Check if missed)", "", "", "", "", "", ""])
        discrepancy_rows.append(["", "Patient Name", "Date", "Amount", "New £", "Action", "Confirm", ""])
        for item in log_only:
            row_idx = len(discrepancy_rows)
            discrepancy_rows.append([
                "",
                item.get("patient", ""),
                item.get("date", ""),
                item.get('amount', 0),
                "",  # New £ - editable
                "",  # Action dropdown
                False,  # Confirm checkbox
                ""
            ])
            action_dropdown_rows.append(next_row + row_idx)
            confirm_checkbox_rows.append(next_row + row_idx)
        discrepancy_rows.append(["", "", "", "", "", "", "", ""])
    
    # 2. Amount mismatches (may need to UPDATE amount)
    amount_mismatch = xref.get("amount_mismatch", [])
    if amount_mismatch:
        has_discrepancies = True
        discrepancy_rows.append(["", "🟡 AMOUNT MISMATCHES (Verify correct amount)", "", "", "", "", "", ""])
        discrepancy_rows.append(["", "Patient Name", "Dentally £", "Log £", "New £", "Action", "Confirm", ""])
        for item in amount_mismatch:
            row_idx = len(discrepancy_rows)
            discrepancy_rows.append([
                "",
                item.get("patient", ""),
                item.get('dentally_amount', 0),
                item.get('log_amount', 0),
                "",  # New £ - editable
                "",  # Action dropdown
                False,  # Confirm checkbox
                ""
            ])
            action_dropdown_rows.append(next_row + row_idx)
            confirm_checkbox_rows.append(next_row + row_idx)
        discrepancy_rows.append(["", "", "", "", "", "", "", ""])
    
    # 3. Items in Dentally but NOT in log (may need to REMOVE from pay)
    dentally_only = xref.get("dentally_only", [])
    if dentally_only:
        has_discrepancies = True
        discrepancy_rows.append(["", "🔵 IN DENTALLY BUT NOT IN LOG (Already in pay - verify)", "", "", "", "", "", ""])
        discrepancy_rows.append(["", "Patient Name", "Date", "Amount", "New £", "Action", "Confirm", ""])
        for item in dentally_only:
            row_idx = len(discrepancy_rows)
            discrepancy_rows.append([
                "",
                item.get("patient", ""),
                item.get("date", ""),
                item.get('amount', 0),
                "",  # New £ - editable
                "",  # Action dropdown
                False,  # Confirm checkbox
                ""
            ])
            action_dropdown_rows.append(next_row + row_idx)
            confirm_checkbox_rows.append(next_row + row_idx)
        discrepancy_rows.append(["", "", "", "", "", "", "", ""])
    
    # 4. Unpaid/Balance flags
    unpaid_flags = xref.get("unpaid_flags", [])
    if unpaid_flags:
        has_discrepancies = True
        discrepancy_rows.append(["", "🟠 UNPAID / BALANCE FLAGS (Not in pay - chase payment)", "", "", "", "", "", ""])
        discrepancy_rows.append(["", "Patient Name", "Date", "Amount", "New £", "Action", "Confirm", ""])
        for item in unpaid_flags:
            row_idx = len(discrepancy_rows)
            discrepancy_rows.append([
                "",
                item.get("patient", ""),
                "",
                item.get('amount', 0),
                "",  # New £ - editable
                "",  # Action dropdown
                False,  # Confirm checkbox
                item.get("flag", "")
            ])
            action_dropdown_rows.append(next_row + row_idx)
            confirm_checkbox_rows.append(next_row + row_idx)
        discrepancy_rows.append(["", "", "", "", "", "", "", ""])
    
    if not has_discrepancies:
        discrepancy_rows.append(["", "✅ No discrepancies found - all items match!", "", "", "", "", "", ""])
    
    # Update the sheet
    if discrepancy_rows:
        sh.update(values=discrepancy_rows, range_name=f'A{next_row}')
        time.sleep(1)
        
        # Add dropdowns and checkboxes using batch_update
        if action_dropdown_rows or confirm_checkbox_rows:
            try:
                requests = []
                sheet_id = sh.id
                
                # Add action dropdowns (column F = index 5)
                for row_num in action_dropdown_rows:
                    requests.append({
                        'setDataValidation': {
                            'range': {
                                'sheetId': sheet_id,
                                'startRowIndex': row_num - 1,
                                'endRowIndex': row_num,
                                'startColumnIndex': 5,
                                'endColumnIndex': 6
                            },
                            'rule': {
                                'condition': {
                                    'type': 'ONE_OF_LIST',
                                    'values': [
                                        {'userEnteredValue': 'Add to Pay'},
                                        {'userEnteredValue': 'Remove from Pay'},
                                        {'userEnteredValue': 'Update Amount'}
                                    ]
                                },
                                'showCustomUi': True,
                                'strict': True
                            }
                        }
                    })
                
                # Add confirm checkboxes (column G = index 6)
                for row_num in confirm_checkbox_rows:
                    requests.append({
                        'setDataValidation': {
                            'range': {
                                'sheetId': sheet_id,
                                'startRowIndex': row_num - 1,
                                'endRowIndex': row_num,
                                'startColumnIndex': 6,
                                'endColumnIndex': 7
                            },
                            'rule': {
                                'condition': {
                                    'type': 'BOOLEAN'
                                },
                                'showCustomUi': True
                            }
                        }
                    })
                
                # Currency format for Amount columns (D and E)
                for row_num in action_dropdown_rows:
                    requests.append({
                        'repeatCell': {
                            'range': {
                                'sheetId': sheet_id,
                                'startRowIndex': row_num - 1,
                                'endRowIndex': row_num,
                                'startColumnIndex': 3,
                                'endColumnIndex': 5
                            },
                            'cell': {
                                'userEnteredFormat': {
                                    'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}
                                }
                            },
                            'fields': 'userEnteredFormat.numberFormat'
                        }
                    })
                
                if requests:
                    spreadsheet.batch_update({'requests': requests})
            except Exception as e:
                print(f"      Note: Could not add dropdowns/checkboxes: {e}")
        
        time.sleep(1)  # Rate limit protection


def update_cross_reference(spreadsheet, xref_results, period_str):
    """Update Cross-Reference tab with comparison results"""
    print("   Updating Cross-Reference tab...")
    
    # Try to get or create Cross-Reference tab
    try:
        sh = spreadsheet.worksheet("Cross-Reference")
        sh.clear()
    except:
        try:
            sh = spreadsheet.add_worksheet(title="Cross-Reference", rows=500, cols=12)
        except Exception as e:
            print(f"      ⚠️ Cannot create Cross-Reference tab: {e}")
            return
    
    rows = [
        ["", "CROSS-REFERENCE REPORT", "", "", "", "", "", "", "", "", ""],
        ["", f"Period: {period_str}", "", "", f"Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["", "⚠️ ACTION REQUIRED: Items below need PM review", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["", "SUMMARY", "", "", "", "", "", "", "", "", ""],
        ["", "Dentist", "Dentally Total", "Log Total", "Difference", "Status", "Matched", "Mismatched", "Not in Log", "Not in Dentally (CHECK)", "Unpaid"],
    ]
    
    # Summary rows for each dentist
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
            status = "✅ Match" if abs(diff) <= 10 else "⚠️ Check"
            rows.append([
                "",
                dentist_name,
                f"£{xref['dentally_total']:,.2f}",
                f"£{xref['log_total']:,.2f}",
                f"£{diff:,.2f}",
                status,
                len(xref["matched"]),
                len(xref["amount_mismatch"]),
                len(xref["dentally_only"]),
                len(xref["log_only"]),
                len(xref.get("unpaid_flags", []))
            ])
    
    rows.extend([
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["", "─" * 80, "", "", "", "", "", "", "", "", ""],
    ])
    
    # Detailed breakdown per dentist
    for dentist_name, xref in xref_results.items():
        if "error" in xref:
            continue
        
        rows.extend([
            ["", "", "", "", "", "", "", "", "", "", ""],
            ["", f"═══ {dentist_name.upper()} ═══", "", "", "", "", "", "", "", "", ""],
            ["", "", "", "", "", "", "", "", "", "", ""],
        ])
        
        # IN LOG BUT NOT IN DENTALLY - FIRST (PM needs to check these!)
        if xref["log_only"]:
            rows.append(["", "🔴 PM ACTION: IN DENTIST LOG BUT NOT IN DENTALLY", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "→ Check if we missed this or dentist recorded incorrectly", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "Patient", "Amount", "Date", "Treatment", "Action Needed", "", "", "", "", ""])
            for m in xref["log_only"]:
                rows.append([
                    "",
                    m.get("patient", "Unknown"),
                    f"£{m.get('amount', 0):,.2f}",
                    m.get("date", ""),
                    m.get("treatment", ""),
                    "⚠️ Check & assign or delete",
                    "", "", "", "", ""
                ])
            rows.append(["", "", "", "", "", "", "", "", "", "", ""])
        
        # Amount mismatches - also need attention
        if xref["amount_mismatch"]:
            rows.append(["", "🟡 AMOUNT MISMATCHES - Verify correct amount", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "Patient", "Dentally £", "Log £", "Difference", "Status", "", "", "", "", ""])
            for m in xref["amount_mismatch"]:
                rows.append([
                    "",
                    m.get("patient", "Unknown"),
                    f"£{m.get('dentally_amount', 0):,.2f}",
                    f"£{m.get('log_amount', 0):,.2f}",
                    f"£{m.get('difference', 0):,.2f}",
                    m.get("status", ""),
                    "", "", "", "", ""
                ])
            rows.append(["", "", "", "", "", "", "", "", "", "", ""])
        
        # Unpaid flags - need chasing
        if xref.get("unpaid_flags"):
            rows.append(["", "🟠 UNPAID / BALANCE FLAGS - Chase payment", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "Patient", "Amount", "Flag", "", "", "", "", "", "", ""])
            for m in xref["unpaid_flags"]:
                rows.append([
                    "",
                    m.get("patient", "Unknown"),
                    f"£{m.get('amount', 0):,.2f}",
                    m.get("flag", ""),
                    "", "", "", "", "", "", ""
                ])
            rows.append(["", "", "", "", "", "", "", "", "", "", ""])
        
        # In Dentally but not in log - FYI (dentist may have forgotten to log)
        if xref["dentally_only"]:
            rows.append(["", "🔵 IN DENTALLY BUT NOT IN DENTIST LOG (FYI)", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "→ Dentist may have forgotten to record - no action needed from PM", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "Patient", "Amount", "Date", "Status", "", "", "", "", "", ""])
            for m in xref["dentally_only"][:30]:  # Limit to 30
                rows.append([
                    "",
                    m.get("patient", "Unknown"),
                    f"£{m.get('amount', 0):,.2f}",
                    m.get("date", ""),
                    "ℹ️ Not in log",
                    "", "", "", "", "", ""
                ])
            if len(xref["dentally_only"]) > 30:
                rows.append(["", f"... and {len(xref['dentally_only']) - 30} more", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "", "", "", "", "", "", "", "", "", ""])
        
        # Matched patients - at the end (no action needed)
        if xref["matched"]:
            rows.append(["", "✅ MATCHED PATIENTS (No action needed)", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "Patient (Dentally)", "Dentally £", "Log £", "Patient (Log)", "Status", "", "", "", "", ""])
            for m in xref["matched"][:20]:  # Limit to 20
                rows.append([
                    "",
                    m.get("patient", "Unknown"),
                    f"£{m.get('dentally_amount', 0):,.2f}",
                    f"£{m.get('log_amount', 0):,.2f}",
                    m.get("log_patient", ""),
                    m.get("status", ""),
                    "", "", "", "", ""
                ])
            if len(xref["matched"]) > 20:
                rows.append(["", f"... and {len(xref['matched']) - 20} more matched", "", "", "", "", "", "", "", "", ""])
            rows.append(["", "", "", "", "", "", "", "", "", "", ""])
    
    # Write to sheet
    sh.update(values=rows, range_name='A1')
    time.sleep(2)  # Rate limit protection
    
    # Formatting
    sh.format('B1', {'textFormat': {'bold': True, 'fontSize': 16}})
    sh.format('B4', {'textFormat': {'bold': True, 'fontSize': 12}})
    time.sleep(1)  # Rate limit protection
    
    print(f"   ✅ Cross-Reference tab updated")


def update_discrepancies(spreadsheet, xref_results, period_str):
    """Update Discrepancies tab with items needing attention"""
    print("   Updating Discrepancies tab...")
    
    try:
        sh = spreadsheet.worksheet("Discrepancies")
    except:
        return
    
    # Clear existing data (keep headers)
    sh.batch_clear(['A6:I500'])
    
    rows = []
    row_num = 6
    
    for dentist_name, xref in xref_results.items():
        if "error" in xref:
            continue
        
        # Add items in log but not in Dentally (PM needs to check)
        for item in xref.get("log_only", []):
            rows.append([
                "",
                dentist_name,
                item.get("patient", ""),
                "❌ Not found",
                f"£{item.get('amount', 0):,.2f}",
                f"-£{item.get('amount', 0):,.2f}",
                "In log but not Dentally",
                "Check if missed or incorrect entry",
                "⚠️ Review"
            ])
        
        # Add amount mismatches
        for item in xref.get("amount_mismatch", []):
            diff = item.get("dentally_amount", 0) - item.get("log_amount", 0)
            rows.append([
                "",
                dentist_name,
                item.get("patient", ""),
                f"£{item.get('dentally_amount', 0):,.2f}",
                f"£{item.get('log_amount', 0):,.2f}",
                f"£{diff:,.2f}",
                "Amount mismatch",
                "Verify correct amount",
                "⚠️ Review"
            ])
        
        # Add items in Dentally but not in log
        for item in xref.get("dentally_only", []):
            rows.append([
                "",
                dentist_name,
                item.get("patient", ""),
                f"£{item.get('amount', 0):,.2f}",
                "❌ Not found",
                f"+£{item.get('amount', 0):,.2f}",
                "In Dentally but not in log",
                "Dentist may need to add to log",
                "ℹ️ Info"
            ])
    
    if rows:
        sh.update(values=rows, range_name='A6')
        time.sleep(1)  # Rate limit protection
    
    print(f"   ✅ Discrepancies tab updated ({len(rows)} items)")


# =============================================================================
# CROSS-REFERENCE WITH DENTIST LOGS
# =============================================================================

def normalize_name(name):
    """Normalize patient name for comparison"""
    if not name:
        return ""
    # Lowercase, strip whitespace, remove extra spaces
    name = str(name).lower().strip()
    name = " ".join(name.split())
    return name


def get_initials(name):
    """Get initials from a name"""
    if not name:
        return ""
    parts = name.split()
    return "".join(p[0].lower() for p in parts if p)


def fuzzy_match_name(name1, name2):
    """
    Check if two names match (fuzzy)
    Returns: (match_score, match_type)
    - 1.0 = exact match
    - 0.8 = one name contains the other
    - 0.6 = initials match full name
    - 0.0 = no match
    """
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    
    if not n1 or not n2:
        return 0.0, "empty"
    
    # Exact match
    if n1 == n2:
        return 1.0, "exact"
    
    # One contains the other (e.g., "john smith" vs "john")
    if n1 in n2 or n2 in n1:
        return 0.8, "partial"
    
    # Check if one is initials of the other
    init1 = get_initials(n1)
    init2 = get_initials(n2)
    
    # "sh" matches "sam harris"
    if len(n1) <= 3 and n1 == init2:
        return 0.6, "initials"
    if len(n2) <= 3 and n2 == init1:
        return 0.6, "initials"
    
    # Check last name match (common in dental)
    parts1 = n1.split()
    parts2 = n2.split()
    if len(parts1) > 0 and len(parts2) > 0:
        if parts1[-1] == parts2[-1]:  # Last names match
            return 0.7, "lastname"
    
    return 0.0, "none"


def read_dentist_log(client, spreadsheet_id, month, year):
    """
    Read a dentist's private takings log for a specific month
    
    Returns list of: {"patient": str, "amount": float, "date": str, "treatment": str}
    """
    try:
        spreadsheet = client.open_by_key(spreadsheet_id)
    except Exception as e:
        print(f"      ⚠️ Cannot access log: {e}")
        return None
    
    # Try different tab name formats
    month_names = {
        1: ["JANUARY", "JAN", "January", "Jan"],
        2: ["FEBRUARY", "FEB", "February", "Feb"],
        3: ["MARCH", "MAR", "March", "Mar"],
        4: ["APRIL", "APR", "April", "Apr"],
        5: ["MAY", "May"],
        6: ["JUNE", "JUN", "June", "Jun"],
        7: ["JULY", "JUL", "July", "Jul"],
        8: ["AUGUST", "AUG", "August", "Aug"],
        9: ["SEPTEMBER", "SEP", "SEPT", "September", "Sept"],
        10: ["OCTOBER", "OCT", "October", "Oct"],
        11: ["NOVEMBER", "NOV", "November", "Nov"],
        12: ["DECEMBER", "DEC", "December", "Dec"],
    }
    
    year_short = str(year)[2:]  # "2025" -> "25"
    
    # Build possible tab names
    possible_names = []
    for name in month_names.get(month, []):
        possible_names.extend([
            f"{name} {year_short}",      # "DECEMBER 25"
            f"{name} {year}",            # "DECEMBER 2025"
            f"{name}{year_short}",       # "DECEMBER25"
            f"{name.upper()} {year_short}",
            f"{name.lower()} {year_short}",
        ])
    
    # Find matching sheet
    sheet = None
    all_sheets = [ws.title for ws in spreadsheet.worksheets()]
    
    for tab_name in possible_names:
        if tab_name in all_sheets:
            sheet = spreadsheet.worksheet(tab_name)
            break
        # Case insensitive match
        for ws_name in all_sheets:
            if ws_name.lower().strip() == tab_name.lower().strip():
                sheet = spreadsheet.worksheet(ws_name)
                break
        if sheet:
            break
    
    if not sheet:
        print(f"      ⚠️ No tab found for {month}/{year}. Available: {all_sheets[:5]}...")
        return None
    
    print(f"      Found tab: {sheet.title}")
    
    # Read all data
    data = sheet.get_all_values()
    
    # Find the header row (contains "DATE", "PATIENT", etc.)
    header_row = None
    for i, row in enumerate(data):
        row_lower = [str(cell).lower() for cell in row]
        if "date" in row_lower and ("patient" in row_lower or any("patient" in c for c in row_lower)):
            header_row = i
            break
    
    if header_row is None:
        print(f"      ⚠️ Cannot find header row")
        return None
    
    # Parse entries - look for rows with data after header
    entries = []
    current_date = None
    
    for row in data[header_row + 1:]:
        if len(row) < 4:
            continue
        
        # Check for "TOTAL GROSS" row - stop here
        if any("total" in str(cell).lower() for cell in row):
            break
        
        # Column mapping (based on the log structure)
        # Col 0/1 = DATE, Col 1/2 = PATIENT, Col 2/3 = TREATMENT, Col 3/4 = AMOUNT
        date_val = row[0] if len(row) > 0 else ""
        patient_val = row[1] if len(row) > 1 else ""
        treatment_val = row[2] if len(row) > 2 else ""
        amount_val = row[3] if len(row) > 3 else ""
        
        # Update current date if present
        if date_val and str(date_val).strip():
            current_date = str(date_val).strip()
        
        # Skip empty rows
        if not patient_val or not str(patient_val).strip():
            continue
        
        # Parse amount
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
    
    print(f"      Found {len(entries)} entries, total: £{sum(e['amount'] for e in entries):,.2f}")
    return entries


def cross_reference_dentist(dentist_name, dentally_patients, log_entries):
    """
    Cross-reference Dentally data with dentist's log
    
    Returns:
        {
            "dentally_total": float,
            "log_total": float,
            "difference": float,
            "matched": [...],      # Patients found in both
            "dentally_only": [...], # In Dentally but not in log
            "log_only": [...],      # In log but not in Dentally
            "amount_mismatch": [...] # Same patient, different amounts
        }
    """
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
        result["log_only"] = []
        result["dentally_only"] = [
            {
                "patient": dp["name"],
                "amount": dp["amount"],
                "date": dp.get("date", ""),
                "status": "❌ Not in log"
            }
            for dp in dentally_patients
        ]
        # Still check for unpaid flags
        for dp in dentally_patients:
            if dp.get("payment_flag"):
                result["unpaid_flags"].append({
                    "patient": dp["name"],
                    "amount": dp["amount"],
                    "flag": dp["payment_flag"]
                })
        return result
    
    # Track which log entries have been matched
    log_matched = [False] * len(log_entries)
    
    # Try to match each Dentally patient
    for dp in dentally_patients:
        best_match = None
        best_score = 0
        best_idx = -1
        
        for i, le in enumerate(log_entries):
            if log_matched[i]:
                continue
            
            score, match_type = fuzzy_match_name(dp["name"], le["patient"])
            if score > best_score:
                best_score = score
                best_match = le
                best_idx = i
        
        if best_score >= 0.6:  # Good enough match
            log_matched[best_idx] = True
            
            # Check if amounts match (within £1 tolerance)
            if abs(dp["amount"] - best_match["amount"]) <= 1:
                result["matched"].append({
                    "patient": dp["name"],
                    "dentally_amount": dp["amount"],
                    "log_amount": best_match["amount"],
                    "log_patient": best_match["patient"],
                    "status": "✅"
                })
            else:
                result["amount_mismatch"].append({
                    "patient": dp["name"],
                    "dentally_amount": dp["amount"],
                    "log_amount": best_match["amount"],
                    "log_patient": best_match["patient"],
                    "difference": dp["amount"] - best_match["amount"],
                    "status": "⚠️ Amount differs"
                })
        else:
            result["dentally_only"].append({
                "patient": dp["name"],
                "amount": dp["amount"],
                "date": dp.get("date", ""),
                "status": "❌ Not in log"
            })
        
        # Check for payment flags
        if dp.get("payment_flag"):
            result["unpaid_flags"].append({
                "patient": dp["name"],
                "amount": dp["amount"],
                "flag": dp["payment_flag"]
            })
    
    # Find log entries not matched to Dentally
    for i, le in enumerate(log_entries):
        if not log_matched[i]:
            result["log_only"].append({
                "patient": le["patient"],
                "amount": le["amount"],
                "date": le.get("date", ""),
                "treatment": le.get("treatment", ""),
                "status": "❓ Not in Dentally"
            })
    
    return result


def perform_cross_reference(client, payslips, month, year):
    """
    Perform cross-reference for all dentists with logs
    """
    print("\n🔍 CROSS-REFERENCING WITH DENTIST LOGS...")
    print("=" * 50)
    
    results = {}
    
    for dentist_name, log_id in PRIVATE_TAKINGS_LOGS.items():
        if dentist_name not in payslips:
            continue
        
        print(f"\n   {dentist_name}:")
        
        # Get dentally patients for this dentist
        dentally_patients = payslips[dentist_name].get("patients", [])
        
        # Read their log
        log_entries = read_dentist_log(client, log_id, month, year)
        
        if log_entries is None:
            print(f"      ⚠️ Could not read log - skipping cross-reference")
            results[dentist_name] = {
                "dentist": dentist_name,
                "error": "Could not read log",
                "dentally_total": payslips[dentist_name].get("gross_total", 0)
            }
            continue
        
        # Perform cross-reference
        xref = cross_reference_dentist(dentist_name, dentally_patients, log_entries)
        results[dentist_name] = xref
        
        # Print summary
        print(f"      Dentally: £{xref['dentally_total']:,.2f}")
        print(f"      Log:      £{xref['log_total']:,.2f}")
        print(f"      Diff:     £{xref['difference']:,.2f} {'⚠️' if abs(xref['difference']) > 10 else '✅'}")
        print(f"      Matched: {len(xref['matched'])}, Mismatched: {len(xref['amount_mismatch'])}")
        print(f"      Dentally only: {len(xref['dentally_only'])}, Log only: {len(xref['log_only'])}")
        
        if xref['unpaid_flags']:
            print(f"      ⚠️ {len(xref['unpaid_flags'])} unpaid/balance flags!")
    
    return results

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
            "invoice_count": 0,
            "patient_totals": {},  # {patient_id: {"name": str, "total": float, ...}}
            "patients": [],  # Final consolidated list
            "payment_flags": [],  # Unpaid or balance issues
        }
    
    # Track finance payments needing term length
    finance_flags = []
    
    # Get invoices (already filtered for site)
    invoices = get_invoices_for_period(start_date, end_date)
    
    # Get all payments with wide date range (6 months before to 1 month after)
    # This catches: prepayments, deposits, and delayed payments
    payment_start = start_date - timedelta(days=180)
    payment_end = end_date + timedelta(days=30)
    payments = get_payments_for_period(payment_start, payment_end)
    invoice_payment_map = build_invoice_payment_map(payments)
    
    # Count finance payments
    finance_count = sum(1 for m in invoice_payment_map.values() if m.lower() == "finance")
    print(f"   Mapped {len(invoice_payment_map)} invoice payment methods ({finance_count} Finance)")
    
    # Patient name cache
    patient_cache = {}
    
    # Process each invoice
    processed = 0
    skipped = 0
    unpaid_skipped = 0
    nhs_skipped = 0
    debug_logged = False
    
    print(f"   Processing {len(invoices)} invoices...")
    
    for invoice in invoices:
        invoice_id = invoice.get("id")
        patient_id = invoice.get("patient_id")
        is_paid = invoice.get("_is_paid", False)
        balance = invoice.get("_balance", 0)
        payment_flag = invoice.get("_payment_flag")
        invoice_date = invoice.get("_invoice_date", "")
        paid_date = invoice.get("_paid_date", "")
        
        # Get invoice details with line items
        details = get_invoice_details(invoice_id)
        if not details:
            skipped += 1
            continue
        
        invoice_data = details.get("invoice", {})
        line_items = invoice_data.get("invoice_items", [])
        
        # Debug: log first invoice structure to see available fields
        if not debug_logged and line_items:
            print(f"\n   📋 DEBUG - Sample invoice fields: {list(invoice_data.keys())}")
            print(f"   📋 DEBUG - Sample item fields: {list(line_items[0].keys())}")
            debug_logged = True
        
        # Check if this invoice was paid via Finance (Tabeo)
        payment_method = invoice_payment_map.get(invoice_id, "Unknown")
        is_finance_payment = payment_method.lower() == "finance"
        
        # Process line items - group by practitioner
        for item in line_items:
            practitioner_id = item.get("practitioner_id")
            item_name = item.get("name", "")
            item_amount = float(item.get("total_price", 0))
            
            if item_amount <= 0:
                continue
            
            # Skip excluded treatments (CBCT etc - go to practice)
            if any(excl.lower() in item_name.lower() for excl in EXCLUDED_TREATMENTS):
                continue
            
            # Skip NHS band treatments (dentists paid via UDAs, not here)
            if is_nhs_treatment(item_name, item_amount, item):
                nhs_skipped += 1
                continue
            
            # Skip therapist work (handled via therapy_minutes input)
            if practitioner_id == THERAPIST_ID:
                continue
            
            # Look up dentist by practitioner_id
            dentist_name = PRACTITIONER_TO_DENTIST.get(practitioner_id)
            if not dentist_name:
                continue
            
            # Get patient name (with caching)
            if patient_id not in patient_cache:
                patient_cache[patient_id] = get_patient_name(patient_id)
            patient_name = patient_cache[patient_id]
            
            # Only add to gross total if PAID and no balance
            if is_paid and balance <= 0:
                payslips[dentist_name]["gross_private_dentist"] += item_amount
                payslips[dentist_name]["invoice_count"] += 1
            else:
                # Track as payment flag
                payslips[dentist_name]["payment_flags"].append({
                    "patient": patient_name,
                    "amount": item_amount,
                    "treatment": item_name,
                    "invoice_date": invoice_date,
                    "balance": balance,
                    "is_paid": is_paid,
                    "flag": payment_flag or "⚠️ Unpaid"
                })
                unpaid_skipped += 1
            
            # Flag finance payments for term length entry
            if is_finance_payment and is_paid:
                finance_flags.append({
                    "patient": patient_name,
                    "dentist": dentist_name,
                    "amount": item_amount,
                    "date": invoice_date,
                    "treatment": item_name,
                    "invoice_id": invoice_id
                })
            
            # Add to patient totals (for cross-reference - includes all)
            if patient_id not in payslips[dentist_name]["patient_totals"]:
                payslips[dentist_name]["patient_totals"][patient_id] = {
                    "name": patient_name,
                    "total": 0,
                    "paid_total": 0,  # Only fully paid amounts
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
            print(f"   Processed {processed}/{len(invoices)} invoices...")
    
    print(f"   ✅ Processed {processed} invoices ({skipped} API errors, {unpaid_skipped} unpaid items, {nhs_skipped} NHS items skipped)")
    print(f"   📋 Cached {len(patient_cache)} patient names")
    print(f"   💳 Found {len(finance_flags)} finance payments needing term length")
    
    # Calculate final figures and consolidate patients
    print("\n📋 RESULTS:")
    print("=" * 50)
    
    for name, p in payslips.items():
        config = DENTISTS[name]
        
        # Consolidate patient_totals into patients list
        patients_list = []
        for pt in p["patient_totals"].values():
            date_str = pt["last_date"] or ""
            # Convert YYYY-MM-DD to DD/MM/YYYY for display
            display_date = date_str
            sort_date = date_str or "9999-99-99"
            if date_str and len(date_str) == 10 and date_str[4] == '-':
                try:
                    # Parse YYYY-MM-DD and convert to DD/MM/YYYY
                    parsed = datetime.strptime(date_str, "%Y-%m-%d")
                    display_date = parsed.strftime("%d/%m/%Y")
                except:
                    pass
            
            patients_list.append({
                "name": pt["name"], 
                "amount": pt["total"],  # Total for cross-reference
                "paid_amount": pt["paid_total"],  # Paid amount for payslip
                "date": display_date,
                "sort_date": sort_date,
                "payment_flag": pt["payment_flag"]
            })
        
        # Sort chronologically (earliest first)
        p["patients"] = sorted(patients_list, key=lambda x: x["sort_date"])
        
        # Remove the working dict
        del p["patient_totals"]
        
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
        
        if p["gross_total"] > 0 or p["payment_flags"]:
            split_pct = int(config["split"] * 100)
            flags_str = f" ⚠️ {len(p['payment_flags'])} unpaid" if p['payment_flags'] else ""
            print(f"   {name} ({split_pct}%): Gross £{p['gross_total']:,.2f} → Net £{p['total_payment']:,.2f} ({len(p['patients'])} patients){flags_str}")
    
    return payslips, finance_flags


# =============================================================================
# PDF GENERATION & EMAIL
# =============================================================================

def generate_payslip_pdf(dentist_name, payslip, period_str, output_dir="/tmp"):
    """
    Generate a PDF payslip for a dentist.
    
    Returns: path to generated PDF file
    """
    config = DENTISTS.get(dentist_name, {})
    first_name = dentist_name.split()[0]
    filename = f"{first_name}_Payslip_{period_str.replace(' ', '_')}.pdf"
    filepath = os.path.join(output_dir, filename)
    
    # Calculate payment date (15th of following month)
    try:
        period_date = datetime.strptime(period_str, "%B %Y")
        if period_date.month == 12:
            payment_date = datetime(period_date.year + 1, 1, 15)
        else:
            payment_date = datetime(period_date.year, period_date.month + 1, 15)
        payment_str = payment_date.strftime("%d %B %Y")
    except:
        payment_str = "15th of following month"
    
    # Create PDF
    doc = SimpleDocTemplate(
        filepath,
        pagesize=A4,
        rightMargin=20*mm,
        leftMargin=20*mm,
        topMargin=15*mm,
        bottomMargin=15*mm
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'Title',
        parent=styles['Normal'],
        fontSize=16,
        fontName='Helvetica-Bold',
        spaceAfter=10
    )
    
    header_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontSize=11,
        fontName='Helvetica-Bold',
        spaceAfter=5
    )
    
    normal_style = ParagraphStyle(
        'CustomNormal',
        parent=styles['Normal'],
        fontSize=10,
        fontName='Helvetica'
    )
    
    small_style = ParagraphStyle(
        'Small',
        parent=styles['Normal'],
        fontSize=9,
        fontName='Helvetica'
    )
    
    elements = []
    
    # Header info
    elements.append(Paragraph(f"<b>PAYSLIP - {period_str}</b>", title_style))
    elements.append(Spacer(1, 5*mm))
    
    info_data = [
        ["Payslip Date:", payment_str, "", "Practice:", PRACTICE_NAME],
        ["Private Period:", period_str, "", "Performer:", config.get('display_name', dentist_name)],
        ["Superannuation:", "Opted Out", "", "", ""],
    ]
    
    info_table = Table(info_data, colWidths=[80, 100, 20, 70, 150])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (3, 0), (3, -1), 'Helvetica-Bold'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 8*mm))
    
    # Section 1: Private Fees
    elements.append(Paragraph("<b>Section 1: Private Fees</b>", header_style))
    
    split_pct = int(config.get('split', 0.5) * 100)
    
    fees_data = [
        ["", "Gross Private by Dentist", f"£{payslip.get('gross_private_dentist', 0):,.2f}"],
        ["", "Gross Private by Therapist", f"£{payslip.get('gross_private_therapist', 0):,.2f}"],
        ["", "Gross Total", f"£{payslip.get('gross_total', 0):,.2f}"],
        ["Subtotal", f"{split_pct}%", f"£{payslip.get('net_private', 0):,.2f}"],
    ]
    
    fees_table = Table(fees_data, colWidths=[100, 180, 100])
    fees_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ('FONTNAME', (0, 3), (-1, 3), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 3), (-1, 3), colors.Color(0.85, 0.95, 0.85)),
        ('LINEABOVE', (0, 3), (-1, 3), 1, colors.Color(0.13, 0.55, 0.13)),
        ('LINEBELOW', (0, 3), (-1, 3), 1, colors.Color(0.13, 0.55, 0.13)),
    ]))
    elements.append(fees_table)
    elements.append(Spacer(1, 6*mm))
    
    # Section 2: Deductions
    elements.append(Paragraph("<b>Section 2: Deductions</b>", header_style))
    
    # Lab bills breakdown
    lab_bills = payslip.get('lab_bills', {})
    deductions_data = [["Labs", "", ""]]
    
    for lab_name, amount in lab_bills.items():
        if amount > 0:
            deductions_data.append(["", lab_name, f"£{amount:,.2f}"])
    
    deductions_data.append(["", "Lab Bills Total", f"£{payslip.get('lab_bills_total', 0):,.2f}"])
    deductions_data.append(["", "Lab Bills 50%", f"£{payslip.get('lab_bills_50', 0):,.2f}"])
    deductions_data.append(["", "", ""])
    deductions_data.append(["Finance Fees", "", f"£{payslip.get('finance_fees_total', 0):,.2f}"])
    deductions_data.append(["50%", "", f"£{payslip.get('finance_fees_50', 0):,.2f}"])
    deductions_data.append(["", "", ""])
    therapy_mins = payslip.get('therapy_minutes', 0)
    deductions_data.append(["Therapy", f"Taryn ({therapy_mins} mins)", f"£{payslip.get('therapy_total', 0):,.2f}"])
    deductions_data.append(["", "", ""])
    deductions_data.append(["Total Deductions", "", f"£{payslip.get('total_deductions', 0):,.2f}"])
    
    ded_table = Table(deductions_data, colWidths=[100, 180, 100])
    ded_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ('FONTNAME', (0, 0), (0, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -1), (-1, -1), colors.Color(0.85, 0.95, 0.85)),
        ('LINEABOVE', (0, -1), (-1, -1), 1, colors.Color(0.13, 0.55, 0.13)),
        ('LINEBELOW', (0, -1), (-1, -1), 1, colors.Color(0.13, 0.55, 0.13)),
    ]))
    elements.append(ded_table)
    elements.append(Spacer(1, 6*mm))
    
    # Total Payment
    total_data = [
        ["TOTAL PAYMENT", "", f"£{payslip.get('total_payment', 0):,.2f}"],
    ]
    
    total_table = Table(total_data, colWidths=[100, 180, 100])
    total_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 12),
        ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ('BACKGROUND', (0, 0), (-1, -1), colors.Color(0.85, 0.95, 0.85)),
        ('LINEABOVE', (0, 0), (-1, -1), 2, colors.Color(0.13, 0.55, 0.13)),
        ('LINEBELOW', (0, 0), (-1, -1), 2, colors.Color(0.13, 0.55, 0.13)),
    ]))
    elements.append(total_table)
    elements.append(Spacer(1, 8*mm))
    
    # Patient Breakdown
    patients = payslip.get('patients', [])
    if patients:
        elements.append(Paragraph("<b>Patient Breakdown</b>", header_style))
        
        patient_data = [["Patient Name", "Date", "Amount"]]
        for p in patients:
            patient_data.append([
                p.get('name', '')[:30],
                p.get('date', ''),
                f"£{p.get('paid_amount', p.get('amount', 0)):,.2f}"
            ])
        
        patient_table = Table(patient_data, colWidths=[200, 80, 80])
        patient_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
            ('BACKGROUND', (0, 0), (-1, 0), colors.Color(0.95, 0.95, 0.95)),
            ('LINEBELOW', (0, 0), (-1, 0), 1, colors.Color(0.75, 0.75, 0.75)),
            ('LINEBELOW', (0, 1), (-1, -2), 0.5, colors.Color(0.9, 0.9, 0.9)),
        ]))
        elements.append(patient_table)
    
    # Build PDF
    doc.build(elements)
    
    return filepath


def generate_all_payslip_pdfs(payslips, period_str, output_dir="/tmp"):
    """
    Generate PDF payslips for all dentists with payments.
    
    Returns: list of generated PDF file paths
    """
    print("\n📄 GENERATING PDF PAYSLIPS...")
    print("=" * 50)
    
    pdf_files = []
    
    for dentist_name, payslip in payslips.items():
        if payslip.get('total_payment', 0) > 0 or payslip.get('gross_total', 0) > 0:
            try:
                filepath = generate_payslip_pdf(dentist_name, payslip, period_str, output_dir)
                pdf_files.append({
                    'dentist': dentist_name,
                    'filepath': filepath,
                    'amount': payslip.get('total_payment', 0)
                })
                print(f"   ✅ {dentist_name}: {os.path.basename(filepath)}")
            except Exception as e:
                print(f"   ⚠️ {dentist_name}: Error generating PDF - {e}")
    
    print(f"\n   Generated {len(pdf_files)} PDF payslips")
    return pdf_files


def send_payslips_email(pdf_files, period_str, recipient_email=None):
    """
    Send all PDF payslips to Hisham via email.
    
    Args:
        pdf_files: List of {'dentist': str, 'filepath': str, 'amount': float}
        period_str: e.g., "December 2025"
        recipient_email: Override default recipient
    """
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print("\n⚠️ Email not configured - set EMAIL_SENDER and EMAIL_PASSWORD")
        return False
    
    recipient = recipient_email or HISHAM_EMAIL
    if not recipient:
        print("\n⚠️ No recipient email configured")
        return False
    
    print(f"\n📧 SENDING PAYSLIPS TO {recipient}...")
    print("=" * 50)
    
    try:
        # Create message
        msg = MIMEMultipart()
        msg['From'] = EMAIL_SENDER
        msg['To'] = recipient
        msg['Subject'] = f"Aura Dental Payslips - {period_str}"
        
        # Email body
        total_payout = sum(p['amount'] for p in pdf_files)
        body = f"""Hi Hisham,

Please find attached the payslips for {period_str}.

Summary:
"""
        for pdf in pdf_files:
            body += f"• {pdf['dentist']}: £{pdf['amount']:,.2f}\n"
        
        body += f"""
Total Payout: £{total_payout:,.2f}

Generated automatically by Aura Payslip Generator v4.0
"""
        
        msg.attach(MIMEText(body, 'plain'))
        
        # Attach PDFs
        for pdf in pdf_files:
            with open(pdf['filepath'], 'rb') as f:
                part = MIMEBase('application', 'pdf')
                part.set_payload(f.read())
                encoders.encode_base64(part)
                part.add_header(
                    'Content-Disposition',
                    f"attachment; filename={os.path.basename(pdf['filepath'])}"
                )
                msg.attach(part)
        
        # Send email
        with smtplib.SMTP(EMAIL_SMTP_SERVER, EMAIL_SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.send_message(msg)
        
        print(f"   ✅ Email sent to {recipient} with {len(pdf_files)} attachments")
        return True
        
    except Exception as e:
        print(f"   ⚠️ Email error: {e}")
        return False


def run_pdf_generation_only(year=None, month=None, send_email=False, recipient_email=None):
    """
    Generate PDF payslips without running the full calculation.
    Reads data from existing Google Sheets.
    """
    print("=" * 60)
    print("📄 PDF GENERATION MODE")
    print("=" * 60)
    
    # Determine period
    if year is None or month is None:
        today = datetime.now()
        if today.month == 1:
            year = today.year - 1
            month = 12
        else:
            year = today.year
            month = today.month - 1
    
    period_str = datetime(year, month, 1).strftime("%B %Y")
    print(f"\n📅 Period: {period_str}")
    
    # Get sheets client
    client = get_sheets_client()
    if not client:
        print("❌ Cannot connect to Google Sheets")
        return None
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        
        # Read payslip data from each dentist's tab
        payslips = {}
        
        for dentist_name in DENTISTS.keys():
            first_name = dentist_name.split()[0]
            tab_name = f"{first_name} Payslip"
            
            try:
                sh = spreadsheet.worksheet(tab_name)
                data = sh.get_all_values()
                
                # Parse the sheet to extract payslip data
                payslip = {
                    'gross_private_dentist': 0,
                    'gross_private_therapist': 0,
                    'gross_total': 0,
                    'net_private': 0,
                    'lab_bills': {},
                    'lab_bills_total': 0,
                    'lab_bills_50': 0,
                    'finance_fees_total': 0,
                    'finance_fees_50': 0,
                    'therapy_minutes': 0,
                    'therapy_total': 0,
                    'total_deductions': 0,
                    'total_payment': 0,
                    'patients': []
                }
                
                # Extract values from sheet (simplified parsing)
                for i, row in enumerate(data):
                    for j, cell in enumerate(row):
                        cell_str = str(cell).lower()
                        
                        # Try to extract numeric values
                        if 'gross total' in cell_str and j + 1 < len(row):
                            try:
                                payslip['gross_total'] = float(str(row[j+1]).replace('£', '').replace(',', ''))
                            except:
                                pass
                        elif 'total payment' in cell_str and j + 1 < len(row):
                            try:
                                payslip['total_payment'] = float(str(row[j+1]).replace('£', '').replace(',', ''))
                            except:
                                pass
                        elif 'total deductions' in cell_str and j + 1 < len(row):
                            try:
                                payslip['total_deductions'] = float(str(row[j+1]).replace('£', '').replace(',', ''))
                            except:
                                pass
                
                if payslip['total_payment'] > 0 or payslip['gross_total'] > 0:
                    payslips[dentist_name] = payslip
                    print(f"   ✅ {dentist_name}: £{payslip['total_payment']:,.2f}")
                    
            except Exception as e:
                print(f"   Note: {tab_name} - {e}")
        
        if not payslips:
            print("⚠️ No payslip data found")
            return None
        
        # Generate PDFs
        pdf_files = generate_all_payslip_pdfs(payslips, period_str)
        
        # Send email if requested
        if send_email and pdf_files:
            send_payslips_email(pdf_files, period_str, recipient_email)
        
        return pdf_files
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None


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
    
    # Process lab bills from Google Drive (if no manual lab_bills provided)
    drive_service = get_drive_service()
    if drive_service and not lab_bills:
        try:
            client = get_sheets_client()
            if client:
                spreadsheet = client.open_by_key(SPREADSHEET_ID)
                
                # Process lab bills and get assignments
                lab_bills_from_drive = process_lab_bills(
                    drive_service, spreadsheet, period_str, month, year
                )
                
                # Merge lab bills into payslips
                if lab_bills_from_drive:
                    for dentist, labs in lab_bills_from_drive.items():
                        if dentist in payslips:
                            # Merge with existing lab bills
                            for lab_name, amount in labs.items():
                                if lab_name in payslips[dentist]['lab_bills']:
                                    payslips[dentist]['lab_bills'][lab_name] += amount
                                else:
                                    payslips[dentist]['lab_bills'][lab_name] = amount
                            
                            # Recalculate totals
                            payslips[dentist]['lab_bills_total'] = sum(payslips[dentist]['lab_bills'].values())
                            payslips[dentist]['lab_bills_50'] = payslips[dentist]['lab_bills_total'] * LAB_BILL_SPLIT
                            payslips[dentist]['total_deductions'] = (
                                payslips[dentist]['lab_bills_50'] +
                                payslips[dentist]['finance_fees_50'] +
                                payslips[dentist]['therapy_total']
                            )
                            payslips[dentist]['total_payment'] = payslips[dentist]['net_private'] - payslips[dentist]['total_deductions']
        except Exception as e:
            print(f"   ⚠️ Lab bill processing error: {e}")
            import traceback
            traceback.print_exc()
    
    # Process NHS statements (for Peter, Priyanka, Moneeb)
    nhs_data = {}
    if drive_service and NHS_STATEMENTS_FOLDER_ID:
        try:
            client = get_sheets_client()
            if client:
                spreadsheet = client.open_by_key(SPREADSHEET_ID)
                
                nhs_data = process_nhs_statements(
                    drive_service, spreadsheet, period_str, month, year
                )
                
                # Add NHS income to payslips
                for dentist, data in nhs_data.items():
                    if dentist in payslips:
                        payslips[dentist]['nhs_udas'] = data['udas']
                        payslips[dentist]['nhs_uda_rate'] = data['uda_rate']
                        payslips[dentist]['nhs_income'] = data['uda_income']
                        payslips[dentist]['nhs_period'] = data.get('nhs_period', '')
                        print(f"   ✅ Added NHS income to {dentist}: £{data['uda_income']:,.2f}")
        except Exception as e:
            print(f"   ⚠️ NHS statement processing error: {e}")
            import traceback
            traceback.print_exc()
    
    # Read and apply confirmed adjustments from previous run
    if GOOGLE_SHEETS_CREDENTIALS:
        print("\n📝 CHECKING FOR CONFIRMED ADJUSTMENTS...")
        client = get_sheets_client()
        if client:
            try:
                spreadsheet = client.open_by_key(SPREADSHEET_ID)
                
                for dentist_name in payslips.keys():
                    adjustments = read_confirmed_adjustments(spreadsheet, dentist_name)
                    if adjustments:
                        payslips[dentist_name] = apply_adjustments_to_payslip(
                            payslips[dentist_name], adjustments, dentist_name
                        )
                        print(f"   ✅ Applied {len(adjustments)} adjustments to {dentist_name}")
                
            except Exception as e:
                print(f"   ⚠️ Adjustment processing error: {e}")
    
    # Build historical database and check for duplicates
    all_duplicates = []
    historical_db = {}  # Initialize here so it's available for reconciliation
    if drive_service:
        try:
            historical_db = build_historical_database(
                drive_service, 
                HISTORICAL_PAYSLIPS_FOLDER_ID,
                exclude_period=period_str  # Don't include current month's PDFs
            )
            
            # Check each dentist's patients against historical
            print("\n🔍 CHECKING FOR DUPLICATES...")
            for dentist_name, payslip in payslips.items():
                patients = payslip.get('patients', [])
                dups = check_for_duplicates(patients, historical_db, dentist_name, period_str)
                if dups:
                    all_duplicates.extend(dups)
                    print(f"   ⚠️ {dentist_name}: {len(dups)} potential duplicates")
            
            if not all_duplicates:
                print("   ✅ No duplicates found")
        except Exception as e:
            print(f"   ⚠️ Duplicate check error: {e}")
            import traceback
            traceback.print_exc()
    else:
        print("\n⚠️ Skipping duplicate check - Drive service unavailable")
    
    # Update Google Sheets
    xref_results = None
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
                    time.sleep(2)  # Rate limit protection
                
                # Update finance flags
                if finance_flags:
                    update_finance_flags(spreadsheet, finance_flags)
                    print(f"   ⚠️ {len(finance_flags)} finance payments need term length")
                
                # Perform cross-reference with dentist logs
                xref_results = perform_cross_reference(client, payslips, month, year)
                
                # Update cross-reference tab
                if xref_results:
                    update_cross_reference(spreadsheet, xref_results, period_str)
                    
                    # Add discrepancies to each dentist's individual payslip
                    print("   Adding discrepancies to individual payslips...")
                    for dentist_name, xref in xref_results.items():
                        if "error" not in xref:
                            update_payslip_discrepancies(spreadsheet, dentist_name, xref)
                            time.sleep(1)  # Rate limit protection
                    print("   ✅ Discrepancies added to payslips")
                
                # Update duplicate check tab
                if all_duplicates:
                    update_duplicate_check_tab(spreadsheet, all_duplicates, period_str)
                
                # Perform 4-way reconciliation
                if historical_db and xref_results:
                    reconciliation = perform_4way_reconciliation(payslips, historical_db, xref_results, period_str)
                    update_reconciliation_tab(spreadsheet, reconciliation, period_str)
                
                # DISABLED: Log paid invoices for future duplicate detection
                # update_paid_invoices_log(spreadsheet, payslips, period_str)
                
            except Exception as e:
                print(f"   ⚠️ Sheets error: {e}")
                import traceback
                traceback.print_exc()
    
    # Summary
    print("\n" + "=" * 60)
    print("✅ PAYSLIP GENERATION COMPLETE")
    print("=" * 60)
    
    total_payout = sum(p['total_payment'] for p in payslips.values())
    print(f"\n💰 Total Payout: £{total_payout:,.2f}")
    print(f"\n🔗 View: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}")
    
    # Warnings
    if finance_flags:
        print(f"\n⚠️ ACTION REQUIRED: Enter term lengths for {len(finance_flags)} finance payments")
    
    # Duplicate check summary
    if all_duplicates:
        print(f"\n🔴 DUPLICATE CHECK: {len(all_duplicates)} potential duplicates found - Review Duplicate Check tab!")
    
    # Cross-reference summary
    if xref_results:
        print("\n📋 CROSS-REFERENCE SUMMARY:")
        for dentist, xref in xref_results.items():
            if "error" not in xref:
                diff = xref["difference"]
                status = "✅" if abs(diff) <= 10 else "⚠️"
                print(f"   {status} {dentist}: Diff £{diff:,.2f} | {len(xref['dentally_only'])} not in log, {len(xref['log_only'])} not in Dentally")
    
    # Payment flags summary
    total_flags = sum(len(p.get("payment_flags", [])) for p in payslips.values())
    if total_flags > 0:
        print(f"\n🚨 {total_flags} UNPAID/BALANCE FLAGS - Check Cross-Reference tab!")
    
    return payslips


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate dental practice payslips")
    parser.add_argument("--year", type=int, help="Year (default: previous month)")
    parser.add_argument("--month", type=int, help="Month 1-12 (default: previous month)")
    parser.add_argument("--pdf-only", action="store_true", help="Generate PDFs only (no Dentally API)")
    parser.add_argument("--email", action="store_true", help="Send payslips via email")
    parser.add_argument("--email-to", type=str, help="Override email recipient")
    parser.add_argument("--generate-pdfs", action="store_true", help="Generate PDFs after calculation")
    
    args = parser.parse_args()
    
    if args.pdf_only:
        # PDF generation only mode
        run_pdf_generation_only(
            args.year, args.month,
            send_email=args.email,
            recipient_email=args.email_to
        )
    else:
        # Full payslip generation
        payslips = run_payslip_generator(args.year, args.month)
        
        # Generate PDFs if requested
        if payslips and (args.generate_pdfs or args.email):
            # Determine period
            if args.year is None or args.month is None:
                today = datetime.now()
                if today.month == 1:
                    year = today.year - 1
                    month = 12
                else:
                    year = today.year
                    month = today.month - 1
            else:
                year = args.year
                month = args.month
            
            period_str = datetime(year, month, 1).strftime("%B %Y")
            
            # Generate PDFs
            pdf_files = generate_all_payslip_pdfs(payslips, period_str)
            
            # Send email if requested
            if args.email and pdf_files:
                send_payslips_email(pdf_files, period_str, args.email_to)
