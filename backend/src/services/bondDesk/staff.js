/**
 * services/bondDesk/staff.js — people who work in an agency's Bond Desk (B8, seats per plan).
 * docs/BOND_DESK.md "Staff and seats".
 *
 * Roles: the owner (the bail agent whose plan it is) and staff. Staff do everything in Bond Desk
 * except billing / the plan, card payments (Stripe), staff and the export (routes: ownerOnly).
 * Seats include the owner: Starter 3, Pro 10, Market 20 (plans.js BONDSMAN_TIERS[].seats).
 * Used seats = owner + staff + invitations not yet accepted or withdrawn. Over the limit an
 * invitation is refused (409 seats_full) — there are no paid extra seats; the agency moves up a
 * plan. A plan moved down keeps the people already in; new invitations wait for a free seat.
 *
 * An invitation is e-mailed with a link (32 random bytes, stored as SHA-256, 14 days). The person
 * signs in (or creates an account) with that e-mail address and accepts; one agency per person.
 */
import { BONDSMAN_TIERS } from '../../routes/billing/plans.js';
import { msg, normalizeLang } from '../../i18n/index.js';
import { agencyFor, hashToken, newToken, sendAgentEmail } from './core.js';
import { LedgerError } from './payments.js';
import { appUrl } from './connect.js';
import { PAID_STATUSES } from '../entitlements.js';

export const INVITE_DAYS = 14;
const PAID_SQL = PAID_STATUSES.map((s) => `'${s}'`).join(',');
export const seatsFor = (tier) => Number(BONDSMAN_TIERS[tier]?.seats || 0);
export const inviteLink = (token) => `${appUrl()}/bond-desk/join/${token}`;
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

/** { included, used, staff, pending } for an agency. */
export async function seatUsage(db, ownerId, tier) {
  const s = await db.get('SELECT COUNT(*)::int AS n FROM bd_staff WHERE owner_id = ?', [ownerId]);
  const p = await db.get(`SELECT COUNT(*)::int AS n FROM bd_staff_invites WHERE owner_id = ? AND status = 'pending' AND expires_at > NOW()`, [ownerId]);
  return { included: seatsFor(tier), used: 1 + s.n + p.n, staff: s.n, pending: p.n };
}

/** GET /bond-desk/staff → { seats, staff: [...], invites: [...] } */
export async function listStaff(db, ownerId, tier) {
  const staff = await db.all(
    `SELECT s.user_id, s.added_at, u.email, COALESCE(u.display_name, u.name) AS name FROM bd_staff s JOIN users u ON u.id = s.user_id
      WHERE s.owner_id = ? ORDER BY s.added_at LIMIT 100`, [ownerId]);
  const invites = await db.all(
    `SELECT id, email, created_at, expires_at FROM bd_staff_invites WHERE owner_id = ? AND status = 'pending' AND expires_at > NOW() ORDER BY id LIMIT 100`, [ownerId]);
  const owner = await db.get('SELECT email, COALESCE(display_name, name) AS name FROM users WHERE id = ?', [ownerId]);
  return {
    seats: await seatUsage(db, ownerId, tier),
    owner: { user_id: Number(ownerId), email: owner?.email || null, name: owner?.name || null, role: 'owner' },
    staff: staff.map((r) => ({ user_id: Number(r.user_id), email: r.email, name: r.name, role: 'staff', added_at: r.added_at })),
    invites: invites.map((r) => ({ id: Number(r.id), email: r.email, created_at: r.created_at, expires_at: r.expires_at })),
  };
}

/** Invite someone by e-mail. → { invite, link, email_status } (409 seats_full / already_staff / already_invited) */
export async function inviteStaff(db, { ownerId, tier, email, lang }) {
  const addr = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 254) throw new LedgerError(400, 'bad_email', { field: 'email' });
  const owner = await db.get('SELECT email FROM users WHERE id = ?', [ownerId]);
  if (owner?.email && owner.email.toLowerCase() === addr) throw new LedgerError(409, 'already_staff');
  const token = newToken();
  const row = await db.transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [ownerId]);   // one invitation at a time per agency (seat count)
    await tx.run(`UPDATE bd_staff_invites SET status = 'revoked' WHERE owner_id = ? AND status = 'pending' AND expires_at <= NOW()`, [ownerId]);
    const member = await tx.get('SELECT 1 FROM bd_staff s JOIN users u ON u.id = s.user_id WHERE s.owner_id = ? AND lower(u.email) = ?', [ownerId, addr]);
    if (member) throw new LedgerError(409, 'already_staff');
    const pending = await tx.get(`SELECT 1 FROM bd_staff_invites WHERE owner_id = ? AND lower(email) = ? AND status = 'pending'`, [ownerId, addr]);
    if (pending) throw new LedgerError(409, 'already_invited');
    const seats = await seatUsage(tx, ownerId, tier);
    if (seats.used >= seats.included) throw new LedgerError(409, 'seats_full', { included: seats.included });
    return await tx.get(
      `INSERT INTO bd_staff_invites (owner_id, email, token_hash, expires_at) VALUES (?, ?, ?, NOW() + (? || ' days')::interval)
       RETURNING id, email, created_at, expires_at`, [ownerId, addr, hashToken(token), String(INVITE_DAYS)]);
  });
  const a = await agencyFor(db, ownerId);
  const l = normalizeLang(lang) || 'en';
  const link = inviteLink(token);
  const p = { agency: a.agency || a.agent_name, link, days: INVITE_DAYS };
  const emailStatus = await sendAgentEmail({ to: addr, subject: msg(l, 'bd.email.staff_invite_subject', p), text: msg(l, 'bd.email.staff_invite_body', p) });
  return { invite: { id: Number(row.id), email: row.email, created_at: row.created_at, expires_at: row.expires_at }, link, email_status: emailStatus };
}

export async function revokeInvite(db, { ownerId, inviteId }) {
  const r = await db.run(`UPDATE bd_staff_invites SET status = 'revoked' WHERE id = ? AND owner_id = ? AND status = 'pending'`, [inviteId, ownerId]);
  if (!r.changes) throw new LedgerError(404, 'not_found');
}

export async function removeStaff(db, { ownerId, userId }) {
  const r = await db.run('DELETE FROM bd_staff WHERE user_id = ? AND owner_id = ?', [userId, ownerId]);
  if (!r.changes) throw new LedgerError(404, 'not_found');
}

/** A staff member leaves the agency themself. */
export async function leaveAgency(db, userId) {
  const r = await db.run('DELETE FROM bd_staff WHERE user_id = ?', [userId]);
  if (!r.changes) throw new LedgerError(404, 'not_found');
}

async function inviteByToken(db, token) {
  if (!INVITE_TOKEN_RE.test(String(token || ''))) throw new LedgerError(404, 'invite_invalid');
  const inv = await db.get('SELECT * FROM bd_staff_invites WHERE token_hash = ?', [hashToken(token)]);
  if (!inv || inv.status === 'revoked') throw new LedgerError(404, 'invite_invalid');
  if (inv.status === 'accepted') throw new LedgerError(409, 'invite_used');
  if (new Date(inv.expires_at) <= new Date()) throw new LedgerError(410, 'invite_expired');
  return inv;
}

/** GET /bond-desk/staff/invite/:token (signed in) → { agency, email, email_matches } */
export async function invitePreview(db, { token, user }) {
  const inv = await inviteByToken(db, token);
  const a = await agencyFor(db, inv.owner_id);
  return { agency: a.agency || a.agent_name, email: inv.email, email_matches: String(user.email || '').toLowerCase() === inv.email.toLowerCase(), expires_at: inv.expires_at };
}

/** POST /bond-desk/staff/accept { token } (signed in with the invited e-mail) */
export async function acceptInvite(db, { token, user }) {
  const inv = await inviteByToken(db, token);
  if (String(user.email || '').toLowerCase() !== inv.email.toLowerCase()) throw new LedgerError(403, 'invite_other_email', { email: inv.email });
  if (Number(user.id) === Number(inv.owner_id)) throw new LedgerError(409, 'already_staff');
  const ownPlan = await db.get(`SELECT 1 FROM bondsman_subscriptions WHERE user_id = ? AND status IN (${PAID_SQL}) LIMIT 1`, [user.id]);
  if (ownPlan) throw new LedgerError(409, 'has_own_plan');
  await db.transaction(async (tx) => {
    const cur = await tx.get('SELECT status FROM bd_staff_invites WHERE id = ? FOR UPDATE', [inv.id]);
    if (cur.status !== 'pending') throw new LedgerError(409, 'invite_used');
    const other = await tx.get('SELECT owner_id FROM bd_staff WHERE user_id = ?', [user.id]);
    if (other && Number(other.owner_id) !== Number(inv.owner_id)) throw new LedgerError(409, 'other_agency');
    if (!other) await tx.run('INSERT INTO bd_staff (user_id, owner_id) VALUES (?, ?)', [user.id, inv.owner_id]);
    await tx.run(`UPDATE bd_staff_invites SET status = 'accepted', accepted_user_id = ?, accepted_at = NOW() WHERE id = ?`, [user.id, inv.id]);
  });
  const a = await agencyFor(db, inv.owner_id);
  return { agency: a.agency || a.agent_name };
}

/** The owner's current plan tier (for seat counts of staff screens). */
export async function ownerTier(db, ownerId) {
  const r = await db.get(`SELECT tier FROM bondsman_subscriptions WHERE user_id = ? AND status IN (${PAID_SQL}) ORDER BY id DESC LIMIT 1`, [ownerId]);
  return r?.tier || null;
}
