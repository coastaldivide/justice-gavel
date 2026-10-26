/**
 * billing/subscriptions.js — consumer and attorney plans.
 * Mounted at /api/billing by billing/index.js (POSTs are 503 payments_unavailable without Stripe).
 *
 *   GET  /tiers[?audience=consumer|attorney]  plans, exact prices, trial length, features (public)
 *   GET  /subscription                         the caller's plan (+ the price list, for upsells)
 *   POST /subscribe { tier, ui?, return_path? } start a plan — nothing unlocks yet:
 *        ui 'sheet' (default) → { client_secret, intent_type, subscription_id } for the payment sheet;
 *        ui 'checkout'        → { checkout_url } for Stripe Checkout in a browser
 *   POST /subscription/confirm { subscription_id | checkout_session_id }
 *        reads the subscription back from Stripe (this user, paid / card on file) and only then
 *        records it as trialing / active. Safe to repeat.
 *   POST /subscription/change { tier }        switch plan (prorated; a declined card keeps the old plan)
 *   POST /cancel                               cancel at the end of the paid period (or the trial)
 *   POST /refund { reason, additional_info? }  refund request (policy below)
 *   GET  /overview                             everything billed to the caller (Billing screen)
 */
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger           from '../../utils/logger.js';
import { resolveLang, msg, LOCALES } from '../../i18n/index.js';
import { stripeConfigured } from '../../config.js';
import { TIERS, BONDSMAN_TIERS, planFeatures, usd, billingLimiter, stripeClient } from './_shared.js';
import { startSubscription, verifySubscription, changePlan, returnUrlFor, uiFrom, BillingError, periodEnd } from '../../services/stripeBilling.js';
import { recordIncomplete, syncFromStripe } from '../../services/subscriptionStore.js';
import { PAID_STATUSES } from '../../services/entitlements.js';
import { audit, AUDIT_ACTIONS } from '../../utils/audit.js';

const router = Router();
const PAID_SQL = PAID_STATUSES.map(s => `'${s}'`).join(',');
const PRO_ROLES = new Set(['attorney', 'defender', 'admin', 'super_admin']);
const isProfessional = (u) => PRO_ROLES.has(u?.role) || Number(u?.is_defender) === 1;

/** A billing error in the request's language: { error, code, ...params }. */
export function billingFail(req, res, e, fallbackKey = 'billing.err.server') {
  if (e instanceof BillingError) {
    return res.status(e.status).json({ error: msg(resolveLang(req), `billing.err.${e.code}`, e.params), code: e.code, ...e.params });
  }
  logger.error('[billing]', e?.message);
  return res.status(500).json({ error: msg(resolveLang(req), fallbackKey), code: 'server_error' });
}

const SUB_COLS = `id, user_id, provider_type, tier, status, amount_cents, trial_ends_at, current_period_end,
                  cancel_at_period_end, stripe_sub_id, created_at`;

/** Public view of a subscriptions row. */
export function publicSub(row) {
  if (!row) return null;
  const t = TIERS[row.tier] || {};
  return {
    id: Number(row.id), tier: row.tier, name: t.name || row.tier, audience: t.audience || null, billing: t.billing || null,
    status: row.status, paid: PAID_STATUSES.includes(row.status),
    amount_cents: row.amount_cents == null ? null : Number(row.amount_cents),
    trial_ends_at: row.trial_ends_at || null, current_period_end: row.current_period_end || null,
    cancel_at_period_end: Number(row.cancel_at_period_end || 0) === 1, created_at: row.created_at,
    features: PAID_STATUSES.includes(row.status) ? planFeatures(row.tier) : [],
  };
}

/** The price list exactly as charged (plans.js), with each plan's features. */
export function tierList(audience) {
  return Object.entries(TIERS)
    .filter(([, t]) => !t.legacy && (!audience || t.audience === audience))
    .map(([key, t]) => ({
      key, name: t.name, audience: t.audience, billing: t.billing, display_price: t.display_price,
      monthly_cents: t.monthly_cents, annual_cents: t.annual_cents ?? null, matches_monthly: t.matches_monthly ?? null,
      trial_days: t.trial_days, card_required: true, features: planFeatures(key),
    }));
}

router.get('/tiers', (req, res) => {
  const audience = ['consumer', 'attorney'].includes(req.query.audience) ? req.query.audience : null;
  res.json({ tiers: tierList(audience), payments_live: stripeConfigured() });
});

/** The caller's newest plan row that is paid (else their newest row) for a provider type, or any. */
async function currentRow(db, userId, providerType = null) {
  const where = providerType ? 'AND provider_type = ?' : '';
  const args = providerType ? [userId, providerType] : [userId];
  return (await db.get(`SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = ? ${where} AND status IN (${PAID_SQL}) ORDER BY id DESC LIMIT 1`, args))
    || db.get(`SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = ? ${where} AND status <> 'incomplete' ORDER BY id DESC LIMIT 1`, args);
}

router.get('/subscription', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const pt = ['consumer', 'lawyer'].includes(req.query.provider_type) ? req.query.provider_type : null;
    const row = await currentRow(db, req.user.id, pt);
    res.json({ subscription: publicSub(row), tiers: tierList(null), payments_live: stripeConfigured() });
  } catch (e) { billingFail(req, res, e); }
});

/** Shared start handler for /subscribe and /consumer/subscribe. */
export async function startPlan(req, res, { audience = null } = {}) {
  const lang = resolveLang(req);
  const tier = typeof req.body?.tier === 'string' ? req.body.tier : '';
  const t = TIERS[tier];
  if (!t || t.legacy || (audience && t.audience !== audience)) {
    return res.status(400).json({ error: msg(lang, 'billing.err.bad_plan'), code: 'bad_plan' });
  }
  if (t.audience === 'attorney' && !isProfessional(req.user)) {
    return res.status(403).json({ error: msg(lang, 'billing.err.attorney_plan'), code: 'attorney_plan_only' });
  }
  try {
    const db = await getDb();
    const providerType = t.audience === 'attorney' ? 'lawyer' : 'consumer';
    const existing = await db.get(
      `SELECT id, tier FROM subscriptions WHERE user_id = ? AND provider_type = ? AND status IN (${PAID_SQL}) ORDER BY id DESC LIMIT 1`,
      [req.user.id, providerType]);
    if (existing) {
      return res.status(409).json({ error: msg(lang, 'billing.err.already_subscribed'), code: 'already_subscribed', current_tier: existing.tier });
    }
    const out = await startSubscription({
      user: req.user, kind: 'tier', tier, billing: t.billing, ui: uiFrom(req.body),
      returnUrl: returnUrlFor(req, req.body?.return_path || '/plans'),
    });
    if (out.subscription_id) {
      await recordIncomplete(db, { userId: req.user.id, kind: 'tier', tier, billing: t.billing, stripeSubId: out.subscription_id, customer: out.customer, cents: out.amount_cents });
    }
    delete out.customer;
    res.json(out);
  } catch (e) { billingFail(req, res, e); }
}

router.post('/subscribe', billingLimiter, authRequired, (req, res) => startPlan(req, res));

/** Shared confirm handler (also used by /bondsman/subscription/confirm). */
export async function confirmPlan(req, res, { kind }) {
  const lang = resolveLang(req);
  try {
    const sub = await verifySubscription({
      user: req.user,
      subscriptionId: typeof req.body?.subscription_id === 'string' ? req.body.subscription_id.trim() : null,
      checkoutSessionId: typeof req.body?.checkout_session_id === 'string' ? req.body.checkout_session_id.trim() : null,
    });
    const isBondsman = sub.metadata?.kind === 'bondsman' || sub.metadata?.type === 'bondsman_tier';
    if ((kind === 'bondsman') !== isBondsman) throw new BillingError(404, 'payment_not_found');
    const db = await getDb();
    const row = await syncFromStripe(db, sub, { paid: true });
    if (!row) throw new BillingError(404, 'payment_not_found');
    await audit(AUDIT_ACTIONS.SUBSCRIPTION_STARTED, { userId: req.user.id, req, entityType: isBondsman ? 'bondsman_subscription' : 'subscription', entityId: row.id, metadata: { tier: row.tier, status: row.status } });
    const until = row.trial_ends_at || row.current_period_end || row.renews_at;
    const when = until ? new Date(until).toLocaleDateString(LOCALES[lang], { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
    const message = row.status === 'trialing' ? msg(lang, 'billing.msg.trial_started', { date: when }) : msg(lang, 'billing.msg.plan_active');
    if (isBondsman) return res.json({ ok: true, subscription: row, message });
    res.json({ ok: true, subscription: publicSub(row), message });
  } catch (e) { billingFail(req, res, e); }
}

router.post('/subscription/confirm', billingLimiter, authRequired, (req, res) => confirmPlan(req, res, { kind: 'tier' }));

router.post('/subscription/change', billingLimiter, authRequired, async (req, res) => {
  const lang = resolveLang(req);
  const tier = typeof req.body?.tier === 'string' ? req.body.tier : '';
  const t = TIERS[tier];
  if (!t || t.legacy) return res.status(400).json({ error: msg(lang, 'billing.err.bad_plan'), code: 'bad_plan' });
  try {
    const db = await getDb();
    const providerType = t.audience === 'attorney' ? 'lawyer' : 'consumer';
    const row = await db.get(
      `SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = ? AND provider_type = ? AND status IN (${PAID_SQL}) ORDER BY id DESC LIMIT 1`,
      [req.user.id, providerType]);
    if (!row?.stripe_sub_id) throw new BillingError(404, 'no_subscription');
    if (row.tier === tier) return res.json({ ok: true, subscription: publicSub(row), message: msg(lang, 'billing.msg.same_plan') });
    const { sub } = await changePlan({ stripeSubId: row.stripe_sub_id, kind: 'tier', tier, billing: t.billing });
    await db.run('UPDATE subscriptions SET tier = ?, amount_cents = ?, current_period_end = COALESCE(?, current_period_end), updated_at = NOW() WHERE id = ?',
      [tier, t.billing === 'annual' ? t.annual_cents : t.monthly_cents, periodEnd(sub), row.id]);
    await audit(AUDIT_ACTIONS.SUBSCRIPTION_CHANGED, { userId: req.user.id, req, entityType: 'subscription', entityId: row.id, metadata: { from: row.tier, to: tier } });
    const fresh = await db.get(`SELECT ${SUB_COLS} FROM subscriptions WHERE id = ?`, [row.id]);
    res.json({ ok: true, subscription: publicSub(fresh), message: msg(lang, 'billing.msg.plan_changed', { name: t.name }) });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/cancel', billingLimiter, authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const pt = ['consumer', 'lawyer'].includes(req.body?.provider_type) ? req.body.provider_type : null;
    const row = await db.get(
      `SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = ? ${pt ? 'AND provider_type = ?' : ''} AND status IN (${PAID_SQL}) AND stripe_sub_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
      pt ? [req.user.id, pt] : [req.user.id]);
    if (!row?.stripe_sub_id) throw new BillingError(404, 'no_subscription');
    const sub = await stripeClient().subscriptions.update(row.stripe_sub_id, { cancel_at_period_end: true });
    await db.run('UPDATE subscriptions SET cancel_at_period_end = 1, current_period_end = COALESCE(?, current_period_end), updated_at = NOW() WHERE id = ?', [periodEnd(sub), row.id]);
    await audit(AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED, { userId: req.user.id, req, entityType: 'subscription', entityId: row.id, metadata: { tier: row.tier } });
    const until = row.status === 'trialing' ? row.trial_ends_at : (periodEnd(sub) || row.current_period_end);
    const when = until ? new Date(until).toLocaleDateString(LOCALES[lang], { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
    res.json({ ok: true, message: msg(lang, 'billing.msg.cancelled', { date: when }), access_until: until || null });
  } catch (e) { billingFail(req, res, e); }
});

// ── Refunds ───────────────────────────────────────────────────────────────────
// Policy (owner decision, Oct 26 2026): ALL SALES ARE FINAL. No refunds for change of mind,
// dissatisfaction, non-use or partial periods; cancelling stops the next renewal only.
// The ONLY refunds are charges that should never have happened — a billing error or a
// duplicate charge — which card networks reverse anyway through chargebacks (plus a fee).
// Those are refunded automatically and cancel the plan. Anything else: 403 no_refunds.
const REFUND_REASONS = ['billing_error', 'duplicate'];

router.post('/refund', billingLimiter, authRequired, async (req, res) => {
  const lang = resolveLang(req);
  const reason = req.body?.reason;
  if (['unsatisfied', 'accidental', 'other'].includes(reason)) {
    return res.status(403).json({ error: msg(lang, 'billing.err.no_refunds'), code: 'no_refunds' });
  }
  if (!REFUND_REASONS.includes(reason)) return res.status(400).json({ error: msg(lang, 'billing.err.refund_reason'), code: 'bad_reason' });
  const info = typeof req.body?.additional_info === 'string' ? req.body.additional_info.trim().slice(0, 1000) || null : null;
  try {
    const db = await getDb();
    const row = await db.get(
      `SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = ? AND status IN (${PAID_SQL}) AND stripe_sub_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [req.user.id]);
    if (!row) throw new BillingError(404, 'no_subscription');
    const stripe = stripeClient();
    const invoices = await stripe.invoices.list({ subscription: row.stripe_sub_id, status: 'paid', limit: 1 });
    const inv = invoices?.data?.[0];
    if (!inv || !(Number(inv.amount_paid) > 0)) {
      return res.status(409).json({ error: msg(lang, 'billing.err.nothing_to_refund'), code: 'nothing_to_refund' });
    }
    const paidAt = new Date(((inv.status_transitions?.paid_at || inv.created) || 0) * 1000);
    const days = Math.max(0, (Date.now() - paidAt.getTime()) / 86_400_000);
    const auto = true;   // billing error / duplicate only (see policy above)
    const reqRow = await db.get(
      `INSERT INTO refund_requests (user_id, subscription_id, stripe_sub_id, reason, additional_info, days_since_charge, auto_approve, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW()) RETURNING id`,
      [req.user.id, row.id, row.stripe_sub_id, reason, info, Math.round(days), auto ? 1 : 0, auto ? 'processing' : 'pending_review']);
    if (!auto) {
      await audit(AUDIT_ACTIONS.REFUND_REQUESTED, { userId: req.user.id, req, entityType: 'refund_request', entityId: reqRow.id, metadata: { days: Math.round(days) } });
      return res.json({ ok: true, status: 'pending_review', message: msg(lang, 'billing.msg.refund_review') });
    }
    const piId = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id;
    const refund = await stripe.refunds.create(
      { payment_intent: piId, reason: reason === 'duplicate' || reason === 'billing_error' ? 'duplicate' : 'requested_by_customer',
        metadata: { user_id: String(req.user.id), refund_request_id: String(reqRow.id) } },
      { idempotencyKey: `refund_${reqRow.id}` });
    await stripe.subscriptions.cancel(row.stripe_sub_id);
    await db.run(`UPDATE refund_requests SET status = 'refunded', stripe_refund_id = ?, updated_at = NOW() WHERE id = ?`, [refund.id, reqRow.id]);
    await db.run(`UPDATE subscriptions SET status = 'refunded', updated_at = NOW() WHERE id = ?`, [row.id]);
    await audit(AUDIT_ACTIONS.REFUND_ISSUED, { userId: req.user.id, req, entityType: 'refund_request', entityId: reqRow.id, metadata: { amount_cents: refund.amount } });
    res.json({ ok: true, status: 'refunded', amount_cents: refund.amount, message: msg(lang, 'billing.msg.refunded', { amount: usd(refund.amount) }) });
  } catch (e) { billingFail(req, res, e); }
});

// ── Billing overview (PaymentsScreen) ─────────────────────────────────────────
router.get('/overview', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id;
    const [subs, bonds, leads, piLeads, refunds] = await Promise.all([
      db.all(`SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = ? AND status <> 'incomplete' ORDER BY id DESC LIMIT 20`, [uid]),
      db.all(`SELECT id, tier, status, amount_cents, billing_period, renews_at, cancel_at_period_end, created_at
                FROM bondsman_subscriptions WHERE user_id = ? AND status <> 'incomplete' ORDER BY id DESC LIMIT 20`, [uid]),
      db.all(`SELECT id, arrest_id, lead_fee_cents, created_at FROM lead_purchases
               WHERE bondsman_id = ? AND status = 'charged' ORDER BY id DESC LIMIT 100`, [uid]),
      db.all(`SELECT id, case_type, lead_fee_cents, accepted_at FROM pi_leads WHERE accepted_by = ? AND status = 'accepted' ORDER BY accepted_at DESC LIMIT 100`, [uid]),
      db.all(`SELECT id, reason, status, created_at FROM refund_requests WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [uid]),
    ]);
    res.json({
      subscriptions: subs.map(publicSub),
      bondsman_subscriptions: bonds.map(b => ({ ...b, id: Number(b.id), name: BONDSMAN_TIERS[b.tier]?.name || b.tier,
        paid: PAID_STATUSES.includes(b.status), cancel_at_period_end: Number(b.cancel_at_period_end || 0) === 1 })),
      purchases: [
        ...leads.map(l => ({ kind: 'bail_lead', id: Number(l.id), amount_cents: Number(l.lead_fee_cents), at: l.created_at })),
        ...piLeads.map(l => ({ kind: 'case_lead', id: Number(l.id), case_type: l.case_type, amount_cents: Number(l.lead_fee_cents), at: l.accepted_at })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at)),
      refund_requests: refunds.map(r => ({ ...r, id: Number(r.id) })),
      payments_live: stripeConfigured(),
    });
  } catch (e) { billingFail(req, res, e); }
});

export default router;
