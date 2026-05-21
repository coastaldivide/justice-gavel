/**
 * messages.test.js — Secure messaging
 * Tests: fetch, send, read, unread count, isolation, validation
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
function tok(id) { return jwt.sign({id,role:'user',email:`u${id}@t.com`,subscription:'pro'},SECRET,{expiresIn:'1h'}); }

let db, app;
const S=1, R=2, THIRD=3, CASE=42;

async function buildApp(testDb) {
  const router = express.Router();
  function auth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if(!t) return res.status(401).json({error:'missing token'});
    try{req.user=jwt.verify(t,SECRET);next();}
    catch{res.status(401).json({error:'invalid token'});}
  }

  router.get('/unread/count', auth, async(req,res)=>{
    const rows=await testDb.all(
      'SELECT id FROM messages WHERE recipient_id=? AND read_at IS NULL',[req.user.id]);
    res.json({count:rows.length});
  });

  router.get('/:caseId', auth, async(req,res)=>{
    const cid=parseInt(req.params.caseId);
    if(isNaN(cid)) return res.status(400).json({error:'invalid case id'});
    const rows=await testDb.all(
      'SELECT * FROM messages WHERE case_id=? AND (sender_id=? OR recipient_id=?)',
      [cid,req.user.id,req.user.id]);
    res.json(rows);
  });

  router.post('/:caseId', auth, async(req,res)=>{
    const cid=parseInt(req.params.caseId);
    if(isNaN(cid)) return res.status(400).json({error:'invalid case id'});
    const {body,recipient_id}=req.body||{};
    if(!body?.trim()) return res.status(400).json({error:'body required'});
    const r=await testDb.run(
      'INSERT INTO messages (sender_id,recipient_id,case_id,body) VALUES (?,?,?,?)',
      [req.user.id,recipient_id||null,cid,body]);
    res.status(201).json(await testDb.get('SELECT * FROM messages WHERE id=?',[r.lastID]));
  });

  router.post('/:caseId/read', auth, async(req,res)=>{
    const cid=parseInt(req.params.caseId);
    if(isNaN(cid)) return res.status(400).json({error:'invalid case id'});
    await testDb.run(
      "UPDATE messages SET read_at=datetime('now') WHERE case_id=? AND recipient_id=? AND read_at IS NULL",
      [cid,req.user.id]);
    res.json({ok:true});
  });

  const a=express(); a.use(express.json()); a.use('/api/messages',router); return a;
}

beforeAll(async()=>{
  db=await makeTestDb(); await createSchema(db); app=await buildApp(db);
  await db.run('INSERT INTO messages (sender_id,recipient_id,case_id,body) VALUES (?,?,?,?)',
    [R,S,CASE,'Hello from recipient']);
});

describe('GET /api/messages/:caseId', ()=>{
  it('returns messages where user is sender or recipient', async()=>{
    const res=await request(app).get(`/api/messages/${CASE}`).set('Authorization',`Bearer ${tok(S)}`);
    expect(res.status).toBe(200); expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
  it('returns empty for unrelated user (isolation)', async()=>{
    const res=await request(app).get(`/api/messages/${CASE}`).set('Authorization',`Bearer ${tok(THIRD)}`);
    expect(res.status).toBe(200); expect(res.body).toHaveLength(0);
  });
  it('rejects non-numeric caseId', async()=>{
    expect((await request(app).get('/api/messages/notanumber').set('Authorization',`Bearer ${tok(S)}`)).status).toBe(400);
  });
  it('requires auth', async()=>{ expect((await request(app).get(`/api/messages/${CASE}`)).status).toBe(401); });
});

describe('POST /api/messages/:caseId', ()=>{
  it('creates a message', async()=>{
    const res=await request(app).post(`/api/messages/${CASE}`).set('Authorization',`Bearer ${tok(S)}`)
      .send({body:'Test msg',recipient_id:R});
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Test msg');
    expect(res.body.sender_id).toBe(S);
  });
  it('rejects empty body', async()=>{
    expect((await request(app).post(`/api/messages/${CASE}`).set('Authorization',`Bearer ${tok(S)}`).send({body:'  '})).status).toBe(400);
  });
  it('rejects missing body field', async()=>{
    expect((await request(app).post(`/api/messages/${CASE}`).set('Authorization',`Bearer ${tok(S)}`).send({recipient_id:2})).status).toBe(400);
  });
});

describe('POST /api/messages/:caseId/read', ()=>{
  it('marks messages read and returns ok', async()=>{
    const res=await request(app).post(`/api/messages/${CASE}/read`).set('Authorization',`Bearer ${tok(S)}`);
    expect(res.status).toBe(200); expect(res.body.ok).toBe(true);
  });
});

describe('GET /api/messages/unread/count', ()=>{
  it('returns numeric count', async()=>{
    await db.run('INSERT INTO messages (sender_id,recipient_id,case_id,body) VALUES (?,?,?,?)',[S,R,CASE,'unread']);
    const res=await request(app).get('/api/messages/unread/count').set('Authorization',`Bearer ${tok(R)}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });
  it('returns 0 for user with no unread', async()=>{
    const res=await request(app).get('/api/messages/unread/count').set('Authorization',`Bearer ${tok(THIRD)}`);
    expect(res.status).toBe(200); expect(res.body.count).toBe(0);
  });
});

// ── Rate limiting integration test ────────────────────────────────────────────
// Verifies that makeUserLimiter returns 429 when a user exceeds the configured limit.
// Uses a throwaway express app so no test state bleeds over.
describe('makeUserLimiter', () => {
  test('returns 429 when per-user request limit is exceeded', async () => {
    const { makeUserLimiter } = await import('../middleware/sharedAiLimiter.js');
    const rll = makeUserLimiter({ windowMs: 60_000, max: 2, message: 'Too many requests' });
    const rla = express(); rla.use(express.json());
    const rls = process.env.JWT_SECRET;
    const rlt = jwt.sign({ id: 77777, role: 'user' }, rls, { expiresIn: '1h' });
    rla.post('/x', (q,s,n)=>{
      try{q.user=jwt.verify((q.headers.authorization||'').replace('Bearer ',''),rls);n();}
      catch{s.status(401).json({error:'x'});}
    }, rll, (_q,s)=>s.json({ok:true}));
    await request(rla).post('/x').set('Authorization',`Bearer ${rlt}`).expect(200);
    await request(rla).post('/x').set('Authorization',`Bearer ${rlt}`).expect(200);
    const rlr = await request(rla).post('/x').set('Authorization',`Bearer ${rlt}`);
    expect(rlr.status).toBe(429);
    expect(rlr.body.error).toMatch(/too many requests/i);
    expect(rlr.headers['retry-after']).toBeDefined();
  });
});

