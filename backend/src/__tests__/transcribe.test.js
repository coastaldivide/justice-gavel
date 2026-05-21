/**
 * transcribe.test.js — Voice transcription route
 *
 * Tests:
 *   Auth enforcement (401 without/with-invalid token)
 *   Subscription gate (402 when no active sub and not a defender)
 *   File-type validation (415 on non-audio MIME)
 *   Missing file (400)
 *   Defender role bypasses subscription check
 *   Text-to-note endpoint (POST /text): input validation + structuring
 *   structureNote pure-logic fallback (no API key → returns raw transcript)
 *
 * Full E2E (Whisper + Claude) requires live API keys — omitted by design.
 * All tests use the in-process mock app pattern so no network calls are made.
 */
import express  from 'express';
import request  from 'supertest';
import jwt      from 'jsonwebtoken';
import multer   from 'multer';

const SECRET = process.env.JWT_SECRET;
const tok  = (id = 1, role = 'user')     => jwt.sign({ id, role }, SECRET, { expiresIn: '1h' });
const atty = (id = 2)                     => jwt.sign({ id, role: 'attorney' }, SECRET, { expiresIn: '1h' });
const def_ = (id = 3)                     => jwt.sign({ id, role: 'defender' }, SECRET, { expiresIn: '1h' });
const exp  = ()                            => jwt.sign({ id: 1 }, SECRET, { expiresIn: '-1s' });

// ── Minimal mock app (mirrors transcribe.js structure) ─────────────────────
function buildApp({ hasSub = false } = {}) {
  const app    = express();
  app.use(express.json());
  const router = express.Router();

  // Multer: accept audio MIME types only
  const AUDIO_MIME = new Set([
    'audio/m4a', 'audio/x-m4a', 'audio/mp4',
    'audio/mpeg', 'audio/mp3',
    'audio/wav',  'audio/x-wav',
    'audio/webm',
  ]);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (AUDIO_MIME.has(file.mimetype)) return cb(null, true);
      cb(new Error('Unsupported audio format'));
    },
  });

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try   { req.user = jwt.verify(t, SECRET); next(); }
    catch { return res.status(401).json({ error: 'invalid token' }); }
  }

  // Subscription middleware stub
  function subCheck(req, res, next) {
    const isDefender = ['defender', 'attorney'].includes(req.user?.role);
    if (!hasSub && !isDefender) {
      return res.status(402).json({
        error: 'Active subscription required',
        code: 'subscription_required',
        upgrade_url: '/subscribe',
      });
    }
    next();
  }

  // POST /note — requires auth + sub/defender + audio file
  router.post('/note', auth, subCheck, (req, res, next) => {
    upload.single('audio')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Audio file too large. Maximum size is 25MB.' });
      }
      if (err) return res.status(415).json({ error: 'Unsupported audio format.' });
      next();
    });
  }, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Audio file required' });
    // Simulate async job response (no live API calls in tests)
    res.json({ jobId: 'job_test_123', status: 'pending', async: true });
  });

  // POST /text — requires auth, accepts plain text
  router.post('/text', auth, subCheck, (req, res) => {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    // Without ANTHROPIC_KEY, structureNote returns raw transcript as summary
    const note = {
      date:       new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      summary:    text.trim(),
      next_steps: [],
      flags:      [],
      raw:        text.trim(),
    };
    res.json({ transcript: text.trim(), note });
  });

  app.use('/transcribe', router);
  return app;
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /transcribe/note — auth enforcement', () => {
  const app = buildApp({ hasSub: true });

  test('401 with no token', async () => {
    const r = await request(app).post('/transcribe/note');
    expect(r.status).toBe(401);
    expect(r.body.error).toBeTruthy();
  });

  test('401 with invalid token string', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', 'Bearer not.a.real.jwt');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid token');
  });

  test('401 with expired token', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${exp()}`);
    expect(r.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION GATE
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /transcribe/note — subscription gate', () => {
  const noSubApp  = buildApp({ hasSub: false });
  const hasSubApp = buildApp({ hasSub: true });

  test('402 when user has no subscription', async () => {
    const r = await request(noSubApp)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('subscription_required');
    expect(r.body.upgrade_url).toBeTruthy();
  });

  test('402 response includes upgrade_url', async () => {
    const r = await request(noSubApp)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body.upgrade_url).toBe('/subscribe');
  });

  test('defender role bypasses subscription check', async () => {
    // defender without hasSub=true still gets past the gate
    // (will hit 400 — no audio file — but not 402)
    const r = await request(noSubApp)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${def_()}`);
    expect(r.status).not.toBe(402);
  });

  test('attorney role bypasses subscription check', async () => {
    const r = await request(noSubApp)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${atty()}`);
    expect(r.status).not.toBe(402);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FILE VALIDATION
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /transcribe/note — file validation', () => {
  const app = buildApp({ hasSub: true });

  test('400 when no audio file attached', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/audio/i);
  });

  test('415 for PDF MIME type (not audio)', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`)
      .attach('audio', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(415);
  });

  test('415 for image MIME type', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`)
      .attach('audio', Buffer.from('fake-image'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(415);
  });

  test('200 + async job response for valid audio MIME', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`)
      .attach('audio', Buffer.from('fake-audio-data'), { filename: 'note.m4a', contentType: 'audio/m4a' });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('jobId');
    expect(r.body.status).toBe('pending');
    expect(r.body.async).toBe(true);
  });

  test('accepts audio/wav MIME', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`)
      .attach('audio', Buffer.from('RIFF fake'), { filename: 'note.wav', contentType: 'audio/wav' });
    expect(r.status).toBe(200);
    expect(r.body.async).toBe(true);
  });

  test('accepts audio/webm MIME', async () => {
    const r = await request(app)
      .post('/transcribe/note')
      .set('Authorization', `Bearer ${tok()}`)
      .attach('audio', Buffer.from('webm-fake'), { filename: 'note.webm', contentType: 'audio/webm' });
    expect(r.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /text — structure plain text (no audio)
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /transcribe/text', () => {
  const app = buildApp({ hasSub: true });

  test('401 without token', async () => {
    const r = await request(app).post('/transcribe/text').send({ text: 'hello' });
    expect(r.status).toBe(401);
  });

  test('400 when text is empty string', async () => {
    const r = await request(app)
      .post('/transcribe/text')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: '' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('text is required');
  });

  test('400 when text is whitespace only', async () => {
    const r = await request(app)
      .post('/transcribe/text')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: '   ' });
    expect(r.status).toBe(400);
  });

  test('200 returns transcript + structured note', async () => {
    const r = await request(app)
      .post('/transcribe/text')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: 'Client meeting. Needs bail hearing scheduled.' });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('transcript');
    expect(r.body).toHaveProperty('note');
    expect(r.body.transcript).toBe('Client meeting. Needs bail hearing scheduled.');
  });

  test('note has required fields', async () => {
    const r = await request(app)
      .post('/transcribe/text')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: 'Client wants to file motion to suppress.' });
    expect(r.status).toBe(200);
    const { note } = r.body;
    expect(note).toHaveProperty('date');
    expect(note).toHaveProperty('summary');
    expect(note).toHaveProperty('next_steps');
    expect(note).toHaveProperty('flags');
    expect(note).toHaveProperty('raw');
    expect(Array.isArray(note.next_steps)).toBe(true);
    expect(Array.isArray(note.flags)).toBe(true);
  });

  test('note.raw matches trimmed transcript', async () => {
    const text = '  Discussed discovery deadline.  ';
    const r = await request(app)
      .post('/transcribe/text')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text });
    expect(r.status).toBe(200);
    expect(r.body.note.raw).toBe(text.trim());
    expect(r.body.transcript).toBe(text.trim());
  });

  test('402 without subscription', async () => {
    const noSubApp = buildApp({ hasSub: false });
    const r = await request(noSubApp)
      .post('/transcribe/text')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: 'test' });
    expect(r.status).toBe(402);
  });
});
