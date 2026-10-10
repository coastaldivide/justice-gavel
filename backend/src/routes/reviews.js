import { validate, createReviewSchema } from '../validation/schemas.js';
/**
 * routes/reviews.js — Provider reviews and ratings (Postgres `reviews` table)
 *
 * GET  /api/reviews            — list reviews for an entity
 * POST /api/reviews            — submit a review (auth required)
 * GET  /api/reviews/summary    — aggregate rating + top reviews
 *
 * NOTE: app reviews never overwrite the verified provider rows in `lawyers` /
 * `bail_agents`; aggregates are computed from `reviews` on read.
 */

import { err400, sanitizeStr, truncateStr, safeInt } from '../utils/routeHelpers.js';
import { makeUserLimiter }                   from '../middleware/sharedAiLimiter.js';
import logger                                from '../utils/logger.js';
import { Router }                            from 'express';
import { authRequired }                      from '../middleware/auth.js';
import { getDb }                             from '../db/index.js';

const router         = Router();
const reviewsLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 5, message: 'Review limit reached — you can submit 5 reviews per hour.' });

const VALID_ENTITY_TYPES = new Set(['lawyer', 'bail_agent', 'attorney']);
const REVIEW_COLS = 'id, entity_type, entity_id, rating, comment, anonymous, verified, created_at';

// ── GET /api/reviews ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    const limit  = Math.min(Math.max(safeInt(req.query.limit, 20), 1), 100);
    const offset = Math.max(safeInt(req.query.offset, 0), 0);
    if (!entity_type || !entity_id) {
      return err400(res, 'entity_type and entity_id required.');
    }
    if (!VALID_ENTITY_TYPES.has(entity_type)) {
      return err400(res, `entity_type must be one of: ${[...VALID_ENTITY_TYPES].join(', ')}.`);
    }
    const d = await getDb();
    const rows = await d.all(
      `SELECT ${REVIEW_COLS} FROM reviews WHERE entity_type=? AND entity_id=? ORDER BY id DESC LIMIT ? OFFSET ?`,
      [entity_type, safeInt(entity_id), limit, offset]
    );
    res.json({ reviews: rows, pagination: { limit, offset, count: rows.length } });
  } catch (e) {
    logger.error('[reviews/list]', e.message);
    res.status(500).json({ error: 'Could not load reviews.' });
  }
});

// ── POST /api/reviews ─────────────────────────────────────────────────────────
router.post('/', authRequired, validate(createReviewSchema), reviewsLimiter, async (req, res) => {
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

    const d = await getDb();
    const entityId = safeInt(entity_id);
    if (!entityId) return err400(res, 'entity_id must be a number.');

    // One review per user per entity
    const existing = await d.get('SELECT id FROM reviews WHERE user_id=? AND entity_type=? AND entity_id=?', [req.user.id, entity_type, entityId]);
    if (existing) return res.status(409).json({ error: 'You have already reviewed this.', code: 'duplicate_review' });

    const r = await d.run(
      `INSERT INTO reviews (user_id, entity_type, entity_id, provider_id, rating, comment, verified, anonymous)
       VALUES (?,?,?,?,?,?,1,?)`,
      [req.user.id, entity_type, entityId, entityId, safeRating, safeComment, anonymous ? 1 : 0]
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

    const d = await getDb();
    const safeType = sanitizeStr(entity_type, 30);
    const safeId   = safeInt(entity_id);

    const [agg, top] = await Promise.all([
      d.get(
        'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE entity_type=? AND entity_id=?',
        [safeType, safeId]
      ),
      d.all(
        `SELECT rating, comment, anonymous, created_at FROM reviews
         WHERE entity_type=? AND entity_id=? AND comment != ''
         ORDER BY id DESC LIMIT 2`,
        [safeType, safeId]
      ),
    ]);

    res.json({
      avg_rating:  agg?.avg_rating ? Math.round(parseFloat(agg.avg_rating) * 10) / 10 : null,
      count:       Number(agg?.count || 0),
      top_reviews: top || [],
    });
  } catch (e) {
    logger.error('[reviews/summary]', e.message);
    res.status(500).json({ error: 'Could not load review summary.' });
  }
});

export default router;
