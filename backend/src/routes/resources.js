import { escapeLike, safeInt } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { getDb }   from '../db/index.js';
import logger from '../utils/logger.js';
import { msg, resolveLang } from '../i18n/index.js';
import { apiLimiter } from '../middleware/rateLimiters.js';
const router = Router();

const fail = (req, res, status, key) => res.status(status).json({ error: key, code: key, message: msg(resolveLang(req), `resources.err.${key}`) });
const COLS = 'id, title, body, url, name, category, description, phone, website, address, city, state, email, hours, free, eligibility, income_limit, languages, verified, updated_at';

// GET /api/resources — public (crisis lines, legal aid, public defenders: guests need them most)
// Query params: category, state, q (search), type, free, limit (default 1000, max 1000)
router.get('/', apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { category, state, q, type, free, limit = 1000 } = req.query;
  const qSafe = q ? escapeLike(String(q).trim(), 100) : null;

    let sql = `SELECT ${COLS} FROM resources WHERE 1=1`;
    const params = [];

    if (category)          { sql += ' AND category=?';                           params.push(category); }
    if (state)             { sql += ' AND (state=? OR state IS NULL)';           params.push(state); }
    if (type)              { sql += ' AND type=?';                               params.push(type); }
    if (free === 'true')   { sql += ' AND free=1'; }
    if (q)                 { sql += ' AND (title LIKE ? OR body LIKE ?)';        params.push(`%${qSafe}%`, `%${qSafe}%`); }

    sql += ' ORDER BY priority DESC, id ASC LIMIT ?';
    params.push(Math.min(Math.max(safeInt(limit) || 1000, 1), 1000));

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
    fail(req, res, 500, 'load');
  }
});

// GET /api/resources/categories — list all available categories
router.get('/categories', apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT DISTINCT category, COUNT(*) as count FROM resources GROUP BY category ORDER BY count DESC LIMIT 200');
    res.json(rows);
  } catch (e) { logger.error('[resources/categories]', e.message); fail(req, res, 500, 'load'); }
});

// GET /api/resources/:id
router.get('/:id', apiLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get(`SELECT ${COLS} FROM resources WHERE id=?`, [safeInt(req.params.id)]);
    if (!row) return fail(req, res, 404, 'not_found');
    res.json({ ...row, languages: (() => { try { return JSON.parse(row.languages || '["English"]'); } catch { return ['English']; } })() });
  } catch (e) { logger.error('[resources/:id]', e.message); fail(req, res, 500, 'load'); }
});

export default router;
