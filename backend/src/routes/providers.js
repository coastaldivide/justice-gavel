import { safeJson, err400, err404, safeInt } from '../utils/routeHelpers.js';
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

import { Router } from 'express';
import { haversineKm, bboxFromLatLng } from '../services/geolink.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import logger              from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { apiLimiter }      from '../middleware/rateLimiters.js';
import { getDb }           from '../db/index.js';

const router = Router();

// Alias: /list → /lawyers
router.get('/list', (req, res, next) =>{
  try {
  req.url = '/lawyers' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  router.handle(req, res, next);

  } catch (_e) {
    res.status(500).json({ error: 'Internal server error.', code: 'server_error' });
  }
});


const MIN_RESULTS    = 3;

// "Nashville, TN" → { cityName: 'Nashville', stateCode: 'TN' }
function parseCityState(city, state) {
  let cityName  = city ? String(city).trim().slice(0, 100) : null;
  let stateCode = state ? String(state).trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || null : null;
  const m = cityName && /^(.*?),\s*([A-Za-z]{2})$/.exec(cityName);
  if (m) { cityName = m[1].trim(); stateCode = stateCode || m[2].toUpperCase(); }
  return { cityName: cityName || null, stateCode };
}
const RADIUS_STEPS_KM = [50, 100, 200, 500, 99999]; // expand until MIN_RESULTS found

// ── Rate limiters ─────────────────────────────────────────────────────────────
const searchLimiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: 'Provider search limit reached.' });

// ── Module-level singleton — one providers.sqlite connection per process ───────
// Re-opening on every request causes file descriptor leaks under load.
// Redirected to use main sql.js DB (no native sqlite3 required)
async function openDb() {
  const { getDb } = await import('../db/index.js');
  return getDb();
}


// ── Haversine distance ────────────────────────────────────────────────────────

// ── Nearest city resolver ─────────────────────────────────────────────────────
// Finds the closest city in our dataset to a given lat/lng.
// Used when the user has GPS coords but no city string.

async function findNearestCity(pdb, lat, lng) {
  const cities = await pdb.all(
    `SELECT
       l.city,
       AVG(l.lat) as clat,
       AVG(l.lng) as clng,
       COUNT(*) as provider_count,
       AVG(COALESCE(r.avg_rating, 0)) as avg_rating
     FROM lawyers l
     LEFT JOIN (
       SELECT provider_id, AVG(rating) as avg_rating, COUNT(*) as review_count
       FROM reviews WHERE rating IS NOT NULL GROUP BY provider_id
     ) r ON r.provider_id = l.id
     WHERE l.lat IS NOT NULL AND l.lng IS NOT NULL
     GROUP BY l.city`
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
  try { return safeJson(val); } catch { return fallback; }
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
    state: l.state || null,
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
    company: a.company || null,
    city: a.city,
    state: a.state || null,
    rating: a.rating,
    reviews: a.reviews,
    license_number: a.license_number || null,
    verified: !!(a.verified || a.doi_verified),
    available_24_7: !!a.available_24_7,
    payment_plans: !!a.payment_plans,
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
    // City / state path. Accepts city=Nashville&state=TN or city="Nashville, TN".
    const { cityName, stateCode } = parseCityState(city, req.query.state || user_state);
    if (cityName || stateCode) {
      const where = ['COALESCE(active, 1) = 1'];
      const params = [];
      if (cityName)  { where.push('LOWER(city) = LOWER(?)'); params.push(cityName); }
      if (stateCode) { where.push('UPPER(state) = ?');       params.push(stateCode); }
      const rows = await db.all(
        `SELECT id, name, city, state, phone, address, lat, lng, website, rating, reviews,
                specialties, languages, data_verified, sort_priority, avg_rating, review_count,
                available_24h, free_consultation, pro_bono, sliding_scale, bar_verified,
                jtb_verified, verified, gavel_level, golden_gavel, hourly_rate, availability,
                source, photo_url
           FROM lawyers WHERE ${where.join(' AND ')}
          ORDER BY COALESCE(sort_priority, 0) DESC, COALESCE(rating, 0) DESC, COALESCE(reviews, 0) DESC
          LIMIT 300`,
        params
      );
      const filtered = applyFilters(rows, { caseType, language, proBonoOnly, slidingScaleOnly });
      return res.json(filtered.slice(offset, offset + limit).map(l => formatLawyer(l, null)));
    }

    // Fallback: all lawyers, rating-sorted
    const rows = await db.all('SELECT id,name,phone,address,lat,lng,website,city,state,rating,reviews,verified,bar_verified,jtb_verified,bar_number,pro_bono,sliding_scale,free_consultation,years_experience,hourly_rate,availability,photo_url,languages,specialties,bio,gavel_level,golden_gavel,avg_response_hrs,data_verified,active FROM lawyers WHERE active=1 OR active IS NULL ORDER BY jtb_verified DESC NULLS LAST, bar_verified DESC NULLS LAST, rating DESC NULLS LAST, reviews DESC NULLS LAST LIMIT 500');
    res.json(rows.slice(offset, offset + limit).map(l => formatLawyer(l, null)));
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
    const { cityName: bailCity, stateCode: bailState } = parseCityState(city, req.query.state || user_state);
    // bbox pre-filter: only load agents within an outer bounding box (SQL-level, fast)
    const bboxPad = hasCoords ? Math.max(radiusKm * 0.621371 + 50, 150) : 0;
    const bboxQ   = hasCoords ? bboxFromLatLng(lat, lng, bboxPad) : null;
    const bboxWhere = bboxQ
      ? ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?'
      : '';
    const bboxParams = bboxQ ? [bboxQ.minLat, bboxQ.maxLat, bboxQ.minLng, bboxQ.maxLng] : [];

    const all = await db.all(
      'SELECT id,name,company,phone,address,lat,lng,city,state,rating,reviews,license_number,verified,doi_verified,languages,website,available_24_7,payment_plans,fee_percent,bond_rate FROM bail_agents WHERE COALESCE(active, 1) = 1'
      + (hasCoords ? ' AND lat IS NOT NULL AND lng IS NOT NULL' : '')
      + bboxWhere
      + (!hasCoords && bailCity  ? ' AND LOWER(city) = LOWER(?)' : '')
      + (!hasCoords && bailState ? ' AND UPPER(state) = ?' : '')
      + ' ORDER BY COALESCE(rating, 0) DESC, COALESCE(reviews, 0) DESC',
      [...bboxParams, ...(!hasCoords && bailCity ? [bailCity] : []), ...(!hasCoords && bailState ? [bailState] : [])]
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
router.get('/coverage', (req, res) =>{
  try {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    seed_only_states: [...SEED_ONLY_STATES],
    note: 'States listed have attorney listings but phones/details not yet verified from live sources. Run the scraper to populate real data.',
  });

  } catch (_e) {
    res.status(500).json({ error: 'Internal server error.', code: 'server_error' });
  }
});


// ── GET /providers/:id/reviews ────────────────────────────────────────────
router.get('/:id/reviews', apiLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid provider id' });
  try {
    const db = await getDb();
    const reviews = await db.all(
      `SELECT id, rating, comment, created_at
       FROM reviews WHERE provider_id = ? ORDER BY created_at DESC LIMIT 50`,
      [id]
    ).catch(() => []);
    const avg = reviews.length
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : null;
    return res.json({ provider_id: id, avg_rating: avg, count: reviews.length, reviews });
  } catch {
    return res.status(500).json({ error: 'Could not fetch reviews' });
  }
});

// ── POST /providers/:id/reviews — submit a rating ─────────────────────────
router.post('/:id/reviews', authRequired, async (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const rating = parseInt(req.body.rating, 10);
  const comment = (req.body.comment || '').slice(0, 1000);
  if (!id || isNaN(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'provider_id and rating 1-5 required' });
  }
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO reviews (provider_id, user_id, rating, comment, created_at)
       VALUES (?,?,?,?,NOW())
       ON CONFLICT (provider_id, user_id) DO UPDATE SET rating=?, comment=?, created_at=NOW()`,
      [id, req.user.id, rating, comment, rating, comment]
    );
    return res.status(201).json({ submitted: true });
  } catch {
    return res.status(500).json({ error: 'Could not submit review' });
  }
});

export default router;

// GET /api/providers/lawyers/:id — single attorney profile
router.get('/lawyers/:id', async (req, res) => {
  try {
    const db = await openDb();
    if (!db) return res.status(503).json({ error: 'Provider service unavailable.' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const lawyer = await db.get('SELECT * FROM lawyers WHERE id = ?', [id]);
    if (!lawyer) return res.status(404).json({ error: 'Attorney not found' });
    // Parse specialties if stored as JSON string
    lawyer.specialties = safeJson(lawyer.specialties);
    // Fetch reviews
    const reviews = await db.all(
      'SELECT id, rating, comment, created_at FROM reviews_app WHERE provider_id = ? ORDER BY created_at DESC LIMIT 20',
      [id]
    ).catch(() => []);
    res.json({ ...lawyer, reviews });
  } catch { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});
