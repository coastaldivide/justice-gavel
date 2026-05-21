/**
 * motions.test.js — AI motion generation routes
 *
 * Tests: generate validation, subscription gating, history CRUD,
 *        auth enforcement, invalid IDs, ownership isolation
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

function tok(id, role='user', sub='pro') {
  return jwt.sign({ id, role, email:`u${id}@test.com`, subscription: sub }, SECRET, { expiresIn:'1h' });
}

async function buildApp(db) {
  const router = express.Router();

  function auth(req, res, next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if(!t) return res.status(401).json({error:'missing token'});
    try{req.user=jwt.verify(t,SECRET);next();}
    catch{res.status(401).json({error:'invalid token'});}
  }

  const VALID_TYPES = ['suppress','bail_reduction','continuance','dismiss','discovery','appeal'];

  // POST /generate — AI motion generation (mocked in tests)
  router.post('/generate', auth, async (req, res) => {
    const { motion_type, fields, case_id } = req.body || {};
    if (!motion_type) return res.status(400).json({ error:'motion_type required' });
    if (!VALID_TYPES.includes(motion_type)) {
      return res.status(400).json({ error:`Invalid motion_type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error:'fields object required' });
    }
    // Check subscription
    const sub = await db.get(
      `SELECT plan FROM subscriptions WHERE user_id=? LIMIT 1`, [req.user.id]
    ).catch(() => null);
    // Starter tier cannot generate motions (paywall)
    if (!sub && req.user.role !== 'defender' && req.user.role !== 'attorney') {
      return res.status(403).json({ error:'Subscription required to generate motions.' });
    }
    try {
      const draft = `[AI DRAFT] Motion to ${motion_type.replace(/_/g,' ')} — Generated for testing`;
      const r = await db.run(
        `INSERT INTO motions (user_id, motion_type, draft, status) VALUES (?,?,?,?)`,
        [req.user.id, motion_type, draft, 'draft']
      );
      res.json({ ok:true, job_id:`job_${r.lastID}`, motion_id:r.lastID, status:'completed', draft });
    } catch { res.status(500).json({ error:'Could not generate motion. Please try again.' }); }
  });

  // GET /history
  router.get('/history', auth, async (req, res) => {
    try {
      const rows = await db.all(
        'SELECT * FROM motions WHERE user_id=? ORDER BY id DESC', [req.user.id]
      );
      res.json(rows);
    } catch { res.status(500).json({ error:'Could not load motion history. Please try again.' }); }
  });

  // GET /history/:id
  router.get('/history/:id', auth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error:'invalid id' });
    try {
      const row = await db.get(
        'SELECT * FROM motions WHERE id=? AND user_id=?', [id, req.user.id]
      );
      if (!row) return res.status(404).json({ error:'Not found.' });
      res.json(row);
    } catch { res.status(500).json({ error:'Could not load motion. Please try again.' }); }
  });

  // DELETE /history/:id
  router.delete('/history/:id', auth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error:'invalid id' });
    try {
      const row = await db.get(
        'SELECT id FROM motions WHERE id=? AND user_id=?', [id, req.user.id]
      );
      if (!row) return res.status(404).json({ error:'Not found.' });
      await db.run('DELETE FROM motions WHERE id=? AND user_id=?', [id, req.user.id]);
      res.json({ ok:true });
    } catch { res.status(500).json({ error:'Could not delete motion. Please try again.' }); }
  });

  const a = express();
  a.use(express.json());
  a.use('/api/motions', router);
  return a;
}

let db, app;
const U1 = 1, U2 = 2;
const T1 = tok(U1,'user','pro');
const T2 = tok(U2,'user','pro');
const STARTER_TOKEN = tok(50,'user','starter');

beforeAll(async () => {
  db = await makeTestDb();
  await createSchema(db);
  // Give U1 an active subscription
  await db.run('INSERT INTO subscriptions (user_id, plan) VALUES (?,?)', [U1,'pro']);
  app = await buildApp(db);
});

// ── Generate ──────────────────────────────────────────────────────────────────
describe('POST /api/motions/generate', () => {
  it('generates a motion for subscribed user', async () => {
    const res = await request(app)
      .post('/api/motions/generate')
      .set('Authorization', `Bearer ${T1}`)
      .send({ motion_type:'suppress', fields:{ defendant_name:'John Smith', case_number:'TN-001', incident_date:'2024-01-15', evidence_type:'phone', basis:'no warrant' }});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.draft).toBeTruthy();
    expect(res.body.motion_id).toBeTruthy();
  });

  it('rejects missing motion_type', async () => {
    const res = await request(app)
      .post('/api/motions/generate')
      .set('Authorization', `Bearer ${T1}`)
      .send({ fields:{ defendant_name:'Jane Doe' }});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/motion_type required/i);
  });

  it('rejects invalid motion_type', async () => {
    const res = await request(app)
      .post('/api/motions/generate')
      .set('Authorization', `Bearer ${T1}`)
      .send({ motion_type:'nuke_the_case', fields:{} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid motion_type/i);
  });

  it('rejects missing fields object', async () => {
    const res = await request(app)
      .post('/api/motions/generate')
      .set('Authorization', `Bearer ${T1}`)
      .send({ motion_type:'suppress' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fields/i);
  });

  it('blocks unsubscribed user (no subscription)', async () => {
    const res = await request(app)
      .post('/api/motions/generate')
      .set('Authorization', `Bearer ${tok(999,'user')}`)
      .send({ motion_type:'suppress', fields:{ defendant_name:'x' }});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/subscription required/i);
  });

  it('allows all 6 valid motion types', async () => {
    const types = ['suppress','bail_reduction','continuance','dismiss','discovery','appeal'];
    for (const t of types) {
      const res = await request(app)
        .post('/api/motions/generate')
        .set('Authorization', `Bearer ${T1}`)
        .send({ motion_type:t, fields:{ defendant_name:'Test', case_number:'001' }});
      expect(res.status).toBe(200);
    }
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/api/motions/generate').send({ motion_type:'suppress', fields:{} })).status).toBe(401);
  });
});

// ── History ───────────────────────────────────────────────────────────────────
describe('GET /api/motions/history', () => {
  it('returns generated motions for user', async () => {
    const res = await request(app)
      .get('/api/motions/history')
      .set('Authorization', `Bearer ${T1}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns empty array for user with no motions', async () => {
    const res = await request(app)
      .get('/api/motions/history')
      .set('Authorization', `Bearer ${tok(444)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('only returns own motions (isolation)', async () => {
    // Create a motion for U2
    await db.run('INSERT INTO motions (user_id,motion_type,draft,status) VALUES (?,?,?,?)',
      [U2,'dismiss','U2 draft','draft']);
    const res = await request(app)
      .get('/api/motions/history')
      .set('Authorization', `Bearer ${T1}`);
    const u2Motions = res.body.filter((m) => m.user_id === U2);
    expect(u2Motions).toHaveLength(0);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/motions/history')).status).toBe(401);
  });
});

// ── History by ID ─────────────────────────────────────────────────────────────
describe('GET /api/motions/history/:id', () => {
  let motionId;
  beforeAll(async () => {
    const r = await db.run(
      'INSERT INTO motions (user_id,motion_type,draft,status) VALUES (?,?,?,?)',
      [U1,'bail_reduction','Bail reduction draft','draft']
    );
    motionId = r.lastID;
  });

  it('returns motion for owner', async () => {
    const res = await request(app)
      .get(`/api/motions/history/${motionId}`)
      .set('Authorization', `Bearer ${T1}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(motionId);
    expect(res.body.motion_type).toBe('bail_reduction');
  });

  it('returns 404 for other user (ownership isolation)', async () => {
    const res = await request(app)
      .get(`/api/motions/history/${motionId}`)
      .set('Authorization', `Bearer ${T2}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric id', async () => {
    expect((await request(app).get('/api/motions/history/abc').set('Authorization',`Bearer ${T1}`)).status).toBe(400);
  });

  it('returns 404 for nonexistent id', async () => {
    expect((await request(app).get('/api/motions/history/99999').set('Authorization',`Bearer ${T1}`)).status).toBe(404);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────
describe('DELETE /api/motions/history/:id', () => {
  let motionId;
  beforeAll(async () => {
    const r = await db.run(
      'INSERT INTO motions (user_id,motion_type,draft,status) VALUES (?,?,?,?)',
      [U1,'dismiss','To delete','draft']
    );
    motionId = r.lastID;
  });

  it('prevents other user from deleting (ownership)', async () => {
    const res = await request(app)
      .delete(`/api/motions/history/${motionId}`)
      .set('Authorization', `Bearer ${T2}`);
    expect(res.status).toBe(404);
    const still = await db.get('SELECT id FROM motions WHERE id=?', [motionId]);
    expect(still).toBeDefined();
  });

  it('deletes own motion', async () => {
    const res = await request(app)
      .delete(`/api/motions/history/${motionId}`)
      .set('Authorization', `Bearer ${T1}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const gone = await db.get('SELECT id FROM motions WHERE id=?', [motionId]);
    expect(gone).toBeUndefined();
  });

  it('rejects non-numeric id', async () => {
    expect((await request(app).delete('/api/motions/history/xyz').set('Authorization',`Bearer ${T1}`)).status).toBe(400);
  });
});
