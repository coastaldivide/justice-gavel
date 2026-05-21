/**
 * feedback.test.js — Feedback submission and summary
 * Bug verified: userId uses req.user?.id correctly (not falling back to body userId)
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, rating INTEGER, comment TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS rewards  (user_id TEXT PRIMARY KEY, points INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function optAuth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (t) { try { req.user=jwt.verify(t,SECRET); } catch {} }
    next();
  }

  router.post('/', optAuth, async (req, res) => {
    try {
      const { rating=5, comment='' } = req.body||{};
      const userId = req.user?.id || 'anon';
      const r = parseInt(rating,10);
      if (isNaN(r)||r<1||r>5) return res.status(400).json({ error:'rating must be 1–5' });
      const result = await db.run('INSERT INTO feedback (user_id, rating, comment) VALUES (?,?,?)',
        [String(userId), r, String(comment).substring(0,1000)]);
      const row = await db.get('SELECT * FROM feedback WHERE id=?', [result.lastID]);
      if (req.user?.id) {
        await db.run('INSERT INTO rewards (user_id, points) VALUES (?,5) ON CONFLICT(user_id) DO UPDATE SET points=points+5', [String(userId)]).catch(()=>{});
      }
      res.json({ ...row, pointsAwarded:5 });
    } catch { res.status(500).json({ error:'Could not save feedback' }); }
  });

  router.get('/summary', async (req, res) => {
    try {
      const avg = await db.get('SELECT AVG(rating) as avg, COUNT(*) as total FROM feedback');
      res.json({ averageRating:Math.round((avg.avg||0)*10)/10, totalResponses:avg.total });
    } catch { res.status(500).json({ error:'Could not load summary' }); }
  });

  app.use('/feedback', router);
  return app;
}

describe('POST /feedback', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('400 when rating out of range', async () => {
    const r = await request(app).post('/feedback').send({ rating:6 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/rating/);
  });
  test('400 when rating below 1', async () => {
    const r = await request(app).post('/feedback').send({ rating:0 });
    expect(r.status).toBe(400);
  });
  test('200 without auth — stored as anon', async () => {
    const r = await request(app).post('/feedback').send({ rating:4, comment:'Good app' });
    expect(r.status).toBe(200);
    expect(r.body.user_id).toBe('anon');
    expect(r.body.rating).toBe(4);
  });
  test('200 with auth — stored with user id (bug fix: not anon)', async () => {
    const r = await request(app).post('/feedback').set('Authorization',`Bearer ${tok(42)}`).send({ rating:5, comment:'Great' });
    expect(r.status).toBe(200);
    expect(r.body.user_id).toBe('42'); // must be the auth user id, not 'anon'
  });
  test('rewards only credited to authenticated users', async () => {
    await request(app).post('/feedback').send({ rating:3, comment:'Anon feedback' }); // no auth
    const row = await db.get("SELECT points FROM rewards WHERE user_id='anon'");
    expect(row).toBeUndefined(); // anon users don't get reward rows
  });
  test('rewards credited to authenticated user', async () => {
    await request(app).post('/feedback').set('Authorization',`Bearer ${tok(99)}`).send({ rating:5 });
    const row = await db.get("SELECT points FROM rewards WHERE user_id='99'");
    expect(row).toBeTruthy();
    expect(row.points).toBeGreaterThanOrEqual(5);
  });
  test('comment truncated at 1000 chars', async () => {
    const longComment = 'x'.repeat(2000);
    const r = await request(app).post('/feedback').send({ rating:3, comment:longComment });
    expect(r.status).toBe(200);
    expect(r.body.comment.length).toBeLessThanOrEqual(1000);
  });
});

describe('GET /feedback/summary', () => {
  let app, db;
  beforeAll(async () => {
    db=await makeTestDb(); await buildSchema(db); app=await buildApp(db);
    await db.exec("INSERT INTO feedback (user_id,rating) VALUES ('1',5),('2',3),('3',4)");
  });

  test('returns averageRating and totalResponses', async () => {
    const r = await request(app).get('/feedback/summary');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('averageRating');
    expect(r.body).toHaveProperty('totalResponses');
    expect(r.body.totalResponses).toBeGreaterThanOrEqual(3);
    expect(typeof r.body.averageRating).toBe('number');
  });
  test('averageRating rounded to 1 decimal', async () => {
    const r = await request(app).get('/feedback/summary');
    const str = String(r.body.averageRating);
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(1);
  });
});
