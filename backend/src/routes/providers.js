/**
 * /api/providers — GPS-first lawyer and bail agent search
 *
 * GET /api/providers/lawyers
 *   Priority: lat+lng > city string > all
 *   Params: lat, lng, radiusKm (default 100), city, limit (default 20),
 *           caseType, language, proBonoOnly, slidingScaleOnly
 *   Returns lawyers sorted by distance from user, with full contact + enriched fields.
 *   If lat/lng given, automatically expands radius until at least MIN_RESULTS found.
 *
 * GET /api/providers/bail
 *   Params: lat, lng, radiusKm (default 80), city
 *   Returns bail agents sorted by distance.
 *
 * GET /api/providers/nearest-city
 *   Params: lat, lng
 *   Returns: { city, distanceKm } — nearest city in our dataset
 */

import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { haversineKm, bboxFromLatLng } from '../services/geolink.js';
import { authRequired } from '../middleware/auth.js';

// Optional auth — identifies user if token present, but never blocks guests
const optionalAuth = (req, res, next) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return next();
  authRequired(req, res, next);
};
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';
import path from 'path';
import logger              from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import rateLimit           from 'express-rate-limit';
const __dirname_r = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DB = path.resolve(__dirname_r, '../../data/providers.sqlite');

const router = Router();

const MIN_RESULTS    = 3;
const RADIUS_STEPS_KM = [50, 100, 200, 500, 99999]; // expand until MIN_RESULTS found

// ── Rate limiters ─────────────────────────────────────────────────────────────
const searchLimiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: 'Provider search limit reached.' });

// ── Module-level singleton — one providers.sqlite connection per process ───────
// Re-opening on every request causes file descriptor leaks under load.
let _pdb = null;
async function openDb() {
  if (_pdb) return _pdb;
  try {
    _pdb = await open({ filename: PROVIDERS_DB, driver: sqlite3.Database });
    await _pdb.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    logger.info('[providers] providers.sqlite connection opened');
  } catch (e) {
    logger.warn('[providers] Could not open providers.sqlite:', e.message);
    _pdb = null;
  }
  return _pdb;
}

// ── Haversine distance ────────────────────────────────────────────────────────

// ── Nearest city resolver ─────────────────────────────────────────────────────
// Finds the closest city in our dataset to a given lat/lng.
// Used when the user has GPS coords but no city string.

async function findNearestCity(pdb, lat, lng) {
  const cities = await pdb.all(
    'SELECT city, AVG(lat) as clat, AVG(lng) as clng FROM lawyers GROUP BY city'
  );
  let best = null;
  let bestDist = Infinity;
  for (const c of cities) {
    const d = haversineKm(lat, lng, c.clat, c.clng);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best ? { city: best.city, distanceKm: Math.round(bestDist) } : null;
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function safeParseJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function applyFilters(rows, { caseType, language, proBonoOnly, slidingScaleOnly }) {
  return rows.filter(l => {
    if (proBonoOnly && !l.pro_bono) return false;
    if (slidingScaleOnly && !l.sliding_scale) return false;
    if (language && language.toLowerCase() !== 'english') {
      const langs = safeParseJson(l.languages, []);
      if (!langs.some(lg => lg.toLowerCase().includes(language.toLowerCase()))) return false;
    }
    if (caseType) {
      const specs = safeParseJson(l.specialties, []);
      // Also check bio and any practice area aliases
      const ALIASES = {
        'DUI':               ['dui', 'dwi', 'drunk driving', 'traffic'],
        'Drug Offenses':     ['drug', 'narcotics', 'controlled substance', 'possession', 'trafficking'],
        'Assault':           ['assault', 'battery', 'aggravated'],
        'Domestic Violence': ['domestic', 'violence'],
        'Theft':             ['theft', 'larceny', 'robbery', 'burglary'],
        'Weapons Charges':   ['weapon', 'firearm', 'gun', 'armed'],
        'Federal Crimes':    ['federal', 'conspiracy'],
        'Murder/Homicide':   ['murder', 'homicide', 'manslaughter'],
        'Sex Offenses':      ['sexual', 'rape', 'indecent'],
        'Juvenile Defense':  ['juvenile', 'minor'],
        'Expungement':       ['expungement', 'record clearing', 'sealing'],
        'White Collar':      ['white collar', 'fraud', 'embezzlement', 'forgery'],
        'Family Law':        ['family', 'divorce', 'custody', 'alimony', 'marriage'],
        'Divorce':           ['divorce', 'separation', 'family'],
        'Child Custody':     ['custody', 'child', 'parental'],
        'Immigration':       ['immigration', 'deportation', 'visa', 'citizenship'],
        'Personal Injury':   ['personal injury', 'accident', 'negligence', 'slip'],
        'Employment':        ['employment', 'workplace', 'discrimination', 'wrongful termination'],
        'Bankruptcy':        ['bankruptcy', 'debt', 'chapter 7', 'chapter 13'],
        'Real Estate':       ['real estate', 'property', 'landlord', 'tenant'],
        'Civil Rights':      ['civil rights', 'discrimination', 'constitutional'],
        'Traffic':           ['traffic', 'speeding', 'reckless', 'license'],
      };
      const keywords = ALIASES[caseType] || [caseType.toLowerCase()];
      const searchText = [
        ...safeParseJson(l.specialties, []),
        l.bio || '',
      ].join(' ').toLowerCase();
      if (!keywords.some(kw => searchText.includes(kw))) {
        return false;
      }
    }
    return true;
  });
}

function formatLawyer(l, distanceKm) {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    address: l.address,
    lat: l.lat,
    lng: l.lng,
    website: l.website || null,
    city: l.city,
    rating: l.rating,
    reviews: l.reviews,
    verified: !!l.verified,
    pro_bono: !!l.pro_bono,
    sliding_scale: !!l.sliding_scale,
    free_consultation: !!l.free_consultation,
    years_experience: l.years_experience || null,
    specialties: safeParseJson(l.specialties, []),
    languages: safeParseJson(l.languages, ['English']),
    bio: l.bio || null,
    bar_number: l.bar_number || null,
    distanceKm:   distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
    distanceMi:   distanceKm != null ? Math.round(distanceKm * 0.621371 * 10) / 10 : null,
    golden_gavel:        !!l.golden_gavel,
    gavel_level:         l.gavel_level || (l.golden_gavel ? 3 : 0),
    bar_verified:        !!l.bar_verified,
    bar_verified_since:  l.bar_verified_since || null,
    jtb_verified:        !!l.jtb_verified,
    jtb_verified_since:  l.jtb_verified_since || null,
    seed_data:           l.source === 'seed',   // true = framework record, not yet verified
    avg_response_hrs:    l.avg_response_hrs || null,
    accepting_leads:     l.accepting_leads !== 0,
    availability:        l.availability || 'accepting',
  };
}

function formatBailAgent(a, distanceKm) {
  return {
    id: a.id,
    name: a.name,
    phone: a.phone,
    address: a.address,
    lat: a.lat,
    lng: a.lng,
    website: a.website || null,
    city: a.city,
    rating: a.rating,
    reviews: a.reviews,
    verified: !!a.verified,
    jtb_verified: !!a.jtb_verified,
    jtb_verified_since: a.jtb_verified_since || null,
    distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
    distanceMi: distanceKm != null ? Math.round(distanceKm * 0.621371 * 10) / 10 : null
  };
}

// ── GET /api/providers/nearest-city ──────────────────────────────────────────


// ── Provider search helpers ───────────────────────────────────────────────────

/**
 * scoreForSort(l) — Compute a sort priority score for a lawyer row.
 * Higher score = appears first. Breaks ties by ascending distance.
 * Complexity: 1 (pure arithmetic, no branches)
 */
function scoreForSort(l) {
  return (l.jtb_verified ? 100 : 0) +
         (l.bar_verified  ?  50 : 0) +
         ((l.gavel_level  ||  0) * 10) +
         (l.rating         ||  0);
}

/**
 * sortByVerification(lawyers) — Sort by verification score, then by distance.
 * Zero behavior change from the inline sort in the GPS handler.
 * Complexity: 1 (delegates to Array.sort)
 */
function sortByVerification(lawyers) {
  return [...lawyers].sort((a, b) => {
    const diff = scoreForSort(b) - scoreForSort(a);
    if (diff !== 0) return diff;
    if (a._dist != null && b._dist != null) return a._dist - b._dist;
    return 0;
  });
}

/**
 * findLawyersInRadiusWithFallback(allLawyers, lat, lng, filters)
 *
 * Expands search radius through RADIUS_STEPS_KM until MIN_RESULTS are found.
 * At the widest radius, drops specialty/language filters if still empty.
 * Returns the filtered + sorted array (no pagination applied yet).
 *
 * Extracted from: router.get('/lawyers') GPS path
 * Complexity: 4 (for loop + 3 conditions)
 */
function findLawyersInRadiusWithFallback(allLawyers, lat, lng, filters) {
  const withDist = allLawyers
    .map(l => ({ ...l, _dist: haversineKm(lat, lng, l.lat, l.lng) }))
    .sort((a, b) => a._dist - b._dist);

  let result = [];
  for (const radiusKm of RADIUS_STEPS_KM) {
    const inRadius = withDist.filter(l => l._dist <= radiusKm);
    result = applyFilters(inRadius, filters);
    if (result.length >= MIN_RESULTS) break;
    if (radiusKm >= 200 && result.length === 0) {
      result = inRadius; // drop specialty filters at max radius
      if (result.length >= MIN_RESULTS) break;
    }
  }

  return sortByVerification(result);
}

router.get('/nearest-city', searchLimiter, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return err400(res, 'lat and lng are required');
    }
    const pdb = await openDb();
    if (!pdb) return res.status(503).json({ error: 'Provider service unavailable.' });
    const result = await findNearestCity(pdb, lat, lng);
    if (!result) return err404(res, 'No cities found');
    res.json(result);
  } catch (err) {
    logger.error('[providers/nearest-city]', err.message);
    res.status(500).json({ error: 'Could not resolve nearest city' });
  }
});

// ── GET /api/providers/lawyers ────────────────────────────────────────────────

router.get('/lawyers', optionalAuth, searchLimiter, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const city = req.query.city || null;
    const limit  = Math.min(safeInt(req.query.limit || '20'), 50);
    const page   = Math.max(1, safeInt(req.query.page || '1'));
    const offset = (page - 1) * limit;
    const caseType = req.query.caseType || '';
    const language = req.query.language || '';
    const proBonoOnly = req.query.proBonoOnly === 'true';
    const user_state  = (req.query.user_state || '').toString().toUpperCase().slice(0,2) || null;
    const slidingScaleOnly = req.query.slidingScaleOnly === 'true';

    const db = await openDb();
    if (!db) return res.status(503).json({ error: 'Provider service unavailable.' });

    // GPS path — delegate to extracted helper (see findLawyersInRadiusWithFallback)
    if (hasCoords) {
      const all = await db.all(
        `SELECT id,name,phone,address,lat,lng,website,city,state,rating,reviews,
                bar_number,verified,bar_verified,jtb_verified,gavel_level,golden_gavel,
                free_consultation,pro_bono,sliding_scale,languages,hourly_rate,
                specialties,availability,source,sort_priority,active
         FROM lawyers WHERE active=1 AND lat IS NOT NULL AND lng IS NOT NULL`
      );
      const sorted = findLawyersInRadiusWithFallback(
        all, lat, lng,
        { caseType, language, proBonoOnly, slidingScaleOnly }
      );
      const result = sorted.slice(offset, offset + limit).map(l => formatLawyer(l, l._dist));
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.json(result);
    }
    // City string path
    if (city) {
      const rows = await db.all(
        'SELECT id, name, city, state, phone, address, lat, lng, specialties, data_verified, sort_priority, avg_rating, review_count, available_24h, free_consultation, pro_bono, sliding_scale, bar_verified, source, website, photo_url FROM lawyers WHERE city = ? ORDER BY CASE WHEN l.state = ? THEN 0 ELSE 1 END ASC, rating DESC, reviews DESC LIMIT 300',
        [city]
      );
      const filtered = applyFilters(rows, { caseType, language, proBonoOnly, slidingScaleOnly });
      return res.json(filtered.slice(0, limit).map(l => formatLawyer(l, null)));
    }

    // Fallback: all lawyers, rating-sorted
    const rows = await db.all('SELECT id,name,phone,address,lat,lng,website,city,state,rating,reviews,verified,bar_verified,jtb_verified,bar_number,pro_bono,sliding_scale,free_consultation,years_experience,hourly_rate,availability,photo_url,languages,specialties,bio,gavel_level,golden_gavel,avg_response_hrs,data_verified,years_experience,seed_data,active FROM lawyers WHERE active=1 OR active IS NULL ORDER BY jtb_verified DESC, bar_verified DESC, rating DESC, reviews DESC LIMIT 500');
    res.json(rows.slice(0, limit).map(l => formatLawyer(l, null)));
  } catch (err) {
    logger.error('[providers/lawyers]', err.message);
    res.status(500).json({ error: 'Providers unavailable' });
  }
});

// ── GET /api/providers/bail ───────────────────────────────────────────────────

router.get('/bail', optionalAuth, searchLimiter, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const city = req.query.city || null;
    const radiusKm = parseFloat(req.query.radiusKm || '80');
    const limit = Math.min(safeInt(req.query.limit || '20'), 50);
    const user_state = (req.query.user_state || '').toString().toUpperCase().slice(0,2) || null;

    const db = await openDb();
    if (!db) return res.status(503).json({ error: 'Provider service unavailable.' });
    // bbox pre-filter: only load agents within an outer bounding box (SQL-level, fast)
    const bboxPad = hasCoords ? Math.max(radiusKm * 0.621371 + 50, 150) : 0;
    const bboxQ   = hasCoords ? bboxFromLatLng(lat, lng, bboxPad) : null;
    const bboxWhere = bboxQ
      ? ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?'
      : '';
    const bboxParams = bboxQ ? [bboxQ.minLat, bboxQ.maxLat, bboxQ.minLng, bboxQ.maxLng] : [];

    const all = await db.all(
      'SELECT id,name,phone,address,lat,lng,city,state,rating,reviews,license_number,verified,license_type,languages FROM bail_agents WHERE active=1 AND lat IS NOT NULL AND lng IS NOT NULL'
      + bboxWhere,
      bboxParams
    );

    if (hasCoords) {
      let results = all
        .map(a => ({ ...a, _dist: haversineKm(lat, lng, a.lat, a.lng) }))
        .filter(a => a._dist <= radiusKm)
        .sort((a, b) => a._dist - b._dist);

      // Auto-expand if fewer than MIN_RESULTS
      if (results.length < MIN_RESULTS) {
        results = all
          .map(a => ({ ...a, _dist: haversineKm(lat, lng, a.lat, a.lng) }))
          .sort((a, b) => a._dist - b._dist)
          .slice(0, MIN_RESULTS);
      }

      res.setHeader('Cache-Control', 'private, max-age=60');
    return res.json(results.slice(0, limit).map(a => formatBailAgent(a, a._dist)));
    }

    if (city) {
      return res.json(
        all.filter(a => a.city === city).slice(0, limit).map(a => formatBailAgent(a, null))
      );
    }

    res.json(all.slice(0, limit).map(a => formatBailAgent(a, null)));
  } catch (err) {
    logger.error('[providers/bail]', err.message);
    res.status(500).json({ error: 'Providers unavailable' });
  }
});


// ── Data coverage metadata ────────────────────────────────────────────────────
// States where real scraped attorney data exists
const SEED_ONLY_STATES = new Set(['NH', 'DE', 'ND', 'ME', 'SD', 'VT', 'MT', 'WV', 'RI', 'DC', 'WY']);

// GET /api/providers/coverage — returns state coverage for UI display
router.get('/coverage', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    seed_only_states: [...SEED_ONLY_STATES],
    note: 'States listed have attorney listings but phones/details not yet verified from live sources. Run the scraper to populate real data.',
  });
});

export default router;
