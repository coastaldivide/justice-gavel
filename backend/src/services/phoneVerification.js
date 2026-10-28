/**
 * services/phoneVerification.js — prove a phone number with a texted 6-digit code (security fix,
 * migration 40).
 *
 * Why: bail agents enroll defendants by phone / e-mail, and an account used to be linked to an
 * enrollment (and so to the "Your bail agent" card: agency, court date, bond balance) just because
 * it typed the same phone or e-mail. Anyone could register with someone else's number. The app has
 * no e-mail verification, so links are now made ONLY through a phone number the account verified
 * here (routes/checkins.js claimMatching).
 *
 *   startVerification   texts a code to the number (Telnyx, services/sms.js). The code is never
 *                       stored: only HMAC-SHA256(secret, user:phone:code). Valid 10 minutes, 5
 *                       attempts; a new code replaces the previous one. Limits: 5 codes an hour
 *                       per account, 5 an hour and 10 a day per number, 60 s between codes to one
 *                       number. Never to a number that replied STOP (sms_opt_outs). Without
 *                       Telnyx nothing is sent and the answer says so (503 sms_unavailable).
 *   confirmVerification checks the code; on success the number becomes users.phone with
 *                       phone_verified_at / phone_verified_phone. Any other account that had
 *                       verified the same number loses that verification (numbers are recycled).
 *                       A database trigger clears the verification whenever users.phone changes.
 */
import crypto from 'node:crypto';
import { sendSms, smsLive, toE164 } from './sms.js';
import { msg } from '../i18n/index.js';
import { fitSms } from './smsText.js';
import logger from '../utils/logger.js';

export const CODE_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const LIMITS = Object.freeze({ perUserHour: 5, perPhoneHour: 5, perPhoneDay: 10, phoneGapSeconds: 60 });

export class VerifyError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params; }
}

function secret() {
  const s = process.env.PHONE_CODE_SECRET || process.env.JWT_SECRET;
  if (!s) throw new VerifyError(503, 'server_not_configured');
  return s;
}
export function hashCode(userId, phone, code) {
  return crypto.createHmac('sha256', secret()).update(`${Number(userId)}:${phone}:${String(code)}`).digest('hex');
}
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const maskPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : null;
};
const sameCode = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The account's verified number (E.164), or null when it has none / it changed since. */
export async function verifiedPhone(db, userId) {
  const u = await db.get('SELECT phone, phone_verified_at, phone_verified_phone FROM users WHERE id = ?', [userId]);
  if (!u?.phone_verified_at || !u.phone_verified_phone) return null;
  const now = toE164(u.phone);
  return now && now === u.phone_verified_phone ? now : null;
}

/** What the Settings screen shows. */
export async function phoneStatus(db, userId) {
  const u = await db.get('SELECT phone, phone_verified_at FROM users WHERE id = ?', [userId]);
  const v = await verifiedPhone(db, userId);
  const pending = await db.get(
    `SELECT phone, expires_at FROM phone_verifications WHERE user_id = ? AND status = 'pending' AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`, [userId]);
  return {
    phone: u?.phone || null,
    phone_verified: !!v,
    verified_at: v ? u.phone_verified_at : null,
    sms_available: smsLive(),
    pending: pending ? { phone_masked: maskPhone(pending.phone), expires_at: new Date(pending.expires_at).toISOString() } : null,
  };
}

/** Text a code. → { sent: true, phone_masked, expires_at } */
export async function startVerification(db, userId, rawPhone, { lang = 'en', now = new Date() } = {}) {
  const phone = toE164(rawPhone);
  if (!phone) throw new VerifyError(400, 'bad_phone');
  if (!smsLive()) throw new VerifyError(503, 'sms_unavailable');
  if (await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [phone])) throw new VerifyError(409, 'opted_out');
  const nowIso = now.toISOString();
  const counts = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM phone_verifications WHERE user_id = ? AND created_at > CAST(? AS timestamptz) - INTERVAL '1 hour')::int AS user_hour,
       (SELECT COUNT(*) FROM phone_verifications WHERE phone = ? AND created_at > CAST(? AS timestamptz) - INTERVAL '1 hour')::int AS phone_hour,
       (SELECT COUNT(*) FROM phone_verifications WHERE phone = ? AND created_at > CAST(? AS timestamptz) - INTERVAL '1 day')::int AS phone_day,
       (SELECT MAX(created_at) FROM phone_verifications WHERE phone = ?) AS phone_last`,
    [userId, nowIso, phone, nowIso, phone, nowIso, phone]);
  if (counts.user_hour >= LIMITS.perUserHour || counts.phone_hour >= LIMITS.perPhoneHour || counts.phone_day >= LIMITS.perPhoneDay) {
    throw new VerifyError(429, 'too_many_codes');
  }
  if (counts.phone_last && now.getTime() - new Date(counts.phone_last).getTime() < LIMITS.phoneGapSeconds * 1000) {
    throw new VerifyError(429, 'code_just_sent', { seconds: LIMITS.phoneGapSeconds });
  }
  await db.run(`UPDATE phone_verifications SET status = 'superseded' WHERE user_id = ? AND status = 'pending'`, [userId]);
  const code = newCode();
  const expires = new Date(now.getTime() + CODE_MINUTES * 60_000);
  const row = await db.get(
    `INSERT INTO phone_verifications (user_id, phone, code_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?) RETURNING id`, [userId, phone, hashCode(userId, phone, code), expires.toISOString(), nowIso]);
  const body = fitSms(() => msg(lang, 'phone.verify.sms', { code, minutes: CODE_MINUTES }), {}, [], { lang });
  const r = await sendSms({ to: phone, body });
  if (!r?.ok) {
    await db.run(`UPDATE phone_verifications SET status = 'not_sent' WHERE id = ?`, [row.id]);
    logger.warn({ reason: r?.error || r?.reason }, '[phone-verify] code not sent');
    throw new VerifyError(502, 'send_failed');
  }
  await db.run('UPDATE phone_verifications SET provider_id = ? WHERE id = ?', [r.id ? String(r.id).slice(0, 80) : null, row.id]);
  return { sent: true, phone_masked: maskPhone(phone), expires_at: expires.toISOString() };
}

/**
 * Check a code. → { verified: true, phone, linked: [enrollment ids] }.
 * `claim(db, userId)` links the enrollments that match the newly verified number.
 */
export async function confirmVerification(db, userId, rawCode, { now = new Date(), claim = null } = {}) {
  const code = String(rawCode ?? '').replace(/\D/g, '');
  if (code.length !== 6) throw new VerifyError(400, 'bad_code_format');
  const v = await db.get(
    `SELECT id, phone, code_hash, attempts, expires_at FROM phone_verifications
      WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, [userId]);
  if (!v) throw new VerifyError(400, 'no_code');
  if (new Date(v.expires_at).getTime() <= now.getTime()) {
    await db.run(`UPDATE phone_verifications SET status = 'expired' WHERE id = ?`, [v.id]);
    throw new VerifyError(410, 'code_expired');
  }
  // Count this try FIRST, atomically (review finding 14): every guess takes one of the
  // MAX_ATTEMPTS slots before its code is compared, so parallel guesses can never compare more
  // than MAX_ATTEMPTS codes.
  const slot = await db.get(
    `UPDATE phone_verifications SET attempts = attempts + 1
      WHERE id = ? AND status = 'pending' AND attempts < ? RETURNING attempts`, [v.id, MAX_ATTEMPTS]);
  if (!slot) {
    await db.run(`UPDATE phone_verifications SET status = 'locked' WHERE id = ? AND status = 'pending'`, [v.id]);
    throw new VerifyError(429, 'code_locked');
  }
  if (!sameCode(hashCode(userId, v.phone, code), v.code_hash)) {
    const used = Number(slot.attempts);
    if (used >= MAX_ATTEMPTS) {
      await db.run(`UPDATE phone_verifications SET status = 'locked' WHERE id = ? AND status = 'pending'`, [v.id]);
      throw new VerifyError(429, 'code_locked');
    }
    throw new VerifyError(400, 'wrong_code', { left: MAX_ATTEMPTS - used });
  }
  const won = await db.get(
    `UPDATE phone_verifications SET status = 'verified', verified_at = ? WHERE id = ? AND status = 'pending' RETURNING id`,
    [now.toISOString(), v.id]);
  if (!won) throw new VerifyError(400, 'no_code');
  await db.transaction(async (tx) => {
    // the number now belongs to this account: nobody else keeps it verified
    await tx.run(`UPDATE users SET phone_verified_at = NULL, phone_verified_phone = NULL WHERE phone_verified_phone = ? AND id <> ?`, [v.phone, userId]);
    await tx.run(`UPDATE users SET phone = ?, phone_verified_phone = ?, phone_verified_at = ? WHERE id = ?`, [v.phone, v.phone, now.toISOString(), userId]);
  });
  const linked = claim ? await claim(db, userId) : [];
  return { verified: true, phone: v.phone, linked };
}
