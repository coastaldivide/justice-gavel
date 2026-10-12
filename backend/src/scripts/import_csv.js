/**
 * import_csv.js — Import attorneys or bail agents from a CSV file
 *
 * This is the "no-code" way to add real attorneys to the database.
 * Download a CSV from a state bar, clean it in Excel/Google Sheets,
 * and import it here.
 *
 * Usage:
 *   node src/scripts/import_csv.js --file attorneys.csv --type lawyers
 *   node src/scripts/import_csv.js --file bail_agents.csv --type bail
 *   node src/scripts/import_csv.js --file attorneys.csv --dry-run
 *   node src/scripts/import_csv.js --file attorneys.csv --city "Nashville, TN"
 *
 * Required CSV columns (case-insensitive, order doesn't matter):
 *   name         — Attorney or business name (required)
 *   phone        — Phone number in any format
 *   address      — Full street address
 *   city         — City (or use --city flag to set for all rows)
 *   email        — Email address
 *   website      — Website URL
 *   bar_number   — State bar number (lawyers only)
 *   specialties  — Comma-separated: "DUI, Drug Offenses, Assault"
 *   languages    — Comma-separated: "English, Spanish"
 *   pro_bono     — yes/no/true/false/1/0
 *   sliding_scale — yes/no/true/false/1/0
 *   free_consultation — yes/no/true/false/1/0
 *   years_experience  — Number
 *   bio          — Short bio / description
 *   verified     — yes/no (set to yes only if you've verified the listing)
 *   lat          — Latitude (optional, will be null if omitted)
 *   lng          — Longitude (optional, will be null if omitted)
 *
 *   state        — 2-letter state (or put "City, ST" in city / --city)
 *
 * Template CSV: run with --template to print a blank CSV header
 *
 * Writes the MAIN Postgres database (DATABASE_URL) through
 * services/dataRefresh: rows for providers not yet listed are inserted
 * (source 'csv'); for providers already listed (matched by phone or
 * name + city + state) the CSV's differing values are staged in
 * provider_update_proposals for admin review — an existing row is never
 * overwritten, and nothing is deleted. Each import is logged in scrape_runs.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createProviderWriter } from '../services/dataRefresh/providerStore.js';
import { DIRECTORY_LOCK } from '../services/dataRefresh/providerRefresh.js';
import { startRun, finishRun, withJobLock, newCounts } from '../services/dataRefresh/runLog.js';
import { splitCityState } from '../services/dataRefresh/normalize.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

const argv = yargs(hideBin(process.argv))
  .option('file',     { type: 'string',  describe: 'Path to CSV file' })
  .option('type',     { type: 'string',  choices: ['lawyers', 'bail'], default: 'lawyers' })
  .option('city',     { type: 'string',  describe: 'Override/default city for all rows' })
  .option('dry-run',  { type: 'boolean', default: false })
  .option('template', { type: 'boolean', default: false, describe: 'Print blank CSV template and exit' })
  .argv;

// ── CSV template ──────────────────────────────────────────────────────────────
if (argv.template) {
  const lawyerCols = 'name,phone,address,city,state,email,website,bar_number,specialties,languages,pro_bono,sliding_scale,free_consultation,years_experience,bio,verified,lat,lng';
  const bailCols   = 'name,phone,address,city,state,email,website,hours,verified,lat,lng';
  const cols = argv.type === 'bail' ? bailCols : lawyerCols;
  console.log(cols);
  console.log(`# Paste your data below this line. Remove this comment row before importing.`);
  console.log(`# Example (lawyers):`);
  console.log(`Jane Smith Esq.,615-555-0100,"123 Main St, Nashville, TN",Nashville,TN,jane@smithlaw.com,https://smithlaw.com,TN012345,"DUI, Drug Offenses","English, Spanish",yes,yes,yes,12,Former public defender. Free consultations.,yes,36.1627,-86.7816`);
  process.exit(0);
}

if (!argv.file) {
  console.error('Error: --file is required. Run with --template to see the CSV format.');
  process.exit(1);
}

// ── CSV parser (no dependencies — pure Node.js) ───────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

async function readCSV(filePath) {
  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // skip blank + comment lines
    lines.push(parseCSVLine(trimmed));
  }

  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');

  const headers = lines[0].map(h => h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  const rows = lines.slice(1).map(values => {
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });

  return rows;
}

// ── Value normalizers ─────────────────────────────────────────────────────────
function normalizeBool(s) {
  if (!s) return 0;
  return /^(yes|true|1|y)$/i.test(String(s).trim()) ? 1 : 0;
}

function splitList(s, fallback) {
  const list = String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

/** One CSV row → provider record (validation happens in providerStore). */
function toRecord(row, type, defaultCity) {
  const name = row.name?.trim();
  const { city, state } = splitCityState(row.city?.trim() || defaultCity || '', row.state);
  if (!name || !city || !state) return { skip: `"${name || '?'}" — needs name, city and a 2-letter state (state column or "City, ST")` };
  const rec = {
    type: type === 'bail' ? 'bail_agents' : 'lawyers',
    source: 'csv',
    source_id: `csv_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40)}_${city.replace(/\W/g, '').toLowerCase().substring(0, 16)}_${state.toLowerCase()}`,
    name, city, state,
    phone: row.phone || null,
    address: row.address?.trim() || null,
    email: row.email?.trim() || null,
    website: row.website || null,
    lat: row.lat || null, lng: row.lng || null,
    // operator-asserted on NEW rows only; never changes an existing row
    verified: normalizeBool(row.verified || row.verified_),
  };
  if (rec.type === 'lawyers') {
    Object.assign(rec, {
      bar_number: row.bar_number || null,
      pro_bono: normalizeBool(row.pro_bono),
      sliding_scale: normalizeBool(row.sliding_scale),
      free_consultation: normalizeBool(row.free_consultation),
      years_experience: row.years_experience ? parseInt(row.years_experience, 10) || null : null,
      bio: row.bio?.trim() || null,
      specialties: splitList(row.specialties, ['Criminal Defense']),
      languages: splitList(row.languages, ['English']),
    });
  } else {
    rec.hours = row.hours || null;
  }
  return { rec };
}

// ── Main ──────────────────────────────────────────────────────────────────────
runCli(async () => {
  if (!fs.existsSync(argv.file)) {
    console.error(`File not found: ${argv.file}`);
    return 1;
  }
  const dryRun = argv['dry-run'];
  console.log(`\n📂 Importing ${argv.type} from ${argv.file} → Postgres`);
  if (dryRun) console.log('   DRY RUN — no changes will be made\n');

  const rows = await readCSV(argv.file);
  console.log(`   ${rows.length} rows found\n`);
  const records = [];
  let unusable = 0;
  for (const row of rows) {
    const r = toRecord(row, argv.type, argv.city);
    if (r.skip) { unusable++; console.warn(`  ⚠ Skipping ${r.skip}`); continue; }
    records.push(r.rec);
  }

  const db = await openRefreshDb();
  const table = argv.type === 'bail' ? 'bail_agents' : 'lawyers';
  const locked = await withJobLock(db, DIRECTORY_LOCK, async () => {
    const counts = newCounts();
    counts.fetched = rows.length;
    counts.skipped = unusable;
    const errorSamples = [];
    const runId = await startRun(db, { job: 'csv_import', trigger: 'manual', params: { type: table, file: path.basename(argv.file) }, dryRun });
    await createProviderWriter(db, table, {
      runId, dryRun, counts, errorSamples,
      onResult: (o) => { if (o.result === 'error') console.error(`  ✗ ${o.error}`); },
    }).writeAll(records);
    const status = await finishRun(db, runId, counts, { errorSamples });
    return { runId, status, counts };
  });
  if (!locked.locked) {
    console.log('ℹ️  Another provider-directory run is in progress — try again later.');
    return 0;
  }
  printRunSummary(`CSV import (${table})`, { ...locked.result, dryRun });
  return locked.result.status === 'failed' ? 1 : 0;
});
