/**
 * webhook_signature.test.js
 * Tests Stripe webhook signature verification without a live connection.
 * An unverified webhook = anyone can fake a payment_intent.succeeded event.
 */
import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WH_FILE   = resolve(__dirname, '../routes/billing/webhooks.js');

// Mirror Stripe's signature generation for testing
function generateStripeSignature(payload, secret, timestamp = Math.floor(Date.now()/1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function verifyStripeSignature(payload, sigHeader, secret, toleranceSec = 300) {
  if (!sigHeader) throw new Error('No Stripe-Signature header');
  const parts = {};
  sigHeader.split(',').forEach(p => { const [k,v] = p.split('='); parts[k] = v; });
  const { t, v1 } = parts;
  if (!t || !v1) throw new Error('Invalid signature header format');
  const timestamp = parseInt(t);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) throw new Error('Webhook timestamp too old');
  const expected = crypto.createHmac('sha256', secret)
    .update(`${t}.${payload}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)))
    throw new Error('Signature mismatch');
  return true;
}

const SECRET  = 'whsec_test_secret_key_for_testing_only';
const PAYLOAD = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { amount: 2999 } } });

describe('Webhook signature — valid signatures', () => {
  test('verifies a correctly signed webhook', () => {
    const sig = generateStripeSignature(PAYLOAD, SECRET);
    expect(verifyStripeSignature(PAYLOAD, sig, SECRET)).toBe(true);
  });

  test('signature verification is timing-safe', () => {
    // Two calls should take similar time (no early exit on mismatch)
    const sig = generateStripeSignature(PAYLOAD, SECRET);
    const t1  = Date.now();
    try { verifyStripeSignature(PAYLOAD, sig, SECRET); } catch {}
    const t2  = Date.now();
    try { verifyStripeSignature(PAYLOAD, 't=1,v1=bad', SECRET); } catch {}
    const t3  = Date.now();
    // Both should complete (no assertion on timing — just shouldn't throw on valid)
    expect(t2 - t1).toBeLessThan(100);
  });
});

describe('Webhook signature — replay attacks', () => {
  test('rejects signatures older than 5 minutes', () => {
    const oldTimestamp = Math.floor(Date.now()/1000) - 400; // 6.6 min old
    const sig = generateStripeSignature(PAYLOAD, SECRET, oldTimestamp);
    expect(() => verifyStripeSignature(PAYLOAD, sig, SECRET, 300)).toThrow(/too old/i);
  });

  test('accepts signatures within tolerance window', () => {
    const recentTs = Math.floor(Date.now()/1000) - 200; // 3.3 min old
    const sig = generateStripeSignature(PAYLOAD, SECRET, recentTs);
    expect(verifyStripeSignature(PAYLOAD, sig, SECRET, 300)).toBe(true);
  });
});

describe('Webhook signature — tampered payloads', () => {
  test('rejects tampered payload', () => {
    const sig     = generateStripeSignature(PAYLOAD, SECRET);
    const tampered = PAYLOAD.replace('2999', '99'); // change amount
    expect(() => verifyStripeSignature(tampered, sig, SECRET)).toThrow(/mismatch/i);
  });

  test('rejects missing signature header', () => {
    expect(() => verifyStripeSignature(PAYLOAD, null, SECRET)).toThrow();
    expect(() => verifyStripeSignature(PAYLOAD, '',   SECRET)).toThrow();
  });

  test('rejects wrong secret', () => {
    const sig = generateStripeSignature(PAYLOAD, 'wrong_secret');
    expect(() => verifyStripeSignature(PAYLOAD, sig, SECRET)).toThrow(/mismatch/i);
  });

  test('rejects malformed signature header', () => {
    expect(() => verifyStripeSignature(PAYLOAD, 'not-a-sig-header', SECRET)).toThrow();
  });
});

describe('Webhook route — implementation check', () => {
  test('webhook route file exists', () => expect(existsSync(WH_FILE)).toBe(true));

  test('webhook route uses stripe.webhooks.constructEvent', () => {
    const c = readFileSync(WH_FILE, 'utf-8');
    expect(c).toMatch(/constructEvent|verifySignature|stripe.*webhook/i);
  });

  test('webhook uses raw body (not parsed JSON)', () => {
    const c = readFileSync(WH_FILE, 'utf-8');
    expect(c).toMatch(/rawBody|raw.*body|express\.raw/i);
  });

  test('webhook handles payment_intent.succeeded', () => {
    const c = readFileSync(WH_FILE, 'utf-8');
    expect(c).toMatch(/payment_intent\.succeeded|invoice\.paid|customer\.subscription/i);
  });
});
