/**
 * webhooks.test.js — Outbound webhook system + Stripe webhook handler
 *
 * Outbound webhook tests cover:
 *   - signPayload produces correct HMAC-SHA256
 *   - signPayload is deterministic (same inputs → same output)
 *   - signPayload changes with different secrets
 *   - signPayload changes with different timestamps
 *   - WEBHOOK_EVENTS is a non-empty array of strings
 *   - WEBHOOK_EVENTS contains expected core events
 *
 * Stripe webhook tests cover (mock mode — no STRIPE_WEBHOOK_SECRET):
 *   - Returns 200 + { received: true } for all event types in mock mode
 *   - Unknown event types are gracefully accepted (not rejected)
 *   - Missing stripe-signature header is accepted in mock mode
 *   - Empty body returns 200 (graceful — async processing handles missing data)
 */
import { createHmac }   from 'crypto';
import { signPayload, WEBHOOK_EVENTS } from '../routes/webhooks/outbound.js';
import express          from 'express';
import request          from 'supertest';
import billingRouter    from '../routes/billing/index.js';

// ── Stripe webhook app ──────────────────────────────────────────────────────
const stripeApp = express();
stripeApp.use(express.json());
stripeApp.use('/api/billing', billingRouter);

const makePayload = (type, data = {}) =>
  JSON.stringify({ type, data: { object: data } });

const postWebhook = (payload, sig = 'test_sig') =>
  request(stripeApp)
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', sig)
    .send(payload);

// ══════════════════════════════════════════════════════════════════════════════
// OUTBOUND WEBHOOK SIGNATURE
// ══════════════════════════════════════════════════════════════════════════════
describe('signPayload — HMAC-SHA256 signature helper', () => {
  const SECRET    = 'whsec_' + 'a'.repeat(48);
  const TIMESTAMP = '1700000000';
  const PAYLOAD   = JSON.stringify({ id: 'evt_test', type: 'matter.created' });

  test('returns a 64-char hex string', () => {
    const sig = signPayload(SECRET, TIMESTAMP, PAYLOAD);
    expect(typeof sig).toBe('string');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic — same inputs produce same output', () => {
    const sig1 = signPayload(SECRET, TIMESTAMP, PAYLOAD);
    const sig2 = signPayload(SECRET, TIMESTAMP, PAYLOAD);
    expect(sig1).toBe(sig2);
  });

  test('matches manual HMAC-SHA256 computation', () => {
    const sig      = signPayload(SECRET, TIMESTAMP, PAYLOAD);
    const data     = `${TIMESTAMP}.${PAYLOAD}`;
    const expected = createHmac('sha256', SECRET).update(data).digest('hex');
    expect(sig).toBe(expected);
  });

  test('different secret produces different signature', () => {
    const sig1 = signPayload('whsec_' + 'a'.repeat(48), TIMESTAMP, PAYLOAD);
    const sig2 = signPayload('whsec_' + 'b'.repeat(48), TIMESTAMP, PAYLOAD);
    expect(sig1).not.toBe(sig2);
  });

  test('different timestamp produces different signature', () => {
    const sig1 = signPayload(SECRET, '1700000000', PAYLOAD);
    const sig2 = signPayload(SECRET, '1700000001', PAYLOAD);
    expect(sig1).not.toBe(sig2);
  });

  test('different payload produces different signature', () => {
    const sig1 = signPayload(SECRET, TIMESTAMP, '{"type":"matter.created"}');
    const sig2 = signPayload(SECRET, TIMESTAMP, '{"type":"matter.updated"}');
    expect(sig1).not.toBe(sig2);
  });

  test('accepts object payload (auto-stringified)', () => {
    const obj = { id: 'evt_test', type: 'matter.created' };
    const sigObj = signPayload(SECRET, TIMESTAMP, obj);
    const sigStr = signPayload(SECRET, TIMESTAMP, JSON.stringify(obj));
    expect(sigObj).toBe(sigStr);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK_EVENTS REGISTRY
// ══════════════════════════════════════════════════════════════════════════════
describe('WEBHOOK_EVENTS registry', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(WEBHOOK_EVENTS)).toBe(true);
    expect(WEBHOOK_EVENTS.length).toBeGreaterThan(0);
  });

  test('all entries are non-empty strings', () => {
    WEBHOOK_EVENTS.forEach(e => {
      expect(typeof e).toBe('string');
      expect(e.length).toBeGreaterThan(0);
    });
  });

  test('all entries follow the namespace.action format', () => {
    WEBHOOK_EVENTS.forEach(e => {
      expect(e).toMatch(/^[a-z_]+\.[a-z_]+$/);
    });
  });

  test('contains expected core events', () => {
    const required = [
      'matter.created', 'matter.updated',
      'invoice.created', 'invoice.paid',
      'conflict.detected',
    ];
    required.forEach(evt => {
      expect(WEBHOOK_EVENTS).toContain(evt);
    });
  });

  test('has no duplicate entries', () => {
    const unique = new Set(WEBHOOK_EVENTS);
    expect(unique.size).toBe(WEBHOOK_EVENTS.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STRIPE WEBHOOK — MOCK MODE (no STRIPE_WEBHOOK_SECRET configured in test env)
// ══════════════════════════════════════════════════════════════════════════════
describe('Stripe webhook — mock mode', () => {
  // In mock mode, constructWebhookEvent returns null (no secret to verify with).
  // The route checks: if (!event && process.env.STRIPE_WEBHOOK_SECRET) → 400.
  // Without STRIPE_WEBHOOK_SECRET, it accepts all events and returns 200.

  test('payment_intent.succeeded → 200 { received: true }', async () => {
    const r = await postWebhook(makePayload('payment_intent.succeeded',
      { id: 'pi_test', amount: 2000, customer: 'cus_test' }));
    expect(r.status).toBe(200);
    expect(r.body.received).toBe(true);
  });

  test('invoice.payment_succeeded → 200 { received: true }', async () => {
    const r = await postWebhook(makePayload('invoice.payment_succeeded',
      { id: 'in_test', subscription: 'sub_test', customer: 'cus_test' }));
    expect(r.status).toBe(200);
    expect(r.body.received).toBe(true);
  });

  test('invoice.payment_failed → 200 { received: true }', async () => {
    const r = await postWebhook(makePayload('invoice.payment_failed',
      { id: 'in_test', subscription: 'sub_test' }));
    expect(r.status).toBe(200);
    expect(r.body.received).toBe(true);
  });

  test('customer.subscription.deleted → 200 { received: true }', async () => {
    const r = await postWebhook(makePayload('customer.subscription.deleted',
      { id: 'sub_test', customer: 'cus_test' }));
    expect(r.status).toBe(200);
    expect(r.body.received).toBe(true);
  });

  test('unknown event type is gracefully accepted → 200', async () => {
    const r = await postWebhook(makePayload('some.unknown.event.type', {}));
    expect(r.status).toBe(200);
    expect(r.body.received).toBe(true);
  });

  test('missing stripe-signature header is accepted in mock mode → 200', async () => {
    const r = await request(stripeApp)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(makePayload('payment_intent.succeeded', { id: 'pi_test' }));
    expect(r.status).toBe(200);
  });

  test('response body always contains received: true', async () => {
    const r = await postWebhook(makePayload('payment_intent.succeeded', { id: 'pi_x' }));
    expect(r.body.received).toBe(true);
    expect(r.body).toMatchObject({ received: true });
  });
});
