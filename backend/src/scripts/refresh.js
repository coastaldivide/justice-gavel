/**
 * refresh.js — Unified provider data refresh pipeline
 * ─────────────────────────────────────────────────────
 * Pulls fresh data from Google Places and/or Yelp, merges with the
 * existing database using upsert logic, and writes a full audit log.
 *
 * Usage:
 *   node repo/backend/src/scripts/refresh.js                    # all cities, all types
 *   node repo/backend/src/scripts/refresh.js --city "Nashville, TN"
 *   node repo/backend/src/scripts/refresh.js --type lawyers
 *   node repo/backend/src/scripts/refresh.js --type bail
 *   node repo/backend/src/scripts/refresh.js --source google    # skip Yelp
 *   node repo/backend/src/scripts/refresh.js --source yelp      # skip Google
 *   node repo/backend/src/scripts/refresh.js --dry-run          # preview only
 *
 * At least one of GOOGLE_PLACES_KEY or YELP_API_KEY must be set.
 * Missing sources are gracefully skipped.
 */

import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/providers.sqlite');

const argv = yargs(hideBin(process.argv))
  .option('city',    { type: 'string',  describe: 'Target a specific city' })
  .option('type',    { type: 'string',  choices: ['lawyers','bail','all'], default: 'all' })
  .option('source',  { type: 'string',  choices: ['google','yelp','all'], default: 'all' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Preview without writing to DB' })
  .argv;

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
const YELP_KEY   = process.env.YELP_API_KEY;
const DRY_RUN    = argv['dry-run'];

const CITIES = [
  'Memphis, TN', 'Nashville, TN', 'Atlanta, GA', 'Houston, TX',
  'Detroit, MI', 'Baltimore, MD', 'Kansas City, MO',
  'Milwaukee, WI', 'Albuquerque, NM', 'Denver, CO'
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpGet(url, params = {}, headers = {}) {
  const qs = new URLSearchParams(params).toString();
  const full = qs ? url + '?' + qs : url;
  const res = await fetch(full, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${full}`);
  return res.json();
}

// ── Google Places ─────────────────────────────────────────────────────────────

async function googleTextSearch(query) {
  const results = [];
  let params = { query, key: GOOGLE_KEY };
  const BASE = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
  while (true) {
    const data = await httpGet(BASE, params);
    if (data.results) results.push(...data.results);
    if (!data.next_page_token) break;
    await sleep(2200); // Google requires delay before using page token
    params = { pagetoken: data.next_page_token, key: GOOGLE_KEY };
  }
  return results;
}

async function googleDetails(place_id) {
  const data = await httpGet('https://maps.googleapis.com/maps/api/place/details/json', {
    place_id, key: GOOGLE_KEY,
    fields: 'place_id,name,formatted_address,formatted_phone_number,geometry,website,rating,user_ratings_total,opening_hours,international_phone_number'
  });
  return data.result;
}

async function fetchFromGoogle(city, types) {
  if (!GOOGLE_KEY) { console.log('  ⏭  Google: no API key, skipping'); return []; }
  const records = [];
  const queries = [];
  if (types === 'all' || types === 'lawyers') queries.push({ q: `criminal defense lawyer ${city}`, type: 'law' });
  if (types === 'all' || types === 'bail')    queries.push({ q: `bail bonds ${city}`, type: 'bail' });

  for (const { q, type } of queries) {
    console.log(`  🔍 Google: "${q}"`);
    try {
      const results = await googleTextSearch(q);
      for (const r of results.slice(0, 20)) {
        try {
          const d = await googleDetails(r.place_id);
          if (!d) continue;
          await sleep(120);
          records.push({
            type,
            source: 'google',
            source_id: 'google_' + d.place_id,
            city,
            name: d.name,
            phone: normalizePhone(d.formatted_phone_number || d.international_phone_number),
            address: d.formatted_address,
            lat: d.geometry?.location?.lat ?? null,
            lng: d.geometry?.location?.lng ?? null,
            website: d.website || null,
            rating: d.rating || null,
            reviews: d.user_ratings_total || null,
            hours: d.opening_hours?.weekday_text?.join(' | ') || null,
          });
        } catch (e) { console.warn(`    ⚠ details failed ${r.place_id}: ${e.message}`); }
      }
    } catch (e) { console.warn(`  ⚠ Google search failed: ${e.message}`); }
  }
  return records;
}

// ── Yelp ──────────────────────────────────────────────────────────────────────

async function fetchFromYelp(city, types) {
  if (!YELP_KEY) { console.log('  ⏭  Yelp: no API key, skipping'); return []; }
  const headers = { Authorization: 'Bearer ' + YELP_KEY };
  const records = [];
  const queries = [];
  if (types === 'all' || types === 'lawyers') queries.push({ term: 'criminal defense attorney', type: 'law' });
  if (types === 'all' || types === 'bail')    queries.push({ term: 'bail bonds', type: 'bail' });

  for (const { term, type } of queries) {
    console.log(`  🔍 Yelp: "${term}" in ${city}`);
    let offset = 0;
    try {
      while (offset < 100) {
        const data = await httpGet('https://api.yelp.com/v3/businesses/search',
          { term, location: city, limit: 50, offset }, headers);
        for (const b of data.businesses || []) {
          records.push({
            type,
            source: 'yelp',
            source_id: 'yelp_' + b.id,
            city,
            name: b.name,
            phone: normalizePhone(b.phone || b.display_phone),
            address: [b.location?.address1, b.location?.city, b.location?.state].filter(Boolean).join(', '),
            lat: b.coordinates?.latitude ?? null,
            lng: b.coordinates?.longitude ?? null,
            website: b.url || null,
            rating: b.rating || null,
            reviews: b.review_count || null,
            hours: null,
          });
        }
        if ((data.businesses || []).length < 50) break;
        offset += 50;
        await sleep(300);
      }
    } catch (e) { console.warn(`  ⚠ Yelp search failed: ${e.message}`); }
  }
  return records;
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizePhone(s) {
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return digits.length >= 7 ? s.trim() : null;
}

function dedupeKey(name, city) {
  return (name + '|' + city).toLowerCase().replace(/[^a-z0-9|]/g, '');
}

// ── DB upsert with audit log ──────────────────────────────────────────────────

async function getExistingByDedupeKey(db, table, name, city) {
  return db.get(
    `SELECT * FROM ${table} WHERE LOWER(REPLACE(name,' ','')) = LOWER(REPLACE(?,' ','')) AND city = ?`,
    [name, city]
  );
}

const TRACKED_FIELDS = ['phone', 'address', 'website', 'email', 'hours', 'rating', 'reviews', 'lat', 'lng'];

async function logChanges(db, table, recordId, existing, incoming, source) {
  for (const field of TRACKED_FIELDS) {
    const oldVal = existing?.[field] != null ? String(existing[field]) : null;
    const newVal = incoming[field] != null ? String(incoming[field]) : null;
    if (oldVal !== newVal && newVal !== null) {
      await db.run(
        `INSERT INTO provider_update_log (table_name, record_id, field, old_value, new_value, source) VALUES (?,?,?,?,?,?)`,
        [table, recordId, field, oldVal, newVal, source]
      );
    }
  }
}

async function upsertRecord(db, record, source) {
  const table = record.type === 'bail' ? 'bail_agents' : 'lawyers';

  // Check for existing record by source_id first, then by name+city
  let existing = await db.get(`SELECT * FROM ${table} WHERE source_id = ?`, [record.source_id]);
  if (!existing) {
    existing = await getExistingByDedupeKey(db, table, record.name, record.city);
  }

  if (DRY_RUN) {
    const tag = existing ? 'UPDATE' : 'INSERT';
    console.log(`    [DRY-RUN] ${tag} ${table}: ${record.name} (${record.city})`);
    return;
  }

  if (existing) {
    // Update only non-null incoming fields; never overwrite hand-curated fields
    const updates = {};
    for (const f of TRACKED_FIELDS) {
      if (record[f] != null) updates[f] = record[f];
    }
    // Always update source tracking
    updates['updated_at'] = "datetime('now')";

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).filter(k => k !== 'updated_at')
        .map(k => `${k} = ?`).join(', ');
      const vals = Object.keys(updates).filter(k => k !== 'updated_at').map(k => updates[k]);
      await db.run(
        `UPDATE ${table} SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
        [...vals, existing.id]
      );
      await logChanges(db, table, existing.id, existing, record, source);
    }
  } else {
    // Insert new record
    if (table === 'lawyers') {
      const result = await db.run(`
        INSERT INTO lawyers (city, name, phone, address, lat, lng, website, email, hours,
          source, source_id, rating, reviews, active, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))
      `, [record.city, record.name, record.phone, record.address, record.lat, record.lng,
          record.website, record.email || null, record.hours || null,
          source, record.source_id, record.rating, record.reviews]);
      await logChanges(db, table, result.lastID, null, record, source);
    } else {
      const result = await db.run(`
        INSERT INTO bail_agents (city, name, phone, address, lat, lng, website, email, hours,
          source, source_id, rating, reviews, active, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))
      `, [record.city, record.name, record.phone, record.address, record.lat, record.lng,
          record.website, record.email || null, record.hours || null,
          source, record.source_id, record.rating, record.reviews]);
      await logChanges(db, table, result.lastID, null, record, source);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  if (!GOOGLE_KEY && !YELP_KEY) {
    console.log('ℹ️  No API keys found (GOOGLE_PLACES_KEY, YELP_API_KEY). Refresh skipped.');
    console.log('   To populate the database, run: node src/scripts/seed_providers.js');
    process.exit(0);
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');

  const cities = argv.city ? [argv.city] : CITIES;
  const useGoogle = argv.source === 'all' || argv.source === 'google';
  const useYelp   = argv.source === 'all' || argv.source === 'yelp';

  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0;

  console.log(`\n🔄 Justice Gavel Provider Refresh`);
  console.log(`   Cities: ${cities.join(', ')}`);
  console.log(`   Types:  ${argv.type}`);
  console.log(`   Source: ${argv.source}`);
  console.log(`   Dry run: ${DRY_RUN}\n`);

  for (const city of cities) {
    console.log(`\n📍 ${city}`);

    const records = [];
    if (useGoogle) records.push(...await fetchFromGoogle(city, argv.type));
    if (useYelp)   records.push(...await fetchFromYelp(city, argv.type));

    // Deduplicate fetched records by name+city across sources
    const seen = new Set();
    const deduped = records.filter(r => {
      const k = dedupeKey(r.name, r.city);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    console.log(`  📦 ${deduped.length} unique records fetched`);

    for (const record of deduped) {
      try {
        await upsertRecord(db, record, record.source);
        totalInserted++;
      } catch (e) {
        console.warn(`  ⚠ Failed ${record.name}: ${e.message}`);
        totalSkipped++;
      }
    }
  }

  // Summary
  const lCount = await db.get('SELECT COUNT(*) as n FROM lawyers WHERE active=1');
  const bCount = await db.get('SELECT COUNT(*) as n FROM bail_agents WHERE active=1');
  const logCount = await db.get('SELECT COUNT(*) as n FROM provider_update_log');

  console.log(`\n✅ Refresh complete.`);
  console.log(`   Processed: ${totalInserted} records  |  Skipped: ${totalSkipped}`);
  console.log(`   DB totals: ${lCount.n} active lawyers, ${bCount.n} active bail agents`);
  console.log(`   Audit log: ${logCount.n} total change events`);

  await db.close();
})().catch(e => { console.error('Refresh failed:', e); process.exit(1); });
