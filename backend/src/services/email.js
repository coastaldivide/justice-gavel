/**
 * services/email.js — Resend email service
 *
 * Replaces SendGrid. API is cleaner, deliverability is better,
 * and it's not owned by Twilio.
 *
 * All functions are drop-in replacements for the old sendgrid.js exports.
 */

import { Resend } from 'resend';
import logger     from '../utils/logger.js';

const resend    = new Resend(process.env.RESEND_API_KEY);
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
export default { sendPasswordReset, sendWelcome, sendSubscriptionConfirm, sendPaymentFailed, sendCriticalAlert };
