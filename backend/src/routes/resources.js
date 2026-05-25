import { err400, escapeLike, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { getDb }   from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import logger from '../utils/logger.js';
const router = Router();

// GET /api/resources
// Query params: category, state, q (search), type, free, limit
router.get('/', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { category, state, q, type, free, limit = 100 } = req.query;
  const qSafe = q ? escapeLike(String(q).trim(), 100) : null;

    let sql = 'SELECT id, name, category, description, phone, website, address, city, state, email, hours, free, eligibility, languages, updated_at FROM resources WHERE 1=1';
    const params = [];

    if (category)          { sql += ' AND category=?';                           params.push(category); }
    if (state)             { sql += ' AND (state=? OR state IS NULL)';           params.push(state); }
    if (type)              { sql += ' AND type=?';                               params.push(type); }
    if (free === 'true')   { sql += ' AND free=1'; }
    if (q)                 { sql += ' AND (title LIKE ? OR body LIKE ?)';        params.push(`%${qSafe}%`, `%${qSafe}%`); }

    sql += ' ORDER BY priority DESC, id ASC LIMIT ?';
    params.push(safeInt(limit) || 100);

    const rows = await db.all(sql, params);

    // Parse languages JSON
    const parsed = rows.map(r => ({
      ...r,
      languages: (() => { try { return JSON.parse(r.languages || '["English"]'); } catch { return ['English']; } })(),
    }));

    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
    return res.json(parsed);
  } catch (e) {
    logger.error('[resources]', e.message);
    res.status(500).json({ error: 'Could not load resources' });
  }
});

// GET /api/resources/categories — list all available categories
router.get('/categories', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT DISTINCT category, COUNT(*) as count FROM resources GROUP BY category ORDER BY count DESC LIMIT 200');
    res.json(rows);
  } catch (e) { logger.error('[resources/categories]', e.message); res.status(500).json({ error: 'Could not load categories' }); }
});

// GET /api/resources/:id
router.get('/:id', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get('SELECT id, name, category, description, phone, website, address, city, state, email, hours, free, eligibility, languages, updated_at FROM resources WHERE id=?', [safeInt(req.params.id)]);
    if (!row) return err404(res, 'Not found');
    const languages = (() => { try { return JSON.parse(row?.languages || '["English"]'); } catch { return ['English']; } })();
    res.json(row);
  } catch (e) { logger.error('[resources/:id]', e.message); res.status(500).json({ error: 'Could not load resource' }); }
});

export default router;
