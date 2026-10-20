import { anthropicFetch, aiHttpError, aiErrorCode } from '../../services/aiClient.js';
import { requireAi, CLAUDE_MODEL } from '../../utils/ai.js';
import { msg, resolveLang } from '../../i18n/index.js';
import logger from '../../utils/logger.js';
import { STATE_RULES } from './rules.js';
/**
 * expungement/petition.js — POST /petition — AI expungement petition
 */
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';

const router = Router();


router.post('/petition', authRequired, requireAi, perUserAiLimit, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const state = str(b.state, 3).toUpperCase();
    const charge_type = str(b.charge_type, 200);
    const case_number = str(b.case_number, 60);
    const county = str(b.county, 80);
    const full_name = str(b.full_name, 120);
    const conviction_year = str(String(b.conviction_year ?? ''), 4);
    if (!Object.prototype.hasOwnProperty.call(STATE_RULES, state) || !charge_type) {
      return res.status(400).json({ error: msg(lang, 'expungement.err.petition_fields'), code: 'validation_failed' });
    }

    const prompt = `You are an experienced criminal defense attorney generating a petition for expungement/record sealing.

State: ${state}
County: ${county || '[COUNTY]'}
Charge type: ${charge_type}
Case number: ${case_number || '[CASE NUMBER]'}
Petitioner name: ${full_name || '[FULL NAME]'}
Year of conviction/disposition: ${conviction_year || '[YEAR]'}

IMPORTANT ELIGIBILITY DISTINCTIONS:
- If the offense occurred when the person was UNDER 18 (juvenile), juvenile expungement or
  sealing rules may apply and are often MORE FAVORABLE than adult rules. In Tennessee,
  TCA §37-1-153 allows automatic sealing of most juvenile records. Always ask the user's age at time of offense.
- Do NOT apply adult waiting periods to offenses committed as a juvenile without first
  checking state-specific juvenile record laws.

Generate a complete, properly formatted petition for expungement or record sealing appropriate for ${state}.
Use [PLACEHOLDER] for any required information not provided.
Include: caption, statement of facts, legal basis with specific ${state} statutes, prayer for relief, verification, and certificate of service.
Format as a formal legal document.
Note at the top in ALL CAPS: THIS IS AN AI-GENERATED DRAFT — NOT REVIEWED BY AN ATTORNEY — VERIFY ALL INFORMATION AND STATUTES BEFORE FILING.`;

    const response = await anthropicFetch({
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         (process.env.ANTHROPIC_API_KEY ?? ''),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       CLAUDE_MODEL,
        max_tokens:  4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    }, { route: 'expungement_petition' });

    if (!response.ok) throw await aiHttpError(response, 'expungement_petition');
    const data    = await response.json();
    const draft   = data.content?.[0]?.text || '';
    if (!draft) return res.status(500).json({ error: 'ai_failed', code: 'ai_failed', message: msg(lang, 'ai.job.ai_failed') });

    return res.json({ draft, disclaimer: msg(lang, 'expungement.petition_disclaimer') });
  } catch (e) {
    logger.error('[expungement/petition]', e.message);
    const code = aiErrorCode(e);
    return res.status(code === 'ai_failed' ? 500 : 503).json({ error: code, code, message: msg(lang, `ai.job.${code}`) });
  }
});



export default router;