import { normalizePhone, sanitizeStr } from '../utils/sanitize.js';
/**
 * services/twilio.js — REMOVED
 * Twilio is no longer used. SMS alerts replaced by:
 *   - Slack webhook (ALERT_WEBHOOK_URL) for all alerts
 *   - Expo push notifications for mobile
 *   - Resend email for critical notifications
 */

export const sendSMS        = async () => null;
export const sendAlertSMS   = async () => null;
export const sendVerifySMS  = async () => null;
export const checkSMSStatus = async () => ({ status: 'disabled' });
export { normalizePhone };

/** Basic intent parser — stub for future NLP integration */
export function parseIntent(text) {
  if (!text || typeof text !== 'string') return { intent: null, keywords: [] };
  const lower = text.toLowerCase();
  const intent = lower.includes('bail') ? 'bail'
    : lower.includes('arrest') ? 'criminal'
    : lower.includes('immigration') ? 'immigration'
    : lower.includes('attorney') ? 'attorney'
    : null;
  return { intent, keywords: lower.split(/\s+/).filter(k => k.length > 2) };
}

export default { sendSMS, sendAlertSMS, sendVerifySMS, checkSMSStatus, normalizePhone, parseIntent };
