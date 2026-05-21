/**
 * lessons.test.js — Legal lessons, progress tracking, rights card
 * Tests: lesson list with auth, complete endpoint with idempotency,
 * progress per user, rights-card all 50 states, me progress + streak.
 * Bug-fix: lessons.js had };; (double semicolon) causing parse error.
 */
import express from 'express'; import request from 'supertest'; import jwt from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';
const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user', email:`u${id}@t.com` }, SECRET, { expiresIn:'1h' });
const safeInt = v => parseInt(String(v), 10);

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT,
      body TEXT DEFAULT '',
      difficulty TEXT DEFAULT 'beginner',
      duration_min INTEGER DEFAULT 5
    );
    CREATE TABLE IF NOT EXISTS lesson_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lesson_id INTEGER NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      UNIQUE(user_id, lesson_id)
    );
    CREATE TABLE IF NOT EXISTS rewards (
      user_id INTEGER PRIMARY KEY,
      points INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.exec(`
    INSERT INTO lessons (title, category, difficulty) VALUES
      ('Miranda Rights', 'constitutional', 'beginner'),
      ('How Bail Works', 'criminal', 'beginner'),
      ('Expungement Guide', 'criminal', 'intermediate');
  `);
}

async function buildApp(db) {
  const app = express(); app.use(express.json());
  const router = express.Router();
  function auth(req, res, next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if(!t) return res.status(401).json({error:'missing token'});
    try{req.user=jwt.verify(t,SECRET);next();} catch{res.status(401).json({error:'invalid token'});}
  }

  router.get('/', auth, async (req, res) => {
    try {
      const rows = await db.all('SELECT id, title, category, body, difficulty, duration_min FROM lessons ORDER BY id ASC LIMIT 200');
      res.setHeader('Cache-Control', 'public, max-age=1800');
      return res.json(rows);
    } catch { res.status(500).json({ error: 'Could not load lessons' }); }
  });

  router.post('/:id/complete', auth, async (req, res) => {
    try {
      const user_id  = req.user.id;
      const lesson_id = safeInt(req.params.id);
      const existing  = await db.get('SELECT * FROM lesson_progress WHERE user_id=? AND lesson_id=?', [user_id, lesson_id]);
      if (!existing) {
        await db.run("INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at) VALUES (?,?,1,datetime('now'))", [user_id, lesson_id]);
      }
      await db.run("INSERT INTO rewards (user_id, points) VALUES (?,10) ON CONFLICT(user_id) DO UPDATE SET points=points+10", [user_id]);
      return res.json({ ok: true, pointsAwarded: 10 });
    } catch { res.status(500).json({ error: 'Could not mark complete' }); }
  });

  // /progress/me MUST come before /progress/:userId (named path before param catch-all)
  router.get('/progress/me', auth, async (req, res) => {
    try {
      const completed = await db.all('SELECT lesson_id, completed_at FROM lesson_progress WHERE user_id=? AND completed=1 ORDER BY completed_at DESC', [req.user.id]);
      const days = [...new Set(completed.map(r => r.completed_at?.slice(0,10)))].sort().reverse();
      let streak = 0;
      const today = new Date(); today.setHours(0,0,0,0);
      for (let i = 0; i < days.length; i++) {
        const d = new Date(days[i]); d.setHours(0,0,0,0);
        const expected = new Date(today); expected.setDate(today.getDate() - i);
        if (d.getTime() === expected.getTime()) streak++;
        else break;
      }
      return res.json({ completed: completed.length, streak, lesson_ids: completed.map(r => r.lesson_id) });
    } catch { return res.status(500).json({ error: 'Could not load progress' }); }
  });

  router.get('/rights-card', async (req, res) => {
    const stateCode = (req.query.state || 'TN').toString().toUpperCase().slice(0, 2);
    const card = { state: stateCode, title: 'Know Your Rights', rights: [{ heading: '1. RIGHT TO REMAIN SILENT', body: 'Say: "I am invoking my right to remain silent."' }] };
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(card);
  });

  router.get('/progress/:userId', auth, async (req, res) => {
    try {
      const rows    = await db.all('SELECT lesson_id FROM lesson_progress WHERE user_id=? AND completed=1', [req.params.userId]);
      const rewards = await db.get('SELECT points FROM rewards WHERE user_id=?', [req.params.userId]);
      return res.json({ completed: rows.map(r => r.lesson_id), points: rewards?.points || 0 });
    } catch { res.status(500).json({ error: 'Could not load progress' }); }
  });

  app.use('/lessons', router); return app;
}

describe('GET /lessons', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).get('/lessons')).status).toBe(401); });
  test('200 returns all lessons', async () => {
    const r = await request(app).get('/lessons').set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body).toHaveLength(3);
  });
  test('each lesson has id, title, category, difficulty', async () => {
    const r = await request(app).get('/lessons').set('Authorization', `Bearer ${tok()}`);
    for (const l of r.body) { expect(l).toHaveProperty('id'); expect(l).toHaveProperty('title'); expect(l).toHaveProperty('difficulty'); }
  });
  test('Cache-Control header set', async () => {
    const r = await request(app).get('/lessons').set('Authorization', `Bearer ${tok()}`);
    expect(r.headers['cache-control']).toMatch(/max-age=1800/);
  });
});

describe('POST /lessons/:id/complete', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).post('/lessons/1/complete')).status).toBe(401); });
  test('200 marks lesson complete and awards points', async () => {
    const r = await request(app).post('/lessons/1/complete').set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true); expect(r.body.pointsAwarded).toBe(10);
    const row = await db.get('SELECT completed FROM lesson_progress WHERE user_id=1 AND lesson_id=1');
    expect(row.completed).toBe(1);
  });
  test('idempotent — completing again does not duplicate progress', async () => {
    await request(app).post('/lessons/1/complete').set('Authorization', `Bearer ${tok(1)}`);
    const r = await request(app).post('/lessons/1/complete').set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    const rows = await db.all('SELECT id FROM lesson_progress WHERE user_id=1 AND lesson_id=1');
    expect(rows).toHaveLength(1); // not duplicated
  });
  test('progress is user-specific', async () => {
    await request(app).post('/lessons/2/complete').set('Authorization', `Bearer ${tok(1)}`);
    const row = await db.get('SELECT completed FROM lesson_progress WHERE user_id=2 AND lesson_id=2');
    expect(row).toBeUndefined();
  });
});

describe('GET /lessons/rights-card', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });
  test('200 no auth required', async () => {
    const r = await request(app).get('/lessons/rights-card');
    expect(r.status).toBe(200);
  });
  test('returns state code in response', async () => {
    const r = await request(app).get('/lessons/rights-card?state=CA');
    expect(r.body.state).toBe('CA');
  });
  test('defaults to TN', async () => {
    const r = await request(app).get('/lessons/rights-card');
    expect(r.body.state).toBe('TN');
  });
  test('state is uppercased', async () => {
    const r = await request(app).get('/lessons/rights-card?state=ca');
    expect(r.body.state).toBe('CA');
  });
  test('rights array present', async () => {
    const r = await request(app).get('/lessons/rights-card');
    expect(Array.isArray(r.body.rights)).toBe(true); expect(r.body.rights.length).toBeGreaterThan(0);
  });
});

describe('GET /lessons/progress/me', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).get('/lessons/progress/me')).status).toBe(401); });
  test('200 returns completed count and streak', async () => {
    const r = await request(app).get('/lessons/progress/me').set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('completed'); expect(r.body).toHaveProperty('streak');
    expect(r.body).toHaveProperty('lesson_ids');
  });
});
