/**
 * dataRefresh/recoveryRefresh.js — fugitive-recovery / bail-enforcement agents
 * from Google Places into recovery_agents, through providerStore (insert new,
 * stage changes for review, never overwrite / delete). Used by
 * src/scripts/scrape_recovery_agents.js.
 */
import { createPlacesClient, placeToRecord, placesKeyConfigured, PlacesKeyMissingError, PlacesFatalError, PlacesBudgetError } from './googlePlaces.js';
import { createProviderWriter } from './providerStore.js';
import { isJunkBusiness } from './providerRefresh.js';
import { assertPostgres, startRun, finishRun, recordSkippedRun, withJobLock, newCounts } from './runLog.js';
import logger from '../../utils/logger.js';

// States where commercial bail (and so recovery work) exists; IL, KY, DC excluded.
export const RECOVERY_CITIES = [
  { city: 'Birmingham',   state: 'AL' }, { city: 'Anchorage',    state: 'AK' },
  { city: 'Phoenix',      state: 'AZ' }, { city: 'Little Rock',  state: 'AR' },
  { city: 'Los Angeles',  state: 'CA' }, { city: 'San Diego',    state: 'CA' },
  { city: 'Denver',       state: 'CO' }, { city: 'Hartford',     state: 'CT' },
  { city: 'Wilmington',   state: 'DE' }, { city: 'Jacksonville', state: 'FL' },
  { city: 'Miami',        state: 'FL' }, { city: 'Atlanta',      state: 'GA' },
  { city: 'Honolulu',     state: 'HI' }, { city: 'Boise',        state: 'ID' },
  { city: 'Indianapolis', state: 'IN' }, { city: 'Des Moines',   state: 'IA' },
  { city: 'Wichita',      state: 'KS' }, { city: 'New Orleans',  state: 'LA' },
  { city: 'Portland',     state: 'ME' }, { city: 'Baltimore',    state: 'MD' },
  { city: 'Boston',       state: 'MA' }, { city: 'Detroit',      state: 'MI' },
  { city: 'Minneapolis',  state: 'MN' }, { city: 'Jackson',      state: 'MS' },
  { city: 'Kansas City',  state: 'MO' }, { city: 'Billings',     state: 'MT' },
  { city: 'Omaha',        state: 'NE' }, { city: 'Las Vegas',    state: 'NV' },
  { city: 'Manchester',   state: 'NH' }, { city: 'Newark',       state: 'NJ' },
  { city: 'Albuquerque',  state: 'NM' }, { city: 'New York',     state: 'NY' },
  { city: 'Charlotte',    state: 'NC' }, { city: 'Fargo',        state: 'ND' },
  { city: 'Columbus',     state: 'OH' }, { city: 'Oklahoma City',state: 'OK' },
  { city: 'Portland',     state: 'OR' }, { city: 'Philadelphia', state: 'PA' },
  { city: 'Providence',   state: 'RI' }, { city: 'Columbia',     state: 'SC' },
  { city: 'Sioux Falls',  state: 'SD' }, { city: 'Memphis',      state: 'TN' },
  { city: 'Nashville',    state: 'TN' }, { city: 'Houston',      state: 'TX' },
  { city: 'Dallas',       state: 'TX' }, { city: 'San Antonio',  state: 'TX' },
  { city: 'Salt Lake City',state: 'UT' }, { city: 'Burlington',  state: 'VT' },
  { city: 'Richmond',     state: 'VA' }, { city: 'Seattle',      state: 'WA' },
  { city: 'Charleston',   state: 'WV' }, { city: 'Milwaukee',    state: 'WI' },
  { city: 'Cheyenne',     state: 'WY' },
];

const QUERIES = ['fugitive recovery agent', 'bail enforcement agent', 'bounty hunter'];

export async function fetchRecoveryCity(client, { city, state }) {
  const seen = new Map();
  for (const q of QUERIES) {
    for (const r of await client.textSearch(`${q} ${city} ${state}`, { maxResults: 8 })) {
      if (r?.place_id && !seen.has(r.place_id)) seen.set(r.place_id, r.name);
    }
  }
  const out = [];
  for (const [placeId, name] of seen) {
    if (isJunkBusiness(name)) continue;
    const d = await client.details(placeId);
    if (!d || isJunkBusiness(d.name)) continue;
    out.push(placeToRecord(d, { placeId, type: 'recovery_agents', city, state, sourceIdPrefix: 'google_ra_' }));
  }
  return out;
}

export async function runRecoveryAgentRefresh({ db, cities = RECOVERY_CITIES, dryRun = false, trigger = 'manual', placesClient = null, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  assertPostgres(db);
  const job = 'recovery_agents';
  const params = { cities: cities.length };
  if (!placesClient && !placesKeyConfigured()) {
    const message = new PlacesKeyMissingError().message;
    const runId = await recordSkippedRun(db, { job, trigger, params, message });
    return { runId, status: 'skipped', counts: newCounts(), message };
  }
  const locked = await withJobLock(db, job, async () => {
    const counts = newCounts(); const errorSamples = [];
    const runId = await startRun(db, { job, trigger, params, dryRun });
    const writer = createProviderWriter(db, 'recovery_agents', { runId, dryRun, counts, errorSamples });
    const client = placesClient || createPlacesClient({ fetchImpl });
    let status; let stop = null;
    for (const loc of cities) {
      try {
        const recs = await fetchRecoveryCity(client, loc);
        counts.fetched += recs.length;
        await writer.writeAll(recs);
        log(`${loc.city}, ${loc.state}: ${recs.length} fetched`);
      } catch (e) {
        counts.errors++; errorSamples.push(`${loc.city}, ${loc.state}: ${e.message}`);
        if (e instanceof PlacesFatalError || e instanceof PlacesBudgetError) {
          stop = e; status = e instanceof PlacesBudgetError ? 'partial' : 'failed';
          logger.error(`[dataRefresh/${job}] stopped: ${e.message}`);
          break;
        }
      }
    }
    const message = [stop ? `stopped early: ${stop.message}` : null, `google requests: ${client.stats?.requests ?? 'n/a'}`].filter(Boolean).join(' | ');
    status = await finishRun(db, runId, counts, { status, message, errorSamples });
    return { runId, status, counts, message };
  });
  if (!locked.locked) {
    const message = 'another recovery_agents run is in progress — skipped';
    return { runId: await recordSkippedRun(db, { job, trigger, params, message }), status: 'skipped', counts: newCounts(), message };
  }
  return locked.result;
}
