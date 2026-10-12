/**
 * _places_mock.js — an in-memory Google Places (Text Search + Details) for the
 * data-refresh suites. No network: the mock is passed as fetchImpl (or
 * installed over globalThis.fetch for code that uses the default).
 *
 *   const g = placesMock();
 *   g.add({ place_id, name, city, state, ...detailFields }, ['criminal defense lawyer Jgtestville VT'])
 *   fetchImpl = g.fetch
 *
 * A text query returns every place registered under a query string that the
 * request's `query` contains (case-insensitive); unknown queries → ZERO_RESULTS.
 */
export function placesMock() {
  const places = new Map();       // place_id → details result
  const byQuery = new Map();      // lowercased query fragment → Set(place_id)
  const calls = [];
  const api = {
    calls,
    places,
    add(detail, queries) {
      places.set(detail.place_id, detail);
      for (const q of queries) {
        const k = q.toLowerCase();
        if (!byQuery.has(k)) byQuery.set(k, new Set());
        byQuery.get(k).add(detail.place_id);
      }
      return detail;
    },
    remove(placeId) {
      places.delete(placeId);
      for (const set of byQuery.values()) set.delete(placeId);
    },
    update(placeId, fields) { Object.assign(places.get(placeId), fields); },
    reset() { places.clear(); byQuery.clear(); calls.length = 0; },
    // fetch(url, init) → Response-like
    fetch: async (url) => {
      const u = new URL(String(url));
      calls.push(u.pathname + '?' + [...u.searchParams.keys()].join(','));
      if (u.hostname !== 'maps.googleapis.com') throw new Error(`unexpected network call to ${u.hostname}`);
      const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (!u.searchParams.get('key')) return json({ status: 'REQUEST_DENIED', error_message: 'no key' });
      if (u.pathname.endsWith('/textsearch/json')) {
        const q = (u.searchParams.get('query') || '').toLowerCase();
        const ids = new Set();
        for (const [k, set] of byQuery) if (q.includes(k)) set.forEach(id => ids.add(id));
        const results = [...ids].filter(id => places.has(id)).map(id => ({ place_id: id, name: places.get(id).name }));
        return json({ status: results.length ? 'OK' : 'ZERO_RESULTS', results });
      }
      if (u.pathname.endsWith('/details/json')) {
        const d = places.get(u.searchParams.get('place_id'));
        return json(d ? { status: 'OK', result: d } : { status: 'NOT_FOUND' });
      }
      return json({ status: 'INVALID_REQUEST' });
    },
  };
  return api;
}

/** Google Details shape for a directory row (so a re-scrape of it is a no-op). */
export function detailFromRow(row, overrides = {}) {
  return {
    place_id: String(row.source_id || '').replace(/^google_(ra_)?/, ''),
    name: row.name,
    formatted_address: row.address,
    formatted_phone_number: row.phone,
    geometry: row.lat != null ? { location: { lat: Number(row.lat), lng: Number(row.lng) } } : undefined,
    website: row.website || undefined,
    rating: row.rating ?? undefined,
    user_ratings_total: row.reviews ?? undefined,
    opening_hours: row.hours ? { weekday_text: String(row.hours).split(' | ') } : undefined,
    ...overrides,
  };
}
