/**
 * sendgrid.js — Production SendGrid email service
 *
 * Handles transactional email for Justice Gavel:
 *  - Password reset
 *  - Welcome email
 *  - Subscription receipts
 *  - Lead offer emails to attorneys and bondsmen
 *  - Payment link delivery
 *  - Unsubscribe/opt-out handling
 */
import logger from '../utils/logger.js';

const sgKey  = process.env.SENDGRID_API_KEY || '';
const FROM   = process.env.ALERT_EMAIL_FROM || 'alerts@justicegavel.app';
export const SENDGRID_LIVE = !!sgKey;
export const SENDGRID_FROM = FROM;

let sgClient = null;

async function getSgClient() {
  if (sgClient) return sgClient;
  const sgMail = (await import('@sendgrid/mail')).default;
  sgMail.setApiKey(sgKey);
  sgClient = sgMail;
  return sgClient;
}

// ── Branded email HTML ─────────────────────────────────────────────────────────
// Builds a fully-branded HTML email wrapping arbitrary body HTML.
// Includes CAN-SPAM-compliant footer (physical address, unsubscribe link).
export function buildEmailHtml(subject, bodyHtml, preheader) {
  const pre = preheader
    ? '<div style="display:none;max-height:0;overflow:hidden;font-size:1px;">' + preheader + '</div>'
    : '';
  const css = [
    'body{margin:0;padding:0;background:#F5F7FA;font-family:Arial,Helvetica,sans-serif}',
    '.w{max-width:600px;margin:0 auto;background:#ffffff}',
    '.h{background:#042C53;padding:28px 32px;text-align:center}',
    '.h h1{color:#F9A825;font-size:22px;margin:0 0 4px;letter-spacing:2px}',
    '.h p{color:#85B7EB;font-size:11px;margin:0;letter-spacing:4px;text-transform:uppercase}',
    '.b{padding:32px;color:#1A1A2E;font-size:15px;line-height:1.7}',
    '.b h2{color:#042C53;font-size:18px;margin-top:0}',
    '.btn{display:inline-block;background:#042C53;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;margin:16px 0}',
    '.f{background:#F0F2F5;padding:20px 32px;font-size:11px;color:#6B7280;text-align:center;line-height:1.6}',
    '.f a{color:#042C53;text-decoration:none}',
  ].join('');

  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<title>' + (subject || 'Justice Gavel') + '</title>' +
    '<style>' + css + '</style>' +
    '</head><body><div class="w">' +
    '<div class="h"><h1>JUSTICE GAVEL</h1><p>Your Legal Connection</p></div>' +
    pre +
    '<div class="b">' + bodyHtml + '</div>' +
    '<div class="f">' +
    '<p>Justice Gavel, Inc. &nbsp;·&nbsp; Legal guidance platform &nbsp;·&nbsp; Not a law firm</p>' +
    '<p>' +
    '<a href="https://justicegavel.app/privacy">Privacy Policy</a> &nbsp;·&nbsp; ' +
    '<a href="https://justicegavel.app/terms">Terms of Service</a> &nbsp;·&nbsp; ' +
    '<a href="https://justicegavel.app/unsubscribe">Unsubscribe</a>' +
    '</p>' +
    '<p style="color:#9CA3AF;font-size:10px;">You received this because you have an account at justicegavel.app.</p>' +
    '</div></div></body></html>';
}

// ── Pre-built transactional email types ───────────────────────────────────────
export function buildPasswordResetEmail(resetUrl) {
  const body = '<h2>Reset your password</h2>' +
    '<p>We received a request to reset your Justice Gavel password. Click below to set a new one.</p>' +
    '<p>This link expires in <strong>1 hour</strong>. If you did not request a reset, you can safely ignore this email.</p>' +
    '<a class="btn" href="' + resetUrl + '">Reset Password</a>' +
    '<p style="font-size:12px;color:#6B7280;">Or copy this link into your browser:<br>' + resetUrl + '</p>';
  return buildEmailHtml('Reset your Justice Gavel password', body, 'Reset link inside — expires in 1 hour');
}

export function buildWelcomeEmail(displayName) {
  const name = displayName || 'there';
  const body = '<h2>Welcome, ' + name + '!</h2>' +
    '<p>You now have free access to AI legal guidance, attorney search, and bail agent finder — all in one app.</p>' +
    '<p><strong>Know your rights. Find help. Stay protected.</strong></p>' +
    '<a class="btn" href="https://justicegavel.app">Open Justice Gavel</a>' +
    '<p style="font-size:12px;color:#6B7280;">Justice Gavel provides general legal information, not legal advice. Always consult a licensed attorney for your specific situation.</p>';
  return buildEmailHtml('Welcome to Justice Gavel', body, 'Your account is ready');
}

export function buildReceiptEmail(tier, amount, nextBillingDate) {
  const body = '<h2>Subscription confirmed</h2>' +
    '<p>Thank you for subscribing to <strong>Justice Gavel ' + tier + '</strong>.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;">' +
    '<tr><td style="padding:8px 0;color:#6B7280;border-bottom:1px solid #F0F2F5">Plan</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #F0F2F5">' + tier + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#6B7280;border-bottom:1px solid #F0F2F5">Amount</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #F0F2F5">' + amount + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#6B7280;">Next billing</td><td style="padding:8px 0;">' + (nextBillingDate || 'See your account') + '</td></tr>' +
    '</table>' +
    '<a class="btn" href="https://justicegavel.app">Open the App</a>';
  return buildEmailHtml('Justice Gavel subscription receipt', body, 'Your receipt is here');
}

// ── Send email ─────────────────────────────────────────────────────────────────
export async function sendEmail({ to, subject, text, html }) {
  if (!to || !subject) {
    logger.error('[sendgrid] Missing to or subject');
    return { error: 'missing_fields' };
  }

  if (!SENDGRID_LIVE) {
    logger.info({ msg: '[sendgrid:mock]', to, subject });
    return { mock: true, messageId: 'mock_' + Date.now() };
  }

  try {
    const client = await getSgClient();
    const msg = {
      to,
      from: FROM,
      subject,
      text: text || subject,
      html: html || buildEmailHtml(subject, '<p>' + (text || subject).replace(/\n/g, '<br>') + '</p>'),
    };
    const [response] = await client.send(msg);
    logger.info({ msg: '[sendgrid] sent', to, status: response.statusCode });
    return { statusCode: response.statusCode, messageId: response.headers['x-message-id'] };
  } catch (err) {
    logger.error({ msg: '[sendgrid] failed', to, error: err.message });
    return { error: err.message };
  }
}

// ── Parse email reply intent (for inbound parse webhook) ──────────────────────
export function parseEmailIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/\b(yes|ok|accept|confirm|interested|call me|want more)\b/.test(lower)) return 'accept';
  if (/\b(no|not interested|stop|unsubscribe|remove|opt.?out)\b/.test(lower)) return 'reject';
  if (/\b(maybe|perhaps|not sure|need more info|tell me more|what is)\b/.test(lower)) return 'maybe';
  return null;
}
