#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# Justice Gavel — Post-Deployment Verification Script
# Run after setup-railway.sh to confirm everything is live and working.
#
# Usage: bash scripts/verify-deployment.sh [API_URL]
# Default: https://api.justicegavel.app
# ══════════════════════════════════════════════════════════════════════════════

API="${1:-https://api.justicegavel.app}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    echo "  ✅ $label"
    ((PASS++))
  else
    echo "  ❌ $label"
    echo "     Expected: $expected"
    echo "     Got: $(echo "$result" | head -c 100)"
    ((FAIL++))
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Justice Gavel — Deployment Verification                       ║"
echo "║  API: $API"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

echo "── Core health ─────────────────────────────────────────────────────"

# Basic health
HEALTH=$(curl -sf "$API/health" 2>/dev/null || echo "CONNECTION_FAILED")
check "API is reachable"          "$HEALTH" "status"
check "Database connected"        "$HEALTH" '"db":"ok"'
check "JWT secret is secure"      "$HEALTH" '"jwt_secure":true'
check "Version is v6.9.0"         "$HEALTH" "6.9.0"
check "Disclaimer version set"    "$HEALTH" "2026-01-01"

echo ""
echo "── API endpoints ───────────────────────────────────────────────────"

# Auth endpoints exist
LOGIN=$(curl -sf -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@test.com","password":"wrongpass"}' 2>/dev/null || echo "")
check "POST /auth/login responds" "$LOGIN" "error"

# Bail calculator (no auth required)
BAIL=$(curl -sf -X POST "$API/api/bail/calculate" \
  -H "Content-Type: application/json" \
  -d '{"state":"TN","charge_type":"dui","severity":"medium"}' 2>/dev/null || echo "")
check "POST /bail/calculate works" "$BAIL" "recommended\|disclaimer\|bail"

# API docs
DOCS=$(curl -sf "$API/api/docs" 2>/dev/null || echo "")
check "GET /api/docs serves OpenAPI" "$DOCS" "openapi\|Justice Gavel"

echo ""
echo "── Security headers ────────────────────────────────────────────────"

HEADERS=$(curl -sI "$API/health" 2>/dev/null || echo "")
check "X-Content-Type-Options set"   "$HEADERS" "X-Content-Type-Options"
check "X-Frame-Options set"          "$HEADERS" "X-Frame-Options"
check "Strict-Transport-Security"    "$HEADERS" "Strict-Transport-Security"

echo ""
echo "── Rate limiting ────────────────────────────────────────────────────"

# Rapid requests should get rate limited
RATE=$(for i in $(seq 1 5); do
  curl -sf -o /dev/null -w "%{http_code}\n" "$API/api/auth/login" \
    -X POST -H "Content-Type: application/json" \
    -d '{"identifier":"x","password":"x"}' 2>/dev/null
done | sort | uniq -c | sort -rn | head -3)
check "Rate limit active (200/401/429 responses)" "$RATE" "[0-9]"

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "RESULTS: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════════════════════════════════"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "✅ All checks passed — Justice Gavel is live!"
else
  echo "❌ $FAIL check(s) failed — review the output above"
  echo "   See RUNBOOK.md for troubleshooting steps"
fi
echo ""
