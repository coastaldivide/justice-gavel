/**
 * discovery/history.js — Analysis history and status
 */
import { err400, err401, err403, err404, err409, err422, err500, err502,
         safeInt, sanitizeStr } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { enqueue }        from '../../services/aiQueue.js';
import logger             from '../../utils/logger.js';
import rateLimit          from 'express-rate-limit';
import multer             from 'multer';

const upload = multer({
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      'application/pdf', 'text/plain', 'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png', 'image/webp',
    ];
    cb(null, ALLOWED.includes(file.mimetype));
  },
});
import {
  safeJsonParse, isAccepted, isPdf, isImage, isDocx, isText,
  imageMediaType, getFileExt, ACCEPTED_MIME, ACCEPTED_EXT,
  ensureTables, hasDiscoveryPro, analyzeDocument
} from './_helpers.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const STRIPE_SECRET  = process.env.STRIPE_SECRET;

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
  message: { error: 'AI rate limit reached — please wait.' },
});

const router = Router();


router.get('/history', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, filename, doc_type, case_id, page_count, paid_cents, created_at,
              substr(summary, 1, 150) as preview
       FROM discovery_analyses WHERE user_id=? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Could not load history' });
  }
});

// ── GET /api/discovery/analysis/:id ──────────────────────────────────────────
router.get('/analysis/:id', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get(
      'SELECT id, user_id, filename, doc_type, case_id, summary, key_facts, inconsistencies, questions, page_count, paid_cents, created_at FROM discovery_analyses WHERE id=? AND user_id=? LIMIT 1',
      [safeInt(req.params.id), req.user.id]
    );
    if (!row) return err404(res, 'Analysis not found');
    res.json({
      ...row,
      key_facts:       safeJsonParse(row.key_facts, []),
      inconsistencies: safeJsonParse(row.inconsistencies, []),
      questions:       safeJsonParse(row.questions, []),
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load analysis' });
  }
});

// ── DELETE /api/discovery/analysis/:id ───────────────────────────────────────
router.delete('/analysis/:id', authRequired, async (req, res) => {
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db = await getDb();
    await db.run('DELETE FROM discovery_analyses WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete' });
  }
});

// ── GET /api/discovery/status ─────────────────────────────────────────────────
router.get('/status', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const pro = await hasDiscoveryPro(db, req.user.id);
    res.json({ has_pro: pro, per_doc_price: '$19.99' });
  } catch (e) {
    logger.warn('[discovery/status]', e?.message);
    res.json({ has_pro: false, per_doc_price: '$19.99' });
  }
});



export default router;
