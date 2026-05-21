/**
 * resources.test.js — Legal resources and lessons routes
 *
 * Tests: list, search, category filter, auth optional,
 * pagination, lesson progress tracking.
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1) =>
  jwt.sign({ id, role: 'user', email: `u${id}@test.com` }, SECRET, { expiresIn: '1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT,
      body TEXT,
      url TEXT,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT,
      difficulty TEXT DEFAULT 'beginner',
      content TEXT,
      duration_min INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lesson_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lesson_id INTEGER NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      UNIQUE(user_id, lesson_id)
    );
  `);
  await db.exec(`
    INSERT INTO resources (title, category, body) VALUES
      ('Know Your Rights', 'constitutional', 'You have the right to remain silent.'),
      ('DUI Basics', 'criminal', 'First steps after a DUI arrest.'),
      ('Tenant Rights', 'civil', 'How to handle eviction notices.'),
      ('Immigration Basics', 'immigration', 'Understand your status and rights.');

    INSERT INTO lessons (title, category, difficulty, duration_min) VALUES
      ('Miranda Rights Explained', 'constitutional', 'beginner', 5),
      ('How Bail Works', 'criminal', 'beginner', 8),
      ('Expungement Guide', 'criminal', 'intermediate', 12),
      ('DUI Defense Strategies', 'criminal', 'advanced', 15);
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  function optAuth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (t) { try { req.user = jwt.verify(t, SECRET); } catch {} }
    next();
  }
  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  // GET /resources
  router.get('/resources', optAuth, async (req, res) => {
    try {
      const { category, q, limit = 20 } = req.query;
      let sql = 'SELECT * FROM resources WHERE 1=1';
      const params = [];
      if (category) { sql += ' AND category=?'; params.push(category); }
      if (q) { sql += ' AND (title LIKE ? OR body LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      sql += ` ORDER BY id ASC LIMIT ?`;
      params.push(Math.min(parseInt(limit, 10) || 20, 100));
      const rows = await db.all(sql, params);
      res.json({ resources: rows, count: rows.length });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // GET /lessons
  router.get('/lessons', optAuth, async (req, res) => {
    try {
      const { category, difficulty, limit = 20 } = req.query;
      let sql = 'SELECT * FROM lessons WHERE 1=1';
      const params = [];
      if (category)   { sql += ' AND category=?';   params.push(category); }
      if (difficulty) { sql += ' AND difficulty=?'; params.push(difficulty); }
      sql += ' ORDER BY difficulty ASC, id ASC LIMIT ?';
      params.push(Math.min(parseInt(limit, 10) || 20, 100));
      const rows = await db.all(sql, params);
      // Attach progress if authenticated
      let withProgress = rows;
      if (req.user) {
        const progress = await db.all(
          'SELECT lesson_id, completed FROM lesson_progress WHERE user_id=?',
          [req.user.id]
        );
        const progMap = Object.fromEntries(progress.map(p => [p.lesson_id, p.completed]));
        withProgress = rows.map(l => ({ ...l, completed: !!progMap[l.id] }));
      }
      res.json({ lessons: withProgress, count: withProgress.length });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // POST /lessons/:id/complete
  router.post('/lessons/:id/complete', auth, async (req, res) => {
    try {
      const lessonId = parseInt(req.params.id, 10);
      if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson ID' });
      const lesson = await db.get('SELECT id FROM lessons WHERE id=?', [lessonId]);
      if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
      await db.run(
        `INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at)
         VALUES (?,?,1,datetime('now'))
         ON CONFLICT(user_id, lesson_id) DO UPDATE SET completed=1, completed_at=datetime('now')`,
        [req.user.id, lessonId]
      );
      res.json({ ok: true, lesson_id: lessonId });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  app.use('/', router);
  return app;
}

describe('GET /resources', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('200 returns all resources without auth', async () => {
    const r = await request(app).get('/resources');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.resources)).toBe(true);
    expect(r.body.resources.length).toBe(4);
    expect(r.body).toHaveProperty('count', 4);
  });
  test('category filter works', async () => {
    const r = await request(app).get('/resources?category=criminal');
    expect(r.status).toBe(200);
    expect(r.body.resources.every(res => res.category === 'criminal')).toBe(true);
  });
  test('text search across title and body', async () => {
    const r = await request(app).get('/resources?q=DUI');
    expect(r.status).toBe(200);
    expect(r.body.resources.length).toBeGreaterThan(0);
    expect(r.body.resources.some(res =>
      res.title.toLowerCase().includes('dui') || res.body.toLowerCase().includes('dui')
    )).toBe(true);
  });
  test('limit enforced at 100', async () => {
    const r = await request(app).get('/resources?limit=9999');
    expect(r.status).toBe(200);
    expect(r.body.resources.length).toBeLessThanOrEqual(100);
  });
  test('unknown category returns empty', async () => {
    const r = await request(app).get('/resources?category=nonexistent');
    expect(r.status).toBe(200);
    expect(r.body.resources).toHaveLength(0);
  });
});

describe('GET /lessons', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('200 without auth — no completed field', async () => {
    const r = await request(app).get('/lessons');
    expect(r.status).toBe(200);
    expect(r.body.lessons.length).toBe(4);
    // Without auth, no completed field
    expect(r.body.lessons[0].completed).toBeUndefined();
  });
  test('difficulty filter', async () => {
    const r = await request(app).get('/lessons?difficulty=beginner');
    expect(r.status).toBe(200);
    expect(r.body.lessons.every(l => l.difficulty === 'beginner')).toBe(true);
  });
  test('with auth — completed field present', async () => {
    const r = await request(app).get('/lessons')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(typeof r.body.lessons[0].completed).toBe('boolean');
  });
  test('lessons are returned with all required fields', async () => {
    const r = await request(app).get('/lessons');
    expect(r.status).toBe(200);
    expect(r.body.lessons.length).toBe(4);
    // Each lesson has required fields
    for (const lesson of r.body.lessons) {
      expect(lesson).toHaveProperty('id');
      expect(lesson).toHaveProperty('title');
      expect(lesson).toHaveProperty('category');
      expect(lesson).toHaveProperty('difficulty');
    }
    // All expected difficulties present
    const diffs = r.body.lessons.map(l => l.difficulty);
    expect(diffs).toContain('beginner');
    expect(diffs).toContain('intermediate');
    expect(diffs).toContain('advanced');
  });
});

describe('POST /lessons/:id/complete', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('401 without token', async () => {
    const r = await request(app).post('/lessons/1/complete');
    expect(r.status).toBe(401);
  });
  test('400 for non-numeric lesson ID', async () => {
    const r = await request(app).post('/lessons/abc/complete')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(400);
  });
  test('404 for unknown lesson', async () => {
    const r = await request(app).post('/lessons/9999/complete')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(404);
  });
  test('200 marks lesson complete', async () => {
    const r = await request(app).post('/lessons/1/complete')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const row = await db.get('SELECT completed FROM lesson_progress WHERE user_id=1 AND lesson_id=1');
    expect(row.completed).toBe(1);
  });
  test('idempotent — completing twice does not error', async () => {
    await request(app).post('/lessons/1/complete').set('Authorization', `Bearer ${tok(1)}`);
    const r = await request(app).post('/lessons/1/complete').set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
  });
  test('progress is user-specific', async () => {
    await request(app).post('/lessons/2/complete').set('Authorization', `Bearer ${tok(1)}`);
    // User 2 has not completed lesson 2
    const row = await db.get('SELECT completed FROM lesson_progress WHERE user_id=2 AND lesson_id=2');
    expect(row).toBeUndefined();
  });
});
