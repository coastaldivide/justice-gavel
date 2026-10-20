/**
 * discovery/analyze.js — POST /api/discovery/analyze (multipart: document, doc_type, case_id?, case_context?)
 *
 *   doc_type 'case_intake'  the case editor's "Scan document": reads the fields of a
 *                           charging document / bail slip to pre-fill a NEW case.
 *                           Free; nothing is stored.
 *   anything else           a discovery analysis ($19.99 per document, included in
 *                           Discovery Pro). Same payment flow as Quick Connect:
 *                             1. POST without payment_intent_id → 402
 *                                { code: 'payment_required', client_secret, payment_intent_id, amount_cents }
 *                             2. the app's Stripe payment sheet
 *                             3. POST again with payment_intent_id → verified with Stripe
 *                                (this user, this package, succeeded, never used before)
 *                           Without a Stripe key it is 503 payments_unavailable (never a
 *                           free analysis recorded as paid). Pro subscribers skip 1–3.
 *
 * The analysis runs as a job: the answer is { jobId } — poll GET /api/jobs/:id; the
 * job's result is the analysis (and, for discovery, it is saved to the history).
 */
import { Router } from 'express';
import { createHash } from 'crypto';
import rateLimit from 'express-rate-limit';
import { requireAi } from '../../utils/ai.js';
import { authRequired } from '../../middleware/auth.js';
import { getDb } from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { enqueueAIJob as enqueue } from '../../services/aiQueue.js';
import logger from '../../utils/logger.js';
import { uploadGuard, MB } from '../../middleware/uploads.js';
import { stripeConfigured, PAYMENTS_UNAVAILABLE } from '../../config.js';
import { stripeClient, getOrCreateStripeCustomer } from '../billing/_shared.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { hasDiscoveryPro, analyzeDocument } from './_helpers.js';

export const DISCOVERY_PRICE_CENTS = 1999;
const ALLOWED_DOC_TYPES = [
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp',
];
const uploadDocument = uploadGuard({
  maxBytes: 10 * MB,
  field: 'document',
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_DOC_TYPES.includes(file.mimetype)),
});

const say = (req, key, params) => msg(resolveLang(req), key, params);
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
  handler: (req, res) => res.status(429).json({ error: say(req, 'discovery.err.rate') }),
  validate: false,
});

const router = Router();

router.post('/analyze', aiLimiter, authRequired, requireAi, perUserAiLimit, uploadDocument, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: say(req, 'discovery.err.file_required') });
    const db = await getDb();
    const docType = String(req.body?.doc_type || '').slice(0, 60);
    const caseContext = String(req.body?.case_context || '').slice(0, 500);
    const file = { buffer: req.file.buffer, originalname: req.file.originalname || 'document', mimetype: req.file.mimetype };
    const filename = file.originalname.slice(0, 200);

    // ── free case-intake scan (nothing stored) ─────────────────────────────
    if (docType === 'case_intake') {
      const jobId = await enqueue('discovery', () => analyzeDocument(file, filename, 'case_intake', ''), req.user.id);
      return res.json({ jobId, status: 'pending', async: true });
    }

    let caseId = null;
    if (req.body?.case_id) {
      const c = await db.get('SELECT id FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [Number.parseInt(req.body.case_id, 10) || 0, req.user.id]);
      if (!c) return res.status(404).json({ error: say(req, 'case.err.not_found') });
      caseId = Number(c.id);
    }

    // ── paid analysis ──────────────────────────────────────────────────────
    const pro = await hasDiscoveryPro(db, req.user.id);
    let piId = null;
    let paidCents = 0;
    if (!pro) {
      if (!stripeConfigured()) return res.status(503).json({ ...PAYMENTS_UNAVAILABLE, message: say(req, 'discovery.err.payments_off') });
      const stripe = stripeClient();
      const sha = createHash('sha256').update(file.buffer).digest('hex');
      const given = typeof req.body?.payment_intent_id === 'string' ? req.body.payment_intent_id.trim() : '';
      if (!given) {
        const customer = await getOrCreateStripeCustomer(req.user);
        const pi = await stripe.paymentIntents.create({
          amount: DISCOVERY_PRICE_CENTS, currency: 'usd', customer: customer || undefined,
          automatic_payment_methods: { enabled: true },
          description: 'Justice Gavel — Discovery analysis',
          metadata: { user_id: String(req.user.id), package: 'discovery_analysis', file_sha256: sha, source: 'discovery' },
        });
        return res.status(402).json({
          error: say(req, 'discovery.err.payment_required'), code: 'payment_required', requires_payment: true,
          client_secret: pi.client_secret, payment_intent_id: pi.id, amount_cents: DISCOVERY_PRICE_CENTS,
        });
      }
      if (!/^pi_[A-Za-z0-9_]+$/.test(given)) return res.status(400).json({ error: say(req, 'discovery.err.payment_not_found') });
      const pi = await stripe.paymentIntents.retrieve(given).catch(() => null);
      const md = pi?.metadata || {};
      if (!pi || md.package !== 'discovery_analysis' || md.user_id !== String(req.user.id)) {
        return res.status(404).json({ error: say(req, 'discovery.err.payment_not_found') });
      }
      if (md.file_sha256 && md.file_sha256 !== sha) return res.status(409).json({ error: say(req, 'discovery.err.other_file'), code: 'different_file' });
      if (pi.status !== 'succeeded') return res.status(402).json({ error: say(req, 'discovery.err.not_paid'), code: 'payment_not_completed', status: pi.status });
      const used = await db.get('SELECT id FROM discovery_analyses WHERE stripe_pi_id = ? LIMIT 1', [pi.id]);
      if (used) return res.status(409).json({ error: say(req, 'discovery.err.payment_used'), code: 'payment_used', analysis_id: Number(used.id) });
      piId = pi.id; paidCents = pi.amount;
    }

    const userId = req.user.id;
    const jobId = await enqueue('discovery', async () => {
      const result = await analyzeDocument(file, filename, docType, caseContext);
      const db2 = await getDb();
      const row = await db2.get(
        `INSERT INTO discovery_analyses
           (user_id, filename, doc_type, case_id, summary, key_facts, inconsistencies, questions, page_count, paid_cents, stripe_pi_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        [userId, filename, result.doc_type || docType || 'Document', caseId, result.summary,
          JSON.stringify(result.key_facts || []), JSON.stringify(result.inconsistencies || []), JSON.stringify(result.questions || []),
          result.page_count || 0, paidCents, piId || (pro ? 'pro_sub_included' : null)]);
      return { ok: true, id: Number(row.id), filename, paid_cents: paidCents, included_in_pro: pro, ...result };
    }, userId);
    res.json({ jobId, status: 'pending', async: true, filename });
  } catch (e) {
    logger.error('[discovery/analyze]', e.message);
    res.status(500).json({ error: say(req, 'discovery.err.server') });
  }
});

export default router;
