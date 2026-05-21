/**
 * translate.test.js — Live attorney-client translation
 *
 * Tests:
 *   Auth enforcement on protected endpoints
 *   Subscription gate (402 without sub, bypass for defender/attorney)
 *   POST /session — session creation, code format validation
 *   GET  /session/:code — session lookup, 404 for unknown code
 *   POST /session/:code/message — message storage, lang pair validation
 *   GET  /session/:code/messages — message retrieval, since param
 *   POST /message — standalone translation, input validation
 *
 * Full Claude translation requires live API key — fallback mode tested instead.
 * All tests use in-process mock app + sql.js in-memory DB.
 */
import express from 'express';
import request from 'supertest';
import jwt        from 'jsonwebtoken';
import { randomInt } from 'crypto';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok  = (id = 1, role = 'user')  => jwt.sign({ id, role }, SECRET, { expiresIn: '1h' });
const def_ = (id = 3)                  => jwt.sign({ id, role: 'defender' }, SECRET, { expiresIn: '1h' });
const atty = (id = 4)                  => jwt.sign({ id, role: 'attorney' }, SECRET, { expiresIn: '1h' });
const exp  = ()                         => jwt.sign({ id: 1 }, SECRET, { expiresIn: '-1s' });

const LANG_NAMES = { en: 'English', es: 'Spanish', pt: 'Brazilian Portuguese', vi: 'Vietnamese' };
const CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(db_sessions) {
  // Generate an unused 6-char code
  for (let i = 0; i < 20; i++) {
    const code = Array.from({ length: 6 }, () =>
      CODE_CHARS[randomInt(0, CODE_CHARS.length)]
    ).join('');
    if (!db_sessions.has(code)) return code;
  }
  return 'XXXXXX';
}

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS translation_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT UNIQUE NOT NULL,
      defender_id INTEGER,
      lang_a      TEXT DEFAULT 'en',
      lang_b      TEXT DEFAULT 'es',
      created_at  TEXT DEFAULT (datetime('now')),
      last_active TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS translation_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_code TEXT NOT NULL,
      side         TEXT NOT NULL,
      original     TEXT NOT NULL,
      translated   TEXT NOT NULL,
      src_lang     TEXT NOT NULL,
      tgt_lang     TEXT NOT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    );
  `);
}

function buildApp(db, { hasSub = false } = {}) {
  const app    = express();
  app.use(express.json());
  const router = express.Router();

  const usedCodes = new Set();

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try   { req.user = jwt.verify(t, SECRET); next(); }
    catch { return res.status(401).json({ error: 'invalid token' }); }
  }

  function subCheck(req, res, next) {
    const isDefender = ['defender', 'attorney'].includes(req.user?.role);
    if (!hasSub && !isDefender) {
      return res.status(402).json({ error: 'Active subscription required', code: 'subscription_required' });
    }
    next();
  }

  // POST /session — create session
  router.post('/session', auth, async (req, res) => {
    try {
      const { lang_a = 'en', lang_b = 'es' } = req.body || {};
      const VALID = new Set(['en','es','pt','vi']);
      if (!VALID.has(lang_a) || !VALID.has(lang_b)) {
        return res.status(400).json({ error: 'Invalid language code' });
      }
      const code = makeCode(usedCodes);
      usedCodes.add(code);
      await db.run(
        'INSERT INTO translation_sessions (code, defender_id, lang_a, lang_b) VALUES (?,?,?,?)',
        [code, req.user.id, lang_a, lang_b]
      );
      res.json({
        code, lang_a, lang_b,
        lang_a_name: LANG_NAMES[lang_a],
        lang_b_name: LANG_NAMES[lang_b],
      });
    } catch (e) { res.status(500).json({ error: 'Could not create session' }); }
  });

  // GET /session/:code — join existing session
  router.get('/session/:code', async (req, res) => {
    try {
      const sess = await db.get(
        'SELECT id, code, defender_id, lang_a, lang_b, created_at, last_active FROM translation_sessions WHERE code=?',
        [req.params.code.toUpperCase()]
      );
      if (!sess) return res.status(404).json({ error: 'Session not found. Check the code.' });
      res.json({ ...sess, lang_a_name: LANG_NAMES[sess.lang_a], lang_b_name: LANG_NAMES[sess.lang_b] });
    } catch (e) { res.status(500).json({ error: 'Could not load session' }); }
  });

  // POST /session/:code/message — add message
  router.post('/session/:code/message', async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const sess = await db.get('SELECT id, code, lang_a, lang_b FROM translation_sessions WHERE code=?', [code]);
      if (!sess) return res.status(404).json({ error: 'Session not found' });

      const { text, side } = req.body || {};
      if (!text?.trim()) return res.status(400).json({ error: 'text required' });
      if (!['a','b'].includes(side)) return res.status(400).json({ error: 'side must be a or b' });

      const srcLang = side === 'a' ? sess.lang_a : sess.lang_b;
      const tgtLang = side === 'a' ? sess.lang_b : sess.lang_a;
      // Without ANTHROPIC_KEY: translated = original (demo mode)
      const translated = `[${LANG_NAMES[tgtLang] || tgtLang}: ${text.trim()}]`;

      await db.run(
        'INSERT INTO translation_messages (session_code, side, original, translated, src_lang, tgt_lang) VALUES (?,?,?,?,?,?)',
        [code, side, text.trim(), translated, srcLang, tgtLang]
      );
      await db.run('UPDATE translation_sessions SET last_active=datetime(\'now\') WHERE code=?', [code]);

      res.json({ ok: true, original: text.trim(), translated, src_lang: srcLang, tgt_lang: tgtLang });
    } catch (e) { res.status(500).json({ error: 'Could not send message' }); }
  });

  // GET /session/:code/messages — poll
  router.get('/session/:code/messages', async (req, res) => {
    try {
      const code  = req.params.code.toUpperCase();
      const since = parseInt(req.query.since || '0', 10);
      const msgs  = await db.all(
        'SELECT id, session_code, side, original, translated, src_lang, tgt_lang, created_at FROM translation_messages WHERE session_code=? AND id>? ORDER BY created_at ASC LIMIT 50',
        [code, since]
      );
      res.json(msgs);
    } catch (e) { res.status(500).json({ error: 'Could not load messages' }); }
  });

  // POST /message — standalone translation (auth + sub gated)
  router.post('/message', auth, subCheck, (req, res) => {
    const { text, src_lang = 'en', tgt_lang = 'es' } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });
    // Async job response (no live API)
    res.json({ jobId: 'job_translate_test', status: 'pending', async: true });
  });

  app.use('/translate', router);
  return app;
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION CREATION
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /translate/session', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = buildApp(db, { hasSub: true }); });

  test('401 without token', async () => {
    const r = await request(app).post('/translate/session').send({ lang_a: 'en', lang_b: 'es' });
    expect(r.status).toBe(401);
  });

  test('200 creates session with valid language pair', async () => {
    const r = await request(app)
      .post('/translate/session')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ lang_a: 'en', lang_b: 'es' });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('code');
    expect(r.body.lang_a).toBe('en');
    expect(r.body.lang_b).toBe('es');
  });

  test('code is 6 uppercase alphanumeric characters', async () => {
    const r = await request(app)
      .post('/translate/session')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ lang_a: 'en', lang_b: 'vi' });
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^[A-Z0-9]{6}$/);
  });

  test('response includes lang name labels', async () => {
    const r = await request(app)
      .post('/translate/session')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ lang_a: 'en', lang_b: 'pt' });
    expect(r.status).toBe(200);
    expect(r.body.lang_a_name).toBe('English');
    expect(r.body.lang_b_name).toBe('Brazilian Portuguese');
  });

  test('two sessions get unique codes', async () => {
    const [r1, r2] = await Promise.all([
      request(app).post('/translate/session').set('Authorization', `Bearer ${tok()}`).send({ lang_a: 'en', lang_b: 'es' }),
      request(app).post('/translate/session').set('Authorization', `Bearer ${tok()}`).send({ lang_a: 'en', lang_b: 'es' }),
    ]);
    expect(r1.body.code).not.toBe(r2.body.code);
  });

  test('defaults to en/es when no lang pair provided', async () => {
    const r = await request(app)
      .post('/translate/session')
      .set('Authorization', `Bearer ${tok()}`)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.lang_a).toBe('en');
    expect(r.body.lang_b).toBe('es');
  });

  test('400 for invalid language code', async () => {
    const r = await request(app)
      .post('/translate/session')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ lang_a: 'xx', lang_b: 'es' });
    expect(r.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SESSION LOOKUP + MESSAGES
// ══════════════════════════════════════════════════════════════════════════════
describe('GET /translate/session/:code + message flow', () => {
  let app, db, sessionCode;
  beforeAll(async () => {
    db  = await makeTestDb();
    await buildSchema(db);
    app = buildApp(db, { hasSub: true });
    // Create a session to use in subsequent tests
    const r = await request(app)
      .post('/translate/session')
      .set('Authorization', `Bearer ${tok(5)}`)
      .send({ lang_a: 'en', lang_b: 'es' });
    sessionCode = r.body.code;
  });

  test('GET /session/:code → 200 with session data', async () => {
    const r = await request(app).get(`/translate/session/${sessionCode}`);
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(sessionCode);
    expect(r.body.lang_a).toBe('en');
    expect(r.body.lang_b).toBe('es');
    expect(r.body).toHaveProperty('lang_a_name');
    expect(r.body).toHaveProperty('lang_b_name');
  });

  test('GET /session/:code → lowercase code is normalised', async () => {
    const r = await request(app).get(`/translate/session/${sessionCode.toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(sessionCode);
  });

  test('GET /session/BADCODE → 404', async () => {
    const r = await request(app).get('/translate/session/ZZZZZ9');
    expect(r.status).toBe(404);
    expect(r.body.error).toBeTruthy();
  });

  test('POST /session/:code/message → side a sends message', async () => {
    const r = await request(app)
      .post(`/translate/session/${sessionCode}/message`)
      .send({ text: 'Hello, can you hear me?', side: 'a' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.original).toBe('Hello, can you hear me?');
    expect(r.body.src_lang).toBe('en');
    expect(r.body.tgt_lang).toBe('es');
    expect(r.body.translated).toBeTruthy();
  });

  test('POST /session/:code/message → side b sends message', async () => {
    const r = await request(app)
      .post(`/translate/session/${sessionCode}/message`)
      .send({ text: 'Sí, te escucho.', side: 'b' });
    expect(r.status).toBe(200);
    expect(r.body.src_lang).toBe('es');
    expect(r.body.tgt_lang).toBe('en');
  });

  test('POST /session/:code/message → 400 when text empty', async () => {
    const r = await request(app)
      .post(`/translate/session/${sessionCode}/message`)
      .send({ text: '', side: 'a' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('text required');
  });

  test('POST /session/:code/message → 400 for invalid side', async () => {
    const r = await request(app)
      .post(`/translate/session/${sessionCode}/message`)
      .send({ text: 'test', side: 'c' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('side must be a or b');
  });

  test('GET /session/:code/messages → returns messages array', async () => {
    const r = await request(app).get(`/translate/session/${sessionCode}/messages`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(2); // two messages sent above
  });

  test('GET /session/:code/messages?since= → only messages after since id', async () => {
    const allMsgs = (await request(app).get(`/translate/session/${sessionCode}/messages`)).body;
    const firstId = allMsgs[0].id;
    const r = await request(app).get(`/translate/session/${sessionCode}/messages?since=${firstId}`);
    expect(r.status).toBe(200);
    expect(r.body.every(m => m.id > firstId)).toBe(true);
  });

  test('each message has required fields', async () => {
    const r = await request(app).get(`/translate/session/${sessionCode}/messages`);
    r.body.forEach(m => {
      expect(m).toHaveProperty('id');
      expect(m).toHaveProperty('session_code');
      expect(m).toHaveProperty('side');
      expect(m).toHaveProperty('original');
      expect(m).toHaveProperty('translated');
      expect(m).toHaveProperty('src_lang');
      expect(m).toHaveProperty('tgt_lang');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STANDALONE TRANSLATION (subscription-gated)
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /translate/message — subscription gate', () => {
  let noSubApp, subApp, db;
  beforeAll(async () => {
    db        = await makeTestDb();
    noSubApp  = buildApp(db, { hasSub: false });
    subApp    = buildApp(db, { hasSub: true });
  });

  test('401 without token', async () => {
    const r = await request(noSubApp).post('/translate/message').send({ text: 'hi' });
    expect(r.status).toBe(401);
  });

  test('402 for regular user without subscription', async () => {
    const r = await request(noSubApp)
      .post('/translate/message')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: 'Hello', src_lang: 'en', tgt_lang: 'es' });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('subscription_required');
  });

  test('defender bypasses subscription gate', async () => {
    const r = await request(noSubApp)
      .post('/translate/message')
      .set('Authorization', `Bearer ${def_()}`)
      .send({ text: 'Hello', src_lang: 'en', tgt_lang: 'es' });
    // Gets past gate — 200 or 400 (missing text validation), never 402
    expect(r.status).not.toBe(402);
  });

  test('400 when text is empty', async () => {
    const r = await request(subApp)
      .post('/translate/message')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: '' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('text required');
  });

  test('200 with valid text and subscription → async job response', async () => {
    const r = await request(subApp)
      .post('/translate/message')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ text: 'Good morning', src_lang: 'en', tgt_lang: 'es' });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('jobId');
    expect(r.body.status).toBe('pending');
    expect(r.body.async).toBe(true);
  });
});
