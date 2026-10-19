/**
 * routes/help.js — core path step 2: "Find a lawyer AND a bail agent".
 * Public (guest core path). Provider rows are READ ONLY here.
 *
 * GET  /api/help/nearby   — lawyers and bail agents together.
 *   Location: lat+lng (preferred) | city (+state) | state.
 *   Filters:  charge (DUI, Drug Offenses, Assault, …), language, free_consult=1,
 *             open_now=1, h24=1 (24/7 per stored hours), max_km, type=all|lawyers|bail.
 *   Each result: distance_km, open_now (true/false/null = hours unknown),
 *   is_24_7, completeness 0–4. Ranked by distance + completeness — NEVER by
 *   payment or subscription. Also returns the state's public defender office
 *   (with eligibility text) and county inmate-lookup links (resources table).
 * POST /api/help/reports  — "Report a problem with this listing". Writes a
 *   listing_reports row for the admin review queue; never touches the
 *   provider row. One open report per listing+reason+reporter (a retry or a
 *   double tap returns the existing one).
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db/index.js';
import { optionalAuth, authRequired } from '../middleware/auth.js';
import { haversineKm, bboxFromLatLng } from '../services/geolink.js';
import { parseHours, isOpenNow, completeness, rankProviders, hasRealPhone } from '../services/providerHours.js';
import { normalizeState } from '../services/rightsContent.js';
import { safeJson, sanitizeStr } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';

const router = Router();

const nearbyLimiter = rateLimit({
  windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { error: 'Too many searches — please wait a moment.', code: 'rate_limited' },
});
const reportLimiter = rateLimit({
  windowMs: 10 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { error: 'Too many reports. Try again in a few minutes.', code: 'rate_limited' },
});

export const CHARGE_KEYWORDS = Object.freeze({
  'DUI':               ['dui', 'dwi', 'drunk driving', 'owi'],
  'Drug Offenses':     ['drug', 'narcotic', 'controlled substance', 'possession'],
  'Assault':           ['assault', 'battery', 'violent crime'],
  'Domestic Violence': ['domestic'],
  'Theft':             ['theft', 'larceny', 'robbery', 'burglary', 'shoplift'],
  'Weapons':           ['weapon', 'firearm', 'gun'],
  'Federal':           ['federal'],
  'Juvenile':          ['juvenile'],
  'Traffic':           ['traffic', 'speeding', 'reckless driving'],
  'Sex Offenses':      ['sex crime', 'sexual'],
  'White Collar':      ['white collar', 'fraud', 'embezzlement'],
});
const RADIUS_STEPS_KM = [25, 50, 100, 200, 400];
const MIN_EACH = 3;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const flag = (v) => v === '1' || v === 'true' || v === true || v === 1;
const listOf = (raw) => {
  const v = safeJson(raw);
  return Array.isArray(v) ? v.map(String) : [];
};

function decorate(row, kind, origin, now) {
  const distance = origin && Number.isFinite(row.lat) && Number.isFinite(row.lng)
    ? haversineKm(origin.lat, origin.lng, row.lat, row.lng) : null;
  const parsed = parseHours(row.hours);
  return {
    id: Number(row.id),
    kind,
    name: row.name,
    organization: (kind === 'lawyer' ? row.firm : row.company) || null,
    phone: hasRealPhone(row.phone) ? row.phone : null,
    website: row.website || null,
    address: row.address || null,
    city: row.city, state: row.state,
    lat: Number.isFinite(row.lat) ? row.lat : null,
    lng: Number.isFinite(row.lng) ? row.lng : null,
    distance_km: distance == null ? null : Math.round(distance * 10) / 10,
    hours: row.hours || null,
    hours_known: !!parsed,
    is_24_7: !!(parsed && parsed.all24),
    open_now: isOpenNow(row.hours, row.state, now),
    rating: row.rating == null ? null : Number(row.rating),
    review_count: row.reviews == null ? null : Number(row.reviews),
    languages: listOf(row.languages),
    specialties: listOf(row.specialties),
    free_consultation: kind === 'lawyer' ? (Number(row.free_consultation) === 1 || Number(row.free_consult) === 1) : null,
    license_number: kind === 'bail_agent' ? (row.license_number || null) : null,
    completeness: completeness(row),
  };
}

function matchesCharge(p, charge) {
  if (!charge) return true;
  const words = CHARGE_KEYWORDS[charge] || [String(charge).toLowerCase()];
  const text = [p.name, p.organization, p.website, ...(p.specialties || [])].join(' ').toLowerCase();
  return words.some(w => text.includes(w));
}

async function loadCandidates(db, table, cols, loc) {
  if (loc.origin) {
    const box = bboxFromLatLng(loc.origin.lat, loc.origin.lng, (loc.maxKm ?? RADIUS_STEPS_KM.at(-1)) / 1.609);
    return db.all(
      `SELECT ${cols} FROM ${table}
        WHERE COALESCE(active, 1) = 1 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
        LIMIT 3000`,
      [box.minLat, box.maxLat, box.minLng, box.maxLng]);
  }
  if (loc.city) {
    const rows = await db.all(
      `SELECT ${cols} FROM ${table}
        WHERE COALESCE(active, 1) = 1 AND LOWER(city) = LOWER(?) ${loc.state ? 'AND UPPER(state) = ?' : ''}
        LIMIT 500`,
      loc.state ? [loc.city, loc.state] : [loc.city]);
    if (rows.length || !loc.state) return rows;
  }
  if (loc.state) {
    return db.all(`SELECT ${cols} FROM ${table} WHERE COALESCE(active, 1) = 1 AND UPPER(state) = ? LIMIT 1000`, [loc.state]);
  }
  return [];
}

const LAWYER_COLS = 'id, name, firm, phone, website, address, city, state, lat, lng, hours, rating, reviews, languages, specialties, free_consultation, free_consult';
const BAIL_COLS   = 'id, name, company, phone, website, address, city, state, lat, lng, hours, rating, reviews, languages, specialties, license_number';

function pickWithinRadius(list, loc, limit) {
  if (!loc.origin) return { picked: list, radius_km: null };
  if (loc.maxKm != null) return { picked: list.filter(p => p.distance_km != null && p.distance_km <= loc.maxKm), radius_km: loc.maxKm };
  for (const r of RADIUS_STEPS_KM) {
    const within = list.filter(p => p.distance_km != null && p.distance_km <= r);
    if (within.length >= Math.min(MIN_EACH, limit) || r === RADIUS_STEPS_KM.at(-1)) return { picked: within, radius_km: r };
  }
  return { picked: [], radius_km: RADIUS_STEPS_KM.at(-1) };
}

router.get('/nearby', optionalAuth, nearbyLimiter, async (req, res) => {
  const q = req.query;
  const lat = num(q.lat); const lng = num(q.lng);
  const origin = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const city = q.city ? sanitizeStr(String(q.city), 100).replace(/,\s*[A-Za-z]{2}$/, '').trim() || null : null;
  const cityState = q.city && /,\s*([A-Za-z]{2})$/.exec(String(q.city));
  const state = normalizeState(q.state || (cityState && cityState[1]));
  if (!origin && !city && !state) {
    return res.status(400).json({ error: 'Share your location, or choose a city or state.', code: 'location_required' });
  }
  const maxKm = num(q.max_km);
  const loc = { origin, city, state, maxKm: maxKm != null ? Math.min(Math.max(maxKm, 1), 400) : null };
  const limit = Math.min(Math.max(Number.parseInt(q.limit, 10) || 10, 1), 25);
  const type = ['lawyers', 'bail'].includes(q.type) ? q.type : 'all';
  const charge = q.charge ? sanitizeStr(String(q.charge), 60) : null;
  const language = q.language && !/^english$/i.test(String(q.language)) ? sanitizeStr(String(q.language), 40) : null;
  const filters = {
    charge, language,
    free_consult: flag(q.free_consult), open_now: flag(q.open_now), h24: flag(q.h24),
  };
  const now = new Date();
  try {
    const db = await getDb();
    const [lawRows, bailRows] = await Promise.all([
      type === 'bail' ? [] : loadCandidates(db, 'lawyers', LAWYER_COLS, loc),
      type === 'lawyers' ? [] : loadCandidates(db, 'bail_agents', BAIL_COLS, loc),
    ]);
    let lawyers = lawRows.map(r => decorate(r, 'lawyer', origin, now));
    let bail = bailRows.map(r => decorate(r, 'bail_agent', origin, now));

    const common = (p) => (!filters.open_now || p.open_now === true) && (!filters.h24 || p.is_24_7);
    const speaks = (p) => !language || p.languages.some(l => l.toLowerCase().includes(language.toLowerCase()));
    lawyers = lawyers.filter(p => common(p) && speaks(p) && matchesCharge(p, charge) && (!filters.free_consult || p.free_consultation));
    // Bail agents post bond for any charge and list no consultation fee; the
    // language filter applies to them only when they list languages.
    bail = bail.filter(p => common(p) && speaks(p));

    const lw = pickWithinRadius(lawyers, loc, limit);
    const bw = pickWithinRadius(bail, loc, limit);
    const outLawyers = rankProviders(lw.picked).slice(0, limit);
    const outBail = rankProviders(bw.picked).slice(0, limit);

    const st = state || outLawyers[0]?.state || outBail[0]?.state || null;
    let publicDefender = null; let inmateLookup = [];
    if (st) {
      const rows = await db.all(
        `SELECT id, category, title, name, phone, url, website, address, eligibility, description, body, state, city
           FROM resources WHERE UPPER(state) = ? AND category IN ('PUBLIC_DEFENDER', 'INMATE_LOOKUP')
          ORDER BY category, priority NULLS LAST, id LIMIT 20`, [String(st).toUpperCase()]).catch(() => []);
      const pd = rows.find(r => r.category === 'PUBLIC_DEFENDER');
      if (pd) {
        publicDefender = {
          id: Number(pd.id), name: pd.title || pd.name, phone: pd.phone || null,
          url: pd.url || pd.website || null, address: pd.address || null,
          eligibility: pd.eligibility || null,
          // The seeded office descriptions carry uncited timing claims ("request at
          // arraignment / first appearance"); they are not shown (owner rule).
          about: null,
          note: 'If you cannot afford a lawyer, ask the court how to request a public defender.',
        };
      }
      inmateLookup = rows.filter(r => r.category === 'INMATE_LOOKUP').map(r => ({
        id: Number(r.id), name: r.title || r.name, phone: r.phone || null, url: r.url || r.website || null,
        about: r.description || r.body || null,
      }));
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      lawyers: outLawyers,
      bail_agents: outBail,
      public_defender: publicDefender,
      inmate_lookup: inmateLookup,
      meta: {
        state: st, location: origin ? 'coordinates' : city ? 'city' : 'state',
        radius_km: { lawyers: lw.radius_km, bail_agents: bw.radius_km },
        filters,
        counts: { lawyers: outLawyers.length, bail_agents: outBail.length },
        ranking: 'Sorted by distance and how complete the listing is (real phone, hours, website, address). Never by payment.',
        hours_note: '"Open now" and "24/7" come from the hours each listing publishes. Call to confirm.',
        charge_note: charge ? 'Charge filter matches the practice areas and name a lawyer lists. Bail agents post bond for any charge.' : null,
      },
    });
  } catch (e) {
    logger.error({ err: e.message }, '[help/nearby] failed');
    res.status(500).json({ error: 'Could not search right now. Please try again.', code: 'server_error' });
  }
});

export const REPORT_REASONS = Object.freeze({
  wrong_phone: 'Wrong or disconnected phone number',
  closed: 'Closed / out of business',
  wrong_address: 'Wrong address',
  wrong_hours: 'Wrong hours',
  not_this_service: 'Does not offer this service',
  other: 'Something else',
});

router.post('/reports', optionalAuth, reportLimiter, async (req, res) => {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const table = b.provider_type === 'lawyer' ? 'lawyers' : b.provider_type === 'bail_agent' ? 'bail_agents' : null;
  const id = Number.parseInt(b.provider_id, 10);
  const reason = typeof b.reason === 'string' && REPORT_REASONS[b.reason] ? b.reason : null;
  if (!table) return res.status(400).json({ error: "provider_type must be 'lawyer' or 'bail_agent'.", code: 'bad_provider_type' });
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'provider_id is required.', code: 'bad_provider_id' });
  if (!reason) return res.status(400).json({ error: `reason must be one of: ${Object.keys(REPORT_REASONS).join(', ')}.`, code: 'bad_reason' });
  const details = b.details == null ? null : sanitizeStr(String(b.details), 500).trim().slice(0, 500) || null;
  const reporterKey = createHash('sha256')
    .update(req.user?.id ? `u:${req.user.id}` : `ip:${req.ip || ''}`).digest('hex').slice(0, 40);
  try {
    const db = await getDb();
    const exists = await db.get(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ error: 'Listing not found.', code: 'not_found' });
    const ins = await db.get(
      `INSERT INTO listing_reports (table_name, record_id, reason, details, reporter_user_id, reporter_key)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (table_name, record_id, reason, reporter_key) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [table, id, reason, details, req.user?.id ?? null, reporterKey]);
    if (ins) {
      logger.info({ table, recordId: id, reason, reportId: Number(ins.id) }, '[help/reports] listing reported');
      return res.status(201).json({ ok: true, report_id: Number(ins.id), duplicate: false,
        message: 'Thanks — our team will check this listing.' });
    }
    const prev = await db.get(
      `SELECT id FROM listing_reports WHERE table_name = ? AND record_id = ? AND reason = ? AND reporter_key = ? AND status = 'pending'`,
      [table, id, reason, reporterKey]);
    return res.status(200).json({ ok: true, report_id: prev ? Number(prev.id) : null, duplicate: true,
      message: 'You already reported this — our team will check it.' });
  } catch (e) {
    logger.error({ err: e.message }, '[help/reports] failed');
    res.status(500).json({ error: 'Could not send the report. Please try again.', code: 'server_error' });
  }
});

/**
 * GET /api/help/bail-schedule?state=TN&charge=DUI — typical bail ranges (public,
 * guest core path). Each row keeps its recorded source / last-reviewed date.
 * No bail-agent fee estimate: the repo has no sourced per-state premium data,
 * so the response says so instead of guessing a percentage.
 */
router.get('/bail-schedule', nearbyLimiter, async (req, res) => {
  const raw = String(req.query.state || 'ALL').toUpperCase();
  const state = raw === 'ALL' ? 'ALL' : normalizeState(raw);
  if (!state) return res.status(400).json({ error: 'Unknown state code.', code: 'bad_state' });
  const charge = req.query.charge ? sanitizeStr(String(req.query.charge), 60).toLowerCase() : null;
  try {
    const db = await getDb();
    let rows = await db.all(
      `SELECT id, state, charge, charge_type, severity, bail_min, bail_max, bail_note, source, source_url, last_reviewed_at
         FROM bail_schedules WHERE UPPER(state) = ? OR (? <> 'ALL' AND state = 'ALL')
        ORDER BY CASE WHEN UPPER(state) = ? THEN 0 ELSE 1 END, charge_type, charge LIMIT 300`,
      [state, state, state]);
    if (charge) rows = rows.filter(r => String(r.charge || '').toLowerCase().includes(charge));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      data: rows.map(r => ({
        ...r, id: Number(r.id),
        last_reviewed: r.last_reviewed_at ? String(r.last_reviewed_at instanceof Date ? r.last_reviewed_at.toISOString() : r.last_reviewed_at).slice(0, 10) : null,
      })),
      meta: {
        state, count: rows.length,
        fee_estimate_available: false,
        fee_note: 'Bail agents set their own fees. Justice Gavel has no sourced fee data for your state yet — ask the agent what they charge before you sign.',
        disclaimer: 'Bail amounts are general ranges. Actual bail is set by a judge based on your specific circumstances.',
      },
    });
  } catch (e) {
    logger.error({ err: e.message }, '[help/bail-schedule] failed');
    res.status(500).json({ error: 'Could not load bail ranges.', code: 'server_error' });
  }
});

/**
 * POST /api/help/claims — "Is this your listing? Claim it." A signed-in lawyer
 * or bail agent asks to link their account to a directory listing (so
 * families' in-app messages reach them). Goes to the admin queue; nothing is
 * linked or changed until an admin has checked the licence.
 * GET  /api/help/claims/mine — my claim requests and their status.
 */
const claimLimiter = rateLimit({
  windowMs: 60 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { error: 'Too many claim requests. Try again later.', code: 'rate_limited' },
});
router.post('/claims', authRequired, claimLimiter, async (req, res) => {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const table = b.provider_type === 'lawyer' ? 'lawyers' : b.provider_type === 'bail_agent' ? 'bail_agents' : null;
  const id = Number.parseInt(b.provider_id, 10);
  if (!table) return res.status(400).json({ error: "provider_type must be 'lawyer' or 'bail_agent'.", code: 'bad_provider_type' });
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'provider_id is required.', code: 'bad_provider_id' });
  const license = b.license_number == null ? '' : sanitizeStr(String(b.license_number), 40).trim();
  if (license.length < 3) return res.status(400).json({ error: table === 'lawyers' ? 'Enter your bar number.' : 'Enter your bail-agent license number.', code: 'license_required' });
  const licState = normalizeState(b.license_state);
  const phone = b.contact_phone == null ? null : sanitizeStr(String(b.contact_phone), 30).trim() || null;
  const note = b.note == null ? null : sanitizeStr(String(b.note), 500).trim() || null;
  try {
    const db = await getDb();
    const exists = await db.get(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ error: 'Listing not found.', code: 'not_found' });
    const ins = await db.get(
      `INSERT INTO listing_claims (table_name, record_id, user_id, license_number, license_state, contact_phone, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (table_name, record_id, user_id) WHERE status = 'pending' DO NOTHING RETURNING id`,
      [table, id, req.user.id, license, licState, phone, note]);
    if (!ins) return res.status(200).json({ ok: true, duplicate: true, message: 'Your claim is already waiting for review.' });
    logger.info({ table, recordId: id, claimId: Number(ins.id) }, '[help/claims] listing claim requested');
    res.status(201).json({ ok: true, claim_id: Number(ins.id), status: 'pending',
      message: 'Thanks — we will check your license and link the listing to your account.' });
  } catch (e) {
    logger.error({ err: e.message }, '[help/claims] failed');
    res.status(500).json({ error: 'Could not send the claim. Please try again.', code: 'server_error' });
  }
});

router.get('/claims/mine', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, table_name, record_id, status, created_at, decided_at, decision_note
         FROM listing_claims WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
    res.json({ claims: rows.map(r => ({ ...r, id: Number(r.id), record_id: Number(r.record_id) })) });
  } catch (e) {
    logger.error({ err: e.message }, '[help/claims/mine] failed');
    res.status(500).json({ error: 'Could not load your claims.' });
  }
});

router.get('/report-reasons', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json({ reasons: Object.entries(REPORT_REASONS).map(([code, label]) => ({ code, label })) });
});

export default router;
