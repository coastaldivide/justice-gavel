import logger from '../utils/logger.js';
/**
 * twilio.js — Production-grade Twilio SMS service
 *
 * Handles:
 *  - Outbound SMS (lead offers, payment links, lead delivery)
 *  - Inbound webhook signature verification
 *  - Mock mode when TWILIO_ACCOUNT_SID is not set
 */

import { CONFIG } from '../config.js';

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken  = process.env.TWILIO_AUTH_TOKEN  || '';
const fromNumber = process.env.TWILIO_FROM_NUMBER || '+15550000000';
const LIVE = !!(accountSid && authToken);

let twilioClient = null;

// ── Send SMS ──────────────────────────────────────────────────────────────────
export async function sendSms({ to, body }) {
  // Normalize number
  const normalized = normalizePhone(to);
  if (!normalized) {
    logger.error('[twilio] Invalid phone number:', to);
    return { error: 'invalid_phone', mock: true };
  }

  if (!LIVE) {
    logger.info(`[twilio:mock] SMS to ${normalized}: ${body.substring(0, 80)}...`);
    return { mock: true, sid: 'SM_mock_' + Date.now(), to: normalized };
  }

  try {
    const client = await getTwilioClient();
    const msg = await client.messages.create({
      body,
      from: fromNumber,
      to: normalized,
    });
    logger.info(`[twilio] SMS sent → ${normalized} (${msg.sid})`);
    return { sid: msg.sid, status: msg.status, to: normalized };
  } catch (err) {
    logger.error(`[twilio] SMS failed → ${normalized}:`, err.message);
    return { error: err.message, code: err.code };
  }
}

// ── Verify Twilio webhook signature ──────────────────────────────────────────
export function verifyTwilioSignature(req) {
  if (!LIVE) return true; // Always pass in demo mode
  try {
    const twilio = require('twilio');
    const signature = req.headers['x-twilio-signature'] || '';
    const url = process.env.BOT_WEBHOOK_BASE_URL + req.originalUrl;
    return twilio.validateRequest(authToken, signature, url, req.body);
  } catch {
    return false;
  }
}

// ── Parse reply intent ────────────────────────────────────────────────────────
export function parseIntent(body) {
  if (!body) return 'unknown';
  const t = body.trim().toLowerCase();
  // Opt-out — TCPA required, must be honored immediately
  if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].includes(t)) return 'stop';
  // Opt back in
  if (['start', 'unstop', 'yes i want leads again'].includes(t)) return 'start';
  // Accept
  if (['yes', 'y', 'yeah', 'yep', 'ok', 'okay', 'send it', 'send', 'accept', 'i want it', 'interested', '1'].includes(t)) return 'yes';
  // Decline
  if (['no', 'n', 'nope', 'not interested', 'pass', 'skip', '2'].includes(t)) return 'no';
  // Partial matches
  if (t.startsWith('yes') || t.includes('want it') || t.includes('interested')) return 'yes';
  if (t.startsWith('no') || t.includes('not interested')) return 'no';
  if (t.startsWith('stop') || t.includes('unsubscribe')) return 'stop';
  return 'unknown';
}

// ── Phone normalization ───────────────────────────────────────────────────────
export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (digits.length > 10) return '+' + digits;
  return null;
}

// Lazy async client loader
async function getTwilioClient() {
  if (twilioClient) return twilioClient;
  const { default: twilio } = await import('twilio');
  twilioClient = twilio(accountSid, authToken);
  return twilioClient;
}

export const TWILIO_LIVE = LIVE;
export const TWILIO_FROM = fromNumber;
