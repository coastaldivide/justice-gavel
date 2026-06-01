/**
 * monitoring/errorNotifier.js — Critical error notifications
 *
 * Three channels, escalating by severity:
 *
 *   SEV-1 (fatal)  → Email + SMS to on-call immediately
 *   SEV-2 (error)  → Email to engineering@justicegavel.app
 *   SEV-3 (warn)   → Logged to audit_log, included in daily digest
 *
 * Call sites:
 *   notifyCritical('DB connection lost', { attempts: 3 })
 *   notifyError('Stripe webhook failed', { event_id: '...' })
 *
 * Throttling: same error code is suppressed for 5 minutes to prevent
 * alert storms. One alert per incident, not one per request.
 */

import logger from '../utils/logger.js';
import { Sentry, captureCritical } from './sentry.js';

// ── In-memory dedup: code → last_alerted_ts ──────────────────────────────────
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;  // 5 minutes between same alert
const alertHistory = new Map();

function shouldAlert(code) {
  const last = alertHistory.get(code) || 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  alertHistory.set(code, Date.now());
  return true;
}

// ── Send email via SendGrid ───────────────────────────────────────────────────
async function sendAlertEmail({ subject, body, to }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return;

  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to || 'engineering@justicegavel.app' }] }],
        from:    { email: 'alerts@justicegavel.app', name: 'Justice Gavel Alerts' },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    });
  } catch (e) {
    logger.error('[notifier] email send failed:', e.message);
  }
}

// ── Send SMS via Twilio ───────────────────────────────────────────────────────
async function sendAlertSMS(message) {
  const sid    = process.env.TWILIO_ACCOUNT_SID;
  const token  = process.env.TWILIO_AUTH_TOKEN;
  const from   = process.env.TWILIO_FROM_NUMBER;
  const to     = process.env.ONCALL_PHONE;  // Set in Railway env vars
  if (!sid || !token || !from || !to) return;

  try {
    const url  = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({ From: from, To: to, Body: message });
    await fetch(url, {
      method:  'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
      body,
    });
  } catch (e) {
    logger.error('[notifier] SMS send failed:', e.message);
  }
}

// ── Webhook ping (BetterUptime, PagerDuty, Slack) ────────────────────────────
async function pingWebhook(payload) {
  const url = process.env.ALERT_WEBHOOK_URL;  // Slack/Discord/PagerDuty webhook
  if (!url) return;
  try {
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch (e) {
    logger.error('[notifier] webhook ping failed:', e.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * SEV-1: System-critical failure. Pages on-call immediately.
 * Use for: DB down, auth broken, payment system offline, mass user lockout.
 */
export async function notifyCritical(message, extras = {}) {
  const code = extras.code || message.slice(0, 40);
  logger.error(`[SEV-1 CRITICAL] ${message}`, extras);
  captureCritical(message, extras);

  if (!shouldAlert(`critical:${code}`)) return;

  const body = `
SEV-1 CRITICAL — Justice Gavel

${message}

Details: ${JSON.stringify(extras, null, 2)}
Time: ${new Date().toISOString()}
Environment: ${process.env.NODE_ENV}
Version: ${process.env.npm_package_version}

RUNBOOK: https://github.com/coastaldivide/justice-gavel/blob/main/RUNBOOK.md
`.trim();

  await Promise.allSettled([
    sendAlertEmail({ subject: `🚨 SEV-1: ${message}`, body }),
    sendAlertSMS(`SEV-1 CRITICAL: ${message.slice(0, 100)} — check email for details`),
    pingWebhook({ text: `🚨 *SEV-1 CRITICAL* — ${message}`, color: '#C62828', fields: extras }),
  ]);
}

/**
 * SEV-2: Significant error affecting some users.
 * Use for: AI down, payment failures, auth errors spiking.
 */
export async function notifyError(message, extras = {}) {
  const code = extras.code || message.slice(0, 40);
  logger.error(`[SEV-2 ERROR] ${message}`, extras);
  Sentry?.captureMessage?.(message, 'error');

  if (!shouldAlert(`error:${code}`)) return;

  await Promise.allSettled([
    sendAlertEmail({
      subject: `⚠️ SEV-2 Error: ${message}`,
      body: `${message}\n\n${JSON.stringify(extras, null, 2)}\n\nTime: ${new Date().toISOString()}`,
    }),
    pingWebhook({ text: `⚠️ *SEV-2 Error* — ${message}`, color: '#E65100' }),
  ]);
}

/**
 * SEV-3: Warning. Logged for daily digest, no immediate alert.
 */
export function notifyWarn(message, extras = {}) {
  logger.warn(`[SEV-3 WARN] ${message}`, extras);
  Sentry?.captureMessage?.(message, 'warning');
}

/**
 * Recovery: call when a previously failing service recovers.
 * Clears the dedup timer so the next failure will alert immediately.
 */
export function notifyRecovery(code, message) {
  alertHistory.delete(`critical:${code}`);
  alertHistory.delete(`error:${code}`);
  logger.info(`[RECOVERY] ${code}: ${message}`);
  pingWebhook({ text: `✅ *RECOVERED* — ${message}`, color: '#1B5E20' }).catch(() => {});
}
