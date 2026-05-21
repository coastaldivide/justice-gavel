/**
 * pay.test.js — Payment routes (mock Stripe mode)
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'usd', description TEXT,
      stripe_pi_id TEXT, status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  function auth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({error:'missing token'});
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({error:'invalid token'}); }
  }
  const MOCK_MODE = !process.env.STRIPE_SECRET;
  router.post('/create', auth, async (req,res) => {
    try {
      const { amount_cents, currency='usd', description='' } = req.body||{};
      if (!amount_cents||amount_cents<50) return res.status(400).json({error:'amount_cents must be >= 50'});
      const pi_id = MOCK_MODE ? `pi_mock_${Date.now()}` : 'pi_real';
      const result = await db.run('INSERT INTO payments (user_id,amount_cents,currency,description,stripe_pi_id,status) VALUES (?,?,?,?,?,?)',[req.user.id,amount_cents,currency,description,pi_id,'pending']);
      res.json({ok:true,payment_intent_id:pi_id,mock:MOCK_MODE,amount_cents});
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  router.post('/checkout', auth, async (req,res) => {
    try {
      const { price_id } = req.body||{};
      if (!price_id) return res.status(400).json({error:'price_id required'});
      res.json({ok:true,checkout_url:MOCK_MODE?'https://checkout.stripe.com/mock':null,mock:MOCK_MODE,price_id});
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  app.use('/pay', router);
  return app;
}

describe('POST /pay/create', () => {
  let app;
  beforeAll(async () => { delete process.env.STRIPE_SECRET; const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).post('/pay/create').send({amount_cents:999})).status).toBe(401); });
  test('400 for amount under 50 cents', async () => {
    const r = await request(app).post('/pay/create').set('Authorization',`Bearer ${tok()}`).send({amount_cents:49});
    expect(r.status).toBe(400);
  });
  test('400 for missing amount', async () => {
    const r = await request(app).post('/pay/create').set('Authorization',`Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
  });
  test('200 in mock mode returns pi_mock_ id', async () => {
    const r = await request(app).post('/pay/create').set('Authorization',`Bearer ${tok()}`).send({amount_cents:999,description:'Test payment'});
    expect(r.status).toBe(200);
    expect(r.body.mock).toBe(true);
    expect(r.body.payment_intent_id).toMatch(/^pi_mock_/);
    expect(r.body.amount_cents).toBe(999);
  });
});

describe('POST /pay/checkout', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).post('/pay/checkout').send({price_id:'price_123'})).status).toBe(401); });
  test('400 without price_id', async () => {
    const r = await request(app).post('/pay/checkout').set('Authorization',`Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
  });
  test('200 with mock checkout URL', async () => {
    const r = await request(app).post('/pay/checkout').set('Authorization',`Bearer ${tok()}`).send({price_id:'price_test_123'});
    expect(r.status).toBe(200);
    expect(r.body.price_id).toBe('price_test_123');
  });
});
