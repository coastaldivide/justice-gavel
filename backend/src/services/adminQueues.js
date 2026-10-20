/**
 * services/adminQueues.js — the review queues staff work through, shared by the
 * in-app admin screen (routes/admin/queue.js, admin role) and the ops API
 * (routes/admin.js, admin role + X-Admin-Key).
 *
 *   bar submissions   attorneys' bar numbers waiting for a check on the state bar's site
 *   listing claims    "this listing is mine" — approval links the claimant's own profile
 *   listing reports   "something is wrong with this listing"
 *   reviews           held or reported reviews
 *
 * Every decision writes an audit_log row. Directory rows (lawyers / bail_agents)
 * are never modified by any decision.
 */
import { audit, AUDIT_ACTIONS } from '../utils/audit.js';
import { STATE_BAR_LOOKUP } from '../routes/attorney/_helpers.js';
import { sendPushToUser } from './pushDelivery.js';
import { msg, userLang } from '../i18n/index.js';
import { logIgnored } from '../utils/ignored.js';

export class QueueError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const note500 = (v) => (v == null ? null : String(v).trim().slice(0, 500) || null);
const limitOf = (v, d = 100) => Math.min(Math.max(Number.parseInt(v, 10) || d, 1), 500);

export async function queueSummary(db) {
  const [bar, claims, reports, reviews] = await Promise.all([
    db.get(`SELECT COUNT(*)::int AS n FROM users WHERE pending_bar_verification = 1`),
    db.get(`SELECT COUNT(*)::int AS n FROM listing_claims WHERE status = 'pending'`),
    db.get(`SELECT COUNT(*)::int AS n FROM listing_reports WHERE status = 'pending'`),
    db.get(`SELECT COUNT(*)::int AS n FROM reviews r WHERE r.status = 'pending'
              OR (r.status = 'published' AND EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open'))`),
  ]);
  return { bar: bar.n, claims: claims.n, reports: reports.n, reviews: reviews.n };
}

// ── Bar numbers ───────────────────────────────────────────────────────────────
export async function listBarSubmissions(db) {
  const rows = await db.all(
    `SELECT id AS user_id, display_name, email, bar_number, bar_state, bar_submitted_at, created_at
       FROM users WHERE pending_bar_verification = 1
      ORDER BY bar_submitted_at ASC NULLS LAST, id ASC LIMIT 200`);
  return rows.map(r => ({ ...r, user_id: Number(r.user_id), lookup_url: STATE_BAR_LOOKUP[r.bar_state] || null }));
}

export async function decideBar(db, { adminId, userId, approved, reason, req }) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new QueueError(404, 'not_found');
  if (typeof approved !== 'boolean') throw new QueueError(400, 'bad_decision');
  const why = note500(reason);
  if (!approved && !why) throw new QueueError(400, 'reason_required');
  const row = approved
    ? await db.get(
      `UPDATE users SET bar_verified = 1, jtb_verified = 1, pending_bar_verification = 0, bar_verified_at = NOW(),
              bar_verified_by = ?, bar_rejection_reason = NULL
        WHERE id = ? AND pending_bar_verification = 1 RETURNING id, bar_number, bar_state`, [adminId, userId])
    : await db.get(
      `UPDATE users SET pending_bar_verification = 0, bar_verified = 0, bar_rejection_reason = ?
        WHERE id = ? AND pending_bar_verification = 1 RETURNING id, bar_number, bar_state`, [why, userId]);
  if (!row) throw new QueueError(404, 'not_found');
  await audit(approved ? AUDIT_ACTIONS.ADMIN_BAR_APPROVED : AUDIT_ACTIONS.ADMIN_BAR_REJECTED, {
    userId: adminId, req, entityType: 'user', entityId: userId,
    metadata: { bar_number: row.bar_number, bar_state: row.bar_state, ...(approved ? {} : { reason: why }) },
  });
  const lang = await userLang(db, userId).catch(() => 'en');
  await sendPushToUser(userId, {
    title: msg(lang, approved ? 'admin.push.bar_approved_title' : 'admin.push.bar_rejected_title'),
    body: msg(lang, approved ? 'admin.push.bar_approved_body' : 'admin.push.bar_rejected_body', { reason: why || '' }),
    data: { screen: 'AttorneyDashboard' },
  }).catch(logIgnored('services/adminQueues'));
  return { user_id: userId, status: approved ? 'approved' : 'rejected' };
}

// ── Listing claims ────────────────────────────────────────────────────────────
export async function listClaims(db, status) {
  const s = ['pending', 'approved', 'rejected', 'all'].includes(status) ? status : 'pending';
  return await db.all(
    `SELECT c.id, c.table_name, c.record_id, c.status, c.license_number, c.license_state, c.contact_phone, c.note,
            c.created_at, c.decided_at, c.decision_note, u.email AS claimant_email, u.display_name AS claimant_name,
            COALESCE(l.name, b.name) AS listing_name, COALESCE(l.phone, b.phone) AS listing_phone,
            COALESCE(l.state, b.state) AS listing_state, l.bar_number AS listing_bar_number, b.license_number AS listing_license
       FROM listing_claims c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN lawyers l     ON c.table_name = 'lawyers'     AND l.id = c.record_id
       LEFT JOIN bail_agents b ON c.table_name = 'bail_agents' AND b.id = c.record_id
      WHERE (? = 'all' OR c.status = ?)
      ORDER BY c.created_at DESC LIMIT 200`, [s, s]);
}

export async function decideClaim(db, { adminId, id, decision, note, req }) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new QueueError(404, 'not_found');
  if (!['approve', 'reject'].includes(decision)) throw new QueueError(400, 'bad_decision');
  const why = note500(note);
  const out = await db.transaction(async (tx) => {
    const c = await tx.get(`SELECT id, table_name, record_id, user_id, license_number, license_state FROM listing_claims WHERE id = ? AND status = 'pending' FOR UPDATE`, [id]);
    if (!c) throw new QueueError(404, 'not_found');
    if (decision === 'approve') {
      if (c.table_name === 'lawyers') {
        const taken = await tx.get('SELECT user_id FROM attorney_profiles WHERE lawyer_id = ?', [c.record_id]);
        if (taken && Number(taken.user_id) !== Number(c.user_id)) throw new QueueError(409, 'claim_taken');
        const mine = await tx.get('SELECT id FROM attorney_profiles WHERE user_id = ? ORDER BY id LIMIT 1', [c.user_id]);
        if (mine) await tx.run('UPDATE attorney_profiles SET lawyer_id = ? WHERE id = ?', [c.record_id, mine.id]);
        else await tx.run('INSERT INTO attorney_profiles (user_id, lawyer_id, bar_number, bar_state) VALUES (?, ?, ?, ?)', [c.user_id, c.record_id, c.license_number, c.license_state]);
      } else {
        const taken = await tx.get('SELECT user_id FROM bondsman_profiles WHERE bail_agent_id = ?', [c.record_id]);
        if (taken && Number(taken.user_id) !== Number(c.user_id)) throw new QueueError(409, 'claim_taken');
        const mine = await tx.get('SELECT id FROM bondsman_profiles WHERE user_id = ? ORDER BY id LIMIT 1', [c.user_id]);
        if (mine) await tx.run('UPDATE bondsman_profiles SET bail_agent_id = ? WHERE id = ?', [c.record_id, mine.id]);
        else await tx.run('INSERT INTO bondsman_profiles (user_id, bail_agent_id, license_number, license_state) VALUES (?, ?, ?, ?)', [c.user_id, c.record_id, c.license_number, c.license_state]);
      }
    }
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await tx.run(`UPDATE listing_claims SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?`, [status, adminId, why, id]);
    return { id, status, claimant: Number(c.user_id), table: c.table_name, record_id: Number(c.record_id) };
  });
  await audit(AUDIT_ACTIONS.ADMIN_CLAIM_DECIDED, { userId: adminId, req, entityType: 'listing_claim', entityId: id, metadata: { decision: out.status, table: out.table, record_id: out.record_id, claimant: out.claimant } });
  return { id: out.id, status: out.status };
}

// ── Listing reports ───────────────────────────────────────────────────────────
export async function listReports(db, status, limit) {
  const s = ['pending', 'resolved', 'dismissed', 'all'].includes(status) ? status : 'pending';
  return await db.all(
    `SELECT r.id, r.table_name, r.record_id, r.reason, r.details, r.status, r.created_at, r.reviewed_at, r.review_note,
            COALESCE(l.name, b.name) AS listing_name, COALESCE(l.phone, b.phone) AS listing_phone,
            COALESCE(l.city, b.city) AS listing_city, COALESCE(l.state, b.state) AS listing_state
       FROM listing_reports r
       LEFT JOIN lawyers l     ON r.table_name = 'lawyers'     AND l.id = r.record_id
       LEFT JOIN bail_agents b ON r.table_name = 'bail_agents' AND b.id = r.record_id
      WHERE (? = 'all' OR r.status = ?)
      ORDER BY r.created_at DESC LIMIT ?`, [s, s, limitOf(limit)]);
}

/** Deciding a report never edits the listing: a fix goes through the provider edit / proposals flow. */
export async function decideReport(db, { adminId, id, status, note, req }) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new QueueError(404, 'not_found');
  if (!['resolved', 'dismissed'].includes(status)) throw new QueueError(400, 'bad_decision');
  const row = await db.get(
    `UPDATE listing_reports SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ? AND status = 'pending' RETURNING id, status, table_name, record_id`, [status, note500(note), adminId, id]);
  if (!row) throw new QueueError(404, 'not_found');
  await audit(AUDIT_ACTIONS.ADMIN_REPORT_DECIDED, { userId: adminId, req, entityType: 'listing_report', entityId: id, metadata: { status, table: row.table_name, record_id: Number(row.record_id) } });
  return { id: Number(row.id), status: row.status };
}

// ── Reviews ───────────────────────────────────────────────────────────────────
export async function listReviews(db, status, limit) {
  const s = ['pending', 'reported', 'hidden', 'all'].includes(status) ? status : 'pending';
  const where = s === 'all' ? 'TRUE'
    : s === 'reported' ? "r.status = 'published' AND EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open')"
      : 'r.status = ?';
  const rows = await db.all(
    `SELECT r.id, r.entity_type, r.entity_id, r.rating, r.comment, r.status, r.verified, r.created_at,
            r.moderated_at, r.moderation_note,
            COALESCE(l.name, b.name) AS listing_name,
            (SELECT COUNT(*) FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open') AS open_reports,
            (SELECT string_agg(DISTINCT rr.reason, ',') FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open') AS report_reasons
       FROM reviews r
       LEFT JOIN lawyers l     ON r.entity_type = 'lawyer'     AND l.id = r.entity_id
       LEFT JOIN bail_agents b ON r.entity_type = 'bail_agent' AND b.id = r.entity_id
      WHERE ${where}
      ORDER BY r.created_at DESC LIMIT ?`,
    ['pending', 'hidden'].includes(s) ? [s, limitOf(limit)] : [limitOf(limit)]);
  return rows.map(r => ({ ...r, open_reports: Number(r.open_reports) }));
}

export async function moderateReview(db, { adminId, id, action, note, req }) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new QueueError(404, 'not_found');
  if (!['publish', 'hide'].includes(action)) throw new QueueError(400, 'bad_decision');
  const row = await db.get(
    `UPDATE reviews SET status = ?, moderated_at = NOW(), moderated_by = ?, moderation_note = ?
      WHERE id = ? RETURNING id, status`, [action === 'publish' ? 'published' : 'hidden', adminId, note500(note), id]);
  if (!row) throw new QueueError(404, 'not_found');
  await db.run(`UPDATE review_reports SET status = 'closed' WHERE review_id = ? AND status = 'open'`, [id]);
  await audit(AUDIT_ACTIONS.ADMIN_REVIEW_MODERATED, { userId: adminId, req, entityType: 'review', entityId: id, metadata: { action } });
  return { id: Number(row.id), status: row.status };
}
