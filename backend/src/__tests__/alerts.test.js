/**
 * alerts.test.js — Emergency alert route
 * Tests: validation, SMS vs email routing, contacts limit, DB persistence
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT, lat REAL, lng REAL, contact TEXT,
      method TEXT, status TEXT, message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function buildApp(db, smsCalls, emailCalls) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req, res, next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  router.post('/', auth, async (req, res) => {
    try {
      const { userName, contacts=[], lat, lng } = req.body||{};
      if (!userName || !Array.isArray(contacts) || contacts.length===0 || lat==null || lng==null) {
        return res.status(400).json({ error:'userName, contacts[], lat, lng required' });
      }
      const link = `https://maps.google.com/?q=${lat},${lng}`;
      const msg  = `Emergency: ${userName} needs help. Location: ${link}`;
      const results = [];
      for (const c of contacts.slice(0,2)) {
        if (!c) continue;
        if (c.includes('@')) {
          emailCalls.push({ to:c, text:msg });
          await db.run('INSERT INTO alerts (user_name,lat,lng,contact,method,status,message) VALUES (?,?,?,?,?,?,?)',
            [userName,lat,lng,c,'email','sent',msg]);
          results.push({ contact:c, method:'email', mock:true });
        } else {
          smsCalls.push({ to:c, body:msg });
          await db.run('INSERT INTO alerts (user_name,lat,lng,contact,method,status,message) VALUES (?,?,?,?,?,?,?)',
            [userName,lat,lng,c,'sms','sent',msg]);
          results.push({ contact:c, method:'sms', mock:true });
        }
      }
      res.json({ ok:true, results });
    } catch (e) { res.status(500).json({ error:'Alert failed' }); }
  });

  app.use('/alerts', router);
  return app;
}

describe('POST /alerts — validation', () => {
  let app, smsCalls, emailCalls;
  beforeAll(async () => {
    smsCalls=[]; emailCalls=[];
    const db=await makeTestDb(); await buildSchema(db);
    app=await buildApp(db, smsCalls, emailCalls);
  });

  test('401 without token', async () => {
    const r = await request(app).post('/alerts').send({ userName:'X', contacts:['5551234567'], lat:36, lng:-86 });
    expect(r.status).toBe(401);
  });
  test('400 when userName missing', async () => {
    const r = await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ contacts:['5551234567'], lat:36, lng:-86 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/userName/);
  });
  test('400 when contacts empty array', async () => {
    const r = await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ userName:'Alice', contacts:[], lat:36, lng:-86 });
    expect(r.status).toBe(400);
  });
  test('400 when lat/lng missing', async () => {
    const r = await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ userName:'Alice', contacts:['5551234567'] });
    expect(r.status).toBe(400);
  });
});

describe('POST /alerts — routing and limits', () => {
  let app, db, smsCalls, emailCalls;
  beforeAll(async () => {
    smsCalls=[]; emailCalls=[];
    db=await makeTestDb(); await buildSchema(db);
    app=await buildApp(db, smsCalls, emailCalls);
  });
  beforeEach(() => { smsCalls.length=0; emailCalls.length=0; });

  test('SMS sent for phone contact', async () => {
    const r = await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ userName:'Bob', contacts:['6155551234'], lat:36.1, lng:-86.8 });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(smsCalls.length).toBe(1);
    expect(emailCalls.length).toBe(0);
    expect(r.body.results[0].method).toBe('sms');
  });
  test('email sent for @ contact', async () => {
    const r = await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ userName:'Carol', contacts:['family@example.com'], lat:36.1, lng:-86.8 });
    expect(r.status).toBe(200);
    expect(emailCalls.length).toBe(1);
    expect(smsCalls.length).toBe(0);
    expect(r.body.results[0].method).toBe('email');
  });
  test('max 2 contacts processed', async () => {
    const r = await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ userName:'Dave', contacts:['c1@e.com','c2@e.com','c3@e.com','c4@e.com'], lat:36, lng:-86 });
    expect(r.status).toBe(200);
    expect(r.body.results.length).toBeLessThanOrEqual(2);
  });
  test('alert saved to DB', async () => {
    await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ userName:'Eve', contacts:['5557654321'], lat:35.0, lng:-85.0 });
    const row = await db.get("SELECT * FROM alerts WHERE user_name='Eve'");
    expect(row).toBeTruthy();
    expect(row.method).toBe('sms');
    expect(row.status).toBe('sent');
  });
  test('message includes location link', async () => {
    await request(app).post('/alerts').set('Authorization',`Bearer ${tok()}`).send({ userName:'Frank', contacts:['f@e.com'], lat:36.1, lng:-86.8 });
    expect(emailCalls[0].text).toContain('maps.google.com');
  });
});
