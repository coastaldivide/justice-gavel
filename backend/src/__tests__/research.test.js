/**
 * research.test.js — AI legal research session CRUD and subscription gate
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS research_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      title TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS research_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, tier TEXT, status TEXT
    );
  `);
  await db.run("INSERT INTO subscriptions (user_id, tier, status) VALUES (1, 'pro', 'active')");
  await db.run("INSERT INTO research_sessions (id, user_id, title) VALUES (10, 1, 'My Research')");
  await db.run("INSERT INTO research_messages (session_id, user_id, role, content) VALUES (10, 1, 'user', 'What is habeas corpus?')");
  await db.run("INSERT INTO research_messages (session_id, user_id, role, content) VALUES (10, 1, 'assistant', 'Habeas corpus...')");
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
  async function hasPro(userId) {
    const sub = await db.get(`SELECT id FROM subscriptions WHERE user_id=? AND status IN ('active','trialing')`, [userId]).catch(()=>null);
    return !!sub;
  }

  router.get('/status', auth, async (req, res) => {
    const pro = await hasPro(req.user.id);
    res.json({ has_research_pro: pro, per_question_price: '$4.99' });
  });

  router.get('/history', auth, async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM research_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      res.json(rows);
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.get('/session/:id', auth, async (req, res) => {
    try {
      const session = await db.get('SELECT * FROM research_sessions WHERE id=? AND user_id=?', [parseInt(req.params.id,10), req.user.id]);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const messages = await db.all('SELECT role, content, created_at FROM research_messages WHERE session_id=? ORDER BY created_at ASC', [session.id]);
      res.json({ ...session, messages });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.delete('/session/:id', auth, async (req, res) => {
    try {
      await db.run('DELETE FROM research_messages WHERE session_id=? AND user_id=?', [parseInt(req.params.id,10), req.user.id]);
      await db.run('DELETE FROM research_sessions WHERE id=? AND user_id=?', [parseInt(req.params.id,10), req.user.id]);
      res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.post('/ask', auth, async (req, res) => {
    const pro = await hasPro(req.user.id);
    if (!pro && !process.env.STRIPE_SECRET) {
      return res.status(402).json({ error: 'Research Pro subscription required', code: 'subscription_required' });
    }
    const { question = '' } = req.body || {};
    if (!question.trim()) return res.status(400).json({ error: 'question is required' });
    if (question.length > 2000) return res.status(400).json({ error: 'Question too long' });
    res.json({ jobId: `job_research_${Date.now()}`, status: 'pending', async: true });
  });

  app.use('/research', router);
  return app;
}

describe('GET /research/status', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).get('/research/status')).status).toBe(401); });
  test('Pro user has_research_pro=true', async () => {
    const r = await request(app).get('/research/status').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200); expect(r.body.has_research_pro).toBe(true);
  });
  test('Free user has_research_pro=false', async () => {
    const r = await request(app).get('/research/status').set('Authorization',`Bearer ${tok(99)}`);
    expect(r.status).toBe(200); expect(r.body.has_research_pro).toBe(false);
  });
  test('per_question_price present', async () => {
    const r = await request(app).get('/research/status').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.body.per_question_price).toBe('$4.99');
  });
});

describe('GET /research/history and session', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('history returns own sessions', async () => {
    const r = await request(app).get('/research/history').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200); expect(Array.isArray(r.body)).toBe(true);
  });
  test('empty history for new user', async () => {
    const r = await request(app).get('/research/history').set('Authorization',`Bearer ${tok(50)}`);
    expect(r.status).toBe(200); expect(r.body).toHaveLength(0);
  });
  test('session returns messages', async () => {
    const r = await request(app).get('/research/session/10').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200); expect(Array.isArray(r.body.messages)).toBe(true);
    expect(r.body.messages.length).toBe(2);
  });
  test('404 for another users session', async () => {
    const r = await request(app).get('/research/session/10').set('Authorization',`Bearer ${tok(2)}`);
    expect(r.status).toBe(404);
  });
  test('DELETE session removes it', async () => {
    const r = await request(app).delete('/research/session/10').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true);
  });
});

describe('POST /research/ask — subscription gate', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); delete process.env.STRIPE_SECRET; });
  test('401 without auth', async () => { expect((await request(app).post('/research/ask').send({question:'test'})).status).toBe(401); });
  test('400 without question', async () => {
    const r = await request(app).post('/research/ask').set('Authorization',`Bearer ${tok(1)}`).send({});
    expect(r.status).toBe(400);
  });
  test('Pro subscriber can ask', async () => {
    const r = await request(app).post('/research/ask').set('Authorization',`Bearer ${tok(1)}`).send({question:'What is double jeopardy?'});
    expect(r.status).toBe(200); expect(r.body).toHaveProperty('jobId');
  });
  test('Free user gets 402', async () => {
    const r = await request(app).post('/research/ask').set('Authorization',`Bearer ${tok(99)}`).send({question:'What is double jeopardy?'});
    expect(r.status).toBe(402); expect(r.body.code).toBe('subscription_required');
  });
  test('Question over 2000 chars rejected', async () => {
    const r = await request(app).post('/research/ask').set('Authorization',`Bearer ${tok(1)}`).send({question:'x'.repeat(2001)});
    expect(r.status).toBe(400);
  });
});
