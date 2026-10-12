/**
 * refresh.js — provider refresh for the 10 metro areas (Google Places / Yelp)
 * ─────────────────────────────────────────────────────────────────────────────
 * Writes the MAIN Postgres database (DATABASE_URL) through
 * services/dataRefresh — the same code the nightly scheduler runs when
 * LIVE_REFRESH=true:
 *   - providers not yet in lawyers / bail_agents are inserted (source,
 *     source_id, timestamps; unverified);
 *   - differences for providers already listed are NOT written — they are
 *     staged in provider_update_proposals for review (GET /api/admin/proposals);
 *   - nothing is ever deleted or deactivated;
 *   - every run is recorded in scrape_runs.
 *
 * Usage (from backend/):
 *   node src/scripts/refresh.js                         # all metros, lawyers + bail
 *   node src/scripts/refresh.js --city "Nashville, TN"
 *   node src/scripts/refresh.js --type lawyers|bail|civil|all
 *   node src/scripts/refresh.js --source google|yelp|all
 *   node src/scripts/refresh.js --dry-run              # fetch + match, write nothing but the run log
 *
 * Keys: GOOGLE_PLACES_KEY and/or YELP_API_KEY. A missing key skips that source
 * with a message; with neither the script exits 0 without fetching anything.
 */
import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runProviderRefresh, METRO_CITIES } from '../services/dataRefresh/providerRefresh.js';
import { placesKeyConfigured } from '../services/dataRefresh/googlePlaces.js';
import { splitCityState } from '../services/dataRefresh/normalize.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

const argv = yargs(hideBin(process.argv))
  .option('city',    { type: 'string',  describe: 'One city, e.g. "Nashville, TN"' })
  .option('type',    { type: 'string',  choices: ['lawyers', 'bail', 'civil', 'all'], default: 'all' })
  .option('source',  { type: 'string',  choices: ['google', 'yelp', 'all'], default: 'all' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Fetch and match; write nothing but the scrape_runs entry' })
  .strict()
  .parse();

function typesFor(t) {
  return t === 'all' ? ['lawyers', 'bail'] : [t];
}

runCli(async () => {
  const sources = argv.source === 'all' ? ['google', 'yelp'] : [argv.source];
  const wantsGoogle = sources.includes('google') && placesKeyConfigured();
  const wantsYelp = sources.includes('yelp') && !!process.env.YELP_API_KEY;
  if (!wantsGoogle && !wantsYelp) {
    console.log('ℹ️  Provider refresh skipped: no API key for the selected source(s). '
      + 'Set GOOGLE_PLACES_KEY (and/or YELP_API_KEY) to enable it. Nothing was fetched or written.');
    return 0;
  }
  let cities = METRO_CITIES;
  if (argv.city) {
    const { city, state } = splitCityState(argv.city);
    if (!city || !state) throw new Error('--city must look like "Nashville, TN"');
    cities = [{ city, state }];
  }
  const db = await openRefreshDb();
  console.log(`\n🔄 Provider refresh → Postgres | ${cities.length} cit${cities.length === 1 ? 'y' : 'ies'} | type ${argv.type} | sources ${sources.join(',')}${argv['dry-run'] ? ' | DRY RUN' : ''}`);
  const r = await runProviderRefresh({
    db, cities, types: typesFor(argv.type), sources, dryRun: argv['dry-run'], trigger: 'manual',
    log: (line) => console.log(`  📍 ${line}`),
  });
  printRunSummary('Provider refresh', { ...r, dryRun: argv['dry-run'] });
  return r.status === 'failed' ? 1 : 0;
});
