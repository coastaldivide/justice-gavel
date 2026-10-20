import { anthropicFetch, aiHttpError, aiErrorCode } from '../../services/aiClient.js';
import { requireAi, CLAUDE_MODEL } from '../../utils/ai.js';
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

    const response = await anthropicFetch({
      body: JSON.stringify({
        model:       CLAUDE_MODEL,
        max_tokens:  800,
        messages: [{ role: 'user', content: REVIEW_PROMPT }],
      }),
    }, { route: 'motions_review', userId: req.user.id });
    if (!response.ok) throw await aiHttpError(response, 'motions_review');
    const data = await response.json();
    const raw  = data.content?.[0]?.text || '{}';
    let result;
    try {
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      logger.warn('[motions/review] JSON parse:', e?.message);
      return refuse(res, req, 502, 'review_unreadable');
    }
    return res.json({
      score: ['pass', 'warn', 'fail'].includes(result?.score) ? result.score : 'warn',
      issues: Array.isArray(result?.issues) ? result.issues.map(String) : [],
      suggestions: Array.isArray(result?.suggestions) ? result.suggestions.map(String) : [],
      missing_fields: Array.isArray(result?.missing_fields) ? result.missing_fields.map(String) : [],
    });
  } catch (e) {
    logger.error('[motions/review]', e.message);
    const code = aiErrorCode(e);
    return res.status(code === 'ai_failed' ? 500 : 503).json({ error: code, code, message: msg(resolveLang(req), `ai.job.${code}`) });
  }
});



export default router;
