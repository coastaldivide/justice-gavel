/**
 * routes/webhooks/telnyx.js — POST /api/webhooks/telnyx (Telnyx Messaging webhooks).
 *
 * Why: when someone replies STOP to a reminder text, Telnyx blocks further texts to that
 * number, but the app still had users.sms_reminders = 1 and would keep trying (and the
 * court-date screen would keep saying "text reminders on"). This keeps the app in step:
 *   message.received with STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT
 *     → every account with that phone: sms_reminders = 0, sms_opt_out_at = now, and the number
 *       goes on sms_opt_outs (no more Bond Desk texts sent for bail agents, migration 32)
 *   message.received with START / UNSTOP → the number leaves sms_opt_outs; app reminders stay
 *     off until the person turns them on in the app, which records fresh consent (migration 31).
 *   message.received with 1 / 2 / 3 from a number asked "Did you make it to court today?" in the
 *     last 48 hours → that hearing is marked attended / rescheduled / missed (services/courtReplies.js)
 *   message.received with anything else (not STOP / START / HELP / 1 / 2 / 3) from a public defender
 *     office's client → that office's shared inbox (services/publicDefender/texts.js routeInbound)
 *   message.finalized → the text's final delivery status into sms_delivery (migration 33):
 *     Bond Desk shows it per text; monitoring/smsHealth.js alerts when many texts fail.
 * Other events are acknowledged and ignored.
 *
 * Replays (review finding 7): each event's data.id is claimed once in telnyx_event_log; a replayed
 * or retried event is answered { ok: true, duplicate: true } and not processed again (an old STOP
 * replayed after a newer START does not opt the number out again). STOP / START and delivery
 * statuses are applied before the 200 (fast, and a failure there makes Telnyx retry); the slow part
 * — court answers 1 / 2 / 3 and the office inbox, which can send texts — runs after Telnyx has its
 * 200, with its outcome (done / failed + error) in telnyx_event_log.
 *
 * Security: Telnyx signs each webhook with Ed25519 — headers telnyx-signature-ed25519
 * (base64) and telnyx-timestamp; the signed payload is `${timestamp}|${rawBody}`. Set
 * TELNYX_PUBLIC_KEY (Mission Control → Keys & Credentials → Public Key, base64). Without
 * it every request is refused (503), never trusted. Requests older than 5 minutes are refused.
 * Mounted with a RAW body parser in app.js, before express.json().
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../../db/index.js';
import { toE164 } from '../../services/sms.js';
import { handleCourtReplyText } from '../../services/courtReplies.js';
import { routeInbound } from '../../services/publicDefender/texts.js';
import logger from '../../utils/logger.js';

const router = Router();

// The slow part runs after the 200; tests (and a graceful shutdown) can wait for it.
const inFlight = new Set();
/** Resolves when every inbound text accepted so far has been handled. */
export async function inboundIdle() {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}
function afterAck(db, eventId, fn) {
  const p = (async () => {
    try {
      await fn();
      if (eventId) await db.run(`UPDATE telnyx_event_log SET status = 'done' WHERE event_id = ?`, [eventId]);
    } catch (e) {
      logger.error({ err: e?.message }, '[telnyx] inbound text not handled');
      if (eventId) await db.run(`UPDATE telnyx_event_log SET status = 'failed', error = ? WHERE event_id = ?`, [String(e?.message || 'error').slice(0, 300), eventId]).catch(() => null);
    }
  })();
  inFlight.add(p);
  p.finally(() => inFlight.delete(p));
}
const MAX_AGE_S = 300;
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'UNSTOP']);
// Ed25519 SubjectPublicKeyInfo prefix for a raw 32-byte key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyTelnyxSignature(rawBody, signatureB64, timestamp, publicKeyB64, nowS = Math.floor(Date.now() / 1000)) {
  if (!rawBody || !signatureB64 || !timestamp || !publicKeyB64) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > MAX_AGE_S) return false;
  try {
    const raw = Buffer.from(String(publicKeyB64), 'base64');
    if (raw.length !== 32) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
    const payload = Buffer.concat([Buffer.from(`${timestamp}|`), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody))]);
    return crypto.verify(null, payload, key, Buffer.from(String(signatureB64), 'base64'));
  } catch {
    return false;
  }
}

router.post('/', async (req, res) => {
  const pub = process.env.TELNYX_PUBLIC_KEY;
  if (!pub) return res.status(503).json({ error: 'telnyx_webhook_not_configured' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
  if (!verifyTelnyxSignature(raw, req.get('telnyx-signature-ed25519'), req.get('telnyx-timestamp'), pub)) {
    return res.status(401).json({ error: 'bad_signature' });
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad_json' }); }
  const type = event?.data?.event_type;
  const p = event?.data?.payload || {};
  const eventId = event?.data?.id ? String(event.data.id).slice(0, 120) : null;
  let claimed = false;
  try {
    if (eventId) {
      const db = await getDb();
      const c = await db.get(
        `INSERT INTO telnyx_event_log (event_id, event_type) VALUES (?, ?) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [eventId, type ? String(type).slice(0, 60) : null]);
      if (!c) return res.json({ ok: true, duplicate: true });
      claimed = true;
    }
    let slow = null;
    if (type === 'message.received') {
      const word = String(p.text || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
      const from = toE164(p.from?.phone_number);
      if (from && STOP_WORDS.has(word)) {
        const db = await getDb();
        const r = await db.run(
          'UPDATE users SET sms_reminders = 0, sms_opt_out_at = NOW() WHERE phone = ? AND sms_reminders = 1', [from]);
        // Also for people without an account (Bond Desk texts sent for a bail agent).
        await db.run('INSERT INTO sms_opt_outs (phone) VALUES (?) ON CONFLICT (phone) DO UPDATE SET opted_out_at = NOW()', [from]);
        logger.info({ changed: r?.changes ?? null }, '[telnyx] STOP received — text reminders turned off');
      }
      if (from && START_WORDS.has(word)) {
        // The person asked for texts again: agents may text them again. App reminders still
        // need the person to turn them on in the app (fresh consent, migration 31).
        const db = await getDb();
        await db.run('DELETE FROM sms_opt_outs WHERE phone = ?', [from]);
      }
      if (from && !STOP_WORDS.has(word) && !START_WORDS.has(word)) {
        slow = async () => {
          // "Did you make it to court?" answered 1 / 2 / 3 (services/courtReplies.js). Anything
          // else, or a number not asked in the last 48 hours, changes nothing.
          const r = await handleCourtReplyText({ from, text: p.text });
          if (r.handled) logger.info({ kind: r.kind, status: r.status, applied: r.applied }, '[telnyx] court answer received');
          // Anything else (not STOP / START / HELP / 1 / 2 / 3) from a public defender office's
          // client goes to that office's shared inbox (services/publicDefender/texts.js, ⚖ flag).
          if (!r.handled) {
            const inbox = await routeInbound(await getDb(), { from, text: p.text });
            if (inbox.handled) logger.info({ office: inbox.office_id }, '[telnyx] client text routed to an office inbox');
          }
        };
      }
    }
    if (type === 'message.finalized' && p.id) {
      // Final delivery status of a text we sent (one recipient per message).
      const to = Array.isArray(p.to) ? p.to[0] : null;
      const status = String(to?.status || p.status || 'unknown').slice(0, 40);
      const code = Array.isArray(p.errors) && p.errors[0]?.code ? String(p.errors[0].code).slice(0, 20) : null;
      const digits = String(to?.phone_number || '').replace(/\D/g, '');
      const db = await getDb();
      await db.run(`INSERT INTO sms_delivery (provider_id, status, error_code, to_masked) VALUES (?, ?, ?, ?)
                    ON CONFLICT (provider_id) DO UPDATE SET status = EXCLUDED.status, error_code = EXCLUDED.error_code, finalized_at = NOW()`,
        [String(p.id).slice(0, 80), status, code, digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : null]);
      if (status !== 'delivered') logger.warn({ status, code }, '[telnyx] text not delivered');
    }
    const db = await getDb();
    if (!slow && eventId) await db.run(`UPDATE telnyx_event_log SET status = 'done' WHERE event_id = ?`, [eventId]).catch(() => null);
    res.json({ ok: true });
    if (slow) afterAck(db, eventId, slow);
    return undefined;
  } catch (e) {
    logger.error({ err: e.message }, '[telnyx] webhook handling failed');
    // not handled: let Telnyx's retry be processed (the claim is released)
    if (res.headersSent) return undefined;
    if (claimed) await (await getDb()).run('DELETE FROM telnyx_event_log WHERE event_id = ?', [eventId]).catch(() => null);
    return res.status(500).json({ error: 'server_error' });   // Telnyx retries
  }
});

export default router;
