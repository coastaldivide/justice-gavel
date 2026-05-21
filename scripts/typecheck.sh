#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# typecheck.sh — Run tsc --noEmit and report results.
# Usage: ./scripts/typecheck.sh [--summary] [--threshold N]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FRONTEND="$(cd "$(dirname "$0")/../frontend" && pwd)"
SUMMARY=false
THRESHOLD=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --summary)   SUMMARY=true; shift ;;
    --threshold) THRESHOLD=$2; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

VERSION=$(node -p "require('$FRONTEND/package.json').version" 2>/dev/null || echo "?")
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " TypeScript check — Justice Gavel v$VERSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$FRONTEND"
TSC_RAW_OUT=$(npx tsc --noEmit 2>&1) || true

CHECKER="$FRONTEND/../scripts/_typecheck_parse.py"
echo "$TSC_RAW_OUT" | python3 "$CHECKER" "$SUMMARY" "$THRESHOLD"
exit $?
