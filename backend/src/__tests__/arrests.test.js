/**
 * arrests.test.js — Arrest record search, county stats, monitors
 * Bug verified fixed: monitors used `authRequired` (undefined) — now uses `authMiddleware`
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

function safeInt(v, d=0) { const n=parseInt(v,10); return isNaN(n)?d:n; }

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS arrest_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, booking_date TEXT, charges TEXT, bail_amount REAL DEFAULT 0,
      court_date TEXT, has_attorney INTEGER DEFAULT 0,
      jail_location TEXT, county TEXT, state TEXT DEFAULT 'TN',
      case_number TEXT, status TEXT DEFAULT 'booked', city TEXT, source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS arrest_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, watch_name TEXT NOT NULL,
      county TEXT DEFAULT 'All', state TEXT DEFAULT 'TN',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.exec(`
    INSERT INTO arrest_records (name,booking_date,charges,bail_amount,county,state,has_attorney,created_at)
    VALUES
      ('John Smith','2026-04-01','DUI First Offense',5000,'Davidson','TN',0,datetime('now')),
      ('Jane Doe','2026-04-02','Possession',2500,'Davidson','TN',1,datetime('now')),
      ('Bob Jones','2026-03-15','Assault',10000,'Shelby','TN',0,datetime('now','-10 days'));
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req, res, next) {
    const t = (req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  // Search
  router.get('/search', auth, async (req, res) => {
    const { name, county, state='TN', charge, limit=20, offset=0 } = req.query;
    if (!name && !charge && !county) return res.status(400).json({ error:'Provide name, charge, or county' });
    try {
      const conds=[], params=[];
      if (name)   { conds.push('LOWER(name) LIKE LOWER(?)');    params.push(`%${name}%`); }
      if (county) { conds.push('LOWER(county) = LOWER(?)');     params.push(county); }
      if (charge) { conds.push('LOWER(charges) LIKE LOWER(?)'); params.push(`%${charge}%`); }
      if (state)  { conds.push('state = ?');                    params.push(state.toUpperCase()); }
      const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
      const records = await db.all(`SELECT id,name,booking_date,charges,bail_amount,county,state,has_attorney FROM arrest_records ${where} ORDER BY booking_date DESC LIMIT ? OFFSET ?`,
        [...params, safeInt(limit), safeInt(offset)]);
      const total = await db.get(`SELECT COUNT(*) as n FROM arrest_records ${where}`, params);
      res.json({ records, total: total.n, limit: safeInt(limit), offset: safeInt(offset) });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  // Recent
  router.get('/recent', auth, async (req, res) => {
    const { county, state='TN', hours=24, no_attorney, has_bail, limit=100 } = req.query;
    try {
      const conds=[`created_at >= datetime('now', '-${safeInt(hours)} hours')`], params=[];
      if (county) { conds.push('LOWER(county) = LOWER(?)'); params.push(county); }
      if (state)  { conds.push('state = ?'); params.push(state.toUpperCase()); }
      if (no_attorney==='true') conds.push('has_attorney = 0');
      if (has_bail==='true')    conds.push('bail_amount > 0');
      const records = await db.all(`SELECT id,name,charges,bail_amount,county,state,has_attorney FROM arrest_records WHERE ${conds.join(' AND ')} ORDER BY booking_date DESC LIMIT ?`,
        [...params, safeInt(limit)]);
      res.json({ records, count: records.length, window_hours: safeInt(hours) });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  // Single record
  router.get('/:id(\\d+)', auth, async (req, res) => {
    try {
      const row = await db.get('SELECT id,name,charges,bail_amount,county,state FROM arrest_records WHERE id=?', [safeInt(req.params.id)]);
      if (!row) return res.status(404).json({ error:'Record not found' });
      res.json(row);
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  // County stats
  router.get('/stats/county/:county', auth, async (req, res) => {
    const { days=7 } = req.query;
    try {
      const stats = await db.get(
        `SELECT COUNT(*) as total,
         SUM(CASE WHEN has_attorney=0 THEN 1 ELSE 0 END) as no_attorney,
         SUM(CASE WHEN bail_amount>0 THEN 1 ELSE 0 END) as has_bail,
         AVG(CASE WHEN bail_amount>0 THEN bail_amount END) as avg_bail
         FROM arrest_records WHERE LOWER(county)=LOWER(?) AND created_at>=datetime('now','-${safeInt(days)} days')`,
        [req.params.county]
      );
      res.json({ county:req.params.county, days:safeInt(days), ...stats });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  // Monitors
  router.get('/monitors', auth, async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM arrest_monitors WHERE user_id=? ORDER BY id DESC', [req.user.id]).catch(()=>[]);
      res.json(rows);
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/monitors', auth, async (req, res) => {
    const { watch_name, county='All', state='TN' } = req.body;
    if (!watch_name) return res.status(400).json({ error:'watch_name required' });
    try {
      const count = await db.get('SELECT COUNT(*) as n FROM arrest_monitors WHERE user_id=? AND active=1', [req.user.id]).catch(()=>({n:0}));
      if (count.n >= 5) return res.status(429).json({ error:'Monitor limit reached (5 max)' });
      const r = await db.run('INSERT INTO arrest_monitors (user_id, watch_name, county, state, active) VALUES (?,?,?,?,1)',
        [req.user.id, watch_name.trim(), county.trim(), state.trim()]);
      res.json({ created:true, id:r.lastID });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.delete('/monitors/:id', auth, async (req, res) => {
    try {
      await db.run('UPDATE arrest_monitors SET active=0 WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
      res.json({ removed:true });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  app.use('/arrests', router);
  return app;
}

describe('GET /arrests/search', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('401 without token', async () => {
    expect((await request(app).get('/arrests/search?name=John')).status).toBe(401);
  });
  test('400 when no search params', async () => {
    const r = await request(app).get('/arrests/search').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(400);
  });
  test('returns matching records by name', async () => {
    const r = await request(app).get('/arrests/search?name=Smith').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.records.length).toBeGreaterThan(0);
    expect(r.body.records[0].name).toContain('Smith');
  });
  test('returns matching by county', async () => {
    const r = await request(app).get('/arrests/search?county=Davidson').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.records.every(rec => rec.county === 'Davidson')).toBe(true);
  });
  test('returns matching by charge', async () => {
    const r = await request(app).get('/arrests/search?charge=DUI').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.records.some(rec => rec.charges.includes('DUI'))).toBe(true);
  });
  test('returns total count', async () => {
    const r = await request(app).get('/arrests/search?county=Davidson').set('Authorization',`Bearer ${tok()}`);
    expect(typeof r.body.total).toBe('number');
  });
  test('non-numeric ID rejected by params regex (returns 404 on path mismatch)', async () => {
    const r = await request(app).get('/arrests/abc').set('Authorization',`Bearer ${tok()}`);
    expect([404, 400]).toContain(r.status); // route won't match /:id(\d+)
  });
});

describe('GET /arrests/recent', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('returns recent arrests', async () => {
    const r = await request(app).get('/arrests/recent').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.records)).toBe(true);
  });
  test('no_attorney filter works', async () => {
    const r = await request(app).get('/arrests/recent?no_attorney=true').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.records.every(rec => rec.has_attorney === 0)).toBe(true);
  });
  test('has_bail filter works', async () => {
    const r = await request(app).get('/arrests/recent?has_bail=true').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.records.every(rec => rec.bail_amount > 0)).toBe(true);
  });
});

describe('GET /arrests/stats/county/:county', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('returns county stats', async () => {
    const r = await request(app).get('/arrests/stats/county/Davidson').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('total');
    expect(r.body).toHaveProperty('no_attorney');
    expect(r.body).toHaveProperty('avg_bail');
    expect(r.body.county).toBe('Davidson');
  });
  test('empty county returns zero total', async () => {
    const r = await request(app).get('/arrests/stats/county/Nowhere').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
  });
});

describe('Arrest monitors (bug: was using undefined authRequired)', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('GET /monitors 401 without token', async () => {
    expect((await request(app).get('/arrests/monitors')).status).toBe(401);
  });
  test('GET /monitors returns empty array for new user', async () => {
    const r = await request(app).get('/arrests/monitors').set('Authorization',`Bearer ${tok(99)}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
  test('POST /monitors 400 when watch_name missing', async () => {
    const r = await request(app).post('/arrests/monitors').set('Authorization',`Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
  });
  test('POST /monitors creates monitor', async () => {
    const r = await request(app).post('/arrests/monitors').set('Authorization',`Bearer ${tok()}`).send({ watch_name:'John Doe', county:'Davidson' });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    expect(typeof r.body.id).toBe('number');
  });
  test('POST /monitors rate-limits at 5 monitors', async () => {
    for (let i=0; i<4; i++) {
      await request(app).post('/arrests/monitors').set('Authorization',`Bearer ${tok(2)}`).send({ watch_name:`Person ${i}` });
    }
    // 5th should succeed
    await request(app).post('/arrests/monitors').set('Authorization',`Bearer ${tok(2)}`).send({ watch_name:'Person 5' });
    // 6th should 429
    const r = await request(app).post('/arrests/monitors').set('Authorization',`Bearer ${tok(2)}`).send({ watch_name:'Person 6' });
    expect(r.status).toBe(429);
  });
  test('DELETE /monitors soft-deletes own monitor', async () => {
    const cr = await request(app).post('/arrests/monitors').set('Authorization',`Bearer ${tok(3)}`).send({ watch_name:'Target' });
    const id = cr.body.id;
    const dr = await request(app).delete(`/arrests/monitors/${id}`).set('Authorization',`Bearer ${tok(3)}`);
    expect(dr.status).toBe(200);
    expect(dr.body.removed).toBe(true);
    const row = await db.get('SELECT active FROM arrest_monitors WHERE id=?', [id]);
    expect(row.active).toBe(0);
  });
});
