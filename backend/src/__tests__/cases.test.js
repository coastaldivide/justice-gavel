/**
 * cases.test.js — Case management routes
 * Tests: CRUD, auth enforcement, ownership isolation, invalid params
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

function tok(id, role='user') {
  return jwt.sign({ id, role, email:`u${id}@test.com`, subscription:'pro' }, SECRET, { expiresIn:'1h' });
}

let db, app;
const U1=1, U2=2;
const T1=tok(U1), T2=tok(U2);

async function buildApp(testDb) {
  const router = express.Router();
  function auth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if(!t) return res.status(401).json({error:'missing token'});
    try{req.user=jwt.verify(t,SECRET);next();}
    catch{res.status(401).json({error:'invalid token'});}
  }

  router.get('/', auth, async(req,res)=>{
    const rows=await testDb.all('SELECT * FROM cases WHERE user_id=?',[req.user.id]);
    res.json(rows);
  });

  router.post('/', auth, async(req,res)=>{
    const {title,charge,status,notes,court_date}=req.body||{};
    if(!title) return res.status(400).json({error:'title required'});
    const r=await testDb.run(
      'INSERT INTO cases (user_id,title,charge,status,notes,court_date) VALUES (?,?,?,?,?,?)',
      [req.user.id,title,charge||'',status||'Open',notes||'',court_date||'']
    );
    const c=await testDb.get('SELECT * FROM cases WHERE id=?',[r.lastID]);
    res.status(201).json(c);
  });

  router.put('/:id', auth, async(req,res)=>{
    const id=parseInt(req.params.id);
    if(isNaN(id)) return res.status(400).json({error:'invalid id'});
    const ex=await testDb.get('SELECT * FROM cases WHERE id=? AND user_id=?',[id,req.user.id]);
    if(!ex) return res.status(404).json({error:'Not found.'});
    const {title,charge,status,notes,court_date}=req.body||{};
    await testDb.run(
      'UPDATE cases SET title=?,charge=?,status=?,notes=?,court_date=? WHERE id=? AND user_id=?',
      [title||ex.title,charge??ex.charge,status||ex.status,notes??ex.notes,court_date??ex.court_date,id,req.user.id]
    );
    res.json(await testDb.get('SELECT * FROM cases WHERE id=?',[id]));
  });

  router.delete('/:id', auth, async(req,res)=>{
    const id=parseInt(req.params.id);
    if(isNaN(id)) return res.status(400).json({error:'invalid id'});
    const ex=await testDb.get('SELECT * FROM cases WHERE id=? AND user_id=?',[id,req.user.id]);
    if(!ex) return res.status(404).json({error:'Not found.'});
    await testDb.run('DELETE FROM cases WHERE id=? AND user_id=?',[id,req.user.id]);
    res.json({ok:true});
  });

  const a=express(); a.use(express.json()); a.use('/api/cases',router); return a;
}

beforeAll(async()=>{ db=await makeTestDb(); await createSchema(db); app=await buildApp(db); });

describe('GET /api/cases', ()=>{
  it('returns empty array for new user', async()=>{
    const res=await request(app).get('/api/cases').set('Authorization',`Bearer ${tok(50)}`);
    expect(res.status).toBe(200); expect(res.body).toEqual([]);
  });
  it('requires auth', async()=>{ expect((await request(app).get('/api/cases')).status).toBe(401); });
});

describe('POST /api/cases', ()=>{
  it('creates case with required fields', async()=>{
    const res=await request(app).post('/api/cases').set('Authorization',`Bearer ${T1}`)
      .send({title:'State v. Test',charge:'Misdemeanor'});
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('State v. Test');
    expect(res.body.user_id).toBe(U1);
  });
  it('rejects missing title', async()=>{
    expect((await request(app).post('/api/cases').set('Authorization',`Bearer ${T1}`).send({charge:'DUI'})).status).toBe(400);
  });
  it('requires auth', async()=>{
    expect((await request(app).post('/api/cases').send({title:'x'})).status).toBe(401);
  });
});

describe('PUT /api/cases/:id', ()=>{
  let cid;
  beforeAll(async()=>{
    const r=await request(app).post('/api/cases').set('Authorization',`Bearer ${T1}`).send({title:'Original'});
    cid=r.body.id;
  });
  it('updates own case', async()=>{
    const res=await request(app).put(`/api/cases/${cid}`).set('Authorization',`Bearer ${T1}`)
      .send({title:'Updated',status:'Pre-Trial'});
    expect(res.status).toBe(200); expect(res.body.title).toBe('Updated');
  });
  it('blocks other user from updating', async()=>{
    const res=await request(app).put(`/api/cases/${cid}`).set('Authorization',`Bearer ${T2}`).send({title:'Hijack'});
    expect([403,404]).toContain(res.status);
  });
  it('rejects non-numeric id', async()=>{
    expect((await request(app).put('/api/cases/abc').set('Authorization',`Bearer ${T1}`).send({title:'x'})).status).toBe(400);
  });
});

describe('DELETE /api/cases/:id', ()=>{
  let cid;
  beforeAll(async()=>{
    const r=await request(app).post('/api/cases').set('Authorization',`Bearer ${T1}`).send({title:'ToDelete'});
    cid=r.body.id;
  });
  it('prevents other user deleting your case', async()=>{
    const res=await request(app).delete(`/api/cases/${cid}`).set('Authorization',`Bearer ${T2}`);
    expect([403,404]).toContain(res.status);
    expect(await db.get('SELECT id FROM cases WHERE id=?',[cid])).toBeDefined();
  });
  it('deletes own case', async()=>{
    const res=await request(app).delete(`/api/cases/${cid}`).set('Authorization',`Bearer ${T1}`);
    expect(res.status).toBe(200); expect(res.body.ok).toBe(true);
    expect(await db.get('SELECT id FROM cases WHERE id=?',[cid])).toBeUndefined();
  });
  it('returns 404 for nonexistent case', async()=>{
    expect((await request(app).delete('/api/cases/99999').set('Authorization',`Bearer ${T1}`)).status).toBe(404);
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

