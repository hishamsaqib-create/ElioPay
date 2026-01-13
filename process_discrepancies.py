#!/usr/bin/env python3
"""
Aura Dental - Process Discrepancies
====================================
Reads ticked discrepancy items from payslip spreadsheet and updates patient breakdowns.

v2.0 Changes:
- Added rate limiting to avoid API quota errors
- Uses batch updates where possible
- Fixed column mapping for patient breakdown
- Better error handling

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
API_DELAY = 1.5

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
        # Search using Drive API for better reliability with shared drives
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
# DISCREPANCY PROCESSING
# =============================================================================

def find_section_rows(data):
    """
    Find key row indices in the payslip.
    
    Returns dict with:
        - patient_header: Row with "Patient Name" header
        - patient_start: First data row of patient breakdown
        - patient_end: Row with "Total: X patients"
        - discrepancies_start: Row with "DISCREPANCIES TO REVIEW"
    """
    sections = {
        'patient_header': -1,
        'patient_start': -1,
        'patient_end': -1,
        'discrepancies_start': -1
    }
    
    for i, row in enumerate(data):
        cell_b = str(row[1] if len(row) > 1 else '').lower()
        
        # Find patient breakdown header
        if 'patient name' in cell_b:
            sections['patient_header'] = i
            sections['patient_start'] = i + 1  # Data starts on next row
            
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
    Parse discrepancy rows and return items to process.
    
    Expected columns (0-indexed):
        1 (B): Patient name
        2 (C): Date or Dentally £
        3 (D): Amount or Log £
        4 (E): New £
        5 (F): Action
        6 (G): Checkbox (TRUE/FALSE)
    """
    items = []
    
    for i in range(start_row, len(data)):
        row = data[i]
        
        # Stop if we hit another section or empty rows
        if len(row) < 2 or not row[1]:
            continue
            
        # Skip header rows
        cell_b_lower = str(row[1]).lower()
        if any(x in cell_b_lower for x in ['patient name', 'in log', 'amount mismatch', 'in dentally', 'unpaid', '───', '═══', 'discrepancies']):
            continue
        
        # Check if checkbox is ticked (column G, index 6)
        is_checked = False
        if len(row) > 6:
            checkbox_val = row[6]
            is_checked = checkbox_val == True or str(checkbox_val).upper() == 'TRUE'
        
        if not is_checked:
            continue
        
        # Get values
        patient = str(row[1] if len(row) > 1 else '').strip()
        date_val = str(row[2] if len(row) > 2 else '').strip()
        amount_val = row[3] if len(row) > 3 else 0
        new_amount_val = row[4] if len(row) > 4 else 0
        action = str(row[5] if len(row) > 5 else '').strip()
        
        # Parse amounts
        def parse_amount(val):
            if isinstance(val, (int, float)):
                return float(val)
            try:
                return float(str(val).replace('£', '').replace(',', '').strip())
            except:
                return 0.0
        
        amount = parse_amount(amount_val)
        new_amount = parse_amount(new_amount_val)
        
        # Skip if no patient or action
        if not patient or not action:
            continue
        
        items.append({
            'row': i + 1,  # 1-indexed for Google Sheets
            'patient': patient,
            'date': date_val,
            'amount': amount,
            'new_amount': new_amount,
            'action': action
        })
    
    return items


def process_dentist_discrepancies(spreadsheet, sheet_name):
    """
    Process discrepancies for a single dentist's payslip.
    
    Returns dict with counts: added, removed, updated, errors
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
    print(f"      Discrepancies start: row {sections['discrepancies_start']+1}")
    
    if sections['discrepancies_start'] < 0:
        print(f"      ℹ️ No discrepancies section found")
        return results
    
    if sections['patient_start'] < 0 or sections['patient_end'] < 0:
        results['errors'].append("Could not find patient breakdown section")
        return results
    
    # Parse discrepancy items
    items = parse_discrepancy_items(data, sections['discrepancies_start'])
    
    if not items:
        print(f"      ℹ️ No ticked items to process")
        return results
    
    print(f"      📋 Found {len(items)} ticked item(s)")
    
    # Group items by action type for more efficient processing
    adds = [i for i in items if i['action'] == 'Add to Pay']
    removes = [i for i in items if i['action'] == 'Remove from Pay']
    updates = [i for i in items if i['action'] == 'Update Amount']
    
    print(f"         → {len(adds)} to add, {len(removes)} to remove, {len(updates)} to update")
    
    # Track row offset as we insert/delete rows
    row_offset = 0
    
    # Process REMOVES first (so row numbers don't shift for other operations)
    for item in removes:
        patient = item['patient']
        try:
            # Re-read data to get current state
            time.sleep(API_DELAY)
            current_data = sheet.get_all_values()
            
            found = False
            for i in range(sections['patient_start'], sections['patient_end'] + row_offset):
                if i >= len(current_data):
                    break
                cell_val = str(current_data[i][1] if len(current_data[i]) > 1 else '').strip().lower()
                if cell_val == patient.lower():
                    time.sleep(API_DELAY)
                    sheet.delete_rows(i + 1)
                    print(f"         ✅ Removed: {patient}")
                    results['removed'] += 1
                    row_offset -= 1
                    found = True
                    results['processed_patients'].append(patient.lower())
                    break
            
            if not found:
                print(f"         ⚠️ Not found to remove: {patient}")
                results['errors'].append(f"Could not find '{patient}' to remove")
                
        except Exception as e:
            print(f"         ❌ Error removing {patient}: {e}")
            results['errors'].append(f"Error removing '{patient}': {e}")
    
    # Process UPDATES
    for item in updates:
        patient = item['patient']
        new_amount = item['new_amount']
        
        if new_amount <= 0:
            print(f"         ⚠️ No new amount for: {patient}")
            results['errors'].append(f"No new amount for '{patient}'")
            continue
        
        try:
            time.sleep(API_DELAY)
            current_data = sheet.get_all_values()
            
            found = False
            for i in range(sections['patient_start'], sections['patient_end'] + row_offset):
                if i >= len(current_data):
                    break
                cell_val = str(current_data[i][1] if len(current_data[i]) > 1 else '').strip().lower()
                if cell_val == patient.lower():
                    time.sleep(API_DELAY)
                    # Update amount in column E (index 5, but 1-indexed = 5)
                    sheet.update_cell(i + 1, 5, new_amount)
                    print(f"         ✅ Updated: {patient} → £{new_amount:.2f}")
                    results['updated'] += 1
                    found = True
                    results['processed_patients'].append(patient.lower())
                    break
            
            if not found:
                print(f"         ⚠️ Not found to update: {patient}")
                results['errors'].append(f"Could not find '{patient}' to update")
                
        except Exception as e:
            print(f"         ❌ Error updating {patient}: {e}")
            results['errors'].append(f"Error updating '{patient}': {e}")
    
    # Process ADDS last (insert before Total row)
    if adds:
        try:
            time.sleep(API_DELAY)
            current_data = sheet.get_all_values()
            
            # Find current Total row position
            current_total_row = -1
            for i, row in enumerate(current_data):
                cell_b = str(row[1] if len(row) > 1 else '').lower()
                if cell_b.startswith('total:') and 'patient' in cell_b:
                    current_total_row = i + 1  # 1-indexed
                    break
            
            if current_total_row < 0:
                print(f"         ⚠️ Could not find Total row for inserts")
            else:
                # Insert all new rows at once using batch
                insert_row = current_total_row
                
                for item in adds:
                    patient = item['patient']
                    final_amount = item['new_amount'] if item['new_amount'] > 0 else item['amount']
                    date_val = item['date'] if item['date'] else ''
                    
                    try:
                        time.sleep(API_DELAY)
                        
                        # Insert row with all values at once
                        new_row = ['', patient, date_val, '✓', final_amount, '', '', '']
                        sheet.insert_row(new_row, insert_row)
                        
                        print(f"         ✅ Added: {patient} - £{final_amount:.2f}")
                        results['added'] += 1
                        results['processed_patients'].append(patient.lower())
                        insert_row += 1  # Next insert goes after this one
                        row_offset += 1
                        
                    except Exception as e:
                        print(f"         ❌ Error adding {patient}: {e}")
                        results['errors'].append(f"Error adding '{patient}': {e}")
                        
        except Exception as e:
            print(f"         ❌ Error in add phase: {e}")
            results['errors'].append(f"Error in add phase: {e}")
    
    # Update totals and format
    total_processed = results['added'] + results['removed'] + results['updated']
    
    if total_processed > 0:
        print(f"      📊 Updating totals and formatting...")
        
        try:
            time.sleep(API_DELAY * 2)  # Extra delay before final updates
            current_data = sheet.get_all_values()
            
            # Find new section boundaries
            new_patient_start = -1
            new_patient_end = -1
            
            for i, row in enumerate(current_data):
                cell_b = str(row[1] if len(row) > 1 else '').lower()
                if 'patient name' in cell_b:
                    new_patient_start = i + 2  # Data starts after header (1-indexed)
                if new_patient_start > 0 and new_patient_end < 0:
                    if cell_b.startswith('total:') and 'patient' in cell_b:
                        new_patient_end = i + 1  # 1-indexed
            
            if new_patient_start > 0 and new_patient_end > 0:
                # Count patients
                patient_count = new_patient_end - new_patient_start
                
                # Update Total row
                time.sleep(API_DELAY)
                sheet.update_cell(new_patient_end, 2, f'Total: {patient_count} patients')
                
                time.sleep(API_DELAY)
                sum_formula = f'=SUM(E{new_patient_start}:E{new_patient_end - 1})'
                sheet.update_cell(new_patient_end, 5, sum_formula)
                print(f"      ✅ Updated Total row: {patient_count} patients")
                
                # Format amount column for new rows as currency
                time.sleep(API_DELAY)
                try:
                    sheet.format(f'E{new_patient_start}:E{new_patient_end}', {
                        'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'},
                        'horizontalAlignment': 'RIGHT'
                    })
                except Exception as e:
                    print(f"      ⚠️ Could not format currency: {e}")
            
            # Update Gross Private reference to point to Total
            for i in range(min(20, len(current_data))):
                row = current_data[i]
                if len(row) > 2:
                    cell_c = str(row[2]).lower()
                    if 'gross private' in cell_c and 'patient' in cell_c:
                        if new_patient_end > 0:
                            time.sleep(API_DELAY)
                            # Column G (index 7, 1-indexed = 7)
                            sheet.update_cell(i + 1, 7, f'=E{new_patient_end}')
                            print(f"      ✅ Linked Gross Private to Total")
                        break
                        
        except Exception as e:
            print(f"      ⚠️ Error updating totals: {e}")
            results['errors'].append(f"Error updating totals: {e}")
    
    # Delete processed discrepancy rows
    if results['processed_patients']:
        print(f"      🗑️ Cleaning up {len(results['processed_patients'])} processed discrepancy rows...")
        
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
    
    # Find all payslip tabs
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
        
        # Delay between dentists
        time.sleep(API_DELAY * 2)
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"   ✅ Added:   {total_results['added']}")
    print(f"   ✅ Removed: {total_results['removed']}")
    print(f"   ✅ Updated: {total_results['updated']}")
    
    if total_results['errors']:
        print(f"\n   ⚠️ Errors ({len(total_results['errors'])}):")
        for err in total_results['errors'][:10]:  # Show first 10
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
    parser.add_argument('--month', type=int, required=False, help='Month (1-12), defaults to previous month')
    parser.add_argument('--year', type=int, required=False, help='Year (e.g., 2025), defaults to previous month')
    args = parser.parse_args()
    
    # Default to previous month if not specified
    if args.month and args.year:
        month = args.month
        year = args.year
    else:
        today = datetime.now()
        # Get previous month
        if today.month == 1:
            month = 12
            year = today.year - 1
        else:
            month = today.month - 1
            year = today.year
    
    print("="*60)
    print("AURA DENTAL - PROCESS DISCREPANCIES v2.0")
    print("="*60)
    print(f"Month: {month}/{year}")
    print(f"API Delay: {API_DELAY}s between calls")
    
    # Initialize clients
    client = get_sheets_client()
    drive_service = get_drive_service()
    
    # Find spreadsheet
    spreadsheet = find_monthly_spreadsheet(client, drive_service, month, year)
    
    if not spreadsheet:
        print("\n❌ Could not find spreadsheet. Make sure payslips have been generated first.")
        sys.exit(1)
    
    # Process discrepancies
    results = process_all_discrepancies(spreadsheet)
    
    total = results['added'] + results['removed'] + results['updated']
    
    if total > 0:
        print(f"\n✅ Successfully processed {total} discrepancy item(s)")
    else:
        print("\n📋 No discrepancy items to process")
    
    if results['errors']:
        print(f"⚠️ {len(results['errors'])} warning(s) occurred - check logs above")
        # Don't exit with error code for minor warnings
    
    print("\n🔗 View spreadsheet:", spreadsheet.url)


if __name__ == "__main__":
    main()
