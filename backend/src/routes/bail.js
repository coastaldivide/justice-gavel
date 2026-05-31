import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { apiLimiter, writeLimiter, aiLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// GET /api/bail?state=TN — return bail schedules for state (no GPS needed)
router.get('/', async (req, res) => {
  const { state } = req.query;
  try {
    const { getDb } = await import('../db/index.js');
    const db = await getDb();
    const rows = await db.all(
      state ? 'SELECT * FROM bail_schedules WHERE state=? OR state=\'ALL\' ORDER BY charge ASC LIMIT 100'
             : 'SELECT * FROM bail_schedules WHERE state=\'ALL\' ORDER BY charge ASC LIMIT 50',
      state ? [state] : []
    ).catch(() => []);
    res.json({ data: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


function haversine(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R;
}

router.get('/nearby', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radiusKm || '50');
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return err400(res, 'lat and lng are required');
    }
    const db = await getDb();
    const agents = await db.all('SELECT id,name,phone,address,lat,lng,city,state,rating,reviews,verified,fee_percent,available_24_7,active FROM bail_agents WHERE active != 0 ORDER BY rating DESC LIMIT 300');
    const list = agents
      .map(a => ({ ...a, distanceKm: haversine(lat, lng, a.lat, a.lng) }))
      .filter(a => a.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(list);
  } catch (e) {
    logger.error({ msg: '[bail]', error: e?.message });
    res.status(500).json({ error: 'Could not load bail agents' });
  }
});


// POST /api/bail/calculate — compute bail recommendation from case factors
router.post('/calculate', apiLimiter, async (req, res) => {
  const {
    state,
    charge_type,      // 'felony' | 'misdemeanor' | 'dui' | 'domestic' | 'sexual' | 'dismissed'
    severity,         // 'low' | 'medium' | 'high' | 'extreme'
    prior_record,     // 'none' | 'minor' | 'significant' | 'extensive'
    flight_risk,      // 'low' | 'medium' | 'high'
    employed,         // boolean — community ties factor
    ice_hold,         // boolean — ICE detainer
    violent,          // boolean — violence flag
  } = req.body;

  if (!state || !charge_type) return err400(res, 'state and charge_type required');

  // ── Immigration bond (8 U.S.C. § 1226(a)) ─────────────────────────────────
  if (ice_hold) {
    const bond_min = 1500;    // statutory minimum
    const bond_max = flight_risk === 'high' ? 25000 : flight_risk === 'medium' ? 10000 : 5000;
    return res.json({
      type:         'immigration_bond',
      bond_min,
      bond_max,
      bondsman_min: Math.round(bond_min * 0.15),   // 15% for immigration bonds (vs 10% criminal)
      bondsman_max: Math.round(bond_max * 0.15),
      statutory:    '8 U.S.C. § 1226(a)',
      note:         'ICE detainer holds prevent state bail release. Immigration bond is separate and set by an immigration judge. Minimum $1,500 by statute. Bond may be denied for flight risk or danger to community.',
      no_bail_risk: flight_risk === 'high' && prior_record === 'extensive',
    });
  }

  // ── Criminal bail schedule ────────────────────────────────────────────────
  // Base amounts by charge type and severity
  const BASE = {
    dismissed:   { low: 0,     medium: 0,      high: 0,       extreme: 0       },
    misdemeanor: { low: 500,   medium: 2500,   high: 5000,    extreme: 10000   },
    dui:         { low: 1500,  medium: 5000,   high: 15000,   extreme: 25000   },
    domestic:    { low: 2500,  medium: 7500,   high: 20000,   extreme: 50000   },
    felony:      { low: 5000,  medium: 25000,  high: 75000,   extreme: 250000  },
    sexual:      { low: 25000, medium: 100000, high: 250000,  extreme: 500000  },
  };

  const sev = severity || 'medium';
  const ct  = charge_type in BASE ? charge_type : 'felony';
  let base  = BASE[ct][sev] || BASE['felony'][sev];

  // ── Risk factor multipliers ───────────────────────────────────────────────
  const PRIOR_MULT   = { none: 1.0, minor: 1.25, significant: 1.75, extensive: 2.5 };
  const FLIGHT_MULT  = { low:  1.0, medium: 1.4,  high: 2.0 };
  const EMPLOY_MULT  = employed ? 0.85 : 1.15;   // employed = lower flight risk
  const VIOLENT_MULT = violent  ? 1.5  : 1.0;

  const prior_mult  = PRIOR_MULT[prior_record  || 'none'];
  const flight_mult = FLIGHT_MULT[flight_risk  || 'low'];

  let recommended = Math.round(base * prior_mult * flight_mult * EMPLOY_MULT * VIOLENT_MULT);

  // Round to nearest $500 for readability
  recommended = Math.round(recommended / 500) * 500;

  // ── No-bail / remand scenarios ────────────────────────────────────────────
  const remand_risk =
    (ct === 'sexual'   && sev === 'extreme') ||
    (ct === 'felony'   && flight_risk === 'high' && prior_record === 'extensive') ||
    (ct === 'domestic' && violent && sev === 'extreme');

  // ── Supervision conditions ────────────────────────────────────────────────
  const conditions = [];
  if (ct === 'domestic')    conditions.push('No-contact order with victim required');
  if (flight_risk !== 'low') conditions.push('Passport surrender likely required');
  if (ct === 'dui')         conditions.push('Ignition interlock may be required');
  if (prior_record !== 'none') conditions.push('Pre-trial supervision likely');
  if (violent)              conditions.push('Electronic monitoring possible');

  // ── Bondsman cost (standard 10% non-refundable premium) ──────────────────
  const BOND_RATE   = 0.10;
  const bondsman_cost = Math.round(recommended * BOND_RATE);

  res.json({
    type:              'criminal_bail',
    recommended,
    bail_range_min:    Math.round(recommended * 0.75),
    bail_range_max:    Math.round(recommended * 1.5),
    bondsman_cost,                              // 10% non-refundable
    bondsman_rate_pct: 10,
    cash_bail:         recommended,             // pay full amount directly to court
    remand_risk,
    conditions,
    factors: {
      base_amount:  base,
      prior_mult,
      flight_mult,
      employ_mult:  EMPLOY_MULT,
      violent_mult: VIOLENT_MULT,
    },
    disclaimer: 'Bail is set by a judge and varies significantly by jurisdiction, judge, and case facts. This is an estimate only. Actual bail may be higher, lower, or denied entirely.',
  });
});

// GET /api/bail/immigration — ICE bond schedule
router.get('/immigration', apiLimiter, (req, res) => {
  res.json({
    minimum_bond:    1500,
    maximum_bond:    25000,
    typical_range:   '1,500 - 10,000',
    premium_rate:    '15% (higher than criminal bonds)',
    statutory_basis: '8 U.S.C. § 1226(a)',
    bond_types: [
      { type: 'delivery_bond',    description: 'Allows detainee release pending immigration hearing. Set by ICE or immigration judge.' },
      { type: 'voluntary_return', description: 'Detainee agrees to return to home country. Avoids deportation order.' },
      { type: 'supervision',      description: 'Release on own recognizance with check-in requirements. No bond required.' },
    ],
    redetermination: 'Detainee can request bond redetermination hearing before immigration judge within 10 days of initial custody.',
    no_bond_bars: ['Mandatory detention (certain criminal convictions, 8 U.S.C. § 1226(c))', 'Arrival without inspection with no credible fear claim', 'Prior removal order', 'Terrorism or security grounds'],
  });
});

export default router;
