/**
 * routes/forum.js — Community Forum (basic CRUD)
 *
 * GET  /api/forum           — list posts
 * GET  /api/forum/categories — distinct categories
 * GET  /api/forum/:id       — single post
 * POST /api/forum           — create post (auth required)
 * POST /api/forum/:id/upvote — upvote a post
 */
import { Router }      from 'express';
import { getDb }       from '../db/index.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import { safeInt, sanitizeStr, LIMITS } from '../utils/routeHelpers.js';
import logger          from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(20, 60_000);
const router = Router();

// GET /api/forum — list posts
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db       = await getDb();
    const category = sanitizeStr(req.query.category || '', 40) || null;
    const page     = safeInt(req.query.page, 1);
    const limit    = Math.min(safeInt(req.query.limit, 20), 50);
    const offset   = (page - 1) * limit;

    const where  = category ? 'WHERE category = ?' : '';
    const params = category ? [category, limit, offset] : [limit, offset];

    const posts = await db.all(
      `SELECT id, category, title, body, upvotes, is_pinned, is_ai, created_at
       FROM forum_posts ${where}
       ORDER BY is_pinned DESC, upvotes DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    const countRow = await db.get(
      `SELECT COUNT(*) as n FROM forum_posts ${where}`,
      category ? [category] : []
    );
    const total = countRow?.n || 0;

    res.json({ posts, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('[forum] GET /', err.message);
    res.status(500).json({ error: 'Could not load forum posts' });
  }
});

// GET /api/forum/categories
router.get('/categories', async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT DISTINCT category FROM forum_posts ORDER BY category ASC'
    );
    res.json({ categories: rows.map(r => r.category) });
  } catch (err) {
    logger.error('[forum] GET /categories', err.message);
    res.status(500).json({ error: 'Could not load categories' });
  }
});

// GET /api/forum/:id
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const db   = await getDb();
    const post = await db.get(
      'SELECT * FROM forum_posts WHERE id = ?', [safeInt(req.params.id)]
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post });
  } catch (err) {
    logger.error('[forum] GET /:id', err.message);
    res.status(500).json({ error: 'Could not load post' });
  }
});

// POST /api/forum — create post
router.post('/', authRequired, routeLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const category = sanitizeStr(req.body.category || 'general', 40);
    const title    = sanitizeStr(req.body.title || '', LIMITS.TITLE || 120);
    const body_txt = sanitizeStr(req.body.body || '', LIMITS.NOTE || 2000);
    if (!title || !body_txt) return res.status(400).json({ error: 'Title and body required' });

    const result = await db.run(
      'INSERT INTO forum_posts (user_id, category, title, body) VALUES (?, ?, ?, ?)',
      [req.user.id, category, title, body_txt]
    );
    const post = await db.get('SELECT * FROM forum_posts WHERE id = ?', [result.lastID]);
    res.status(201).json({ post });
  } catch (err) {
    logger.error('[forum] POST /', err.message);
    res.status(500).json({ error: 'Could not create post' });
  }
});

// POST /api/forum/:id/upvote
router.post('/:id/upvote', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: 'Invalid post id' });
    await db.run(
      'UPDATE forum_posts SET upvotes = upvotes + 1 WHERE id = ?', [postId]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('[forum] POST /:id/upvote', err.message);
    res.status(500).json({ error: 'Upvote failed' });
  }
});

export default router;
