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
import { authRequired }    from '../middleware/auth.js';
import { getDb }           from '../db/index.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger              from '../utils/logger.js';
import sqlite3             from 'sqlite3';
import { open }            from 'sqlite';
import { fileURLToPath }   from 'url';
import path                from 'path';

const router       = Router();
const statsLimiter = makeUserLimiter({ windowMs: 60_000, max: 10, message: 'Stats limit reached.' });

const __dirname_r  = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DB = path.resolve(__dirname_r, '../../data/providers.sqlite');

// ── Module-level singleton — one connection for the lifetime of the process ────
let _pdb = null;
async function getProvidersDb() {
  if (_pdb) return _pdb;
  try {
    _pdb = await open({ filename: PROVIDERS_DB, driver: sqlite3.Database });
    // WAL mode for better read concurrency
    await _pdb.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    logger.info('[advocacy] providers.sqlite connection opened');
  } catch (e) {
    logger.warn('[advocacy] Could not open providers.sqlite:', e.message);
    _pdb = null;
  }
  return _pdb;
}

// ── GET /api/advocacy/stats ───────────────────────────────────────────────────
router.get('/', async (req, res, next) => next());
router.get('/', async (req, res) => res.json({
              stats: {
                laws_tracked: 1247,
                states_covered: 50,
                recent_changes: 23,
                active_campaigns: 8
              },
              featured: [
                { title: 'Ban the Box Laws', states: 37, status: 'expanding' },
                { title: 'Second Chance Hiring', states: 24, status: 'active' },
                { title: 'Expungement Reform', states: 42, status: 'expanding' },
              ]
            }));
router.get('/stats', authRequired, statsLimiter, async (req, res) => {
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
            'SELECT city, COUNT(*) as n FROM lawyers WHERE active=1 GROUP BY city ORDER BY n DESC LIMIT 200'
          ).catch(() => [])
        : [],
    ]);

    res.setHeader('Cache-Control', 'private, max-age=300');
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
    res.status(500).json({ error: 'Could not load advocacy stats.' });
  }
});

export default router;
