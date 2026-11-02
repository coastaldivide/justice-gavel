import { aiMessage, sendAiError } from '../../services/aiClient.js';
import { requireAi } from '../../utils/ai.js';
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

    const user = `State: ${state}
County: ${county || '[COUNTY]'}
Charge type: ${charge_type}
Case number: ${case_number || '[CASE NUMBER]'}
Petitioner name: ${full_name || '[FULL NAME]'}
Year of conviction/disposition: ${conviction_year || '[YEAR]'}

Generate a complete, properly formatted petition for expungement or record sealing appropriate for ${state}, with the legal basis citing specific ${state} statutes.`;

    // Routing (class 'deep'), caching, budget, timeout/retries, refusals, metering: aiClient.
    const out = await aiMessage({
      task: 'expungement_petition',
      system: [{ text: PETITION_SYSTEM, cache: '5m' }],
      messages: [{ role: 'user', content: user }],
      route: 'expungement_petition',
      userId: req.user.id,
      timeoutMs: 120_000,
    });
    return res.json({ draft: out.text, disclaimer: msg(lang, 'expungement.petition_disclaimer') });
  } catch (e) {
    logger.error('[expungement/petition]', e.message);
    return sendAiError(res, lang, e);
  }
});

// Petition instructions (stable → prompt-cached).
const PETITION_SYSTEM = `You are an experienced criminal defense attorney generating a petition for expungement/record sealing.

IMPORTANT ELIGIBILITY DISTINCTIONS:
- If the offense occurred when the person was UNDER 18 (juvenile), juvenile expungement or
  sealing rules may apply and are often MORE FAVORABLE than adult rules. In Tennessee,
  TCA §37-1-153 allows automatic sealing of most juvenile records. Always ask the user's age at time of offense.
- Do NOT apply adult waiting periods to offenses committed as a juvenile without first
  checking state-specific juvenile record laws.

Use [PLACEHOLDER] for any required information not provided.
Include: caption, statement of facts, legal basis with specific statutes of the state named in the request, prayer for relief, verification, and certificate of service.
Format as a formal legal document.
Note at the top in ALL CAPS: THIS IS AN AI-GENERATED DRAFT — NOT REVIEWED BY AN ATTORNEY — VERIFY ALL INFORMATION AND STATUTES BEFORE FILING.`;

export default router;