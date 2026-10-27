/**
 * services/bondDesk/recoveryShares.js — a bail agent shares ONE forfeited bond with a recovery
 * agent (B4, ⚖ state recovery-agent rules, BOND_RECOVERY_SHARING_ENABLED — off in production
 * unless set). docs/BOND_DESK.md "Recovery-agent sharing".
 *
 *   - Invite by e-mail: a personal link (32 random bytes; only the SHA-256 is stored) that works
 *     for INVITE_DAYS. The recovery agent signs in or creates an account with that same e-mail
 *     address and accepts; the share is then bound to that account.
 *   - Read-only view: defendant name, photo if one was uploaded with the bond paperwork, the last
 *     known addresses and phones from the bond and its questionnaire, the last check-ins (with
 *     locations only when the defendant shared them AND the agent chose to share locations),
 *     re-arrest matches, the forfeiture deadline and the agent's contact details.
 *   - Access ends by itself when the bond is no longer forfeited (reinstated, exonerated,
 *     surrendered, forfeiture paid) and when the agent revokes it. It is checked on every read.
 *   - Every view (details or photo) is logged in bd_recovery_views and shown to the bail agent.
 *   - The state's recovery-agent rule (routes/recovery_agents.js RECOVERY_LAWS) is shown on the
 *     share screen with how it was checked; sharing is refused where that data says recovery is
 *     not allowed, and the agent must acknowledge the rule before sharing.
 */
import crypto from 'node:crypto';
import { RECOVERY_LAWS } from '../../routes/recovery_agents.js';
import { realArrestSql } from '../../utils/arrestVisibility.js';
import { msg } from '../../i18n/index.js';
import { agencyFor, sendAgentEmail } from './core.js';
import { addEvent } from './rearrest.js';
import { getFile } from './packets.js';
import { daysBetween } from '../../utils/timezone.js';
import { agentToday } from './core.js';

export const INVITE_DAYS = 14;
const APP_URL = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
export const hashShareToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;
export const shareLink = (token) => `${APP_URL()}/recovery/${token}`;

export class ShareError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params || {}; }
}

/** The state's recovery-agent rule as recorded in routes/recovery_agents.js (null when none). */
export function stateRule(state) {
  const code = String(state || '').toUpperCase();
  const r = RECOVERY_LAWS[code];
  if (!r) return null;
  return { state: code, allowed: r.allowed ?? null, license: r.license ?? null, agency: r.agency || null, law: r.law || null,
    notes: r.notes || null, source_url: r.source_url || null, checked: r.checked || 'unverified' };
}

const ENDED_BY_STATUS = { active: 'reinstated', exonerated: 'exonerated', surrendered: 'surrendered', forfeiture_paid: 'forfeiture_paid' };

/** End every live share of a bond (status change or revoke). → number ended */
export async function endShares(db, bondId, reason) {
  const rows = await db.all(
    `UPDATE bd_recovery_shares SET ended_at = NOW(), ended_reason = ? WHERE bond_id = ? AND ended_at IS NULL RETURNING id, invite_email`, [reason, bondId]);
  for (const r of rows) await addEvent(db, bondId, 'recovery_ended', { share_id: Number(r.id), email: r.invite_email, reason });
  return rows.length;
}

/** After a status change: a bond that is no longer forfeited is no longer shared. */
export async function syncSharesWithStatus(db, bondId, status) {
  if (status === 'forfeited') return 0;
  return endShares(db, bondId, ENDED_BY_STATUS[status] || 'closed');
}

export async function createShare(db, { agentId, bond, email, shareLocations, ruleAcknowledged, lang }) {
  if (bond.status !== 'forfeited') throw new ShareError(409, 'share_not_forfeited');
  const rule = stateRule(bond.state);
  if (rule && rule.allowed === false) throw new ShareError(409, 'share_not_allowed_state', { state: rule.state });
  if (ruleAcknowledged !== true) throw new ShareError(400, 'share_rule_ack');
  const live = await db.get('SELECT COUNT(*)::int AS n FROM bd_recovery_shares WHERE bond_id = ? AND ended_at IS NULL', [bond.id]);
  if (live.n >= 5) throw new ShareError(409, 'too_many');
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const row = await db.get(
    `INSERT INTO bd_recovery_shares (bond_id, agent_id, invite_email, token_hash, invite_expires_at, share_locations, rule_state)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (bond_id, lower(invite_email)) WHERE ended_at IS NULL DO NOTHING RETURNING id`,
    [bond.id, agentId, email, hashShareToken(token), expires, !!shareLocations, rule?.state || null]);
  if (!row) throw new ShareError(409, 'share_exists');
  await addEvent(db, Number(bond.id), 'recovery_shared', { share_id: Number(row.id), email, share_locations: !!shareLocations });
  const a = await agencyFor(db, agentId);
  const link = shareLink(token);
  const p = { agency: a.agency || a.agent_name || 'A bail agency', defendant: bond.defendant_name, link, email, days: INVITE_DAYS };
  const emailStatus = await sendAgentEmail({ to: email, subject: msg(lang, 'recovery.invite_subject', p), text: msg(lang, 'recovery.invite_body', p) });
  return { id: Number(row.id), link, email_status: emailStatus };
}

export async function revokeShare(db, agentId, shareId) {
  const r = await db.get(`UPDATE bd_recovery_shares SET ended_at = NOW(), ended_reason = 'revoked' WHERE id = ? AND agent_id = ? AND ended_at IS NULL
                           RETURNING id, bond_id, invite_email`, [shareId, agentId]);
  if (!r) {
    const ex = await db.get('SELECT id FROM bd_recovery_shares WHERE id = ? AND agent_id = ?', [shareId, agentId]);
    throw ex ? new ShareError(409, 'share_ended') : new ShareError(404, 'not_found');
  }
  await addEvent(db, Number(r.bond_id), 'recovery_ended', { share_id: Number(r.id), email: r.invite_email, reason: 'revoked' });
}

/** The bail agent's view of a bond's shares and every logged view. */
export async function sharesForBond(db, bondId) {
  const shares = await db.all(
    `SELECT s.id, s.invite_email, s.invite_expires_at, s.share_locations, s.accepted_at, s.created_at, s.ended_at, s.ended_reason,
            s.recovery_user_id, u.email AS account_email, COALESCE(u.display_name, u.name) AS account_name
       FROM bd_recovery_shares s LEFT JOIN users u ON u.id = s.recovery_user_id
      WHERE s.bond_id = ? ORDER BY s.created_at DESC LIMIT 20`, [bondId]);
  const ids = shares.map((s) => Number(s.id));
  const views = ids.length
    ? await db.all(`SELECT share_id, what, viewed_at FROM bd_recovery_views WHERE share_id = ANY(?::bigint[]) ORDER BY viewed_at DESC LIMIT 500`, [`{${ids.join(',')}}`])
    : [];
  const now = new Date();
  return shares.map((s) => ({
    id: Number(s.id), invite_email: s.invite_email, share_locations: !!s.share_locations, created_at: s.created_at,
    accepted_at: s.accepted_at || null, account_name: s.account_name || null,
    status: s.ended_at ? 'ended' : s.accepted_at ? 'active' : new Date(s.invite_expires_at) <= now ? 'invite_expired' : 'invited',
    ended_at: s.ended_at || null, ended_reason: s.ended_reason || null,
    views: views.filter((v) => Number(v.share_id) === Number(s.id)).map((v) => ({ what: v.what, at: v.viewed_at })),
  }));
}

// ── The recovery agent's side ─────────────────────────────────────────────────

/** Accept an invite with the link token. The signed-in account must use the invited address. */
export async function acceptShare(db, user, token) {
  if (!SHARE_TOKEN_RE.test(String(token || ''))) throw new ShareError(404, 'share_invalid');
  const s = await db.get(
    `SELECT s.id, s.bond_id, s.invite_email, s.invite_expires_at, s.recovery_user_id, s.ended_at, b.status
       FROM bd_recovery_shares s JOIN bd_bonds b ON b.id = s.bond_id WHERE s.token_hash = ?`, [hashShareToken(token)]);
  if (!s) throw new ShareError(404, 'share_invalid');
  if (s.ended_at || s.status !== 'forfeited') throw new ShareError(410, 'share_ended');
  if (s.recovery_user_id != null) {
    if (Number(s.recovery_user_id) === Number(user.id)) return Number(s.id);
    throw new ShareError(409, 'share_taken');
  }
  if (new Date(s.invite_expires_at) <= new Date()) throw new ShareError(410, 'share_invite_expired');
  const u = await db.get('SELECT email FROM users WHERE id = ?', [user.id]);
  if (String(u?.email || '').trim().toLowerCase() !== String(s.invite_email).trim().toLowerCase()) throw new ShareError(403, 'share_wrong_account');
  const r = await db.get(`UPDATE bd_recovery_shares SET recovery_user_id = ?, accepted_at = NOW() WHERE id = ? AND recovery_user_id IS NULL AND ended_at IS NULL RETURNING id`,
    [user.id, s.id]);
  if (!r) throw new ShareError(409, 'share_taken');
  await addEvent(db, Number(s.bond_id), 'recovery_accepted', { share_id: Number(s.id), email: s.invite_email });
  return Number(s.id);
}

/** A live share of this recovery agent (ends it when the bond left 'forfeited'). */
export async function liveShare(db, userId, shareId) {
  const s = await db.get(
    `SELECT s.id, s.bond_id, s.agent_id, s.share_locations, s.ended_at, s.accepted_at, b.status
       FROM bd_recovery_shares s JOIN bd_bonds b ON b.id = s.bond_id WHERE s.id = ? AND s.recovery_user_id = ?`, [shareId, userId]);
  if (!s) throw new ShareError(404, 'not_found');
  if (!s.ended_at && s.status !== 'forfeited') await syncSharesWithStatus(db, Number(s.bond_id), s.status);
  if (s.ended_at || s.status !== 'forfeited') throw new ShareError(410, 'share_ended');
  return s;
}

/** The recovery agent's live shares (list). */
export async function sharesForRecoveryAgent(db, userId) {
  const rows = await db.all(
    `SELECT s.id, s.accepted_at, b.id AS bond_id, b.status, b.defendant_name, b.forfeiture_deadline_on, b.state, b.agent_id
       FROM bd_recovery_shares s JOIN bd_bonds b ON b.id = s.bond_id
      WHERE s.recovery_user_id = ? AND s.ended_at IS NULL ORDER BY s.accepted_at DESC LIMIT 50`, [userId]);
  const out = [];
  for (const r of rows) {
    if (r.status !== 'forfeited') { await syncSharesWithStatus(db, Number(r.bond_id), r.status); continue; }
    const a = await agencyFor(db, Number(r.agent_id));
    out.push({ id: Number(r.id), defendant_name: r.defendant_name, forfeiture_deadline_on: r.forfeiture_deadline_on, state: r.state,
      agency: a.agency || a.agent_name, accepted_at: r.accepted_at });
  }
  return out;
}

const logView = (db, shareId, userId, what) =>
  db.run('INSERT INTO bd_recovery_views (share_id, viewer_user_id, what) VALUES (?, ?, ?)', [shareId, userId, what]);

const PHOTO_SQL = `SELECT u.id, u.storage_key, u.content_type FROM bd_uploads u JOIN bd_signers s ON s.id = u.signer_id JOIN bd_packets k ON k.id = u.packet_id
  WHERE k.bond_id = ? AND s.role = 'defendant' AND u.kind IN ('selfie_with_id', 'id_front') AND u.content_type LIKE 'image/%'
  ORDER BY (u.kind = 'selfie_with_id') DESC, u.id DESC LIMIT 1`;

/** The read-only file (logged). */
export async function shareDetails(db, userId, shareId) {
  const s = await liveShare(db, userId, shareId);
  const bondId = Number(s.bond_id);
  const b = await db.get(
    `SELECT id, defendant_name, defendant_dob, defendant_phone, defendant_address, case_number, court_name, county, state, charges,
            bond_amount_cents, forfeited_on, forfeiture_deadline_on, checkin_enrollment_id, agent_id FROM bd_bonds WHERE id = ?`, [bondId]);
  const answers = await db.all(
    `SELECT s.answers, s.signed_at FROM bd_signers s JOIN bd_packets k ON k.id = s.packet_id
      WHERE k.bond_id = ? AND s.role = 'defendant' ORDER BY s.id DESC LIMIT 10`, [bondId]);
  const addresses = []; const phones = []; const employers = []; const references = []; const vehicles = [];
  const push = (list, value, source) => { const v = String(value || '').trim(); if (v && !list.some((x) => x.value.toLowerCase() === v.toLowerCase())) list.push({ value: v, source }); };
  push(addresses, b.defendant_address, 'bond'); push(phones, b.defendant_phone, 'bond');
  for (const r of answers) {
    const a = r.answers || {};
    push(addresses, a.address, 'questionnaire'); push(phones, a.phone, 'questionnaire');
    if (a.employer) push(employers, [a.employer, a.employer_phone].filter(Boolean).join(' · '), 'questionnaire');
    push(references, a.reference_1, 'questionnaire'); push(references, a.reference_2, 'questionnaire');
    push(vehicles, a.vehicle, 'questionnaire');
  }
  const checkins = b.checkin_enrollment_id
    ? await db.all(
      `SELECT checked_in_at, via, COALESCE(CAST(lat AS double precision), location_lat) AS lat, COALESCE(CAST(lng AS double precision), location_lng) AS lng
         FROM checkin_records WHERE enrollment_id = ? ORDER BY checked_in_at DESC LIMIT 10`, [b.checkin_enrollment_id])
    : [];
  const rearrests = await db.all(
    `SELECT r.match, r.status, r.created_at, a.booking_date, a.county, a.state, a.jail_location
       FROM bd_rearrests r JOIN arrest_records a ON a.id = r.arrest_id
      WHERE r.bond_id = ? AND r.status IN ('alerted', 'confirmed') AND ${realArrestSql('a')} ORDER BY r.created_at DESC LIMIT 10`, [bondId]);
  const photo = await db.get(PHOTO_SQL, [bondId]);
  const agency = await agencyFor(db, Number(b.agent_id));
  const today = await agentToday(db, Number(b.agent_id));
  await logView(db, Number(s.id), userId, 'details');
  return {
    share: { id: Number(s.id), share_locations: !!s.share_locations },
    defendant: { name: b.defendant_name, dob: b.defendant_dob || null, photo_available: !!photo },
    bond: { case_number: b.case_number, court_name: b.court_name, county: b.county, state: b.state, charges: b.charges,
      bond_amount_cents: Number(b.bond_amount_cents), forfeited_on: b.forfeited_on, forfeiture_deadline_on: b.forfeiture_deadline_on,
      days_left: b.forfeiture_deadline_on ? daysBetween(today, b.forfeiture_deadline_on) : null },
    addresses, phones, employers, references, vehicles,
    checkins: checkins.map((c) => ({ at: c.checked_in_at, via: c.via,
      location: s.share_locations && c.lat != null && c.lng != null ? { lat: Number(c.lat), lng: Number(c.lng) } : null })),
    rearrests: rearrests.map((r) => ({ match: r.match, status: r.status, found_at: r.created_at,
      booking_date: r.booking_date ? new Date(r.booking_date).toISOString().slice(0, 10) : null, county: r.county, state: r.state, facility: r.jail_location })),
    agent: { agency: agency.agency, name: agency.agent_name, license: agency.license, phone: agency.phone, email: agency.email },
    state_rule: stateRule(b.state),
  };
}

/** The defendant's photo (logged). → { bytes, type } */
export async function sharePhoto(db, storage, userId, shareId) {
  const s = await liveShare(db, userId, shareId);
  const p = await db.get(PHOTO_SQL, [Number(s.bond_id)]);
  if (!p) throw new ShareError(404, 'not_found');
  const bytes = await getFile(storage, p.storage_key);
  await logView(db, Number(s.id), userId, 'photo');
  return { bytes, type: p.content_type };
}
