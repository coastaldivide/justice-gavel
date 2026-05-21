/**
 * motions/history.js — GET /history, GET|DELETE /history/:id
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
import { MOTION_TYPES }   from './_motion_types.js';
import { ensureTables, generateMotion } from './_helpers.js';

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
  message: { error: 'AI rate limit reached — please wait before sending another request.' },
});

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const STRIPE_SECRET = process.env.STRIPE_SECRET;

const router = Router();



router.get('/history', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const _histPage = Math.max(0, safeInt(req.query.page || '0'));
    const rows = await db.all(
      `SELECT id, motion_type, paid_cents, created_at,
              substr(draft, 1, 200) as preview
       FROM motion_history WHERE user_id=? ORDER BY created_at DESC LIMIT 20 OFFSET ${Math.max(0,safeInt(req.query.page||'0'))*20}`,
      [req.user.id]
    );
    const enriched = rows.map(r => ({
      ...r,
      label: MOTION_TYPES[r.motion_type]?.label || r.motion_type,
      icon:  MOTION_TYPES[r.motion_type]?.icon  || '📄',
    }));
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: 'Could not load history' });
  }
});

// ── GET /api/motions/history/:id ──────────────────────────────────────────────
router.get('/history/:id', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT id, user_id, motion_type, case_fields, draft, filing_status, filed_at, paid_cents, created_at FROM motion_history WHERE id=? AND user_id=? LIMIT 1',
      [safeInt(req.params.id), req.user.id]
    );
    if (!row) return err404(res, 'Motion not found');
    res.json({ ...row, case_fields: JSON.parse(row.case_fields || '{}') });
  } catch (e) {
    res.status(500).json({ error: 'Could not load motion' });
  }
});

// ── DELETE /api/motions/history/:id ──────────────────────────────────────────
router.delete('/history/:id', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM motion_history WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete motion' });
  }
});

// POST /api/motions/review — AI legal-editor review of a motion draft
// Checks: required fields, procedural correctness, statute citations, formatting.
// Returns: { issues, suggestions, score }
router.post('/review', authRequired, perUserAiLimit, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error('[motions/review] ANTHROPIC_API_KEY not set');
    return res.status(503).json({ error: 'AI review temporarily unavailable.' });
  }
  try {
    const { draft = '', motion_type = '', state = '' } = req.body;
    if (!draft.trim()) {
      return err400(res, 'Draft text is required.');
    }

    const REVIEW_PROMPT = `You are an experienced criminal defense attorney reviewing a motion draft for procedural correctness and completeness.

Motion type: ${motion_type || 'Unknown'}
Jurisdiction: ${state || 'Unknown state'}

Review the following motion draft and respond ONLY with a JSON object in this exact format:
{
  "score": "pass" | "warn" | "fail",
  "issues": ["list of specific problems found, if any"],
  "suggestions": ["list of specific improvements recommended"],
  "missing_fields": ["list of required fields that appear to be blank or placeholder"]
}

Score guide:
- "pass": motion is procedurally sound and ready for attorney review
- "warn": motion has minor issues but could be filed with corrections
- "fail": motion has significant issues that must be addressed before filing

Check specifically for:
1. Blank or [PLACEHOLDER] fields (case number, defendant name, county, court)
2. Correct caption format for ${state || 'the jurisdiction'}
3. Proper certificate of service if required
4. Statute citations that appear complete (not truncated)
5. Argument sections that are substantive (not just headings)
6. Signature block completeness

Draft to review:
---
${draft.slice(0, 6000)}
---

Respond ONLY with the JSON object. No other text.`;

    const response = await fetch(API_URLS.ANTHROPIC, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-20250514',
        temperature: 0.10,
        max_tokens:  800,
        messages: [{ role: 'user', content: REVIEW_PROMPT }],
      }),
    });
    const data = await response.json();
    const raw  = data.content?.[0]?.text || '{}';
    let result;
    try {
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      logger.warn('[motions/history/review] JSON parse:', e?.message);
      result = { score: 'warn', issues: ['Review could not be parsed.'], suggestions: [], missing_fields: [] };
    }
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: 'Motion review failed. Please try again.' });
  }
});



export default router;
