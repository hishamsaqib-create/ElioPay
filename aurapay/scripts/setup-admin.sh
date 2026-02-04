#!/bin/bash
# ElioPay Admin Setup Script

API_URL="${1:-http://localhost:3000}"

echo "Setting up admin account at: $API_URL"
curl -s -X POST "$API_URL/api/admin/setup" \
  -H "Content-Type: application/json" \
  -d '{"setupKey": "eliopay-setup-2025", "email": "drhish@eliopay.co.uk", "password": "eliopay2025"}'

echo ""
echo "Done! Log in with: drhish@eliopay.co.uk / eliopay2025"
