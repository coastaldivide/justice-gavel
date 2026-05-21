/**
 * jobs.test.js — Async job queue status polling
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

// Mock job store
const JOB_STORE = new Map();
JOB_STORE.set('job_pending', { id:'job_pending', status:'pending', result:null, error:null });
JOB_STORE.set('job_done',    { id:'job_done',    status:'done', result:{ok:true,data:'analysis complete'}, error:null });
JOB_STORE.set('job_failed',  { id:'job_failed',  status:'failed', result:null, error:'AI service unavailable' });

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  function auth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({error:'missing token'});
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({error:'invalid token'}); }
  }
  router.get('/:id', auth, (req,res) => {
    const { id } = req.params;
    if (!/^[\w-]+$/.test(id)) return res.status(400).json({error:'Invalid job ID'});
    const job = JOB_STORE.get(id);
    if (!job) return res.status(404).json({error:'Job not found'});
    res.json(job);
  });
  app.use('/jobs', router);
  return app;
}

describe('GET /jobs/:id', () => {
  const app = buildApp();
  test('401 without token', async () => { expect((await request(app).get('/jobs/job_pending')).status).toBe(401); });
  test('404 for unknown job', async () => {
    const r = await request(app).get('/jobs/nonexistent').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(404);
  });
  test('400 for non-alphanumeric ID', async () => {
    const r = await request(app).get('/jobs/../../etc/passwd').set('Authorization',`Bearer ${tok()}`);
    expect([400,404]).toContain(r.status);
  });
  test('pending job returns status=pending', async () => {
    const r = await request(app).get('/jobs/job_pending').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.status).toBe('pending'); expect(r.body.result).toBeNull();
  });
  test('done job returns result', async () => {
    const r = await request(app).get('/jobs/job_done').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.status).toBe('done');
    expect(r.body.result).toHaveProperty('ok', true);
  });
  test('failed job returns error', async () => {
    const r = await request(app).get('/jobs/job_failed').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.status).toBe('failed');
    expect(r.body.error).toBeTruthy();
  });
});
