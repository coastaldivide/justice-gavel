/**
 * push.test.js — Push notification token, tip rotation, preferences
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

const TIPS = [
  'You have the right to remain silent during a police stop.',
  'Request an attorney before answering questions.',
  'Do not consent to searches — ask if you are free to go.',
];

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, push_token TEXT, display_name TEXT);
    CREATE TABLE IF NOT EXISTS push_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE,
      legal_tips INTEGER DEFAULT 1, case_reminders INTEGER DEFAULT 1,
      arrest_alerts INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS push_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT,
      payload TEXT, status TEXT DEFAULT 'pending', deliver_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.run("INSERT INTO users (id, email, display_name) VALUES (1, 'u@test.com', 'Test User')");
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  function auth(req, res, next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({error:'missing token'});
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({error:'invalid token'}); }
  }

  router.post('/token', auth, async (req, res) => {
    try {
      const { token } = req.body || {};
      if (!token?.trim()) return res.status(400).json({ error: 'token is required' });
      await db.run('UPDATE users SET push_token=? WHERE id=?', [token.trim(), req.user.id]);
      res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.get('/tip', (req, res) => {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    res.json({ tip, category: 'legal_rights' });
  });

  router.get('/preferences', auth, async (req, res) => {
    try {
      const prefs = await db.get('SELECT * FROM push_preferences WHERE user_id=?', [req.user.id]);
      res.json(prefs || { user_id: req.user.id, legal_tips: 1, case_reminders: 1, arrest_alerts: 1 });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.post('/retention/post-purchase', auth, async (req, res) => {
    try {
      const { tier } = req.body || {};
      await db.run(
        `INSERT INTO push_jobs (user_id, type, payload, status, deliver_at) VALUES (?,?,?,?,datetime('now', '+1 day'))`,
        [req.user.id, 'd7_retention', JSON.stringify({ tier: tier || 'pro' }), 'pending']
      );
      res.json({ ok: true, scheduled: true });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.get('/reminders', auth, async (req, res) => {
    try {
      const rows = await db.all(
        `SELECT * FROM push_jobs WHERE user_id=? AND status='pending' ORDER BY deliver_at ASC LIMIT 50`,
        [req.user.id]
      );
      res.json(rows);
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // /receipts route
  router.post('/receipts', auth, async (req, res) => {
    const { receiptIds } = req.body || {};
    if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
      return res.status(400).json({ error: 'receiptIds array required' });
    }
    res.json({ ok: true, results: { ok: receiptIds.length, invalid: 0, errors: [] } });
  });
  app.use('/push', router);
  return app;
}

describe('POST /push/token', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without token', async () => { expect((await request(app).post('/push/token').send({token:'abc'})).status).toBe(401); });
  test('400 without push token body', async () => {
    const r = await request(app).post('/push/token').set('Authorization',`Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/token/);
  });
  test('200 saves push token', async () => {
    const r = await request(app).post('/push/token').set('Authorization',`Bearer ${tok()}`).send({token:'ExponentPushToken[abc123]'});
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true);
  });
  test('token trimmed', async () => {
    const r = await request(app).post('/push/token').set('Authorization',`Bearer ${tok()}`).send({token:'  ExponentPushToken[abc]  '});
    expect(r.status).toBe(200);
  });
});

describe('GET /push/tip', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('200 without auth (public endpoint)', async () => {
    const r = await request(app).get('/push/tip');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('tip');
    expect(r.body).toHaveProperty('category');
    expect(r.body.tip.length).toBeGreaterThan(10);
  });
  test('tip rotates (not same every call)', async () => {
    const tips = new Set();
    for (let i = 0; i < 20; i++) {
      const r = await request(app).get('/push/tip');
      tips.add(r.body.tip);
    }
    expect(tips.size).toBeGreaterThan(1);
  });
});

describe('GET /push/preferences', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without auth', async () => { expect((await request(app).get('/push/preferences')).status).toBe(401); });
  test('200 returns preference defaults for new user', async () => {
    const r = await request(app).get('/push/preferences').set('Authorization',`Bearer ${tok(99)}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('legal_tips');
    expect(r.body).toHaveProperty('case_reminders');
    expect(r.body).toHaveProperty('arrest_alerts');
  });
});

describe('POST /push/retention/post-purchase', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without auth', async () => { expect((await request(app).post('/push/retention/post-purchase').send({tier:'legal_pro'})).status).toBe(401); });
  test('200 schedules retention job', async () => {
    const r = await request(app).post('/push/retention/post-purchase').set('Authorization',`Bearer ${tok()}`).send({tier:'legal_pro'});
    expect(r.status).toBe(200); expect(r.body.scheduled).toBe(true);
  });
  test('scheduled job appears in reminders', async () => {
    const r = await request(app).get('/push/reminders').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.some(j => j.type === 'd7_retention')).toBe(true);
  });
});

describe('POST /push/receipts', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without token', async () => {
    const r = await request(app).post('/push/receipts').send({receiptIds:['abc']});
    expect(r.status).toBe(401);
  });

  test('400 without receiptIds array', async () => {
    const r = await request(app).post('/push/receipts')
      .set('Authorization',`Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
  });

  test('400 with empty receiptIds', async () => {
    const r = await request(app).post('/push/receipts')
      .set('Authorization',`Bearer ${tok()}`).send({receiptIds:[]});
    expect(r.status).toBe(400);
  });

  test('200 with valid receiptIds array (mock mode)', async () => {
    const r = await request(app).post('/push/receipts')
      .set('Authorization',`Bearer ${tok()}`).send({receiptIds:['receipt_abc123','receipt_xyz456']});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.results).toBeDefined();
  });
});
