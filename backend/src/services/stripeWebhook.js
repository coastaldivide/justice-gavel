/**
 * services/stripeWebhook.js — the one Stripe webhook handler.
 *
 * Mounted at POST /webhooks/stripe, /api/webhooks/stripe and /api/billing/webhook
 * (raw body; all three are the same endpoint so a dashboard configured with any
 * of them works). Every event is:
 *   1. verified — Stripe signature with STRIPE_WEBHOOK_SECRET (400 otherwise);
 *   2. claimed once — stripe_event_log.stripe_event_id is unique: a replay of an
 *      event already processed answers 200 { duplicate: true } and does nothing;
 *   3. processed by an idempotent handler — the same payment or subscription
 *      arriving through another event, or through the app's confirm call, is
 *      recorded once (unique payment / subscription ids).
 * If processing fails the claim is released and Stripe's retry processes it.
 * Signature verified with stripe.webhooks.constructEvent over the exact raw bytes
 * (express.raw on every mount — express.json would break the HMAC). The secret
 * comes from the server environment, never the code.
 * Local testing: stripe listen --forward-to localhost:4300/api/billing/webhook
 *
 * What it does:
 *   customer.subscription.created / .updated / .deleted   sync our plan row (subscriptionStore)
 *   checkout.session.completed (subscription)            sync the new subscription
 *   invoice.paid / invoice.payment_succeeded             plan paid → trialing / active (renewals too)
 *   invoice.payment_failed                               past_due + a push in the person's language
 *   payment_intent.succeeded                             bail / case lead purchases; outbound-bot
 *                                                        payment links; family connections
 *   charge.refunded                                      lead purchases marked refunded
 */
import Stripe from 'stripe';
import logger from '../utils/logger.js';
import { getDb } from '../db/index.js';
import { stripeClient } from '../routes/billing/_shared.js';
import { syncFromStripe, setStatusByStripeId } from './subscriptionStore.js';
import { recordBailLead, recordCaseLead } from './leadPurchases.js';
import { sendPushToUser } from './pushDelivery.js';
import { msg, userLang } from '../i18n/index.js';
import { logIgnored } from '../utils/ignored.js';

let verifier = null;
function verify(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret || !signature) return null;
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') return null;
  try {
    const s = stripeClient() || (verifier ||= new Stripe('sk_signature_verification_only'));
    return s.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    logger.warn('[webhook:stripe] signature verification failed:', e?.message);
    return null;
  }
}

async function retrieveSub(id) {
  if (!id) return null;
  return await stripeClient().subscriptions.retrieve(String(id), { expand: ['latest_invoice', 'pending_setup_intent'] });
}

async function pushTo(db, userId, titleKey, bodyKey, params, data) {
  if (!userId) return;
  const lang = await userLang(db, userId).catch(() => 'en');
  await sendPushToUser(Number(userId), { title: msg(lang, titleKey), body: msg(lang, bodyKey, params), data }).catch(logIgnored('services/stripeWebhook'));
}

async function onPaymentSucceeded(db, pi) {
  const md = pi.metadata || {};
  const userId = Number(md.user_id);
  if (md.package === 'bail_lead' && Number.isSafeInteger(userId)) {
    const arrestId = Number(md.arrest_id);
    if (Number.isSafeInteger(arrestId)) await recordBailLead(db, { bondsmanId: userId, arrestId, pi });
    return;
  }
  if (md.package === 'case_lead' && Number.isSafeInteger(userId)) {
    const leadId = Number(md.lead_id);
    if (Number.isSafeInteger(leadId)) await recordCaseLead(db, { attorneyId: userId, leadId, pi });
    return;
  }
  if (md.package === 'family_connect') {
    await db.run(`UPDATE family_connections SET status = 'paid', updated_at = NOW() WHERE stripe_pi_id = ? AND status = 'pending_payment'`, [pi.id]);
    return;
  }
  // Outbound bot payment links (texted to a bail agent): deliver the record once.
  const arrestId = Number.parseInt(md.arrest_id, 10) || null;
  if (arrestId && md.recipient_phone && !md.package) {
    const done = await db.get('SELECT id FROM revenue_log WHERE stripe_pi_id = ? LIMIT 1', [pi.id]);
    if (done) return;
    const { deliverLead } = await import('./outbound_bot.js');
    const r = await deliverLead({ phone: md.recipient_phone, arrestId, stripeLinkId: md.payment_link || null, stripePaymentIntentId: pi.id });
    if (r?.error) logger.error('[webhook:stripe] lead delivery failed', pi.id, r.error);
  }
}

async function processEvent(db, event) {
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.type === 'customer.subscription.deleted' ? obj : (await retrieveSub(obj.id)) || obj;
      await syncFromStripe(db, sub);
      return;
    }
    case 'checkout.session.completed': {
      if (obj.mode === 'subscription' && obj.subscription) {
        const sub = await retrieveSub(typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id);
        if (sub) await syncFromStripe(db, sub);
      }
      return;
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
      if (!subId || !(obj.status === 'paid' || obj.paid === true)) return;
      const sub = await retrieveSub(subId);
      if (sub) await syncFromStripe(db, sub, { paid: true });
      return;
    }
    case 'invoice.payment_failed': {
      const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
      if (!subId) return;
      await setStatusByStripeId(db, subId, 'past_due');
      const row = await db.get(`SELECT user_id FROM subscriptions WHERE stripe_sub_id = ? AND status = 'past_due'
                                 UNION ALL SELECT user_id FROM bondsman_subscriptions WHERE stripe_sub_id = ? AND status = 'past_due' LIMIT 1`, [subId, subId]);
      await pushTo(db, row?.user_id, 'billing.push.failed_title', 'billing.push.failed_body', {}, { screen: 'Payments' });
      return;
    }
    case 'payment_intent.succeeded':
      await onPaymentSucceeded(db, obj);
      return;
    case 'charge.refunded': {
      const piId = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
      if (!piId || !obj.refunded) return;
      await db.run(`UPDATE lead_purchases SET status = 'refunded', updated_at = NOW() WHERE stripe_pi_id = ? AND status = 'charged'`, [piId]);
      return;
    }
    default:
  }
}

/** Express handler (raw body). */
export async function stripeWebhookHandler(req, res) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    logger.warn('[webhook:stripe] STRIPE_WEBHOOK_SECRET not set — rejecting unverifiable webhook');
    return res.status(400).json({ error: 'webhook_signature_invalid', message: 'Webhook signature could not be verified' });
  }
  const event = verify(req.body, req.headers['stripe-signature']);
  if (!event?.id || !event.type) {
    return res.status(400).json({ error: 'webhook_signature_invalid', message: 'Invalid Stripe signature' });
  }
  let db;
  try {
    db = await getDb();
    const claim = await db.run(
      `INSERT INTO stripe_event_log (stripe_event_id, event_type, processed_at) VALUES (?, ?, NOW())
       ON CONFLICT (stripe_event_id) DO NOTHING`, [event.id, event.type]);
    if (!claim.changes) return res.json({ received: true, duplicate: true });
  } catch (e) {
    logger.error('[webhook:stripe] could not claim event', event.id, e?.message);
    return res.status(500).json({ error: 'webhook_failed' });
  }
  try {
    await processEvent(db, event);
    return res.json({ received: true, type: event.type });
  } catch (e) {
    logger.error('[webhook:stripe] processing failed', event.id, event.type, e?.message);
    await db.run('DELETE FROM stripe_event_log WHERE stripe_event_id = ?', [event.id]).catch(logIgnored('services/stripeWebhook'));
    return res.status(500).json({ error: 'webhook_failed' });
  }
}
