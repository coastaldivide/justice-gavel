/**
 * routes/webhooks/telnyx.js — POST /api/webhooks/telnyx (Telnyx Messaging webhooks).
 *
 * Why: when someone replies STOP to a reminder text, Telnyx blocks further texts to that
 * number, but the app still had users.sms_reminders = 1 and would keep trying (and the
 * court-date screen would keep saying "text reminders on"). This keeps the app in step:
 *   message.received with STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT
 *     → every account with that phone: sms_reminders = 0, sms_opt_out_at = now
 *   message.received with START / UNSTOP → nothing automatic: the person turns texts back on
 *     in the app, which records fresh consent (migration 31).
 * Other events are acknowledged and ignored.
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
import logger from '../../utils/logger.js';

const router = Router();
const MAX_AGE_S = 300;
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
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
  try {
    if (type === 'message.received') {
      const word = String(p.text || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
      const from = toE164(p.from?.phone_number);
      if (from && STOP_WORDS.has(word)) {
        const db = await getDb();
        const r = await db.run(
          'UPDATE users SET sms_reminders = 0, sms_opt_out_at = NOW() WHERE phone = ? AND sms_reminders = 1', [from]);
        logger.info({ changed: r?.changes ?? null }, '[telnyx] STOP received — text reminders turned off');
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e.message }, '[telnyx] webhook handling failed');
    return res.status(500).json({ error: 'server_error' });   // Telnyx retries
  }
});

export default router;
