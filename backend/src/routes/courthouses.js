/**
 * GET /api/courthouses
 * Returns courthouse(s) for a city or state.
 * Query params: city, state, q (search)
 */
import { err400, escapeLike, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { getDb }   from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { city, state, q, limit = 50 } = req.query;
  const qSafe = q ? escapeLike(String(q).trim(), 100) : null;

    let sql = 'SELECT id, name, address, city, state, zip_code, phone, lat, lng, url, hours, court_type, county FROM courthouses WHERE 1=1';
    const params = [];

    if (city)  { sql += ' AND city=?';            params.push(city); }
    if (state) { sql += ' AND state=?';           params.push(state); }
    if (q)     {
      sql += ' AND (name LIKE ? OR address LIKE ? OR county LIKE ?)';
      params.push(`%${qSafe}%`, `%${qSafe}%`, `%${qSafe}%`);
    }
    sql += ' ORDER BY city ASC LIMIT ?';
    params.push(safeInt(limit) || 50);

    const rows = await db.all(sql, params);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.json(rows);
  } catch (e) {
    logger.error('[courthouses]', e.message);
    res.status(500).json({ error: 'Could not load courthouses' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get('SELECT id, name, address, city, state, zip_code, phone, lat, lng, url, hours, court_type, county FROM courthouses WHERE id=?', [safeInt(req.params.id)]);
    if (!row) return err404(res, 'Not found');
    res.json(row);
  } catch (e) { logger.error('[courthouses/:id]', e.message); res.status(500).json({ error: 'Could not load courthouse' }); }
});

export default router;
