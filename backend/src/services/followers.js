/**
 * services/followers.js — family followers for a case's court dates.
 *
 * Consent model (owner rules):
 *   - The case owner must explicitly consent (consent: true) to share; the
 *     time is stored (owner_consent_at). No consent → nothing is created.
 *   - The follower must accept with the one-time invite code (only its
 *     SHA-256 is stored; codes expire after 14 days).
 *   - Either side can end it at any time (status 'revoked'); the follower's
 *     pending reminders are cancelled and the dispatcher re-checks the follow
 *     before every send.
 *   - A follower sees ONLY: case title, the owner's first name, and the court
 *     dates (day, time, hearing type, courthouse, location, status). Never
 *     notes, charges, bail, messages or documents.
 */
import { createHash, randomInt } from 'node:crypto';
import logger from '../utils/logger.js';
import { sanitizeStr } from '../utils/routeHelpers.js';
import {
  scheduleFollowerReminders, cancelFollowerReminders, resolveReminderTimeZone, dateOnly, timeOnly, formatCourtTime,
} from './courtReminders.js';
import { todayInZone } from '../utils/timezone.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L
const CODE_LEN = 10;
const INVITE_DAYS = 14;
const MAX_FOLLOWERS_PER_CASE = 10;

export class FollowError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
export function normalizeCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}
function newCode() {
  let c = '';
  for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return c;
}
const looksLikeEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const firstName = (u) => {
  const n = String(u?.display_name || u?.name || '').trim();
  return n ? n.split(/\s+/)[0].slice(0, 40) : null;
};

async function ownedCase(db, ownerId, caseId) {
  const c = await db.get('SELECT id, title, state FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [caseId, ownerId]);
  if (!c) throw new FollowError(404, 'not_found', 'Case not found.');
  return c;
}

/** Owner creates an invite. Returns { id, invite_code, expires_at, share_message, emailed }. */
export async function createInvite(db, { ownerId, caseId, email = null, name = null, consent, shareReminders = true }) {
  const c = await ownedCase(db, ownerId, caseId);   // someone else's case → 404 before anything else
  if (consent !== true) {
    throw new FollowError(400, 'consent_required',
      'Please confirm that you want to share your court dates with this person.');
  }
  const cleanEmail = email == null || email === '' ? null : String(email).trim().toLowerCase();
  if (cleanEmail && !looksLikeEmail(cleanEmail)) throw new FollowError(400, 'bad_email', 'Enter a valid e-mail address, or leave it empty.');
  const cleanName = name == null ? null : sanitizeStr(String(name), 80).replace(/[<>]/g, '').trim().slice(0, 80) || null;
  const n = await db.get(`SELECT COUNT(*) AS n FROM case_family_access WHERE case_id = ? AND status IN ('pending', 'active')`, [caseId]);
  if (Number(n?.n || 0) >= MAX_FOLLOWERS_PER_CASE) throw new FollowError(409, 'too_many', `A case can be shared with up to ${MAX_FOLLOWERS_PER_CASE} people.`);
  if (cleanEmail) {
    const self = await db.get('SELECT id FROM users WHERE id = ? AND LOWER(email) = ?', [ownerId, cleanEmail]);
    if (self) throw new FollowError(400, 'self_invite', 'You cannot invite yourself.');
  }
  const code = newCode();
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const row = await db.get(
    `INSERT INTO case_family_access
       (case_id, user_id, invited_by, role, accepted, status, invite_email, invite_name, invite_code_hash,
        owner_consent_at, share_reminders, expires_at)
     VALUES (?, NULL, ?, 'follower', 0, 'pending', ?, ?, ?, NOW(), ?, ?)
     RETURNING id`,
    [caseId, ownerId, cleanEmail, cleanName, sha(code), shareReminders === false ? 0 : 1, expires]);
  const owner = await db.get('SELECT display_name, name FROM users WHERE id = ?', [ownerId]);
  const who = firstName(owner) || 'Someone';
  const share = `${who} wants you to follow their court dates on Justice Gavel. Open the app → My Cases → "Follow a family member" and enter this code: ${code} (valid ${INVITE_DAYS} days).`;
  let emailed = false;
  if (cleanEmail) {
    try {
      const { sendEmail, emailLive } = await import('./email.js');
      const { escapeHtml } = await import('../utils/html.js');
      await sendEmail({
        to: cleanEmail,
        subject: `${who} invited you to follow their court dates`,
        text: share,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <p>${escapeHtml(who)} wants you to get their court-date reminders on Justice Gavel.</p>
          <p>Open the app → My Cases → <strong>Follow a family member</strong> and enter this code:</p>
          <p style="font-size:22px;font-weight:700;letter-spacing:2px">${escapeHtml(code)}</p>
          <p style="font-size:12px;color:#666">The code works for ${INVITE_DAYS} days. You will see their court dates only — never their case notes. Either of you can stop sharing at any time.</p>
        </div>`,
      });
      emailed = emailLive();
    } catch (e) {
      logger.warn({ err: e.message }, '[followers] invite e-mail failed');
    }
  }
  logger.info({ caseId: c.id, inviteId: Number(row.id), emailed }, '[followers] invite created');
  return { id: Number(row.id), invite_code: code, expires_at: expires, share_message: share, emailed, share_reminders: shareReminders !== false };
}

/** Owner's view of who follows (or was invited to follow) a case. */
export async function listFollowers(db, ownerId, caseId) {
  await ownedCase(db, ownerId, caseId);
  const rows = await db.all(
    `SELECT cfa.id, cfa.status, cfa.share_reminders, cfa.invite_email, cfa.invite_name, cfa.invited_at,
            cfa.accepted_at, cfa.revoked_at, cfa.expires_at, cfa.owner_consent_at, u.display_name, u.name
       FROM case_family_access cfa LEFT JOIN users u ON u.id = cfa.user_id
      WHERE cfa.case_id = ? AND cfa.status IN ('pending', 'active')
      ORDER BY cfa.invited_at DESC LIMIT 50`, [caseId]);
  const now = Date.now();
  return rows.map(r => ({
    id: Number(r.id),
    status: r.status === 'pending' && r.expires_at && new Date(r.expires_at).getTime() < now ? 'expired' : r.status,
    name: r.display_name || r.name || r.invite_name || null,
    email: r.invite_email || null,
    share_reminders: Number(r.share_reminders) === 1,
    invited_at: r.invited_at, accepted_at: r.accepted_at, expires_at: r.expires_at,
    consented_at: r.owner_consent_at,
  }));
}

/** Owner stops sharing with one follower (or cancels a pending invite). */
export async function revokeFollower(db, ownerId, caseId, followId) {
  await ownedCase(db, ownerId, caseId);
  const row = await db.get(
    `UPDATE case_family_access SET status = 'revoked', revoked_at = NOW(), invite_code_hash = NULL, updated_at = NOW()
      WHERE id = ? AND case_id = ? AND status IN ('pending', 'active') RETURNING user_id`, [followId, caseId]);
  if (!row) throw new FollowError(404, 'not_found', 'That person is not following this case.');
  if (row.user_id) await cancelFollowerReminders(db, Number(row.user_id), caseId, 'follow_revoked');
  return { ok: true };
}

async function upcomingCourtDates(db, caseId, today) {
  const rows = await db.all(
    `SELECT cd.id, cd.court_date, cd.court_time, cd.hearing_type, cd.location, cd.status,
            ch.id AS ch_id, ch.name AS ch_name, ch.address AS ch_address, ch.phone AS ch_phone, ch.lat AS ch_lat, ch.lng AS ch_lng
       FROM court_dates cd LEFT JOIN courthouses ch ON ch.id = cd.courthouse_id
      WHERE cd.case_id = ? AND cd.deleted_at IS NULL
      ORDER BY cd.court_date ASC LIMIT 100`, [caseId]);
  return rows.map(r => {
    const date = dateOnly(r.court_date);
    return {
      id: Number(r.id), court_date: date, court_time: timeOnly(r.court_time), court_time_label: formatCourtTime(r.court_time),
      hearing_type: r.hearing_type || null, location: r.location || null, status: r.status,
      is_past: !!(today && date < today),
      courthouse: r.ch_id ? { id: Number(r.ch_id), name: r.ch_name, address: r.ch_address || null, phone: r.ch_phone || null, lat: r.ch_lat ?? null, lng: r.ch_lng ?? null } : null,
    };
  });
}

/** Follower accepts an invite code. */
export async function acceptInvite(db, userId, rawCode) {
  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LEN) throw new FollowError(400, 'bad_code', 'That code does not look right. Check it and try again.');
  const inv = await db.get(
    `SELECT cfa.id, cfa.case_id, cfa.invited_by, cfa.share_reminders, cfa.expires_at, cfa.status, c.user_id AS owner_id, c.deleted_at
       FROM case_family_access cfa JOIN cases c ON c.id = cfa.case_id
      WHERE cfa.invite_code_hash = ? LIMIT 1`, [sha(code)]);
  if (!inv || inv.status !== 'pending' || inv.deleted_at) throw new FollowError(404, 'invalid_code', 'This code is not valid any more. Ask for a new one.');
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    await db.run(`UPDATE case_family_access SET status = 'expired', invite_code_hash = NULL WHERE id = ?`, [inv.id]);
    throw new FollowError(410, 'expired', 'This code has expired. Ask for a new one.');
  }
  if (Number(inv.owner_id) === Number(userId)) throw new FollowError(400, 'own_case', 'This is your own case — you already get its reminders.');
  const already = await db.get(
    `SELECT id FROM case_family_access WHERE case_id = ? AND user_id = ? AND status = 'active'`, [inv.case_id, userId]);
  if (already) throw new FollowError(409, 'already_following', 'You already follow this case.');
  await db.run(
    `UPDATE case_family_access SET user_id = ?, status = 'active', accepted = 1, accepted_at = NOW(),
            invite_code_hash = NULL, updated_at = NOW()
      WHERE id = ? AND status = 'pending'`, [userId, inv.id]);
  if (Number(inv.share_reminders) === 1) {
    const c = await db.get('SELECT state FROM cases WHERE id = ?', [inv.case_id]);
    const dates = await db.all(
      `SELECT cd.id, cd.court_date, cd.court_time, cd.location, ch.name AS ch_name, ch.address AS ch_address
         FROM court_dates cd LEFT JOIN courthouses ch ON ch.id = cd.courthouse_id
        WHERE cd.case_id = ? AND cd.deleted_at IS NULL AND cd.status = 'scheduled' AND cd.court_date >= CURRENT_DATE - 1
        LIMIT 50`, [inv.case_id]);
    for (const d of dates) {
      await scheduleFollowerReminders(db, {
        followerId: userId, ownerId: Number(inv.owner_id), caseId: Number(inv.case_id), courtDateId: Number(d.id),
        courtDate: dateOnly(d.court_date), courtTime: timeOnly(d.court_time),
        place: [d.ch_name, d.ch_address].filter(Boolean).join(', ') || d.location || null, state: c?.state,
      });
    }
  }
  logger.info({ caseId: Number(inv.case_id), followId: Number(inv.id) }, '[followers] invite accepted');
  const [following] = (await listFollowing(db, userId)).filter(f => f.follow_id === Number(inv.id));
  return following;
}

/** What a follower sees: the cases they follow and their court dates. Nothing else. */
export async function listFollowing(db, userId) {
  const rows = await db.all(
    `SELECT cfa.id AS follow_id, cfa.share_reminders, cfa.accepted_at, c.id AS case_id, c.title, c.state, u.display_name, u.name
       FROM case_family_access cfa
       JOIN cases c ON c.id = cfa.case_id AND c.deleted_at IS NULL
       LEFT JOIN users u ON u.id = c.user_id
      WHERE cfa.user_id = ? AND cfa.status = 'active'
      ORDER BY cfa.accepted_at DESC LIMIT 50`, [userId]);
  const { tz } = await resolveReminderTimeZone(db, userId, null);
  const today = todayInZone(tz);
  const out = [];
  for (const r of rows) {
    const dates = await upcomingCourtDates(db, Number(r.case_id), today);
    out.push({
      follow_id: Number(r.follow_id), case_id: Number(r.case_id), case_title: r.title, state: r.state || null,
      owner_first_name: firstName(r), share_reminders: Number(r.share_reminders) === 1, accepted_at: r.accepted_at,
      next_court_date: dates.find(d => !d.is_past && d.status === 'scheduled')?.court_date || null,
      court_dates: dates,
    });
  }
  return out;
}

/** Follower stops following. */
export async function leaveFollow(db, userId, followId) {
  const row = await db.get(
    `UPDATE case_family_access SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
      WHERE id = ? AND user_id = ? AND status = 'active' RETURNING case_id`, [followId, userId]);
  if (!row) throw new FollowError(404, 'not_found', 'You are not following that case.');
  await cancelFollowerReminders(db, userId, Number(row.case_id), 'follow_left');
  return { ok: true };
}
