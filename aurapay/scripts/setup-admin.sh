#!/bin/bash
# AuraPay Admin Setup Script

API_URL="${1:-http://localhost:3000}"

echo "Setting up admin account at: $API_URL"
curl -s -X POST "$API_URL/api/admin/setup" \
  -H "Content-Type: application/json" \
  -d '{"setupKey": "aurapay-setup-2025", "email": "drhish@aurapay.co.uk", "password": "aurapay2025"}'

echo ""
echo "Done! Log in with: drhish@aurapay.co.uk / aurapay2025"
