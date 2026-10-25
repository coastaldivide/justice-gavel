/**
 * /api/providers — lawyer and bail-agent directory (real, verified listings; read only)
 *
 * GET /api/providers/lawyers
 * GET /api/providers/bail
 *   Where:   lat+lng (nearest first) · q (city, "City, ST", state, ZIP or name)
 *            · city / state (older callers) · radiusKm (hard limit; otherwise the
 *            smallest of 50/100/200/500 km with a full page, then everything)
 *   Filters: caseType, language, proBonoOnly, slidingScaleOnly (lawyers);
 *            paymentPlans, open24 (bail) — filters always narrow
 *   Paging:  page (1-based), limit (≤ 50). Body: an array of listings.
 *            Headers: X-Total-Count, X-Search-Matched (near|zip|city|state|name|all|none)
 *   See services/providerDirectory.js for matching and order.
 *
 * GET /api/providers/lawyers/:id   one lawyer listing (+ Justice Gavel review summary)
 * GET /api/providers/bail/:id      one bail-agent listing
 * GET /api/providers/nearest-city  { city, distanceKm } — nearest city in the directory
 * GET /api/providers/coverage      states whose listings are seed-only
 */
import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { getDb } from '../db/index.js';
import { haversineKm } from '../services/geolink.js';
import { resolveLang, msg } from '../i18n/index.js';
import { searchDirectory, pageOf, formatLawyer, formatBailAgent } from '../services/providerDirectory.js';
import { directoryRows } from '../services/directoryCache.js';

const router = Router();
const searchLimiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: 'Provider search limit reached.' });

// Listings that are linked to a Justice Gavel account can receive in-app messages.
export const LAWYER_COLS = `l.id, l.name, l.firm, l.phone, l.address, l.city, l.state, l.lat, l.lng, l.website,
  l.rating, l.reviews, l.review_count, l.specialties, l.languages, l.bio, l.years_experience, l.hourly_rate,
  l.bar_number, l.bar_state, l.verified, l.bar_verified, l.bar_verified_since, l.jtb_verified,
  l.jtb_verified_since, l.golden_gavel, l.gavel_level, l.data_verified, l.pro_bono, l.sliding_scale,
  l.free_consultation, l.avg_response_hrs, l.accepting_leads, l.availability, l.source, l.hours,
  (l.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id)) AS on_app`;
export const BAIL_COLS = `id, name, company, phone, address, city, state, lat, lng, website, rating, reviews,
  license_number, license_type, verified, doi_verified, payment_plans, available_24_7, languages, hours`;

const finite = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; };
const yes = (v) => v === 'true' || v === '1' || v === true;

function searchOptions(req) {
  const lat = finite(req.query.lat);
  const lng = finite(req.query.lng);
  const hasCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const radius = finite(req.query.radiusKm);
  return {
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    q: typeof req.query.q === 'string' ? req.query.q : '',
    city: typeof req.query.city === 'string' ? req.query.city.slice(0, 100) : '',
    state: typeof req.query.state === 'string' ? req.query.state : (typeof req.query.user_state === 'string' && !req.query.city && !req.query.q && !hasCoords ? req.query.user_state : ''),
    radiusKm: radius && radius > 0 ? Math.min(radius, 5000) : null,
    page: Number.parseInt(req.query.page, 10) || 1,
    limit: Number.parseInt(req.query.limit, 10) || 20,
  };
}

function send(res, found, page, limit, format) {
  res.setHeader('X-Total-Count', String(found.total));
  res.setHeader('X-Search-Matched', found.matched);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.json(pageOf(found.rows, page, limit).map(r => format(r, Number.isFinite(r._dist) ? r._dist : null)));
}

// ── GET /api/providers/lawyers ────────────────────────────────────────────────
router.get('/lawyers', optionalAuth, searchLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const o = searchOptions(req);
    const db = await getDb();
    const rows = await directoryRows(db, `SELECT ${LAWYER_COLS} FROM lawyers l WHERE COALESCE(l.active, 1) = 1`);
    const found = searchDirectory(rows, {
      ...o,
      filters: {
        caseType: typeof req.query.caseType === 'string' ? req.query.caseType.slice(0, 60) : '',
        language: typeof req.query.language === 'string' ? req.query.language.slice(0, 40) : '',
        proBonoOnly: yes(req.query.proBonoOnly),
        slidingScaleOnly: yes(req.query.slidingScaleOnly),
      },
    });
    send(res, found, o.page, o.limit, formatLawyer);
  } catch (err) {
    logger.error('[providers/lawyers]', err.message);
    res.status(500).json({ error: msg(lang, 'providers.err.unavailable'), code: 'server_error' });
  }
});

// ── GET /api/providers/lawyers/:id ────────────────────────────────────────────
router.get('/lawyers/:id', optionalAuth, searchLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== String(req.params.id).trim()) {
    return res.status(400).json({ error: msg(lang, 'providers.err.bad_id'), code: 'bad_id' });
  }
  try {
    const db = await getDb();
    const row = await db.get(`SELECT ${LAWYER_COLS} FROM lawyers l WHERE l.id = ? AND COALESCE(l.active, 1) = 1`, [id]);
    if (!row) return res.status(404).json({ error: msg(lang, 'providers.err.lawyer_not_found'), code: 'not_found' });
    const agg = await db.get(
      `SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews
        WHERE entity_type = 'lawyer' AND entity_id = ? AND COALESCE(status, 'published') = 'published'`, [id]);
    res.json({
      ...formatLawyer(row),
      app_reviews: { avg_rating: agg?.n ? Math.round(Number(agg.avg) * 10) / 10 : null, count: Number(agg?.n || 0) },
    });
  } catch (err) {
    logger.error('[providers/lawyers/:id]', err.message);
    res.status(500).json({ error: msg(lang, 'providers.err.unavailable'), code: 'server_error' });
  }
});

// ── GET /api/providers/bail ───────────────────────────────────────────────────
router.get('/bail', optionalAuth, searchLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const o = searchOptions(req);
    const db = await getDb();
    let rows = await directoryRows(db, `SELECT ${BAIL_COLS} FROM bail_agents WHERE COALESCE(active, 1) = 1`);
    if (yes(req.query.paymentPlans)) rows = rows.filter(r => Number(r.payment_plans) === 1);
    const found = searchDirectory(rows, { ...o, minResults: 20 });
    if (yes(req.query.open24)) {
      const keep = found.rows.filter(r => formatBailAgent(r).open_24_7);
      found.rows = keep; found.total = keep.length;
    }
    send(res, found, o.page, o.limit, formatBailAgent);
  } catch (err) {
    logger.error('[providers/bail]', err.message);
    res.status(500).json({ error: msg(lang, 'providers.err.unavailable'), code: 'server_error' });
  }
});

// ── GET /api/providers/bail/:id ───────────────────────────────────────────────
router.get('/bail/:id', optionalAuth, searchLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== String(req.params.id).trim()) {
    return res.status(400).json({ error: msg(lang, 'providers.err.bad_id'), code: 'bad_id' });
  }
  try {
    const db = await getDb();
    const row = await db.get(`SELECT ${BAIL_COLS} FROM bail_agents WHERE id = ? AND COALESCE(active, 1) = 1`, [id]);
    if (!row) return res.status(404).json({ error: msg(lang, 'providers.err.agent_not_found'), code: 'not_found' });
    res.json(formatBailAgent(row));
  } catch (err) {
    logger.error('[providers/bail/:id]', err.message);
    res.status(500).json({ error: msg(lang, 'providers.err.unavailable'), code: 'server_error' });
  }
});

// ── GET /api/providers/nearest-city ──────────────────────────────────────────
router.get('/nearest-city', searchLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const lat = finite(req.query.lat);
  const lng = finite(req.query.lng);
  if (lat === null || lng === null) return res.status(400).json({ error: msg(lang, 'providers.err.lat_lng'), code: 'bad_location' });
  try {
    const db = await getDb();
    const cities = await db.all(
      `SELECT city, state, AVG(lat) AS clat, AVG(lng) AS clng FROM lawyers
        WHERE lat IS NOT NULL AND lng IS NOT NULL AND COALESCE(active, 1) = 1 GROUP BY city, state`);
    let best = null; let bestDist = Infinity;
    for (const c of cities) {
      const d = haversineKm(lat, lng, Number(c.clat), Number(c.clng));
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (!best) return res.status(404).json({ error: msg(lang, 'providers.err.no_cities'), code: 'not_found' });
    res.json({ city: best.city, state: best.state, distanceKm: Math.round(bestDist) });
  } catch (err) {
    logger.error('[providers/nearest-city]', err.message);
    res.status(500).json({ error: msg(lang, 'providers.err.unavailable'), code: 'server_error' });
  }
});

// ── GET /api/providers/coverage ───────────────────────────────────────────────
// States whose listings have not been verified from live sources yet.
const SEED_ONLY_STATES = ['NH', 'DE', 'ND', 'ME', 'SD', 'VT', 'MT', 'WV', 'RI', 'DC', 'WY'];
router.get('/coverage', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ seed_only_states: SEED_ONLY_STATES, note: msg(resolveLang(req), 'providers.coverage_note') });
});

export default router;
