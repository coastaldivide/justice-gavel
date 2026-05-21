# Justice Gavel — Legal Data Fact-Check Runbook

## How to run

```bash
cd backend

# Quick check (crisis hotlines + expungement only — run weekly)
node src/scripts/fact_check_monitor.js --quick

# Full check (all 60+ sources — run monthly, takes ~3 minutes)
node src/scripts/fact_check_monitor.js --full

# Check one data type
node src/scripts/fact_check_monitor.js --type=dui
node src/scripts/fact_check_monitor.js --type=expungement
node src/scripts/fact_check_monitor.js --type=crisis

# Check one state across all types
node src/scripts/fact_check_monitor.js --state=TN
```

## Exit codes
- `0` = All sources verified, no flags
- `1` = At least one source flagged — action required

## What to do when something is flagged

### If a URL redirects
The official source moved. Update the URL in the database:
```sql
UPDATE victim_compensation SET url='new_url', updated_at='2026-06-01', source_url='new_url'
WHERE state='TN';
```

### If keywords are missing from a page
The page content changed. That may mean the law changed.
1. Visit the URL manually
2. Compare to current database values
3. If the law changed, update the record
4. If the page restructured, update expected keywords in fact_check_monitor.js

### If a source returns 404 or error
1. Search for the new official URL
2. Update the URL in both the database and fact_check_monitor.js SOURCES
3. Document what changed in fact_check_config.json

## Update commands

```bash
# See current data for a state before updating
node src/scripts/update_legal_data.js --type=dui --state=TN
node src/scripts/update_legal_data.js --type=victim_comp --state=CA
node src/scripts/update_legal_data.js --type=state_bar --state=TX

# After reviewing, update directly in SQLite
sqlite3 backend/demo.db
> UPDATE dui_laws SET dmv_hearing_deadline=15, updated_at='2026-06-01',
    source_url='https://www.tn.gov/safety/driver-services/driverimprovement/dui.html',
    verified_by='YOUR_NAME'
  WHERE state='TN';
```

## Expungement updates (highest volatility)

Expungement law changes are tracked at:
- **CCRC**: https://ccresourcecenter.org/state-restoration-profiles/
- **Clean Slate Initiative**: https://www.cleanslateinitiative.org/states

When the CCRC page shows a new state, update `expungement.js STATE_RULES`:
1. Find the state block
2. Update `waitYears` and `note` fields
3. Update the comment at the top: `// Last verified: [date]`

## High-volatility states (check monthly)
- **Virginia** — Clean Slate Law takes effect July 1, 2026
- **Maryland** — Expungement Reform Act 2025 still being implemented
- **Colorado** — Automatic sealing began July 2025, court implementation ongoing
- **Oklahoma** — 2025 automatic expungement, county rollout uneven
- **DC** — February 2025 revised sealing law, court capacity constraints

## Scheduling on Railway
In Railway Dashboard → Your Service → Settings → Cron Jobs:
- Weekly quick check: `0 9 * * 1` (every Monday 9am UTC)
- Monthly full check: `0 9 1 * *` (1st of every month 9am UTC)

Command: `node src/scripts/fact_check_monitor.js --quick`

## Record of verifications

| Date | Type | States | Verifier | Issues Found |
|------|------|--------|----------|-------------|
| 2026-04-29 | DUI laws | All 51 | Initial data load | — |
| 2026-04-29 | Drug penalties | All 51 | Initial data load | — |
| 2026-04-29 | Expungement | All 51 | Initial load + audit | 7 corrections applied |
| 2026-05-01 | Expungement | DC,VA,MD,CO,WI,IA,OK | Legal audit | 7 corrections applied |
| 2026-05-03 | Crisis hotlines | All | Full audit | All 5 verified correct |

**Next scheduled check: 2026-06-01**
