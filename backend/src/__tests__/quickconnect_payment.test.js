/**
 * quickconnect_payment.test.js — the REAL routes/billing/connections.js
 * Quick Connect flow with a Stripe key (fake Stripe client, in-memory DB):
 *
 *   - POST /quickconnect creates a $20.00 PaymentIntent (minus credit) for the
 *     app's payment sheet and reveals NO contact before it is paid (the old
 *     handler needed a payment_method_id the app never sends → always 400,
 *     and its price constant did not exist → NaN amount)
 *   - POST /quickconnect/confirm reveals the bondsman + lawyer only for a
 *     succeeded PaymentIntent of THIS user and package; repeating it books the
 *     credit and the revenue once
 *   - credit covering the whole price skips Stripe
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const tok = (id) => jwt.sign({ id, role: 'user' }, SECRET, { expiresIn: '1h' });

const state = { users: [], bail: [], lawyers: [], revenue: [], pis: new Map(), seq: 0 };
function reset() {
  state.users = [{ id: 1, credit_cents: 0 }, { id: 2, credit_cents: 0 }, { id: 3, credit_cents: 2500 }];
  state.bail = [{ id: 501, name: 'Nashville Bail', phone: '+16155550111', address: 'A St', rating: 4.5, lat: 36.16, lng: -86.78, hours: null, state: 'TN' }];
  state.lawyers = [{ id: 701, name: 'Defense Esq', phone: '+16155550122', address: 'B St', rating: 4.8, specialties: '["DUI"]', free_consultation: 1, lat: 36.17, lng: -86.79, state: 'TN' }];
  state.revenue = [];
  state.pis = new Map();
  state.seq = 0;
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const fakeDb = {
  async get(sql, p = []) { return (await this.all(sql, p))[0]; },
  async all(sql, p = []) {
    const s = norm(sql);
    if (/^SELECT credit_cents FROM users WHERE id=\?/.test(s)) return state.users.filter(u => u.id === p[0]);
    if (/FROM bail_agents WHERE active = 1/.test(s)) return state.bail.slice(0, 1);
    if (/FROM lawyers WHERE active = 1/.test(s)) return state.lawyers.slice(0, 1);
    if (/FROM bail_agents WHERE id = \?/.test(s)) return state.bail.filter(b => b.id === p[0]);
    if (/FROM lawyers WHERE id = \?/.test(s)) return state.lawyers.filter(l => l.id === p[0]);
    if (/^SELECT id FROM revenue_log WHERE stripe_pi_id = \?/.test(s)) return state.revenue.filter(r => r.pi === p[0]);
    throw new Error(`unexpected query: ${s}`);
  },
  async run(sql, p = []) {
    const s = norm(sql);
    if (/^UPDATE users SET credit_cents = GREATEST\(0, credit_cents - \?\) WHERE id=\?/.test(s)) {
      const u = state.users.find(x => x.id === p[1]); u.credit_cents = Math.max(0, u.credit_cents - p[0]); return { changes: 1 };
    }
    if (/^INSERT INTO revenue_log/.test(s)) { state.revenue.push({ gross: p[2], pi: p[5] }); return { changes: 1 }; }
    throw new Error(`unexpected run: ${s}`);
  },
};

const fakeStripe = {
  paymentIntents: {
    create: jest.fn(async (params) => {
      const id = `pi_test_${++state.seq}`;
      const pi = { id, client_secret: `${id}_secret`, amount: params.amount, status: 'requires_payment_method', metadata: params.metadata };
      state.pis.set(id, pi);
      return pi;
    }),
    retrieve: jest.fn(async (id) => {
      const pi = state.pis.get(id);
      if (!pi) throw new Error('No such payment_intent');
      return pi;
    }),
  },
};

jest.unstable_mockModule('../db/index.js', () => ({ getDb: async () => fakeDb, default: fakeDb }));
jest.unstable_mockModule('../routes/billing/_shared.js', () => ({
  stripe: fakeStripe,
  LIVE: true,
  billingLimiter: (req, res, next) => next(),
  getOrCreateStripeCustomer: async () => 'cus_test',
}));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  authRequired: (req, res, next) => {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    try { req.user = jwt.verify(t, SECRET); next(); } catch { res.status(401).json({ error: 'auth' }); }
  },
}));

const { default: router } = await import('../routes/billing/connections.js');
const app = express();
app.use(express.json());
app.use('/api/billing', router);
const as = (id) => ({ Authorization: `Bearer ${tok(id)}` });

beforeEach(() => { reset(); fakeStripe.paymentIntents.create.mockClear(); });

describe('Quick Connect with Stripe configured', () => {
  test('quote: $20.00 minus this account\'s credit', async () => {
    const r = await request(app).get('/api/billing/quickconnect/quote').set(as(3));
    expect(r.body).toEqual({ price_cents: 2000, credit_cents: 2000, amount_cents: 0, payments_live: true });
  });

  test('POST creates a $20.00 PaymentIntent for the payment sheet and reveals nothing yet', async () => {
    const r = await request(app).post('/api/billing/quickconnect').set(as(1)).send({ lat: 36.16, lng: -86.78 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ requires_payment: true, client_secret: 'pi_test_1_secret', payment_intent_id: 'pi_test_1', amount_cents: 2000 });
    expect(JSON.stringify(r.body)).not.toMatch(/6155550111|6155550122/);
    const params = fakeStripe.paymentIntents.create.mock.calls[0][0];
    expect(params).toMatchObject({ amount: 2000, currency: 'usd', customer: 'cus_test', automatic_payment_methods: { enabled: true } });
    expect(params.confirm).toBeUndefined();
    expect(params.metadata).toMatchObject({ user_id: '1', package: 'quickconnect', bondsman_id: '501', lawyer_id: '701' });
  });

  test('confirm: unpaid → 402; another user → 404; paid → contacts, revenue + credit booked once', async () => {
    await request(app).post('/api/billing/quickconnect').set(as(1)).send({ lat: 36.16, lng: -86.78 });
    expect((await request(app).post('/api/billing/quickconnect/confirm').set(as(1)).send({ payment_intent_id: 'pi_test_1' })).status).toBe(402);
    state.pis.get('pi_test_1').status = 'succeeded';
    expect((await request(app).post('/api/billing/quickconnect/confirm').set(as(2)).send({ payment_intent_id: 'pi_test_1' })).status).toBe(404);
    expect((await request(app).post('/api/billing/quickconnect/confirm').set(as(1)).send({ payment_intent_id: 'bogus' })).status).toBe(400);
    expect((await request(app).post('/api/billing/quickconnect/confirm').set(as(1)).send({ payment_intent_id: 'pi_unknown' })).status).toBe(404);
    const ok = await request(app).post('/api/billing/quickconnect/confirm').set(as(1)).send({ payment_intent_id: 'pi_test_1' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ success: true, charged: '$20.00', bondsman: { id: 501, phone: '+16155550111' }, lawyer: { id: 701, phone: '+16155550122' } });
    const again = await request(app).post('/api/billing/quickconnect/confirm').set(as(1)).send({ payment_intent_id: 'pi_test_1' });
    expect(again.status).toBe(200);
    expect(state.revenue).toEqual([{ gross: 2000, pi: 'pi_test_1' }]);
  });

  test('credit covering the whole price: contacts now, no Stripe charge, credit used once', async () => {
    const r = await request(app).post('/api/billing/quickconnect').set(as(3)).send({ state: 'TN' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, charged: '$0.00', credit_applied_cents: 2000, bondsman: { id: 501 }, lawyer: { id: 701 } });
    expect(fakeStripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(state.users.find(u => u.id === 3).credit_cents).toBe(500);
  });

  test('a partial credit lowers the PaymentIntent and is taken only after payment', async () => {
    state.users.find(u => u.id === 1).credit_cents = 500;
    const r = await request(app).post('/api/billing/quickconnect').set(as(1)).send({ lat: 36.16, lng: -86.78 });
    expect(r.body.amount_cents).toBe(1500);
    expect(state.users.find(u => u.id === 1).credit_cents).toBe(500);
    state.pis.get(r.body.payment_intent_id).status = 'succeeded';
    await request(app).post('/api/billing/quickconnect/confirm').set(as(1)).send({ payment_intent_id: r.body.payment_intent_id });
    expect(state.users.find(u => u.id === 1).credit_cents).toBe(0);
  });
});
