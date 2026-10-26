/**
 * expungement/check.js — GET /check — what the recorded rule says about a record
 *
 * Public (guests reach it from Home), IP rate limited, no database reads.
 *
 * Query params:
 *   state   — 2-letter code of one of the 50 states or DC (required → 400 otherwise)
 *   status  — Dismissed | Convicted (Closed is the same) | Open (Still open / Pending)
 *   type    — misdemeanor | felony | dui | domestic | sexual | unknown (the app's chips);
 *             when absent the charge text is classified
 *   charges — free-text charge description (optional)
 *
 * eligibility.result:
 *   eligible | conditional | not_eligible — the rule names a statute (its source)
 *   unsourced     — the recorded rule names no statute: no verdict, the note is shown
 *                   as unreviewed general information
 *   needs_review  — the recorded rule contradicts its own note (REVIEW_FLAGS): no verdict
 *   unknown       — the charge could not be put in a category
 *   case_open     — the case has not ended; nothing can be sealed yet
 * waitYears is given only with a sourced verdict. Notes are the English text as
 * recorded (`notes_lang: 'en'`); everything else is in the request language.
 * None of it has been reviewed by a lawyer (`source.reviewed: false`).
 */

import { Router }         from 'express';
import { apiLimiter }     from '../../middleware/rateLimiters.js';
import { sanitizeStr }    from '../../utils/routeHelpers.js';
import { msg, resolveLang, stateName } from '../../i18n/index.js';
import logger             from '../../utils/logger.js';
import { STATE_RULES, REVIEW_FLAGS, RULE_EFFECTIVE_DATES, JUVENILE_SEALING_DATA, classifyCharge, citationOf, getEligibility } from './rules.js';

const router = Router();

const PARTNERS = [
  { key: 'recordseal', name: 'RecordSeal.com', url: 'https://recordseal.com/?ref=justicegavel' },
];

const TYPES = new Set(['misdemeanor', 'felony', 'dui', 'domestic', 'sexual', 'unknown']);

/** 'Dismissed' | 'Convicted' | 'Open' — anything else is null (→ 400). */
function normalizeStatus(raw) {
  const s = String(raw || 'Convicted').trim().toLowerCase().replace(/\s+/g, ' ');
  if (['dismissed', 'acquitted', 'not guilty', 'expunged'].includes(s)) return 'Dismissed';
  if (['convicted', 'closed', 'transferred'].includes(s)) return 'Convicted';
  if (['open', 'still open', 'pending'].includes(s)) return 'Open';
  return null;
}

function bad(res, lang, code) {
  return res.status(400).json({ error: msg(lang, `expungement.err.${code}`), code, message: msg(lang, `expungement.err.${code}`) });
}

router.get('/check', apiLimiter, (req, res) => {
  const lang = resolveLang(req);
  try {
    const state = sanitizeStr(String(req.query.state || ''), 3).trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(STATE_RULES, state)) return bad(res, lang, 'invalid_state');
    const status = normalizeStatus(req.query.status);
    if (!status) return bad(res, lang, 'invalid_status');
    const charges = sanitizeStr(String(req.query.charges || ''), 500).trim();
    const rawType = String(req.query.type || '').trim().toLowerCase();
    if (rawType && !TYPES.has(rawType)) return bad(res, lang, 'invalid_type');

    const chargeType = status === 'Dismissed' ? 'dismissed' : (rawType || classifyCharge(charges));
    const dates = RULE_EFFECTIVE_DATES[state] || RULE_EFFECTIVE_DATES.DEFAULT;

    let result;
    let rule = null;
    if (status === 'Open') result = 'case_open';
    else if (chargeType === 'unknown') result = 'unknown';
    else {
      rule = getEligibility(state, chargeType, status);
      if (REVIEW_FLAGS[`${state}.${chargeType}`]) result = 'needs_review';
      else if (!citationOf(rule)) result = 'unsourced';
      else result = rule.eligible === true ? 'eligible' : rule.eligible === 'conditional' ? 'conditional' : 'not_eligible';
    }
    const citation = rule ? citationOf(rule) : null;
    const verdict = ['eligible', 'conditional', 'not_eligible'].includes(result);

    res.setHeader('Vary', 'Accept-Language');
    res.json({
      state,
      stateName: stateName(state, STATE_RULES[state].name, lang),
      chargeType,
      status,
      eligibility: {
        result,
        likely:      result === 'eligible',
        conditional: result === 'conditional',
        notEligible: result === 'not_eligible',
        waitYears:   verdict && result !== 'not_eligible' && Number.isFinite(rule.waitYears) ? rule.waitYears : null,
        note:        rule?.note || null,
        citation,
      },
      notes_lang: 'en',
      source: {
        label:     citation ? msg(lang, 'expungement.source.cited', { citation }) : null,
        citation,
        recorded_at: dates.last_reviewed,
        reviewed:  false,
      },
      partners:   verdict && result !== 'not_eligible' ? PARTNERS : [],
      disclaimer: msg(lang, 'expungement.disclaimer'),
    });
  } catch (e) {
    logger.error('[expungement/check]', e.message);
    res.status(500).json({ error: msg(lang, 'expungement.err.server'), code: 'server_error' });
  }
});

/**
 * GET /juvenile?state=XX — juvenile record sealing rules (all states when no state).
 * A row's rule (automatic / when / notes) is given only when it was checked against
 * a source (status verified|corrected with citation + source_url); otherwise
 * verified: false and the rule fields are null, so the app says "not verified yet".
 * Text is English as researched (notes_lang 'en'). Not reviewed by a lawyer.
 */
router.get('/juvenile', apiLimiter, (req, res) => {
  const lang = resolveLang(req);
  const want = sanitizeStr(String(req.query.state || ''), 3).trim().toUpperCase();
  if (want && !Object.prototype.hasOwnProperty.call(JUVENILE_SEALING_DATA, want)) return bad(res, lang, 'invalid_state');
  const states = want ? [want] : Object.keys(JUVENILE_SEALING_DATA).sort();
  const rows = states.map((st) => {
    const r = JUVENILE_SEALING_DATA[st] || {};
    const ok = ['verified', 'corrected'].includes(r.status) && !!r.citation && /^https?:\/\//.test(String(r.source_url || ''));
    return {
      state: st, stateName: stateName(st, STATE_RULES[st]?.name || st, lang), verified: ok,
      automatic: ok ? !!r.automatic : null, when: ok ? r.when : null, notes: ok ? r.notes : null,
      citation: ok ? r.citation : null, source_url: ok ? r.source_url : null,
    };
  });
  res.setHeader('Vary', 'Accept-Language');
  res.json({ data: rows, notes_lang: 'en', recorded_at: '2026-10-26', reviewed: false, disclaimer: msg(lang, 'expungement.disclaimer') });
});

export default router;
