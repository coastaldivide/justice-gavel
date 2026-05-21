/**
 * routes/reviews.js — Provider reviews and ratings
 *
 * GET  /api/reviews            — list reviews for an entity
 * POST /api/reviews            — submit a review (auth required)
 * GET  /api/reviews/summary    — aggregate rating + top reviews
 *
 * Queries the providers.sqlite database (separate from the main app DB).
 * Uses a module-level singleton connection — NOT re-opened per request.
 * WAL mode enabled for better concurrent read performance.
 */

import { err400, sanitizeStr, truncateStr } from '../utils/routeHelpers.js';
import { makeUserLimiter }                   from '../middleware/sharedAiLimiter.js';
import logger                                from '../utils/logger.js';
import { Router }                            from 'express';
import { authRequired }                      from '../middleware/auth.js';
import sqlite3                               from 'sqlite3';
import { open }                              from 'sqlite';
import { fileURLToPath }                     from 'url';
import path                                  from 'path';

const router        = Router();
const reviewsLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 5, message: 'Review limit reached — you can submit 5 reviews per hour.' });

const __dirname_r  = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DB = path.resolve(__dirname_r, '../../data/providers.sqlite');

// ── Module-level singleton — one connection for the lifetime of the process ────
// Opens once on first request; reused for all subsequent requests.
// WAL mode is set on first open for better concurrent read throughput.
let _rdb = null;
async function getReviewsDb() {
  if (_rdb) return _rdb;
  try {
    _rdb = await open({ filename: PROVIDERS_DB, driver: sqlite3.Database });
    await _rdb.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    logger.info('[reviews] providers.sqlite connection opened');
  } catch (e) {
    logger.warn('[reviews] Could not open providers.sqlite:', e.message);
    _rdb = null;
  }
  return _rdb;
}

const VALID_ENTITY_TYPES = new Set(['lawyer', 'bail_agent', 'attorney']);
const REVIEW_COLS = 'id, entity_type, entity_id, rating, comment, anonymous, verified, created_at';

// ── GET /api/reviews ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id) {
      return err400(res, 'entity_type and entity_id required.');
    }
    if (!VALID_ENTITY_TYPES.has(entity_type)) {
      return err400(res, `entity_type must be one of: ${[...VALID_ENTITY_TYPES].join(', ')}.`);
    }

    const d = await getReviewsDb();
    if (!d) return res.json([]);

    const rows = await d.all(
      `SELECT ${REVIEW_COLS} FROM reviews WHERE entity_type=? AND entity_id=? ORDER BY id DESC LIMIT 50`,
      [sanitizeStr(entity_type, 30), sanitizeStr(String(entity_id), 20)]
    ).catch(() => []);

    res.json(rows);
  } catch (e) {
    logger.error('[reviews/list]', e.message);
    res.status(500).json({ error: 'Could not load reviews.' });
  }
});

// ── POST /api/reviews ─────────────────────────────────────────────────────────
router.post('/', authRequired, reviewsLimiter, async (req, res) => {
  try {
    const { entity_type, entity_id, rating, comment: rawComment = '', anonymous = 0 } = req.body || {};

    if (!entity_type || !entity_id || !rating) {
      return err400(res, 'entity_type, entity_id, and rating are required.');
    }
    if (!VALID_ENTITY_TYPES.has(entity_type)) {
      return err400(res, `entity_type must be one of: ${[...VALID_ENTITY_TYPES].join(', ')}.`);
    }

    const safeRating  = Math.max(1, Math.min(5, Number(rating) || 0));
    if (!safeRating) return err400(res, 'rating must be 1–5.');

    const safeComment = rawComment ? truncateStr(sanitizeStr(String(rawComment), 1000), 1000) : '';

    const d = await getReviewsDb();
    if (!d) return res.status(503).json({ error: 'Review service temporarily unavailable.' });

    const r = await d.run(
      `INSERT INTO reviews (entity_type, entity_id, rating, comment, verified, anonymous)
       VALUES (?,?,?,?,1,?)`,
      [
        sanitizeStr(entity_type, 30),
        sanitizeStr(String(entity_id), 20),
        safeRating,
        safeComment,
        anonymous ? 1 : 0,
      ]
    );

    const row = await d.get(
      `SELECT ${REVIEW_COLS} FROM reviews WHERE id=?`,
      [r.lastID]
    );
    res.json(row);
  } catch (e) {
    logger.error('[reviews/create]', e.message);
    res.status(500).json({ error: 'Could not save review.' });
  }
});

// ── GET /api/reviews/summary ──────────────────────────────────────────────────
// Returns aggregate rating + top 2 text reviews for attorney cards.
router.get('/summary', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id) {
      return err400(res, 'entity_type and entity_id required.');
    }

    const d = await getReviewsDb();
    if (!d) return res.json({ avg_rating: null, count: 0, top_reviews: [] });

    const safeType = sanitizeStr(entity_type, 30);
    const safeId   = sanitizeStr(String(entity_id), 20);

    const [agg, top] = await Promise.all([
      d.get(
        'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE entity_type=? AND entity_id=?',
        [safeType, safeId]
      ).catch(() => null),
      d.all(
        `SELECT rating, comment, anonymous, created_at FROM reviews
         WHERE entity_type=? AND entity_id=? AND comment != ''
         ORDER BY id DESC LIMIT 2`,
        [safeType, safeId]
      ).catch(() => []),
    ]);

    res.json({
      avg_rating:  agg?.avg_rating ? Math.round(parseFloat(agg.avg_rating) * 10) / 10 : null,
      count:       agg?.count || 0,
      top_reviews: top || [],
    });
  } catch (e) {
    logger.error('[reviews/summary]', e.message);
    res.status(500).json({ error: 'Could not load review summary.' });
  }
});

export default router;
