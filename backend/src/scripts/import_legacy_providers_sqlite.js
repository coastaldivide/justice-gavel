/**
 * import_legacy_providers_sqlite.js — one-off: bring providers that only exist
 * in the retired local SQLite file (backend/data/providers.sqlite) into the
 * main Postgres database.
 *
 * Before this step every scraper wrote that file instead of Postgres, so a
 * provider scraped after the Postgres seed was taken would exist only there.
 * Same safety rules as every scraper (services/dataRefresh/providerStore.js):
 *   - providers not in Postgres (by source id, phone, name + city + state)
 *     are inserted with their original source / source_id;
 *   - providers already in Postgres are NEVER changed; any field that differs
 *     is staged in provider_update_proposals for admin review;
 *   - nothing is deleted, and the SQLite file is only read (never modified or
 *     removed).
 *
 * Default is a DRY RUN that prints what would happen. Pass --apply to write.
 *   node src/scripts/import_legacy_providers_sqlite.js                 # report only
 *   node src/scripts/import_legacy_providers_sqlite.js --apply         # import
 *   node src/scripts/import_legacy_providers_sqlite.js --file path/to/providers.sqlite
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import initSqlJs from 'sql.js';
import { createProviderWriter } from '../services/dataRefresh/providerStore.js';
import { DIRECTORY_LOCK } from '../services/dataRefresh/providerRefresh.js';
import { startRun, finishRun, withJobLock, newCounts } from '../services/dataRefresh/runLog.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = yargs(hideBin(process.argv))
  .option('file',  { type: 'string', default: path.resolve(__dirname, '../../data/providers.sqlite') })
  .option('apply', { type: 'boolean', default: false, describe: 'Write to Postgres (default: dry run)' })
  .strict()
  .parse();

const TABLES = {
  lawyers: ['phone', 'email', 'address', 'website', 'hours', 'rating', 'reviews', 'lat', 'lng', 'bar_number',
    'bar_state', 'specialties', 'languages', 'bio', 'pro_bono', 'sliding_scale', 'free_consultation', 'years_experience'],
  bail_agents: ['phone', 'email', 'address', 'website', 'hours', 'rating', 'reviews', 'lat', 'lng',
    'license_number', 'bio', 'available_24_7'],
  recovery_agents: ['phone', 'email', 'address', 'website', 'hours', 'rating', 'reviews', 'lat', 'lng',
    'license_number', 'available_24_7', 'bio'],
};

function readTable(sqlDb, table) {
  const exists = sqlDb.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
  if (!exists.length) return [];
  const res = sqlDb.exec(`SELECT * FROM ${table}`);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

runCli(async () => {
  if (!fs.existsSync(argv.file)) {
    console.log(`ℹ️  ${argv.file} not found — nothing to import.`);
    return 0;
  }
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database(fs.readFileSync(argv.file));   // in-memory copy; the file is not modified
  const dryRun = !argv.apply;
  const db = await openRefreshDb();
  console.log(`\n📦 Legacy SQLite → Postgres provider import${dryRun ? ' (DRY RUN — pass --apply to write)' : ''}`);
  console.log(`   source: ${argv.file}`);

  const locked = await withJobLock(db, DIRECTORY_LOCK, async () => {
    const summary = {};
    for (const [table, fields] of Object.entries(TABLES)) {
      const rows = readTable(sqlDb, table);
      const counts = newCounts();
      counts.fetched = rows.length;
      const errorSamples = [];
      const runId = await startRun(db, { job: 'legacy_sqlite_import', trigger: 'manual', dryRun,
        params: { table, file: path.basename(argv.file) } });
      const records = rows.map((r) => {
        const rec = { type: table, name: r.name, city: r.city, state: r.state,
          source: r.source || 'legacy_sqlite', source_id: r.source_id || `legacy_sqlite_${table}_${r.id}` };
        for (const f of fields) if (r[f] !== undefined && r[f] !== null && r[f] !== '') rec[f] = r[f];
        return rec;
      });
      await createProviderWriter(db, table, { runId, dryRun, counts, errorSamples }).writeAll(records);
      const status = await finishRun(db, runId, counts, { errorSamples, message: `legacy ${table}` });
      summary[table] = { runId, status, counts };
      printRunSummary(`legacy ${table}`, { runId, status, counts, dryRun });
    }
    return summary;
  });
  sqlDb.close();
  if (!locked.locked) {
    console.log('ℹ️  Another provider-directory run is in progress — try again later.');
    return 0;
  }
  return Object.values(locked.result).some(r => r.status === 'failed') ? 1 : 0;
});
