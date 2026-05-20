#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tsc-error-report.sh — Detailed TSC error analysis with trend tracking.
# Saves a JSON snapshot each run so you can watch errors go down over time.
# Usage: ./scripts/tsc-error-report.sh [--save] [--diff PREV_SNAPSHOT]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FRONTEND="$(cd "$(dirname "$0")/../frontend" && pwd)"
SNAPSHOT_DIR="$(dirname "$0")/../.tsc-snapshots"
SAVE=false
DIFF_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --save)  SAVE=true; shift ;;
    --diff)  DIFF_FILE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

cd "$FRONTEND"
TSC_OUT=$(npx tsc --noEmit 2>&1 || true)
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
TOTAL=$(echo "$TSC_OUT" | grep -c "error TS" || echo 0)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf " TSC Report  %s   total: %d errors\n" "$TIMESTAMP" "$TOTAL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "── Top error codes ─────────────────────────────────"
echo "$TSC_OUT" | grep "error TS" | grep -oP 'error TS\d+' | sort | uniq -c | sort -rn | head -15 \
  | awk '{printf "  %5d  %-10s\n", $1, $2}'

echo ""
echo "── Top files ───────────────────────────────────────"
echo "$TSC_OUT" | grep "error TS" | grep -oP 'src/[^(]+' | sort | uniq -c | sort -rn | head -15 \
  | awk '{printf "  %4d  %s\n", $1, $2}'

# Diff against a previous snapshot
if [[ -n "$DIFF_FILE" && -f "$DIFF_FILE" ]]; then
  PREV=$(python3 -c "import json; d=json.load(open('$DIFF_FILE')); print(d['total'])")
  DELTA=$((TOTAL - PREV))
  echo ""
  echo "── Trend vs $DIFF_FILE ─"
  if [[ $DELTA -lt 0 ]]; then
    echo "  ✅  $(abs $DELTA) errors fixed  ($PREV → $TOTAL)"
  elif [[ $DELTA -gt 0 ]]; then
    echo "  ❌  $DELTA new errors introduced  ($PREV → $TOTAL)"
  else
    echo "  ➖  No change  ($TOTAL errors)"
  fi
fi

# Save snapshot
if [[ "$SAVE" == "true" ]]; then
  mkdir -p "$SNAPSHOT_DIR"
  SNAP="$SNAPSHOT_DIR/$TIMESTAMP.json"
  python3 - << PYTHON
import json, re, collections, sys

lines = """${TSC_OUT}""".split('\n')
errs = []
for l in lines:
    m = re.match(r'^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)', l)
    if m:
        errs.append({'file': m.group(1), 'line': int(m.group(2)), 'code': m.group(4), 'msg': m.group(5)})

by_code = dict(collections.Counter(e['code'] for e in errs).most_common())
by_file = dict(collections.Counter(e['file'] for e in errs).most_common(20))

snap = {
    'timestamp': '$TIMESTAMP',
    'total': len(errs),
    'by_code': by_code,
    'top_files': by_file,
}
with open('$SNAP', 'w') as f:
    json.dump(snap, f, indent=2)
print(f"Snapshot saved: $SNAP")
PYTHON
fi

echo ""
