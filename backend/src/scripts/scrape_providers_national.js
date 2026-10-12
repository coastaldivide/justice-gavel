/**
 * scrape_providers_national.js — national attorney & bail-agent refresh
 * ───────────────────────────────────────────────────────────────────────
 * Same pipeline as refresh.js (services/dataRefresh) over every covered city
 * (one or more per state + DC), with the deeper "full" Google query set and the
 * public state-bar listing as an extra source. Writes the MAIN Postgres
 * database (DATABASE_URL):
 *   - providers not yet listed are inserted (source / source_id / timestamps,
 *     unverified — a scrape never marks anyone verified);
 *   - changes for providers already listed are staged in
 *     provider_update_proposals for admin review, never written to the row;
 *   - nothing is deleted or deactivated; each run is logged in scrape_runs.
 *
 * Usage (from backend/):
 *   node src/scripts/scrape_providers_national.js                  # all cities, all sources
 *   node src/scripts/scrape_providers_national.js --state TX       # one state
 *   node src/scripts/scrape_providers_national.js --city Houston   # cities matching
 *   node src/scripts/scrape_providers_national.js --type lawyers|bail|civil|all
 *   node src/scripts/scrape_providers_national.js --source bar|google|yelp|all
 *   node src/scripts/scrape_providers_national.js --dry-run
 *   node src/scripts/scrape_providers_national.js --list
 *
 * Keys: GOOGLE_PLACES_KEY (Google), YELP_API_KEY (Yelp). The state-bar source
 * needs none. A source without its key is skipped with a message; when no
 * selected source can run the script exits 0 without writing anything.
 * Cost guard: GOOGLE_PLACES_MAX_REQUESTS (default 5000 per run).
 */
import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runProviderRefresh } from '../services/dataRefresh/providerRefresh.js';
import { placesKeyConfigured } from '../services/dataRefresh/googlePlaces.js';
import { ALL_BAR_CITIES } from '../services/dataRefresh/barCities.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

const argv = yargs(hideBin(process.argv))
  .option('state',   { type: 'string', default: 'all' })
  .option('city',    { type: 'string', default: 'all' })
  .option('type',    { type: 'string', choices: ['lawyers', 'bail', 'civil', 'all'], default: 'all' })
  .option('source',  { type: 'string', choices: ['bar', 'google', 'yelp', 'all'], default: 'all' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('list',    { type: 'boolean', default: false })
  .strict()
  .parse();

const ALL_CITIES = ALL_BAR_CITIES;

runCli(async () => {
  if (argv.list) {
    const byState = {};
    for (const c of ALL_CITIES) (byState[c.state] ||= []).push(c.city);
    console.log('\n🇺🇸 Justice Gavel — national provider coverage\n');
    for (const [st, cities] of Object.entries(byState).sort()) console.log(`  ${st}: ${cities.join(', ')}`);
    console.log(`\n  Total: ${ALL_CITIES.length} cities | ${Object.keys(byState).length} states`);
    return 0;
  }

  let targets = ALL_CITIES;
  if (argv.state !== 'all') targets = targets.filter(c => c.state === String(argv.state).toUpperCase());
  if (argv.city !== 'all') targets = targets.filter(c => c.city.toLowerCase().includes(String(argv.city).toLowerCase()));
  if (!targets.length) throw new Error('no covered city matches --state / --city (see --list)');

  const sources = argv.source === 'all' ? ['bar', 'google', 'yelp'] : [argv.source];
  const types = argv.type === 'all' ? ['lawyers', 'bail', 'civil'] : [argv.type];
  const runnable = sources.filter(s => s === 'bar' || (s === 'google' && placesKeyConfigured()) || (s === 'yelp' && process.env.YELP_API_KEY));
  for (const s of sources.filter(x => !runnable.includes(x))) {
    console.log(`ℹ️  ${s === 'google' ? 'GOOGLE_PLACES_KEY' : 'YELP_API_KEY'} is not set — ${s} source skipped.`);
  }
  if (!runnable.length || (runnable.length === 1 && runnable[0] === 'bar' && !types.some(t => t !== 'bail'))) {
    console.log('ℹ️  Nothing to run for the selected sources/types. Nothing was fetched or written.');
    return 0;
  }

  const db = await openRefreshDb();
  console.log(`\n⚖️  National provider refresh → Postgres | ${targets.length} cities | types ${types.join(',')} | sources ${runnable.join(',')}${argv['dry-run'] ? ' | DRY RUN' : ''}`);
  const r = await runProviderRefresh({
    db, cities: targets, types, sources: runnable, dryRun: argv['dry-run'], trigger: 'manual',
    job: 'providers_national', depth: 'full',
    log: (line) => console.log(`  📍 ${line}`),
  });
  printRunSummary('National provider refresh', { ...r, dryRun: argv['dry-run'] });
  return r.status === 'failed' ? 1 : 0;
});
