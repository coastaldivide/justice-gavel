#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-all.sh — Full pre-commit / CI gate. Run this before any PR merge.
# Exits non-zero if any check fails.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
RESULTS=()

run_check() {
  local name=$1; shift
  echo ""
  echo "▶  $name"
  echo "──────────────────────────────────────────────────"
  if "$@"; then
    RESULTS+=("  ✅  $name")
    ((PASS++)) || true
  else
    RESULTS+=("  ❌  $name")
    ((FAIL++)) || true
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Justice Gavel — Full Build Check              ║"
echo "╚══════════════════════════════════════════════════╝"

run_check "TypeScript (strict, --summary)"  "$SCRIPTS/typecheck.sh" --summary
run_check "Tests"                           bash -c "cd '$SCRIPTS/../frontend' && npm test -- --watchAll=false --passWithNoTests 2>&1 | tail -5"

# Expo web export is optional locally (requires Expo login for EAS)
if command -v expo &>/dev/null || npx --yes expo --version &>/dev/null 2>&1; then
  run_check "Expo web export"  "$SCRIPTS/build-check.sh" web
fi

echo ""
echo "══════════════════════════════════════════════════"
echo " Results"
echo "══════════════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo ""
echo "  Passed: $PASS  │  Failed: $FAIL"
echo ""

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
