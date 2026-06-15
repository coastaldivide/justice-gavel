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
export default { sendSMS, sendAlertSMS, sendVerifySMS, checkSMSStatus };
