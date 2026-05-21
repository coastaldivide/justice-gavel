/**
 * insurance.test.js — Insurance plan listing and quote generation
 *
 * Tests:
 *   GET  /insurance/plans — public endpoint, returns all plans
 *   POST /insurance/quote — auth-gated, returns monthly or annual quote
 *
 * Coverage:
 *   - Public access (no auth required for plans)
 *   - Auth enforcement on quote endpoint
 *   - Plan not found → 404
 *   - Monthly pricing: exact cents
 *   - Annual pricing: 20% discount, exact savings_cents
 *   - All three plans produce valid quotes
 *   - Response shape validation
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1) => jwt.sign({ id, role: 'user' }, SECRET, { expiresIn: '1h' });

const PLANS = [
  { id: 'basic',    name: 'Basic Legal Shield',  monthly_cents: 999,  features: ['AI chat 10/mo', 'Document library'] },
  { id: 'pro',      name: 'Pro Legal Shield',     monthly_cents: 1999, features: ['Unlimited AI chat', 'Attorney matching'] },
  { id: 'attorney', name: 'Attorney Pro',          monthly_cents: 4999, features: ['All Pro features', 'Case management'] },
];

const ANNUAL_DISCOUNT = 0.20; // 20% off annual billing

function buildApp() {
  const app    = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try   { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  router.get('/plans', (req, res) => res.json(PLANS));

  router.post('/quote', auth, (req, res) => {
    const { plan_id, annual = false } = req.body || {};
    const plan = PLANS.find(p => p.id === plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const monthly     = plan.monthly_cents;
    const fullYear    = monthly * 12;
    const total_cents = annual ? Math.round(fullYear * (1 - ANNUAL_DISCOUNT)) : monthly;
    const savings_cents = annual ? fullYear - total_cents : 0;

    res.json({
      plan_id,
      plan_name:     plan.name,
      monthly_cents: monthly,
      billed:        annual ? 'annual' : 'monthly',
      total_cents,
      savings_cents,
    });
  });

  app.use('/insurance', router);
  return app;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /insurance/plans
// ══════════════════════════════════════════════════════════════════════════════
describe('GET /insurance/plans', () => {
  const app = buildApp();

  test('200 returns all plans without auth', async () => {
    const r = await request(app).get('/insurance/plans');
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(3);
  });

  test('each plan has required fields', async () => {
    const r = await request(app).get('/insurance/plans');
    r.body.forEach(plan => {
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('name');
      expect(plan).toHaveProperty('monthly_cents');
      expect(plan).toHaveProperty('features');
      expect(typeof plan.monthly_cents).toBe('number');
      expect(Array.isArray(plan.features)).toBe(true);
    });
  });

  test('plan IDs are unique', async () => {
    const r  = await request(app).get('/insurance/plans');
    const ids = r.body.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('plans ordered by price ascending', async () => {
    const r = await request(app).get('/insurance/plans');
    for (let i = 1; i < r.body.length; i++) {
      expect(r.body[i].monthly_cents).toBeGreaterThanOrEqual(r.body[i - 1].monthly_cents);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /insurance/quote
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /insurance/quote', () => {
  const app = buildApp();

  // ── Auth enforcement ────────────────────────────────────────────────────────
  test('401 without token', async () => {
    const r = await request(app).post('/insurance/quote').send({ plan_id: 'basic' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBeTruthy();
  });

  test('401 with invalid token', async () => {
    const r = await request(app)
      .post('/insurance/quote')
      .set('Authorization', 'Bearer not.a.token')
      .send({ plan_id: 'basic' });
    expect(r.status).toBe(401);
  });

  // ── Plan validation ─────────────────────────────────────────────────────────
  test('404 for unknown plan_id', async () => {
    const r = await request(app)
      .post('/insurance/quote')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ plan_id: 'nonexistent' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Plan not found');
  });

  // ── Monthly pricing ─────────────────────────────────────────────────────────
  test('basic monthly: 999 cents, billed:monthly, savings:0', async () => {
    const r = await request(app)
      .post('/insurance/quote')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ plan_id: 'basic', annual: false });
    expect(r.status).toBe(200);
    expect(r.body.total_cents).toBe(999);
    expect(r.body.billed).toBe('monthly');
    expect(r.body.savings_cents).toBe(0);
  });

  test('pro monthly: 1999 cents', async () => {
    const r = await request(app)
      .post('/insurance/quote')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ plan_id: 'pro', annual: false });
    expect(r.status).toBe(200);
    expect(r.body.total_cents).toBe(1999);
    expect(r.body.savings_cents).toBe(0);
  });

  // ── Annual pricing — exact 20% discount ─────────────────────────────────────
  test('basic annual: exactly 20% off full year', async () => {
    const r = await request(app)
      .post('/insurance/quote')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ plan_id: 'basic', annual: true });
    expect(r.status).toBe(200);
    expect(r.body.billed).toBe('annual');
    // 999 * 12 = 11988 → 20% off = 9590.4 → Math.round = 9590
    expect(r.body.total_cents).toBe(Math.round(999 * 12 * 0.80));
    expect(r.body.savings_cents).toBe(999 * 12 - Math.round(999 * 12 * 0.80));
    expect(r.body.savings_cents).toBeGreaterThan(0);
  });

  test('pro annual: total < full year price', async () => {
    const r = await request(app)
      .post('/insurance/quote')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ plan_id: 'pro', annual: true });
    expect(r.status).toBe(200);
    expect(r.body.total_cents).toBeLessThan(1999 * 12);
    expect(r.body.savings_cents).toBeGreaterThan(0);
    expect(r.body.savings_cents).toBe(1999 * 12 - r.body.total_cents);
  });

  // ── Response shape ──────────────────────────────────────────────────────────
  test('quote response has all required fields', async () => {
    const r = await request(app)
      .post('/insurance/quote')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ plan_id: 'pro', annual: false });
    expect(r.body).toHaveProperty('plan_id');
    expect(r.body).toHaveProperty('plan_name');
    expect(r.body).toHaveProperty('monthly_cents');
    expect(r.body).toHaveProperty('billed');
    expect(r.body).toHaveProperty('total_cents');
    expect(r.body).toHaveProperty('savings_cents');
    expect(typeof r.body.total_cents).toBe('number');
    expect(typeof r.body.savings_cents).toBe('number');
  });

  // ── All plans quotable ───────────────────────────────────────────────────────
  test('all three plans return valid monthly quotes', async () => {
    for (const plan of PLANS) {
      const r = await request(app)
        .post('/insurance/quote')
        .set('Authorization', `Bearer ${tok()}`)
        .send({ plan_id: plan.id, annual: false });
      expect(r.status).toBe(200);
      expect(r.body.total_cents).toBe(plan.monthly_cents);
      expect(r.body.plan_id).toBe(plan.id);
    }
  });

  test('all three plans return valid annual quotes', async () => {
    for (const plan of PLANS) {
      const r = await request(app)
        .post('/insurance/quote')
        .set('Authorization', `Bearer ${tok()}`)
        .send({ plan_id: plan.id, annual: true });
      expect(r.status).toBe(200);
      expect(r.body.billed).toBe('annual');
      expect(r.body.savings_cents).toBeGreaterThan(0);
    }
  });
});
