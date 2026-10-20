import { asyncRoute, err400 } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { apiLimiter } from '../middleware/rateLimiters.js';

const router = Router();

const FEE_NOTE = 'Bail agents set their own fees. Justice Gavel has no sourced fee data — ask the agent what they charge before you sign.';

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
  } catch { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
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
    const agents = await db.all('SELECT id,name,phone,address,lat,lng,city,state,rating,reviews,verified,available_24_7,active FROM bail_agents WHERE active != 0 ORDER BY rating DESC NULLS LAST LIMIT 300');
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


// POST /api/bail/calculate was removed: it multiplied invented base amounts by
// invented risk percentages (prior record ×1.25–2.5, flight risk ×1.4–2, …)
// with no source. The app shows recorded bail ranges with their source
// (GET /api/help/bail-schedule) instead.

// GET /api/bail/immigration — ICE bond schedule
router.get('/immigration', apiLimiter, (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=1800');
  res.json({
    minimum_bond:    1500,
    maximum_bond:    25000,
    typical_range:   '1,500 - 10,000',
    fee_note:        FEE_NOTE,
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


// ── GET /bail/estimate-total — what a quoted bail-agent fee comes to ──────
// The caller must supply the fee rate the agent actually quoted (`rate`, e.g.
// 0.08). No default rate and no invented court / monitoring / attorney
// amounts: there is no sourced data for them.
router.get('/estimate-total', apiLimiter, asyncRoute((req, res) => {
  const bail = parseFloat(req.query.bail_amount || '0');
  const rate = req.query.rate == null || req.query.rate === '' ? null : parseFloat(req.query.rate);

  if (!bail || bail <= 0) return res.status(400).json({ error: 'bail_amount required' });
  if (rate == null) {
    return res.json({ bail_amount: bail, premium: null, fee_note: FEE_NOTE,
      note: 'Enter the fee your bail agent quoted to see what it comes to.' });
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    return res.status(400).json({ error: 'rate must be the quoted fee as a fraction between 0 and 1 (e.g. 0.08).' });
  }
  const premium = Math.ceil(bail * rate * 100) / 100;
  return res.json({
    bail_amount: bail,
    quoted_rate: rate,
    premium,
    fee_note: FEE_NOTE,
    note: 'Based on the fee you entered. Ask the agent which parts, if any, are refundable before you sign.',
  });
}));

export default router;