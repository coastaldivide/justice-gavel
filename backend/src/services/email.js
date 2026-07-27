/**
 * services/email.js — Resend email service
 *
 * Replaces SendGrid. API is cleaner, deliverability is better,
 * Superior deliverability, cleaner API.
 *
 * All functions are drop-in replacements for the old sendgrid.js exports.
 */

import { Resend } from 'resend';
import logger     from '../utils/logger.js';

// Resend constructor throws if key is undefined/empty — use placeholder in non-live mode
if (!process.env.RESEND_API_KEY) {
  console.warn('[email] RESEND_API_KEY missing — email disabled (demo mode)');
}
const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_not_live');
const FROM      = process.env.SENDGRID_FROM_EMAIL || 'noreply@justicegavel.app';
const FROM_NAME = 'Justice Gavel';
const LIVE      = process.env.LIVE_EMAIL === 'true';

async function send({ to, subject, html, text }) {
  if (!LIVE) {
    logger.info(`[email] DEMO — would send "${subject}" to ${to}`);
    return { id: 'demo-mode', to, subject };
  }
  try {
    const result = await resend.emails.send({
      from:    `${FROM_NAME} <${FROM}>`,
      to:      Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    logger.info(`[email] sent "${subject}" to ${to} — id: ${result.data?.id}`);
    return result.data;
  } catch (err) {
    logger.error('[email] send failed:', err.message);
    throw err;
  }
}

// ── Transactional emails ───────────────────────────────────────────────────────

export async function sendPasswordReset(to, resetUrl) {
  return send({
    to, subject: 'Reset your Justice Gavel password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#042C53">Reset your password</h2>
        <p>Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#042C53;color:#fff;
           padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          Reset password
        </a>
        <p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#888;font-size:12px">Justice Gavel — Legal rights, attorneys, and resources.</p>
      </div>`,
  });
}

export async function sendWelcome(to, displayName) {
  return send({
    to, subject: 'Welcome to Justice Gavel',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#042C53">Welcome, ${displayName || 'there'}.</h2>
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
  return send({
    to, subject: `You're subscribed to Justice Gavel ${plan}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#042C53">Subscription confirmed</h2>
        <p>You're now on the <strong>${plan}</strong> plan at <strong>$${amount}/month</strong>.</p>
        <p>All features are unlocked. Your next billing date is 30 days from today.</p>
        <a href="https://justicegavel.app" style="display:inline-block;background:#042C53;
           color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Get started
        </a>
      </div>`,
  });
}

export async function sendPaymentFailed(to, plan, retryDate) {
  return send({
    to, subject: 'Action required — Justice Gavel payment failed',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#C62828">Payment failed</h2>
        <p>We couldn't charge your card for your <strong>${plan}</strong> subscription.</p>
        <p>We'll retry on <strong>${retryDate}</strong>. Update your payment method to avoid interruption.</p>
        <a href="https://justicegavel.app/billing" style="display:inline-block;background:#C62828;
           color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Update payment method
        </a>
      </div>`,
  });
}

export async function sendCriticalAlert(subject, body) {
  return send({
    to:      process.env.ALERT_EMAIL || 'engineering@justicegavel.app',
    subject: `🚨 ${subject}`,
    html:    `<pre style="font-family:monospace;font-size:13px">${body}</pre>`,
  });
}

// Backward-compat alias (old code imported from sendgrid.js)

/**
 * sendEmail — generic low-level email dispatcher.
 * Used by outbound_bot, healthScan, retention, dunning, etc.
 * Accepts { to, subject, html?, text? }
 */
export async function sendEmail({ to, subject, html, text }) {
  return send({ to, subject, html: html || text || '', text });
}

export default { sendPasswordReset, sendWelcome, sendSubscriptionConfirm, sendPaymentFailed, sendCriticalAlert, sendEmail };

// ── Booking confirmation — sent to defendant after successful booking ─────────
export async function sendBookingConfirmation({ to, clientName, attorneyName,
  dateSlot, timeSlot, durationMin, feeDollars, meetingLink, cancellationUrl }) {
  const dateLabel = new Date(dateSlot + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return send({
    to,
    subject: `Consultation confirmed — ${attorneyName} on ${dateLabel}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1628">Your consultation is confirmed ✅</h2>
        <p>Hi ${clientName},</p>
        <p>Your <strong>${durationMin}-minute consultation</strong> with
           <strong>${attorneyName}</strong> is booked.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#6B7280;width:120px">Date</td>
              <td style="padding:8px 0;font-weight:600">${dateLabel}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Time</td>
              <td style="padding:8px 0;font-weight:600">${timeSlot}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Duration</td>
              <td style="padding:8px 0;font-weight:600">${durationMin} minutes</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Platform fee</td>
              <td style="padding:8px 0;font-weight:600">$${feeDollars} (charged)</td></tr>
        </table>
        <a href="${meetingLink}"
           style="display:inline-block;background:#0A1628;color:#fff;padding:12px 24px;
                  border-radius:8px;text-decoration:none;font-weight:700;margin:8px 0">
          Join Video Call
        </a>
        <p style="color:#6B7280;font-size:13px;margin-top:24px">
          Need to cancel? <a href="${cancellationUrl || 'https://justicegavel.app'}">Cancel here</a>
          (free cancellation until 2 hours before the appointment).<br>
          <strong>⚖️ Legal Notice:</strong> This is a general consultation.
          It does not create an attorney-client relationship.
        </p>
      </div>`,
    text: `Consultation confirmed with ${attorneyName} on ${dateLabel} at ${timeSlot}. Meeting link: ${meetingLink}`,
  });
}

// ── Attorney booking alert — sent to attorney when a client books ─────────────
export async function sendAttorneyBookingAlert({ to, attorneyName, clientName,
  dateSlot, timeSlot, durationMin, caseTitle, clientEmail, clientPhone, meetingLink }) {
  const dateLabel = new Date(dateSlot + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return send({
    to,
    subject: `New consultation booked — ${clientName} on ${dateLabel}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1628">📋 New consultation booked</h2>
        <p>Hi ${attorneyName},</p>
        <p><strong>${clientName}</strong> has booked a
           <strong>${durationMin}-minute consultation</strong> with you.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 0;color:#6B7280;width:120px">Date</td>
              <td style="padding:8px 0;font-weight:600">${dateLabel}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Time</td>
              <td style="padding:8px 0;font-weight:600">${timeSlot}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Client email</td>
              <td style="padding:8px 0">${clientEmail || 'Not provided'}</td></tr>
          <tr><td style="padding:8px 0;color:#6B7280">Client phone</td>
              <td style="padding:8px 0">${clientPhone || 'Not provided'}</td></tr>
          ${caseTitle ? `<tr><td style="padding:8px 0;color:#6B7280">Case</td>
              <td style="padding:8px 0">${caseTitle}</td></tr>` : ''}
        </table>
        <a href="${meetingLink}"
           style="display:inline-block;background:#0A1628;color:#fff;padding:12px 24px;
                  border-radius:8px;text-decoration:none;font-weight:700;margin:8px 0">
          Join Video Call
        </a>
        <p style="color:#6B7280;font-size:12px;margin-top:16px">
          Manage this consultation in your Justice Gavel Attorney Inbox.
        </p>
      </div>`,
    text: `New consultation: ${clientName} on ${dateLabel} at ${timeSlot}. Meeting link: ${meetingLink}`,
  });
}
