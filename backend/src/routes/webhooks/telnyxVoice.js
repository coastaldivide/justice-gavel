/**
 * routes/webhooks/telnyxVoice.js — POST /api/webhooks/telnyx-voice: Telnyx Call Control (Voice API)
 * webhooks for the court-date phone line (build plan A10; services/phoneLine.js).
 *
 * Security: the same Ed25519 check as the messaging webhook (routes/webhooks/telnyx.js
 * verifyTelnyxSignature): headers telnyx-signature-ed25519 + telnyx-timestamp over
 * `${timestamp}|${rawBody}`, TELNYX_PUBLIC_KEY, at most 5 minutes old. Unsigned or badly signed
 * requests are refused (401); without TELNYX_PUBLIC_KEY every request is refused (503).
 * Off (TELNYX_VOICE_ENABLED not true): 503 feature_unavailable, nothing is answered.
 * Inbound text messages are NOT handled here (they stay on /api/webhooks/telnyx).
 * Mounted with a RAW body parser in app.js, before express.json().
 */
import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { verifyTelnyxSignature } from './telnyx.js';
import { handleVoiceEvent, phoneLineEnabled } from '../../services/phoneLine.js';
import logger from '../../utils/logger.js';

const router = Router();

router.post('/', async (req, res) => {
  const pub = process.env.TELNYX_PUBLIC_KEY;
  if (!pub) return res.status(503).json({ error: 'telnyx_webhook_not_configured', code: 'telnyx_webhook_not_configured' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
  if (!verifyTelnyxSignature(raw, req.get('telnyx-signature-ed25519'), req.get('telnyx-timestamp'), pub)) {
    return res.status(401).json({ error: 'bad_signature', code: 'bad_signature', message: 'The webhook signature is missing or not valid.' });
  }
  if (!phoneLineEnabled()) return res.status(503).json({ error: 'feature_unavailable', code: 'feature_unavailable', message: 'The court-date phone line is turned off.' });
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad_json', code: 'bad_json' }); }
  try {
    const r = await handleVoiceEvent(await getDb(), event);
    return res.json({ ok: true, action: r.action || null, ...(r.matched !== undefined ? { matched: r.matched } : {}) });
  } catch (e) {
    logger.error({ err: e.message }, '[telnyx-voice] webhook handling failed');
    return res.status(500).json({ error: 'server_error', code: 'server_error' });
  }
});

export default router;
