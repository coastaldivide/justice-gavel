/**
 * saved.test.js — Saved lawyers/agents CRUD
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS saved_lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, lawyer_id INTEGER NOT NULL,
      notes TEXT, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, lawyer_id)
    );
  `);
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
  router.get('/lawyers', auth, async (req,res) => {
    try {
      const rows = await db.all('SELECT * FROM saved_lawyers WHERE user_id=? ORDER BY created_at DESC',[req.user.id]);
      res.json(rows);
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  router.post('/lawyers', auth, async (req,res) => {
    const { lawyer_id, notes='' } = req.body||{};
    if (!lawyer_id) return res.status(400).json({error:'lawyer_id required'});
    try {
      await db.run('INSERT OR IGNORE INTO saved_lawyers (user_id,lawyer_id,notes) VALUES (?,?,?)',[req.user.id,lawyer_id,notes]);
      res.json({ok:true});
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  router.patch('/lawyers/:id', auth, async (req,res) => {
    try {
      const { notes } = req.body||{};
      const r = await db.run('UPDATE saved_lawyers SET notes=? WHERE id=? AND user_id=?',[notes,parseInt(req.params.id,10),req.user.id]);
      if (!r.changes) return res.status(404).json({error:'Not found'});
      res.json({ok:true});
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  router.delete('/lawyers/:id', auth, async (req,res) => {
    try {
      await db.run('DELETE FROM saved_lawyers WHERE lawyer_id=? AND user_id=?',[parseInt(req.params.id,10),req.user.id]);
      res.json({ok:true});
    } catch { res.status(500).json({error:'Server error.'}); }
  });
  app.use('/saved', router);
  return app;
}

describe('Saved lawyers CRUD', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without token', async () => { expect((await request(app).get('/saved/lawyers')).status).toBe(401); });
  test('GET returns empty for new user', async () => {
    const r = await request(app).get('/saved/lawyers').set('Authorization',`Bearer ${tok(99)}`);
    expect(r.status).toBe(200); expect(Array.isArray(r.body)).toBe(true); expect(r.body).toHaveLength(0);
  });
  test('POST 400 without lawyer_id', async () => {
    const r = await request(app).post('/saved/lawyers').set('Authorization',`Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
  });
  test('POST saves lawyer', async () => {
    const r = await request(app).post('/saved/lawyers').set('Authorization',`Bearer ${tok(1)}`).send({lawyer_id:42,notes:'Good attorney'});
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true);
  });
  test('GET returns saved lawyer', async () => {
    const r = await request(app).get('/saved/lawyers').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200); expect(r.body.length).toBeGreaterThan(0);
  });
  test('POST idempotent — duplicate save does not error', async () => {
    const r = await request(app).post('/saved/lawyers').set('Authorization',`Bearer ${tok(1)}`).send({lawyer_id:42});
    expect(r.status).toBe(200);
  });
  test('DELETE removes saved lawyer', async () => {
    await request(app).post('/saved/lawyers').set('Authorization',`Bearer ${tok(2)}`).send({lawyer_id:10});
    const r = await request(app).delete('/saved/lawyers/10').set('Authorization',`Bearer ${tok(2)}`);
    expect(r.status).toBe(200);
    const check = await db.get('SELECT id FROM saved_lawyers WHERE user_id=2 AND lawyer_id=10');
    expect(check).toBeUndefined();
  });
  test('user isolation — cannot patch other user saved record', async () => {
    await request(app).post('/saved/lawyers').set('Authorization',`Bearer ${tok(3)}`).send({lawyer_id:77});
    const row = await db.get('SELECT id FROM saved_lawyers WHERE user_id=3 AND lawyer_id=77');
    const r = await request(app).patch(`/saved/lawyers/${row.id}`).set('Authorization',`Bearer ${tok(1)}`).send({notes:'hacked'});
    expect(r.status).toBe(404);
  });
});
