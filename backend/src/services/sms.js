/**
 * services/sms.js — text messages through Telnyx (Messaging API v2).
 *
 * Provider history: Twilio was removed by owner decision on July 10, 2026 (v8.3.2/v8.3.3),
 * re-added by mistake in the Oct 18–19 core-path pass, and removed again on Oct 26, 2026.
 * The owner chose Telnyx on Oct 26, 2026.
 *
 * Optional. Texts go out only when BOTH are set:
 *   TELNYX_API_KEY       Telnyx API v2 key (Mission Control → API Keys)
 *   TELNYX_FROM_NUMBER   the sending number, E.164 (+16155550123), on a messaging profile
 *                        whose 10DLC brand + campaign are registered — US carriers block
 *                        unregistered application-to-person texts.
 * Optional: TELNYX_MESSAGING_PROFILE_ID (sent with each message), TELNYX_API_BASE (tests).
 * Without them smsLive() is false and sendSms() returns
 * { skipped: true, reason: 'sms_not_configured' } — nothing is sent, nothing throws, and
 * the reminder chain (push → browser push → e-mail) is unaffected.
 *
 * Request: POST {base}/messages, Authorization: Bearer <key>,
 *   JSON { from, to, text[, messaging_profile_id] } → 200 { data: { id, ... } }.
 *   Errors come back as { errors: [{ code, title, detail }] }.
 * Consent: users opt in per account (users.sms_reminders); STOP/HELP replies are handled
 * by the Telnyx messaging profile's opt-out settings — keep them on.
 *
 * Numbers are normalised to E.164 (+1 for 10-digit US numbers). Phone numbers and
 * message bodies are never logged.
 */
import { fetchWithTimeout } from '../utils/http.js';
import logger from '../utils/logger.js';

const SMS_TIMEOUT_MS = 10_000;
const MAX_TEXT = 640;   // 4 GSM segments; longer bodies are cut

export function smsLive() {
  return !!(process.env.TELNYX_API_KEY && process.env.TELNYX_FROM_NUMBER);
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
 * Send one text. Resolves to { ok: true, id } | { ok: false, error } |
 * { skipped: true, reason }. Never throws.
 */
export async function sendSms({ to, body } = {}) {
  if (!smsLive()) return { skipped: true, reason: 'sms_not_configured' };
  const dest = toE164(to);
  if (!dest) return { skipped: true, reason: 'no_valid_number' };
  const from = toE164(process.env.TELNYX_FROM_NUMBER) || process.env.TELNYX_FROM_NUMBER;
  const base = String(process.env.TELNYX_API_BASE || 'https://api.telnyx.com/v2').replace(/\/+$/, '');
  const payload = { from, to: dest, text: String(body || '').slice(0, MAX_TEXT) };
  if (process.env.TELNYX_MESSAGING_PROFILE_ID) payload.messaging_profile_id = process.env.TELNYX_MESSAGING_PROFILE_ID;
  try {
    const res = await fetchWithTimeout(`${base}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }, { timeoutMs: SMS_TIMEOUT_MS });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const code = json?.errors?.[0]?.code || null;
      logger.warn({ status: res.status, code }, '[sms] Telnyx refused the message');
      return { ok: false, error: `telnyx_${res.status}${code ? `_${code}` : ''}` };
    }
    return { ok: true, id: json?.data?.id || null };
  } catch (e) {
    logger.warn({ err: e.code || e.name }, '[sms] send failed');
    return { ok: false, error: e.code === 'ETIMEDOUT' || e.name === 'AbortError' ? 'timeout' : 'network' };
  }
}
