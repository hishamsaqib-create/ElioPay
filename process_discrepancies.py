#!/usr/bin/env python3
"""
Aura Dental - Process Discrepancies
====================================
Reads ticked discrepancy items from payslip spreadsheet and updates patient breakdowns.

Usage:
  python process_discrepancies.py --month 12 --year 2025

Or via GitHub Actions workflow.
"""

import os
import sys
import json
import base64
import argparse
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from datetime import datetime

# =============================================================================
# CONFIGURATION
# =============================================================================

GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
PAYSLIPS_FOLDER_ID = os.environ.get("PAYSLIPS_FOLDER_ID", "")

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
        - patient_start: First data row of patient breakdown
        - patient_end: Row with "Total: X patients"
        - discrepancies_start: Row with "DISCREPANCIES TO REVIEW"
    """
    sections = {
        'patient_start': -1,
        'patient_end': -1,
        'discrepancies_start': -1
    }
    
    for i, row in enumerate(data):
        cell_b = str(row[1] if len(row) > 1 else '').lower()
        
        # Find patient breakdown section
        if 'private patient breakdown' in cell_b:
            sections['patient_start'] = i + 3  # Skip header rows
            
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
    results = {'added': 0, 'removed': 0, 'updated': 0, 'errors': [], 'processed_rows': []}
    
    try:
        sheet = spreadsheet.worksheet(sheet_name)
    except Exception as e:
        results['errors'].append(f"Could not open sheet: {e}")
        return results
    
    # Get all data
    data = sheet.get_all_values()
    
    # Find sections
    sections = find_section_rows(data)
    
    print(f"      Patient breakdown: rows {sections['patient_start']+1} to {sections['patient_end']+1}")
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
    
    # Track row offset as we insert/delete rows
    row_offset = 0
    
    # Track successfully processed items for deletion
    successfully_processed = []
    
    # Process each item
    for item in items:
        action = item['action']
        patient = item['patient']
        
        try:
            if action == 'Add to Pay':
                # Insert row before Total row
                insert_row = sections['patient_end'] + 1 + row_offset
                final_amount = item['new_amount'] if item['new_amount'] > 0 else item['amount']
                
                # Insert blank row
                sheet.insert_row([''] * 8, insert_row)
                
                # Set values (columns B, C, D, E) - use batch update for formatting
                sheet.update_cell(insert_row, 2, patient)  # B: Patient
                sheet.update_cell(insert_row, 3, item['date'])  # C: Date
                sheet.update_cell(insert_row, 4, '✓')  # D: Status
                sheet.update_cell(insert_row, 5, final_amount)  # E: Amount
                
                # Format the amount cell as currency
                try:
                    sheet.format(f'E{insert_row}', {
                        'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'},
                        'horizontalAlignment': 'RIGHT'
                    })
                except:
                    pass
                
                print(f"         ✅ Added: {patient} - £{final_amount:.2f}")
                results['added'] += 1
                row_offset += 1
                successfully_processed.append(item)
                
            elif action == 'Remove from Pay':
                # Find patient in breakdown and delete
                found = False
                current_data = sheet.get_all_values()
                
                for i in range(sections['patient_start'], sections['patient_end'] + row_offset):
                    if i >= len(current_data):
                        break
                    cell_val = str(current_data[i][1] if len(current_data[i]) > 1 else '').lower()
                    if cell_val == patient.lower():
                        sheet.delete_rows(i + 1)
                        print(f"         ✅ Removed: {patient}")
                        results['removed'] += 1
                        row_offset -= 1
                        found = True
                        successfully_processed.append(item)
                        break
                
                if not found:
                    print(f"         ⚠️ Not found in breakdown: {patient}")
                    results['errors'].append(f"Could not find '{patient}' to remove")
                    
            elif action == 'Update Amount':
                # Find patient and update amount
                if item['new_amount'] <= 0:
                    print(f"         ⚠️ No new amount specified for: {patient}")
                    results['errors'].append(f"No new amount for '{patient}'")
                    continue
                
                found = False
                current_data = sheet.get_all_values()
                
                for i in range(sections['patient_start'], sections['patient_end'] + row_offset):
                    if i >= len(current_data):
                        break
                    cell_val = str(current_data[i][1] if len(current_data[i]) > 1 else '').lower()
                    if cell_val == patient.lower():
                        sheet.update_cell(i + 1, 5, item['new_amount'])  # Column E
                        # Format the updated cell as currency
                        try:
                            sheet.format(f'E{i + 1}', {
                                'numberFormat': {'type': 'CURRENCY', 'pattern': '£#,##0.00'},
                                'horizontalAlignment': 'RIGHT'
                            })
                        except:
                            pass
                        print(f"         ✅ Updated: {patient} → £{item['new_amount']:.2f}")
                        results['updated'] += 1
                        found = True
                        successfully_processed.append(item)
                        break
                
                if not found:
                    print(f"         ⚠️ Not found in breakdown: {patient}")
                    results['errors'].append(f"Could not find '{patient}' to update")
            
            else:
                print(f"         ⚠️ Unknown action: {action}")
                results['errors'].append(f"Unknown action '{action}' for '{patient}'")
                continue
            
        except Exception as e:
            print(f"         ❌ Error processing {patient}: {e}")
            results['errors'].append(f"Error with '{patient}': {e}")
    
    # After all processing, update totals and clean up
    total_processed = results['added'] + results['removed'] + results['updated']
    
    if total_processed > 0:
        # Re-read data to get current state
        current_data = sheet.get_all_values()
        
        # Find the new Total row position (it moved due to inserts/deletes)
        new_patient_end = -1
        new_patient_start = -1
        for i, row in enumerate(current_data):
            cell_b = str(row[1] if len(row) > 1 else '').lower()
            if 'private patient breakdown' in cell_b:
                new_patient_start = i + 3
            if new_patient_start > 0 and new_patient_end < 0:
                if cell_b.startswith('total:') and 'patient' in cell_b:
                    new_patient_end = i
        
        # Update the Total row with SUM formula
        if new_patient_end > 0 and new_patient_start > 0:
            # Count patients (rows between start and end)
            patient_count = new_patient_end - new_patient_start
            
            # Update Total label and SUM formula
            sheet.update_cell(new_patient_end + 1, 2, f'Total: {patient_count} patients')
            sum_formula = f'=SUM(E{new_patient_start + 1}:E{new_patient_end})'
            sheet.update_cell(new_patient_end + 1, 5, sum_formula)
            print(f"      📊 Updated Total row with SUM formula")
        
        # Find and update Gross Private in summary section (usually around row 7-10)
        for i in range(min(15, len(current_data))):
            cell_b = str(current_data[i][1] if len(current_data[i]) > 1 else '').lower()
            if 'gross private' in cell_b or 'private gross' in cell_b:
                # Link to the Total row
                if new_patient_end > 0:
                    sheet.update_cell(i + 1, 5, f'=E{new_patient_end + 1}')
                    print(f"      💰 Updated Gross Private to reference Total")
                break
    
    # Delete processed discrepancy rows
    if successfully_processed:
        print(f"      🗑️ Removing {len(successfully_processed)} processed discrepancy row(s)...")
        
        # Get the row numbers from successfully processed items (already 1-indexed)
        # Sort in reverse order to delete from bottom up
        rows_to_delete = sorted([item['row'] for item in successfully_processed], reverse=True)
        
        # Need to re-read the data to find current positions since rows may have shifted
        current_data = sheet.get_all_values()
        
        # Find discrepancies section again
        disc_start = -1
        for i, row in enumerate(current_data):
            cell_b = str(row[1] if len(row) > 1 else '').lower()
            if 'discrepancies to review' in cell_b:
                disc_start = i
                break
        
        if disc_start > 0:
            # Find rows with ticked checkboxes that match processed patients
            processed_patients = [item['patient'].lower() for item in successfully_processed]
            rows_to_delete = []
            
            for i in range(disc_start, len(current_data)):
                row = current_data[i]
                if len(row) > 6:
                    patient_name = str(row[1]).lower().strip()
                    checkbox = row[6]
                    # Check if checkbox is TRUE (might be string or bool)
                    is_checked = str(checkbox).upper() == 'TRUE'
                    
                    if is_checked and patient_name in processed_patients:
                        rows_to_delete.append(i + 1)
            
            # Delete in reverse order
            deleted_count = 0
            for row_num in sorted(rows_to_delete, reverse=True):
                try:
                    sheet.delete_rows(row_num)
                    deleted_count += 1
                except Exception as e:
                    print(f"         ⚠️ Could not delete row {row_num}: {e}")
            
            print(f"      ✅ Deleted {deleted_count} discrepancy row(s)")
    
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
    print("AURA DENTAL - PROCESS DISCREPANCIES")
    print("="*60)
    print(f"Month: {month}/{year}")
    
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
