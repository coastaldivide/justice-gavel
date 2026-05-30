/**
 * expungement/petition.js — POST /petition — AI expungement petition
 */
import { err400, err401, err403, err404, err409, err422, err500, err502,
         safeInt, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import logger             from '../../utils/logger.js';
import { STATE_RULES, DEFAULT_RULES, classifyCharge, getEligibility } from './rules.js';

const router = Router();


router.post('/petition', authRequired, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI petition generation temporarily unavailable.' });
  }
  try {
    const {
      state       = '',
      charge_type = '',
      case_number = '',
      county      = '',
      full_name   = '',
      conviction_year = '',
    } = req.body;

    if (!state || !charge_type) {
      return err400(res, 'State and charge type are required.');
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-20250514',
        temperature: 0.10,
        max_tokens:  4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data    = await response.json();
    const draft   = data.content?.[0]?.text || '';
    if (!draft) return res.status(500).json({ error: 'AI did not return a draft.' });

    return res.json({
      draft,
      disclaimer: 'This petition is AI-generated and has NOT been reviewed by a licensed attorney. Verify all statutes, deadlines, and filing requirements with your local court before filing. Errors in expungement petitions can delay or deny your request.',
    });
  } catch (e) {
    return res.status(500).json({ error: 'Petition generation failed. Please try again.' });
  }
});



export default router;