import { aiMessage, aiErrorCode, sendAiError } from '../../services/aiClient.js';
import { requireAi } from '../../utils/ai.js';
import { requireDisclaimer } from '../../middleware/disclaimer.js';
import { msg, resolveLang } from '../../i18n/index.js';
/**
 * motions/review.js — Motion status updates and AI quality review
 */
import { safeInt } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import logger             from '../../utils/logger.js';



const router = Router();
const refuse = (res, req, status, code) => res.status(status).json({ error: code, code, message: msg(resolveLang(req), `motions.err.${code}`) });


router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { status } = req.body;

    const valid = ['draft','filed','granted','denied','pending'];
    if (!valid.includes(status)) return refuse(res, req, 400, 'bad_status');
    const filed_at = status === 'filed' ? new Date().toISOString() : null;
    const r = await db.run(
      'UPDATE motion_history SET filing_status=?, filed_at=? WHERE id=? AND user_id=?',
      [status, filed_at, safeInt(req.params.id), req.user.id]
    );
    if (!r.changes) return refuse(res, req, 404, 'not_found');
    res.json({ updated: true, status, filed_at });
  } catch (e) { logger.error('[motions/status]', e.message); refuse(res, req, 500, 'server'); }
});

// ── GET /api/motions/history ──────────────────────────────────────────────────

router.post('/review', authRequired, requireDisclaimer, requireAi, perUserAiLimit, async (req, res) => {
  try {
    const { draft = '', motion_type = '', state = '' } = req.body || {};
    if (typeof draft !== 'string' || !draft.trim()) return refuse(res, req, 400, 'draft_required');

    // Structured output (ai/schemas motion_review): the answer is schema-checked JSON; an
    // answer that fails the schema is never shown (502 ai_invalid_output).
    const out = await aiMessage({
      task: 'motion_review',
      system: [{ text: MOTION_REVIEW_SYSTEM, cache: '5m' }],
      messages: [{ role: 'user', content: `Motion type: ${String(motion_type || 'Unknown').slice(0, 80)}
Jurisdiction: ${String(state || 'Unknown state').slice(0, 40)}

Check the caption format for ${String(state || 'the jurisdiction').slice(0, 40)}.

Draft to review:
---
${draft.slice(0, 6000)}
---` }],
      route: 'motions_review',
      userId: req.user.id,
      timeoutMs: 120_000,
    });
    const result = out.json;
    return res.json({
      score: result.score,
      issues: result.issues,
      suggestions: result.suggestions,
      missing_fields: result.missing_fields,
    });
  } catch (e) {
    logger.error('[motions/review]', e.message);
    if (aiErrorCode(e) === 'ai_invalid_output') return refuse(res, req, 502, 'review_unreadable');
    return sendAiError(res, resolveLang(req), e);
  }
});

// The review instructions (stable → prompt-cached). The JSON shape is enforced by the schema.
const MOTION_REVIEW_SYSTEM = `You are an experienced criminal defense attorney reviewing a motion draft for procedural correctness and completeness.

Answer with:
- score: "pass" (procedurally sound and ready for attorney review), "warn" (minor issues, could be filed with corrections) or "fail" (significant issues that must be addressed before filing)
- issues: specific problems found, if any
- suggestions: specific improvements recommended
- missing_fields: required fields that appear to be blank or placeholder

Check specifically for:
1. Blank or [PLACEHOLDER] fields (case number, defendant name, county, court)
2. Correct caption format for the jurisdiction
3. Proper certificate of service if required
4. Statute citations that appear complete (not truncated)
5. Argument sections that are substantive (not just headings)
6. Signature block completeness`;

export default router;
