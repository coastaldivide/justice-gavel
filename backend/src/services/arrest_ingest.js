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
 *   jail_phone (optional) the jail's phone number, used in custody alerts ("call … to confirm").
 *
 * Record shape expected from a feed (extra fields are ignored):
 *   { name, booking_date (YYYY-MM-DD or ISO), charges, bail_amount,
 *     court_date, county, state, jail_location, has_attorney, case_number,
 *     booking_id | booking_number (optional, the jail's own booking number),
 *     dob | date_of_birth (optional, YYYY-MM-DD), status (optional, as the roster says it),
 *     jail_phone (optional) }
 *
 * The same booking is never inserted twice: each row gets a source_key — "b:<booking id>" when
 * the feed gives one, otherwise a hash of the name and booking date — unique per source. A
 * booking seen again is updated (status, facility, last_seen_at). For bookings someone follows
 * (CUSTODY_ALERTS_ENABLED, services/custodyAlerts.js) a status or facility change, or the
 * booking no longer being listed, becomes a custody event and the followers are alerted. New
 * bookings are matched against Bond Desk bonds (BOND_REARREST_ALERTS_ENABLED,
 * services/bondDesk/rearrest.js).
 *
 * Every record is validated and sanitized (normalizeRecord) before insert;
 * records without a name or a parseable booking date are skipped. When no
 * feed is configured the runner logs that and ingests nothing — it never
 * fabricates data.
 *
 * Called by: POST /api/arrests/ingest (admin-only manual trigger; supports
 * { dry_run: true } to validate feeds without writing).
 */

import crypto from 'node:crypto';
import logger from '../utils/logger.js';
import { getDb } from '../db/index.js';   // main database (Postgres)
import { custodyAlertsEnabled, rearrestAlertsEnabled } from '../utils/counselFlags.js';

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
    const feed = {
      id,
      url: url.href,
      state:  state || null,
      county: String(entry.county ?? '').trim().slice(0, 100) || null,
      // The "feed_" prefix keeps ingested sources well clear of the
      // sample-source filter (utils/arrestVisibility.js) and makes ingested
      // rows identifiable in the arrest_records.source column.
      source: `feed_${id}`,
    };
    const phone = cleanPhone(entry.jail_phone);
    if (phone) feed.jail_phone = phone;
    feeds.push(feed);
  });
  return { feeds, errors };
}

/** True when at least one valid arrest feed is configured. */
export function arrestFeedsConfigured() {
  return parseArrestFeeds().feeds.length > 0;
}

// ── Fetch one feed (JSON array or {records:[...]}) ─────────────────────────
// → { list, truncated }: `truncated` = the feed had more than MAX_RECORDS_PER_FEED records, so
// a booking missing from `list` may simply have been cut off (never reported as "not listed").
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
    return { list: list.slice(0, MAX_RECORDS_PER_FEED), truncated: list.length > MAX_RECORDS_PER_FEED };
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

/** A phone number as printed ("(615) 862-8170", "+1 615 862 8170 x2"); anything else → null. */
export function cleanPhone(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!s || !/^[0-9+().\- x]+$/i.test(s) || s.replace(/\D/g, '').length < 7) return null;
  return s;
}

/** A plausible date of birth (YYYY-MM-DD, not in the future, after 1900) or null. */
export function parseDob(v) {
  const s = String(v ?? '').trim().slice(0, 30);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCFullYear() < 1900 || d > new Date()) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** The booking's stable key in its feed: the jail's booking number, else a hash of name + booking date. */
export function sourceKeyFor(raw, name, bookingDate) {
  const bid = String(raw?.booking_id ?? raw?.booking_number ?? raw?.booking_no ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (bid) return `b:${bid}`;
  return `n:${crypto.createHash('sha256').update(`${name.toLowerCase()}|${bookingDate}`).digest('hex').slice(0, 40)}`;
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
    dob:           parseDob(raw.dob ?? raw.date_of_birth),
    status:        String(raw.status ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    jail_phone:    cleanPhone(raw.jail_phone) || feed.jail_phone || null,
    source_key:    sourceKeyFor(raw, name, booking_date),
  };
}

// ── Main ingestion runner ──────────────────────────────────────────────────
/**
 * One booking seen again: refresh what the roster says now. A status / facility change (both
 * values known) or a booking listed again after it was missing is returned as a change; the
 * UPDATE only applies when the row still holds the values read, so two runs at once never
 * report the same change twice.  → [{ kind, old, new }] | null (another run changed it first)
 */
async function refreshBooking(db, ex, norm) {
  const changes = [];
  const oldStatus = String(ex.status || '').trim();
  const oldFacility = String(ex.jail_location || '').trim();
  if (norm.status && oldStatus && norm.status !== oldStatus) changes.push({ kind: 'status_changed', old: oldStatus, new: norm.status });
  if (norm.jail_location && oldFacility && norm.jail_location !== oldFacility) changes.push({ kind: 'facility_changed', old: oldFacility, new: norm.jail_location });
  if (ex.delisted_at) changes.push({ kind: 'listed_again', old: null, new: null });
  const r = await db.get(
    `UPDATE arrest_records
        SET status = COALESCE(NULLIF(?, ''), status), jail_location = COALESCE(NULLIF(?, ''), jail_location),
            jail_phone = COALESCE(?, jail_phone), dob = COALESCE(?::date, dob),
            last_seen_at = NOW(), delisted_at = NULL, updated_at = NOW()
      WHERE id = ? AND status IS NOT DISTINCT FROM ? AND jail_location IS NOT DISTINCT FROM ?
        AND (delisted_at IS NULL) = ?
      RETURNING id`,
    [norm.status, norm.jail_location, norm.jail_phone, norm.dob, ex.id, ex.status, ex.jail_location, !ex.delisted_at]);
  return r ? changes : null;
}

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
  const custodyOn = !dryRun && custodyAlertsEnabled();
  const custody = custodyOn ? await import('./custodyAlerts.js') : null;
  const newIds = [];
  if (!dryRun) { results.updated = 0; results.custody_events = 0; }

  for (const feed of feeds) {
    logger.info(`[ingest] Running feed: ${feed.id} (${feed.url})`);
    let raw;
    let truncated = false;
    try {
      ({ list: raw, truncated } = await fetchFeed(feed));
    } catch (e) {
      logger.error(`[ingest] ${feed.id} fetch failed:`, e?.message);
      results.errors++;
      results.sources.push({ id: feed.id, error: e?.message });
      continue;
    }

    let inserted = 0;
    let updated  = 0;
    let skipped  = 0;
    let failed   = 0;
    const seenKeys = new Set();
    const events = [];
    for (const record of raw) {
      const norm = normalizeRecord(record, feed);
      if (!norm) { skipped++; continue; }
      if (dryRun) { inserted++; continue; }
      if (seenKeys.has(norm.source_key)) { skipped++; continue; }   // the same booking twice in one feed
      seenKeys.add(norm.source_key);
      try {
        const ex = await db.get(
          'SELECT id, status, jail_location, delisted_at FROM arrest_records WHERE source = ? AND source_key = ?',
          [norm.source, norm.source_key]);
        if (ex) {
          const changes = await refreshBooking(db, ex, norm);
          updated++;
          if (custody && changes?.length) {
            for (const c of changes) events.push(...await custody.recordChange(db, { arrestId: Number(ex.id), ...c, source: feed.source }));
          }
          continue;
        }
        const row = await db.get(
          `INSERT INTO arrest_records
             (name, booking_date, charges, bail_amount, court_date,
              county, state, jail_location, has_attorney, case_number, source, alert_sent,
              dob, status, jail_phone, source_key, last_seen_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?::date,NULLIF(?, ''),?,?,NOW())
           ON CONFLICT (source, source_key) WHERE source_key IS NOT NULL DO NOTHING
           RETURNING id`,
          [norm.name, norm.booking_date, norm.charges, norm.bail_amount,
           norm.court_date, norm.county, norm.state, norm.jail_location,
           norm.has_attorney, norm.case_number, norm.source, norm.alert_sent,
           norm.dob, norm.status, norm.jail_phone, norm.source_key]
        );
        if (row) { inserted++; newIds.push(Number(row.id)); } else updated++;   // inserted by a run at the same moment
      } catch (e) {
        failed++;
        results.errors++;
        logger.warn(`[ingest] ${feed.id}: row not stored: ${e?.message}`);
      }
    }

    // Followed bookings this feed no longer lists. Only when the whole roster came back (not cut
    // off at MAX_RECORDS_PER_FEED, not empty, every row stored): a partial answer would make
    // everyone look "no longer listed".
    if (custody && !truncated && seenKeys.size > 0 && failed === 0) {
      events.push(...await custody.markUnlisted(db, { source: feed.source, seenKeys }));
    }
    if (custody && events.length) {
      results.custody_events += events.length;
      await custody.notifyEvents(db, events).catch((e) => logger.warn(`[ingest] custody alerts: ${e?.message}`));
    }

    results.inserted += inserted;
    results.skipped  += skipped;
    const src = { id: feed.id, inserted, skipped, total: raw.length };
    if (!dryRun) { results.updated += updated; src.updated = updated; }
    results.sources.push(src);
    logger.info(`[ingest] ${feed.id}: ${inserted}/${raw.length} ${dryRun ? 'valid (dry run)' : `inserted, ${updated} seen again`}, ${skipped} skipped`);
  }

  // Bond Desk: new bookings that may be an agent's own defendant (A4, ⚖ counsel 1.2)
  if (!dryRun && newIds.length && rearrestAlertsEnabled()) {
    try {
      const { matchNewArrests } = await import('./bondDesk/rearrest.js');
      results.rearrest = await matchNewArrests(db, newIds);
    } catch (e) {
      logger.error('[ingest] re-arrest matching failed:', e?.message);
      results.rearrest = { error: e?.message };
    }
  }

  logger.info(`[ingest] Done: ${results.inserted} ${dryRun ? 'valid (dry run)' : 'inserted'}, ${results.skipped} skipped, ${results.errors} errors`);
  return results;
}
