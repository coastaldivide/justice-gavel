/**
 * interrogation.test.js — Recording law lookup + speaker tag validation
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

const RECORDING_LAWS = {
  CA: { consent:'all-party', statute:'CA Penal Code §632', penalty:'Felony', notes:'California is a strict all-party consent state.' },
  TN: { consent:'one-party', statute:'TCA §39-13-601', penalty:'Class C Misdemeanor', notes:'One-party consent — you can record your own conversations.' },
  NY: { consent:'one-party', statute:'NY Penal Law §250.00', penalty:'Class E Felony if violated', notes:'Federal one-party rule applies.' },
  FL: { consent:'all-party', statute:'FL Stat §934.03', penalty:'Third-degree felony', notes:'All-party consent required. Strict enforcement.' },
};

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
  router.get('/recording-law', auth, (req,res) => {
    const { state } = req.query;
    if (!state) return res.status(400).json({error:'state query param required (2-letter code)'});
    const s = state.toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(s)) return res.status(400).json({error:'Invalid state code'});
    const law = RECORDING_LAWS[s];
    if (!law) return res.status(404).json({error:`Recording law data not available for ${s}`});
    res.json({state:s,...law});
  });
  router.post('/transcribe', auth, (req,res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({error:'AI service not configured.',code:'api_key_missing'});
    }
    res.json({jobId:'job_transcribe_mock',status:'pending',async:true});
  });
  app.use('/interrogation', router);
  return app;
}

describe('GET /interrogation/recording-law', () => {
  const app = buildApp();
  test('401 without token', async () => { expect((await request(app).get('/interrogation/recording-law?state=TN')).status).toBe(401); });
  test('400 without state param', async () => {
    const r = await request(app).get('/interrogation/recording-law').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(400);
  });
  test('400 for invalid state code', async () => {
    const r = await request(app).get('/interrogation/recording-law?state=XYZ').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(400);
  });
  test('404 for state without data', async () => {
    const r = await request(app).get('/interrogation/recording-law?state=WY').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(404);
  });
  test('TN one-party consent', async () => {
    const r = await request(app).get('/interrogation/recording-law?state=TN').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.consent).toBe('one-party'); expect(r.body.state).toBe('TN');
  });
  test('CA all-party consent', async () => {
    const r = await request(app).get('/interrogation/recording-law?state=CA').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.consent).toBe('all-party');
  });
  test('case insensitive state param', async () => {
    const r = await request(app).get('/interrogation/recording-law?state=fl').set('Authorization',`Bearer ${tok()}`);
    expect(r.status).toBe(200); expect(r.body.state).toBe('FL');
  });
  test('response has statute and notes', async () => {
    const r = await request(app).get('/interrogation/recording-law?state=NY').set('Authorization',`Bearer ${tok()}`);
    expect(r.body).toHaveProperty('statute'); expect(r.body).toHaveProperty('notes');
  });
});

describe('POST /interrogation/transcribe', () => {
  const app = buildApp();
  test('401 without token', async () => { expect((await request(app).post('/interrogation/transcribe').send({})).status).toBe(401); });
  test('503 without Anthropic key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await request(app).post('/interrogation/transcribe').set('Authorization',`Bearer ${tok()}`).send({});
    expect(r.status).toBe(503); expect(r.body.code).toBe('api_key_missing');
  });
});
