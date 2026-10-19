/**
 * scripts/lib/refreshCli.js — shared plumbing for the operator CLI scripts in
 * src/scripts/: connect to the MAIN database (DATABASE_URL, Postgres only —
 * never the local sql.js fallback), print a run summary, close the pool.
 */
import { getDb, closeDb } from '../../db/index.js';
import { assertPostgres } from '../../services/dataRefresh/runLog.js';

export async function openRefreshDb() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error('DATABASE_URL is not set. These scripts write the main Postgres database the app serves; '
      + 'run them with DATABASE_URL set (e.g. from the Render service Shell: `node src/scripts/<script>.js`).');
  }
  const db = await getDb();
  assertPostgres(db);
  return db;
}

export async function closeRefreshDb() {
  await closeDb().catch(() => {});
}

export function printRunSummary(label, r) {
  const c = r.counts || {};
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${label} — run #${r.runId ?? '-'} ${r.status}${r.dryRun ? ' (dry run: nothing written)' : ''}`);
  console.log(`  fetched ${c.fetched ?? 0} | inserted ${c.inserted ?? 0} | proposed ${c.proposed ?? 0} | `
    + `unchanged ${c.unchanged ?? 0} | updated ${c.updated ?? 0} | skipped ${c.skipped ?? 0} | errors ${c.errors ?? 0}`);
  if (r.message) console.log(`  ${r.message}`);
  if ((c.proposed ?? 0) > 0 && !r.dryRun) {
    console.log('  Changes to existing providers are staged for review: GET /api/admin/proposals');
  }
}

/** Run main(); exit 0 on success / clean skip, 1 on failure; always close the pool. */
export function runCli(main) {
  main()
    .then(async (code) => { await closeRefreshDb(); process.exit(typeof code === 'number' ? code : 0); })
    .catch(async (e) => { console.error(`✗ ${e.message}`); await closeRefreshDb(); process.exit(1); });
}
