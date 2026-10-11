/**
 * arrest_ingest.js — Arrest record ingestion from operator-configured feeds
 *
 * There is NO built-in data source. Public arrest feeds are configured by the
 * operator through the ARREST_FEED_URLS environment variable — a JSON array of
 * feed objects:
 *
 *   ARREST_FEED_URLS='[{"id":"davidson_tn","url":"https://example.gov/bookings.json","state":"TN","county":"Davidson"}]'
 *
 * Feed object fields:
 *   url     (required) https:// endpoint returning JSON — either an array of
 *           records or an object with a `records` array.
 *   id      (optional) [a-z0-9_-]{1,40} slug; derived from the URL host when
 *           absent. Stored on each row as source = "feed_<id>".
 *   state   (optional) 2-letter default state applied to records without one.
 *   county  (optional) default county applied to records without one.
 *
 * Record shape expected from a feed (extra fields are ignored):
 *   { name, booking_date (YYYY-MM-DD or ISO), charges, bail_amount,
 *     court_date, county, state, jail_location, has_attorney, case_number }
 *
 * Every record is validated and sanitized (normalizeRecord) before insert;
 * records without a name or a parseable booking date are skipped. When no
 * feed is configured the runner logs that and ingests nothing — it never
 * fabricates data.
 *
 * Called by: POST /api/arrests/ingest (admin-only manual trigger; supports
 * { dry_run: true } to validate feeds without writing).
 */

import logger from '../utils/logger.js';
import { getDb } from '../db/index.js';   // main database (Postgres)

const FEED_TIMEOUT_MS      = 15_000;   // per-feed fetch timeout
const MAX_RECORDS_PER_FEED = 1_000;    // ignore anything beyond this per run
const ID_RE                = /^[a-z0-9_-]{1,40}$/;

/**
 * Parse and validate ARREST_FEED_URLS.
 * Returns { feeds: [{id, url, state, county, source}], errors: [string] }.
 * Never throws — a malformed value is reported, not fatal.
 */
export function parseArrestFeeds(raw = process.env.ARREST_FEED_URLS) {
  const errors = [];
  const feeds  = [];
  const value  = String(raw ?? '').trim();
  if (!value) return { feeds, errors };

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    errors.push(`ARREST_FEED_URLS is not valid JSON: ${e.message}`);
    return { feeds, errors };
  }
  if (!Array.isArray(parsed)) {
    errors.push('ARREST_FEED_URLS must be a JSON array of feed objects');
    return { feeds, errors };
  }

  parsed.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`feed[${i}]: must be an object with a "url" field`);
      return;
    }
    let url;
    try {
      url = new URL(String(entry.url || ''));
    } catch {
      errors.push(`feed[${i}]: invalid url`);
      return;
    }
    if (url.protocol !== 'https:') {
      errors.push(`feed[${i}] (${url.hostname}): url must be https`);
      return;
    }
    let id = String(entry.id ?? '').trim().toLowerCase();
    if (!id) id = url.hostname.replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    if (!ID_RE.test(id)) {
      errors.push(`feed[${i}]: id must match ${ID_RE} (got "${entry.id}")`);
      return;
    }
    const state = String(entry.state ?? '').trim().toUpperCase();
    if (state && !/^[A-Z]{2}$/.test(state)) {
      errors.push(`feed[${i}] (${id}): state must be a 2-letter code`);
      return;
    }
    if (feeds.some(f => f.id === id)) {
      errors.push(`feed[${i}]: duplicate id "${id}"`);
      return;
    }
    feeds.push({
      id,
      url: url.href,
      state:  state || null,
      county: String(entry.county ?? '').trim().slice(0, 100) || null,
      // The "feed_" prefix keeps ingested sources well clear of the
      // sample-source filter (utils/arrestVisibility.js) and makes ingested
      // rows identifiable in the arrest_records.source column.
      source: `feed_${id}`,
    });
  });
  return { feeds, errors };
}

/** True when at least one valid arrest feed is configured. */
export function arrestFeedsConfigured() {
  return parseArrestFeeds().feeds.length > 0;
}

// ── Fetch one feed (JSON array or {records:[...]}) ─────────────────────────
async function fetchFeed(feed) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
  try {
    const r = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : null;
    if (!list) throw new Error('feed did not return a JSON array (or {records:[...]})');
    if (list.length > MAX_RECORDS_PER_FEED) {
      logger.warn(`[ingest] ${feed.id}: feed returned ${list.length} records — capping at ${MAX_RECORDS_PER_FEED}`);
    }
    return list.slice(0, MAX_RECORDS_PER_FEED);
  } finally {
    clearTimeout(timer);
  }
}

// ── Normalize + validate a raw record before DB insert ─────────────────────
function parseBookingDate(v) {
  const s = String(v ?? '').trim().slice(0, 30);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().split('T')[0];   // YYYY-MM-DD
}

export function normalizeRecord(raw, feed) {
  if (!raw || typeof raw !== 'object') return null;
  const name         = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const booking_date = parseBookingDate(raw.booking_date);
  if (!name || !booking_date) return null;    // never insert a nameless/undated row
  return {
    name,
    booking_date,
    charges:       String(raw.charges || '').trim().slice(0, 1000),
    bail_amount:   Math.max(0, parseFloat(raw.bail_amount) || 0),
    court_date:    parseBookingDate(raw.court_date),
    county:        (String(raw.county || '').trim().slice(0, 100)) || feed.county || '',
    state:         (/^[A-Za-z]{2}$/.test(String(raw.state || '').trim())
                     ? String(raw.state).trim().toUpperCase()
                     : feed.state || ''),
    jail_location: String(raw.jail_location || '').trim().slice(0, 200),
    has_attorney:  raw.has_attorney ? 1 : 0,
    case_number:   String(raw.case_number || '').trim().slice(0, 50),
    source:        feed.source,
    alert_sent:    0,
  };
}

// ── Main ingestion runner ──────────────────────────────────────────────────
export async function runIngestion({ dryRun = false } = {}) {
  const { feeds, errors: configErrors } = parseArrestFeeds();
  const results = {
    feeds_configured: feeds.length > 0,
    dry_run:          !!dryRun,
    inserted: 0, skipped: 0, errors: configErrors.length,
    config_errors: configErrors,
    sources: [],
  };
  for (const err of configErrors) logger.warn(`[ingest] config: ${err}`);

  if (feeds.length === 0) {
    logger.warn('[ingest] No arrest feed configured — set ARREST_FEED_URLS to ingest public booking data. Nothing was ingested.');
    return results;
  }

  const db = dryRun ? null : await getDb();

  for (const feed of feeds) {
    logger.info(`[ingest] Running feed: ${feed.id} (${feed.url})`);
    let raw;
    try {
      raw = await fetchFeed(feed);
    } catch (e) {
      logger.error(`[ingest] ${feed.id} fetch failed:`, e?.message);
      results.errors++;
      results.sources.push({ id: feed.id, error: e?.message });
      continue;
    }

    let inserted = 0;
    let skipped  = 0;
    for (const record of raw) {
      const norm = normalizeRecord(record, feed);
      if (!norm) { skipped++; continue; }
      if (dryRun) { inserted++; continue; }
      try {
        await db.run(
          `INSERT INTO arrest_records
             (name, booking_date, charges, bail_amount, court_date,
              county, state, jail_location, has_attorney, case_number, source, alert_sent)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
          [norm.name, norm.booking_date, norm.charges, norm.bail_amount,
           norm.court_date, norm.county, norm.state, norm.jail_location,
           norm.has_attorney, norm.case_number, norm.source, norm.alert_sent]
        );
        inserted++;
      } catch {
        results.errors++;
      }
    }

    results.inserted += inserted;
    results.skipped  += skipped;
    results.sources.push({ id: feed.id, inserted, skipped, total: raw.length });
    logger.info(`[ingest] ${feed.id}: ${inserted}/${raw.length} ${dryRun ? 'valid (dry run)' : 'inserted'}, ${skipped} skipped`);
  }

  logger.info(`[ingest] Done: ${results.inserted} ${dryRun ? 'valid (dry run)' : 'inserted'}, ${results.skipped} skipped, ${results.errors} errors`);
  return results;
}
