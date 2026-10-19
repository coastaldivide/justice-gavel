#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  Justice Gavel — DOI Bail Agent License Import (all 50 states)
#  Run from repo root: bash scripts/run_doi_import.sh
#  Requires: DATABASE_URL (the main Postgres database) in environment or backend/.env
#  Existing bail_agents rows are never overwritten: new licensees are inserted,
#  differences are staged in provider_update_proposals (GET /api/admin/proposals).
# ═══════════════════════════════════════════════════════════════════════════

set -e
cd "$(dirname "$0")/.."

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Justice Gavel — DOI License Import (all 50 states)    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "States with commercial bail bonds (45): will import"
echo "States without (IL/KY/OR/WI/DC):        automatically skipped"
echo ""

if [ -z "${DATABASE_URL:-}" ] && [ -f backend/.env ]; then
  set -a; . backend/.env; set +a
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ Set DATABASE_URL (main Postgres) first, exported from Render → service → Environment"
  exit 1
fi

DOI_DIR="data/doi"
mkdir -p "$DOI_DIR"

# ── Check for NIPR bulk file (easiest path — covers all 42 NIPR states) ──────
if [ -f "$DOI_DIR/nipr_all_states.csv" ]; then
  echo "✅ Found NIPR bulk export — processing all states at once..."
  node backend/src/scripts/import_doi_supabase.js \
    --nipr-all --file "$DOI_DIR/nipr_all_states.csv" "$@"

# ── Otherwise run all-states mode (picks up per-state files) ─────────────────
else
  # Count files in doi directory
  FILE_COUNT=$(ls "$DOI_DIR"/*.{csv,txt,xls} 2>/dev/null | wc -l | tr -d ' ')

  if [ "$FILE_COUNT" -eq "0" ]; then
    echo "⚠️  No DOI files found in $DOI_DIR/"
    echo ""
    echo "══════════════════════════════════════════════════════════"
    echo "  FASTEST PATH: NIPR Bulk Export (all states at once)"
    echo "══════════════════════════════════════════════════════════"
    echo ""
    echo "  1. Create free account at: https://nipr.com"
    echo "  2. PDB Online Licensee Search → Bulk Download"
    echo "  3. Filter: Line of Authority = Bail Bond, Status = Active"
    echo "  4. Download all states → save as: $DOI_DIR/nipr_all_states.csv"
    echo "  5. Re-run this script"
    echo ""
    echo "══════════════════════════════════════════════════════════"
    echo "  ALTERNATIVE: Individual state files"
    echo "══════════════════════════════════════════════════════════"
    echo ""
    echo "  Download files and name them: data/doi/XX_agents.csv"
    echo "  The script auto-detects each state from the filename."
    echo ""
    echo "  Priority states (largest bail bond markets):"
    echo "    TX: https://www.tdi.texas.gov/agent/agentlookup.html"
    echo "    FL: https://www.myfloridacfo.com/division/agents"
    echo "    CA: https://ezlicensing.insurance.ca.gov/"
    echo "    NY: https://www.dfs.ny.gov/agents_brokers/licensing"
    echo "    GA: https://www.oci.ga.gov/LicensureAndFiling/"
    echo "    TN: email regboards.info@tn.gov"
    echo ""
    echo "  All 45 state URLs: see docs/DOI_IMPORT_GUIDE.md"
    echo ""

    read -p "Run with TEST DATA instead (verifies script works)? [y/N] " yn
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
      echo ""
      echo "Running with test data (data/doi_test/)..."
      for f in data/doi_test/*.txt data/doi_test/*.csv; do
        [ -f "$f" ] || continue
        STATE=$(basename "$f" | grep -oE '^[a-zA-Z]{2}' | tr '[:lower:]' '[:upper:]')
        [ -n "$STATE" ] && \
          node backend/src/scripts/import_doi_supabase.js \
            --file "$f" --state "$STATE" --dry-run
      done
    fi
    exit 0
  fi

  echo "Found $FILE_COUNT DOI files — running all-states import..."
  node backend/src/scripts/import_doi_supabase.js --all-states "$@"
fi

# ── Verification report ───────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
echo "  VERIFICATION REPORT"
echo "══════════════════════════════════════════════════════════"
node backend/src/scripts/import_doi_supabase.js --match-only --all-states

echo ""
echo "✅ Done. Review staged changes: GET /api/admin/proposals?table=bail_agents"
echo "   Coverage: psql \"\$DATABASE_URL\" -c \"SELECT state, COUNT(*), COUNT(license_number) FROM bail_agents GROUP BY state ORDER BY state;\""
