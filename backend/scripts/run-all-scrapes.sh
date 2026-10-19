#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# Justice Gavel — manual data refresh (operator run)
#
# Every step writes the MAIN Postgres database (DATABASE_URL) through
# backend/src/services/dataRefresh — the same code the nightly scheduler runs
# when LIVE_REFRESH=true:
#   * providers not yet listed are INSERTED (source / source_id / timestamps);
#   * changes for providers already listed are STAGED in
#     provider_update_proposals for admin review (GET /api/admin/proposals,
#     POST /api/admin/proposals/:id/apply|reject) — never written directly;
#   * nothing is deleted or deactivated; every step logs a scrape_runs row
#     (GET /api/admin/refresh/runs).
#
# Prerequisites: DATABASE_URL (required). GOOGLE_PLACES_KEY / YELP_API_KEY are
# optional — a step whose key is missing is skipped with a message.
#   Production DB: export DATABASE_URL from Render (service → Environment)
#   and run this from a checkout — operator scripts are not in the image.
#
# Usage (from backend/):
#   bash scripts/run-all-scrapes.sh                 # everything, all states
#   bash scripts/run-all-scrapes.sh --dry-run       # fetch + match, write only the run log
#   bash scripts/run-all-scrapes.sh --state TN      # one state
#   bash scripts/run-all-scrapes.sh --dry-run --state TN
#
# Not run here on purpose:
#   * DOI / CSV imports — need an input file (see RUNBOOK.md "Data refresh")
#   * arrest roster scraping — heuristic; run src/scripts/scrape_arrests.js
#     --dry-run by hand and review. The scheduler ingests arrests only from
#     ARREST_FEED_URLS feeds.
#   * legal reference corrections — src/scripts/update_legal_data.js, one
#     sourced record at a time.
# Runtime: up to a few hours for a full national run (Google rate limits).
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=""
STATE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN="--dry-run"; shift ;;
    --state)    STATE="${2:-}"; shift 2 ;;
    --seed-only) echo "--seed-only is gone: provider rows are seeded by supabase/migrations."; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
if [ -n "$STATE" ] && ! [[ "$STATE" =~ ^[A-Za-z]{2}$ ]]; then
  echo "--state needs a 2-letter code" >&2; exit 2
fi

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Justice Gavel — Data Refresh → Postgres                        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "DATABASE_URL:      ${DATABASE_URL:+set}${DATABASE_URL:-NOT SET}"
echo "GOOGLE_PLACES_KEY: ${GOOGLE_PLACES_KEY:+set}${GOOGLE_PLACES_KEY:-not set (Google steps skipped)}"
echo "YELP_API_KEY:      ${YELP_API_KEY:+set}${YELP_API_KEY:-not set (Yelp skipped)}"
echo "Mode:              ${DRY_RUN:-write}${STATE:+ | state $STATE}"
echo ""

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL not set. Export it first (Render → service → Environment), then: bash scripts/run-all-scrapes.sh"
  exit 1
fi

STATE_ARGS=()
[ -n "$STATE" ] && STATE_ARGS=(--state "$STATE")
FAILED=0
step() {   # step <label> <command...> — a failing step is reported, the rest still run
  local label="$1"; shift
  echo ""; echo "── $label"
  if "$@"; then echo "✅ $label"; else echo "❌ $label failed (exit $?)"; FAILED=1; fi
}

step "1/3 National attorney & bail-agent refresh (state bar + Google + Yelp)" \
  node src/scripts/scrape_providers_national.js ${STATE_ARGS[@]+"${STATE_ARGS[@]}"} $DRY_RUN
step "2/3 Recovery agents (Google Places)" \
  node src/scripts/scrape_recovery_agents.js ${STATE_ARGS[@]+"${STATE_ARGS[@]}"} $DRY_RUN
step "3/3 State bar directories (verified-licensee pages)" \
  node src/scripts/scrape_state_bars.js --state "${STATE:-all}" $DRY_RUN

echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "Finished with failures — see the run log: GET /api/admin/refresh/runs"
  exit 1
fi
echo "DATA REFRESH COMPLETE. Review staged changes: GET /api/admin/proposals"
