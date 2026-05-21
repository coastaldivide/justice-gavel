/**
 * stripe.js — Full Stripe integration
 *
 * Functions:
 *  createStripePayment()      — checkout session (app payments)
 *  createPaymentLink()        — shareable payment link (bot SMS/email)
 *  createSubscription()       — recurring subscription
 *  constructWebhookEvent()    — verify + parse Stripe webhook
 *  calcStripeFee()            — compute net after Stripe fee
 */

import Stripe from 'stripe';
import logger from '../utils/logger.js';

const key = process.env.STRIPE_SECRET || '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
export const stripe = key ? new Stripe(key, { apiVersion: '2024-06-20' }) : null;
export const STRIPE_LIVE = !!key;

// Stripe fee: 2.9% + $0.30
export function calcStripeFee(amountCents) {
  return Math.round(amountCents * 0.029) + 30;
}

// ── Checkout session (used by app PaymentsScreen) ─────────────────────────────
export async function createStripePayment({ amount, currency = 'USD', user, meta }) {
  if (!stripe) {
    return { provider: 'stripe-mock', url: 'https://example.com/checkout/stripe-mock', mock: true };
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'us_bank_account', 'link'],
    line_items: [{
      price_data: {
        currency,
        unit_amount: Math.round(amount * 100),
        product_data: { name: meta?.description || 'Justice Gavel' },
      },
      quantity: 1,
    }],
    success_url: meta?.successUrl || process.env.STRIPE_SUCCESS_URL || 'https://justicegavel.app/success',
    cancel_url:  meta?.cancelUrl  || process.env.STRIPE_CANCEL_URL  || 'https://justicegavel.app/cancel',
    metadata: { user_id: String(user?.id || ''), purpose: meta?.purpose || '' },
  });
  return { provider: 'stripe', url: session.url, sessionId: session.id };
}

// ── Payment link (used by outbound bot — texted to bondsmen/attorneys) ────────
export async function createPaymentLink({ amountCents, description, arrestId, recipientPhone, recipientType, expiresInMinutes = 120 }) {
  if (!stripe) {
    const mockUrl = `https://example.com/pay/mock_${Date.now()}`;
    return { mock: true, url: mockUrl, id: 'plink_mock_' + Date.now(), expiresAt: new Date(Date.now() + expiresInMinutes * 60000).toISOString() };
  }

  // Create a one-time price
  const price = await stripe.prices.create({
    unit_amount: amountCents,
    currency: 'usd',
    product_data: { name: description || 'Justice Gavel Lead' },
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: {
      arrest_id:       String(arrestId || ''),
      recipient_phone: recipientPhone || '',
      recipient_type:  recipientType  || '',
    },
    after_completion: {
      type: 'redirect',
      redirect: { url: (process.env.STRIPE_SUCCESS_URL || 'https://justicegavel.app') + '?lead=paid' },
    },
  });

  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();

  return {
    id:        link.id,
    url:       link.url,
    expiresAt,
    amountCents,
  };
}

// ── Verify Stripe webhook ──────────────────────────────────────────────────────
export function constructWebhookEvent(rawBody, signature) {
  if (!stripe || !webhookSecret) return null;
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    logger.error('[stripe] Webhook signature verification failed:', err.message);
    return null;
  }
}

// ── Get or create Stripe customer ─────────────────────────────────────────────
export async function getOrCreateCustomer({ email, name, userId }) {
  if (!stripe) return 'cus_mock_' + (userId || Date.now());
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0].id;
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { user_id: String(userId || '') },
  });
  return customer.id;
}
