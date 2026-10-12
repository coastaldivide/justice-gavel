# DOI Bail Agent License Import — All 50 States

## Why 50 States

All 45 states with commercial bail bonding publish licensee data as public record.
The import script covers all of them. Five states are automatically skipped because
commercial bail bonding is abolished there:

| Excluded | Abolished |
|----------|-----------|
| Illinois | 1963 |
| Kentucky | 1976 |
| Oregon   | 1974 |
| Wisconsin| 1979 |
| DC       | Never had commercial bail |

---

## Fastest Path — NIPR Bulk Export (covers 42 states in one download)

NIPR (National Insurance Producer Registry) is the national database that all
state DOIs feed into. One bulk export covers 42 of 45 states simultaneously.
TN, TX, and FL use separate DOI systems and need individual files.

**Steps:**
1. Go to: https://nipr.com
2. Create a free account (no cost for individual searches; bulk export is free)
3. Navigate to: PDB Online Licensee Search → Bulk Download
4. Filter:
   - Line of Authority: **Bail Bond** (or Surety)
   - Status: **Active**
   - State: **All states**
5. Download → save as: `data/doi/nipr_all_states.csv`
6. Run: `bash scripts/run_doi_import.sh`

The script auto-splits the NIPR file by state and runs each one.

---

## State-Specific Downloads (TN, TX, FL)

These three states use DOI systems outside NIPR:

### Tennessee — Board of Professional Bondsmen
TN passed a new bail bondsman licensing law effective January 2026.
Bail bondsmen are now separately regulated by the Board of Professional Bondsmen.

**Option A (fastest — 3-5 business days):**
Email: `regboards.info@tn.gov`
Subject: "Public records request: active bail bondsman licensee list"

**Option B:**
1. Go to: https://www.tn.gov/commerce/regboards/bonds.html
2. Click "Verify a License"
3. Search all active bondsmen → export
4. Save as: `data/doi/TN_agents.txt`

### Texas — TDI Agent Lookup
1. Go to: https://www.tdi.texas.gov/agent/agentlookup.html
2. License Type: **Bail Bond Agent** AND **Bail Bond Surety Company**
3. Status: **Active**
4. Click Search → **Export Results** (CSV)
5. Save as: `data/doi/TX_agents.csv`

Direct CSV (may work): https://www.tdi.texas.gov/general/download/agtaj.csv

### Florida — MyFloridaCFO
1. Go to: https://www.myfloridacfo.com/division/agents
2. Click **Agent License Verification**
3. License Type: **2-34 Limited Surety (Bail Bond) Agent**
4. Status: **Active** → Search → **Export to CSV**
5. Save as: `data/doi/FL_agents.csv`

---

## All 45 State DOI URLs

Save individual state files as `data/doi/XX_agents.csv` (XX = state code).
The script auto-detects the state from the filename.

| State | DOI URL | Notes |
|-------|---------|-------|
| AL | https://www.aldoi.gov/Agents/LicenseeSearch.aspx | |
| AK | https://www.commerce.alaska.gov/web/ins/ | |
| AZ | https://difi.az.gov/licensing/agent-licensing | |
| AR | https://www.insurance.arkansas.gov/agents-brokers/licensing | |
| CA | https://ezlicensing.insurance.ca.gov/ | Filter: Bail Bond |
| CO | https://doi.colorado.gov/agents/agent-licensing | |
| CT | https://portal.ct.gov/cid/agent-licensing | |
| DE | https://insurance.delaware.gov/agents-licensing/ | |
| FL | https://www.myfloridacfo.com/division/agents | 2-34 Limited Surety |
| GA | https://www.oci.ga.gov/LicensureAndFiling/ | |
| HI | https://cca.hawaii.gov/ins/agents/ | |
| ID | https://doi.idaho.gov/agent-licensing/ | |
| IN | https://www.in.gov/idoi/agent/ | |
| IA | https://iid.iowa.gov/licensing-agents-producers | |
| KS | https://www.ksinsurance.org/agent-licensing/ | |
| LA | https://www.ldi.la.gov/agents/licensing | Surety + Bail Agent separate |
| ME | https://www.maine.gov/pfr/insurance/agents/ | Limited bail market |
| MD | https://insurance.maryland.gov/agent/pages/licensing.aspx | |
| MA | https://www.mass.gov/insurance-agent-producer-licensing | Limited bail market |
| MI | https://www.michigan.gov/lara/bureau-list/ofis/ | |
| MN | https://mn.gov/commerce/industries/insurance/ | |
| MS | https://www.mid.ms.gov/agents/ | |
| MO | https://insurance.mo.gov/agents/ | |
| MT | https://csimt.gov/agents/ | |
| NE | https://doi.nebraska.gov/agent-licensing/ | |
| NV | https://doi.nv.gov/Agent/Agent_Licensing/ | |
| NH | https://www.nh.gov/insurance/agents/ | |
| NJ | https://www.state.nj.us/dobi/agentlic.htm | |
| NM | https://www.osi.state.nm.us/agents/ | |
| NY | https://www.dfs.ny.gov/agents_brokers/licensing | DFS not DOI; Surety license |
| NC | https://www.ncdoi.gov/agent-services/ | |
| ND | https://www.nd.gov/ndins/agents/ | |
| OH | https://www.insurance.ohio.gov/agents/licensing | |
| OK | https://www.oid.ok.gov/agents-licensing/ | |
| PA | https://www.insurance.pa.gov/Agents/Pages/default.aspx | |
| RI | https://health.ri.gov/licenses/detail.php | |
| SC | https://www.doi.sc.gov/agents/ | |
| SD | https://dlr.sd.gov/insurance/agents/ | |
| TN | https://www.tn.gov/commerce/regboards/bonds.html | Board of Professional Bondsmen (new 2026) |
| TX | https://www.tdi.texas.gov/agent/agentlookup.html | agtaj.csv direct download |
| UT | https://insurance.utah.gov/agents/licensing/ | |
| VA | https://www.scc.virginia.gov/pages/Agent-Licensing | |
| WA | https://www.insurance.wa.gov/agent-licensing | |
| WV | https://www.wvinsurance.gov/Agents | |
| WY | https://doi.wyo.gov/agents/ | |

---

## Running the Import

The importer writes the **main Postgres database** through `DATABASE_URL`
(run it on Railway with `railway run ...`). It does not use the Supabase REST
client any more, and it never overwrites or deletes a `bail_agents` row.

```bash
# NIPR bulk file (fastest — covers 42 states)
bash scripts/run_doi_import.sh
# (places nipr_all_states.csv in data/doi/ first)

# Single state
node backend/src/scripts/import_doi_supabase.js --file data/doi/TX_agents.csv --state TX

# All states (picks up any file in data/doi/ matching state code)
node backend/src/scripts/import_doi_supabase.js --all-states

# Dry run (preview without DB changes)
node backend/src/scripts/import_doi_supabase.js --dry-run --file data/doi/CA_agents.csv --state CA

# Match rate report
node backend/src/scripts/import_doi_supabase.js --match-only --all-states
```

---

## Matching Logic

Each DOI record is matched to an existing bail_agents record using:

1. **Phone exact match** → score 1.0 → HIGH confidence → matched
2. **Name similarity** (Jaccard on normalized word sets) **+ city + zip**
   - ≥ 0.75 → HIGH / MEDIUM → matched
   - 0.60–0.74 → BORDERLINE → logged for review, skipped
   - < 0.60 → no match → new record inserted (`source = 'doi_import'`,
     `doi_verified = 1`, license number / type)
3. **Minimum name length guard** — names with fewer than 2 meaningful words
   (after stripping "bail", "bonds", "company", etc.) are skipped
4. **A matched row is never written.** The DOI's license number,
   `doi_verified`, phone, email and address — where they differ from the row —
   are staged in `provider_update_proposals` for an admin to apply or reject
   (`GET /api/admin/proposals?table=bail_agents`, see RUNBOOK.md "Data
   refresh"). Re-running the same file stages nothing new.

Each state run is logged in `scrape_runs` (job `doi_import`).


---

## Verification SQL

```sql
-- Match rate by state
SELECT
  state,
  COUNT(*)                                                         AS total,
  SUM(CASE WHEN doi_verified THEN 1 ELSE 0 END)                   AS doi_verified,
  SUM(CASE WHEN license_number IS NOT NULL THEN 1 ELSE 0 END)     AS licensed,
  ROUND(100.0 * SUM(CASE WHEN doi_verified THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0), 1)                                  AS pct_verified
FROM bail_agents
GROUP BY state
ORDER BY state;

-- Borderline matches for manual review
SELECT id, name, company, city, state, doi_match_confidence, doi_match_factors
FROM bail_agents
WHERE doi_match_confidence BETWEEN 0.60 AND 0.74
ORDER BY doi_match_confidence DESC;
```

---

## Ongoing Maintenance

Re-run quarterly to pick up new licenses and catch revocations:
```bash
bash scripts/run_doi_import.sh
```

Add to quarterly checklist. Takes ~10 minutes for all 45 states.
