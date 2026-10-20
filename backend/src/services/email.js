/**
 * services/email.js — transactional email via Resend.
 *
 * Without RESEND_API_KEY (or with LIVE_EMAIL=false) emails are logged, not sent.
 */

import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';
import { escapeHtml as e, safeUrl, headerSafe } from '../utils/html.js';
import { msg } from '../i18n/index.js';

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

export async function sendWelcome(to, displayName) {
  return await send({
    to, subject: 'Welcome to Justice Gavel',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#042C53">Welcome, ${e(displayName || 'there')}.</h2>
        <p>Your account is ready. You now have access to:</p>
        <ul style="line-height:2">
          <li>AI-powered legal rights information</li>
          <li>Bail calculator and bondsman matching</li>
          <li>Attorney directory and consultations</li>
          <li>Case management and motion generation</li>
          <li>ICE detention and immigration resources</li>
        </ul>
        <a href="https://justicegavel.app" style="display:inline-block;background:#042C53;
           color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Open Justice Gavel
        </a>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#888;font-size:12px">Questions? Reply to this email — we read every one.</p>
      </div>`,
  });
}

export async function sendSubscriptionConfirm(to, plan, amount) {
  return await send({
    to, subject: headerSafe(`You're subscribed to Justice Gavel ${plan}`),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#042C53">Subscription confirmed</h2>
        <p>You're now on the <strong>${e(plan)}</strong> plan at <strong>$${e(amount)}/month</strong>.</p>
        <p>All features are unlocked. Your next billing date is 30 days from today.</p>
        <a href="https://justicegavel.app" style="display:inline-block;background:#042C53;
           color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Get started
        </a>
      </div>`,
  });
}

export async function sendPaymentFailed(to, plan, retryDate) {
  return await send({
    to, subject: 'Action required — Justice Gavel payment failed',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#C62828">Payment failed</h2>
        <p>We couldn't charge your card for your <strong>${e(plan)}</strong> subscription.</p>
        <p>We'll retry on <strong>${e(retryDate)}</strong>. Update your payment method to avoid interruption.</p>
        <a href="https://justicegavel.app/billing" style="display:inline-block;background:#C62828;
           color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Update payment method
        </a>
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

export default { sendPasswordReset, sendWelcome, sendSubscriptionConfirm, sendPaymentFailed, sendCriticalAlert, sendEmail };

// ── Booking confirmation — sent to defendant after successful booking ─────────
export async function sendBookingConfirmation({ to, clientName, attorneyName,
  dateSlot, timeSlot, durationMin, feeDollars, meetingLink, cancellationUrl }) {
  const dateLabel = new Date(dateSlot + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return await send({
    to,
    subject: headerSafe(`Consultation confirmed — ${attorneyName} on ${dateLabel}`),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1628">Your consultation is confirmed ✅</h2>
        <p>Hi ${e(clientName)},</p>
        <p>Your <strong>${e(durationMin)}-minute consultation</strong> with
           <strong>${e(attorneyName)}</strong> is booked.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#6B7280;width:120px">Date</td>
              <td style="padding:8px 0;font-weight:600">${e(dateLabel)}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Time</td>
              <td style="padding:8px 0;font-weight:600">${e(timeSlot)}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Duration</td>
              <td style="padding:8px 0;font-weight:600">${e(durationMin)} minutes</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Platform fee</td>
              <td style="padding:8px 0;font-weight:600">$${e(feeDollars)} (charged)</td></tr>
        </table>
        ${meetingLink ? `<a href="${safeUrl(meetingLink)}"
           style="display:inline-block;background:#0A1628;color:#fff;padding:12px 24px;
                  border-radius:8px;text-decoration:none;font-weight:700;margin:8px 0">
          Join Video Call
        </a>` : ''}
        <p style="color:#6B7280;font-size:13px;margin-top:24px">
          ${cancellationUrl ? `Need to cancel? <a href="${safeUrl(cancellationUrl)}">Cancel here</a>` : 'Need to cancel? Open the booking in the Justice Gavel app'}
          (full refund until 2 hours before the appointment).<br>
          <strong>⚖️ Legal Notice:</strong> This is a general consultation.
          It does not create an attorney-client relationship.
        </p>
      </div>`,
    text: `Consultation confirmed with ${attorneyName} on ${dateLabel} at ${timeSlot}.${meetingLink ? ` Meeting link: ${meetingLink}` : ''}`,
  });
}

// ── Attorney booking alert — sent to attorney when a client books ─────────────
export async function sendAttorneyBookingAlert({ to, attorneyName, clientName,
  dateSlot, timeSlot, durationMin, caseTitle, clientEmail, clientPhone, meetingLink }) {
  const dateLabel = new Date(dateSlot + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return await send({
    to,
    subject: headerSafe(`New consultation booked — ${clientName} on ${dateLabel}`),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1628">📋 New consultation booked</h2>
        <p>Hi ${e(attorneyName)},</p>
        <p><strong>${e(clientName)}</strong> has booked a
           <strong>${e(durationMin)}-minute consultation</strong> with you.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#6B7280;width:120px">Date</td>
              <td style="padding:8px 0;font-weight:600">${e(dateLabel)}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Time</td>
              <td style="padding:8px 0;font-weight:600">${e(timeSlot)}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Client email</td>
              <td style="padding:8px 0">${e(clientEmail || 'Not provided')}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Client phone</td>
              <td style="padding:8px 0">${e(clientPhone || 'Not provided')}</td></tr>
          ${caseTitle ? `<tr><td style="padding:8px 0;color:#6B7280">Case</td>
              <td style="padding:8px 0">${e(caseTitle)}</td></tr>` : ''}
        </table>
        ${meetingLink ? `<a href="${safeUrl(meetingLink)}"
           style="display:inline-block;background:#0A1628;color:#fff;padding:12px 24px;
                  border-radius:8px;text-decoration:none;font-weight:700;margin:8px 0">
          Join Video Call
        </a>` : ''}
        <p style="color:#6B7280;font-size:12px;margin-top:16px">
          Manage this consultation in your Justice Gavel Attorney Inbox.
        </p>
      </div>`,
    text: `New consultation: ${clientName} on ${dateLabel} at ${timeSlot}.${meetingLink ? ` Meeting link: ${meetingLink}` : ''}`,
  });
}
