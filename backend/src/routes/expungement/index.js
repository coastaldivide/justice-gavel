import { logIgnored } from '../../utils/ignored.js';
import { asyncRoute } from '../../utils/routeHelpers.js';
/**
 * expungement/index.js — Expungement module entry point
 *
 * Mounts at /api/expungement in app.js.
 *
 *   rules.js      — State eligibility data + classifyCharge/getEligibility helpers
 *   attorneys.js  — GET /attorneys
 *   check.js      — GET /check
 *   petition.js   — POST /petition (AI, requires subscription)
 */
import { Router } from 'express';
import attorneysRouter  from './attorneys.js';
import checkRouter      from './check.js';
import petitionRouter   from './petition.js';
import { authRequired }    from '../../middleware/auth.js';
import { getDb }           from '../../db/index.js';
import { getEligibility, classifyCharge, citationOf, REVIEW_FLAGS, STATE_RULES } from './rules.js';
import { msg, resolveLang } from '../../i18n/index.js';
import { parseDateOnly } from '../../utils/timezone.js';

const router = Router();
router.use('/', attorneysRouter);
router.use('/', checkRouter);
router.use('/', petitionRouter);



// ── POST /expungement/eligibility — full eligibility check with date ──────
router.post('/eligibility', authRequired, (req, res) => {
  const lang = resolveLang(req);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const state = String(b.state || '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(STATE_RULES, state)) {
    return res.status(400).json({ error: msg(lang, 'expungement.err.invalid_state'), code: 'invalid_state' });
  }
  let base = null;
  if (b.conviction_date != null && b.conviction_date !== '') {
    base = parseDateOnly(String(b.conviction_date));
    if (!base) return res.status(400).json({ error: msg(lang, 'expungement.err.invalid_date'), code: 'invalid_date' });
  }
  // One charge (string or object) or a list; a request without `charges` is one charge itself.
  const raw = b.charges == null ? [b] : (Array.isArray(b.charges) ? b.charges : [b.charges]);
  if (!raw.length || raw.length > 20) return res.status(400).json({ error: msg(lang, 'validation.failed'), code: 'validation_failed' });

  const known = ['felony', 'misdemeanor', 'dui', 'domestic', 'sexual', 'dismissed'];
  const results = raw.map((charge) => {
    const obj = charge && typeof charge === 'object' ? charge : {};
    const desc = typeof charge === 'string' ? charge : String(obj.charge || obj.description || obj.charge_type || '');
    const given = String(obj.charge_type || '').toLowerCase();
    const type = known.includes(given) ? given : classifyCharge(desc);
    const rule = type === 'unknown' ? null : getEligibility(state, type, b.dismissed ? 'Dismissed' : undefined);
    const sourced = !!rule && !!citationOf(rule.note) && !REVIEW_FLAGS[`${state}.${type}`];
    const out = {
      charge: desc.slice(0, 200) || type,
      charge_type: type,
      eligible: sourced ? rule.eligible : null,
      sourced,
      citation: rule ? citationOf(rule.note) : null,
      note: rule?.note || null,
      wait_years: sourced && rule.eligible !== false && Number.isFinite(rule.waitYears) ? rule.waitYears : null,
    };
    if (out.wait_years != null && base) {
      const until = new Date(Date.UTC(base.y + out.wait_years, base.m - 1, base.d));
      out.wait_until_date = until.toISOString().slice(0, 10);
      out.wait_days_remaining = Math.max(0, Math.ceil((until - Date.now()) / 86400000));
      out.eligible_now = out.wait_days_remaining === 0;
    }
    return out;
  });
  return res.json({
    state,
    overall_eligible: results.every(r => r.sourced && r.eligible === true),
    results,
    notes_lang: 'en',
    disclaimer: msg(lang, 'expungement.disclaimer'),
  });
});

// ── GET /expungement/petition-checklist — documents needed by state ────────
router.get('/petition-checklist', authRequired, asyncRoute((req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state.trim().toUpperCase() : '';
  if (!Object.prototype.hasOwnProperty.call(STATE_RULES, state)) {
    const lang = resolveLang(req);
    return res.status(400).json({ error: msg(lang, 'expungement.err.invalid_state'), code: 'invalid_state' });
  }

  const common = [
    'Certified copy of criminal record (from state police or court clerk)',
    'Copy of your conviction order or dismissal',
    'Government-issued photo ID',
    'Proof of completed sentence (probation certificate, discharge papers)',
    'Completed petition form (from your state court website)',
    'Filing fee payment (typically $50–$250)',
  ];

  const stateSpecific = {
    TN: ['TBI criminal history certificate', 'Petition for Expunction (TCA 40-32-101)'],
    TX: ['Texas DPS RAP sheet', 'Order of Non-Disclosure or Expunction petition'],
    FL: ['FDLE background check', 'Florida Rule 3.692 petition'],
    CA: ['PC 1203.4 petition', 'Proof of probation completion'],
    NY: ['CPL 160.50 motion (for sealed arrests)', 'Certificate of Relief from Disabilities'],
    GA: ['GCIC background report', 'Petition to restrict record'],
  };

    res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.json({
    state,
    checklist: [...common, ...(stateSpecific[state] || [])],
    note: 'Requirements vary by county. Consult with a local attorney for accuracy.',
    find_attorney: `/api/providers/lawyers?state=${state}&practice_area=expungement`,
  });

}));

// POST /api/expungement/log-visit — track that user visited ExpungementScreen
// Used by nightly scheduler to avoid re-sending expungement trigger push
router.post('/log-visit', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO expungement_check_log (user_id, source) VALUES (?, 'screen_visit')`,
      [req.user.id]
    ).catch(logIgnored('routes/expungement/index')); // Non-fatal — table may not exist in dev
    res.json({ logged: true });
  } catch { res.json({ logged: false }); }
});

export default router;

// Re-export helpers so test files and other modules can import from the index


// ── Expungement eligibility rules — all 50 states ───────────────────────────
// wait: years after sentence completion before petition allowed
// ok:   charge types that CAN be expunged
// no:   charge types that CANNOT be expunged
// Sources: NCSL Expungement/Sealing Database + individual state statutes

export { classifyCharge, getEligibility, STATE_RULES, DEFAULT_RULES } from './rules.js';