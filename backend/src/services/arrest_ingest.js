/**
 * arrest_ingest.js — Arrest record ingestion pipeline
 *
 * Data sources (all public record / open data):
 *   1. County jail daily booking reports (HTML scrape or CSV download)
 *   2. State DOC open data APIs (many states publish CSV/JSON)
 *   3. CourtListener PACER API (federal cases)
 *   4. Judyrecords API (aggregated public records, requires API key)
 *   5. OpenCage / Google geocoding for address normalization
 *
 * Called by: POST /api/admin/ingest-arrests  (manual trigger)
 *            Cron scheduler (every 6 hours)
 *
 * Revenue impact: arrest_records is the inventory for the bondsman
 * lead marketplace. Empty table = zero lead revenue. This pipeline
 * is the single most important backend job for monetisation.
 */

import logger from '../utils/logger.js';
import { open }  from 'sqlite';
import sqlite3   from 'sqlite3';
import path      from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ARREST_DB  = path.resolve(__dirname, '../../demo.db');  // dev: demo.db | prod: use getDb()

async function getDb() {
  // In production (DATABASE_URL set): use main Postgres via getDb()
  if (process.env.DATABASE_URL) {
    const { getDb: pgGetDb } = await import('../db/index.js');
    return pgGetDb();
  }
  // Dev fallback: same SQLite path used by arrests.js
  return open({ filename: ARREST_DB, driver: sqlite3.Database });
}

// ── Source definitions ─────────────────────────────────────────────────────
// Each source has a fetch() that returns normalized arrest records.
// Add new counties by adding entries to SOURCES.

const SOURCES = [
  {
    id:     'davidson_tn_mugshotscom',
    name:   'Davidson County, TN (mugshots.com)',
    state:  'TN',
    county: 'Davidson',
    // Free tier: scrape the public HTML booking report
    // Paid tier: use Mugshots.com API or Judyrecords.com API
    fetch: async () => {
      // TODO: Replace with real API call or HTML scrape
      // Example: Davidson County Sheriff posts daily booking log at
      // https://www.nashville.gov/departments/sheriff/daily-booking-logs
      logger.info('[ingest] davidson_tn: fetching booking log...');
      return []; // placeholder — returns [] until real source is wired
    },
  },
  {
    id:     'shelby_tn_opendata',
    name:   'Shelby County, TN (Open Data)',
    state:  'TN',
    county: 'Shelby',
    fetch: async () => {
      // Shelby County posts JSON at:
      // https://data.shelbycountytn.gov/resource/arrest_records.json
      // Replace with real endpoint after API key is obtained
      logger.info('[ingest] shelby_tn: fetching open data...');
      return [];
    },
  },
  {
    id:     'judyrecords_api',
    name:   'Judyrecords.com API (national)',
    state:  null,  // national
    county: null,
    fetch: async () => {
      const key = process.env.JUDYRECORDS_API_KEY;
      if (!key) return [];  // skip if not configured
      // https://www.judyrecords.com/api/v1/new_arrests?api_key=KEY&limit=500
      const url = `https://www.judyrecords.com/api/v1/new_arrests?api_key=${key}&limit=500`;
      try {
        const r = await fetch(url);
        if (!r.ok) { logger.warn('[ingest] judyrecords:', r.status); return []; }
        const data = await r.json();
        return (data.records || []).map(rec => ({
          name:         rec.defendant_name || '',
          booking_date: rec.arrest_date    || new Date().toISOString().split('T')[0],
          charges:      rec.charges        || '',
          bail_amount:  parseFloat(rec.bail_amount) || 0,
          county:       rec.county         || '',
          state:        rec.state          || '',
          jail_location:rec.facility       || '',
          has_attorney: rec.attorney_name ? 1 : 0,
          case_number:  rec.case_number    || '',
          source:       'judyrecords',
        }));
      } catch (e) {
        logger.warn('[ingest] judyrecords fetch failed:', e?.message);
        return [];
      }
    },
  },
];

// ── Normalize a raw record before DB insert ────────────────────────────────
function normalizeRecord(raw, sourceId) {
  return {
    name:          String(raw.name         || '').trim().slice(0, 200),
    booking_date:  String(raw.booking_date || new Date().toISOString().split('T')[0]),
    charges:       String(raw.charges      || '').slice(0, 1000),
    bail_amount:   Math.max(0, parseFloat(raw.bail_amount) || 0),
    court_date:    raw.court_date          || null,
    county:        String(raw.county       || '').trim().slice(0, 100),
    state:         String(raw.state        || '').toUpperCase().slice(0, 2),
    jail_location: String(raw.jail_location|| '').slice(0, 200),
    has_attorney:  raw.has_attorney ? 1 : 0,
    case_number:   String(raw.case_number  || '').slice(0, 50),
    source:        sourceId,
    alert_sent:    0,
  };
}

// ── Main ingestion runner ──────────────────────────────────────────────────
export async function runIngestion(options = {}) {
  const db      = await getDb();
  const results = { inserted: 0, skipped: 0, errors: 0, sources: [] };

  for (const source of SOURCES) {
    logger.info(`[ingest] Running source: ${source.name}`);
    let raw = [];

    try {
      raw = await source.fetch();
    } catch (e) {
      logger.error(`[ingest] ${source.id} fetch failed:`, e?.message);
      results.errors++;
      results.sources.push({ id: source.id, error: e?.message });
      continue;
    }

    let sourceInserted = 0;
    for (const record of raw) {
      const norm = normalizeRecord(record, source.id);
      if (!norm.name || !norm.booking_date) continue;

      try {
        await db.run(
          `INSERT OR IGNORE INTO arrest_records
             (name, booking_date, charges, bail_amount, court_date,
              county, state, jail_location, has_attorney, case_number, source, alert_sent)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [norm.name, norm.booking_date, norm.charges, norm.bail_amount,
           norm.court_date, norm.county, norm.state, norm.jail_location,
           norm.has_attorney, norm.case_number, norm.source, norm.alert_sent]
        );
        sourceInserted++;
      } catch (e) {
        results.errors++;
      }
    }

    results.inserted += sourceInserted;
    results.sources.push({ id: source.id, inserted: sourceInserted, total: raw.length });
    logger.info(`[ingest] ${source.name}: ${sourceInserted}/${raw.length} inserted`);
  }

  logger.info(`[ingest] ✅ Total: ${results.inserted} inserted, ${results.errors} errors`);
  return results;
}
