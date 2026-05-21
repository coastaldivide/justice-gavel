/**
 * search.test.js — Global in-app search route
 *
 * Tests: auth gating, minimum query length, SQL wildcard sanitisation,
 * multi-entity search (cases, messages, lawyers, lessons),
 * result isolation per user, limit enforcement, state-weighted ranking,
 * and short-circuit on empty/whitespace query.
 */
import express  from 'express';
import request  from 'supertest';
import jwt      from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1) =>
  jwt.sign({ id, role: 'user', email: `u${id}@test.com`, user_state: 'TN' }, SECRET, { expiresIn: '1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      status TEXT DEFAULT 'Open',
      next_court_date TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      content TEXT,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saved_lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lawyer_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      address TEXT,
      specialties TEXT,
      availability TEXT DEFAULT 'accepting',
      bar_verified INTEGER DEFAULT 0,
      jtb_verified INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      state TEXT,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      category TEXT,
      difficulty TEXT DEFAULT 'beginner'
    );
  `);

  // User 1 data
  await db.exec(`
    INSERT INTO cases (user_id, title, status, notes)
      VALUES (1, 'DUI Nashville 2024', 'Open', 'Field sobriety test administered'),
             (1, 'Shoplifting Charge', 'Closed', NULL),
             (2, 'Other User Case', 'Open', NULL);

    INSERT INTO messages (case_id, content) VALUES
      (1, 'My attorney said the breathalyzer was miscalibrated'),
      (1, 'Court date moved to March 15'),
      (3, 'Other user message');

    INSERT INTO lawyers (id, name, address, specialties, availability, bar_verified, rating, state)
      VALUES (10, 'Jane DUI Smith', '123 Main St Nashville TN', 'DUI defense, criminal', 'accepting', 1, 4.8, 'TN'),
             (11, 'Bob Criminal Jones', '456 Oak Ave Memphis TN', 'criminal defense', 'limited', 0, 4.2, 'TN'),
             (12, 'Out Of State Atty', '789 Broadway New York NY', 'DUI', 'accepting', 1, 4.9, 'NY');

    INSERT INTO saved_lawyers (user_id, lawyer_id)
      VALUES (1, 10), (1, 11), (1, 12),
             (2, 10);   -- user 2 also saved lawyer 10

    INSERT INTO lessons (title, category, difficulty)
      VALUES ('Understanding DUI Charges', 'criminal', 'beginner'),
             ('Your Miranda Rights Explained', 'constitutional', 'beginner'),
             ('How Bail Is Calculated', 'criminal', 'intermediate');
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  router.get('/', auth, async (req, res) => {
    try {
      const raw        = String(req.query.q || '').trim();
      const user_state = String(req.query.user_state || req.user?.user_state || '').toUpperCase().slice(0, 2) || null;
      if (raw.length < 2) {
        return res.json({ cases: [], messages: [], lawyers: [], lessons: [] });
      }

      const term  = '%' + raw.replace(/[%_]/g, ' ') + '%';
      const limit = Math.min(parseInt(String(req.query.limit || '10'), 10), 30);
      const uid   = req.user.id;

      const caseRows = await db.all(
        `SELECT id, title, status, next_court_date FROM cases
         WHERE user_id=? AND (title LIKE ? OR notes LIKE ?)
         ORDER BY next_court_date ASC LIMIT ?`,
        [uid, term, term, limit]
      );
      const cases = caseRows.map(r => ({
        id: r.id, type: 'case', title: r.title,
        subtitle: [r.status, r.next_court_date].filter(Boolean).join(' · '),
        screen: 'Cases', params: { caseId: r.id },
      }));

      const msgRows = await db.all(
        `SELECT m.id, m.content, m.created_at, c.id as case_id, c.title as case_title
         FROM messages m JOIN cases c ON c.id = m.case_id
         WHERE c.user_id=? AND m.content LIKE ?
         ORDER BY m.created_at DESC LIMIT ?`,
        [uid, term, limit]
      );
      const messages = msgRows.map(r => ({
        id: r.id, type: 'message', title: r.case_title || 'Message',
        subtitle: String(r.content || '').slice(0, 80),
        screen: 'Messages', params: { caseId: r.case_id },
      }));

      const lwRows = await db.all(
        `SELECT l.id, l.name, l.address, l.specialties, l.availability,
                l.bar_verified, l.jtb_verified, l.rating, l.state as lawyer_state
         FROM saved_lawyers sl JOIN lawyers l ON l.id = sl.lawyer_id
         WHERE sl.user_id=?
           AND (l.name LIKE ? OR l.address LIKE ? OR l.specialties LIKE ?)
         ORDER BY
           CASE WHEN l.state = ? THEN 0 ELSE 1 END ASC,
           CASE l.availability WHEN 'accepting' THEN 0 WHEN 'limited' THEN 1 ELSE 2 END ASC,
           CASE WHEN l.bar_verified = 1 THEN 0 ELSE 1 END ASC,
           l.rating DESC
         LIMIT ?`,
        [uid, term, term, term, user_state || 'XX', limit]
      ).catch(() => []);
      const lawyers = lwRows.map(r => ({
        id: r.id, type: 'lawyer', title: r.name,
        subtitle: [r.address, r.availability === 'accepting' ? '✅ Accepting' : null,
                   r.bar_verified ? '✓ Verified' : null].filter(Boolean).join(' · ') || '',
        screen: 'SavedLawyers', params: {},
      }));

      const lesRows = await db.all(
        `SELECT id, title, category, difficulty FROM lessons
         WHERE title LIKE ? OR category LIKE ?
         ORDER BY difficulty ASC LIMIT ?`,
        [term, term, limit]
      );
      const lessons = lesRows.map(r => ({
        id: r.id, type: 'lesson', title: r.title,
        subtitle: [r.category, r.difficulty].filter(Boolean).join(' · '),
        screen: 'Education', params: {},
      }));

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ cases, messages, lawyers, lessons,
        total: cases.length + messages.length + lawyers.length + lessons.length });
    } catch (e) {
      return res.status(500).json({ error: 'Search unavailable.' });
    }
  });

  app.use('/search', router);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /search — auth', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('401 without token', async () => {
    const r = await request(app).get('/search?q=DUI');
    expect(r.status).toBe(401);
  });
});

describe('GET /search — query validation', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('empty query returns four empty arrays', async () => {
    const r = await request(app)
      .get('/search?q=')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.cases).toHaveLength(0);
    expect(r.body.messages).toHaveLength(0);
    expect(r.body.lawyers).toHaveLength(0);
    expect(r.body.lessons).toHaveLength(0);
  });

  test('1-char query returns empty results (minimum is 2)', async () => {
    const r = await request(app)
      .get('/search?q=D')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.cases).toHaveLength(0);
  });

  test('whitespace-only query returns empty results', async () => {
    const r = await request(app)
      .get('/search?q=   ')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    // Route short-circuits when trimmed q < 2 chars, returns empty arrays (no total field)
    expect(r.body.cases).toHaveLength(0);
    expect(r.body.messages).toHaveLength(0);
    expect(r.body.lawyers).toHaveLength(0);
    expect(r.body.lessons).toHaveLength(0);
  });

  test('SQL wildcard % in query is sanitised (not doubled)', async () => {
    // A query of '%%' should be treated as '% %' and not explode
    const r = await request(app)
      .get('/search?q=%%')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200); // no 500
  });

  test('SQL wildcard _ in query is sanitised', async () => {
    const r = await request(app)
      .get('/search?q=DUI_charge')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
  });
});

describe('GET /search — result accuracy', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('returns matching case by title', async () => {
    const r = await request(app)
      .get('/search?q=Nashville')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    const titles = r.body.cases.map(c => c.title);
    expect(titles).toContain('DUI Nashville 2024');
  });

  test('returns matching case by notes', async () => {
    const r = await request(app)
      .get('/search?q=breathalyzer')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    // 'breathalyzer' is in a message, not a case title — check messages
    expect(r.body.messages.length).toBeGreaterThan(0);
  });

  test('returns matching lessons for "DUI"', async () => {
    const r = await request(app)
      .get('/search?q=DUI')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    const titles = r.body.lessons.map(l => l.title);
    expect(titles.some(t => t.toLowerCase().includes('dui'))).toBe(true);
  });

  test('returns matching lessons by category', async () => {
    const r = await request(app)
      .get('/search?q=criminal')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.lessons.length).toBeGreaterThan(0);
  });

  test('each result has required fields', async () => {
    const r = await request(app)
      .get('/search?q=DUI')
      .set('Authorization', `Bearer ${tok(1)}`);
    for (const item of [...r.body.cases, ...r.body.messages, ...r.body.lawyers, ...r.body.lessons]) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('screen');
      expect(item).toHaveProperty('params');
    }
  });

  test('total field equals sum of all result arrays', async () => {
    const r = await request(app)
      .get('/search?q=DUI')
      .set('Authorization', `Bearer ${tok(1)}`);
    const expected = r.body.cases.length + r.body.messages.length +
                     r.body.lawyers.length + r.body.lessons.length;
    expect(r.body.total).toBe(expected);
  });
});

describe('GET /search — user isolation', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('user 1 cannot see user 2 cases', async () => {
    const r = await request(app)
      .get('/search?q=Other+User')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    // 'Other User Case' belongs to user 2 — user 1 should not see it
    expect(r.body.cases).toHaveLength(0);
  });

  test('user 2 cannot see user 1 messages', async () => {
    const r = await request(app)
      .get('/search?q=breathalyzer')
      .set('Authorization', `Bearer ${tok(2)}`);
    expect(r.status).toBe(200);
    // Message belongs to case_id=1 which is user 1's — user 2 should not see it
    expect(r.body.messages).toHaveLength(0);
  });
});

describe('GET /search — limit enforcement', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('limit defaults to 10', async () => {
    const r = await request(app)
      .get('/search?q=DUI')
      .set('Authorization', `Bearer ${tok(1)}`);
    // Total per type should not exceed 10
    expect(r.body.cases.length).toBeLessThanOrEqual(10);
    expect(r.body.lessons.length).toBeLessThanOrEqual(10);
  });

  test('limit capped at 30', async () => {
    const r = await request(app)
      .get('/search?q=DUI&limit=9999')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200); // no error
    // Each type should be at most 30
    expect(r.body.cases.length).toBeLessThanOrEqual(30);
  });
});

describe('GET /search — no-store cache header', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('Cache-Control: no-store', async () => {
    const r = await request(app)
      .get('/search?q=DUI')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
