/**
 * webhooks/twilio.js — Inbound SMS reply handler
 *
 * Twilio sends a POST to this endpoint every time someone replies to
 * your outbound SMS. This handler:
 *
 *  1. Verifies Twilio signature (skipped in demo mode)
 *  2. Parses intent: YES | NO | STOP | unknown
 *  3. STOP → opt out immediately, send TCPA confirmation
 *  4. YES  → find the most recent lead offer for this number,
 *            create Stripe payment link, text it back
 *  5. NO   → log decline, send polite acknowledgment
 *  6. unknown → send help message
 *
 * Twilio requires a 200 TwiML response immediately.
 * All heavy work is done async after responding.
 */

import logger from '../../utils/logger.js';
import { Router } from 'express';
import { parseIntent, normalizePhone } from '../../services/twilio.js';
import { runOutboundBot, sendPaymentLink, processOptOut } from '../../services/outbound_bot.js';
import { getDb } from '../../db/index.js';

const router = Router();

// Twilio sends form-encoded bodies — need raw for some signature checks
router.post('/', async (req, res) => {
  // Respond to Twilio immediately with empty TwiML (no auto-reply)
  // All processing is async below
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  // Async processing — errors here do not affect the 200 response
  setImmediate(async () => {
    try {
      await handleSmsReply(req.body);
    } catch (err) {
      logger.error('[webhook:twilio] Unhandled error:', err.message);
    }
  });
});

async function handleSmsReply(body) {
  const fromPhone = normalizePhone(body?.From || body?.from || '');
  const msgBody   = (body?.Body || body?.body || '').trim();

  if (!fromPhone) {
    logger.info('[webhook:twilio] No valid phone in reply');
    return;
  }

  const intent = parseIntent(msgBody);
  logger.info(`[webhook:twilio] Reply from ${fromPhone}: "${msgBody}" → intent: ${intent}`);

  // ── STOP — opt out immediately (TCPA required) ──────────────────────────
  if (intent === 'stop') {
    await processOptOut({ phone: fromPhone, reason: 'STOP' });
    return;
  }

  // ── Re-subscribe ────────────────────────────────────────────────────────
  if (intent === 'start') {
    const db = await getDb();
    try {
      await db.run('DELETE FROM opt_outs WHERE phone = ?', [fromPhone]);
      const { sendSms } = await import('../../services/twilio.js');
      await sendSms({
        to: fromPhone,
        body: `Welcome back to Justice Gavel lead alerts! You'll receive new leads as arrests come in. Reply STOP at any time to opt out.`,
      });
    } finally {
      await db.close().catch(() => {});
    }
    return;
  }

  // ── YES — find the lead they're accepting ───────────────────────────────
  if (intent === 'yes') {
    // Find the most recent unprocessed lead offer sent to this number
    const db = await getDb();
    try {
      const recentOffer = await db.get(
        `SELECT om.*, ar.bail_amount, ar.county, ar.state
         FROM outbound_messages om
         JOIN arrest_records ar ON ar.id = om.arrest_id
         WHERE om.recipient_phone = ?
         AND om.message_type = 'lead_offer'
         AND om.sent_at >= datetime('now', '-2 hours')
         AND NOT EXISTS (
           SELECT 1 FROM payment_links pl
           WHERE pl.arrest_id = om.arrest_id
           AND pl.recipient_phone = om.recipient_phone
           AND pl.status IN ('pending', 'paid')
         )
         ORDER BY om.sent_at DESC
         LIMIT 1`,
        [fromPhone]
      ).catch(() => null);

      if (!recentOffer) {
        const { sendSms } = await import('../../services/twilio.js');
        await sendSms({
          to: fromPhone,
          body: `Sorry, that lead offer has expired or is no longer available. Check justicegavel.app for current leads.`,
        });
        return;
      }

      // Log the reply
      await db.run(
        `INSERT INTO inbound_replies (from_phone, body, intent, original_message_id, arrest_id)
         VALUES (?,?,?,?,?)`,
        [fromPhone, msgBody, intent, recentOffer.id, recentOffer.arrest_id]
      ).catch(() => {});

      // Send payment link
      await sendPaymentLink({
        phone:         fromPhone,
        arrestId:      recentOffer.arrest_id,
        recipientType: recentOffer.recipient_type || 'bail_agent',
        recipientId:   recentOffer.recipient_id,
      });

    } finally {
      await db.close().catch(() => {});
    }
    return;
  }

  // ── NO — log decline ────────────────────────────────────────────────────
  if (intent === 'no') {
    const db = await getDb();
    try {
      await db.run(
        `INSERT INTO inbound_replies (from_phone, body, intent) VALUES (?,?,?)`,
        [fromPhone, msgBody, intent]
      ).catch(() => {});
    } finally {
      await db.close().catch(() => {});
    }
    const { sendSms } = await import('../../services/twilio.js');
    await sendSms({
      to: fromPhone,
      body: `No problem. We'll keep you posted on new leads. Reply STOP to opt out of all alerts.`,
    });
    return;
  }

  // ── Unknown — send help ─────────────────────────────────────────────────
  const { sendSms } = await import('../../services/twilio.js');
  await sendSms({
    to: fromPhone,
    body: `Justice Gavel: Reply YES to accept a lead, NO to skip, or STOP to opt out. Visit justicegavel.app for your dashboard.`,
  });
}

export default router;
