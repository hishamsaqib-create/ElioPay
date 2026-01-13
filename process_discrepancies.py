#!/usr/bin/env python3
"""
Aura Dental - Process Discrepancies
====================================
Reads ticked discrepancy items from payslip spreadsheet and updates patient breakdowns.

v3.0 Changes:
- Fixed "Add to Pay" to UPDATE existing £0.00 rows instead of inserting duplicates
- Handle different discrepancy section layouts (IN LOG, AMOUNT MISMATCH, etc.)
- Fixed Total row formula and patient count
- Fixed Gross Private linking
- Added rate limiting to avoid API quota errors
- Better error handling and logging

Usage:
  python process_discrepancies.py --month 12 --year 2025

Or via GitHub Actions workflow.
"""

import os
import sys
import json
import base64
import argparse
import time
import re
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from datetime import datetime

# =============================================================================
# CONFIGURATION
# =============================================================================

GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
PAYSLIPS_FOLDER_ID = os.environ.get("PAYSLIPS_FOLDER_ID", "")

# Rate limiting - delay between API calls (seconds)
API_DELAY = 1.2

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

# =============================================================================
# GOOGLE CLIENTS
# =============================================================================

def get_credentials():
    """Get Google credentials (base64 encoded)."""
    print(f"\n🔐 Checking credentials...")
    print(f"   Raw length: {len(GOOGLE_SHEETS_CREDENTIALS)} chars")
    
    if not GOOGLE_SHEETS_CREDENTIALS or not GOOGLE_SHEETS_CREDENTIALS.strip():
        raise ValueError("GOOGLE_SHEETS_CREDENTIALS environment variable not set or empty")
    
    creds_str = GOOGLE_SHEETS_CREDENTIALS.strip()
    
    # Decode from base64
    try:
        decoded = base64.b64decode(creds_str)
        creds_dict = json.loads(decoded)
        print(f"   ✅ Credentials decoded successfully")
    except Exception as e:
        print(f"   ❌ Failed to decode credentials: {e}")
        raise ValueError(f"GOOGLE_SHEETS_CREDENTIALS decode failed: {e}")
    
    return Credentials.from_service_account_info(creds_dict, scopes=SCOPES)


def get_sheets_client():
    """Initialize Google Sheets client."""
    credentials = get_credentials()
    return gspread.authorize(credentials)


def get_drive_service():
    """Initialize Google Drive service."""
    credentials = get_credentials()
    return build('drive', 'v3', credentials=credentials)


def find_monthly_spreadsheet(client, drive_service, month, year):
    """Find the payslip spreadsheet for given month/year using Drive API."""
    month_name = datetime(year, month, 1).strftime("%B")
    sheet_name = f"Aura Payslips - {month_name} {year}"
    
    print(f"\n📊 Looking for: {sheet_name}")
    
    try:
        query = f"name = '{sheet_name}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"
        
        results = drive_service.files().list(
            q=query,
            fields="files(id, name)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True
        ).execute()
        
        files = results.get('files', [])
        
        if files:
            file_id = files[0]['id']
            print(f"   ✅ Found: {files[0]['name']}")
            return client.open_by_key(file_id)
        
        print(f"   ❌ Not found: {sheet_name}")
        return None
        
    except Exception as e:
        print(f"   ❌ Error searching: {e}")
        return None


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def parse_amount(val):
    """Parse amount from various formats."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    try:
        cleaned = str(val).replace('£', '').replace(',', '').strip()
        if not cleaned:
            return 0.0
        return float(cleaned)
    except:
        return 0.0


def is_section_header(text):
    """Check if text is a section header."""
    text_lower = text.lower()
    headers = [
        'in log', 'amount mismatch', 'in dentally', 'unpaid', 'balance',
        'patient name', 'discrepancies', '───', '═══', '🔴', '🟡', '🔵', '🟠'
    ]
    return any(h in text_lower for h in headers)


def find_patient_in_breakdown(data, patient_start, patient_end, patient_name):
    """
    Find a patient in the breakdown section.
    Returns (row_index, current_amount) or (None, None) if not found.
    row_index is 0-indexed.
    """
    patient_lower = patient_name.lower().strip()
    
    for i in range(patient_start, patient_end):
        if i >= len(data):
            break
        row = data[i]
        if len(row) > 1:
            cell_val = str(row[1]).strip().lower()
            if cell_val == patient_lower:
                # Get current amount from column E (index 4)
                current_amount = parse_amount(row[4] if len(row) > 4 else 0)
                return i, current_amount
    
    return None, None


# =============================================================================
# DISCREPANCY PARSING
# =============================================================================

def find_section_rows(data):
    """
    Find key row indices in the payslip.
    """
    sections = {
        'patient_header': -1,
        'patient_start': -1,
        'patient_end': -1,
        'discrepancies_start': -1
    }
    
    for i, row in enumerate(data):
        cell_b = str(row[1] if len(row) > 1 else '').lower()
        
        # Find patient breakdown header (look for "Patient Name" header row)
        if 'patient name' in cell_b and sections['patient_header'] < 0:
            # Check if this is the breakdown header (has Date, Status, Amount nearby)
            row_text = ' '.join(str(c).lower() for c in row)
            if 'date' in row_text or 'status' in row_text or 'amount' in row_text:
                sections['patient_header'] = i
                sections['patient_start'] = i + 1
            
        # Find total row (end of patient list)
        if sections['patient_start'] > 0 and sections['patient_end'] < 0:
            if cell_b.startswith('total:') and 'patient' in cell_b:
                sections['patient_end'] = i
        
        # Find discrepancies section
        if 'discrepancies to review' in cell_b:
            sections['discrepancies_start'] = i
    
    return sections


def parse_discrepancy_items(data, start_row):
    """
    Parse all discrepancy rows, handling different section layouts.
    
    Section types and their column layouts:
    - IN LOG NOT DENTALLY: B=Patient, C=Date, D=Amount, E=New£, F=Action, G=Checkbox
    - AMOUNT MISMATCH: B=Patient, C=Dentally£, D=Log£, E=New£, F=Action, G=Checkbox
    - IN DENTALLY NOT LOG: B=Patient, C=Date, D=Amount, E=New£, F=Action, G=Checkbox
    - UNPAID/BALANCE: B=Patient, C=Date, D=Amount, E=New£, F=Action, G=Checkbox
    """
    items = []
    current_section = None
    
    for i in range(start_row, len(data)):
        row = data[i]
        
        if len(row) < 2:
            continue
            
        cell_b = str(row[1]).strip()
        cell_b_lower = cell_b.lower()
        
        # Detect section headers
        if 'in log' in cell_b_lower and 'dentally' in cell_b_lower:
            current_section = 'IN_LOG_NOT_DENTALLY'
            continue
        elif 'amount mismatch' in cell_b_lower:
            current_section = 'AMOUNT_MISMATCH'
            continue
        elif 'in dentally' in cell_b_lower and 'log' in cell_b_lower:
            current_section = 'IN_DENTALLY_NOT_LOG'
            continue
        elif 'unpaid' in cell_b_lower or 'balance' in cell_b_lower:
            current_section = 'UNPAID_BALANCE'
            continue
        elif 'therapy' in cell_b_lower:
            # Stop at therapy section
            break
        
        # Skip other headers
        if is_section_header(cell_b):
            continue
        
        # Skip empty patient names
        if not cell_b or cell_b_lower in ['patient', 'patient name']:
            continue
        
        # Check if checkbox is ticked (column G, index 6)
        is_checked = False
        if len(row) > 6:
            checkbox_val = row[6]
            is_checked = checkbox_val == True or str(checkbox_val).upper() == 'TRUE'
        
        if not is_checked:
            continue
        
        # Parse based on section type
        patient = cell_b
        date_val = ''
        amount = 0.0
        new_amount = 0.0
        action = ''
        
        if current_section == 'AMOUNT_MISMATCH':
            # B=Patient, C=Dentally£, D=Log£, E=New£, F=Action
            # Use Log£ as the reference amount
            amount = parse_amount(row[3] if len(row) > 3 else 0)  # Log £
            new_amount = parse_amount(row[4] if len(row) > 4 else 0)  # New £
            action = str(row[5] if len(row) > 5 else '').strip()
        else:
            # Standard layout: B=Patient, C=Date, D=Amount, E=New£, F=Action
            date_val = str(row[2] if len(row) > 2 else '').strip()
            amount = parse_amount(row[3] if len(row) > 3 else 0)
            new_amount = parse_amount(row[4] if len(row) > 4 else 0)
            action = str(row[5] if len(row) > 5 else '').strip()
        
        # Skip if no action
        if not action:
            continue
        
        items.append({
            'row': i + 1,  # 1-indexed for Google Sheets
            'patient': patient,
            'date': date_val,
            'amount': amount,
            'new_amount': new_amount,
            'action': action,
            'section': current_section
        })
        
        print(f"         📝 Parsed: {patient} | {action} | amt={amount} | new={new_amount} | section={current_section}")
    
    return items


# =============================================================================
# DISCREPANCY PROCESSING
# =============================================================================

def process_dentist_discrepancies(spreadsheet, sheet_name):
    """
    Process discrepancies for a single dentist's payslip.
    """
    results = {'added': 0, 'removed': 0, 'updated': 0, 'errors': [], 'processed_patients': []}
    
    try:
        sheet = spreadsheet.worksheet(sheet_name)
    except Exception as e:
        results['errors'].append(f"Could not open sheet: {e}")
        return results
    
    # Get all data
    data = sheet.get_all_values()
    
    # Find sections
    sections = find_section_rows(data)
    
    print(f"      Patient header: row {sections['patient_header']+1}")
    print(f"      Patient data: rows {sections['patient_start']+1} to {sections['patient_end']+1}")
    print(f"      Discrepancies: row {sections['discrepancies_start']+1}")
    
    if sections['discrepancies_start'] < 0:
        print(f"      ℹ️ No discrepancies section found")
        return results
    
    if sections['patient_start'] < 0 or sections['patient_end'] < 0:
        results['errors'].append("Could not find patient breakdown section")
        return results
    
    # Parse discrepancy items
    print(f"      📋 Parsing discrepancy items...")
    items = parse_discrepancy_items(data, sections['discrepancies_start'])
    
    if not items:
        print(f"      ℹ️ No ticked items to process")
        return results
    
    print(f"      📋 Found {len(items)} ticked item(s) to process")
    
    # Group by action type
    adds = [i for i in items if i['action'] == 'Add to Pay']
    removes = [i for i in items if i['action'] == 'Remove from Pay']
    updates = [i for i in items if i['action'] == 'Update Amount']
    
    print(f"         → {len(adds)} adds, {len(removes)} removes, {len(updates)} updates")
    
    # Track row offset
    row_offset = 0
    
    # ===================
    # PROCESS REMOVES FIRST
    # ===================
    for item in removes:
        patient = item['patient']
        try:
            time.sleep(API_DELAY)
            current_data = sheet.get_all_values()
            
            row_idx, _ = find_patient_in_breakdown(
                current_data, 
                sections['patient_start'], 
                sections['patient_end'] + row_offset,
                patient
            )
            
            if row_idx is not None:
                time.sleep(API_DELAY)
                sheet.delete_rows(row_idx + 1)  # Convert to 1-indexed
                print(f"         ✅ Removed: {patient}")
                results['removed'] += 1
                row_offset -= 1
                results['processed_patients'].append(patient.lower())
            else:
                print(f"         ⚠️ Not found to remove: {patient}")
                results['errors'].append(f"Could not find '{patient}' to remove")
                
        except Exception as e:
            print(f"         ❌ Error removing {patient}: {e}")
            results['errors'].append(f"Error removing '{patient}': {e}")
    
    # ===================
    # PROCESS UPDATES
    # ===================
    for item in updates:
        patient = item['patient']
        new_amount = item['new_amount']
        
        if new_amount <= 0:
            print(f"         ⚠️ No new amount for update: {patient}")
            results['errors'].append(f"No new amount for '{patient}'")
            continue
        
        try:
            time.sleep(API_DELAY)
            current_data = sheet.get_all_values()
            
            row_idx, current_amount = find_patient_in_breakdown(
                current_data,
                sections['patient_start'],
                sections['patient_end'] + row_offset,
                patient
            )
            
            if row_idx is not None:
                time.sleep(API_DELAY)
                sheet.update_cell(row_idx + 1, 5, new_amount)  # Column E
                print(f"         ✅ Updated: {patient} £{current_amount:.2f} → £{new_amount:.2f}")
                results['updated'] += 1
                results['processed_patients'].append(patient.lower())
            else:
                print(f"         ⚠️ Not found to update: {patient}")
                results['errors'].append(f"Could not find '{patient}' to update")
                
        except Exception as e:
            print(f"         ❌ Error updating {patient}: {e}")
            results['errors'].append(f"Error updating '{patient}': {e}")
    
    # ===================
    # PROCESS ADDS
    # Key fix: Check if patient already exists (with £0.00) - if so, UPDATE instead of INSERT
    # ===================
    for item in adds:
        patient = item['patient']
        final_amount = item['new_amount'] if item['new_amount'] > 0 else item['amount']
        date_val = item['date'] if item['date'] else ''
        
        if final_amount <= 0:
            print(f"         ⚠️ No amount for add: {patient}")
            results['errors'].append(f"No amount for '{patient}'")
            continue
        
        try:
            time.sleep(API_DELAY)
            current_data = sheet.get_all_values()
            
            # Check if patient already exists in breakdown
            row_idx, current_amount = find_patient_in_breakdown(
                current_data,
                sections['patient_start'],
                sections['patient_end'] + row_offset,
                patient
            )
            
            if row_idx is not None:
                # Patient exists - UPDATE instead of INSERT
                time.sleep(API_DELAY)
                sheet.update_cell(row_idx + 1, 5, final_amount)  # Column E = Amount
                
                # Also update status to ✓ (column D)
                time.sleep(API_DELAY)
                sheet.update_cell(row_idx + 1, 4, '✓')
                
                print(f"         ✅ Updated existing: {patient} £{current_amount:.2f} → £{final_amount:.2f}")
                results['updated'] += 1
                results['processed_patients'].append(patient.lower())
            else:
                # Patient doesn't exist - INSERT new row
                time.sleep(API_DELAY)
                current_data = sheet.get_all_values()
                
                # Find current Total row
                current_total_row = -1
                for i, row in enumerate(current_data):
                    cell_b = str(row[1] if len(row) > 1 else '').lower()
                    if cell_b.startswith('total:') and 'patient' in cell_b:
                        current_total_row = i + 1
                        break
                
                if current_total_row < 0:
                    print(f"         ⚠️ Could not find Total row for insert")
                    results['errors'].append(f"Could not find Total row to insert '{patient}'")
                    continue
                
                time.sleep(API_DELAY)
                new_row = ['', patient, date_val, '✓', final_amount, '', '', '']
                sheet.insert_row(new_row, current_total_row)
                
                print(f"         ✅ Added new: {patient} - £{final_amount:.2f}")
                results['added'] += 1
                results['processed_patients'].append(patient.lower())
                row_offset += 1
                
        except Exception as e:
            print(f"         ❌ Error adding {patient}: {e}")
            results['errors'].append(f"Error adding '{patient}': {e}")
    
    # ===================
    # UPDATE TOTALS
    # ===================
    total_processed = results['added'] + results['removed'] + results['updated']
    
    if total_processed > 0:
        print(f"      📊 Updating totals...")
        
        try:
            time.sleep(API_DELAY * 2)
            current_data = sheet.get_all_values()
            
            # Find new boundaries
            new_patient_start = -1
            new_patient_end = -1
            
            for i, row in enumerate(current_data):
                cell_b = str(row[1] if len(row) > 1 else '').lower()
                
                # Find header row
                if 'patient name' in cell_b and new_patient_start < 0:
                    row_text = ' '.join(str(c).lower() for c in row)
                    if 'date' in row_text or 'status' in row_text:
                        new_patient_start = i + 2  # 1-indexed, skip header
                
                # Find total row
                if new_patient_start > 0 and new_patient_end < 0:
                    if cell_b.startswith('total:') and 'patient' in cell_b:
                        new_patient_end = i + 1  # 1-indexed
            
            if new_patient_start > 0 and new_patient_end > 0:
                patient_count = new_patient_end - new_patient_start
                
                # Update Total label
                time.sleep(API_DELAY)
                sheet.update_cell(new_patient_end, 2, f'Total: {patient_count} patients')
                
                # Update SUM formula
                time.sleep(API_DELAY)
                sum_formula = f'=SUM(E{new_patient_start}:E{new_patient_end - 1})'
                sheet.update_cell(new_patient_end, 5, sum_formula)
                
                print(f"      ✅ Total: {patient_count} patients, SUM(E{new_patient_start}:E{new_patient_end - 1})")
                
                # Format currency
                time.sleep(API_DELAY)
                try:
                    sheet.format(f'E{new_patient_start}:E{new_patient_end}', {
                        'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'},
                        'horizontalAlignment': 'RIGHT'
                    })
                except Exception as e:
                    print(f"      ⚠️ Format warning: {e}")
                
                # Update Gross Private link
                # Look in first 15 rows for "Gross Private" in column C
                for i in range(min(15, len(current_data))):
                    row = current_data[i]
                    cell_c = str(row[2] if len(row) > 2 else '').lower()
                    if 'gross private' in cell_c and 'patient' in cell_c:
                        time.sleep(API_DELAY)
                        sheet.update_cell(i + 1, 7, f'=E{new_patient_end}')  # Column G
                        print(f"      ✅ Linked Gross Private (row {i+1}) to Total")
                        break
                        
        except Exception as e:
            print(f"      ⚠️ Error updating totals: {e}")
            results['errors'].append(f"Error updating totals: {e}")
    
    # ===================
    # DELETE PROCESSED DISCREPANCY ROWS
    # ===================
    if results['processed_patients']:
        print(f"      🗑️ Cleaning up {len(results['processed_patients'])} processed rows...")
        
        try:
            time.sleep(API_DELAY * 2)
            current_data = sheet.get_all_values()
            
            # Find discrepancies section
            disc_start = -1
            for i, row in enumerate(current_data):
                cell_b = str(row[1] if len(row) > 1 else '').lower()
                if 'discrepancies to review' in cell_b:
                    disc_start = i
                    break
            
            if disc_start > 0:
                rows_to_delete = []
                
                for i in range(disc_start, len(current_data)):
                    row = current_data[i]
                    if len(row) > 6:
                        patient_name = str(row[1]).strip().lower()
                        checkbox = row[6]
                        is_checked = str(checkbox).upper() == 'TRUE'
                        
                        if is_checked and patient_name in results['processed_patients']:
                            rows_to_delete.append(i + 1)
                
                # Delete in reverse order
                deleted_count = 0
                for row_num in sorted(rows_to_delete, reverse=True):
                    try:
                        time.sleep(API_DELAY)
                        sheet.delete_rows(row_num)
                        deleted_count += 1
                    except Exception as e:
                        print(f"         ⚠️ Could not delete row {row_num}: {e}")
                
                print(f"      ✅ Deleted {deleted_count} discrepancy row(s)")
                
        except Exception as e:
            print(f"      ⚠️ Error cleaning up: {e}")
    
    return results


def process_all_discrepancies(spreadsheet):
    """Process discrepancies for all dentist payslips."""
    
    print("\n" + "="*60)
    print("PROCESSING DISCREPANCIES")
    print("="*60)
    
    worksheets = spreadsheet.worksheets()
    payslip_tabs = [ws.title for ws in worksheets if 'Payslip' in ws.title]
    
    print(f"\n📋 Found {len(payslip_tabs)} payslip tab(s)")
    
    total_results = {'added': 0, 'removed': 0, 'updated': 0, 'errors': []}
    
    for tab_name in payslip_tabs:
        dentist_name = tab_name.replace(' Payslip', '')
        print(f"\n   👤 {dentist_name}")
        
        results = process_dentist_discrepancies(spreadsheet, tab_name)
        
        total_results['added'] += results['added']
        total_results['removed'] += results['removed']
        total_results['updated'] += results['updated']
        total_results['errors'].extend(results['errors'])
        
        time.sleep(API_DELAY * 2)
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"   ✅ Added:   {total_results['added']}")
    print(f"   ✅ Removed: {total_results['removed']}")
    print(f"   ✅ Updated: {total_results['updated']}")
    
    if total_results['errors']:
        print(f"\n   ⚠️ Warnings ({len(total_results['errors'])}):")
        for err in total_results['errors'][:10]:
            print(f"      - {err}")
        if len(total_results['errors']) > 10:
            print(f"      ... and {len(total_results['errors']) - 10} more")
    
    total_processed = total_results['added'] + total_results['removed'] + total_results['updated']
    print(f"\n   📊 Total items processed: {total_processed}")
    
    return total_results


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Process payslip discrepancies')
    parser.add_argument('--month', type=int, required=False, help='Month (1-12)')
    parser.add_argument('--year', type=int, required=False, help='Year (e.g., 2025)')
    args = parser.parse_args()
    
    # Default to previous month
    if args.month and args.year:
        month = args.month
        year = args.year
    else:
        today = datetime.now()
        if today.month == 1:
            month = 12
            year = today.year - 1
        else:
            month = today.month - 1
            year = today.year
    
    print("="*60)
    print("AURA DENTAL - PROCESS DISCREPANCIES v3.0")
    print("="*60)
    print(f"Month: {month}/{year}")
    print(f"API Delay: {API_DELAY}s between calls")
    
    client = get_sheets_client()
    drive_service = get_drive_service()
    
    spreadsheet = find_monthly_spreadsheet(client, drive_service, month, year)
    
    if not spreadsheet:
        print("\n❌ Could not find spreadsheet.")
        sys.exit(1)
    
    results = process_all_discrepancies(spreadsheet)
    
    total = results['added'] + results['removed'] + results['updated']
    
    if total > 0:
        print(f"\n✅ Successfully processed {total} item(s)")
    else:
        print("\n📋 No items to process")
    
    if results['errors']:
        print(f"⚠️ {len(results['errors'])} warning(s) - check logs")
    
    print("\n🔗 View:", spreadsheet.url)


if __name__ == "__main__":
    main()
