/**
 * services/email.js — transactional email via Resend.
 *
 * Without RESEND_API_KEY (or with LIVE_EMAIL=false) emails are logged, not sent.
 */

import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';
import { escapeHtml as e, safeUrl, headerSafe } from '../utils/html.js';
import { msg } from '../i18n/index.js';
import { REFUND_CUTOFF_HOURS } from './consultationSlots.js';

// Every value interpolated into the HTML templates below goes through e()
// (text / attribute) or safeUrl() (href) — names, case titles, notes and
// anything an IdP or a user supplied are untrusted (M4). Subjects go through
// headerSafe() (no CR/LF).

const FROM      = process.env.EMAIL_FROM || process.env.ALERT_EMAIL_FROM || 'noreply@justicegavel.app';
const FROM_NAME = 'Justice Gavel';

/** Email is sent only when RESEND_API_KEY is set (LIVE_EMAIL=false forces log-only). */
export function emailLive() {
  return !!process.env.RESEND_API_KEY && process.env.LIVE_EMAIL !== 'false';
}

const EMAIL_TIMEOUT_MS = 10_000;
const EMAIL_RETRIES = 2;

let _resend = null;
async function resendClient() {
  if (!_resend) {
    const { Resend } = await import('resend');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

async function send({ to, subject, html, text }) {
  if (!to || !subject) {
    logger.warn('[email] missing to/subject — not sent');
    return { error: 'missing_fields' };
  }
  if (!emailLive()) {
    logger.info(`[email] (not sent — RESEND_API_KEY not set) "${subject}" → ${Array.isArray(to) ? to.join(',') : to}`);
    return { id: 'log-only', to, subject, mock: true };
  }
  const resend = await resendClient();
  const payload = {
    from:    `${FROM_NAME} <${FROM}>`,
    to:      Array.isArray(to) ? to : [to],
    subject: headerSafe(subject),
    html:    html || `<p>${e(String(text || '')).replace(/\n/g, '<br>')}</p>`,
    text:    text || String(html || '').replace(/<[^>]+>/g, ''),
  };
  // Each send is bounded (EMAIL_TIMEOUT_MS) and retried on transient failures
  // (network/timeout/429/5xx). The Resend idempotency key makes a retry of a
  // request that actually got through deliver only one e-mail.
  const idempotencyKey = randomUUID();
  let lastErr = null;
  for (let attempt = 0; attempt <= EMAIL_RETRIES; attempt++) {
    const result = await resend.emails.send(payload, { idempotencyKey, signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS) })
      .catch(err => ({ error: { message: err.message, statusCode: null } }));
    if (!result?.error) {
      logger.info(`[email] sent "${subject}" — id: ${result?.data?.id}`);
      return result?.data;
    }
    lastErr = result.error;
    const sc = result.error.statusCode;
    const transient = sc == null || sc === 429 || sc >= 500;
    if (!transient || attempt === EMAIL_RETRIES) break;
    await new Promise(r => { setTimeout(r, 500 * 2 ** attempt).unref?.(); });
  }
  logger.error('[email] send failed:', lastErr?.message || 'resend error');
  throw new Error(lastErr?.message || 'resend error');
}

// ── Transactional emails ───────────────────────────────────────────────────────

/** Password reset link, written in `lang` (en / es / pt / vi). */
export async function sendPasswordReset(to, resetUrl, lang = 'en') {
  const m = (k) => e(msg(lang, k));
  return await send({
    to, subject: msg(lang, 'email.reset.subject'),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#042C53">${m('email.reset.title')}</h2>
        <p>${m('email.reset.body')}</p>
        <a href="${safeUrl(resetUrl)}" style="display:inline-block;background:#042C53;color:#fff;
           padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          ${m('email.reset.button')}
        </a>
        <p style="color:#888;font-size:13px">${m('email.reset.ignore')}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#888;font-size:12px">${m('email.footer')}</p>
      </div>`,
  });
}

/** Greeting line: "Hi Ana," / "Hola, Ana:" — or the plain form when no name is known. */
const greeting = (lang, name) => (name ? msg(lang, 'email.greeting', { name }) : msg(lang, 'email.greeting_plain'));

/** Welcome e-mail after sign-up, in `lang`. */
export async function sendWelcome(to, displayName, lang = 'en') {
  const m = (k, p) => e(msg(lang, k, p));
  const name = displayName ? String(displayName).trim() : '';
  return await send({
    to, subject: msg(lang, 'email.welcome.subject'),
    html: `
      <div lang="${e(lang)}" style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#042C53">${name ? m('email.welcome.title', { name }) : m('email.welcome.subject')}</h2>
        <p>${m('email.welcome.body')}</p>
        <ul style="line-height:2">
          <li>${m('email.welcome.item1')}</li>
          <li>${m('email.welcome.item2')}</li>
          <li>${m('email.welcome.item3')}</li>
          <li>${m('email.welcome.item4')}</li>
        </ul>
        <a href="${safeUrl(process.env.APP_URL || 'https://justicegavel.app')}" style="display:inline-block;background:#042C53;
           color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          ${m('email.welcome.button')}
        </a>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#888;font-size:12px">${m('email.welcome.questions')}</p>
      </div>`,
  });
}

export async function sendCriticalAlert(subject, body) {
  return await send({
    to:      process.env.ALERT_EMAIL || 'engineering@justicegavel.app',
    subject: headerSafe(`🚨 ${subject}`),
    html:    `<pre style="font-family:monospace;font-size:13px">${e(body)}</pre>`,
  });
}

// Generic send helper

/**
 * sendEmail — generic low-level email dispatcher.
 * Used by outbound_bot, healthScan, retention, etc.
 * Accepts { to, subject, html?, text? }
 */
export async function sendEmail(arg, subjectArg, textArg) {
  // Accepts sendEmail({ to, subject, html?, text? }) or legacy sendEmail(to, subject, text)
  const o = (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : { to: arg, subject: subjectArg, text: textArg };
  return await send({ to: o.to, subject: o.subject, html: o.html, text: o.text });
}

export default { sendPasswordReset, sendWelcome, sendCriticalAlert, sendEmail };

const row = (label, value) => `<tr><td style="padding:8px 0;color:#6B7280;width:140px">${e(label)}</td>
              <td style="padding:8px 0;font-weight:600">${e(value)}</td></tr>`;

// ── Booking confirmation — to the client after the payment is verified ────────
// `when` is the slot as the person reads it ("Monday, May 4 · 9:00 AM CDT"),
// already in `lang` (routes/consultations.js slotLabel).
export async function sendBookingConfirmation({ to, lang = 'en', clientName, attorneyName, when, durationMin, feeDisplay, refundHours = REFUND_CUTOFF_HOURS }) {
  const m = (k, p) => msg(lang, k, p);
  return await send({
    to,
    subject: m('email.booking.subject', { lawyer: attorneyName, when }),
    html: `
      <div lang="${e(lang)}" style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1628">${e(m('email.booking.title'))} ✅</h2>
        <p>${e(greeting(lang, clientName))}</p>
        <p>${e(m('email.booking.body', { minutes: durationMin, lawyer: attorneyName }))}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          ${row(m('email.label.when'), when)}
          ${row(m('email.label.duration'), m('email.duration_value', { minutes: durationMin }))}
          ${feeDisplay ? row(m('email.label.fee'), m('email.fee_value', { amount: feeDisplay })) : ''}
        </table>
        <p style="color:#6B7280;font-size:13px;margin-top:24px">
          ${e(m('email.booking.cancel', { hours: refundHours }))}<br>
          <strong>⚖️</strong> ${e(m('email.booking.notice'))}
        </p>
      </div>`,
    text: `${m('email.booking.title')}\n\n${m('email.booking.body', { minutes: durationMin, lawyer: attorneyName })}\n${m('email.label.when')}: ${when}\n\n${m('email.booking.cancel', { hours: refundHours })}\n${m('email.booking.notice')}`,
  });
}

// ── New booking — to the attorney's account, in the attorney's language ───────
export async function sendAttorneyBookingAlert({ to, lang = 'en', attorneyName, clientName, when, durationMin, clientEmail, clientPhone }) {
  const m = (k, p) => msg(lang, k, p);
  const client = clientName || msg(lang, 'consult.a_client');
  return await send({
    to,
    subject: m('email.atty.subject', { client, when }),
    html: `
      <div lang="${e(lang)}" style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1628">📋 ${e(m('email.atty.title'))}</h2>
        <p>${e(greeting(lang, attorneyName))}</p>
        <p>${e(m('email.atty.body', { client, minutes: durationMin }))}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          ${row(m('email.label.when'), when)}
          ${row(m('email.label.duration'), m('email.duration_value', { minutes: durationMin }))}
          ${row(m('email.label.client_email'), clientEmail || m('email.not_provided'))}
          ${row(m('email.label.client_phone'), clientPhone || m('email.not_provided'))}
        </table>
        <p style="color:#6B7280;font-size:12px;margin-top:16px">${e(m('email.atty.manage'))}</p>
      </div>`,
    text: `${m('email.atty.body', { client, minutes: durationMin })}\n${m('email.label.when')}: ${when}\n${m('email.atty.manage')}`,
  });
}

// ── The day before — to the client (services/scheduler.js) ────────────────────
export async function sendConsultationReminder({ to, lang = 'en', clientName, attorneyName, when, durationMin }) {
  const m = (k, p) => msg(lang, k, p);
  return await send({
    to,
    subject: m('email.reminder.subject', { lawyer: attorneyName, when }),
    html: `
      <div lang="${e(lang)}" style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1628">📅 ${e(m('email.reminder.title'))}</h2>
        <p>${e(greeting(lang, clientName))}</p>
        <p>${e(m('email.reminder.body', { minutes: durationMin, lawyer: attorneyName, when }))}</p>
        <p style="color:#6B7280;font-size:12px">⚖️ ${e(m('email.booking.notice'))}</p>
      </div>`,
    text: `${m('email.reminder.body', { minutes: durationMin, lawyer: attorneyName, when })}\n\n${m('email.booking.notice')}`,
  });
}
