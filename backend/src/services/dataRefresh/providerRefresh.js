/**
 * dataRefresh/providerRefresh.js — attorney / bail-agent refresh from Google
 * Places, Yelp and public state-bar listings, written to the main Postgres
 * database through providerStore (insert new, stage changes, never overwrite).
 *
 * Used by:
 *   - services/scheduler.js nightly pipeline (LIVE_REFRESH=true)
 *   - POST /api/admin/refresh (background run, returns the scrape_runs id)
 *   - src/scripts/refresh.js (10 metro areas) and
 *     src/scripts/scrape_providers_national.js (every covered city)
 *
 * Sources that are not configured are skipped with a message (Google without
 * GOOGLE_PLACES_KEY, Yelp without YELP_API_KEY). When nothing requested can
 * run, the run is recorded as 'skipped' and nothing is fetched.
 */
import logger from '../../utils/logger.js';
import { cleanText, normalizeUrl, splitCityState } from './normalize.js';
import {
  createPlacesClient, placeToRecord, placesKeyConfigured,
  PlacesFatalError, PlacesBudgetError, PlacesKeyMissingError,
} from './googlePlaces.js';
import { createProviderWriter } from './providerStore.js';
import { assertPostgres, startRun, finishRun, recordSkippedRun, withJobLock, newCounts } from './runLog.js';

/** The metro areas the nightly refresh covers (same list refresh.js always used). */
export const METRO_CITIES = [
  { city: 'Memphis', state: 'TN' }, { city: 'Nashville', state: 'TN' }, { city: 'Atlanta', state: 'GA' },
  { city: 'Houston', state: 'TX' }, { city: 'Detroit', state: 'MI' }, { city: 'Baltimore', state: 'MD' },
  { city: 'Kansas City', state: 'MO' }, { city: 'Milwaukee', state: 'WI' }, { city: 'Albuquerque', state: 'NM' },
  { city: 'Denver', state: 'CO' },
];

const UA = 'JusticeGavel/1.0 (legal services directory; public data)';

// ── Junk business filter (non-provider Google / Yelp hits) ───────────────────
const JUNK_KEYWORDS = [
  'autozone', "o'reilly", 'advance auto', 'napa auto', 'pep boys', 'jiffy lube', 'firestone', 'midas', 'mavis tire',
  'walmart', 'target', 'costco', 'kroger', 'safeway', 'albertsons', 'publix', 'whole foods', 'trader joe', 'aldi ',
  'meijer', 'h-e-b', 'food lion', 'wegmans', 'winn dixie', 'piggly', 'dollar general', 'dollar tree', 'family dollar',
  'walgreens', 'cvs pharmacy', 'rite aid', 'home depot', 'lowes hardware', 'menards', 'ace hardware', 'tractor supply',
  "mcdonald's", 'mcdonalds', 'burger king', 'wendy', 'taco bell', 'kfc ', 'popeyes', 'chick-fil', 'subway ', 'dominos',
  'pizza hut', 'starbucks', 'dunkin', 'shell gas', 'exxon', 'chevron gas', 'circle k', '7-eleven',
  'medical center', 'urgent care', 'veterinary', 'animal hospital', 'police department', "sheriff's office",
  'county jail', 'city jail', 'state prison', 'department of corrections', 'superior court', 'district court',
  'county courthouse', 'crime stopper', 'nbc news', 'abc news', 'cbs news', 'fox news', 'insurance agency',
  'mortgage company', 'financial advisor', 'hotel ', 'motel ', 'bank of ', 'funeral home', 'cemetery', 'school ',
  'high school', 'travel agency',
];

export function isJunkBusiness(name) {
  if (!name) return true;
  const lower = String(name).toLowerCase();
  const related = /bail|bond|\blaw\b|legal|attorney|lawyer|defense|recovery|surety|enforce|\bdui\b|\bdwi\b|criminal|fugitive|bounty|investigat|esq/.test(lower);
  if (related) return false;
  return JUNK_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Query sets ───────────────────────────────────────────────────────────────
const CIVIL = [
  ['personal injury attorney', 'Personal Injury'], ['family law attorney', 'Family Law'],
  ['immigration attorney', 'Immigration'], ['employment attorney', 'Employment'],
  ['bankruptcy attorney', 'Bankruptcy'], ['tenant rights eviction attorney', 'Real Estate'],
  ['civil rights attorney', 'Civil Rights'],
];

/** Google text queries for one city. depth 'basic' (nightly metros) or 'full' (national). */
export function googleQueries(city, state, types, depth = 'basic') {
  const q = [];
  const at = `${city} ${state}`;
  if (types.includes('lawyers')) {
    const crim = depth === 'full'
      ? ['criminal defense attorney', 'DUI defense lawyer', 'criminal law firm', 'defense attorney']
      : ['criminal defense lawyer'];
    for (const t of crim) q.push({ q: `${t} ${at}`, table: 'lawyers', specialties: ['Criminal Defense'] });
  }
  if (types.includes('civil')) {
    for (const [t, spec] of CIVIL) q.push({ q: `${t} ${at}`, table: 'lawyers', specialties: [spec] });
  }
  if (types.includes('bail')) {
    const bail = depth === 'full' ? ['bail bonds', 'bail bondsman', 'bail agent', 'surety bail bond'] : ['bail bonds'];
    for (const t of bail) q.push({ q: `${t} ${at}`, table: 'bail_agents' });
  }
  return q;
}

/** Google Places → records for one city (one details call per unique place). */
export async function fetchGoogleCity(client, { city, state }, types, { depth = 'basic', perQuery = depth === 'full' ? 10 : 20 } = {}) {
  const seen = new Map();   // place_id → query meta (first query wins)
  for (const meta of googleQueries(city, state, types, depth)) {
    const results = await client.textSearch(meta.q, { maxResults: perQuery });
    for (const r of results) if (r?.place_id && !seen.has(r.place_id)) seen.set(r.place_id, { ...meta, name: r.name });
  }
  const records = [];
  for (const [placeId, meta] of seen) {
    if (isJunkBusiness(meta.name)) continue;
    const d = await client.details(placeId);
    if (!d || isJunkBusiness(d.name)) continue;
    const rec = placeToRecord(d, { placeId, type: meta.table, city, state });
    if (meta.specialties) rec.specialties = meta.specialties;
    records.push(rec);
  }
  return records;
}

async function httpJson(fetchImpl, url, params, headers = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetchImpl(qs ? `${url}?${qs}` : url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).hostname}`);
  return res.json();
}

/** Yelp Fusion → records. Yelp's `url` is the Yelp listing, not the firm's site: never used as website. */
export async function fetchYelpCity(fetchImpl, key, { city, state }, types, sleep) {
  const headers = { Authorization: `Bearer ${key}` };
  const terms = [];
  if (types.includes('lawyers')) terms.push({ term: 'criminal defense attorney', table: 'lawyers', categories: 'lawyers' });
  if (types.includes('bail')) terms.push({ term: 'bail bonds', table: 'bail_agents', categories: 'bailbondsmen' });
  const out = [];
  for (const t of terms) {
    await sleep(300);
    const data = await httpJson(fetchImpl, 'https://api.yelp.com/v3/businesses/search',
      { term: t.term, location: `${city}, ${state}`, limit: 50, categories: t.categories }, headers);
    for (const b of data.businesses || []) {
      if (isJunkBusiness(b.name) || b.is_closed) continue;
      out.push({
        type: t.table, source: 'yelp', source_id: `yelp_${b.id}`, name: b.name, city, state,
        phone: b.phone || b.display_phone || null,
        address: [b.location?.address1, b.location?.city, b.location?.state, b.location?.zip_code].filter(Boolean).join(', ') || null,
        lat: b.coordinates?.latitude ?? null, lng: b.coordinates?.longitude ?? null,
        rating: b.rating ?? null, reviews: b.review_count ?? null,
        ...(t.table === 'lawyers' ? { specialties: ['Criminal Defense'] } : {}),
      });
    }
  }
  return out;
}

/** Page furniture a heuristic parse must never mistake for an attorney's name. */
export const NOT_A_PERSON = /search|filter|result|attorney|lawyer|member|find|directory|referral|association|\bbar\b|connects|copyright|privacy|login|sign in|contact us|\bhome\b|\bmenu\b|\bclick/i;

/**
 * Heuristic public bar-listing scrape. Only records with a two-word name AND a
 * phone or bar number are kept — a page heading is not an attorney.
 */
export function parseBarListing(html, { city, state }) {
  if (typeof html !== 'string') return [];
  const out = [];
  const blocks = html.split(/<(?:div|li|tr)[^>]*(?:attorney|member|lawyer|result)[^>]*>/gi);
  for (const block of blocks.slice(1, 200)) {
    const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const nameM = text.match(/([A-Z][a-zA-Z'-]+(?:\s+[A-Z][A-Za-z.'-]*){1,4}(?:,?\s+(?:Esq\.?|Jr\.?|Sr\.?|III|II))?)/);
    if (!nameM) continue;
    const name = cleanText(nameM[1], 100);
    if (!name || NOT_A_PERSON.test(name)) continue;
    const phoneM = text.match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
    const barM = text.match(/bar\s*(?:no|num|number|#)\.?\s*:?\s*(\d{4,8})/i);
    if (!phoneM && !barM) continue;
    const emailM = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const webM = block.match(/href="(https?:\/\/[^"]{8,120})"/i);
    out.push({
      type: 'lawyers', source: 'state_bar',
      source_id: `bar_${state}_${barM ? barM[1] : name.toLowerCase().replace(/\W+/g, '_').slice(0, 40)}`,
      name, city, state,
      phone: phoneM ? phoneM[0] : null,
      email: emailM ? emailM[0] : null,
      website: webM ? normalizeUrl(webM[1]) : null,
      bar_number: barM ? `${state}${barM[1]}` : null,
      bar_state: state,
      specialties: ['Criminal Defense'],
    });
    if (out.length >= 50) break;
  }
  return out;
}

async function fetchBarCity(fetchImpl, { city, state, bar }, sleep) {
  if (!bar) return [];
  await sleep(1500);
  const qs = new URLSearchParams({ city, practiceArea: 'Criminal Law', status: 'Active' }).toString();
  const res = await fetchImpl(`${bar}${bar.includes('?') ? '&' : '?'}${qs}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(bar).hostname}`);
  return parseBarListing(await res.text(), { city, state });
}

const defaultSleep = (ms) => new Promise(r => { setTimeout(r, ms); });

/** One lock for every job that writes lawyers / bail_agents (no two writers race on inserts). */
export const DIRECTORY_LOCK = 'provider_directory';

/**
 * Run a provider refresh.
 * @param {object} o
 *   db, cities [{city,state,bar?}], types ['lawyers','bail','civil'],
 *   sources ['google','yelp','bar'], dryRun, trigger, job, depth,
 *   fetchImpl, placesClient (tests), sleep (tests), log (fn for progress lines)
 * @returns {Promise<{runId:number|null,status:string,counts:object,message?:string}>}
 */
export async function runProviderRefresh(o = {}) {
  const {
    db, cities = METRO_CITIES, types = ['lawyers', 'bail'], sources = ['google', 'yelp'],
    dryRun = false, trigger = 'manual', job = 'providers', depth = 'basic',
    fetchImpl = globalThis.fetch, sleep = defaultSleep, log = () => {},
  } = o;
  assertPostgres(db);
  const params = { cities: cities.length, types, sources, depth };
  const notes = [];
  const active = [];
  if (sources.includes('google')) {
    if (o.placesClient || placesKeyConfigured()) active.push('google');
    else notes.push(new PlacesKeyMissingError().message);
  }
  if (sources.includes('yelp')) {
    if (process.env.YELP_API_KEY) active.push('yelp');
    else notes.push('YELP_API_KEY is not set — Yelp skipped.');
  }
  if (sources.includes('bar')) active.push('bar');
  if (!active.length) {
    const message = notes.join(' ') || 'no source selected';
    const runId = await recordSkippedRun(db, { job, trigger, params, message });
    return { runId, status: 'skipped', counts: newCounts(), message };
  }

  const locked = await withJobLock(db, DIRECTORY_LOCK, async () => {
    const counts = newCounts();
    const errorSamples = [];
    const runId = await startRun(db, { job, trigger, params: { ...params, active }, dryRun });
    const writers = {
      lawyers: createProviderWriter(db, 'lawyers', { runId, dryRun, counts, errorSamples }),
      bail_agents: createProviderWriter(db, 'bail_agents', { runId, dryRun, counts, errorSamples }),
    };
    const places = active.includes('google') ? (o.placesClient || createPlacesClient({ fetchImpl })) : null;
    let status; let fatal = null;
    try {
      const seenCities = new Set();
      for (const target of cities) {
        const { city, state } = target.state ? target : splitCityState(target.city);
        const cityKey = `${String(city).toLowerCase()}|${state}`;
        if (seenCities.has(cityKey)) continue;   // a city listed twice is fetched once
        seenCities.add(cityKey);
        const loc = { ...target, city, state };
        const records = [];
        for (const src of active) {
          try {
            if (src === 'google') records.push(...await fetchGoogleCity(places, loc, types, { depth }));
            else if (src === 'yelp') records.push(...await fetchYelpCity(fetchImpl, process.env.YELP_API_KEY, loc, types, sleep));
            else if (src === 'bar' && (types.includes('lawyers') || types.includes('civil'))) records.push(...await fetchBarCity(fetchImpl, loc, sleep));
          } catch (e) {
            if (e instanceof PlacesFatalError || e instanceof PlacesBudgetError) throw e;
            counts.errors++;
            errorSamples.push(`${src} ${city}, ${state}: ${e.message}`);
          }
        }
        counts.fetched += records.length;
        await writers.lawyers.writeAll(records.filter(r => r.type === 'lawyers'));
        await writers.bail_agents.writeAll(records.filter(r => r.type === 'bail_agents'));
        log(`${city}, ${state}: ${records.length} fetched`);
      }
    } catch (e) {
      fatal = e;
      counts.errors++;
      errorSamples.unshift(e.message);
      status = e instanceof PlacesBudgetError ? 'partial' : 'failed';
      logger.error(`[dataRefresh/${job}] stopped: ${e.message}`);
    }
    const message = [...notes, fatal ? `stopped early: ${fatal.message}` : null,
      places ? `google requests: ${places.stats?.requests ?? 'n/a'}` : null].filter(Boolean).join(' | ') || null;
    status = await finishRun(db, runId, counts, { status, message, errorSamples });
    return { runId, status, counts, message };
  });
  if (!locked.locked) {
    const message = 'another provider-directory run (refresh / import) is in progress — skipped';
    const runId = await recordSkippedRun(db, { job, trigger, params, message });
    return { runId, status: 'skipped', counts: newCounts(), message };
  }
  return locked.result;
}
