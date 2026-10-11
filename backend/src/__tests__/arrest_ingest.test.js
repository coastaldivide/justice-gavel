/**
 * arrest_ingest.test.js — the arrest ingestion pipeline is honest:
 *   - no built-in / fabricated sources: with ARREST_FEED_URLS unset it ingests
 *     nothing and reports feeds_configured:false (and never opens the DB);
 *   - ARREST_FEED_URLS is validated and sanitized (https only, slug ids,
 *     2-letter states, no duplicates);
 *   - feed records are normalized before insert — nameless/undated rows are
 *     skipped, and the stored source is "feed_<id>", which can never match the
 *     sample-source filter in utils/arrestVisibility.js.
 */
import { jest } from '@jest/globals';
import {
  parseArrestFeeds, arrestFeedsConfigured, normalizeRecord, runIngestion,
} from '../services/arrest_ingest.js';

const FEED = { id: 'davidson_tn', url: 'https://example.gov/bookings.json', state: 'TN', county: 'Davidson' };

const ORIGINAL_ENV = process.env.ARREST_FEED_URLS;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ARREST_FEED_URLS;
  else process.env.ARREST_FEED_URLS = ORIGINAL_ENV;
});

describe('parseArrestFeeds — config validation', () => {
  test('unset / blank → no feeds, no errors, not configured', () => {
    delete process.env.ARREST_FEED_URLS;
    expect(parseArrestFeeds()).toEqual({ feeds: [], errors: [] });
    expect(arrestFeedsConfigured()).toBe(false);
    expect(parseArrestFeeds('   ')).toEqual({ feeds: [], errors: [] });
  });

  test('invalid JSON and non-array values are reported, never thrown', () => {
    expect(parseArrestFeeds('not json').errors[0]).toMatch(/not valid JSON/);
    expect(parseArrestFeeds('{"url":"https://x"}').errors[0]).toMatch(/JSON array/);
    expect(parseArrestFeeds('"https://x"').errors[0]).toMatch(/JSON array/);
  });

  test('a valid feed is accepted with source prefixed feed_', () => {
    const { feeds, errors } = parseArrestFeeds(JSON.stringify([FEED]));
    expect(errors).toEqual([]);
    expect(feeds).toEqual([{
      id: 'davidson_tn', url: 'https://example.gov/bookings.json',
      state: 'TN', county: 'Davidson', source: 'feed_davidson_tn',
    }]);
  });

  test('the stored source can never match the sample-source filter', () => {
    // utils/arrestVisibility.js hides source ~* '^(seed|sample|demo|mock|fake|test)([^a-z]|$)'
    const sampleRe = /^(seed|sample|demo|mock|fake|test)([^a-z]|$)/i;
    const { feeds } = parseArrestFeeds(JSON.stringify([
      { ...FEED, id: 'test_county' },      // worst case: operator names it "test_*"
      { ...FEED, id: 'demo-roster', url: 'https://other.gov/a.json' },
    ]));
    expect(feeds).toHaveLength(2);
    for (const f of feeds) {
      expect(f.source.startsWith('feed_')).toBe(true);
      expect(sampleRe.test(f.source)).toBe(false);
    }
  });

  test('http urls, bad ids, bad states and duplicates are rejected with reasons', () => {
    const { feeds, errors } = parseArrestFeeds(JSON.stringify([
      { ...FEED, url: 'http://example.gov/a.json' },       // not https
      { ...FEED, id: 'Bad Id!' },                          // invalid slug
      { ...FEED, state: 'Tennessee' },                     // not 2 letters
      { ...FEED },                                         // ok
      { ...FEED },                                         // duplicate id
      'https://example.gov/b.json',                        // not an object
      { id: 'no_url' },                                    // missing url
    ]));
    expect(feeds).toHaveLength(1);
    expect(errors).toHaveLength(6);
    expect(errors.join('\n')).toMatch(/https/);
    expect(errors.join('\n')).toMatch(/duplicate/);
  });

  test('id is derived from the host when absent', () => {
    const { feeds } = parseArrestFeeds(JSON.stringify([{ url: 'https://data.shelby.gov/x.json' }]));
    expect(feeds[0].id).toBe('data_shelby_gov');
    expect(feeds[0].source).toBe('feed_data_shelby_gov');
  });
});

describe('normalizeRecord — sanitization', () => {
  const feed = { id: 'f', source: 'feed_f', state: 'TN', county: 'Davidson' };

  test('rows without a name or parseable booking date are rejected', () => {
    expect(normalizeRecord({ booking_date: '2026-01-01' }, feed)).toBeNull();
    expect(normalizeRecord({ name: 'A B', booking_date: 'yesterday-ish' }, feed)).toBeNull();
    expect(normalizeRecord(null, feed)).toBeNull();
    expect(normalizeRecord('string', feed)).toBeNull();
  });

  test('fields are trimmed, capped and defaulted from the feed', () => {
    const norm = normalizeRecord({
      name: '  John   Smith  ', booking_date: '2026-02-03T08:00:00Z',
      charges: 'x'.repeat(2000), bail_amount: '-50', state: 'tn2',
    }, feed);
    expect(norm).toMatchObject({
      name: 'John Smith', booking_date: '2026-02-03',
      bail_amount: 0, state: 'TN', county: 'Davidson',
      source: 'feed_f', alert_sent: 0, has_attorney: 0,
    });
    expect(norm.charges).toHaveLength(1000);
  });
});

describe('runIngestion — honest behavior', () => {
  test('no feed configured → nothing ingested, feeds_configured:false, no DB access', async () => {
    delete process.env.ARREST_FEED_URLS;
    const result = await runIngestion();
    expect(result).toMatchObject({
      feeds_configured: false, inserted: 0, skipped: 0, errors: 0, sources: [],
    });
  });

  test('dry run validates feed records without writing', async () => {
    process.env.ARREST_FEED_URLS = JSON.stringify([FEED]);
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ records: [
        { name: 'Jane Roe', booking_date: '2026-03-01', charges: 'theft' },
        { name: '', booking_date: '2026-03-01' },               // skipped: no name
        { name: 'No Date' },                                    // skipped: no date
      ] }),
    }));
    try {
      const result = await runIngestion({ dryRun: true });
      expect(result.feeds_configured).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.inserted).toBe(1);   // valid rows counted, none written
      expect(result.skipped).toBe(2);
      expect(result.sources).toEqual([{ id: 'davidson_tn', inserted: 1, skipped: 2, total: 3 }]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).toBe(FEED.url);
    } finally {
      global.fetch = realFetch;
    }
  });

  test('a broken feed is reported as an error, not swallowed as success', async () => {
    process.env.ARREST_FEED_URLS = JSON.stringify([FEED]);
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    try {
      const result = await runIngestion({ dryRun: true });
      expect(result.inserted).toBe(0);
      expect(result.errors).toBe(1);
      expect(result.sources[0]).toMatchObject({ id: 'davidson_tn' });
      expect(result.sources[0].error).toMatch(/503/);
    } finally {
      global.fetch = realFetch;
    }
  });
});
