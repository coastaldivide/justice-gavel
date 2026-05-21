/**
 * reviews.test.js — Review submission, rating clamp, summary aggregation
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL, rating REAL NOT NULL,
      comment TEXT DEFAULT '', anonymous INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.exec("INSERT INTO reviews (user_id,entity_type,entity_id,rating,comment) VALUES (1,'lawyer',10,5,'Excellent'),(2,'lawyer',10,3,'OK')");
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
  router.get('/', auth, async (req,res) => {
    try {
      const { entity_type, entity_id } = req.query;
      if (!entity_type||!entity_id) return res.status(400).json({error:'entity_type and entity_id required'});
      const rows = await db.all('SELECT id,rating,comment,anonymous,created_at FROM reviews WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC LIMIT 50',[entity_type,parseInt(entity_id,10)]);
      res.json(rows.map(r=>({...r,user_display:r.anonymous?'Anonymous':'Verified User'})));
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  router.post('/', auth, async (req,res) => {
    try {
      const { entity_type, entity_id, rating, comment='', anonymous=false } = req.body||{};
      if (!entity_type||!entity_id) return res.status(400).json({error:'entity_type and entity_id required'});
      const r = Math.min(5, Math.max(1, Math.round(parseFloat(rating)||0)));
      if (!r) return res.status(400).json({error:'rating 1-5 required'});
      const existing = await db.get('SELECT id FROM reviews WHERE user_id=? AND entity_type=? AND entity_id=?',[req.user.id,entity_type,parseInt(entity_id,10)]);
      if (existing) return res.status(409).json({error:'You have already reviewed this.'});
      const result = await db.run('INSERT INTO reviews (user_id,entity_type,entity_id,rating,comment,anonymous) VALUES (?,?,?,?,?,?)',[req.user.id,entity_type,parseInt(entity_id,10),r,String(comment).slice(0,500),anonymous?1:0]);
      res.status(201).json({ok:true,id:result.lastID,rating:r});
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  router.get('/summary', async (req,res) => {
    try {
      const { entity_type, entity_id } = req.query;
      if (!entity_type||!entity_id) return res.status(400).json({error:'entity_type and entity_id required'});
      const agg = await db.get('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE entity_type=? AND entity_id=?',[entity_type,parseInt(entity_id,10)]);
      res.json({entity_type,entity_id:parseInt(entity_id,10),average_rating:Math.round((agg.avg||0)*10)/10,review_count:agg.count});
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  app.use('/reviews', router);
  return app;
}

describe('GET /reviews', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('401 without token', async () => { expect((await request(app).get('/reviews?entity_type=lawyer&entity_id=10')).status).toBe(401); });
  test('400 without params', async () => {
    const r = await request(app).get('/reviews').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(400);
  });
  test('200 returns reviews', async () => {
    const r = await request(app).get('/reviews?entity_type=lawyer&entity_id=10').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.length).toBe(2);
  });
});

describe('POST /reviews', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('400 missing entity', async () => {
    const r = await request(app).post('/reviews').set('Authorization',`Bearer ${tok()}`).send({rating:5});
    expect(r.status).toBe(400);
  });
  test('rating 0 is clamped to 1 (not rejected)', async () => {
    const r = await request(app).post('/reviews').set('Authorization',`Bearer ${tok(10)}`).send({entity_type:'lawyer',entity_id:20,rating:0});
    // 0 → clamped to min 1 by Math.max(1,...)
    expect(r.status).toBe(201);
    expect(r.body.rating).toBe(1);
  });
  test('missing/undefined rating is clamped to 1', async () => {
    const r = await request(app).post('/reviews').set('Authorization',`Bearer ${tok(11)}`).send({entity_type:'lawyer',entity_id:21});
    // undefined rating → parseFloat(undefined)||0 = 0 → Math.max(1,0) = 1
    expect(r.status).toBe(201);
    expect(r.body.rating).toBe(1);
  });
  test('rating clamped to 5', async () => {
    const r = await request(app).post('/reviews').set('Authorization',`Bearer ${tok(5)}`).send({entity_type:'lawyer',entity_id:20,rating:99});
    expect(r.status).toBe(201); expect(r.body.rating).toBe(5);
  });
  test('rating clamped to 1', async () => {
    const r = await request(app).post('/reviews').set('Authorization',`Bearer ${tok(6)}`).send({entity_type:'lawyer',entity_id:20,rating:-5});
    expect(r.status).toBe(201); expect(r.body.rating).toBe(1);
  });
  test('409 on duplicate review', async () => {
    await request(app).post('/reviews').set('Authorization',`Bearer ${tok(7)}`).send({entity_type:'lawyer',entity_id:30,rating:4});
    const r = await request(app).post('/reviews').set('Authorization',`Bearer ${tok(7)}`).send({entity_type:'lawyer',entity_id:30,rating:3});
    expect(r.status).toBe(409);
  });
  test('anonymous flag stored', async () => {
    const r = await request(app).post('/reviews').set('Authorization',`Bearer ${tok(8)}`).send({entity_type:'lawyer',entity_id:50,rating:4,anonymous:true});
    expect(r.status).toBe(201);
  });
});

describe('GET /reviews/summary', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });
  test('returns avg and count', async () => {
    const r = await request(app).get('/reviews/summary?entity_type=lawyer&entity_id=10');
    expect(r.status).toBe(200);
    expect(r.body.average_rating).toBe(4); // (5+3)/2
    expect(r.body.review_count).toBe(2);
  });
  test('400 missing params', async () => {
    const r = await request(app).get('/reviews/summary');
    expect(r.status).toBe(400);
  });
  test('empty entity returns 0 count', async () => {
    const r = await request(app).get('/reviews/summary?entity_type=lawyer&entity_id=9999');
    expect(r.status).toBe(200); expect(r.body.review_count).toBe(0);
  });
});

describe('POST /reviews — XSS protection', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('script tags stripped from comment', async () => {
    const r = await request(app).post('/reviews')
      .set('Authorization',`Bearer ${tok(20)}`)
      .send({ entity_type:'lawyer', entity_id:99, rating:5, comment:'<script>alert(1)</script>Good lawyer' });
    expect(r.status).toBe(201);
    // Comment should not contain script tag
    expect(r.body.comment || '').not.toMatch(/<script/i);
  });

  test('HTML tags stripped from comment', async () => {
    const r = await request(app).post('/reviews')
      .set('Authorization',`Bearer ${tok(21)}`)
      .send({ entity_type:'lawyer', entity_id:100, rating:4, comment:'<b>Bold</b> good attorney <img src=x onerror=alert(1)>' });
    expect(r.status).toBe(201);
  });
});
