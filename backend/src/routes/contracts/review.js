/**
 * contracts/review.js — Contract review and redline
 *
 * POST /api/contracts/review        — AI risk analysis of a contract (upload or text)
 * GET  /api/contracts/review/history — past reviews
 * GET  /api/contracts/review/:id    — get a specific review
 * POST /api/contracts/redline       — compare two contract versions
 * GET  /api/contracts/redline/:id   — get a specific redline
 * POST /api/contracts/:id/negotiate — generate negotiation strategy
 */

import { err400, err404, err500, safeInt,
         sanitizeStr, truncateStr }          from '../../utils/routeHelpers.js';
import { Router }                             from 'express';
import { authRequired }                       from '../../middleware/auth.js';
import { getDb }                              from '../../db/index.js';
import { perUserAiLimit }                     from '../../middleware/sharedAiLimiter.js';
import { makeUserLimiter }                    from '../../middleware/sharedAiLimiter.js';
import { enqueue }                            from '../../services/aiQueue.js';
import logger                                 from '../../utils/logger.js';
import multer                                 from 'multer';
import { ensureTables, reviewContract,
         redlineContracts, negotiationPoints,
         hasContractPro }                     from './_helpers.js';

const router = Router();

// Rate limiters
const reviewLimiter    = makeUserLimiter({ windowMs: 3_600_000, max: 15, message: 'Contract review limit reached.' });
const redlineLimiter   = makeUserLimiter({ windowMs: 3_600_000, max: 10, message: 'Redline limit reached.' });
const negotiateLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 20, message: 'Negotiation strategy limit reached.' });

// File upload: accept PDF, DOCX, and plain text (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'].includes(file.mimetype)
               || file.originalname.match(/\.(pdf|docx|txt)$/i);
    cb(ok ? null : new Error('Only PDF, DOCX, and TXT files are accepted'), ok);
  },
});

// ── POST /api/contracts/review — risk analysis ────────────────────────────────
router.post('/review', authRequired, reviewLimiter, perUserAiLimit,
  upload.single('contract'), async (req, res) => {
  try {
    const db = await getDb();
    // Accept file upload OR raw text body
    let contractText = '';
    let filename     = null;

    if (req.file) {
      filename     = req.file.originalname;
      contractText = req.file.buffer.toString('utf-8').slice(0, 15000);
    } else if (req.body.contract_text) {
      contractText = truncateStr(String(req.body.contract_text), 15000);
    } else {
      return err400(res, 'Provide a contract file or contract_text in the request body.');
    }

    const { contract_type, party_represented, contract_id } = req.body || {};

    const _uid   = req.user.id;
    const _text  = contractText;
    const _type  = contract_type ? sanitizeStr(contract_type, 50) : null;
    const _party = party_represented ? truncateStr(sanitizeStr(party_represented, 100), 100) : null;
    const _cid   = contract_id ? safeInt(contract_id) : null;
    const _fn    = filename;

    const jobId = await enqueue('contract_review', async () => {
      const result = await reviewContract(_text, _type, _party);

      const db2 = await getDb();
      const row = await db2.run(
        `INSERT INTO contract_reviews
          (user_id, contract_id, filename, risk_level, summary, red_flags,
           missing_clauses, recommendations, favorable_terms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          _uid, _cid, _fn,
          result.risk_level || 'medium',
          result.summary || '',
          JSON.stringify(result.red_flags          || []),
          JSON.stringify(result.missing_clauses    || []),
          JSON.stringify(result.recommendations    || []),
          JSON.stringify(result.favorable_terms    || []),
        ]
      );

      return { ok: true, id: row.lastID, ...result };
    });

    res.json({ jobId, status: 'pending', async: true,
      message: `Review queued. Poll /api/jobs/${jobId} for results.` });
  } catch (e) {
    logger.error('[contracts/review]', e.message);
    res.status(500).json({ error: 'Contract review failed. Please try again.' });
  }
});

// ── GET /api/contracts/review/history ─────────────────────────────────────────
router.get('/review/history', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT id, contract_id, filename, risk_level, summary, created_at
       FROM contract_reviews WHERE user_id=? ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    logger.error('[contracts/review/history]', e.message);
    res.status(500).json({ error: 'Could not load review history.' });
  }
});

// ── GET /api/contracts/review/:id ─────────────────────────────────────────────
router.get('/review/:id', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get(
      'SELECT id, user_id, contract_id, filename, risk_level, summary, red_flags, missing_clauses, recommendations, favorable_terms, paid_cents, created_at FROM contract_reviews WHERE id=? AND user_id=? LIMIT 1',
      [safeInt(req.params.id), req.user.id]
    );
    if (!row) return err404(res, 'Review not found.');

    // Parse JSON arrays
    for (const f of ['red_flags','missing_clauses','recommendations','favorable_terms']) {
      try { row[f] = JSON.parse(row[f]); } catch { row[f] = []; }
    }
    res.json(row);
  } catch (e) {
    logger.error('[contracts/review/get]', e.message);
    res.status(500).json({ error: 'Could not load review.' });
  }
});

// ── POST /api/contracts/redline — compare two versions ────────────────────────
router.post('/redline', authRequired, redlineLimiter, perUserAiLimit,
  upload.fields([{ name: 'original', maxCount: 1 }, { name: 'revised', maxCount: 1 }]),
  async (req, res) => {
  try {
    const db = await getDb();
    // Accept files OR text bodies
    let originalText = '';
    let revisedText  = '';
    let filenameOrig = null;
    let filenameRev  = null;

    if (req.files?.original?.[0]) {
      filenameOrig = req.files.original[0].originalname;
      originalText = req.files.original[0].buffer.toString('utf-8');
    } else if (req.body.original_text) {
      originalText = String(req.body.original_text);
    }

    if (req.files?.revised?.[0]) {
      filenameRev = req.files.revised[0].originalname;
      revisedText = req.files.revised[0].buffer.toString('utf-8');
    } else if (req.body.revised_text) {
      revisedText = String(req.body.revised_text);
    }

    if (!originalText || !revisedText) {
      return err400(res, 'Provide both original and revised contract (as files or text).');
    }

    const _uid   = req.user.id;
    const _orig  = originalText.slice(0, 12000);
    const _rev   = revisedText.slice(0, 12000);
    const _forig = filenameOrig;
    const _frev  = filenameRev;
    const _cid   = req.body.contract_id ? safeInt(req.body.contract_id) : null;

    const jobId = await enqueue('contract_redline', async () => {
      const result = await redlineContracts(_orig, _rev);

      const db2 = await getDb();
      const row = await db2.run(
        `INSERT INTO contract_redlines
          (user_id, contract_id, filename_original, filename_revised, changes, summary, risk_delta)
         VALUES (?,?,?,?,?,?,?)`,
        [_uid, _cid, _forig, _frev, JSON.stringify(result.changes || []),
         result.summary || '', result.risk_delta || 'neutral']
      );

      return { ok: true, id: row.lastID, ...result };
    });

    res.json({ jobId, status: 'pending', async: true,
      message: `Redline queued. Poll /api/jobs/${jobId} for results.` });
  } catch (e) {
    logger.error('[contracts/redline]', e.message);
    res.status(500).json({ error: 'Redline comparison failed. Please try again.' });
  }
});

// ── GET /api/contracts/redline/:id ────────────────────────────────────────────
router.get('/redline/:id', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get(
      'SELECT id, user_id, contract_id, filename_original, filename_revised, changes, summary, risk_delta, created_at FROM contract_redlines WHERE id=? AND user_id=? LIMIT 1',
      [safeInt(req.params.id), req.user.id]
    );
    if (!row) return err404(res, 'Redline not found.');
    try { row.changes = JSON.parse(row.changes); } catch { row.changes = []; }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: 'Could not load redline.' });
  }
});

// ── POST /api/contracts/:id/negotiate — generate negotiation strategy ─────────
router.post('/:id/negotiate', authRequired, negotiateLimiter, perUserAiLimit, async (req, res) => {
  try {
    const db  = await getDb();
    const contract = await db.get(
      'SELECT id, user_id, contract_type, title, party_a, party_b, fields, draft, status, execution_date, expiry_date, renewal_date, value_cents, paid_cents, created_at, updated_at FROM contracts WHERE id=? AND user_id=? LIMIT 1',
      [safeInt(req.params.id), req.user.id]
    );
    if (!contract) return err404(res, 'Contract not found.');

    const { party_represented, priorities = [] } = req.body || {};
    if (!party_represented) return err400(res, 'party_represented is required (whose side are you on?)');

    const _draft  = contract.draft;
    const _party  = truncateStr(sanitizeStr(String(party_represented), 100), 100);
    const _prios  = Array.isArray(priorities) ? priorities.slice(0,10).map(p => sanitizeStr(String(p),100)) : [];

    const jobId = await enqueue('contract_negotiate', async () => {
      return negotiationPoints(_draft, _party, _prios);
    });

    res.json({ jobId, status: 'pending', async: true,
      message: `Negotiation strategy queued. Poll /api/jobs/${jobId} for results.` });
  } catch (e) {
    logger.error('[contracts/negotiate]', e.message);
    res.status(500).json({ error: 'Could not generate negotiation strategy.' });
  }
});

export default router;
