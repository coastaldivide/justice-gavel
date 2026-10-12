/**
 * scrape_recovery_agents.js — fugitive recovery / bail enforcement agents
 * ─────────────────────────────────────────────────────────────────────────
 * Google Places → recovery_agents in the MAIN Postgres database (DATABASE_URL)
 * via services/dataRefresh/recoveryRefresh.js:
 *   - agents not yet listed are inserted (source 'google', source_id
 *     'google_ra_<place id>', timestamps);
 *   - changes for agents already listed are staged in
 *     provider_update_proposals (GET /api/admin/proposals), never written;
 *   - nothing is deleted or deactivated; each run is logged in scrape_runs.
 *
 * Usage (from backend/):
 *   node src/scripts/scrape_recovery_agents.js
 *   node src/scripts/scrape_recovery_agents.js --state TN
 *   node src/scripts/scrape_recovery_agents.js --limit 5      # first N cities
 *   node src/scripts/scrape_recovery_agents.js --dry-run
 *
 * Requires GOOGLE_PLACES_KEY — without it the script says so and exits 0.
 */
import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runRecoveryAgentRefresh, RECOVERY_CITIES } from '../services/dataRefresh/recoveryRefresh.js';
import { placesKeyConfigured } from '../services/dataRefresh/googlePlaces.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

const argv = yargs(hideBin(process.argv))
  .option('state',   { type: 'string',  default: 'all' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('limit',   { type: 'number',  default: 999 })
  .strict()
  .parse();

runCli(async () => {
  if (!placesKeyConfigured()) {
    console.log('ℹ️  GOOGLE_PLACES_KEY is not set — recovery-agent scrape skipped. Set it to enable this scrape. Nothing was fetched or written.');
    return 0;
  }
  let cities = RECOVERY_CITIES;
  if (argv.state !== 'all') cities = cities.filter(c => c.state === String(argv.state).toUpperCase());
  cities = cities.slice(0, Math.max(0, argv.limit));
  if (!cities.length) throw new Error('no covered city matches --state');
  const db = await openRefreshDb();
  console.log(`\n🔍 Recovery-agent scrape → Postgres | ${cities.length} cities${argv['dry-run'] ? ' | DRY RUN' : ''}`);
  const r = await runRecoveryAgentRefresh({ db, cities, dryRun: argv['dry-run'], trigger: 'manual', log: l => console.log(`  📍 ${l}`) });
  printRunSummary('Recovery-agent scrape', { ...r, dryRun: argv['dry-run'] });
  return r.status === 'failed' ? 1 : 0;
});
