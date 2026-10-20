/**
 * services/stripeBilling.js — the one way the app takes money.
 *
 * Every purchase follows the same pattern (section A's Quick Connect):
 *   1. the server creates the Stripe object for an amount from routes/billing/plans.js
 *      (or ./leadFee.js / ./attorneyLeadFee.js) — never an amount from the client;
 *   2. the app collects the card: Stripe's payment sheet on a phone (client_secret),
 *      or Stripe Checkout in a browser (checkout_url, then back to the app);
 *   3. the app calls a confirm route; the server reads the object back from Stripe
 *      and checks it belongs to this user and this purchase and is paid before it
 *      records anything or unlocks anything. Confirming twice is harmless.
 * The webhook (services/stripeWebhook.js) finishes the same steps when the app
 * lost its connection after paying.
 */
import { stripeClient, getOrCreateStripeCustomer } from '../routes/billing/_shared.js';
import { TIERS, BONDSMAN_TIERS, chargeFor, bondsmanCharge } from '../routes/billing/plans.js';
import logger from '../utils/logger.js';

export class BillingError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params || {}; }
}

const isMissing = (e) => e?.code === 'resource_missing' || e?.statusCode === 404 || /No such/i.test(String(e?.message));
async function retrieveOrNull(fn) {
  try { return await fn(); } catch (e) { if (isMissing(e)) return null; throw e; }
}

/** Where Stripe Checkout sends the browser back: the calling web app's origin + an app path. */
export function returnUrlFor(req, path) {
  const origin = String(req.headers?.origin || '');
  const base = /^https?:\/\/[^/\s]+$/.test(origin) ? origin : (process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
  const p = typeof path === 'string' && /^\/[A-Za-z0-9/_-]{0,80}$/.test(path) ? path : '/';
  return `${base}${p}`;
}

/** 'sheet' (phone) or 'checkout' (browser) — what the client can present. */
export function uiFrom(body) {
  return body?.ui === 'checkout' ? 'checkout' : 'sheet';
}

// ── Plans ─────────────────────────────────────────────────────────────────────

/** The Stripe line for a plan: its configured price id, else the amount from plans.js. */
export function planLine(kind, tier, billing) {
  let c; let name; let trialDays = 0;
  if (kind === 'bondsman') {
    const t = BONDSMAN_TIERS[tier];
    c = bondsmanCharge(tier, billing);
    if (!c || !t) return null;
    name = t.name;
  } else {
    const t = TIERS[tier];
    if (!t || t.legacy) return null;
    c = { ...chargeFor(tier), price_id: t.price_id || null };
    name = t.name;
    trialDays = t.trial_days || 0;
  }
  const inline = { price_data: { currency: 'usd', unit_amount: c.cents, recurring: { interval: c.interval }, product_data: { name: `Justice Gavel — ${name}` } } };
  return { cents: c.cents, interval: c.interval, priceId: c.price_id || null, inline, item: c.price_id ? { price: c.price_id } : inline, trialDays };
}

// A configured Stripe price id is used only when Stripe's price is exactly the
// plan's price (amount, interval, USD, active). Otherwise the shown price would
// not be the charged price, so the inline price is used and the mismatch logged.
const priceChecks = new Map();   // price id → { ok, at }
const PRICE_CHECK_TTL = 10 * 60_000;
export async function chargeItem(stripe, line) {
  if (!line.priceId) return line.inline;
  const hit = priceChecks.get(line.priceId);
  let ok = hit && Date.now() - hit.at < PRICE_CHECK_TTL ? hit.ok : null;
  if (ok === null) {
    const price = await retrieveOrNull(() => stripe.prices.retrieve(line.priceId));
    ok = !!price && price.active !== false && Number(price.unit_amount) === line.cents
      && price.recurring?.interval === line.interval && String(price.currency || 'usd').toLowerCase() === 'usd';
    if (price) priceChecks.set(line.priceId, { ok, at: Date.now() });
    if (!ok) logger.error(`[billing] Stripe price ${line.priceId} is not ${line.cents}/${line.interval} USD (got ${price?.unit_amount}/${price?.recurring?.interval}); charging the plan price inline`);
  }
  return ok ? { price: line.priceId } : line.inline;
}
export const _resetPriceChecks = () => priceChecks.clear();

/** A Stripe subscription is paid for: a card is on file for a trial, or the latest invoice is paid. */
export function subscriptionPaid(sub) {
  if (!sub) return false;
  if (sub.status === 'trialing') {
    return !!sub.default_payment_method || sub.pending_setup_intent?.status === 'succeeded';
  }
  if (sub.status === 'active' || sub.status === 'past_due') {
    const inv = sub.latest_invoice;
    return typeof inv === 'object' && inv !== null && (inv.status === 'paid' || inv.paid === true);
  }
  return false;
}

/**
 * Create a subscription that unlocks nothing yet.
 * Sheet: { subscription_id, client_secret, intent_type: 'setup'|'payment' }.
 * Checkout: { checkout_url, checkout_session_id }.
 */
export async function startSubscription({ user, kind, tier, billing = 'monthly', ui, returnUrl }) {
  const line = planLine(kind, tier, billing);
  if (!line) throw new BillingError(400, 'bad_plan');
  const stripe = stripeClient();
  const customer = await getOrCreateStripeCustomer(user);
  if (!customer) throw new BillingError(502, 'stripe_failed');
  const item = await chargeItem(stripe, line);
  const metadata = { user_id: String(user.id), tier, kind, billing, type: kind === 'bondsman' ? 'bondsman_tier' : 'plan' };

  if (ui === 'checkout') {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ ...item, quantity: 1 }],
      payment_method_collection: 'always',
      subscription_data: { metadata, ...(line.trialDays ? { trial_period_days: line.trialDays } : {}) },
      metadata,
      success_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}checkout_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl,
    });
    return { requires_payment: true, checkout_url: session.url, checkout_session_id: session.id, amount_cents: line.cents };
  }

  const sub = await stripe.subscriptions.create({
    customer,
    items: [item],
    ...(line.trialDays ? { trial_period_days: line.trialDays } : {}),
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
    metadata,
  });
  const setup = sub.pending_setup_intent && typeof sub.pending_setup_intent === 'object' ? sub.pending_setup_intent : null;
  const pi = sub.latest_invoice?.payment_intent && typeof sub.latest_invoice.payment_intent === 'object' ? sub.latest_invoice.payment_intent : null;
  const clientSecret = setup?.client_secret || pi?.client_secret || null;
  if (!clientSecret) throw new BillingError(502, 'stripe_failed');
  return {
    requires_payment: true, subscription_id: sub.id, customer,
    client_secret: clientSecret, intent_type: setup ? 'setup' : 'payment',
    amount_cents: line.cents, trial_days: line.trialDays, stripe_status: sub.status,
  };
}

/**
 * Read a subscription back from Stripe for this user (by subscription id or by the
 * Checkout session that created it). Throws 404 when it is not theirs, 402 when it
 * is not paid. Returns the Stripe subscription with metadata.{tier, kind, billing}.
 */
export async function verifySubscription({ user, subscriptionId, checkoutSessionId }) {
  const stripe = stripeClient();
  let subId = subscriptionId;
  if (checkoutSessionId) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(checkoutSessionId)) throw new BillingError(400, 'payment_required');
    const session = await retrieveOrNull(() => stripe.checkout.sessions.retrieve(checkoutSessionId));
    if (!session || session.mode !== 'subscription' || session.metadata?.user_id !== String(user.id)) throw new BillingError(404, 'payment_not_found');
    if (session.status !== 'complete') throw new BillingError(402, 'payment_not_completed');
    subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  }
  if (!subId || !/^sub_[A-Za-z0-9_]+$/.test(String(subId))) throw new BillingError(400, 'payment_required');
  const sub = await retrieveOrNull(() => stripe.subscriptions.retrieve(subId, { expand: ['latest_invoice', 'pending_setup_intent'] }));
  if (!sub || sub.metadata?.user_id !== String(user.id)) throw new BillingError(404, 'payment_not_found');
  if (!subscriptionPaid(sub)) throw new BillingError(402, 'payment_not_completed', { status: sub.status });
  return sub;
}

export const periodEnd = (sub) => (sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null);
export const trialEnd = (sub) => (sub?.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null);

/**
 * Switch a paid Stripe subscription to another plan. Stripe applies the change
 * only when the prorated invoice is paid (payment_behavior pending_if_incomplete);
 * a declined card leaves the old plan in place → 402.
 */
export async function changePlan({ stripeSubId, kind, tier, billing }) {
  const line = planLine(kind, tier, billing);
  if (!line) throw new BillingError(400, 'bad_plan');
  const stripe = stripeClient();
  const current = await retrieveOrNull(() => stripe.subscriptions.retrieve(stripeSubId));
  const itemId = current?.items?.data?.[0]?.id;
  if (!itemId) throw new BillingError(404, 'no_subscription');
  const item = await chargeItem(stripe, line);
  const updated = await stripe.subscriptions.update(stripeSubId, {
    items: [{ id: itemId, ...item }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
  });
  if (updated?.pending_update) throw new BillingError(402, 'change_not_paid');
  await stripe.subscriptions.update(stripeSubId, { metadata: { ...(current.metadata || {}), tier, billing } });
  return { sub: updated, cents: line.cents };
}

// ── One-time payments (leads) ─────────────────────────────────────────────────

/** A PaymentIntent (sheet) or a Checkout session (browser) for a fixed amount. */
export async function startPayment({ user, cents, description, metadata, ui, returnUrl }) {
  const stripe = stripeClient();
  const customer = await getOrCreateStripeCustomer(user);
  const md = { ...metadata, user_id: String(user.id) };
  if (ui === 'checkout') {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer || undefined,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: description } } }],
      payment_intent_data: { metadata: md, description },
      metadata: md,
      success_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}checkout_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl,
    });
    return { requires_payment: true, checkout_url: session.url, checkout_session_id: session.id, amount_cents: cents };
  }
  const pi = await stripe.paymentIntents.create({
    amount: cents, currency: 'usd', customer: customer || undefined,
    automatic_payment_methods: { enabled: true }, description, metadata: md,
  });
  return { requires_payment: true, client_secret: pi.client_secret, payment_intent_id: pi.id, amount_cents: cents };
}

/**
 * The succeeded PaymentIntent for this user's purchase `pkg`, read from Stripe
 * (by id, or through the Checkout session). `match` checks the purchase-specific
 * metadata (lead id …). Throws 404 / 402 like verifySubscription.
 */
export async function verifyPayment({ user, pkg, paymentIntentId, checkoutSessionId, match = () => true }) {
  const stripe = stripeClient();
  let piId = paymentIntentId;
  if (checkoutSessionId) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(checkoutSessionId)) throw new BillingError(400, 'payment_required');
    const session = await retrieveOrNull(() => stripe.checkout.sessions.retrieve(checkoutSessionId));
    if (!session || session.mode !== 'payment' || session.metadata?.user_id !== String(user.id) || session.metadata?.package !== pkg) {
      throw new BillingError(404, 'payment_not_found');
    }
    if (session.payment_status !== 'paid') throw new BillingError(402, 'payment_not_completed');
    piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  }
  if (!piId || !/^pi_[A-Za-z0-9_]+$/.test(String(piId))) throw new BillingError(400, 'payment_required');
  const pi = await retrieveOrNull(() => stripe.paymentIntents.retrieve(piId));
  const md = pi?.metadata || {};
  if (!pi || md.package !== pkg || md.user_id !== String(user.id) || !match(md, pi)) throw new BillingError(404, 'payment_not_found');
  if (pi.status !== 'succeeded') throw new BillingError(402, 'payment_not_completed', { status: pi.status });
  return pi;
}
