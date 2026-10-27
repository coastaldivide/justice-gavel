/**
 * billing/bondsman.js — bail-agent profile, the bail-lead marketplace and bail-agent plans.
 * Mounted at /api/billing by billing/index.js (POSTs other than /bondsman/profile are
 * 503 payments_unavailable without Stripe).
 *
 *   POST /bondsman/profile                bail-agent accounts: company, license, states, counties
 *   GET  /bondsman/profile
 *   GET  /leads[?county&state&hours]      recent arrests with bail set and no attorney — initials only
 *   POST /leads/:id/accept { ui? }        start buying one lead (flat fee, ./leadFee.js)
 *   POST /leads/:id/confirm { payment_intent_id | checkout_session_id }
 *        checks the payment with Stripe (this agent, this lead, succeeded), records the purchase
 *        once and returns the full record. A second payment for a lead the agent already owns is
 *        refunded automatically.
 *   GET  /bondsman/tiers                  plans: price, new-arrest alert coverage (plans.js)
 *   GET  /bondsman/subscription
 *   POST /bondsman/subscribe { tier, billing?, ui? }  → payment sheet / Checkout (nothing unlocks yet)
 *   POST /bondsman/subscription/confirm   verify with Stripe, then record
 *   POST /bondsman/subscription/change { tier }
 *   POST /bondsman/subscription/cancel    at the end of the paid period
 */
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger           from '../../utils/logger.js';
import { resolveLang, msg, LOCALES } from '../../i18n/index.js';
import { stripeConfigured } from '../../config.js';
import { visibleArrestSql, realArrestSql, isSampleColumnSql } from '../../utils/arrestVisibility.js';
import { arrestFeedsConfigured } from '../../services/arrest_ingest.js';
import { normalizeState } from '../../services/rightsContent.js';
import { billingLimiter, stripeClient, BONDSMAN_TIERS, BONDSMAN_LEAD_FEE_CENTS, formatLeadFee, bondsmanLeadFeeInfo, bondsmanCharge, usd } from './_shared.js';
import { ALL_COUNTIES, AGENT_TEXT_CENTS } from './plans.js';
import { startPayment, verifyPayment, startSubscription, changePlan, returnUrlFor, uiFrom, BillingError, periodEnd } from '../../services/stripeBilling.js';
import { recordIncomplete } from '../../services/subscriptionStore.js';
import { recordBailLead } from '../../services/leadPurchases.js';
import { billingFail, confirmPlan } from './subscriptions.js';
import { PAID_STATUSES } from '../../services/entitlements.js';
import { audit, AUDIT_ACTIONS } from '../../utils/audit.js';

const router = Router();
const say = (req, key, params) => msg(resolveLang(req), key, params);
const STAFF = new Set(['admin', 'super_admin']);
const isBailAgentAccount = (u) => u?.user_type === 'bail_agent' || u?.accountType === 'bail_agent';
const PAID_SQL = PAID_STATUSES.map(s => `'${s}'`).join(',');

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
};

/** Bail-agent accounts (users.user_type) — the profile is what unlocks the lead list (C2). */
async function loadUserType(db, userId) {
  const u = await db.get('SELECT user_type, role FROM users WHERE id = ?', [userId]);
  return u || {};
}

async function requireBondsman(req, res, next) {
  try {
    if (STAFF.has(req.user?.role)) return next();
    const db = await getDb();
    const p  = await db.get('SELECT id FROM bondsman_profiles WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (p) return next();
    return res.status(403).json({ error: say(req, 'bondsman.err.profile_required'), code: 'bondsman_profile_required' });
  } catch (e) {
    logger.error('[bondsman] requireBondsman', e?.message);
    return res.status(500).json({ error: say(req, 'billing.err.server'), code: 'server_error' });
  }
}
const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  .map(w => w[0].toUpperCase() + '.').join(' ') || '—';

/** The agent's paid bail-agent plan row, or null. */
export async function activeBondsmanPlan(db, userId) {
  return await db.get(
    `SELECT id, tier, status, stripe_sub_id, billing_period, renews_at, cancel_at_period_end
       FROM bondsman_subscriptions WHERE user_id = ? AND status IN (${PAID_SQL}) ORDER BY id DESC LIMIT 1`, [userId]);
}

// ── Profile ───────────────────────────────────────────────────────────────────
router.post('/bondsman/profile', billingLimiter, authRequired, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const company = typeof b.company_name === 'string' ? b.company_name.trim().slice(0, 200) : '';
  const license = typeof b.license_number === 'string' ? b.license_number.trim().slice(0, 60) : '';
  const licenseState = b.license_state ? normalizeState(b.license_state) : null;
  const states = [...new Set(parseList(b.states).map(normalizeState).filter(Boolean))].slice(0, 10);
  const counties = [...new Set(parseList(b.counties).map(c => String(c || '').replace(/\s+county$/i, '').trim()).filter(c => c && c.length <= 60))].slice(0, 50);
  if (!company) return res.status(400).json({ error: say(req, 'bondsman.err.company_required'), code: 'company_required' });
  if (b.license_state && !licenseState) return res.status(400).json({ error: say(req, 'bondsman.err.bad_state'), code: 'bad_state' });
  try {
    const db = await getDb();
    const existing = await db.get('SELECT id FROM bondsman_profiles WHERE user_id = ?', [req.user.id]);
    if (!existing && !STAFF.has(req.user.role)) {
      const u = await loadUserType(db, req.user.id);
      if (!isBailAgentAccount(u)) return res.status(403).json({ error: say(req, 'bondsman.err.bail_agent_only'), code: 'bail_agent_account_required' });
    }
    await db.run(
      `INSERT INTO bondsman_profiles (user_id, company_name, license_number, license_state, counties, states, state)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         company_name = excluded.company_name, license_number = excluded.license_number,
         license_state = excluded.license_state, counties = excluded.counties, states = excluded.states,
         state = excluded.state`,
      [req.user.id, company, license || null, licenseState, JSON.stringify(counties), JSON.stringify(states), states[0] || licenseState || null]);
    res.json({ success: true, message: say(req, 'bondsman.msg.profile_saved') });
  } catch (e) { billingFail(req, res, e); }
});

router.get('/bondsman/profile', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const p = await db.get(
      `SELECT id, company_name, license_number, license_state, counties, states, created_at
         FROM bondsman_profiles WHERE user_id = ?`, [req.user.id]);
    if (!p) return res.json({ profile: null });
    const plan = await activeBondsmanPlan(db, req.user.id);
    const covered = plan ? (BONDSMAN_TIERS[plan.tier]?.counties || 0) : 0;
    const counties = parseList(p.counties);
    res.json({
      profile: {
        id: Number(p.id), company_name: p.company_name, license_number: p.license_number, license_state: p.license_state,
        counties, states: parseList(p.states), created_at: p.created_at,
        alert_counties: covered >= ALL_COUNTIES ? 'all' : counties.slice(0, covered),
      },
    });
  } catch (e) { billingFail(req, res, e); }
});

// ── Lead list ─────────────────────────────────────────────────────────────────
router.get('/leads', authRequired, requireBondsman, async (req, res) => {
  const hours = Math.min(Math.max(Number.parseInt(req.query.hours, 10) || 48, 1), 87600);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  try {
    const db = await getDb();
    let state = req.query.state ? normalizeState(req.query.state) : null;
    if (req.query.state && !state) return res.status(400).json({ error: say(req, 'bondsman.err.bad_state'), code: 'bad_state' });
    if (!state && !req.query.county) {
      const p = await db.get('SELECT states, state, license_state FROM bondsman_profiles WHERE user_id = ?', [req.user.id]);
      state = parseList(p?.states)[0] || p?.state || p?.license_state || null;
    }
    const conditions = [
      visibleArrestSql('ar'),
      'COALESCE(ar.has_attorney, 0) = 0',
      'ar.bail_amount > 0',
      'ar.created_at >= (NOW() - make_interval(hours => ?))',
    ];
    const params = [hours];
    if (req.query.county) { conditions.push('LOWER(ar.county) = LOWER(?)'); params.push(String(req.query.county).replace(/\s+county$/i, '').trim().slice(0, 60)); }
    if (state) { conditions.push('ar.state = ?'); params.push(state); }
    const rows = await db.all(
      `SELECT ar.id, ar.name, ar.booking_date, ar.charges, ar.bail_amount, ar.county, ar.state, ar.jail_location,
              ${isSampleColumnSql('ar')},
              lp.id AS purchase_id
         FROM arrest_records ar
         LEFT JOIN lead_purchases lp ON lp.arrest_id = ar.id AND lp.bondsman_id = ? AND lp.status = 'charged'
        WHERE ${conditions.join(' AND ')}
        ORDER BY ar.booking_date DESC NULLS LAST, ar.id DESC
        LIMIT ?`,
      [req.user.id, ...params, limit]);
    // Before a purchase: initials, county and the charges — never the full name or the jail.
    const leads = rows.map(r => {
      const owned = !!r.purchase_id;
      return {
        id: Number(r.id), booking_date: r.booking_date, charges: r.charges, bail_amount: Number(r.bail_amount),
        county: r.county, state: r.state, is_sample: !!r.is_sample,
        name: owned ? r.name : initials(r.name), jail_location: owned ? r.jail_location : null,
        purchased: owned, lead_fee_cents: BONDSMAN_LEAD_FEE_CENTS, lead_fee_display: formatLeadFee(),
      };
    });
    res.json({ leads, count: leads.length, state, lead_fee: bondsmanLeadFeeInfo(), feeds_configured: arrestFeedsConfigured() });
  } catch (e) { billingFail(req, res, e); }
});

/** A real (not sample, not taken down) arrest with bail set, or a 400/404. */
async function buyableArrest(db, id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new BillingError(404, 'lead_not_found');
  const arrest = await db.get(
    `SELECT id, name, booking_date, charges, bail_amount, county, state, jail_location FROM arrest_records
      WHERE id = ? AND ${realArrestSql()} LIMIT 1`, [id]);
  if (!arrest) throw new BillingError(404, 'lead_not_found');
  if (!(Number(arrest.bail_amount) > 0)) throw new BillingError(400, 'lead_no_bail');
  return arrest;
}

router.post('/leads/:id/accept', billingLimiter, authRequired, requireBondsman, async (req, res) => {
  try {
    const db = await getDb();
    const arrest = await buyableArrest(db, Number(req.params.id));
    const owned = await db.get(`SELECT id FROM lead_purchases WHERE bondsman_id = ? AND arrest_id = ? AND status = 'charged' LIMIT 1`, [req.user.id, arrest.id]);
    if (owned) {
      return res.status(409).json({ error: say(req, 'billing.err.lead_owned'), code: 'already_purchased', arrest });
    }
    const out = await startPayment({
      user: req.user, cents: BONDSMAN_LEAD_FEE_CENTS,
      description: `Justice Gavel — bail lead #${arrest.id}`,
      metadata: { package: 'bail_lead', arrest_id: String(arrest.id) },
      ui: uiFrom(req.body), returnUrl: returnUrlFor(req, req.body?.return_path || '/bondsman-dashboard'),
    });
    res.json({ ...out, lead_fee_display: formatLeadFee() });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/leads/:id/confirm', billingLimiter, authRequired, requireBondsman, async (req, res) => {
  try {
    const db = await getDb();
    const arrestId = Number(req.params.id);
    const pi = await verifyPayment({
      user: req.user, pkg: 'bail_lead',
      paymentIntentId: typeof req.body?.payment_intent_id === 'string' ? req.body.payment_intent_id.trim() : null,
      checkoutSessionId: typeof req.body?.checkout_session_id === 'string' ? req.body.checkout_session_id.trim() : null,
      match: (md) => md.arrest_id === String(arrestId),
    });
    const out = await recordBailLead(db, { bondsmanId: req.user.id, arrestId, pi });
    if (!out.arrest) throw new BillingError(404, 'lead_not_found');
    if (out.created) await audit(AUDIT_ACTIONS.LEAD_PURCHASED, { userId: req.user.id, req, entityType: 'bail_lead', entityId: arrestId, metadata: { amount_cents: pi.amount } });
    if (out.refunded) {
      return res.status(409).json({ error: say(req, 'billing.err.lead_owned_refunded'), code: 'already_purchased_refunded', arrest: out.arrest });
    }
    res.json({ success: true, fee_charged: usd(pi.amount), arrest: out.arrest });
  } catch (e) { billingFail(req, res, e); }
});

// ── Bail-agent plans ──────────────────────────────────────────────────────────
router.get('/bondsman/tiers', (req, res) => {
  const tiers = Object.entries(BONDSMAN_TIERS).map(([key, t]) => ({
    key, name: t.name, display: t.display, monthly_cents: t.monthly_cents,
    annual_cents: t.annual_cents, annual_display: `${usd(t.annual_cents)}/yr`,
    annual_savings_cents: t.monthly_cents * 12 - t.annual_cents,
    counties: t.counties >= ALL_COUNTIES ? 'all' : t.counties, seats: t.seats,
    features: [{ key: 'lead_alerts', counties: t.counties >= ALL_COUNTIES ? 'all' : t.counties },
      { key: 'bond_desk' }, { key: 'checkins' }, { key: 'texts', cents: AGENT_TEXT_CENTS }],
  }));
  res.json({ tiers, lead_fee: bondsmanLeadFeeInfo(), payments_live: stripeConfigured() });
});

router.get('/bondsman/subscription', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sub = await activeBondsmanPlan(db, req.user.id);
    if (!sub) return res.json({ active: false, tier: null });
    const t = BONDSMAN_TIERS[sub.tier] || {};
    res.json({
      active: true, tier: sub.tier, status: sub.status, name: t.name || sub.tier, billing: sub.billing_period || 'monthly',
      counties_covered: t.counties >= ALL_COUNTIES ? 'all' : (t.counties || 0), seats: t.seats || null,
      display: t.display || '', renews_at: sub.renews_at, cancel_at_period_end: Number(sub.cancel_at_period_end || 0) === 1,
    });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/bondsman/subscribe', billingLimiter, authRequired, async (req, res) => {
  const tier = typeof req.body?.tier === 'string' ? req.body.tier : '';
  const billing = req.body?.billing === 'annual' ? 'annual' : 'monthly';
  if (!BONDSMAN_TIERS[tier]) return res.status(400).json({ error: say(req, 'billing.err.bad_plan'), code: 'bad_plan' });
  try {
    const db = await getDb();
    if (!STAFF.has(req.user.role)) {
      const u = await loadUserType(db, req.user.id);
      const p = await db.get('SELECT id FROM bondsman_profiles WHERE user_id = ?', [req.user.id]);
      if (!isBailAgentAccount(u) && !p) return res.status(403).json({ error: say(req, 'bondsman.err.bail_agent_only'), code: 'bail_agent_account_required' });
    }
    const existing = await activeBondsmanPlan(db, req.user.id);
    if (existing) return res.status(409).json({ error: say(req, 'billing.err.already_subscribed'), code: 'already_subscribed', current_tier: existing.tier });
    const out = await startSubscription({
      user: req.user, kind: 'bondsman', tier, billing, ui: uiFrom(req.body),
      returnUrl: returnUrlFor(req, req.body?.return_path || '/subscribe'),
    });
    if (out.subscription_id) {
      await recordIncomplete(db, { userId: req.user.id, kind: 'bondsman', tier, billing, stripeSubId: out.subscription_id, customer: out.customer, cents: out.amount_cents });
    }
    delete out.customer;
    res.json(out);
  } catch (e) { billingFail(req, res, e); }
});

router.post('/bondsman/subscription/confirm', billingLimiter, authRequired, (req, res) => confirmPlan(req, res, { kind: 'bondsman' }));

router.post('/bondsman/subscription/change', billingLimiter, authRequired, async (req, res) => {
  const tier = typeof req.body?.tier === 'string' ? req.body.tier : '';
  if (!BONDSMAN_TIERS[tier]) return res.status(400).json({ error: say(req, 'billing.err.bad_plan'), code: 'bad_plan' });
  try {
    const db = await getDb();
    const sub = await activeBondsmanPlan(db, req.user.id);
    if (!sub?.stripe_sub_id) throw new BillingError(404, 'no_subscription');
    const billing = req.body?.billing === 'annual' || req.body?.billing === 'monthly' ? req.body.billing : (sub.billing_period || 'monthly');
    if (sub.tier === tier && (sub.billing_period || 'monthly') === billing) return res.json({ success: true, tier, message: say(req, 'billing.msg.same_plan') });
    const { sub: updated } = await changePlan({ stripeSubId: sub.stripe_sub_id, kind: 'bondsman', tier, billing });
    await db.run('UPDATE bondsman_subscriptions SET tier = ?, amount_cents = ?, billing_period = ?, renews_at = COALESCE(?, renews_at), updated_at = NOW() WHERE id = ?',
      [tier, bondsmanCharge(tier, billing).cents, billing, periodEnd(updated), sub.id]);
    await audit(AUDIT_ACTIONS.SUBSCRIPTION_CHANGED, { userId: req.user.id, req, entityType: 'bondsman_subscription', entityId: sub.id, metadata: { from: sub.tier, to: tier } });
    res.json({ success: true, tier, message: say(req, 'billing.msg.plan_changed', { name: BONDSMAN_TIERS[tier].name }) });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/bondsman/subscription/cancel', billingLimiter, authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const sub = await activeBondsmanPlan(db, req.user.id);
    if (!sub?.stripe_sub_id) throw new BillingError(404, 'no_subscription');
    const updated = await stripeClient().subscriptions.update(sub.stripe_sub_id, { cancel_at_period_end: true });
    await db.run('UPDATE bondsman_subscriptions SET cancel_at_period_end = 1, renews_at = COALESCE(?, renews_at), updated_at = NOW() WHERE id = ?', [periodEnd(updated), sub.id]);
    await audit(AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED, { userId: req.user.id, req, entityType: 'bondsman_subscription', entityId: sub.id, metadata: { tier: sub.tier } });
    const until = periodEnd(updated) || sub.renews_at;
    const when = until ? new Date(until).toLocaleDateString(LOCALES[lang], { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
    res.json({ success: true, message: msg(lang, 'billing.msg.cancelled', { date: when }), access_until: until || null });
  } catch (e) { billingFail(req, res, e); }
});

export default router;
