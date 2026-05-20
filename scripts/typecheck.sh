#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# typecheck.sh — Run TypeScript compiler over the frontend and report results.
# Usage: ./scripts/typecheck.sh [--summary] [--threshold N]
#   --summary        Print grouped error counts instead of full output
#   --threshold N    Exit 0 even if error count <= N (for gradual adoption)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FRONTEND="$(cd "$(dirname "$0")/../frontend" && pwd)"
SUMMARY=false
THRESHOLD=0  # 0 = strict: any error fails

while [[ $# -gt 0 ]]; do
  case $1 in
    --summary)   SUMMARY=true; shift ;;
    --threshold) THRESHOLD=$2; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " TypeScript check — Justice Gavel v$(node -p "require('$FRONTEND/package.json').version")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$FRONTEND"

TSC_OUT=$(npx tsc --noEmit 2>&1) || true
TOTAL=$(echo "$TSC_OUT" | grep -c "error TS" 2>/dev/null || echo 0)

if [[ $TOTAL -eq 0 ]]; then
  echo "✅  0 TypeScript errors — clean build"
  echo ""
  exit 0
fi

echo "❌  $TOTAL TypeScript errors found"
echo ""

if [[ "$SUMMARY" == "true" ]]; then
  # Group by error code and count
  echo "── By error code ──────────────────────────────────"
  echo "$TSC_OUT" \
    | grep "error TS" \
    | grep -oP 'error TS\d+' \
    | sort | uniq -c | sort -rn \
    | head -20 \
    | awk '{printf "  %5d  %s\n", $1, $2}'

  echo ""
  echo "── By file (top 20) ────────────────────────────────"
  echo "$TSC_OUT" \
    | grep "error TS" \
    | grep -oP 'src/[^(]+' \
    | sort | uniq -c | sort -rn \
    | head -20 \
    | awk '{printf "  %4d  %s\n", $1, $2}'
else
  echo "$TSC_OUT"
fi

echo ""

# Apply threshold — useful while working down errors gradually
if [[ $TOTAL -le $THRESHOLD && $THRESHOLD -gt 0 ]]; then
  echo "⚠️  $TOTAL errors ≤ threshold ($THRESHOLD) — passing"
  exit 0
fi

exit 1
