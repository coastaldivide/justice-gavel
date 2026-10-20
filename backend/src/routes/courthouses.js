/**
 * GET /api/courthouses      courthouse directory (public: a courthouse address is not personal data)
 *   ?q=   name, address, city or county ("Nashville", "Davidson", "Austin, TX")
 *   ?city= ?state= ?limit=
 * GET /api/courthouses/:id
 */
import { escapeLike, err404, safeInt } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { getDb }   from '../db/index.js';
import logger from '../utils/logger.js';
import { apiLimiter } from '../middleware/rateLimiters.js';
import { resolveLang, msg } from '../i18n/index.js';

const router = Router();

router.get('/', apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { city, limit = 50 } = req.query;
    let { state, q } = req.query;
    // "Austin, TX" → the place + the state
    const m = typeof q === 'string' ? /^(.*?),\s*([A-Za-z]{2})$/.exec(q.trim()) : null;
    if (m) { q = m[1]; state = state || m[2]; }
    const qSafe = q ? escapeLike(String(q).trim(), 100) : null;

    let sql = 'SELECT id, name, address, city, state, zip_code, phone, lat, lng, url, hours, court_type, county FROM courthouses WHERE 1=1';
    const params = [];

    if (city)  { sql += ' AND LOWER(city)=LOWER(?)'; params.push(String(city).slice(0, 100)); }
    if (state) { sql += ' AND UPPER(state)=?';    params.push(String(state).toUpperCase().slice(0, 2)); }
    if (q)     {
      sql += ' AND (name ILIKE ? OR address ILIKE ? OR county ILIKE ? OR city ILIKE ?)';
      params.push(`%${qSafe}%`, `%${qSafe}%`, `%${qSafe}%`, `%${qSafe}%`);
    }
    sql += ' ORDER BY state ASC, city ASC, name ASC LIMIT ?';
    params.push(Math.min(safeInt(limit) || 50, 500));

    const rows = await db.all(sql, params);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.json(rows);
  } catch (e) {
    logger.error('[courthouses]', e.message);
    res.status(500).json({ error: msg(resolveLang(req), 'courthouse.err.load') });
  }
});

router.get('/:id', apiLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get('SELECT id, name, address, city, state, zip_code, phone, lat, lng, url, hours, court_type, county FROM courthouses WHERE id=?', [safeInt(req.params.id)]);
    if (!row) return err404(res, msg(resolveLang(req), 'courthouse.err.not_found'));
    res.json(row);
  } catch (e) { logger.error('[courthouses/:id]', e.message); res.status(500).json({ error: msg(resolveLang(req), 'courthouse.err.load') }); }
});

export default router;
