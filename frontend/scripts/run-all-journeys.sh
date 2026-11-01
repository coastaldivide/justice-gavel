#!/usr/bin/env bash
# run-all-journeys.sh — every headless web journey, one after another, against
# one running production-mode API, a scriptable Anthropic mock and a web export.
#
#   scripts/run-all-journeys.sh <dist> <out-dir> --api http://localhost:4300/api \
#       --mock http://127.0.0.1:4399 --db-url postgres://… [--port 8300] [--core-dist <dist>]
#
# <dist> should be the full build (EXPO_PUBLIC_FULL_APP=1): the scripts open parked and
# professional screens. --core-dist, the shipped core-path build, also runs
# web-journeys-core-scope (what the core build hides) and the UI and main scripts on it.
#
# The API must have been started with ANTHROPIC_BASE_URL=<mock>, CORS_ORIGIN that
# includes http://localhost:<port>, and JWT_SECRET exported in this shell too
# (web-journeys-account.cjs B10 signs an expired token with it). The mock is
# backend/scripts/anthropic-mock.mjs (or anything with its /__mode control API);
# it is reset before each script. Exit code: number of scripts that failed.
set -u
DIST=${1:?dist dir}; OUT=${2:?out dir}; shift 2
API=http://localhost:4300/api; MOCK=http://127.0.0.1:4399; DB_URL=${DATABASE_URL:-}; PORT=8300; CORE_DIST=
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API=$2; shift 2 ;;
    --mock) MOCK=$2; shift 2 ;;
    --db-url) DB_URL=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --core-dist) CORE_DIST=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
failed=0
for script in web-journeys-core-safety web-journeys-account web-journeys-directory web-journeys-cases \
              web-journeys-ai web-journeys-guides web-journeys-g web-journeys-ui web-journeys; do
  curl -fsS -X POST "$MOCK/__reset" > /dev/null || { echo "Anthropic mock not reachable at $MOCK" >&2; exit 2; }
  echo "── $script"
  if DATABASE_URL="$DB_URL" node "$HERE/$script.cjs" "$DIST" "$OUT/$script" --api "$API" --port "$PORT" \
       --mock "$MOCK" --db-url "$DB_URL" > "$OUT/$script.log" 2>&1; then
    grep -E '^(PASS|FAIL)' "$OUT/$script.log" | awk '{print $1}' | sort | uniq -c | tr '\n' ' '; echo
  else
    failed=$((failed + 1))
    grep -E '^FAIL' "$OUT/$script.log" | head -20
    tail -5 "$OUT/$script.log"
  fi
done
if [ -n "$CORE_DIST" ]; then
  for script in web-journeys-core-scope web-journeys-ui web-journeys; do
    curl -fsS -X POST "$MOCK/__reset" > /dev/null || { echo "Anthropic mock not reachable at $MOCK" >&2; exit 2; }
    echo "── $script (core build)"
    if DATABASE_URL="$DB_URL" node "$HERE/$script.cjs" "$CORE_DIST" "$OUT/core-$script" --api "$API" --port "$PORT" \
         --mock "$MOCK" --db-url "$DB_URL" > "$OUT/core-$script.log" 2>&1; then
      grep -E '^(PASS|FAIL)' "$OUT/core-$script.log" | awk '{print $1}' | sort | uniq -c | tr '\n' ' '; echo
    else
      failed=$((failed + 1))
      grep -E '^FAIL' "$OUT/core-$script.log" | head -20
      tail -5 "$OUT/core-$script.log"
    fi
  done
fi
echo "journey scripts failed: $failed"
exit $failed
