/**
 * billing/pi_leads.js — case leads (personal injury, civil rights, employment, ICE detention).
 * Mounted at /api/billing by billing/index.js.
 *
 *   GET  /pi-lead/fees                    flat fee per lead type (public; attorneyLeadFee.js)
 *   POST /pi-lead/submit                  a signed-in person submits their case (free)
 *   GET  /pi-leads[?state&city&case_type] attorneys: open leads — type, severity, city, state only
 *   GET  /pi-leads/mine                   attorneys: leads they bought, with the description and contact
 *   POST /pi-lead/accept/:id { ui? }      bar-verified attorneys: hold the lead for 30 minutes and start
 *                                         the payment (payment sheet / Checkout)
 *   POST /pi-lead/confirm/:id { payment_intent_id | checkout_session_id }
 *        checks the payment with Stripe, sells the lead to this attorney only, returns the details.
 *        A payment that arrives after another attorney bought the lead is refunded.
 *   POST /pi-lead/release/:id             give back a hold (payment cancelled)
 *
 * State rules (services/leadRules.js, docs/LEAD_FEE_RULES.md): a lead is listed and sold only in
 * a state that allows it; one-at-a-time card payment only where the mode is per_lead; elsewhere
 * (e.g. Tennessee) only prepaid credit packs:
 *   GET  /pi-lead/rules[?state]           the rule in force (mode, source) and the disclosure text
 *   GET  /pi-lead/credits                 attorneys: credit balance and the packs
 *   POST /pi-lead/credits/buy { pack, ui? }  start paying for a pack (fixed price per credit)
 *   POST /pi-lead/credits/confirm { payment_intent_id | checkout_session_id }  add the credits once
 *   POST /pi-lead/claim/:id               bar-verified attorneys: spend the lead type's credits; returns the details
 */
import { Router }       from 'express';
import { billingLimiter } from './_shared.js';
import { attorneyLeadFeeCents, attorneyLeadCredits, normalizeLeadType } from './attorneyLeadFee.js';
import { leadRuleFor, allowsPerLeadPayment, allowsCredits, sellableStates, LEAD_DISCLOSURE, CREDIT_PACKS, CREDIT_CENTS, STATE_LEAD_RULES } from '../../services/leadRules.js';
import { creditBalance, recordCreditPurchase, claimLeadWithCredits } from '../../services/leadCredits.js';
import { formatLeadFee } from './leadFee.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { normalizeState } from '../../services/rightsContent.js';
import { sanitizeStr } from '../../utils/sanitize.js';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger           from '../../utils/logger.js';
import { startPayment, verifyPayment, returnUrlFor, uiFrom, BillingError } from '../../services/stripeBilling.js';
import { recordCaseLead } from '../../services/leadPurchases.js';
import { billingFail } from './subscriptions.js';
import { audit, AUDIT_ACTIONS } from '../../utils/audit.js';

const router = Router();

const ATTORNEY_ROLES = new Set(['attorney', 'defender', 'admin', 'super_admin']);
const isAttorney = (u) => ATTORNEY_ROLES.has(u?.role) || Number(u?.is_defender) === 1;
function requireLeadAttorney(req, res, next) {
  if (!isAttorney(req.user)) {
    return res.status(403).json({ error: msg(resolveLang(req), 'leads.err.attorney_only'), code: 'attorney_required' });
  }
  next();
}

const LEAD_TYPES = new Set(['personal_injury', 'civil_rights', 'employment', 'medical', 'ice_detention']);
const SEVERITIES = new Set(['minor', 'moderate', 'serious', 'catastrophic']);
const HOLD_MINUTES = 30;
const OPEN_SQL = `(status = 'open' OR (status = 'reserved' AND reserved_until < NOW()))`;

router.get('/pi-lead/fees', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    fees: [...LEAD_TYPES].map(t => ({ lead_type: t, fee_cents: attorneyLeadFeeCents(t), fee_display: formatLeadFee(attorneyLeadFeeCents(t)), credits: attorneyLeadCredits(t) })),
    model: 'flat', credit_cents: CREDIT_CENTS, disclosure: LEAD_DISCLOSURE,
  });
});

router.get('/pi-lead/rules', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.query.state) {
    const st = normalizeState(req.query.state);
    if (!st) return res.status(400).json({ error: msg(resolveLang(req), 'bondsman.err.bad_state'), code: 'bad_state' });
    return res.json({ rule: leadRuleFor(st), disclosure: LEAD_DISCLOSURE });
  }
  res.json({
    rules: Object.keys(STATE_LEAD_RULES).sort().map(st => leadRuleFor(st)),
    default: leadRuleFor('ZZ'), sellable_states: sellableStates(), disclosure: LEAD_DISCLOSURE,
  });
});

// The person's name / phone / e-mail are NOT stored on the lead: an attorney sees
// type, severity, city and state only, and gets the description and the person's
// account contact details only after a completed purchase.
router.post('/pi-lead/submit', billingLimiter, authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const caseType = normalizeLeadType(b.case_type);
    const description = typeof b.description === 'string' ? sanitizeStr(b.description, 5000).trim() : '';
    const severity = SEVERITIES.has(String(b.severity)) ? String(b.severity) : 'moderate';
    const state = normalizeState(b.state);
    const city = typeof b.city === 'string' ? sanitizeStr(b.city, 100).trim() || null : null;
    const incidentDate = typeof b.incident_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.incident_date) ? b.incident_date : null;
    if (!LEAD_TYPES.has(caseType)) return res.status(400).json({ error: msg(lang, 'pilead.err.bad_type'), code: 'bad_type' });
    if (description.length < 20) return res.status(400).json({ error: msg(lang, 'pilead.err.short'), code: 'description_too_short' });
    if (!state) return res.status(400).json({ error: msg(lang, 'pilead.err.state'), code: 'state_required' });

    const db = await getDb();
    const fee = attorneyLeadFeeCents(caseType);
    const r = await db.run(
      `INSERT INTO pi_leads (user_id, case_type, incident_date, description, severity, city, state, lead_fee_cents, status)
       VALUES (?,?,?,?,?,?,?,?, 'open')`,
      [req.user.id, caseType, incidentDate, description, severity, city, state, fee]
    );
    const lead = await db.get('SELECT id, case_type, incident_date, severity, city, state, lead_fee_cents, status, created_at FROM pi_leads WHERE id=? LIMIT 1', [r.lastID]);
    res.status(201).json({ ok: true, lead_id: r.lastID, lead: { ...lead, lead_fee_display: formatLeadFee(fee) }, message: msg(lang, 'pilead.submitted') });
  } catch (e) {
    logger.error('[pi-lead/submit]', e.message);
    res.status(500).json({ error: msg(lang, 'pilead.err.failed'), code: 'server_error' });
  }
});

/** Non-identifying fields an attorney sees before buying. */
const publicLead = (r) => {
  const mode = leadRuleFor(r.state).mode;
  return {
    id: Number(r.id), case_type: r.case_type, severity: r.severity, city: r.city, state: r.state,
    lead_fee_cents: Number(r.lead_fee_cents), lead_fee_display: formatLeadFee(Number(r.lead_fee_cents)), created_at: r.created_at,
    credits: attorneyLeadCredits(r.case_type), pay_by_card: mode === 'per_lead', rule_mode: mode,
  };
};

router.get('/pi-leads', authRequired, requireLeadAttorney, async (req, res) => {
  try {
    const db = await getDb();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    // Only states whose rules allow selling leads (services/leadRules.js).
    const sellable = sellableStates();
    let sql = `SELECT id, case_type, severity, city, state, lead_fee_cents, created_at FROM pi_leads
                WHERE ${OPEN_SQL} AND COALESCE(user_id, 0) <> ? AND state = ANY(?::text[])`;
    const params = [req.user.id, sellable];
    if (req.query.state) {
      const st = normalizeState(req.query.state);
      if (!st) return res.status(400).json({ error: msg(resolveLang(req), 'bondsman.err.bad_state'), code: 'bad_state' });
      sql += ' AND state = ?'; params.push(st);
    }
    if (req.query.city) { sql += ' AND LOWER(city) = LOWER(?)'; params.push(String(req.query.city).slice(0, 100)); }
    if (req.query.case_type) { sql += ' AND case_type = ?'; params.push(normalizeLeadType(req.query.case_type)); }
    sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
    params.push(limit);
    const rows = await db.all(sql, params);
    res.setHeader('X-Lead-Disclosure', encodeURIComponent(LEAD_DISCLOSURE));
    res.json(rows.map(publicLead));
  } catch (e) { billingFail(req, res, e); }
});

router.get('/pi-leads/mine', authRequired, requireLeadAttorney, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT pl.id, pl.case_type, pl.incident_date, pl.description, pl.severity, pl.city, pl.state,
              pl.lead_fee_cents, pl.accepted_at,
              u.display_name AS contact_name, u.email AS contact_email, u.phone AS contact_phone
         FROM pi_leads pl LEFT JOIN users u ON u.id = pl.user_id
        WHERE pl.accepted_by = ? AND pl.status = 'accepted'
          -- only a purchase verified with Stripe (recordCaseLead stores the PaymentIntent);
          -- legacy rows "accepted" without a payment never reveal the person
          AND ((pl.stripe_pi_id IS NOT NULL AND pl.stripe_pi_id NOT LIKE 'pi_demo%' AND pl.stripe_pi_id NOT LIKE 'pi_mock%')
               OR pl.credit_entry_id IS NOT NULL)
        ORDER BY pl.accepted_at DESC LIMIT 100`, [req.user.id]);
    res.json({ leads: rows.map(r => ({ ...r, id: Number(r.id), lead_fee_cents: Number(r.lead_fee_cents) })) });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/pi-lead/accept/:id', billingLimiter, authRequired, requireLeadAttorney, async (req, res) => {
  const lang = resolveLang(req);
  if (Number(req.user.bar_verified) !== 1 && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: msg(lang, 'leads.err.bar_verification'), code: 'bar_verification_required' });
  }
  const leadId = Number.parseInt(req.params.id, 10);
  try {
    if (!Number.isSafeInteger(leadId) || leadId <= 0) throw new BillingError(404, 'lead_not_found');
    const db = await getDb();
    const where = await db.get('SELECT state FROM pi_leads WHERE id = ?', [leadId]);
    if (!where) throw new BillingError(404, 'lead_not_found');
    // One-at-a-time card payment only where the state's rule is per_lead; credit packs elsewhere.
    if (!allowsPerLeadPayment(where.state)) {
      const rule = leadRuleFor(where.state);
      throw new BillingError(403, allowsCredits(where.state) ? 'per_lead_not_allowed' : 'leads_not_sold_in_state', { state: rule.state, mode: rule.mode });
    }
    const hold = await db.run(
      `UPDATE pi_leads SET status = 'reserved', accepted_by = ?, reserved_until = NOW() + make_interval(mins => ?), updated_at = NOW()
        WHERE id = ? AND COALESCE(user_id, 0) <> ? AND (${OPEN_SQL} OR (status = 'reserved' AND accepted_by = ?))`,
      [req.user.id, HOLD_MINUTES, leadId, req.user.id, req.user.id]);
    if (!hold.changes) {
      const cur = await db.get('SELECT status, accepted_by FROM pi_leads WHERE id = ?', [leadId]);
      if (cur?.status === 'accepted' && Number(cur.accepted_by) === Number(req.user.id)) throw new BillingError(409, 'lead_owned');
      throw new BillingError(cur ? 409 : 404, cur ? 'lead_taken' : 'lead_not_found');
    }
    const lead = await db.get('SELECT id, case_type, lead_fee_cents FROM pi_leads WHERE id = ?', [leadId]);
    // The fee is the lead type's flat fee as of now (never a stored or client value).
    const cents = attorneyLeadFeeCents(lead.case_type);
    try {
      const out = await startPayment({
        user: req.user, cents,
        description: `Justice Gavel — case lead #${lead.id}`,
        metadata: { package: 'case_lead', lead_id: String(lead.id) },
        ui: uiFrom(req.body), returnUrl: returnUrlFor(req, req.body?.return_path || '/attorney-dashboard'),
      });
      res.json({ ...out, hold_minutes: HOLD_MINUTES, lead_fee_display: formatLeadFee(cents) });
    } catch (e) {
      await db.run(`UPDATE pi_leads SET status = 'open', accepted_by = NULL, reserved_until = NULL WHERE id = ? AND status = 'reserved' AND accepted_by = ?`, [leadId, req.user.id]);
      throw e;
    }
  } catch (e) { billingFail(req, res, e); }
});

router.post('/pi-lead/confirm/:id', billingLimiter, authRequired, requireLeadAttorney, async (req, res) => {
  const leadId = Number.parseInt(req.params.id, 10);
  try {
    const pi = await verifyPayment({
      user: req.user, pkg: 'case_lead',
      paymentIntentId: typeof req.body?.payment_intent_id === 'string' ? req.body.payment_intent_id.trim() : null,
      checkoutSessionId: typeof req.body?.checkout_session_id === 'string' ? req.body.checkout_session_id.trim() : null,
      match: (md) => md.lead_id === String(leadId),
    });
    const db = await getDb();
    const out = await recordCaseLead(db, { attorneyId: req.user.id, leadId, pi });
    if (!out.lead) {
      throw new BillingError(409, out.owned ? 'lead_owned_refunded' : 'lead_taken_refunded');
    }
    if (out.created) await audit(AUDIT_ACTIONS.LEAD_PURCHASED, { userId: req.user.id, req, entityType: 'case_lead', entityId: leadId, metadata: { amount_cents: pi.amount } });
    res.json({ ok: true, lead: out.lead, payment_intent: pi.id });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/pi-lead/release/:id', billingLimiter, authRequired, requireLeadAttorney, async (req, res) => {
  const leadId = Number.parseInt(req.params.id, 10);
  try {
    const db = await getDb();
    await db.run(`UPDATE pi_leads SET status = 'open', accepted_by = NULL, reserved_until = NULL, updated_at = NOW()
                   WHERE id = ? AND status = 'reserved' AND accepted_by = ?`, [Number.isSafeInteger(leadId) ? leadId : 0, req.user.id]);
    res.json({ ok: true });
  } catch (e) { billingFail(req, res, e); }
});

// ── Credit packs ──────────────────────────────────────────────────────────────
const packList = () => Object.entries(CREDIT_PACKS).map(([key, p]) => ({ key, credits: p.credits, cents: p.cents, display: formatLeadFee(p.cents) }));

router.get('/pi-lead/credits', authRequired, requireLeadAttorney, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ balance: await creditBalance(await getDb(), req.user.id), credit_cents: CREDIT_CENTS, packs: packList(), disclosure: LEAD_DISCLOSURE });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/pi-lead/credits/buy', billingLimiter, authRequired, requireLeadAttorney, async (req, res) => {
  try {
    const key = String(req.body?.pack || '');
    const pack = Object.prototype.hasOwnProperty.call(CREDIT_PACKS, key) ? CREDIT_PACKS[key] : null;
    if (!pack) throw new BillingError(400, 'bad_pack');
    const out = await startPayment({
      user: req.user, cents: pack.cents,
      description: `Justice Gavel — ${pack.credits} lead credits`,
      metadata: { package: 'lead_credits', pack: key, credits: String(pack.credits) },
      ui: uiFrom(req.body), returnUrl: returnUrlFor(req, req.body?.return_path || '/attorney-dashboard'),
    });
    res.json({ ...out, pack: key, credits: pack.credits });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/pi-lead/credits/confirm', billingLimiter, authRequired, requireLeadAttorney, async (req, res) => {
  try {
    const pi = await verifyPayment({
      user: req.user, pkg: 'lead_credits',
      paymentIntentId: typeof req.body?.payment_intent_id === 'string' ? req.body.payment_intent_id.trim() : null,
      checkoutSessionId: typeof req.body?.checkout_session_id === 'string' ? req.body.checkout_session_id.trim() : null,
    });
    const db = await getDb();
    const out = await recordCreditPurchase(db, { attorneyId: req.user.id, pi });
    if (out.created) await audit(AUDIT_ACTIONS.LEAD_PURCHASED, { userId: req.user.id, req, entityType: 'lead_credits', entityId: null, metadata: { amount_cents: pi.amount, credits: out.credits } });
    res.json({ ok: true, added: out.created ? out.credits : 0, balance: await creditBalance(db, req.user.id) });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/pi-lead/claim/:id', billingLimiter, authRequired, requireLeadAttorney, async (req, res) => {
  const lang = resolveLang(req);
  if (Number(req.user.bar_verified) !== 1 && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: msg(lang, 'leads.err.bar_verification'), code: 'bar_verification_required' });
  }
  const leadId = Number.parseInt(req.params.id, 10);
  try {
    if (!Number.isSafeInteger(leadId) || leadId <= 0) throw new BillingError(404, 'lead_not_found');
    const db = await getDb();
    const out = await claimLeadWithCredits(db, { attorneyId: req.user.id, leadId });
    await audit(AUDIT_ACTIONS.LEAD_PURCHASED, { userId: req.user.id, req, entityType: 'case_lead', entityId: leadId, metadata: { credits: out.credits, paid_with: 'credits' } });
    res.json({ ok: true, lead: out.lead, credits_spent: out.credits, balance: out.balance });
  } catch (e) { billingFail(req, res, e); }
});

export default router;
