import { requireAi, CLAUDE_MODEL, ANTHROPIC_MESSAGES_URL } from '../../utils/ai.js';
/**
 * motions/review.js — Motion status updates and AI quality review
 */
import { err400, safeInt } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import logger             from '../../utils/logger.js';



const router = Router();


router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { status } = req.body;

    const valid = ['draft','filed','granted','denied','pending'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });
    }
    const filed_at = status === 'filed' ? new Date().toISOString() : null;
    await db.run(
      'UPDATE motion_history SET filing_status=?, filed_at=? WHERE id=? AND user_id=?',
      [status, filed_at, safeInt(req.params.id), req.user.id]
    );
    res.json({ updated: true, status, filed_at });
  } catch (e) { logger.error('[motions/status]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── GET /api/motions/history ──────────────────────────────────────────────────

router.post('/review', authRequired, requireAi, perUserAiLimit, async (req, res) => {
  if (!(process.env.ANTHROPIC_API_KEY ?? '')) {
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

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         (process.env.ANTHROPIC_API_KEY ?? ''),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       CLAUDE_MODEL,
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
      logger.warn('[motions/review] JSON parse:', e?.message);
      result = { score: 'warn', issues: ['Review could not be parsed.'], suggestions: [], missing_fields: [] };
    }
    return res.json(result);
  } catch (e) {
    logger.error('[motions/review]', e.message);
    return res.status(500).json({ error: 'Motion review failed. Please try again.' });
  }
});



export default router;
