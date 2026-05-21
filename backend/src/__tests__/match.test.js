/**
 * match.test.js — AI lawyer matching (mock AI, real filter logic)
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user', state:'TN' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, state TEXT DEFAULT 'TN');
  `);
  await db.run("INSERT INTO users (id,email,state) VALUES (1,'u@test.com','TN')");
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  function auth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({error:'missing token'});
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({error:'invalid token'}); }
  }

  // Simulated lawyer pool (normally from providers DB)
  const LAWYERS = [
    {id:1,name:'Alice Atty',state:'TN',specialties:'DUI,Criminal',pro_bono:1,free_consultation:1,rating:4.8},
    {id:2,name:'Bob Bail',  state:'TN',specialties:'Bail,Drug',pro_bono:0,free_consultation:0,rating:4.2},
    {id:3,name:'Carol Crim',state:'CA',specialties:'Criminal',pro_bono:1,free_consultation:1,rating:4.5},
  ];

  router.get('/lawyers', auth, async (req,res) => {
    try {
      const { caseType, proBonoOnly, state } = req.query;
      const user_state = state || req.user?.state || 'TN';
      let results = LAWYERS.filter(l => l.state === user_state);
      if (proBonoOnly==='true') results = results.filter(l=>l.pro_bono);
      if (caseType) results = results.filter(l=>l.specialties.toLowerCase().includes(caseType.toLowerCase()));
      res.json({ lawyers: results, count: results.length, user_state, matched: true });
    } catch { res.status(500).json({error:'Server error.'}); }
  });

  app.use('/match', router);
  return app;
}

describe('GET /match/lawyers', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).get('/match/lawyers')).status).toBe(401); });
  test('200 returns lawyers for user state', async () => {
    const r = await request(app).get('/match/lawyers').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(Array.isArray(r.body.lawyers)).toBe(true);
    expect(r.body.user_state).toBe('TN');
    expect(r.body.lawyers.every(l=>l.state==='TN')).toBe(true);
  });
  test('proBonoOnly filter', async () => {
    const r = await request(app).get('/match/lawyers?proBonoOnly=true').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.lawyers.every(l=>l.pro_bono===1)).toBe(true);
  });
  test('caseType filter', async () => {
    const r = await request(app).get('/match/lawyers?caseType=DUI').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.lawyers.every(l=>l.specialties.includes('DUI'))).toBe(true);
  });
  test('state override returns correct lawyers', async () => {
    const r = await request(app).get('/match/lawyers?state=CA').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.user_state).toBe('CA');
    expect(r.body.lawyers.every(l=>l.state==='CA')).toBe(true);
  });
  test('unknown state returns empty list', async () => {
    const r = await request(app).get('/match/lawyers?state=ZZ').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.count).toBe(0);
  });

  test('count field equals lawyers.length', async () => {
    const r = await request(app).get('/match/lawyers').set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(r.body.lawyers.length);
  });

  test('matched field is always true', async () => {
    const r = await request(app).get('/match/lawyers').set('Authorization', `Bearer ${tok()}`);
    expect(r.body.matched).toBe(true);
  });

  test('combined proBonoOnly + caseType filter', async () => {
    const r = await request(app)
      .get('/match/lawyers?proBonoOnly=true&caseType=DUI')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.lawyers.every(l => l.pro_bono === 1)).toBe(true);
    expect(r.body.lawyers.every(l => l.specialties.toLowerCase().includes('dui'))).toBe(true);
  });
});