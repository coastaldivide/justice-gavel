/**
 * courthouses.test.js — Courthouse lookup
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = () => jwt.sign({ id:1, role:'user' }, SECRET, { expiresIn:'1h' });
const safeInt = (v, d=50) => { const n=parseInt(v,10); return isNaN(n)?d:n; };

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS courthouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, address TEXT, city TEXT, state TEXT,
      county TEXT, phone TEXT, hours TEXT, website TEXT
    );
  `);
  await db.exec(`
    INSERT INTO courthouses (name, address, city, state, county) VALUES
      ('Davidson County Criminal Court','1 Public Square','Nashville','TN','Davidson'),
      ('Shelby County Criminal Court','201 Poplar Ave','Memphis','TN','Shelby'),
      ('Hamilton County Court','625 Georgia Ave','Chattanooga','TN','Hamilton');
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req, res, next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  router.get('/', auth, async (req, res) => {
    try {
      const { city, state, q, limit=50 } = req.query;
      let sql='SELECT * FROM courthouses WHERE 1=1';
      const params=[];
      if (city)  { sql+=' AND city=?';  params.push(city); }
      if (state) { sql+=' AND state=?'; params.push(state); }
      if (q)     { sql+=' AND (name LIKE ? OR address LIKE ? OR county LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
      sql+=` ORDER BY city ASC LIMIT ?`;
      params.push(safeInt(limit)||50);
      const rows = await db.all(sql, params);
      res.setHeader('Cache-Control','public, max-age=86400');
      res.json(rows);
    } catch { res.status(500).json({ error:'Could not load courthouses' }); }
  });

  router.get('/:id', auth, async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM courthouses WHERE id=?', [safeInt(req.params.id)]);
      if (!row) return res.status(404).json({ error:'Not found' });
      res.json(row);
    } catch { res.status(500).json({ error:'Could not load courthouse' }); }
  });

  app.use('/courthouses', router);
  return app;
}

describe('GET /courthouses', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without token', async () => { expect((await request(app).get('/courthouses')).status).toBe(401); });
  test('200 returns all courthouses', async () => {
    const r = await request(app).get('/courthouses').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(3);
  });
  test('city filter returns matching only', async () => {
    const r = await request(app).get('/courthouses?city=Nashville').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.every(c=>c.city==='Nashville')).toBe(true);
  });
  test('state filter works', async () => {
    const r = await request(app).get('/courthouses?state=TN').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(3);
  });
  test('q text search across name, address, county', async () => {
    const r = await request(app).get('/courthouses?q=Shelby').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.some(c=>c.county==='Shelby')).toBe(true);
  });
  test('sets Cache-Control header', async () => {
    const r = await request(app).get('/courthouses').set('Authorization',`Bearer ${tok()}`);
    expect(r.headers['cache-control']).toContain('max-age=86400');
  });
});

describe('GET /courthouses/:id', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('200 returns single courthouse', async () => {
    const r = await request(app).get('/courthouses/1').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(1);
    expect(r.body).toHaveProperty('name');
  });
  test('404 for missing id', async () => {
    const r = await request(app).get('/courthouses/9999').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(404);
  });
  test('non-numeric id returns 404 (safeInt returns 0, no matching row)', async () => {
    const r = await request(app).get('/courthouses/abc').set('Authorization',`Bearer ${tok()}`);
    expect([404, 400]).toContain(r.status);
  });
});
