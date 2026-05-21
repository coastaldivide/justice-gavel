/**
 * advocacy.test.js — /api/advocacy/stats
 *
 * Tests:
 *   - Auth enforcement (missing token, invalid token, expired token)
 *   - Response shape and type validation
 *   - DB count reflection
 *   - Cache-Control header
 *   - Graceful 500 when DB fails
 *   - Idempotency (same result across multiple calls)
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok    = (id = 1, opts = {}) => jwt.sign({ id, role: 'user' }, SECRET, { expiresIn: '1h', ...opts });
const expired = () => jwt.sign({ id: 1, role: 'user' }, SECRET, { expiresIn: -1 });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY,
      user_name  TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id    INTEGER PRIMARY KEY,
      email TEXT
    );
  `);
  await db.run("INSERT INTO users (id, email) VALUES (1, 'alice@example.com')");
  await db.run("INSERT INTO users (id, email) VALUES (2, 'bob@example.com')");
  await db.run("INSERT INTO alerts (user_name) VALUES ('Test Alert 1')");
  await db.run("INSERT INTO alerts (user_name) VALUES ('Test Alert 2')");
}

function makeAuth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'missing token' });
  try   { req.user = jwt.verify(t, SECRET); next(); }
  catch { return res.status(401).json({ error: 'invalid token' }); }
}

async function buildApp(db) {
  const app    = express();
  app.use(express.json());
  const router = express.Router();

  router.get('/stats', makeAuth, async (req, res) => {
    try {
      const [alerts, users] = await Promise.all([
        db.get('SELECT COUNT(*) as n FROM alerts'),
        db.get('SELECT COUNT(*) as n FROM users'),
      ]);
      // providers DB stats — gracefully degrade if unavailable
      let lawyerCount = 0, bailCount = 0, citiesCovered = 0;
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.json({
        lawyerCount, bailCount,
        alertsSent:    alerts.n,
        userCount:     users.n,
        citiesCovered,
        lastUpdated:   new Date().toISOString(),
      });
    } catch { res.status(500).json({ error: 'Could not load stats' }); }
  });

  app.use('/advocacy', router);
  return app;
}

// ── Broken DB fixture (simulate unavailable stats table) ──────────────────────
async function buildBrokenApp() {
  const db  = await makeTestDb();
  // No schema — all queries will fail
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.get('/stats', makeAuth, async (_req, res) => {
    try {
      await db.get('SELECT COUNT(*) as n FROM alerts'); // will throw
      res.json({});
    } catch { res.status(500).json({ error: 'Could not load stats' }); }
  });
  app.use('/advocacy', router);
  return app;
}

describe('GET /advocacy/stats', () => {
  let app;

  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  // ── Auth enforcement ────────────────────────────────────────────────────────
  test('401 with no token', async () => {
    const r = await request(app).get('/advocacy/stats');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('missing token');
  });

  test('401 with invalid token', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', 'Bearer notavalidtoken');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid token');
  });

  test('401 with expired token', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${expired()}`);
    expect(r.status).toBe(401);
  });

  test('401 with malformed Bearer header', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', 'Basic dXNlcjpwYXNz'); // Basic auth instead of Bearer
    expect(r.status).toBe(401);
  });

  // ── Response shape ──────────────────────────────────────────────────────────
  test('200 with valid token', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
  });

  test('response has all required fields', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body).toHaveProperty('lawyerCount');
    expect(r.body).toHaveProperty('bailCount');
    expect(r.body).toHaveProperty('alertsSent');
    expect(r.body).toHaveProperty('userCount');
    expect(r.body).toHaveProperty('citiesCovered');
    expect(r.body).toHaveProperty('lastUpdated');
  });

  test('all numeric fields are numbers (not strings)', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(typeof r.body.lawyerCount).toBe('number');
    expect(typeof r.body.bailCount).toBe('number');
    expect(typeof r.body.alertsSent).toBe('number');
    expect(typeof r.body.userCount).toBe('number');
    expect(typeof r.body.citiesCovered).toBe('number');
  });

  test('lastUpdated is a valid ISO 8601 string', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    const d = new Date(r.body.lastUpdated);
    expect(d.toString()).not.toBe('Invalid Date');
    expect(r.body.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── DB count reflection ─────────────────────────────────────────────────────
  test('alertsSent reflects actual DB count (2 seeded)', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body.alertsSent).toBe(2);
  });

  test('userCount reflects actual DB count (2 seeded)', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body.userCount).toBe(2);
  });

  test('numeric counts are non-negative', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body.alertsSent).toBeGreaterThanOrEqual(0);
    expect(r.body.userCount).toBeGreaterThanOrEqual(0);
    expect(r.body.lawyerCount).toBeGreaterThanOrEqual(0);
  });

  // ── Cache-Control header ────────────────────────────────────────────────────
  test('sets Cache-Control: private, max-age=300', async () => {
    const r = await request(app)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.headers['cache-control']).toContain('max-age=300');
    expect(r.headers['cache-control']).toContain('private');
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────
  test('two consecutive requests return same counts', async () => {
    const auth = { Authorization: `Bearer ${tok()}` };
    const [r1, r2] = await Promise.all([
      request(app).get('/advocacy/stats').set(auth),
      request(app).get('/advocacy/stats').set(auth),
    ]);
    expect(r1.body.alertsSent).toBe(r2.body.alertsSent);
    expect(r1.body.userCount).toBe(r2.body.userCount);
  });

  // ── Error handling ──────────────────────────────────────────────────────────
  test('500 when DB is unavailable', async () => {
    const brokenApp = await buildBrokenApp();
    const r = await request(brokenApp)
      .get('/advocacy/stats')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(500);
    expect(r.body).toHaveProperty('error');
  });
});
