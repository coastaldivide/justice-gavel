/**
 * forum.js — Community Q&A forum
 * GET  /      — list posts (paginated, filterable by category)
 * POST /      — create post (auth required)
 * GET  /:id   — single post
 * POST /:id/upvote — upvote a post
 */
import { Router }      from 'express';
import { db }          from '../db/index.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import { safeInt, sanitizeStr, LIMITS } from '../utils/routeHelpers.js';
import logger          from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user

const router = Router();

// GET /api/forum — list posts
router.get('/', optionalAuth, (req, res) => {
  try {
    const category = sanitizeStr(req.query.category || '');
    const page     = safeInt(req.query.page, 1);
    const limit    = Math.min(safeInt(req.query.limit, 20), 50);
    const offset   = (page - 1) * limit;

    const where = category ? 'WHERE category = ?' : '';
    const params = category ? [category, limit, offset] : [limit, offset];

    const posts = db.prepare(`
      SELECT id, category, title, body, upvotes, is_pinned, is_ai, created_at
      FROM forum_posts ${where}
      ORDER BY is_pinned DESC, upvotes DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params);

    const total = db.prepare(`SELECT COUNT(*) as n FROM forum_posts ${where}`)
                    .get(...(category ? [category] : [])).n;

    res.json({ posts, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('[forum] GET /', err.message);
    res.status(500).json({ error: 'Could not load forum posts' });
  }
});

// GET /api/forum/categories — distinct categories
router.get('/categories', (req, res) => {
  try {
    const cats = db.prepare('SELECT DISTINCT category FROM forum_posts ORDER BY category').all();
    res.json(cats.map(c => c.category));
  } catch (err) {
    res.status(500).json({ error: 'Could not load categories' });
  }
});

// GET /api/forum/:id — single post
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const post = db.prepare(
      'SELECT id, category, title, body, upvotes, is_pinned, is_ai, created_at FROM forum_posts WHERE id = ?'
    ).get(safeInt(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    logger.error('[forum] GET /:id', err.message);
    res.status(500).json({ error: 'Could not load post' });
  }
});

// POST /api/forum — create post (auth required)
router.post('/', authRequired, routeLimiter, (req, res) => {
  try {
    const { category, title, body } = req.body;
    if (!category || !title || !body) return res.status(422).json({ error: 'category, title, body required' });
    const clean_title = sanitizeStr(String(title)).slice(0, 200);
    const clean_body  = sanitizeStr(String(body)).slice(0, 5000);
    const clean_cat   = sanitizeStr(String(category)).slice(0, 50);
    const result = db.prepare(
      'INSERT INTO forum_posts (user_id, category, title, body) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, clean_cat, clean_title, clean_body);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    logger.error('[forum] POST /', err.message);
    res.status(500).json({ error: 'Could not create post' });
  }
});

// POST /api/forum/:id/upvote — increment upvote
router.post('/:id/upvote', authRequired, routeLimiter, (req, res) => {
  try {
    db.prepare('UPDATE forum_posts SET upvotes = upvotes + 1 WHERE id = ?').run(safeInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error('[forum] POST /:id/upvote', err.message);
    res.status(500).json({ error: 'Upvote failed' });
  }
});

export default router;
    const postId = safeInt(req.params.id);
    if (!postId) return res.status(400).json({ error: 'Invalid post id' });
