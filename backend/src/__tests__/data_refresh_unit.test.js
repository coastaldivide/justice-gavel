/**
 * data_refresh_unit.test.js — pure-logic tests for services/dataRefresh (no DB,
 * no network). The Postgres behaviour is covered by src/__tests__/refresh/
 * (PG-gated); these run in the default in-memory jest run.
 */
import { jest } from '@jest/globals';
import {
  normalizePhone, phoneKey, nameKey, sourceKey, urlKey, splitCityState, FIELD_RULES, castForColumn,
} from '../services/dataRefresh/normalize.js';
import { prepareRecord, diffRecord, buildIndex, isProposableField } from '../services/dataRefresh/providerStore.js';
import {
  createPlacesClient, placeToRecord, PlacesKeyMissingError, PlacesFatalError, PlacesBudgetError,
} from '../services/dataRefresh/googlePlaces.js';
import { isJunkBusiness, parseBarListing, googleQueries } from '../services/dataRefresh/providerRefresh.js';
import { assertPostgres, newCounts } from '../services/dataRefresh/runLog.js';

describe('normalize', () => {
  test('phones normalize to E.164 and placeholders never match', () => {
    expect(normalizePhone('(615) 555-1234')).toBe('+16155551234');
    expect(normalizePhone('1-615-555-1234')).toBe('+16155551234');
    expect(normalizePhone('555-1234')).toBeNull();
    expect(phoneKey('+16155550123')).toBeNull();          // 555-01xx fiction number
    expect(phoneKey('(000) 000-0000')).toBeNull();
    expect(phoneKey('615.555.7788')).toBe('6155557788');
  });
  test('names, cities and Google ids produce stable keys', () => {
    expect(nameKey('The Smith Law Firm, PLLC', 'Nashville', 'tn')).toBe(nameKey('smith law firm', 'NASHVILLE', 'TN'));
    expect(nameKey('A & B Bail Bonds LLC', 'Saint Louis', 'MO')).toBe(nameKey('A and B Bail Bonds', 'St Louis', 'MO'));
    expect(nameKey('x', 'Nowhere', 'ZZ')).toBeNull();
    expect(sourceKey('google_ra_ChIJabc')).toBe(sourceKey('google_ChIJabc'));
    expect(sourceKey('doi_TN_123')).toBe('doi_TN_123');
    expect(splitCityState('Kansas City, MO')).toEqual({ city: 'Kansas City', state: 'MO' });
    expect(splitCityState('Memphis', 'tn')).toEqual({ city: 'Memphis', state: 'TN' });
  });
  test('comparators ignore formatting noise', () => {
    expect(FIELD_RULES.phone.same('+16155551234', '(615) 555-1234')).toBe(true);
    expect(FIELD_RULES.website.same('https://www.firm.com/?utm_source=gmb', 'http://firm.com')).toBe(true);
    expect(FIELD_RULES.website.same('https://firm.com/a', 'https://firm.com/b')).toBe(false);
    expect(FIELD_RULES.address.same('1 Main Street, Nashville, TN 37203, USA', '1 Main St, Nashville, TN')).toBe(true);
    expect(FIELD_RULES.rating.same(4.6, '4.62')).toBe(true);
    expect(FIELD_RULES.lat.same(36.16, 36.16004)).toBe(true);
    expect(FIELD_RULES.phone.same(null, '+16155551234')).toBe(false);   // a missing value is a difference
    expect(urlKey('javascript:alert(1)')).toBeNull();
    expect(castForColumn('reviews', '12')).toBe(12);
    expect(castForColumn('rating', '4.5')).toBe(4.5);
    expect(() => castForColumn('password_hash', 'x')).toThrow();
  });
});

describe('providerStore (pure parts)', () => {
  const existing = { id: 7, source_id: 'google_PID1', name: 'Smith Law', city: 'Nashville', state: 'TN',
    phone: '+16155551234', address: '1 Main St, Nashville, TN', website: 'https://smith.example', hours: null,
    rating: 4.5, reviews: 10, lat: 36.1, lng: -86.7, email: null, bar_number: null };
  const idx = buildIndex('lawyers', [existing, { ...existing, id: 8, source_id: 'csv_x', name: 'Other Office', city: 'Franklin', phone: '+16155559999' }]);

  test('records without a usable name / state / city are rejected, never invented', () => {
    expect(prepareRecord('lawyers', { name: 'Find a Lawyer', city: 'X', state: 'ZZ' })).toEqual({ ok: false, reason: 'no_state' });
    expect(prepareRecord('lawyers', { name: '', city: 'X', state: 'TN' }).ok).toBe(false);
    expect(prepareRecord('lawyers', { name: 'Closed Firm', city: 'X', state: 'TN', business_status: 'CLOSED_PERMANENTLY' }).reason).toBe('closed');
    const p = prepareRecord('lawyers', { name: 'Jane Doe Law', city: 'Nashville', state: 'tn', phone: '615-555-0101', rating: 7 });
    expect(p.ok).toBe(true);
    expect(p.rec.phone).toBeUndefined();    // placeholder phone dropped
    expect(p.rec.rating).toBeUndefined();   // out-of-range rating dropped
  });

  test('matching order: source id → phone (same state) → name+city+state', () => {
    const m = (raw) => idx.match(prepareRecord('lawyers', raw).rec);
    expect(m({ name: 'Renamed', city: 'Memphis', state: 'TN', source_id: 'google_ra_PID1' }).by).toBe('source_id');
    expect(m({ name: 'Renamed', city: 'Nashville', state: 'TN', phone: '(615) 555-1234' })).toMatchObject({ by: 'phone', row: { id: 7 } });
    expect(m({ name: 'Renamed', city: 'Brentwood', state: 'TN', phone: '(615) 555-9999' }).by).toBe('phone_other_city');
    expect(m({ name: 'Renamed', city: 'Atlanta', state: 'GA', phone: '(615) 555-1234' })).toBeNull();   // other state: not the same listing
    expect(m({ name: 'SMITH LAW, PLLC', city: 'nashville', state: 'TN' })).toMatchObject({ by: 'name', row: { id: 7 } });
    expect(m({ name: 'Brand New Firm', city: 'Nashville', state: 'TN', phone: '615-555-4321' })).toBeNull();
  });

  test('diffRecord proposes only real differences in allowed fields', () => {
    const rec = prepareRecord('lawyers', { name: 'Smith Law', city: 'Nashville', state: 'TN', phone: '(615) 555-1234',
      website: 'http://www.smith.example/', rating: 4.8, hours: 'Mon 9-5', email: 'Info@Smith.example' }).rec;
    expect(diffRecord('lawyers', existing, rec).map(d => d.field).sort()).toEqual(['email', 'hours', 'rating']);
    const d = diffRecord('lawyers', existing, rec).find(x => x.field === 'rating');
    expect(d).toEqual({ field: 'rating', oldValue: '4.5', newValue: '4.8' });
    expect(isProposableField('lawyers', 'verified')).toBe(false);
    expect(isProposableField('lawyers', 'name')).toBe(false);
    expect(isProposableField('users', 'phone')).toBe(false);
    expect(isProposableField('bail_agents', 'license_number')).toBe(true);
  });
});

describe('Google Places client', () => {
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const noSleep = async () => {};

  test('no key → PlacesKeyMissingError (callers turn it into a clean skip)', () => {
    expect(() => createPlacesClient({ key: '', fetchImpl: async () => json({}) })).toThrow(PlacesKeyMissingError);
  });

  test('retries OVER_QUERY_LIMIT / 5xx, then succeeds; follows next_page_token', async () => {
    const replies = [json({}, 503), json({ status: 'OVER_QUERY_LIMIT' }),
      json({ status: 'OK', results: [{ place_id: 'a' }], next_page_token: 't' }), json({ status: 'OK', results: [{ place_id: 'b' }] })];
    const fetchImpl = jest.fn(async () => replies.shift());
    const c = createPlacesClient({ key: 'k', fetchImpl, minIntervalMs: 0, sleep: noSleep });
    expect((await c.textSearch('q')).map(r => r.place_id)).toEqual(['a', 'b']);
    expect(c.stats).toMatchObject({ requests: 4, retries: 2 });
    expect(String(fetchImpl.mock.calls[3][0])).toContain('pagetoken=t');
  });

  test('REQUEST_DENIED stops the run; the request budget is enforced', async () => {
    const denied = createPlacesClient({ key: 'k', fetchImpl: async () => json({ status: 'REQUEST_DENIED', error_message: 'bad key' }), minIntervalMs: 0, sleep: noSleep });
    await expect(denied.details('x')).rejects.toBeInstanceOf(PlacesFatalError);
    const capped = createPlacesClient({ key: 'k', fetchImpl: async () => json({ status: 'OK', result: { name: 'n' } }), minIntervalMs: 0, maxRequests: 2, sleep: noSleep });
    await capped.details('1'); await capped.details('2');
    await expect(capped.details('3')).rejects.toBeInstanceOf(PlacesBudgetError);
  });

  test('rate limit: waits minIntervalMs between requests', async () => {
    const waits = [];
    const c = createPlacesClient({ key: 'k', fetchImpl: async () => json({ status: 'ZERO_RESULTS' }), minIntervalMs: 200, sleep: async (ms) => { waits.push(ms); } });
    await c.textSearch('a'); await c.textSearch('b');
    expect(waits.some(ms => ms > 100 && ms <= 200)).toBe(true);
  });

  test('placeToRecord maps Details to the record shape', () => {
    const r = placeToRecord({ place_id: 'P', name: 'N', formatted_phone_number: '(615) 555-1234', geometry: { location: { lat: 1, lng: 2 } },
      opening_hours: { weekday_text: ['Mon', 'Tue'], periods: [{ open: { day: 0 } }] }, user_ratings_total: 3, rating: 4 },
    { type: 'lawyers', city: 'Nashville', state: 'TN' });
    expect(r).toMatchObject({ source: 'google', source_id: 'google_P', hours: 'Mon | Tue', available_24_7: 1, reviews: 3, lat: 1 });
  });
});

describe('providerRefresh helpers', () => {
  test('junk filter keeps legal / bail businesses', () => {
    expect(isJunkBusiness('Walmart Supercenter')).toBe(true);
    expect(isJunkBusiness('Walmart Bail Bonds')).toBe(false);
    expect(isJunkBusiness(null)).toBe(true);
  });
  test('bar listing parser needs a person-like name and a phone or bar number', () => {
    const html = `<div class="result">Find a Lawyer Directory (615) 555-1000</div>
      <div class="attorney">Jane Q Public, Esq. (615) 555-2000 Bar No. 012345</div>
      <div class="member">A Colorado Bar Association membership connects you (303) 860-1115</div>
      <div class="lawyer">John Smith</div>`;
    const r = parseBarListing(html, { city: 'Nashville', state: 'TN' });
    expect(r.map(x => x.name)).toEqual(['Jane Q Public, Esq.']);
    expect(r[0]).toMatchObject({ bar_number: 'TN012345', source: 'state_bar', source_id: 'bar_TN_012345' });
  });
  test('query sets: nightly basic vs national full', () => {
    expect(googleQueries('Nashville', 'TN', ['lawyers', 'bail'], 'basic')).toHaveLength(2);
    expect(googleQueries('Nashville', 'TN', ['lawyers', 'bail', 'civil'], 'full').length).toBeGreaterThan(10);
  });
  test('runs refuse the sql.js dev fallback', () => {
    expect(() => assertPostgres({ engine: 'sqlite' })).toThrow(/Postgres/);
    expect(() => assertPostgres({ engine: 'postgres' })).not.toThrow();
    expect(newCounts()).toEqual({ fetched: 0, inserted: 0, proposed: 0, unchanged: 0, updated: 0, skipped: 0, errors: 0 });
  });
});
