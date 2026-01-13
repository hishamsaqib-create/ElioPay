#!/usr/bin/env python3
"""
Aura Dental - Generate Payslip PDFs
===================================
Exports all payslip tabs as PDFs and saves to Google Drive.

Usage:
  python generate_pdfs.py --month 12 --year 2025

Or via GitHub Actions workflow.
"""

import os
import sys
import json
import argparse
import requests
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from datetime import datetime
from io import BytesIO

# =============================================================================
# CONFIGURATION
# =============================================================================

GOOGLE_SHEETS_CREDENTIALS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "")
PAYSLIPS_FOLDER_ID = os.environ.get("PAYSLIPS_FOLDER_ID", "")

# Folder for PDFs (will be created in same location as payslips)
PDF_FOLDER_NAME = "Payslip PDFs"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

# =============================================================================
# GOOGLE CLIENTS
# =============================================================================

def get_credentials():
    """Get Google credentials."""
    if not GOOGLE_SHEETS_CREDENTIALS:
        raise ValueError("GOOGLE_SHEETS_CREDENTIALS environment variable not set")
    
    creds_dict = json.loads(GOOGLE_SHEETS_CREDENTIALS)
    return Credentials.from_service_account_info(creds_dict, scopes=SCOPES)


def get_sheets_client():
    """Initialize Google Sheets client."""
    credentials = get_credentials()
    return gspread.authorize(credentials)


def get_drive_service():
    """Initialize Google Drive service."""
    credentials = get_credentials()
    return build('drive', 'v3', credentials=credentials)


def find_monthly_spreadsheet(client, month, year):
    """Find the payslip spreadsheet for given month/year."""
    month_name = datetime(year, month, 1).strftime("%B")
    sheet_name = f"Aura Payslips - {month_name} {year}"
    
    print(f"\n📊 Looking for: {sheet_name}")
    
    try:
        spreadsheets = client.list_spreadsheet_files()
        for ss in spreadsheets:
            if ss['name'] == sheet_name:
                print(f"   ✅ Found: {ss['name']}")
                return client.open_by_key(ss['id']), month_name, year
        
        print(f"   ❌ Not found: {sheet_name}")
        return None, None, None
        
    except Exception as e:
        print(f"   ❌ Error searching: {e}")
        return None, None, None


def get_or_create_pdf_folder(drive_service, parent_folder_id):
    """Find or create the PDF folder."""
    
    # Search for existing folder
    query = f"name = '{PDF_FOLDER_NAME}' and '{parent_folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    
    try:
        results = drive_service.files().list(
            q=query,
            fields="files(id, name)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True
        ).execute()
        
        files = results.get('files', [])
        
        if files:
            print(f"   📁 Using existing folder: {PDF_FOLDER_NAME}")
            return files[0]['id']
        
        # Create new folder
        folder_metadata = {
            'name': PDF_FOLDER_NAME,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_folder_id]
        }
        
        folder = drive_service.files().create(
            body=folder_metadata,
            fields='id',
            supportsAllDrives=True
        ).execute()
        
        print(f"   📁 Created folder: {PDF_FOLDER_NAME}")
        return folder.get('id')
        
    except Exception as e:
        print(f"   ❌ Error with PDF folder: {e}")
        return None


def export_sheet_as_pdf(spreadsheet_id, sheet_id, credentials):
    """Export a specific sheet as PDF bytes."""
    
    # Build export URL
    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export"
    params = {
        'format': 'pdf',
        'gid': sheet_id,
        'portrait': 'true',
        'size': 'A4',
        'fitw': 'true',
        'gridlines': 'false',
        'printtitle': 'false',
        'sheetnames': 'false',
        'pagenum': 'false',
        'top_margin': '0.5',
        'bottom_margin': '0.5',
        'left_margin': '0.5',
        'right_margin': '0.5'
    }
    
    # Get access token
    credentials.refresh(requests.Request())
    headers = {
        'Authorization': f'Bearer {credentials.token}'
    }
    
    response = requests.get(url, params=params, headers=headers)
    
    if response.status_code == 200:
        return response.content
    else:
        raise Exception(f"PDF export failed: {response.status_code} - {response.text[:200]}")


def upload_pdf_to_drive(drive_service, folder_id, filename, pdf_bytes):
    """Upload PDF bytes to Google Drive."""
    
    file_metadata = {
        'name': filename,
        'parents': [folder_id]
    }
    
    media = MediaIoBaseUpload(
        BytesIO(pdf_bytes),
        mimetype='application/pdf',
        resumable=True
    )
    
    file = drive_service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id, webViewLink',
        supportsAllDrives=True
    ).execute()
    
    return file.get('webViewLink')


def generate_all_pdfs(spreadsheet, month_name, year, drive_service, pdf_folder_id, credentials):
    """Generate PDFs for all payslip tabs."""
    
    print("\n" + "="*60)
    print("GENERATING PDFs")
    print("="*60)
    
    spreadsheet_id = spreadsheet.id
    worksheets = spreadsheet.worksheets()
    
    # Find payslip tabs
    payslip_tabs = [(ws.title, ws.id) for ws in worksheets if 'Payslip' in ws.title]
    
    print(f"\n📋 Found {len(payslip_tabs)} payslip tab(s)")
    
    created = []
    errors = []
    
    for tab_name, sheet_id in payslip_tabs:
        dentist_name = tab_name.replace(' Payslip', '')
        filename = f"{dentist_name} Payslip - {month_name} {year}.pdf"
        
        print(f"\n   📄 {dentist_name}...", end=" ")
        
        try:
            # Export as PDF
            pdf_bytes = export_sheet_as_pdf(spreadsheet_id, sheet_id, credentials)
            
            # Upload to Drive
            link = upload_pdf_to_drive(drive_service, pdf_folder_id, filename, pdf_bytes)
            
            print(f"✅")
            created.append({'name': dentist_name, 'filename': filename, 'link': link})
            
        except Exception as e:
            print(f"❌ {e}")
            errors.append({'name': dentist_name, 'error': str(e)})
    
    return created, errors


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Generate payslip PDFs')
    parser.add_argument('--month', type=int, required=True, help='Month (1-12)')
    parser.add_argument('--year', type=int, required=True, help='Year (e.g., 2025)')
    parser.add_argument('--dentists', type=str, default='all', help='Comma-separated dentist names or "all"')
    args = parser.parse_args()
    
    print("="*60)
    print("AURA DENTAL - GENERATE PAYSLIP PDFs")
    print("="*60)
    print(f"Month: {args.month}/{args.year}")
    
    # Initialize clients
    credentials = get_credentials()
    client = get_sheets_client()
    drive_service = get_drive_service()
    
    # Find spreadsheet
    spreadsheet, month_name, year = find_monthly_spreadsheet(client, args.month, args.year)
    
    if not spreadsheet:
        print("\n❌ Could not find spreadsheet. Make sure payslips have been generated first.")
        sys.exit(1)
    
    # Get or create PDF folder
    if not PAYSLIPS_FOLDER_ID:
        print("\n❌ PAYSLIPS_FOLDER_ID not set")
        sys.exit(1)
    
    pdf_folder_id = get_or_create_pdf_folder(drive_service, PAYSLIPS_FOLDER_ID)
    
    if not pdf_folder_id:
        print("\n❌ Could not create PDF folder")
        sys.exit(1)
    
    # Generate PDFs
    created, errors = generate_all_pdfs(
        spreadsheet, month_name, year, 
        drive_service, pdf_folder_id, credentials
    )
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    if created:
        print(f"\n✅ Created {len(created)} PDF(s):")
        for item in created:
            print(f"   • {item['filename']}")
    
    if errors:
        print(f"\n❌ Failed: {len(errors)}")
        for item in errors:
            print(f"   • {item['name']}: {item['error']}")
    
    # Print folder link
    print(f"\n📁 PDFs saved to: https://drive.google.com/drive/folders/{pdf_folder_id}")
    
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
