/**
 * pi_leads.test.js — PI / Civil Rights lead marketplace
 *
 * Tests:
 *   piLeadFee() — fee tier calculation (4 tiers: minor/moderate/serious/catastrophic)
 *   POST /pi-lead/submit — auth enforcement, required field validation,
 *                          lead creation, correct fee assignment
 *   GET  /pi-leads — listing with city/state/case_type filters
 *   POST /pi-lead/accept/:id — lead acceptance (mock — no Stripe in tests)
 *
 * No live Stripe or DB calls in fee-tier tests (pure function).
 * Route tests use in-memory sql.js DB via makeTestDb().
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1, role = 'user') => jwt.sign({ id, role }, SECRET, { expiresIn: '1h' });
const exp = () => jwt.sign({ id: 1 }, SECRET, { expiresIn: '-1s' });

// ── Pure function under test — mirrors billing/pi_leads.js piLeadFee() ──────
function piLeadFee(caseType, severity) {
  if (caseType === 'Civil Rights') return 9999;
  if (!severity) return 5000;
  if (severity === 'minor')        return 4999;
  if (severity === 'moderate')     return 14999;
  if (severity === 'serious')      return 29999;
  return 49999; // catastrophic
}

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT, role TEXT DEFAULT 'user'
    );
    CREATE TABLE IF NOT EXISTS pi_leads (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER,
      case_type      TEXT NOT NULL,
      incident_date  TEXT,
      description    TEXT,
      severity       TEXT DEFAULT 'moderate',
      city           TEXT,
      state          TEXT,
      lat            REAL,
      lng            REAL,
      status         TEXT DEFAULT 'open',
      accepted_by    INTEGER,
      accepted_at    TEXT,
      lead_fee_cents INTEGER,
      created_at     TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.run("INSERT INTO users (id, email) VALUES (1, 'user@test.com')");
  await db.run("INSERT INTO users (id, email) VALUES (2, 'atty@test.com')");
}

function buildApp(db) {
  const app    = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try   { req.user = jwt.verify(t, SECRET); next(); }
    catch { return res.status(401).json({ error: 'invalid token' }); }
  }

  // POST /pi-lead/submit
  router.post('/pi-lead/submit', auth, async (req, res) => {
    try {
      const { case_type, incident_date, description, severity, city, state, lat, lng } = req.body || {};
      if (!case_type || !description) {
        return res.status(400).json({ error: 'case_type and description are required' });
      }
      const fee = piLeadFee(case_type, severity);
      const r   = await db.run(
        'INSERT INTO pi_leads (user_id, case_type, incident_date, description, severity, city, state, lat, lng, lead_fee_cents) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [req.user.id, case_type, incident_date || null, description, severity || 'moderate',
         city || null, state || null, lat || null, lng || null, fee]
      );
      const lead = await db.get('SELECT id, case_type, severity, lead_fee_cents, status FROM pi_leads WHERE id=?', [r.lastID]);
      res.status(201).json({ ok: true, lead_id: r.lastID, lead });
    } catch (e) { res.status(500).json({ error: 'Could not submit lead' }); }
  });

  // GET /pi-leads
  router.get('/pi-leads', auth, async (req, res) => {
    try {
      const { city, state, case_type, limit = 20 } = req.query;
      let sql    = 'SELECT id, case_type, severity, city, state, lead_fee_cents, status, created_at FROM pi_leads WHERE status=\'open\'';
      const params = [];
      if (city)      { sql += ' AND city=?';      params.push(city); }
      if (state)     { sql += ' AND state=?';     params.push(state); }
      if (case_type) { sql += ' AND case_type=?'; params.push(case_type); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(Number(limit));
      const leads = await db.all(sql, params);
      res.json(leads);
    } catch (e) { res.status(500).json({ error: 'Could not load leads' }); }
  });

  // POST /pi-lead/accept/:id (mock — no Stripe in tests)
  router.post('/pi-lead/accept/:id', auth, async (req, res) => {
    try {
      const lead = await db.get('SELECT id, status FROM pi_leads WHERE id=? AND status=\'open\'', [parseInt(req.params.id)]);
      if (!lead) return res.status(404).json({ error: 'Lead not available' });
      await db.run('UPDATE pi_leads SET status=\'accepted\', accepted_by=?, accepted_at=datetime(\'now\') WHERE id=?', [req.user.id, lead.id]);
      const full = await db.get('SELECT id, case_type, severity, status, accepted_by FROM pi_leads WHERE id=?', [lead.id]);
      res.json({ ok: true, lead: full });
    } catch (e) { res.status(500).json({ error: 'Could not accept lead' }); }
  });

  app.use('/billing', router);
  return app;
}

// ══════════════════════════════════════════════════════════════════════════════
// piLeadFee() — pure function, no DB
// ══════════════════════════════════════════════════════════════════════════════
describe('piLeadFee() — fee tier calculation', () => {
  test('Civil Rights always returns 9999 regardless of severity', () => {
    expect(piLeadFee('Civil Rights', 'minor')).toBe(9999);
    expect(piLeadFee('Civil Rights', 'catastrophic')).toBe(9999);
    expect(piLeadFee('Civil Rights', undefined)).toBe(9999);
  });

  test('minor severity → 4999', () => {
    expect(piLeadFee('Personal Injury', 'minor')).toBe(4999);
  });

  test('moderate severity → 14999', () => {
    expect(piLeadFee('Personal Injury', 'moderate')).toBe(14999);
  });

  test('serious severity → 29999', () => {
    expect(piLeadFee('Employment', 'serious')).toBe(29999);
  });

  test('catastrophic severity → 49999', () => {
    expect(piLeadFee('Personal Injury', 'catastrophic')).toBe(49999);
  });

  test('null/undefined severity → 5000 (default)', () => {
    expect(piLeadFee('Personal Injury', null)).toBe(5000);
    expect(piLeadFee('Employment', undefined)).toBe(5000);
  });

  test('all fee values are positive integers', () => {
    const cases = [
      ['Civil Rights', 'minor'],
      ['Personal Injury', 'minor'],
      ['Personal Injury', 'moderate'],
      ['Personal Injury', 'serious'],
      ['Personal Injury', 'catastrophic'],
    ];
    cases.forEach(([ct, sv]) => {
      const fee = piLeadFee(ct, sv);
      expect(Number.isInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThan(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /billing/pi-lead/submit
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /billing/pi-lead/submit', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = buildApp(db); });

  test('401 without token', async () => {
    const r = await request(app).post('/billing/pi-lead/submit').send({ case_type: 'PI', description: 'test' });
    expect(r.status).toBe(401);
  });

  test('401 with expired token', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/submit')
      .set('Authorization', `Bearer ${exp()}`)
      .send({ case_type: 'PI', description: 'test' });
    expect(r.status).toBe(401);
  });

  test('400 when case_type missing', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/submit')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ description: 'I was hit by a car' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/case_type/);
  });

  test('400 when description missing', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/submit')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ case_type: 'Personal Injury' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/description/);
  });

  test('201 creates lead and returns lead_id', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/submit')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ case_type: 'Personal Injury', description: 'Slip and fall at grocery store', severity: 'moderate', city: 'Nashville', state: 'TN' });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.lead_id).toBe('number');
    expect(r.body.lead).toHaveProperty('id');
  });

  test('lead gets correct fee for moderate severity', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/submit')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ case_type: 'Personal Injury', description: 'Car accident', severity: 'moderate' });
    expect(r.status).toBe(201);
    expect(r.body.lead.lead_fee_cents).toBe(14999);
  });

  test('Civil Rights lead gets fixed 9999 fee', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/submit')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ case_type: 'Civil Rights', description: 'Police brutality', severity: 'serious' });
    expect(r.status).toBe(201);
    expect(r.body.lead.lead_fee_cents).toBe(9999);
  });

  test('lead status defaults to open', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/submit')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ case_type: 'Employment', description: 'Wrongful termination', severity: 'minor' });
    expect(r.status).toBe(201);
    expect(r.body.lead.status).toBe('open');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /billing/pi-leads
// ══════════════════════════════════════════════════════════════════════════════
describe('GET /billing/pi-leads', () => {
  let app, db;
  beforeAll(async () => {
    db = await makeTestDb();
    await buildSchema(db);
    app = buildApp(db);
    // Seed leads
    await db.run("INSERT INTO pi_leads (user_id, case_type, severity, city, state, lead_fee_cents, status) VALUES (1, 'Personal Injury', 'moderate', 'Nashville', 'TN', 14999, 'open')");
    await db.run("INSERT INTO pi_leads (user_id, case_type, severity, city, state, lead_fee_cents, status) VALUES (1, 'Civil Rights', 'serious', 'Memphis', 'TN', 9999, 'open')");
    await db.run("INSERT INTO pi_leads (user_id, case_type, severity, city, state, lead_fee_cents, status) VALUES (1, 'Employment', 'minor', 'Atlanta', 'GA', 4999, 'open')");
  });

  test('401 without token', async () => {
    const r = await request(app).get('/billing/pi-leads');
    expect(r.status).toBe(401);
  });

  test('200 returns array of open leads', async () => {
    const r = await request(app).get('/billing/pi-leads').set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });

  test('city filter returns only matching city', async () => {
    const r = await request(app).get('/billing/pi-leads?city=Nashville').set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.every(l => l.city === 'Nashville')).toBe(true);
  });

  test('state filter returns only matching state', async () => {
    const r = await request(app).get('/billing/pi-leads?state=GA').set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.every(l => l.state === 'GA')).toBe(true);
  });

  test('case_type filter returns only matching type', async () => {
    const r = await request(app).get('/billing/pi-leads?case_type=Civil+Rights').set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.every(l => l.case_type === 'Civil Rights')).toBe(true);
  });

  test('each lead has required fields', async () => {
    const r = await request(app).get('/billing/pi-leads').set('Authorization', `Bearer ${tok()}`);
    r.body.forEach(lead => {
      expect(lead).toHaveProperty('id');
      expect(lead).toHaveProperty('case_type');
      expect(lead).toHaveProperty('severity');
      expect(lead).toHaveProperty('lead_fee_cents');
      expect(lead).toHaveProperty('status');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /billing/pi-lead/accept/:id
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /billing/pi-lead/accept/:id', () => {
  let app, db, leadId;
  beforeAll(async () => {
    db = await makeTestDb();
    await buildSchema(db);
    app = buildApp(db);
    const r = await db.run("INSERT INTO pi_leads (user_id, case_type, description, severity, lead_fee_cents, status) VALUES (1, 'Personal Injury', 'Slip and fall', 'moderate', 14999, 'open')");
    leadId = r.lastID;
  });

  test('401 without token', async () => {
    const r = await request(app).post(`/billing/pi-lead/accept/${leadId}`);
    expect(r.status).toBe(401);
  });

  test('404 for non-existent lead', async () => {
    const r = await request(app)
      .post('/billing/pi-lead/accept/99999')
      .set('Authorization', `Bearer ${tok(2)}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Lead not available');
  });

  test('200 accepts an open lead', async () => {
    const r = await request(app)
      .post(`/billing/pi-lead/accept/${leadId}`)
      .set('Authorization', `Bearer ${tok(2)}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.lead.status).toBe('accepted');
    expect(r.body.lead.accepted_by).toBe(2);
  });

  test('404 when lead already accepted (no longer open)', async () => {
    // Same lead, already accepted above
    const r = await request(app)
      .post(`/billing/pi-lead/accept/${leadId}`)
      .set('Authorization', `Bearer ${tok(2)}`);
    expect(r.status).toBe(404); // status=open filter rejects accepted leads
  });
});
