/**
 * update_legal_data.js — review / correct legal reference data in Postgres
 * ─────────────────────────────────────────────────────────────────────────
 * Run after a fact-check (fact_check_monitor.js, scan_content_freshness.js)
 * flags a record. Reads and writes the MAIN Postgres database (DATABASE_URL).
 *
 * Show a record (read-only):
 *   node src/scripts/update_legal_data.js --type dui --state TN
 *   node src/scripts/update_legal_data.js --type sol --id 42
 *
 * Correct fields (idempotent — values already equal are reported, not
 * rewritten; source URL + reviewer are required so every change is sourced):
 *   node src/scripts/update_legal_data.js --type dui --state TN \
 *        --set first_license_days=365 --set notes="..." \
 *        --source-url https://www.tn.gov/... --verified-by JD
 *   add --dry-run to print the change without writing it.
 *
 * Every write sets updated_at / last_reviewed_at (where present), source_url and
 * verified_by, records one audit_log row per changed field
 * (action 'reference_data_update') and a scrape_runs row (job 'legal_data').
 * Changing bail_min / bail_max also keeps bail_min_cents / bail_max_cents in
 * step. Provider tables (lawyers, bail_agents, recovery agents) and courthouses
 * are not editable here — use the admin console / proposals queue.
 *
 * The old "SOL null fix" (which filled missing statute-of-limitations years
 * with guessed defaults) is gone on purpose: a NULL means "not researched" or
 * "no limit", and a guessed number is legal misinformation.
 */
import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startRun, finishRun, newCounts } from '../services/dataRefresh/runLog.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

// type → table, key column ('state' rows are unique per state; others by id)
const TYPES = {
  dui:          { table: 'dui_laws',               key: 'state' },
  victim_comp:  { table: 'victim_compensation',    key: 'state' },
  state_bar:    { table: 'state_bar_complaints',   key: 'state' },
  sol:          { table: 'statute_of_limitations', key: 'id' },
  bail:         { table: 'bail_schedules',         key: 'id' },
  drug:         { table: 'drug_penalties',         key: 'id' },
  specialty_courts: { table: 'specialty_courts',   key: 'id' },
  clinics:      { table: 'law_school_clinics',     key: 'id' },
  probation:    { table: 'probation_offices',      key: 'id' },
  federal_courts: { table: 'federal_courts',       key: 'id' },
};
const NEVER_EDIT = new Set(['id', 'created_at', 'updated_at', 'last_reviewed_at', 'source_url', 'verified_by',
  'bail_min_cents', 'bail_max_cents']);
const CENTS_PAIRS = { bail_min: 'bail_min_cents', bail_max: 'bail_max_cents' };

const argv = yargs(hideBin(process.argv))
  .option('type',        { type: 'string', choices: Object.keys(TYPES), describe: 'Which reference table' })
  .option('state',       { type: 'string', describe: 'Two-letter state (state-keyed types)' })
  .option('id',          { type: 'number', describe: 'Row id (id-keyed types)' })
  .option('set',         { type: 'array',  string: true, describe: 'field=value (repeatable); value "null" clears' })
  .option('source-url',  { type: 'string', describe: 'Official source you verified against (required with --set)' })
  .option('verified-by', { type: 'string', describe: 'Reviewer name / initials (required with --set)' })
  .option('dry-run',     { type: 'boolean', default: false })
  .parse();

function parseSets(list, columns) {
  const out = {};
  for (const item of list || []) {
    const i = String(item).indexOf('=');
    if (i < 1) throw new Error(`--set expects field=value, got "${item}"`);
    const field = item.slice(0, i).trim(); const raw = item.slice(i + 1);
    const col = columns.get(field);
    if (!col || NEVER_EDIT.has(field)) throw new Error(`"${field}" is not an editable column of this table`);
    let v;
    if (raw === 'null') v = null;
    else if (['bigint', 'integer', 'smallint'].includes(col)) {
      if (!/^-?\d+$/.test(raw.trim())) throw new Error(`${field} needs an integer`);
      v = parseInt(raw, 10);
    } else if (['double precision', 'numeric', 'real'].includes(col)) {
      if (!Number.isFinite(Number(raw))) throw new Error(`${field} needs a number`);
      v = Number(raw);
    } else v = raw;
    out[field] = v;
  }
  return out;
}

const same = (a, b) => (a === null || a === undefined ? null : String(a)) === (b === null || b === undefined ? null : String(b));

runCli(async () => {
  if (!argv.type) {
    console.log('\nUsage: node src/scripts/update_legal_data.js --type <type> (--state XX | --id N) [--set field=value ... --source-url URL --verified-by NAME] [--dry-run]');
    console.log(`Types: ${Object.keys(TYPES).join(' | ')}`);
    return 0;
  }
  const { table, key } = TYPES[argv.type];
  const keyValue = key === 'state' ? String(argv.state || '').toUpperCase() : argv.id;
  if (key === 'state' && !/^[A-Z]{2}$/.test(keyValue)) throw new Error('--state XX is required for this type');
  if (key === 'id' && !Number.isInteger(keyValue)) throw new Error('--id N is required for this type');

  const db = await openRefreshDb();
  const cols = new Map((await db.all(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`, [table],
  )).map(r => [r.column_name, r.data_type]));
  const row = await db.get(`SELECT * FROM ${table} WHERE ${key} = ?`, [keyValue]);
  if (!row) throw new Error(`no ${table} row with ${key} = ${keyValue}`);

  console.log(`\n${table} ${key}=${keyValue}:`);
  for (const [k, v] of Object.entries(row)) console.log(`  ${k.padEnd(22)} ${v instanceof Date ? v.toISOString() : v}`);
  if (!argv.set?.length) {
    console.log('\nRead-only. Pass --set field=value --source-url URL --verified-by NAME to correct it.');
    return 0;
  }
  if (!argv['source-url'] || !/^https?:\/\//i.test(argv['source-url'])) throw new Error('--source-url https://... is required with --set');
  if (!argv['verified-by']) throw new Error('--verified-by is required with --set');

  const sets = parseSets(argv.set, cols);
  const changes = Object.entries(sets).filter(([f, v]) => !same(row[f], v));
  const counts = newCounts();
  counts.fetched = Object.keys(sets).length;
  counts.unchanged = counts.fetched - changes.length;
  const runId = await startRun(db, { job: 'legal_data', trigger: 'manual', dryRun: argv['dry-run'],
    params: { table, [key]: keyValue, fields: Object.keys(sets), source_url: argv['source-url'], verified_by: argv['verified-by'] } });

  if (!changes.length) {
    await finishRun(db, runId, counts, { message: 'all values already current — nothing written' });
    console.log('\n✓ Every value is already current — nothing to write.');
    return 0;
  }
  for (const [f, v] of changes) console.log(`  ${f}: ${JSON.stringify(row[f])} → ${JSON.stringify(v)}`);
  if (argv['dry-run']) {
    await finishRun(db, runId, counts, { message: `dry run: ${changes.length} field(s) would change` });
    console.log('\nDry run — nothing written.');
    return 0;
  }

  await db.transaction(async (tx) => {
    const assignments = []; const params = [];
    for (const [f, v] of changes) {
      assignments.push(`${f} = ?`); params.push(v);
      if (CENTS_PAIRS[f] && cols.has(CENTS_PAIRS[f])) { assignments.push(`${CENTS_PAIRS[f]} = ?`); params.push(v === null ? null : v * 100); }
    }
    assignments.push('updated_at = NOW()', 'source_url = ?', 'verified_by = ?');
    params.push(argv['source-url'], argv['verified-by']);
    if (cols.has('last_reviewed_at')) assignments.push('last_reviewed_at = NOW()');
    await tx.run(`UPDATE ${table} SET ${assignments.join(', ')} WHERE ${key} = ?`, [...params, keyValue]);
    for (const [f, v] of changes) {
      await tx.run(
        `INSERT INTO audit_log (action, resource_type, resource_id, details, entity_type) VALUES ('reference_data_update', ?, ?, ?, 'reference_data')`,
        [table, String(row.id), JSON.stringify({ field: f, old_value: row[f], new_value: v, source_url: argv['source-url'], verified_by: argv['verified-by'], run_id: runId })]);
    }
  });
  counts.updated = changes.length;
  const status = await finishRun(db, runId, counts, { message: `${table} ${key}=${keyValue}: ${changes.map(c => c[0]).join(', ')}` });
  printRunSummary('Legal data update', { runId, status, counts });
  return 0;
});
