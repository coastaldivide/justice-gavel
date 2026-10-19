/**
 * services/sms.js — text-message delivery through Twilio's REST API.
 *
 * Optional. SMS is used only when ALL of these are set:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (E.164, e.g. +16155550123)
 * Without them smsLive() is false and sendSms() returns
 * { skipped: true, reason: 'sms_not_configured' } — nothing is sent, nothing
 * throws, and the reminder chain moves on. TWILIO_API_BASE overrides the API
 * host (tests / a regional edge).
 *
 * Numbers are normalised to E.164 (+1 for 10-digit US numbers). Phone numbers
 * and message bodies are never logged.
 */
import { fetchWithTimeout } from '../utils/http.js';
import logger from '../utils/logger.js';

const SMS_TIMEOUT_MS = 10_000;

export function smsLive() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

/** '(615) 555-0123' → '+16155550123'; anything that is not a plausible number → null. */
export function toE164(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/**
 * Send one text. Resolves to { ok: true, sid } | { ok: false, error } |
 * { skipped: true, reason }. Never throws.
 */
export async function sendSms({ to, body }) {
  if (!smsLive()) return { skipped: true, reason: 'sms_not_configured' };
  const dest = toE164(to);
  if (!dest) return { skipped: true, reason: 'no_valid_number' };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const base = String(process.env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/+$/, '');
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  try {
    const res = await fetchWithTimeout(`${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: dest, From: process.env.TWILIO_FROM_NUMBER, Body: String(body || '').slice(0, 640) }).toString(),
    }, { timeoutMs: SMS_TIMEOUT_MS });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      logger.warn({ status: res.status, code: json?.code }, '[sms] Twilio refused the message');
      return { ok: false, error: `twilio_${res.status}` };
    }
    return { ok: true, sid: json?.sid || null };
  } catch (e) {
    logger.warn({ err: e.code || e.name }, '[sms] send failed');
    return { ok: false, error: e.code === 'ETIMEDOUT' ? 'timeout' : 'network' };
  }
}
