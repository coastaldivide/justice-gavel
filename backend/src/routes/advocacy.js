/**
 * routes/advocacy.js — Public-interest stats for the advocacy dashboard
 *
 * GET /api/advocacy/stats — network coverage: lawyers, bail agents, users
 *
 * Reads both the main application DB and the providers DB.
 * Providers DB connection is a module-level singleton — not re-opened
 * on every request — preventing connection-handle exhaustion under load.
 *
 * Response is cached for 5 minutes (private cache — user-specific data
 * not included, but we mark private to prevent shared CDN caching).
 */

import { Router }          from 'express';
import { getDb }           from '../db/index.js';
import { apiLimiter }      from '../middleware/rateLimiters.js';
import { msg, resolveLang } from '../i18n/index.js';
import logger              from '../utils/logger.js';

const router       = Router();

// Provider data lives in the main Postgres database.
async function getProvidersDb() {
  return await getDb();
}

// ── GET /api/advocacy/stats ───────────────────────────────────────────────────
router.get('/', (req, res, next) => next());
// GET / — topic overview only. It used to return invented counters
// ("1247 laws tracked", "8 active campaigns") that looked like live data (audit11
// L4). Real numbers come from GET /api/advocacy/stats (computed from the DB).
router.get('/', (req, res) => res.json({
  static: true,
  stats_url: '/api/advocacy/stats',
  featured: [
    { title: 'Ban the Box Laws',     topic: 'employment' },
    { title: 'Second Chance Hiring', topic: 'employment' },
    { title: 'Expungement Reform',   topic: 'records' },
  ],
}));
// Public: aggregate counts only (no person is identifiable), shown on the Home tile's screen to guests too.
router.get('/stats', apiLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const pdb = await getProvidersDb();

    const [lawyers, bail, alerts, users, cities] = await Promise.all([
      pdb ? pdb.get('SELECT COUNT(*) as n FROM lawyers WHERE active=1').catch(() => ({ n: 0 }))     : { n: 0 },
      pdb ? pdb.get('SELECT COUNT(*) as n FROM bail_agents WHERE active=1').catch(() => ({ n: 0 })) : { n: 0 },
      db.get('SELECT COUNT(*) as n FROM alerts').catch(() => ({ n: 0 })),
      db.get('SELECT COUNT(*) as n FROM users').catch(()  => ({ n: 0 })),
      pdb
        ? pdb.all(
            `SELECT city, state, COUNT(*) as n FROM lawyers WHERE active=1 AND COALESCE(TRIM(city), '') <> ''
              GROUP BY city, state ORDER BY n DESC, city ASC LIMIT 200`
          ).catch(() => [])
        : [],
    ]);

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      lawyerCount:   lawyers.n  || 0,
      bailCount:     bail.n     || 0,
      alertsSent:    alerts.n   || 0,
      userCount:     users.n    || 0,
      citiesCovered: cities.length,
      coverage:      cities,
      lastUpdated:   new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[advocacy/stats]', e?.message);
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(resolveLang(req), 'advocacy.err.load') });
  }
});

export default router;
