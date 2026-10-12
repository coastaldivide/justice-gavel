import { requireAi, CLAUDE_MODEL } from '../utils/ai.js';
import { translateLimiter } from '../utils/rateLimiters.js';
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
import { err400, err404, safeInt, API_URLS } from '../utils/routeHelpers.js';
import express from 'express';
import { getDb } from '../db/index.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes as _tokBytes, randomBytes as _rb, timingSafeEqual } from 'crypto';
import { enqueueAIJob as enqueue } from '../services/aiQueue.js';
import logger from '../utils/logger.js';

const router = express.Router();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY ?? '');

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
const SESSION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars only
function makeCode() {
  const bytes = _rb(6);
  return Array.from(bytes, b => SESSION_CODE_CHARS[b % SESSION_CODE_CHARS.length]).join('');
}

// ── Session security (H7 / L3 / L6) ───────────────────────────────────────────
// A session has exactly two parties: the HOST (the signed-in account that
// created it) and ONE participant, bound on first join (by account when signed
// in, otherwise by an unguessable per-session token returned from the join
// call). Posting and reading messages requires being one of them — knowing the
// 6-character code is not enough. Every message is length-capped and each
// session has a message budget, so a session can't be used to burn AI spend.
export const MAX_TRANSLATE_CHARS   = 2000;
export const MAX_SESSION_MESSAGES  = 300;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;   // 4 h of inactivity

const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');
const newToken = () => _tokBytes(32).toString('base64url');
function tokenMatches(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(sha256(token)), b = Buffer.from(String(hash));
  return a.length === b.length && timingSafeEqual(a, b);
}
const sessionToken = (req) => String(req.headers['x-translate-token'] || req.body?.session_token || '').trim();
const isLive = (sess) => {
  const t = new Date(sess.last_active || sess.created_at || 0).getTime();
  return Number.isFinite(t) && Date.now() - t < SESSION_TTL_MS;
};
const codeOk = (c) => /^[A-Z0-9]{6,12}$/.test(c);

/** 'host' | 'participant' | null — who is calling for this session. */
function sessionRole(req, sess) {
  const uid = req.user?.id != null ? Number(req.user.id) : null;
  const tok = sessionToken(req);
  if ((uid && Number(sess.defender_id) === uid) || tokenMatches(tok, sess.host_token_hash)) return 'host';
  if ((uid && sess.participant_id != null && Number(sess.participant_id) === uid) || tokenMatches(tok, sess.participant_token_hash)) return 'participant';
  return null;
}

const keyBy = (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`);
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, keyGenerator: keyBy, validate: false,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many join attempts. Please wait and try again.' }),
});
const sessionMsgLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => `${keyBy(req)}:${String(req.params.code || '').toUpperCase()}`, validate: false,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Slow down — too many messages.' }),
});
const pollLimiter = rateLimit({
  windowMs: 60 * 1000, max: 90, keyGenerator: keyBy, validate: false,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests.' }),
});

const SESSION_COLS = 'id, code, defender_id, lang_a, lang_b, created_at, last_active, host_token_hash, participant_id, participant_token_hash, joined_at, message_count';

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
      model:      CLAUDE_MODEL,
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
if (!(process.env.ANTHROPIC_API_KEY ?? '')) {
  logger.debug('[translate.js] ANTHROPIC_API_KEY not set — AI translation disabled');
}

router.post('/message', authRequired, requireAi, perUserAiLimit, async (req, res) => {
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

   const { text, src_lang = 'en', tgt_lang = 'es' } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) return err400(res, 'text required');
    if (text.length > MAX_TRANSLATE_CHARS) return res.status(413).json({ error: 'text_too_long', max: MAX_TRANSLATE_CHARS });
    if (!LANG_NAMES[src_lang] || !LANG_NAMES[tgt_lang]) return err400(res, 'Unsupported language');
    const _txt = text.trim(); const _src = src_lang; const _tgt = tgt_lang;
    const jobId = await enqueue('translate', async () => {
      const t = await translate(_txt, _src, _tgt);
      return { original: _txt, translated: t, src_lang: _src, tgt_lang: _tgt };
    });
    return res.json({ jobId, status: 'pending', async: true });
  } catch {
    res.status(500).json({ error: 'Translation service unavailable. Please try again.' });
  }
});

// ── POST /api/translate/session — create session ──────────────────────────────
router.post('/session', authRequired, joinLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { lang_a = 'en', lang_b = 'es' } = req.body || {};
    if (!LANG_NAMES[lang_a] || !LANG_NAMES[lang_b]) return err400(res, 'Unsupported language');

    // Generate unique code
    let code, tries = 0;
    do {
      code = makeCode();
      const existing = await db.get('SELECT id FROM translation_sessions WHERE code=?', [code]);
      if (!existing) break;
      tries++;
    } while (tries < 10);

    const hostToken = newToken();
    await db.run(
      `INSERT INTO translation_sessions (code, defender_id, lang_a, lang_b, host_token_hash, message_count, last_active)
       VALUES (?,?,?,?,?,0,NOW())`,
      [code, req.user.id, lang_a, lang_b, sha256(hostToken)]
    );

    res.json({ code, lang_a, lang_b, lang_a_name: LANG_NAMES[lang_a], lang_b_name: LANG_NAMES[lang_b],
               session_token: hostToken, role: 'host' });
  } catch (e) {
    logger.error('[translate/session]', e.message);
    res.status(500).json({ error: 'Could not create session' });
  }
});

// ── GET /api/translate/session/:code — join existing session ──────────────────
// Joining binds the ONE participant seat: by account when signed in, or by the
// returned session_token for a guest. A second, different joiner gets 409.
router.get('/session/:code', optionalAuth, joinLimiter, translateLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const code = String(req.params.code || '').toUpperCase();
    if (!codeOk(code)) return err404(res, 'Session not found. Check the code.');
    const sess = await db.get(`SELECT ${SESSION_COLS} FROM translation_sessions WHERE code=? LIMIT 1`, [code]);
    if (!sess || !isLive(sess)) return err404(res, 'Session not found. Check the code.');

    const info = {
      code: sess.code, lang_a: sess.lang_a, lang_b: sess.lang_b,
      lang_a_name: LANG_NAMES[sess.lang_a], lang_b_name: LANG_NAMES[sess.lang_b],
      created_at: sess.created_at, last_active: sess.last_active,
    };
    const role = sessionRole(req, sess);
    if (role === 'host') return res.json({ ...info, role: 'host' });

    const uid = req.user?.id != null ? Number(req.user.id) : null;
    const seatFree = sess.participant_id == null && !sess.participant_token_hash;
    if (seatFree || (role === 'participant' && uid)) {
      // Bind (or, for the same signed-in participant on a new device, re-issue) the seat.
      const tok = newToken();
      const r = await db.run(
        `UPDATE translation_sessions
            SET participant_id = COALESCE(participant_id, ?), participant_token_hash = ?, joined_at = COALESCE(joined_at, NOW())
          WHERE id = ? AND (
                (participant_id IS NULL AND participant_token_hash IS NULL)
             OR (participant_id IS NOT NULL AND participant_id = ?))`,
        [uid, sha256(tok), sess.id, uid]
      );
      if (r.changes) return res.json({ ...info, role: 'participant', side: 'b', session_token: tok });
    }
    if (role === 'participant') return res.json({ ...info, role: 'participant', side: 'b' });
    return res.status(409).json({ error: 'session_already_joined', message: 'Someone has already joined this session. Ask for a new code.' });
  } catch (e) {
    logger.error('[translate/session/get]', e.message);
    res.status(500).json({ error: 'Could not load session' });
  }
});

// ── POST /api/translate/session/:code/message ─────────────────────────────────
router.post('/session/:code/message', optionalAuth, sessionMsgLimiter, async (req, res) => {
  try {
    const db = await getDb();

    const code = String(req.params.code || '').toUpperCase();
    if (!codeOk(code)) return err404(res, 'Session not found');
    const sess = await db.get(`SELECT ${SESSION_COLS} FROM translation_sessions WHERE code=? LIMIT 1`, [code]);
    if (!sess || !isLive(sess)) return err404(res, 'Session not found');
    const role = sessionRole(req, sess);
    if (!role) return res.status(403).json({ error: 'not_session_member', message: 'Join this session first.' });

    const { text, side } = req.body || {}; // side: 'a' or 'b'
    if (typeof text !== 'string' || !text.trim()) return err400(res, 'text required');
    if (text.length > MAX_TRANSLATE_CHARS) return res.status(413).json({ error: 'text_too_long', max: MAX_TRANSLATE_CHARS });
    if (!['a', 'b'].includes(side)) return err400(res, 'side must be a or b');
    // The participant speaks for side b only; the host's phone may voice both (solo mode).
    if (role === 'participant' && side !== 'b') return res.status(403).json({ error: 'wrong_side' });

    // Per-session AI budget — reserved atomically before the model call.
    const budget = await db.run(
      'UPDATE translation_sessions SET message_count = COALESCE(message_count, 0) + 1, last_active = NOW() WHERE id = ? AND COALESCE(message_count, 0) < ?',
      [sess.id, MAX_SESSION_MESSAGES]
    );
    if (!budget.changes) return res.status(429).json({ error: 'session_message_limit', message: 'This session has reached its message limit. Start a new session.' });

    const srcLang = side === 'a' ? sess.lang_a : sess.lang_b;
    const tgtLang = side === 'a' ? sess.lang_b : sess.lang_a;

    let translated;
    try {
      translated = await translate(text.trim(), srcLang, tgtLang);
    } catch (e) {
      logger.warn('[translate/session/message] translation failed — using original:', e?.message);
      translated = text.trim(); // fallback — show original if translation fails
    }

    const ins = await db.run(
      `INSERT INTO translation_messages (session_code, side, original, translated, src_lang, tgt_lang)
       VALUES (?,?,?,?,?,?)`,
      [code, side, text.trim(), translated, srcLang, tgtLang]
    );

    res.json({ ok: true, id: ins.lastID || undefined, original: text.trim(), translated, src_lang: srcLang, tgt_lang: tgtLang });
  } catch (e) {
    logger.error('[translate/message]', e.message);
    res.status(500).json({ error: 'Could not send message' });
  }
});

// ── GET /api/translate/session/:code/messages?since=<id> ─────────────────────
// Short-poll endpoint — called every 2 seconds by both sides

// Supported live translation languages (matches i18n locales + common immigrant languages)

router.get('/session/:code/messages', optionalAuth, pollLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const code  = String(req.params.code || '').toUpperCase();
    if (!codeOk(code)) return err404(res, 'Session not found');
    const sess = await db.get(`SELECT ${SESSION_COLS} FROM translation_sessions WHERE code=? LIMIT 1`, [code]);
    if (!sess || !isLive(sess)) return err404(res, 'Session not found');
    if (!sessionRole(req, sess)) return res.status(403).json({ error: 'not_session_member', message: 'Join this session first.' });
    const since = safeInt(req.query.since || '0');

    const msgs = await db.all(
      `SELECT id, session_code, side, original, translated, src_lang, tgt_lang, created_at
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