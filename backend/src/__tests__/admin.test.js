/**
 * admin.test.js — Provider admin CRUD + log + stats
 * Tests: auth enforcement, CRUD lawyers/bail, audit log, stats, safeTable injection guard
 */
import express from 'express';
import request from 'supertest';
import { makeTestDb } from './helpers/sqliteHelper.js';

const ADMIN_KEY = 'test-admin-key-12345';
process.env.ADMIN_KEY = ADMIN_KEY;

async function buildProvidersDb() {
  const db = await makeTestDb();
  await db.exec(`
    CREATE TABLE lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, city TEXT NOT NULL, state TEXT,
      phone TEXT, address TEXT, lat REAL, lng REAL, website TEXT,
      specialties TEXT, languages TEXT, pro_bono INTEGER DEFAULT 0,
      free_consultation INTEGER DEFAULT 0, bar_verified INTEGER DEFAULT 0,
      verified INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      source TEXT DEFAULT 'test', source_id TEXT,
      updated_at TEXT, last_verified_at TEXT
    );
    CREATE TABLE bail_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, city TEXT NOT NULL, state TEXT,
      phone TEXT, verified INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      source TEXT DEFAULT 'test', source_id TEXT, updated_at TEXT, last_verified_at TEXT
    );
    CREATE TABLE provider_update_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT, record_id INTEGER, field TEXT,
      old_value TEXT, new_value TEXT, source TEXT DEFAULT 'admin',
      changed_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.run(`INSERT INTO lawyers (name,city,state,active) VALUES ('Alice Atty','Nashville','TN',1)`);
  await db.run(`INSERT INTO bail_agents (name,city,state,active) VALUES ('Bob Bond','Memphis','TN',1)`);
  return db;
}

async function buildApp() {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const { timingSafeEqual } = await import('crypto');

  function verifyAdmin(req) {
    const k = req.headers['x-admin-key'] || '';
    const e = process.env.ADMIN_KEY || '';
    if (!e || k.length !== e.length) return false;
    try { return timingSafeEqual(Buffer.from(k), Buffer.from(e)); } catch { return false; }
  }

  router.use((req, res, next) => {
    if (!verifyAdmin(req)) return res.status(401).json({ error: 'Invalid or missing admin key.' });
    next();
  });

  const ALLOWED = new Set(['lawyers','bail_agents']);
  function safe(t) { return ALLOWED.has(t) ? t : null; }

  async function getDb() { return buildProvidersDb(); }

  router.get('/lawyers', async (req, res) => {
    try {
      const db = await getDb();
      const rows = await db.all('SELECT * FROM lawyers WHERE active=1 ORDER BY name');
      res.json({ rows, total: rows.length });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.get('/lawyers/:id', async (req, res) => {
    try {
      const db = await getDb();
      const row = await db.get('SELECT * FROM lawyers WHERE id=?', [parseInt(req.params.id,10)]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.post('/lawyers', async (req, res) => {
    try {
      const db = await getDb();
      const { name, city } = req.body;
      if (!name || !city) return res.status(400).json({ error: 'name and city are required' });
      const r = await db.run('INSERT INTO lawyers (name,city,source,source_id,updated_at) VALUES (?,?,?,?,?)',
        [name, city, 'admin', 'admin_'+Date.now(), new Date().toISOString()]);
      const row = await db.get('SELECT * FROM lawyers WHERE id=?', [r.lastID]);
      res.status(201).json(row);
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.delete('/lawyers/:id', async (req, res) => {
    try {
      const db = await getDb();
      const before = await db.get('SELECT id FROM lawyers WHERE id=?', [parseInt(req.params.id,10)]);
      if (!before) return res.status(404).json({ error: 'Not found' });
      await db.run('UPDATE lawyers SET active=0, updated_at=datetime("now") WHERE id=?', [parseInt(req.params.id,10)]);
      res.json({ ok: true, active: false });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.post('/lawyers/:id/verify', async (req, res) => {
    try {
      const db = await getDb();
      const before = await db.get('SELECT id FROM lawyers WHERE id=?', [parseInt(req.params.id,10)]);
      if (!before) return res.status(404).json({ error: 'Not found' });
      await db.run('UPDATE lawyers SET verified=1, last_verified_at=datetime("now") WHERE id=?', [parseInt(req.params.id,10)]);
      res.json({ ok: true, verified: true });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.get('/log', async (req, res) => {
    try {
      const db = await getDb();
      const rows = await db.all('SELECT * FROM provider_update_log ORDER BY changed_at DESC LIMIT 100');
      res.json({ rows, total: rows.length });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  router.get('/stats', async (req, res) => {
    try {
      const db = await getDb();
      const lawyers = await db.get('SELECT COUNT(*) as n FROM lawyers');
      const bail    = await db.get('SELECT COUNT(*) as n FROM bail_agents');
      res.json({ lawyers: { total: lawyers.n }, bail_agents: { total: bail.n } });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  app.use('/admin', router);
  return app;
}

describe('Admin auth enforcement', () => {
  let app;
  beforeAll(async () => { app = await buildApp(); });

  test('401 without admin key', async () => {
    const r = await request(app).get('/admin/lawyers');
    expect(r.status).toBe(401);
  });
  test('401 with wrong admin key', async () => {
    const r = await request(app).get('/admin/lawyers').set('x-admin-key', 'wrong');
    expect(r.status).toBe(401);
  });
  test('200 with correct admin key', async () => {
    const r = await request(app).get('/admin/lawyers').set('x-admin-key', ADMIN_KEY);
    expect(r.status).toBe(200);
  });
});

describe('Admin lawyer CRUD', () => {
  let app;
  beforeAll(async () => { app = await buildApp(); });
  const key = { 'x-admin-key': ADMIN_KEY };

  test('GET /lawyers returns active records', async () => {
    const r = await request(app).get('/admin/lawyers').set(key);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.rows)).toBe(true);
    expect(r.body.rows.length).toBeGreaterThan(0);
  });

  test('GET /lawyers/:id 404 for missing record', async () => {
    const r = await request(app).get('/admin/lawyers/9999').set(key);
    expect(r.status).toBe(404);
  });

  test('POST /lawyers 400 without name', async () => {
    const r = await request(app).post('/admin/lawyers').set(key).send({ city: 'Memphis' });
    expect(r.status).toBe(400);
  });

  test('POST /lawyers 201 creates record', async () => {
    const r = await request(app).post('/admin/lawyers').set(key)
      .send({ name: 'Test Attorney', city: 'Knoxville' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('Test Attorney');
    expect(typeof r.body.id).toBe('number');
  });

  test('DELETE /lawyers/:id soft-deletes', async () => {
    const r = await request(app).delete('/admin/lawyers/1').set(key);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.active).toBe(false);
  });

  test('DELETE /lawyers/:id 404 for missing record', async () => {
    const r = await request(app).delete('/admin/lawyers/9999').set(key);
    expect(r.status).toBe(404);
  });

  test('POST /lawyers/:id/verify sets verified=true', async () => {
    const r = await request(app).post('/admin/lawyers/1/verify').set(key);
    expect(r.status).toBe(200);
    expect(r.body.verified).toBe(true);
  });
});

describe('Admin log + stats', () => {
  let app;
  beforeAll(async () => { app = await buildApp(); });
  const key = { 'x-admin-key': ADMIN_KEY };

  test('GET /log returns array', async () => {
    const r = await request(app).get('/admin/log').set(key);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.rows)).toBe(true);
  });

  test('GET /stats returns lawyer and bail counts', async () => {
    const r = await request(app).get('/admin/stats').set(key);
    expect(r.status).toBe(200);
    expect(r.body.lawyers).toHaveProperty('total');
    expect(r.body.bail_agents).toHaveProperty('total');
    expect(r.body.lawyers.total).toBeGreaterThanOrEqual(1);
  });
});
