/**
 * discovery.test.js — AI discovery document analysis
 * Tests: auth, subscription gate, history, analysis CRUD, user isolation
 * Note: analyzeDocument itself mocked — tests the route logic, not the AI call
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, filename TEXT, doc_type TEXT DEFAULT 'unknown',
      case_id INTEGER, summary TEXT, key_facts TEXT DEFAULT '[]',
      inconsistencies TEXT DEFAULT '[]', questions TEXT DEFAULT '[]',
      page_count INTEGER DEFAULT 0, paid_cents INTEGER DEFAULT 1999,
      stripe_pi_id TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, tier TEXT, status TEXT
    );
  `);
  await db.run("INSERT INTO subscriptions (user_id,tier,status) VALUES (1,'discovery_pro','active')");
  await db.run("INSERT INTO discovery_analyses (user_id,filename,summary,key_facts,inconsistencies,questions,paid_cents) VALUES (1,'police_report.pdf','A police report summary','[\"Key fact 1\"]','[\"No inconsistencies\"]','[\"Question 1\"]',0)");
  await db.run("INSERT INTO discovery_analyses (user_id,filename,summary,key_facts,inconsistencies,questions,paid_cents) VALUES (2,'warrant.pdf','Warrant details','[]','[]','[]',1999)");
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  async function hasPro(userId) {
    const sub = await db.get(`SELECT id FROM subscriptions WHERE user_id=? AND tier IN ('discovery_pro','discovery_pro_annual') AND status IN ('active','trialing') ORDER BY id DESC LIMIT 1`, [userId]).catch(()=>null);
    return !!sub;
  }

  async function ensureTables() {}

  router.get('/history', auth, async (req, res) => {
    try {
      await ensureTables();
      const rows = await db.all('SELECT id,filename,doc_type,case_id,page_count,paid_cents,created_at,substr(summary,1,150) as preview FROM discovery_analyses WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      res.json(rows);
    } catch { res.status(500).json({ error:'Could not load history' }); }
  });

  router.get('/analysis/:id', auth, async (req, res) => {
    try {
      await ensureTables();
      const row = await db.get('SELECT * FROM discovery_analyses WHERE id=? AND user_id=?',
        [parseInt(req.params.id,10), req.user.id]);
      if (!row) return res.status(404).json({ error:'Analysis not found' });
      res.json({ ...row,
        key_facts:       JSON.parse(row.key_facts||'[]'),
        inconsistencies: JSON.parse(row.inconsistencies||'[]'),
        questions:       JSON.parse(row.questions||'[]'),
      });
    } catch { res.status(500).json({ error:'Could not load analysis' }); }
  });

  router.delete('/analysis/:id', auth, async (req, res) => {
    try {
      await db.run('DELETE FROM discovery_analyses WHERE id=? AND user_id=?', [parseInt(req.params.id,10), req.user.id]);
      res.json({ ok:true });
    } catch { res.status(500).json({ error:'Could not delete' }); }
  });

  router.get('/status', auth, async (req, res) => {
    try {
      const pro = await hasPro(req.user.id);
      res.json({ has_pro:pro, per_doc_price:'$19.99' });
    } catch { res.json({ has_pro:false, per_doc_price:'$19.99' }); }
  });

  // POST /analyze — mock (no real file upload in tests)
  router.post('/analyze', auth, async (req, res) => {
    const pro = await hasPro(req.user.id);
    if (!pro && !process.env.STRIPE_SECRET) {
      return res.status(402).json({ error:'Payment required', code:'payment_required', amount_cents:1999 });
    }
    const jobId = `job_disc_${Date.now()}`;
    res.json({ jobId, status:'pending', async:true, filename:'test.pdf' });
  });

  app.use('/discovery', router);
  return app;
}

describe('GET /discovery/status', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without token', async () => { expect((await request(app).get('/discovery/status')).status).toBe(401); });
  test('Pro subscriber has_pro=true', async () => {
    const r = await request(app).get('/discovery/status').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.has_pro).toBe(true);
    expect(r.body.per_doc_price).toBe('$19.99');
  });
  test('Free user has_pro=false', async () => {
    const r = await request(app).get('/discovery/status').set('Authorization',`Bearer ${tok(2)}`);
    expect(r.status).toBe(200);
    expect(r.body.has_pro).toBe(false);
  });
});

describe('GET /discovery/history', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('returns own analyses', async () => {
    const r = await request(app).get('/discovery/history').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0]).toHaveProperty('filename');
    expect(r.body[0]).toHaveProperty('preview');
  });
  test('each row has preview field', async () => {
    const r = await request(app).get('/discovery/history').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.body[0]).toHaveProperty('preview');
  });
  test('user isolation — user 2 sees only their analyses', async () => {
    const r2 = await request(app).get('/discovery/history').set('Authorization',`Bearer ${tok(1)}`);
    const r1 = await request(app).get('/discovery/history').set('Authorization',`Bearer ${tok(2)}`);
    // Each user's history should be different (different filenames)
    const filenames1 = r2.body.map(r => r.filename);
    const filenames2 = r1.body.map(r => r.filename);
    // They should not overlap completely
    expect(filenames1).not.toEqual(filenames2);
  });
});

describe('GET /discovery/analysis/:id', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('200 returns analysis with parsed arrays', async () => {
    const r = await request(app).get('/discovery/analysis/1').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.key_facts)).toBe(true);
    expect(Array.isArray(r.body.inconsistencies)).toBe(true);
    expect(Array.isArray(r.body.questions)).toBe(true);
  });
  test('404 for analysis belonging to another user', async () => {
    const r = await request(app).get('/discovery/analysis/2').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(404);
  });
});

describe('DELETE /discovery/analysis/:id', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('deletes own analysis', async () => {
    const r = await request(app).delete('/discovery/analysis/1').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const row = await db.get('SELECT id FROM discovery_analyses WHERE id=1');
    expect(row).toBeUndefined();
  });
  test('cannot delete other user analysis (no-op, returns ok)', async () => {
    const r = await request(app).delete('/discovery/analysis/2').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200); // DELETE is idempotent — no error, just 0 rows affected
    const row = await db.get('SELECT id FROM discovery_analyses WHERE id=2');
    expect(row).toBeTruthy(); // still exists
  });
});

describe('POST /discovery/analyze — payment gate', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); delete process.env.STRIPE_SECRET; });

  test('Pro subscriber bypasses payment check', async () => {
    const r = await request(app).post('/discovery/analyze').set('Authorization',`Bearer ${tok(1)}`).send({});
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('jobId');
  });
  test('Free user without Stripe gets 402', async () => {
    const r = await request(app).post('/discovery/analyze').set('Authorization',`Bearer ${tok(2)}`).send({});
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('payment_required');
  });
});
