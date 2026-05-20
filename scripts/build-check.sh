#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-check.sh — Expo web export as a build smoke test.
# Catches Metro bundler errors and JSX render failures that TSC misses.
# Usage: ./scripts/build-check.sh [--platform web|android|ios]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FRONTEND="$(cd "$(dirname "$0")/../frontend" && pwd)"
PLATFORM="${1:-web}"
OUT_DIR="$FRONTEND/dist-check"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Expo build smoke-test — platform: $PLATFORM"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$FRONTEND"

# Clean previous output
rm -rf "$OUT_DIR"

# Run export — Metro will catch:
#   • Import errors (module not found)
#   • Syntax errors that Babel trips over
#   • Circular dependency crashes
#   • Missing default exports used in navigation
BUILD_LOG=$(mktemp)

echo "Running: npx expo export --platform $PLATFORM --output-dir $OUT_DIR"
echo ""

if npx expo export --platform "$PLATFORM" --output-dir "$OUT_DIR" 2>&1 | tee "$BUILD_LOG"; then
  echo ""
  echo "✅  Expo export succeeded"
  BUNDLE_SIZE=$(du -sh "$OUT_DIR" 2>/dev/null | cut -f1 || echo "unknown")
  echo "    Bundle size: $BUNDLE_SIZE"
  rm -rf "$OUT_DIR"  # clean up
  exit 0
else
  echo ""
  echo "❌  Expo export FAILED"
  echo ""
  echo "── Last 50 lines of output ─────────────────────────"
  tail -50 "$BUILD_LOG"
  echo ""
  echo "── Error summary ───────────────────────────────────"
  grep -E "^(ERROR|Error|error)" "$BUILD_LOG" | head -20 || true
  rm -rf "$OUT_DIR"
  exit 1
fi
