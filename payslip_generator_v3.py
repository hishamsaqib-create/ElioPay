#!/usr/bin/env python3
"""
Aura Dental Clinic - Payslip Generator v3.0
Pulls from Dentally, updates Google Sheets, generates PDFs

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

# Historical Payslips Folder (for duplicate detection)
HISTORICAL_PAYSLIPS_FOLDER_ID = "1rcE4JFqnNj8jXHUCmQyoPn5DYDKSjNpJ"

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
    
    # Total Payment
    total_pay_row = len(rows) + 1
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
    
    # Discrepancies section divider
    rows.append(["", "─" * 50, "", "", "", "", "", ""])
    
    discrep_header_row = len(rows) + 1
    rows.append(["", "⚠️ DISCREPANCIES TO REVIEW", "", "", "", "", "", ""])
    rows.append(["", "Select action, enter amount if needed, tick Confirm to apply", "", "", "", "", "", ""])
    
    rows.append(["", "", "", "", "", "", "", ""])
    
    # Log only header - new format with action dropdown
    rows.append(["", "🔴 IN LOG BUT NOT IN DENTALLY (Check if missed)", "", "", "", "", "", ""])
    rows.append(["", "Patient Name", "Date", "Amount", "New £", "Action", "Confirm", ""])
    
    # Write all data
    sh.update(values=rows, range_name='A1', value_input_option='USER_ENTERED')
    
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
        
        # Amount columns - currency format (E and G)
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 8, 'endRowIndex': patient_end_row + 10, 'startColumnIndex': 4, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
            'fields': 'userEnteredFormat.numberFormat'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 8, 'endRowIndex': patient_end_row + 10, 'startColumnIndex': 6, 'endColumnIndex': 7},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'}}},
            'fields': 'userEnteredFormat.numberFormat'}},
        
        # Discrepancies header - warning color
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': discrep_header_row - 1, 'endRowIndex': discrep_header_row, 'startColumnIndex': 1, 'endColumnIndex': 5},
            'cell': {'userEnteredFormat': {
                'textFormat': {'bold': True, 'foregroundColor': SHEET_COLORS['warning_text']}}},
            'fields': 'userEnteredFormat.textFormat'}},
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
        
        # Consolidate patient_totals into patients list (sorted by date chronologically)
        p["patients"] = sorted([
            {
                "name": pt["name"], 
                "amount": pt["total"],  # Total for cross-reference
                "paid_amount": pt["paid_total"],  # Paid amount for payslip
                "date": pt["last_date"],
                "payment_flag": pt["payment_flag"]
            }
            for pt in p["patient_totals"].values()
        ], key=lambda x: x["date"] or "9999-99-99")  # Sort by date, empty dates at end
        
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
    
    # Build historical database and check for duplicates
    all_duplicates = []
    drive_service = get_drive_service()
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
    
    args = parser.parse_args()
    
    run_payslip_generator(args.year, args.month)
