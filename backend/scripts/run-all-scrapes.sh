#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# Justice Gavel — Full Data Pipeline
# Runs all scrapes and seeds in the correct order.
#
# Prerequisites:
#   DATABASE_URL, GOOGLE_PLACES_KEY, ANTHROPIC_API_KEY set in environment
#   (These are already set in Railway — run via: railway run bash scripts/run-all-scrapes.sh)
#
# Runtime: ~2-4 hours for full national scrape
# Usage:
#   Full run:          bash scripts/run-all-scrapes.sh
#   Quick seed only:   bash scripts/run-all-scrapes.sh --seed-only
#   One state:         bash scripts/run-all-scrapes.sh --state TN
#   Dry run:           bash scripts/run-all-scrapes.sh --dry-run
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

STATE="${2:-}"
DRY_RUN="${1:-}"
SEED_ONLY="${1:-}"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Justice Gavel — Data Pipeline                                 ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "DATABASE_URL:      ${DATABASE_URL:+SET} ${DATABASE_URL:-NOT SET}"
echo "GOOGLE_PLACES_KEY: ${GOOGLE_PLACES_KEY:+SET} ${GOOGLE_PLACES_KEY:-NOT SET}"
echo ""

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set. Run via: railway run bash scripts/run-all-scrapes.sh"
  exit 1
fi

# ── STEP 1: Seed foundational provider data ───────────────────────────────────
echo "STEP 1/6: Seeding foundational attorney & bail agent data (all 50 states)..."
if [ -n "$STATE" ]; then
  node src/scripts/seed_providers.js --state "$STATE"
else
  node src/scripts/seed_providers.js
fi
echo "✅ Step 1 complete"

if [ "$SEED_ONLY" = "--seed-only" ]; then
  echo "Seed-only mode — stopping here."
  exit 0
fi

# ── STEP 2: Import DOI bondsmen database ─────────────────────────────────────
echo ""
echo "STEP 2/6: Importing DOI bondsmen database..."
node src/scripts/import_doi_bondsmen.js
echo "✅ Step 2 complete"

# ── STEP 3: National provider scrape (Google Places) ─────────────────────────
echo ""
echo "STEP 3/6: National attorney & bail agent scrape via Google Places..."
if [ -z "$GOOGLE_PLACES_KEY" ]; then
  echo "⏭️  Skipping — GOOGLE_PLACES_KEY not set"
else
  if [ -n "$STATE" ]; then
    node src/scripts/scrape_providers_national.js --state "$STATE" ${DRY_RUN:+--dry-run}
  else
    node src/scripts/scrape_providers_national.js ${DRY_RUN:+--dry-run}
  fi
  echo "✅ Step 3 complete"
fi

# ── STEP 4: Recovery agents scrape ───────────────────────────────────────────
echo ""
echo "STEP 4/6: Scraping recovery agents (bail enforcement)..."
node src/scripts/scrape_recovery_agents.js ${DRY_RUN:+--dry-run}
echo "✅ Step 4 complete"

# ── STEP 5: Update legal data ─────────────────────────────────────────────────
echo ""
echo "STEP 5/6: Updating legal data (DUI laws, expungement rules, etc)..."
node src/scripts/update_legal_data.js
echo "✅ Step 5 complete"

# ── STEP 6: State bar scrape ──────────────────────────────────────────────────
echo ""
echo "STEP 6/6: State bar directory scrape (verified licensed attorneys)..."
if [ -n "$STATE" ]; then
  node src/scripts/scrape_state_bars.js --state "$STATE" ${DRY_RUN:+--dry-run}
else
  node src/scripts/scrape_state_bars.js ${DRY_RUN:+--dry-run}
fi
echo "✅ Step 6 complete"

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  DATA PIPELINE COMPLETE                                        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Run verify-deployment.sh to confirm database is populated."
