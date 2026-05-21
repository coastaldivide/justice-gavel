import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

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

export default router;
