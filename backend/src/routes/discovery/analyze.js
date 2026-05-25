/**
 * discovery/analyze.js — POST /analyze
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
  ensureTables, hasDiscoveryPro, analyzeDocument,
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


router.post('/analyze', aiLimiter, authRequired, perUserAiLimit, upload.single('document'), async (req, res) => {
  try {
    const db = await getDb();
    if (!req.file) return err400(res, 'PDF file required');

    const { doc_type = '', case_id, case_context = '', payment_method_id } = req.body;
    const filename    = req.file.originalname || 'document.pdf';
    const pdfBase64   = req.file.buffer.toString('base64');
    const proSub      = await hasDiscoveryPro(db, req.user.id);

    // ── Payment logic ────────────────────────────────────────────────────────
    let stripe_pi_id = null;
    let paid_cents   = 1999;

    if (proSub) {
      // Discovery Pro subscriber — analysis included
      stripe_pi_id = 'pro_sub_included';
      paid_cents   = 0;
    } else if (STRIPE_SECRET) {
      if (!payment_method_id) {
        return res.status(402).json({
          error:          'Payment required',
          code:           'payment_required',
          amount_cents:   1999,
          amount_display: '$19.99',
          or_subscribe:   'discovery_pro for $149.99/mo unlimited',
        });
      }
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(STRIPE_SECRET);
        const pi = await stripe.paymentIntents.create({
          amount:   1999,
          currency: 'usd',
          confirm:  true,
          payment_method: payment_method_id,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          description: `Justice Gavel — Discovery Analysis: ${filename}`,
          metadata:    { user_id: String(req.user.id), filename },
        });
        if (pi.status !== 'succeeded') {
          return res.status(402).json({ error: 'Payment failed', status: pi.status });
        }
        stripe_pi_id = pi.id;
      } catch (e) {
        return res.status(402).json({ error: 'Payment could not be processed. Please check your card details.' });
      }
    }

    // ── Async: enqueue analysis, return jobId immediately ────────────────────
    const _uid = req.user.id; const _fn = filename; const _dt = doc_type;
    const _cc  = case_context; const _cid = case_id;
    const _paid = paid_cents;  const _pi  = stripe_pi_id; const _pdf = pdfBase64;
    const _pro  = proSub;

    const jobId = await enqueue('discovery', async () => {
      let result;
      try {
        result = await analyzeDocument(_pdf, _fn, _dt, _cc);
      } catch (e) {
        throw new Error('Analysis failed: ' + e.message);
      }
      const db2 = await (await import('../db/index.js')).getDb();
      const row = await db2.run(
        `INSERT INTO discovery_analyses
          (user_id, filename, doc_type, case_id, summary, key_facts, inconsistencies, questions, page_count, paid_cents, stripe_pi_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          _uid, _fn,
          result.doc_type || _dt || 'Document',
          _cid || null,
          result.summary,
          JSON.stringify(result.key_facts        || []),
          JSON.stringify(result.inconsistencies  || []),
          JSON.stringify(result.questions        || []),
          result.page_count || 0,
          _paid, _pi,
        ]
      );
      return { ok: true, id: row.lastID, filename: _fn, charged: _pro ? 'Included in Discovery Pro' : '$19.99', ...result };
    });

    res.json({ jobId, status: 'pending', async: true, filename,
      message: 'Analysis queued. Poll /api/jobs/' + jobId + ' for results.' });
  } catch (e) {
    logger.error('[discovery/analyze]', e.message);
    res.status(500).json({ error: 'Analysis failed. Try again.' });
  }
});

// ── GET /api/discovery/history ────────────────────────────────────────────────

export default router;
