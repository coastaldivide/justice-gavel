/**
 * services/twilio.js — Twilio SMS service
 *
 * Replaces the previous stub (sendSMS = async () => null).
 * Sends real SMS for court date reminders, bail alerts, family notifications.
 *
 * Env vars required (set in Railway):
 *   TWILIO_ACCOUNT_SID  — starts with AC...
 *   TWILIO_AUTH_TOKEN   — secret token
 *   TWILIO_PHONE        — your purchased Twilio number (+1XXXXXXXXXX)
 */

import logger from '../utils/logger.js';
import { normalizePhone, sanitizeStr } from '../utils/sanitize.js';

// Lazy-import Twilio client only when env vars are present
function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    logger.warn('[twilio] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — SMS disabled');
    return null;
  }
  // Dynamic import keeps startup fast when Twilio is unconfigured
  const { default: Twilio } = require('twilio');
  return new Twilio(sid, token);
}

const FROM = process.env.TWILIO_PHONE || '';

/**
 * Send an SMS message.
 * @param {string} to     — recipient phone number (any format, gets normalized)
 * @param {string} body   — message text (max 1600 chars; long messages split automatically)
 * @returns {{ sid: string } | null}
 */
export async function sendSMS(to, body) {
  try {
    const client = getTwilioClient();
    if (!client) return null;

    const phone = normalizePhone(to);
    if (!phone) {
      logger.warn('[twilio] sendSMS: invalid phone number', { to });
      return null;
    }

    const safeBody = sanitizeStr(body).slice(0, 1600);
    if (!safeBody) {
      logger.warn('[twilio] sendSMS: empty body');
      return null;
    }

    const msg = await client.messages.create({
      from: FROM,
      to:   phone,
      body: safeBody,
    });

    logger.info('[twilio] SMS sent', { sid: msg.sid, to: phone.slice(0, 6) + '****' });
    return { sid: msg.sid };
  } catch (err) {
    logger.error('[twilio] sendSMS failed', { error: err?.message, code: err?.code });
    return null;
  }
}

/** Court date reminder — sent 48h and 24h before hearing */
export async function sendCourtReminder(phone, { defendantName, courtDate, courtroom, caseNumber }) {
  const dateStr = new Date(courtDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr = new Date(courtDate).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  const body = [
    `⚖️ JUSTICE GAVEL COURT REMINDER`,
    `Defendant: ${sanitizeStr(defendantName).slice(0, 50)}`,
    `Date: ${dateStr} at ${timeStr}`,
    courtroom ? `Courtroom: ${sanitizeStr(courtroom).slice(0, 30)}` : null,
    caseNumber ? `Case #: ${sanitizeStr(caseNumber).slice(0, 30)}` : null,
    `Reply STOP to unsubscribe.`,
  ].filter(Boolean).join('\n');

  return sendSMS(phone, body);
}

/** Bail set alert — sent to defendant and family contact */
export async function sendBailAlert(phone, { defendantName, bailAmount, bondsmanName, bondsmanPhone }) {
  const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  const body = [
    `⚖️ BAIL SET — Justice Gavel`,
    `${sanitizeStr(defendantName).slice(0, 50)} has bail set at ${fmt(bailAmount)}.`,
    bondsmanName ? `Bondsman: ${sanitizeStr(bondsmanName)} — ${bondsmanPhone}` : null,
    `10% bond = ${fmt(bailAmount * 0.10)} to secure release.`,
    `Open Justice Gavel for details.`,
  ].filter(Boolean).join('\n');

  return sendSMS(phone, body);
}

/** Check-in missed — sent to supervising attorney or family */
export async function sendCheckInMissed(phone, { defendantName, missedDate, checkInUrl }) {
  const body = [
    `🚨 MISSED CHECK-IN — Justice Gavel`,
    `${sanitizeStr(defendantName).slice(0, 50)} did not check in on ${missedDate}.`,
    `Contact defendant immediately — this may violate release conditions.`,
    checkInUrl ? `Check-in link: ${checkInUrl}` : null,
  ].filter(Boolean).join('\n');

  return sendSMS(phone, body);
}

/** Family alert — when defendant is arrested or status changes */
export async function sendFamilyAlert(phone, { defendantName, status, facility, phone: defPhone }) {
  const body = [
    `⚖️ FAMILY ALERT — Justice Gavel`,
    `${sanitizeStr(defendantName).slice(0, 50)}: ${sanitizeStr(status).slice(0, 80)}`,
    facility ? `Facility: ${sanitizeStr(facility).slice(0, 60)}` : null,
    defPhone  ? `Defendant phone: ${defPhone}` : null,
    `Open Justice Gavel for attorney contacts and next steps.`,
  ].filter(Boolean).join('\n');

  return sendSMS(phone, body);
}
