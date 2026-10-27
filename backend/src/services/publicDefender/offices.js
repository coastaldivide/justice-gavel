/**
 * services/publicDefender/offices.js — public defender office accounts, staff seats and invitations
 * (A11 step 1; docs/PUBLIC_DEFENDER.md "Office accounts").
 *
 * A Justice Gavel admin (users.role admin / super_admin) creates an office — name, county, state,
 * office phone, seat count, billing e-mail — and invites its first office admin by e-mail. Office
 * admins invite and remove staff (role admin or staff). Seats = members + pending invitations;
 * an invitation over the office's seat count is refused (409 seats_full). One office per person.
 * An invitation link (32 random bytes, stored as SHA-256) works 14 days, once, for the invited
 * e-mail address only.
 *
 * The consent basis: before any client is texted, an office admin ticks CONSENT_BASIS_TEXT; the
 * text, who ticked it and when are stored on the office (pd_offices.consent_basis_*).
 * The baseline: the office's own numbers for the 90 days before the pilot, as the office supplies
 * them (hearings, appeared, missed, where the numbers come from), shown next to what we measure.
 */
import { msg, normalizeLang } from '../../i18n/index.js';
import { sendAgentEmail } from '../bondDesk/core.js';
import { toE164 } from '../sms.js';
import {
  PdError, ROLES, INVITE_DAYS, INVITE_TOKEN_RE, CONSENT_BASIS_TEXT, hashToken, newToken, inviteLink, isEmail,
} from './common.js';

const OFFICE_COLS = `o.id, o.name, o.county, o.state, o.phone, o.seat_limit, o.billing_email, o.status, o.created_at,
  o.consent_basis_at, o.consent_basis_by, o.consent_basis_text, o.pilot_start, o.baseline_from, o.baseline_to,
  o.baseline_hearings, o.baseline_appeared, o.baseline_missed, o.baseline_source, o.baseline_set_at`;

const isoDay = (v) => (v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)));

export function shapeOffice(o) {
  if (!o) return null;
  return {
    id: Number(o.id), name: o.name, county: o.county, state: o.state, phone: o.phone, seat_limit: Number(o.seat_limit),
    billing_email: o.billing_email, status: o.status, created_at: o.created_at,
    consent: o.consent_basis_at ? { at: o.consent_basis_at, by_user_id: o.consent_basis_by == null ? null : Number(o.consent_basis_by), by_name: o.consent_by_name || null, text: o.consent_basis_text } : null,
    pilot_start: isoDay(o.pilot_start),
    baseline: o.baseline_set_at ? {
      from: isoDay(o.baseline_from), to: isoDay(o.baseline_to), hearings: o.baseline_hearings, appeared: o.baseline_appeared,
      missed: o.baseline_missed, source: o.baseline_source, set_at: o.baseline_set_at,
    } : null,
  };
}

export async function getOffice(db, officeId) {
  const o = await db.get(
    `SELECT ${OFFICE_COLS}, COALESCE(u.display_name, u.name, u.email) AS consent_by_name
       FROM pd_offices o LEFT JOIN users u ON u.id = o.consent_basis_by WHERE o.id = ?`, [officeId]);
  if (!o) throw new PdError(404, 'not_found');
  return o;
}

/** The caller's office: → { office_id, role } | null */
export async function membership(db, userId) {
  const m = await db.get(
    `SELECT s.office_id, s.role FROM pd_staff s JOIN pd_offices o ON o.id = s.office_id WHERE s.user_id = ? AND o.status = 'active'`, [userId]);
  return m ? { office_id: Number(m.office_id), role: m.role } : null;
}

// ── Input ─────────────────────────────────────────────────────────────────────

export function cleanText(v, max, field, { required = false } = {}) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw new PdError(400, 'required', { field });
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new PdError(400, 'invalid', { field });
  const s = String(v).normalize('NFC').replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : '')).trim();
  if (s.length > max) throw new PdError(400, 'too_long', { field, max });
  if (required && !s) throw new PdError(400, 'required', { field });
  return s || null;
}
const state2 = (v, { required = true } = {}) => {
  const s = cleanText(v, 40, 'state', { required });
  if (s == null) return null;
  if (!/^[A-Za-z]{2}$/.test(s)) throw new PdError(400, 'bad_state', { field: 'state' });
  return s.toUpperCase();
};
const phoneOpt = (v) => {
  const s = cleanText(v, 40, 'phone');
  if (!s) return null;
  const e = toE164(s);
  if (!e) throw new PdError(400, 'bad_phone', { field: 'phone' });
  return e;
};
const emailOpt = (v, field) => {
  const s = cleanText(v, 254, field);
  if (!s) return null;
  if (!isEmail(s)) throw new PdError(400, 'bad_email', { field });
  return s.toLowerCase();
};
const seats = (v) => {
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw new PdError(400, 'bad_seats', { field: 'seat_limit', max: 500 });
  return n;
};

// ── Justice Gavel admin ───────────────────────────────────────────────────────

/** GET /api/admin/pd-offices → offices with member / client counts (newest first, at most 200). */
export async function listOffices(db) {
  const rows = await db.all(
    `SELECT ${OFFICE_COLS},
            (SELECT COUNT(*)::int FROM pd_staff s WHERE s.office_id = o.id) AS members,
            (SELECT COUNT(*)::int FROM pd_invites i WHERE i.office_id = o.id AND i.status = 'pending' AND i.expires_at > NOW()) AS pending,
            (SELECT COUNT(*)::int FROM pd_clients c WHERE c.office_id = o.id) AS clients
       FROM pd_offices o ORDER BY o.id DESC LIMIT 200`);
  return rows.map((r) => ({ ...shapeOffice(r), members: r.members, pending_invites: r.pending, clients: r.clients }));
}

/** POST /api/admin/pd-offices → { office, invite } (the first office admin is invited by e-mail). */
export async function createOffice(db, { adminId, body, lang }) {
  const name = cleanText(body.name, 160, 'name', { required: true });
  const county = cleanText(body.county, 80, 'county');
  const state = state2(body.state);
  const phone = phoneOpt(body.phone);
  const seatLimit = body.seat_limit == null || body.seat_limit === '' ? 5 : seats(body.seat_limit);
  const billing = emailOpt(body.billing_email, 'billing_email');
  const adminEmail = emailOpt(body.admin_email, 'admin_email');
  if (!adminEmail) throw new PdError(400, 'required', { field: 'admin_email' });
  const row = await db.get(
    `INSERT INTO pd_offices (name, county, state, phone, seat_limit, billing_email, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [name, county, state, phone, seatLimit, billing || adminEmail, adminId]);
  const officeId = Number(row.id);
  const invite = await inviteMember(db, { officeId, email: adminEmail, role: 'admin', invitedBy: adminId, lang });
  return { office: shapeOffice(await getOffice(db, officeId)), invite };
}

/** PATCH /api/admin/pd-offices/:id { name?, county?, state?, phone?, seat_limit?, billing_email?, status? } */
export async function updateOfficeAdmin(db, officeId, body) {
  const o = await getOffice(db, officeId);
  const set = {};
  if ('name' in body) set.name = cleanText(body.name, 160, 'name', { required: true });
  if ('county' in body) set.county = cleanText(body.county, 80, 'county');
  if ('state' in body) set.state = state2(body.state);
  if ('phone' in body) set.phone = phoneOpt(body.phone);
  if ('seat_limit' in body) set.seat_limit = seats(body.seat_limit);
  if ('billing_email' in body) set.billing_email = emailOpt(body.billing_email, 'billing_email');
  if ('status' in body) {
    if (!['active', 'closed'].includes(body.status)) throw new PdError(400, 'invalid', { field: 'status' });
    set.status = body.status;
  }
  const keys = Object.keys(set);
  if (keys.length) {
    await db.run(`UPDATE pd_offices SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = NOW() WHERE id = ?`, [...keys.map((k) => set[k]), o.id]);
    // where or whether the office texts changed: re-plan every hearing
    if ('state' in set || 'county' in set || 'status' in set) await db.run('UPDATE pd_court_dates SET plan_needed = TRUE WHERE office_id = ? AND deleted_at IS NULL', [o.id]);
  }
  return shapeOffice(await getOffice(db, o.id));
}

// ── Seats, staff and invitations ──────────────────────────────────────────────

export async function seatUsage(db, officeId) {
  const o = await db.get('SELECT seat_limit FROM pd_offices WHERE id = ?', [officeId]);
  const s = await db.get('SELECT COUNT(*)::int AS n FROM pd_staff WHERE office_id = ?', [officeId]);
  const p = await db.get(`SELECT COUNT(*)::int AS n FROM pd_invites WHERE office_id = ? AND status = 'pending' AND expires_at > NOW()`, [officeId]);
  return { limit: Number(o?.seat_limit || 0), used: s.n + p.n, members: s.n, pending: p.n };
}

export async function listMembers(db, officeId) {
  const members = await db.all(
    `SELECT s.user_id, s.role, s.added_at, u.email, COALESCE(u.display_name, u.name) AS name
       FROM pd_staff s JOIN users u ON u.id = s.user_id WHERE s.office_id = ? ORDER BY s.added_at LIMIT 500`, [officeId]);
  const invites = await db.all(
    `SELECT id, email, role, created_at, expires_at FROM pd_invites
      WHERE office_id = ? AND status = 'pending' AND expires_at > NOW() ORDER BY id LIMIT 500`, [officeId]);
  return {
    seats: await seatUsage(db, officeId),
    members: members.map((m) => ({ user_id: Number(m.user_id), role: m.role, email: m.email, name: m.name, added_at: m.added_at })),
    invites: invites.map((i) => ({ id: Number(i.id), email: i.email, role: i.role, created_at: i.created_at, expires_at: i.expires_at })),
  };
}

/** Invite someone into an office. → { invite, link, email_status } */
export async function inviteMember(db, { officeId, email, role, invitedBy, lang }) {
  const addr = String(email || '').trim().toLowerCase();
  if (!isEmail(addr)) throw new PdError(400, 'bad_email', { field: 'email' });
  if (!ROLES.includes(role)) throw new PdError(400, 'invalid', { field: 'role' });
  const token = newToken();
  const row = await db.transaction(async (tx) => {
    const o = await tx.get('SELECT id, name, status FROM pd_offices WHERE id = ? FOR UPDATE', [officeId]);   // one invitation at a time (seat count)
    if (!o) throw new PdError(404, 'not_found');
    if (o.status !== 'active') throw new PdError(409, 'office_closed');
    await tx.run(`UPDATE pd_invites SET status = 'revoked' WHERE office_id = ? AND status = 'pending' AND expires_at <= NOW()`, [officeId]);
    const member = await tx.get('SELECT 1 AS x FROM pd_staff s JOIN users u ON u.id = s.user_id WHERE s.office_id = ? AND lower(u.email) = ?', [officeId, addr]);
    if (member) throw new PdError(409, 'already_member');
    const pending = await tx.get(`SELECT 1 AS x FROM pd_invites WHERE office_id = ? AND lower(email) = ? AND status = 'pending'`, [officeId, addr]);
    if (pending) throw new PdError(409, 'already_invited');
    const s = await seatUsage(tx, officeId);
    if (s.used >= s.limit) throw new PdError(409, 'seats_full', { limit: s.limit });
    const inv = await tx.get(
      `INSERT INTO pd_invites (office_id, email, role, token_hash, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, NOW() + (? || ' days')::interval) RETURNING id, email, role, created_at, expires_at`,
      [officeId, addr, role, hashToken(token), invitedBy || null, String(INVITE_DAYS)]);
    return { ...inv, office: o.name };
  });
  const l = normalizeLang(lang) || 'en';
  const link = inviteLink(token);
  const p = { office: row.office, link, days: INVITE_DAYS };
  const emailStatus = await sendAgentEmail({ to: addr, subject: msg(l, 'pd.email.invite_subject', p), text: msg(l, 'pd.email.invite_body', p) });
  return { invite: { id: Number(row.id), email: row.email, role: row.role, created_at: row.created_at, expires_at: row.expires_at }, link, email_status: emailStatus };
}

export async function revokeInvite(db, { officeId, inviteId }) {
  const r = await db.run(`UPDATE pd_invites SET status = 'revoked' WHERE id = ? AND office_id = ? AND status = 'pending'`, [inviteId, officeId]);
  if (!r.changes) throw new PdError(404, 'not_found');
}

async function adminsLeft(tx, officeId, exceptUserId) {
  const r = await tx.get(`SELECT COUNT(*)::int AS n FROM pd_staff WHERE office_id = ? AND role = 'admin' AND user_id <> ?`, [officeId, exceptUserId]);
  return r.n;
}

/** Remove someone from the office (an office never loses its last admin this way). */
export async function removeMember(db, { officeId, userId }) {
  await db.transaction(async (tx) => {
    await tx.get('SELECT id FROM pd_offices WHERE id = ? FOR UPDATE', [officeId]);
    const m = await tx.get('SELECT role FROM pd_staff WHERE office_id = ? AND user_id = ?', [officeId, userId]);
    if (!m) throw new PdError(404, 'not_found');
    if (m.role === 'admin' && (await adminsLeft(tx, officeId, userId)) === 0) throw new PdError(409, 'last_admin');
    await tx.run('DELETE FROM pd_staff WHERE office_id = ? AND user_id = ?', [officeId, userId]);
  });
}

/** Change a member's role (admin ↔ staff); the last admin stays admin. */
export async function setRole(db, { officeId, userId, role }) {
  if (!ROLES.includes(role)) throw new PdError(400, 'invalid', { field: 'role' });
  await db.transaction(async (tx) => {
    await tx.get('SELECT id FROM pd_offices WHERE id = ? FOR UPDATE', [officeId]);
    const m = await tx.get('SELECT role FROM pd_staff WHERE office_id = ? AND user_id = ?', [officeId, userId]);
    if (!m) throw new PdError(404, 'not_found');
    if (m.role === 'admin' && role === 'staff' && (await adminsLeft(tx, officeId, userId)) === 0) throw new PdError(409, 'last_admin');
    await tx.run('UPDATE pd_staff SET role = ? WHERE office_id = ? AND user_id = ?', [role, officeId, userId]);
  });
}

async function inviteByToken(db, token) {
  if (!INVITE_TOKEN_RE.test(String(token || ''))) throw new PdError(404, 'invite_invalid');
  const inv = await db.get('SELECT i.*, o.name AS office, o.status AS office_status FROM pd_invites i JOIN pd_offices o ON o.id = i.office_id WHERE i.token_hash = ?', [hashToken(token)]);
  if (!inv || inv.status === 'revoked' || inv.office_status !== 'active') throw new PdError(404, 'invite_invalid');
  if (inv.status === 'accepted') throw new PdError(409, 'invite_used');
  if (new Date(inv.expires_at) <= new Date()) throw new PdError(410, 'invite_expired');
  return inv;
}

/** GET /api/pd/invite/:token → { office, role, email, email_matches, expires_at } */
export async function invitePreview(db, { token, user }) {
  const inv = await inviteByToken(db, token);
  return { office: inv.office, role: inv.role, email: inv.email, email_matches: String(user.email || '').toLowerCase() === inv.email.toLowerCase(), expires_at: inv.expires_at };
}

/** POST /api/pd/invite/accept { token } (signed in with the invited e-mail) → { office, role } */
export async function acceptInvite(db, { token, user }) {
  const inv = await inviteByToken(db, token);
  if (String(user.email || '').toLowerCase() !== inv.email.toLowerCase()) throw new PdError(403, 'invite_other_email', { email: inv.email });
  await db.transaction(async (tx) => {
    const cur = await tx.get('SELECT status FROM pd_invites WHERE id = ? FOR UPDATE', [inv.id]);
    if (cur.status !== 'pending') throw new PdError(409, 'invite_used');
    const other = await tx.get('SELECT office_id FROM pd_staff WHERE user_id = ?', [user.id]);
    if (other && Number(other.office_id) !== Number(inv.office_id)) throw new PdError(409, 'other_office');
    if (!other) await tx.run('INSERT INTO pd_staff (office_id, user_id, role, added_by) VALUES (?, ?, ?, ?)', [inv.office_id, user.id, inv.role, inv.invited_by]);
    await tx.run(`UPDATE pd_invites SET status = 'accepted', accepted_user_id = ?, accepted_at = NOW() WHERE id = ?`, [user.id, inv.id]);
  });
  return { office: inv.office, role: inv.role };
}

// ── Office admin: phone, consent basis, baseline ───────────────────────────────

/** PATCH /api/pd/office { phone? } (office admin) */
export async function updateOfficeSelf(db, officeId, body) {
  if ('phone' in body) await db.run('UPDATE pd_offices SET phone = ?, updated_at = NOW() WHERE id = ?', [phoneOpt(body.phone), officeId]);
  return shapeOffice(await getOffice(db, officeId));
}

/** POST /api/pd/office/consent { agree: true } — the consent basis, stored with who and when. */
export async function recordConsent(db, { officeId, userId, agree }) {
  if (agree !== true) throw new PdError(400, 'consent_required');
  await db.run(
    `UPDATE pd_offices SET consent_basis_at = NOW(), consent_basis_by = ?, consent_basis_text = ?, updated_at = NOW() WHERE id = ?`,
    [userId, CONSENT_BASIS_TEXT, officeId]);
  await db.run('UPDATE pd_court_dates SET plan_needed = TRUE WHERE office_id = ? AND deleted_at IS NULL', [officeId]);
  return shapeOffice(await getOffice(db, officeId));
}

const dayField = (v, field, { required = true } = {}) => {
  if (v == null || v === '') { if (required) throw new PdError(400, 'required', { field }); return null; }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new PdError(400, 'bad_date', { field });
  return s;
};
const count = (v, field) => {
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n > 10_000_000) throw new PdError(400, 'bad_number', { field });
  return n;
};

/**
 * PUT /api/pd/office/baseline { pilot_start, from, to, hearings, appeared, missed, source }
 * The office's own numbers for the period before the pilot (recorded as given; never computed).
 */
export async function setBaseline(db, { officeId, userId, body }) {
  const from = dayField(body.from, 'from');
  const to = dayField(body.to, 'to');
  if (to < from) throw new PdError(400, 'bad_range', { field: 'to' });
  const pilot = dayField(body.pilot_start, 'pilot_start', { required: false });
  const hearings = count(body.hearings, 'hearings');
  const appeared = count(body.appeared, 'appeared');
  const missed = count(body.missed, 'missed');
  if (appeared + missed > hearings) throw new PdError(400, 'baseline_sum', { field: 'hearings' });
  const source = cleanText(body.source, 500, 'source', { required: true });
  await db.run(
    `UPDATE pd_offices SET baseline_from = ?, baseline_to = ?, baseline_hearings = ?, baseline_appeared = ?, baseline_missed = ?,
            baseline_source = ?, baseline_set_by = ?, baseline_set_at = NOW(), pilot_start = COALESCE(?, pilot_start), updated_at = NOW()
      WHERE id = ?`, [from, to, hearings, appeared, missed, source, userId, pilot, officeId]);
  return shapeOffice(await getOffice(db, officeId));
}
