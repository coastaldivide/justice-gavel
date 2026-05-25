// AI route — general guidance only, not legal advice
/**
 * translate.js — Live attorney-client translation
 *
 * POST /api/translate/message    — translate a single message
 * POST /api/translate/session    — create/get a translation session
 * GET  /api/translate/session/:code — get session by join code
 * POST /api/translate/session/:code/message — add message to session
 * GET  /api/translate/session/:code/messages — poll for new messages
 *
 * Architecture: turn-based translation via short polling (no WebSocket).
 * Both phones hit the same session code. Each message is translated by
 * Claude into the target language and stored. Other phone polls every
 * 2 seconds and shows new messages immediately.
 *
 * Session join code: 6-character alphanumeric (e.g. "K7M2PX")
 * Sessions expire after 4 hours of inactivity.
 *
 * Cost per message: ~$0.0003 (100 tokens in + 100 out)
 * At 50 msgs/session: ~$0.015 per meeting
 * Included in base paid tier — not a paywall item.
 *
 * Languages: EN · ES · PT (Brazilian) · VI
 */

import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere, API_URLS } from '../utils/routeHelpers.js';
import express from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { enqueue } from '../services/aiQueue.js';
import logger from '../utils/logger.js';

const router = express.Router();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const LANG_NAMES = {
  en: 'English',
  es: 'Spanish',
  pt: 'Brazilian Portuguese',
  vi: 'Vietnamese',
};

// Tables defined in db/index.js Year 2 block — no per-request DDL needed.

// ── Cryptographically secure 6-char session join code ────────────────────────
// Math.random() is non-cryptographic — a determined observer could predict
// upcoming session codes. randomBytes gives 2^48 of secure entropy.
import { randomBytes as _rb } from 'crypto';
const SESSION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars only
function makeCode() {
  const bytes = _rb(6);
  return Array.from(bytes, b => SESSION_CODE_CHARS[b % SESSION_CODE_CHARS.length]).join('');
}

// ── Claude translation ────────────────────────────────────────────────────────
async function translate(text, srcLang, tgtLang) {
  if (srcLang === tgtLang) return text;

  if (!ANTHROPIC_KEY) {
    // Demo mode — bracket notation shows it would be translated
    return `[${LANG_NAMES[tgtLang] || tgtLang}: ${text}]`;
  }

  const srcName = LANG_NAMES[srcLang] || srcLang;
  const tgtName = LANG_NAMES[tgtLang] || tgtLang;

  const res = await fetch(API_URLS.ANTHROPIC, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      temperature: 0.1,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Translate the following text from ${srcName} to ${tgtName}.

Context: This is a legal conversation between a criminal defense attorney and their client. Translate accurately and professionally. Preserve legal terms where appropriate. Do not add any explanation — output ONLY the translation.

Text to translate:
${text}`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Translation error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || text;
}

// ── POST /api/translate/message — standalone translation ─────────────────────
// ── API key guard — fail fast with clear error rather than cryptic undefined ─
if (!process.env.ANTHROPIC_API_KEY) {
  logger.error('[translate.js] ANTHROPIC_API_KEY not set — all AI routes will fail');
}

router.post('/message', authRequired, perUserAiLimit, async (req, res) => {
  try {

    // Verify caller has an active subscription or is using defender mode
    let subCheck = null;
    try {
      const db = await (await import('../db/index.js')).getDb();
      subCheck = await db.get(
        `SELECT id FROM subscriptions WHERE user_id=? AND status='active' LIMIT 1`,
        [req.user.id]
      ).catch(() => null);
    } catch (e) { logger.warn('[translate/sub-check]', e?.message); subCheck = null; }
    const isDefender = req.user?.role === 'defender' || req.user?.role === 'attorney';
    if (!subCheck && !isDefender) {
      return res.status(402).json({
        error: 'Active subscription required',
        code: 'subscription_required',
        upgrade_url: '/subscribe'
      });
    }

   const { text, src_lang = 'en', tgt_lang = 'es' } = req.body;
    if (!text?.trim()) return err400(res, 'text required');
    const _txt = text.trim(); const _src = src_lang; const _tgt = tgt_lang;
    const jobId = await enqueue('translate', async () => {
      const t = await translate(_txt, _src, _tgt);
      return { original: _txt, translated: t, src_lang: _src, tgt_lang: _tgt };
    });
    return res.json({ jobId, status: 'pending', async: true });
  } catch (e) {
    res.status(500).json({ error: 'Translation service unavailable. Please try again.' });
  }
});

// ── POST /api/translate/session — create session ──────────────────────────────
router.post('/session', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { lang_a = 'en', lang_b = 'es' } = req.body;

    // Generate unique code
    let code, tries = 0;
    do {
      code = makeCode();
      const existing = await db.get('SELECT id FROM translation_sessions WHERE code=?', [code]);
      if (!existing) break;
      tries++;
    } while (tries < 10);

    await db.run(
      `INSERT INTO translation_sessions (code, defender_id, lang_a, lang_b)
       VALUES (?,?,?,?)`,
      [code, req.user.id, lang_a, lang_b]
    );

    res.json({ code, lang_a, lang_b, lang_a_name: LANG_NAMES[lang_a], lang_b_name: LANG_NAMES[lang_b] });
  } catch (e) {
    logger.error('[translate/session]', e.message);
    res.status(500).json({ error: 'Could not create session' });
  }
});

// ── GET /api/translate/session/:code — join existing session ──────────────────
router.get('/session/:code', async (req, res) => {
  // No auth required — client joins with just the code
  try {
    const db = await getDb();
    const sess = await db.get(
      'SELECT id, code, defender_id, lang_a, lang_b, created_at, last_active FROM translation_sessions WHERE code=? LIMIT 1',
      [req.params.code.toUpperCase()]
    );
    if (!sess) return err404(res, 'Session not found. Check the code.');
    res.json({
      ...sess,
      lang_a_name: LANG_NAMES[sess.lang_a],
      lang_b_name: LANG_NAMES[sess.lang_b],
    });
  } catch (e) {
    logger.error('[translate/session/get]', e.message);
    res.status(500).json({ error: 'Could not load session' });
  }
});

// ── POST /api/translate/session/:code/message ─────────────────────────────────
router.post('/session/:code/message', async (req, res) => {
  try {
    const db = await getDb();

    const code = req.params.code.toUpperCase();
    const sess = await db.get('SELECT id, code, defender_id, lang_a, lang_b FROM translation_sessions WHERE code=? LIMIT 1', [code]);
    if (!sess) return err404(res, 'Session not found');

    const { text, side } = req.body; // side: 'a' or 'b'
    if (!text?.trim()) return err400(res, 'text required');
    if (!['a', 'b'].includes(side)) return err400(res, 'side must be a or b');

    const srcLang = side === 'a' ? sess.lang_a : sess.lang_b;
    const tgtLang = side === 'a' ? sess.lang_b : sess.lang_a;

    let translated;
    try {
      translated = await translate(text.trim(), srcLang, tgtLang);
    } catch (e) {
      logger.warn('[translate/session/message] translation failed — using original:', e?.message);
      translated = text.trim(); // fallback — show original if translation fails
    }

    await db.run(
      `INSERT INTO translation_messages (session_code, side, original, translated, src_lang, tgt_lang)
       VALUES (?,?,?,?,?,?)`,
      [code, side, text.trim(), translated, srcLang, tgtLang]
    );

    // Update last_active
    await db.run(
      `UPDATE translation_sessions SET last_active=datetime('now') WHERE code=?`,
      [code]
    );

    res.json({ ok: true, original: text.trim(), translated, src_lang: srcLang, tgt_lang: tgtLang });
  } catch (e) {
    logger.error('[translate/message]', e.message);
    res.status(500).json({ error: 'Could not send message' });
  }
});

// ── GET /api/translate/session/:code/messages?since=<id> ─────────────────────
// Short-poll endpoint — called every 2 seconds by both sides
router.get('/session/:code/messages', async (req, res) => {
  try {
    const db = await getDb();
    const code  = req.params.code.toUpperCase();
    const since = safeInt(req.query.since || '0');

    const msgs = await db.all(
      `SELECT id, session_code, role, content, lang, created_at
       FROM translation_messages
       WHERE session_code=? AND id > ?
       ORDER BY created_at ASC LIMIT 50`,
      [code, since]
    );
    res.json(msgs);
  } catch (e) {
    logger.error('[translate/session/messages]', e.message);
    res.status(500).json({ error: 'Could not load messages' });
  }
});

export default router;
