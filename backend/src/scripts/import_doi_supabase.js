#!/usr/bin/env node
/**
 * import_doi_supabase.js — Import bail agent license data from all 50 state DOIs
 * ──────────────────────────────────────────────────────────────────────────────
 * (Name kept for existing runbooks: it no longer uses the Supabase REST client.
 *  It writes the MAIN Postgres database through DATABASE_URL and
 *  services/dataRefresh, like every other importer.)
 *
 * SAFETY (lawyers / bail_agents rows are real, verified data):
 *   - a DOI licensee that matches an existing bail agent (fuzzy name/city/phone
 *     match below, high or medium confidence; or source id / phone / name)
 *     never overwrites it — license number, doi_verified, phone, email and
 *     address differences are staged in provider_update_proposals for review;
 *   - borderline matches are skipped and listed for manual review;
 *   - unmatched licensees are inserted (source 'doi_import', doi_verified = 1);
 *   - nothing is deleted (--reset is refused); each state run is logged in
 *     scrape_runs.
 * Supports all 45 states with commercial bail bonding (IL/KY/OR/WI/DC excluded —
 * those states abolished commercial bail bonds).
 *
 * 42 states publish through NIPR standard format → one generic parser.
 * TN, TX, FL use state-specific column maps (different DOI systems).
 *
 * USAGE:
 *   Single state:
 *     node import_doi_supabase.js --file tn_bondsmen.txt --state TN
 *     node import_doi_supabase.js --file nipr_export.csv --state CA
 *
 *   All states at once (with files in data/doi/):
 *     node import_doi_supabase.js --all-states
 *
 *   Dry run:
 *     node import_doi_supabase.js --dry-run --file f.csv --state TX
 *
 *   Match rate report only:
 *     node import_doi_supabase.js --match-only --state TN
 *
 *   All-states report:
 *     node import_doi_supabase.js --match-only --all-states
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * STATES WITH COMMERCIAL BAIL BONDS — 45 states + download info
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * FASTEST PATH — NIPR Bulk Export (covers all 42 NIPR states at once):
 *   1. Create free account at: https://nipr.com
 *   2. Go to: PDB Online Licensee Search → Bulk Download
 *   3. Filter: Line of Authority = "Bail Bond" OR "Surety"
 *   4. Filter: Status = Active
 *   5. Download: all states at once as one CSV
 *   File path: data/doi/nipr_all_states.csv
 *   Then run: node import_doi_supabase.js --file data/doi/nipr_all_states.csv --nipr-all
 *   (script will split by state column automatically)
 *
 * STATE-SPECIFIC DOWNLOADS (use when NIPR doesn't have the state):
 *
 *   TN — Tennessee Board of Professional Bondsmen (new system Jan 2026)
 *     Email: regboards.info@tn.gov — "Request active bondsman licensee list"
 *     OR: https://www.tn.gov/commerce/regboards/bonds.html → Verify a License → export
 *     Format: pipe-delimited (|)
 *
 *   TX — Texas Department of Insurance
 *     https://www.tdi.texas.gov/agent/agentlookup.html
 *     License Type: "Bail Bond Agent" OR "Bail Bond Surety Company", Status: Active → Export CSV
 *     OR direct: https://www.tdi.texas.gov/general/download/agtaj.csv
 *
 *   FL — Florida Department of Financial Services
 *     https://www.myfloridacfo.com/division/agents → Agent License Verification
 *     License Type: "2-34 Limited Surety (Bail Bond) Agent", Status: Active → Export CSV
 *
 * ALL OTHER STATES — use their DOI licensee lookup with bail bond filter:
 *   AL: https://www.aldoi.gov/Agents/LicenseeSearch.aspx
 *   AK: https://www.commerce.alaska.gov/web/ins/
 *   AZ: https://difi.az.gov/licensing/agent-licensing
 *   AR: https://www.insurance.arkansas.gov/agents-brokers/licensing
 *   CA: https://ezlicensing.insurance.ca.gov/ (License type: Bail Bond)
 *   CO: https://doi.colorado.gov/agents/agent-licensing
 *   CT: https://portal.ct.gov/cid/agent-licensing
 *   DE: https://insurance.delaware.gov/agents-licensing/
 *   GA: https://www.oci.ga.gov/LicensureAndFiling/
 *   HI: https://cca.hawaii.gov/ins/agents/
 *   ID: https://doi.idaho.gov/agent-licensing/
 *   IN: https://www.in.gov/idoi/agent/
 *   IA: https://iid.iowa.gov/licensing-agents-producers
 *   KS: https://www.ksinsurance.org/agent-licensing/
 *   LA: https://www.ldi.la.gov/agents/licensing
 *   ME: https://www.maine.gov/pfr/insurance/agents/
 *   MD: https://insurance.maryland.gov/agent/pages/licensing.aspx
 *   MA: https://www.mass.gov/insurance-agent-producer-licensing
 *   MI: https://www.michigan.gov/lara/bureau-list/ofis/
 *   MN: https://mn.gov/commerce/industries/insurance/
 *   MS: https://www.mid.ms.gov/agents/
 *   MO: https://insurance.mo.gov/agents/
 *   MT: https://csimt.gov/agents/
 *   NE: https://doi.nebraska.gov/agent-licensing/
 *   NV: https://doi.nv.gov/Agent/Agent_Licensing/
 *   NH: https://www.nh.gov/insurance/agents/
 *   NJ: https://www.state.nj.us/dobi/agentlic.htm
 *   NM: https://www.osi.state.nm.us/agents/
 *   NY: https://www.dfs.ny.gov/agents_brokers/licensing (Surety license)
 *   NC: https://www.ncdoi.gov/agent-services/
 *   ND: https://www.nd.gov/ndins/agents/
 *   OH: https://www.insurance.ohio.gov/agents/licensing
 *   OK: https://www.oid.ok.gov/agents-licensing/
 *   PA: https://www.insurance.pa.gov/Agents/Pages/default.aspx
 *   RI: https://health.ri.gov/licenses/detail.php
 *   SC: https://www.doi.sc.gov/agents/
 *   SD: https://dlr.sd.gov/insurance/agents/
 *   UT: https://insurance.utah.gov/agents/licensing/
 *   VA: https://www.scc.virginia.gov/pages/Agent-Licensing
 *   WA: https://www.insurance.wa.gov/agent-licensing
 *   WV: https://www.wvinsurance.gov/Agents
 *   WY: https://doi.wyo.gov/agents/
 *
 * EXCLUDED — no commercial bail bonds in these jurisdictions:
 *   IL: abolished 1963 | KY: abolished 1976 | OR: abolished 1974
 *   WI: abolished 1979 | DC: no commercial bail bonds
 */

import 'dotenv/config';
import fs                 from 'fs';
import path               from 'path';
import { parse }          from 'csv-parse/sync';
import { fileURLToPath }  from 'url';
import yargs              from 'yargs';
import { hideBin }        from 'yargs/helpers';
import { createProviderWriter } from '../services/dataRefresh/providerStore.js';
import { DIRECTORY_LOCK } from '../services/dataRefresh/providerRefresh.js';
import { startRun, finishRun, withJobLock, newCounts } from '../services/dataRefresh/runLog.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = yargs(hideBin(process.argv))
  .option('file',        { type: 'string',  describe: 'Path to DOI export file' })
  .option('state',       { type: 'string',  describe: 'Two-letter state code (e.g. TN)' })
  .option('all-states',  { type: 'boolean', default: false, describe: 'Process all states from data/doi/' })
  .option('nipr-all',    { type: 'boolean', default: false, describe: 'Single NIPR file covering multiple states' })
  .option('dry-run',     { type: 'boolean', default: false })
  .option('match-only',  { type: 'boolean', default: false })
  .option('reset',       { type: 'boolean', default: false })
  .option('threshold',   { type: 'number',  default: 0.75 })
  .check(a => {
    if (!a['match-only'] && !a['all-states'] && !a.file)
      throw new Error('--file required unless using --match-only or --all-states');
    if (!a['match-only'] && !a['all-states'] && !a['nipr-all'] && !a.state)
      throw new Error('--state required (e.g. --state TN)');
    return true;
  })
  .argv;

// ── States with commercial bail bonds ────────────────────────────────────────
const BAIL_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IN','IA',
  'KS','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','PA','RI','SC','SD','TN','TX','UT','VA',
  'WA','WV','WY',
]);

// States where commercial bail bonding is abolished — never import
const NO_BAIL_STATES = new Set(['IL','KY','OR','WI','DC']);

// ── Bail bond license type detection ─────────────────────────────────────────
// Matches the license type strings used by state DOIs and NIPR
const BAIL_POSITIVE = [
  'bail bond', 'bail bondsman', 'professional bondsman', 'limited surety',
  'bail agent', 'surety bail', 'bail', 'surety',
];
// Negative guard: "bail enforcement" / "bail recovery" = bounty hunter, NOT a bondsman
const BAIL_NEGATIVE = [
  'bail enforcement agent', 'bail recovery agent', 'bail recovery',
  'bounty hunter', 'fugitive recovery',
];

function isBailLicense(licenseType = '', lineOfAuthority = '') {
  const combined = `${licenseType} ${lineOfAuthority}`.toLowerCase();
  const hasPositive = BAIL_POSITIVE.some(p => combined.includes(p));
  const hasNegative = BAIL_NEGATIVE.some(n => combined.includes(n));
  return hasPositive && !hasNegative;
}

// ── NIPR standard parser (covers 42 states) ──────────────────────────────────
// NIPR export column headers are consistent. Delimiter varies (usually comma).
const NIPR_STANDARD = {
  delimiter: ',',
  filter: row => {
    const status = (row['Status'] || row['License Status'] || '').toLowerCase();
    const lt     = row['License Type'] || row['License_Type'] || row['license_type'] || '';
    const loa    = row['Line of Authority'] || row['LOA'] || '';
    return status === 'active' && isBailLicense(lt, loa);
  },
  extract: (row, stateOverride) => ({
    name:           [row['First Name'], row['Middle Name'], row['Last Name']]
                      .filter(Boolean).join(' ').trim() || row['Business Name'] || '',
    company:        row['Business Name'] || row['business_name'] || '',
    license_number: row['License Number'] || row['license_number'] || row['License_Number'] || '',
    phone:          normalizePhone(row['Phone'] || row['phone'] || ''),
    email:          (row['Email'] || row['email'] || '').toLowerCase().trim(),
    city:           titleCase(row['City'] || row['city'] || ''),
    state:          stateOverride || (row['State'] || row['state'] || '').toUpperCase(),
    address:        row['Address'] || row['address'] || '',
    zip:            (row['Zip'] || row['ZIP'] || row['zip'] || '').replace(/\D/g,'').slice(0,5),
    npn:            row['NPN'] || row['npn'] || '',
  }),
};

// ── State-specific parsers (TN, TX, FL use different DOI systems) ─────────────
const STATE_PARSERS = {
  // TN — Board of Professional Bondsmen (pipe-delimited, new Jan 2026)
  TN: {
    delimiter: '|',
    filter: row => {
      const lc = (row['License Class'] || '').toLowerCase();
      const lt = (row['License Type']  || '').toLowerCase();
      const ls = (row['License Status']|| '').toLowerCase();
      return isBailLicense(lc, lt) && ls === 'active';
    },
    extract: (row) => ({
      name:           [row['First Name'], row['Middle Name'], row['Last Name']]
                        .filter(Boolean).join(' ').trim() || row['Business Name'] || '',
      company:        row['Business Name'] || '',
      license_number: row['License Number'] || '',
      phone:          normalizePhone(row['Phone'] || ''),
      email:          (row['Email'] || '').toLowerCase().trim(),
      city:           titleCase(row['City'] || ''),
      state:          'TN',
      address:        row['Residence Address'] || '',
      zip:            (row['Zip'] || '').replace(/\D/g,'').slice(0,5),
      npn:            row['NPN'] || '',
    }),
  },

  // TX — TDI agent lookup CSV export
  TX: {
    delimiter: ',',
    filter: row => {
      const lt = (row['License Type'] || row['license_type'] || '').toLowerCase();
      const s  = (row['Status']       || row['status']       || '').toLowerCase();
      return isBailLicense(lt, '') && s === 'active';
    },
    extract: (row) => ({
      name:           row['Full Name'] || row['full_name'] || row['Name'] || '',
      company:        row['Business Name'] || '',
      license_number: row['License Number'] || row['license_number'] || '',
      phone:          normalizePhone(row['Phone'] || row['phone'] || ''),
      email:          (row['Email'] || row['email'] || '').toLowerCase().trim(),
      city:           titleCase(row['City'] || row['city'] || ''),
      state:          'TX',
      address:        row['Address'] || '',
      zip:            (row['Zip'] || row['zip'] || '').replace(/\D/g,'').slice(0,5),
      npn:            row['NPN'] || '',
    }),
  },

  // FL — MyFloridaCFO DFS agent lookup CSV
  FL: {
    delimiter: ',',
    filter: row => {
      const lt = (row['License Type'] || '').toLowerCase();
      const s  = (row['Status']       || '').toLowerCase();
      return isBailLicense(lt, '') && s.includes('active');
    },
    extract: (row) => ({
      name:           row['Name'] || row['Business Name'] || '',
      company:        row['Business Name'] || row['Name'] || '',
      license_number: row['License Number'] || '',
      phone:          normalizePhone(row['Phone'] || ''),
      email:          (row['Email'] || '').toLowerCase().trim(),
      city:           titleCase(row['City'] || ''),
      state:          'FL',
      address:        row['Address'] || '',
      zip:            (row['Zip'] || '').replace(/\D/g,'').slice(0,5),
      npn:            '',
    }),
  },

  // All other states use NIPR_STANDARD (assigned dynamically below)
};

// Assign NIPR_STANDARD to all remaining bail states
for (const code of BAIL_STATES) {
  if (!STATE_PARSERS[code]) STATE_PARSERS[code] = NIPR_STANDARD;
}

// ── Database (main Postgres; opened in main) ─────────────────────────────────
let db = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return raw || '';
}

function titleCase(str) {
  return (str || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeName(name) {
  return (name || '').toLowerCase()
    .replace(/\b(bail|bonds?|bonding|company|co\.?|inc\.?|llc\.?|ltd\.?|corp\.?|agency|services?|group|associates?)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function jaccardSimilarity(a, b) {
  const setA = new Set(normalizeName(a).split(' ').filter(w => w.length > 2));
  const setB = new Set(normalizeName(b).split(' ').filter(w => w.length > 2));
  if (!setA.size || !setB.size) return 0;
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  return intersection.size / new Set([...setA, ...setB]).size;
}

// ── Match confidence tiers ────────────────────────────────────────────────────
const CONFIDENCE = { HIGH: 0.90, MEDIUM: 0.75, BORDERLINE: 0.60 };

function findBestMatch(doiRecord, dbRecords, threshold) {
  const doiNorm = normalizeName(doiRecord.name + ' ' + doiRecord.company);
  // Guard: require at least 2 meaningful words before matching
  if (doiNorm.split(' ').filter(w => w.length > 2).length < 2) {
    return { match: null, score: 0, factors: ['name_too_short'], tier: 'skip' };
  }

  const doiCity  = normalizeName(doiRecord.city);
  const doiZip   = (doiRecord.zip  || '').replace(/\D/g,'').slice(0,5);
  const doiPhone = (doiRecord.phone|| '').replace(/\D/g,'');

  let best = null, bestScore = 0, bestFactors = [];

  for (const dbRow of dbRecords) {
    if (dbRow.state !== doiRecord.state)                     continue;
    if (dbRow.doi_verified && dbRow.license_number)          continue; // never overwrite verified

    const factors = [];
    let   score   = 0;

    // Factor 1: Phone exact match (strongest signal)
    const dbPhone = (dbRow.phone || '').replace(/\D/g,'');
    if (doiPhone && dbPhone && doiPhone.length >= 10 && doiPhone === dbPhone) {
      score = 1.0;
      factors.push('phone_exact');
    } else {
      // Factor 2: Name similarity
      const dbNorm  = normalizeName(dbRow.name + ' ' + (dbRow.company || ''));
      const nameSim = jaccardSimilarity(doiNorm, dbNorm);
      score         = nameSim;
      if (nameSim > 0) factors.push(`name_${nameSim.toFixed(2)}`);

      // Factor 3: City match (required)
      const dbCity   = normalizeName(dbRow.city || '');
      const cityOk   = dbCity === doiCity ||
                       dbCity.split(' ')[0] === doiCity.split(' ')[0];
      if (!cityOk) continue;
      factors.push(dbCity === doiCity ? 'city_exact' : 'city_partial');
      score += dbCity === doiCity ? 0.05 : 0.02;

      // Factor 4: Zip tiebreaker
      const dbZip = (dbRow.zip || '').replace(/\D/g,'').slice(0,5);
      if (doiZip && dbZip && doiZip === dbZip) { score += 0.08; factors.push('zip_match'); }
    }

    if (score > bestScore) { bestScore = score; best = dbRow; bestFactors = factors; }
  }

  const tier = bestScore >= CONFIDENCE.HIGH       ? 'high'
             : bestScore >= threshold             ? 'medium'
             : bestScore >= CONFIDENCE.BORDERLINE ? 'borderline'
             : 'no_match';

  if (tier === 'borderline') {
    console.log(`  [REVIEW] Borderline (${bestScore.toFixed(2)}): ` +
      `"${doiRecord.name}" ↔ "${best?.name}" [${bestFactors.join(',')}]`);
    return { match: null, score: bestScore, factors: bestFactors, tier };
  }
  return { match: tier !== 'no_match' ? best : null, score: bestScore, factors: bestFactors, tier };
}

// ── Import a single state ─────────────────────────────────────────────────────
async function importState(stateCode, filePath, options = {}) {
  const { dryRun = false, matchOnly = false, threshold = 0.75 } = options;

  if (NO_BAIL_STATES.has(stateCode)) {
    console.log(`  ${stateCode}: SKIP — commercial bail bonds abolished in this state`);
    return { state: stateCode, skipped: 0, matched: 0, inserted: 0, reason: 'no_commercial_bail' };
  }
  if (!BAIL_STATES.has(stateCode)) {
    console.log(`  ${stateCode}: SKIP — not in supported states list`);
    return { state: stateCode, skipped: 0, matched: 0, inserted: 0, reason: 'unsupported' };
  }

  // Load existing DB records for this state (read-only — used for matching)
  const existing = await db.all(
    'SELECT id, name, company, phone, city, state, license_number, doi_verified FROM bail_agents WHERE state = ?',
    [stateCode]);

  if (matchOnly) {
    const licensed = existing.filter(a => a.license_number).length;
    const verified = existing.filter(a => a.doi_verified).length;
    console.log(`  ${stateCode}: ${existing.length} agents | ${licensed} licensed | ${verified} doi_verified | ${((licensed/Math.max(existing.length,1))*100).toFixed(1)}%`);
    return { state: stateCode, total: existing.length, licensed, verified };
  }

  if (!filePath || !fs.existsSync(filePath)) {
    const expected = path.resolve(`data/doi/${stateCode.toLowerCase()}_agents.csv`);
    console.log(`  ${stateCode}: file not found — expected: ${expected}`);
    return { state: stateCode, skipped: 0, matched: 0, inserted: 0, reason: 'file_missing' };
  }

  const parser  = STATE_PARSERS[stateCode] || NIPR_STANDARD;
  const raw     = fs.readFileSync(filePath, 'utf-8');
  let   rows;
  try {
    rows = parse(raw, { delimiter: parser.delimiter, columns: true,
                        skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch {
    // Try the other common delimiter
    try {
      rows = parse(raw, { delimiter: parser.delimiter === ',' ? '|' : ',',
                          columns: true, skip_empty_lines: true, trim: true });
    } catch (e) { console.error(`  ${stateCode}: parse failed: ${e.message}`); return; }
  }

  const filtered = rows.filter(parser.filter);
  if (dryRun) {
    console.log(`  ${stateCode}: ${filtered.length} bail agents (dry run — first 3, nothing written):`);
    filtered.slice(0,3).forEach(r => {
      const d = parser.extract(r, stateCode);
      console.log(`    ${d.license_number} | ${d.name.substring(0,25).padEnd(25)} | ${d.city}`);
    });
  }

  const records = [];
  let borderline = 0, unusable = 0;
  for (const row of filtered) {
    const data = parser.extract(row, stateCode);
    if (!data.name.trim() || !data.license_number) { unusable++; continue; }
    const { match, tier } = findBestMatch(data, existing, threshold);
    if (tier === 'borderline') { borderline++; continue; }
    records.push({
      type: 'bail_agents', source: 'doi_import',
      source_id: `doi_${stateCode}_${data.license_number.replace(/\W/g, '_')}`,
      matchId: match && (tier === 'high' || tier === 'medium') ? match.id : null,
      name: data.name, company: data.company || null,
      phone: data.phone || null, email: data.email || null, address: data.address || null,
      city: data.city, state: stateCode,
      license_number: data.license_number, license_type: 'state DOI bail license', doi_verified: 1,
    });
  }

  const counts = newCounts();
  counts.fetched = filtered.length;
  counts.skipped = unusable + borderline;
  const errorSamples = [];
  const runId = await startRun(db, { job: 'doi_import', trigger: 'manual', params: { state: stateCode, file: path.basename(filePath), threshold }, dryRun });
  await createProviderWriter(db, 'bail_agents', { runId, dryRun, counts, errorSamples }).writeAll(records);
  const status = await finishRun(db, runId, counts, { errorSamples, message: borderline ? `${borderline} borderline matches skipped for manual review` : null });
  console.log(`  ${stateCode}: run #${runId} ${status} — inserted=${counts.inserted} proposed=${counts.proposed} unchanged=${counts.unchanged} skipped=${counts.skipped} errors=${counts.errors}`);
  return { state: stateCode, runId, status, ...counts };
}

// ── NIPR all-states mode ──────────────────────────────────────────────────────
async function importNiprAll(filePath, options) {
  const raw  = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(raw, { delimiter: ',', columns: true,
                             skip_empty_lines: true, relax_column_count: true, trim: true });
  // Split by state column then run per-state
  const byState = {};
  for (const row of rows) {
    const st = (row['State'] || row['state'] || '').toUpperCase();
    if (st && BAIL_STATES.has(st)) {
      (byState[st] = byState[st] || []).push(row);
    }
  }
  console.log(`NIPR file covers ${Object.keys(byState).length} states`);
  for (const [st, stRows] of Object.entries(byState)) {
    // Write to temp file and import
    const tmpPath = `/tmp/nipr_${st}.csv`;
    const header = Object.keys(stRows[0]).join(',');
    const body   = stRows.map(r => Object.values(r).map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    fs.writeFileSync(tmpPath, header + '\n' + body);
    await importState(st, tmpPath, options);
    fs.unlinkSync(tmpPath);
  }
}

// ── All-states mode ───────────────────────────────────────────────────────────
async function importAllStates(options) {
  const doiDir = path.resolve('data/doi');
  console.log(`\nScanning ${doiDir} for state DOI files...`);

  const results = [];
  for (const stateCode of [...BAIL_STATES].sort()) {
    // Look for any file matching the state code
    const candidates = fs.existsSync(doiDir)
      ? fs.readdirSync(doiDir)
          .filter(f => f.toUpperCase().includes(stateCode) &&
                       (f.endsWith('.csv') || f.endsWith('.txt') || f.endsWith('.xls')))
          .map(f => path.join(doiDir, f))
      : [];

    const filePath = candidates[0] || null;
    const result   = await importState(stateCode, filePath, options);
    if (result) results.push(result);
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
runCli(async () => {
  if (argv.reset) {
    console.error('--reset is no longer supported: imports never delete bail_agents rows.');
    return 1;
  }
  console.log('\n🏛️  DOI Import — Justice Gavel → Postgres');
  console.log(`   Supported states: ${[...BAIL_STATES].sort().join(', ')}`);
  console.log(`   Excluded (no commercial bail): ${[...NO_BAIL_STATES].sort().join(', ')}\n`);

  const options = { dryRun: argv['dry-run'], matchOnly: argv['match-only'], threshold: argv.threshold };
  db = await openRefreshDb();
  const locked = await withJobLock(db, DIRECTORY_LOCK, async () => {
    if (argv['nipr-all']) {
      await importNiprAll(path.resolve(argv.file), options);
    } else if (argv['all-states']) {
      const results = await importAllStates(options);
      const totals  = results.reduce((a, r) => ({
        inserted: a.inserted + (r.inserted || 0),
        proposed: a.proposed + (r.proposed || 0),
        skipped:  a.skipped + (r.skipped || 0),
        errors:   a.errors + (r.errors || 0),
      }), { inserted: 0, proposed: 0, skipped: 0, errors: 0 });
      printRunSummary('DOI import (all states)', { status: totals.errors ? 'partial' : 'ok', counts: totals, dryRun: options.dryRun });
    } else {
      const stateCode = argv.state.toUpperCase();
      if (NO_BAIL_STATES.has(stateCode)) {
        console.error(`❌ ${stateCode} has abolished commercial bail bonds — no import needed.`);
        return;
      }
      const r = await importState(stateCode, argv.file ? path.resolve(argv.file) : null, options);
      if (r?.runId) printRunSummary(`DOI import (${stateCode})`, { runId: r.runId, status: r.status, counts: r, dryRun: options.dryRun });
    }
  });
  if (!locked.locked) console.log('ℹ️  Another provider-directory run is in progress — try again later.');
  return 0;
});
