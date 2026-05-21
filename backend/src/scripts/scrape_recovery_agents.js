/**
 * scrape_recovery_agents.js
 *
 * Scrapes licensed fugitive recovery agents / bail enforcement agents
 * from Google Places and inserts into recovery_agents table.
 *
 * Usage:
 *   node src/scripts/scrape_recovery_agents.js
 *   node src/scripts/scrape_recovery_agents.js --state TN
 *   node src/scripts/scrape_recovery_agents.js --dry-run
 *
 * Cost: ~$2–$5 in Google Places API calls
 * Runtime: ~20–40 minutes
 */

import { open }    from 'sqlite';
import sqlite3     from 'sqlite3';
import https       from 'https';
import { URL }     from 'url';
import yargs       from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('state',   { type: 'string', default: 'all' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('limit',   { type: 'number',  default: 999 })
  .parse();

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
if (!GOOGLE_KEY) {
  console.error('❌ GOOGLE_PLACES_KEY not set in .env');
  process.exit(1);
}

const DB_PATH = process.env.PROVIDERS_DB || './data/providers.sqlite';

// ── States where recovery agents are legal and worth scraping ────────────────
// Excludes IL, KY, DC where commercial bail is effectively banned
const TARGET_CITIES = [
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

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpGet(urlStr, params = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    https.get(u.toString(), (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse failed')); }
      });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return phone;
}

// ── Search queries for recovery agents ────────────────────────────────────────
const QUERIES = [
  (city, state) => `fugitive recovery agent ${city} ${state}`,
  (city, state) => `bail enforcement agent ${city} ${state}`,
  (city, state) => `bounty hunter ${city} ${state}`,
];

// ── Main scrape function ──────────────────────────────────────────────────────
async function scrapeCity(db, city, state) {
  const records = [];
  const seenIds = new Set();

  for (const queryFn of QUERIES) {
    try {
      await sleep(250);
      const q = queryFn(city, state);
      const searchRes = await httpGet(
        'https://maps.googleapis.com/maps/api/place/textsearch/json',
        { query: q, key: GOOGLE_KEY }
      );

      for (const place of (searchRes.results || []).slice(0, 8)) {
        if (seenIds.has(place.place_id)) continue;
        seenIds.add(place.place_id);

        try {
          await sleep(150);
          const detail = await httpGet(
            'https://maps.googleapis.com/maps/api/place/details/json',
            {
              place_id: place.place_id,
              key: GOOGLE_KEY,
              fields: 'name,formatted_address,formatted_phone_number,geometry,website,rating,user_ratings_total,opening_hours',
            }
          );
          const d = detail.result;
          if (!d || !d.name) continue;

          if (isJunkBusiness(d.name || place.name)) continue; // Skip non-bail businesses
          records.push({
            source_id:        `google_ra_${place.place_id}`,
            name:             d.name || place.name,
            city:             city,
            state:            state,
            phone:            normalizePhone(d.formatted_phone_number),
            address:          d.formatted_address,
            lat:              d.geometry?.location?.lat ?? null,
            lng:              d.geometry?.location?.lng ?? null,
            website:          d.website || null,
            rating:           d.rating || 0,
            reviews:          d.user_ratings_total || 0,
            hours:            d.opening_hours?.weekday_text?.join(' | ') || null,
            available_24_7:   d.opening_hours?.periods?.some(p => p.close === undefined) ? 1 : 0,
            source:           'google',
            active:           1,
          });
        } catch { /* skip failed detail */ }
      }
    } catch { /* skip failed search */ }
  }

  // Deduplicate by name+city
  const seen = new Set();
  return records.filter(r => {
    const key = (r.name + r.city).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function upsertAgent(db, record, dryRun) {
  if (!record.name || !record.state) return 'skipped';
  if (dryRun) {
    console.log(`   [DRY] ${record.name} | ${record.city}, ${record.state} | ${record.phone || 'no phone'}`);
    return 'dry';
  }

  const existing = await db.get(
    'SELECT id FROM recovery_agents WHERE source_id = ?',
    [record.source_id]
  );

  if (existing) {
    await db.run(
      `UPDATE recovery_agents SET
        phone=?, address=?, lat=?, lng=?, website=?, rating=?, reviews=?,
        hours=?, available_24_7=?, updated_at=datetime('now')
       WHERE id=?`,
      [record.phone, record.address, record.lat, record.lng,
       record.website, record.rating, record.reviews,
       record.hours, record.available_24_7, existing.id]
    );
    return 'updated';
  }

  await db.run(
    `INSERT INTO recovery_agents
       (source_id, name, city, state, phone, address, lat, lng, website,
        rating, reviews, hours, available_24_7, source, active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
    [record.source_id, record.name, record.city, record.state,
     record.phone, record.address, record.lat, record.lng, record.website,
     record.rating, record.reviews, record.hours, record.available_24_7,
     record.source, record.active]
  );
  return 'inserted';
}

// ── Entry point ───────────────────────────────────────────────────────────────

// ── Junk business filter ─────────────────────────────────────────────────────
// Prevents Google Places results that are not bail/legal providers from
// being inserted. Updated after full data audit — v1.9.1
const JUNK_KEYWORDS = [
  // Auto parts (note: use double quotes for apostrophes)
  'autozone',"o'reilly",'advance auto','napa auto','pep boys',
  'jiffy lube','firestone','midas','mavis tire',
  // Grocery / big box retail
  'walmart','target','costco','kroger','safeway','albertsons','publix',
  'whole foods','trader joe','aldi ','meijer','h-e-b','food lion',
  'wegmans','winn dixie','piggly','dollar general','dollar tree',
  'family dollar','fred meyer','king soopers','heb plus',
  // Drug stores
  'walgreens','cvs pharmacy','rite aid','duane reade',
  // Home improvement
  'home depot','lowes hardware','menards','ace hardware',
  // Farm / fleet
  'farm & fleet','fleet farm','tractor supply',
  // Fast food
  "mcdonald's",'mcdonalds','burger king','wendy','taco bell','kfc ',
  'popeyes','chick-fil','subway ','dominos','pizza hut','papa john',
  'sonic drive','dairy queen','hardees',"arby's",'arbys',
  'panda express','chipotle','five guys','whataburger','in-n-out',
  // Coffee / cafe
  'starbucks','dunkin donuts','tim horton','dutch bros','panera bread',
  // Gas stations
  'shell gas','exxon','chevron gas','bp gas','sunoco','marathon gas',
  'valero','circle k','speedway gas','pilot travel','7-eleven',
  // Bars / restaurants (not bail-named)
  'emporium','provisions bar','dog house','gators and ghosts',
  'frontier days','botanical garden','outdoor campus',
  // Hospitals / medical
  'medical center','urgent care','veterinary','animal hospital',
  'familycare health','m.d. medical',
  // Government (non-commercial)
  'police department',"sheriff's office",'county jail','city jail',
  'state prison','federal bureau of investigation','fbi field office',
  'us marshals service','department of corrections','county corrections',
  'state police hq','highway patrol','superior court','district court',
  'county courthouse','city courthouse','crime stopper','crimestoppers',
  // Media
  'nbc news','abc news','cbs news','fox news','tv station','radio station',
  // Insurance / finance (not bail)
  'insurance agency','mortgage company','financial advisor',
  'investment firm','accounting firm','cpa office',
  // Fan / manufacturer
  'fan company','fan manufacturer',
  // Other
  'hotel ','motel ','bank of ','real estate agency',
  'funeral home','cemetery','ymca ','planet fitness',
  'car dealership','auto sales dealer',
  'school ','elementary school','high school',
  'botanical ','garden center','tour company','travel agency',
];

function isJunkBusiness(name) {
  if (!name) return true;
  const lower = name.toLowerCase();
  // Must NOT be a bail/legal business with these words in the name
  const isBailRelated = lower.includes('bail') || lower.includes('bond') ||
    lower.includes(' law') || lower.includes('legal') || lower.includes('attorney') ||
    lower.includes('defense') || lower.includes('recovery') || lower.includes('surety') ||
    lower.includes('enforce') || lower.includes('dui') || lower.includes('criminal') ||
    lower.includes('fugitive') || lower.includes('bounty') || lower.includes('investigat') ||
    lower.includes('detective') || lower.includes('process serv') || lower.includes('skip trac');
  if (isBailRelated) return false; // Always keep bail-related businesses
  return JUNK_KEYWORDS.some(kw => lower.includes(kw));
}

async function main() {
  console.log('\n🔍 Justice Gavel — Fugitive Recovery Agent Scraper');
  console.log(`   DB: ${DB_PATH}`);
  console.log(`   Dry run: ${argv['dry-run']}`);
  console.log(`   State filter: ${argv.state}\n`);

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');

  let targets = TARGET_CITIES;
  if (argv.state !== 'all') {
    targets = targets.filter(t => t.state.toUpperCase() === argv.state.toUpperCase());
  }
  if (argv.limit < 999) {
    targets = targets.slice(0, argv.limit);
  }

  let inserted = 0, updated = 0, skipped = 0;

  for (const { city, state } of targets) {
    console.log(`\n📍 ${city}, ${state}`);
    const records = await scrapeCity(db, city, state);
    console.log(`   Found: ${records.length} unique agents`);

    for (const record of records) {
      try {
        const result = await upsertAgent(db, record, argv['dry-run']);
        if (result === 'inserted') { inserted++; console.log(`   ✓ ${record.name}`); }
        else if (result === 'updated') updated++;
        else skipped++;
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) console.warn(`   ✗ ${record.name}: ${e.message}`);
      }
    }

    await sleep(1000); // Be respectful to Google's servers
  }

  const total = await db.get('SELECT COUNT(*) as cnt FROM recovery_agents WHERE active=1');
  console.log('\n' + '='.repeat(50));
  console.log('✅ Recovery agent scrape complete');
  console.log(`   This run: +${inserted} new | ${updated} updated | ${skipped} skipped`);
  console.log(`   Total active agents: ${total.cnt}`);
  console.log('='.repeat(50) + '\n');

  await db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
