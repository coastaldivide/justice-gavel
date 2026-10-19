
// Short timeout for monitoring calls — can't have notifier hang on slow endpoints
async function fetchNotify(url, opts) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), 5000); // 5s max for notifications
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(id);
    return r;
  } catch { clearTimeout(id); }
}

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
import { APP_VERSION } from '../utils/version.js';
import { Sentry, captureCritical } from './sentry.js';
import { redact, redactString } from '../utils/redact.js';

// ── In-memory dedup: code → last_alerted_ts ──────────────────────────────────
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;  // 5 minutes between same alert
const alertHistory = new Map();

function shouldAlert(code) {
  const last = alertHistory.get(code) || 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  alertHistory.set(code, Date.now());
  return true;
}

/**
 * Alert recipients come ONLY from the environment (no personal addresses in
 * source): ONCALL_EMAIL / ONCALL_EMAIL_2 for SEV-1/SEV-2, falling back to
 * ALERT_EMAIL. With none set, alerts are still logged (and sent to Sentry /
 * ALERT_WEBHOOK_URL when configured) but no email is attempted.
 */
export function alertRecipients() {
  const oncall = [process.env.ONCALL_EMAIL, process.env.ONCALL_EMAIL_2]
    .map(v => String(v || '').trim()).filter(Boolean);
  if (oncall.length) return oncall;
  const fallback = String(process.env.ALERT_EMAIL || '').trim();
  return fallback ? [fallback] : [];
}

let _warnedNoRecipients = false;

// ── Send email via Resend (services/email.js; logs only without RESEND_API_KEY)
async function sendAlertEmail({ subject, body, to }) {
  const recipients = to && to.length ? to : alertRecipients();
  if (!recipients.length) {
    if (!_warnedNoRecipients) {
      _warnedNoRecipients = true;
      logger.warn('[notifier] no alert recipients configured (set ONCALL_EMAIL / ALERT_EMAIL) — alert emails are skipped');
    }
    return;
  }
  try {
    const { sendEmail } = await import('../services/email.js');
    await sendEmail({
      to:      recipients,
      subject,
      text:    body,
      html:    `<pre style="font-family:monospace;font-size:13px">${String(body || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`,
    });
  } catch (e) {
    logger.error('[notifier] email send failed:', e.message);
  }
}

// ── Webhook ping (BetterUptime, PagerDuty, Slack) ────────────────────────────
async function pingWebhook(payload) {
  const url = process.env.ALERT_WEBHOOK_URL || null;
  if (!url) return;  // Slack/Discord/PagerDuty webhook is optional
  try {
    await fetchNotify(url, {
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
export async function notifyCritical(rawMessage, rawExtras = {}) {
  // Alerts leave the process (e-mail, webhook, Sentry): scrub them first.
  const message = redactString(String(rawMessage));
  const extras  = redact(rawExtras) || {};
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
Version: ${APP_VERSION}

RUNBOOK: https://github.com/coastaldivide/justice-gavel/blob/main/RUNBOOK.md
`.trim();

  await Promise.allSettled([
    sendAlertEmail({
      subject: `🚨 SEV-1: ${message}`,
      body,
      to: alertRecipients(),
    }),
    // SMS removed — using Slack webhook instead
    pingWebhook({ text: `🚨 *SEV-1 CRITICAL* — ${message}`, color: '#C62828', fields: extras }),
  ]);
}

/**
 * SEV-2: Significant error affecting some users.
 * Use for: AI down, payment failures, auth errors spiking.
 */
export async function notifyError(rawMessage, rawExtras = {}) {
  const message = redactString(String(rawMessage));
  const extras  = redact(rawExtras) || {};
  const code = extras.code || message.slice(0, 40);
  logger.error(`[SEV-2 ERROR] ${message}`, extras);
  Sentry?.captureMessage?.(message, 'error');

  if (!shouldAlert(`error:${code}`)) return;

  await Promise.allSettled([
    sendAlertEmail({
      to: alertRecipients(),
      subject: `⚠️ SEV-2 Error: ${message}`,
      body: `${message}\n\n${JSON.stringify(extras, null, 2)}\n\nTime: ${new Date().toISOString()}`,
    }),
    pingWebhook({ text: `⚠️ *SEV-2 Error* — ${message}`, color: '#E65100' }),
  ]);
}

/**
 * SEV-3: Warning. Logged for daily digest, no immediate alert.
 */
export function notifyWarn(rawMessage, extras = {}) {
  const message = redactString(String(rawMessage));
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