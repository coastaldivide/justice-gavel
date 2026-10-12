/**
 * dataRefresh/googlePlaces.js — the ONE Google Places (legacy Text Search +
 * Place Details) client used by every scraper.
 *
 *   - Key: GOOGLE_PLACES_KEY. Without it createPlacesClient() throws
 *     PlacesKeyMissingError; callers turn that into a clean skip.
 *   - Rate limit: at most one request every GOOGLE_PLACES_MIN_INTERVAL_MS
 *     (default 150 ms ≈ 6.6 QPS, well under Google's per-project limit), plus
 *     the 2 s Google requires before a next_page_token becomes valid.
 *   - Budget: GOOGLE_PLACES_MAX_REQUESTS per run (default 5000) bounds cost;
 *     past it the client throws PlacesBudgetError and the run ends 'partial'.
 *   - OVER_QUERY_LIMIT / UNKNOWN_ERROR / HTTP 5xx / 429 are retried with
 *     exponential backoff; REQUEST_DENIED / INVALID_REQUEST (bad or
 *     restricted key) throw PlacesFatalError so a run stops instead of
 *     burning through every city.
 *   - fetchImpl is injectable; tests pass a mock (no network in CI).
 */

export class PlacesKeyMissingError extends Error {
  constructor() {
    super('GOOGLE_PLACES_KEY is not set — Google Places refresh skipped. Set GOOGLE_PLACES_KEY to enable it.');
    this.code = 'places_key_missing';
  }
}
export class PlacesFatalError extends Error {
  constructor(status, message) { super(`Google Places ${status}: ${message || 'request refused'}`); this.code = 'places_fatal'; this.status = status; }
}
export class PlacesBudgetError extends Error {
  constructor(max) { super(`Google Places request budget reached (${max} requests this run)`); this.code = 'places_budget'; }
}

const TEXT_SEARCH = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS     = 'https://maps.googleapis.com/maps/api/place/details/json';
export const DETAIL_FIELDS = 'place_id,name,formatted_address,formatted_phone_number,international_phone_number,geometry,website,rating,user_ratings_total,opening_hours,business_status';

const defaultSleep = (ms) => new Promise(r => { setTimeout(r, ms); });

export function placesKeyConfigured() {
  return !!String(process.env.GOOGLE_PLACES_KEY || '').trim();
}

export function createPlacesClient({
  key = process.env.GOOGLE_PLACES_KEY,
  fetchImpl = globalThis.fetch,
  minIntervalMs = parseInt(process.env.GOOGLE_PLACES_MIN_INTERVAL_MS || '150', 10),
  maxRequests = parseInt(process.env.GOOGLE_PLACES_MAX_REQUESTS || '5000', 10),
  pageDelayMs = 2000,
  maxRetries = 3,
  timeoutMs = 15_000,
  sleep = defaultSleep,
} = {}) {
  const apiKey = String(key || '').trim();
  if (!apiKey) throw new PlacesKeyMissingError();
  if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation available');

  const stats = { requests: 0, retries: 0 };
  let lastAt = 0;

  async function throttle() {
    const wait = lastAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
  }

  async function call(url, params) {
    for (let attempt = 0; ; attempt++) {
      if (stats.requests >= maxRequests) throw new PlacesBudgetError(maxRequests);
      await throttle();
      stats.requests++;
      const qs = new URLSearchParams({ ...params, key: apiKey });
      let res;
      try {
        res = await fetchImpl(`${url}?${qs}`, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
      } catch (e) {
        if (attempt < maxRetries) { stats.retries++; await sleep(500 * 2 ** attempt); continue; }
        throw new Error(`Google Places network error: ${e.message}`);
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) { stats.retries++; await sleep(1000 * 2 ** attempt); continue; }
        throw new Error(`Google Places HTTP ${res.status}`);
      }
      if (!res.ok) throw new PlacesFatalError(`HTTP_${res.status}`);
      const data = await res.json();
      const status = data?.status || 'UNKNOWN_ERROR';
      if (status === 'OK' || status === 'ZERO_RESULTS') return data;
      if (status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR') {
        if (attempt < maxRetries) { stats.retries++; await sleep(2000 * 2 ** attempt); continue; }
        throw new Error(`Google Places ${status} after ${maxRetries} retries`);
      }
      if (status === 'REQUEST_DENIED' || status === 'INVALID_REQUEST') {
        throw new PlacesFatalError(status, data?.error_message);
      }
      // NOT_FOUND (stale place id) and anything else: no result
      return { status, results: [], result: null };
    }
  }

  return {
    stats,
    /** Text Search, following next_page_token until maxResults. */
    async textSearch(query, { maxResults = 20 } = {}) {
      const out = [];
      let params = { query };
      for (let page = 0; page < 3 && out.length < maxResults; page++) {
        const data = await call(TEXT_SEARCH, params);
        out.push(...(data.results || []));
        if (!data.next_page_token) break;
        await sleep(pageDelayMs);
        params = { pagetoken: data.next_page_token };
      }
      return out.slice(0, maxResults);
    },
    async details(placeId) {
      const data = await call(DETAILS, { place_id: placeId, fields: DETAIL_FIELDS });
      return data.result || null;
    },
  };
}

/** Map a Place Details result to the scrapers' common record shape. */
export function placeToRecord(d, { placeId, type, city, state, sourceIdPrefix = 'google_' }) {
  if (!d) return null;
  const pid = d.place_id || placeId;
  return {
    type,
    source: 'google',
    source_id: `${sourceIdPrefix}${pid}`,
    name: d.name || null,
    city, state,
    phone: d.formatted_phone_number || d.international_phone_number || null,
    address: d.formatted_address || null,
    lat: d.geometry?.location?.lat ?? null,
    lng: d.geometry?.location?.lng ?? null,
    website: d.website || null,
    rating: d.rating ?? null,
    reviews: d.user_ratings_total ?? null,
    hours: Array.isArray(d.opening_hours?.weekday_text) ? d.opening_hours.weekday_text.join(' | ') : null,
    available_24_7: Array.isArray(d.opening_hours?.periods)
      ? (d.opening_hours.periods.some(p => p.open && !p.close) ? 1 : 0) : null,
    business_status: d.business_status || null,
  };
}
