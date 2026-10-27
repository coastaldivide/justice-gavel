/**
 * services/bondDesk/formsSetup.js — "Set up my forms for me" (A12 step 2). docs/BOND_DESK.md
 * "Forms set up for you".
 *
 *   agency   asks (one open request at a time) and uploads its surety PDFs to the request; sees
 *            requested → in progress → ready. Forms on the request are hidden from the agency's
 *            library (and cannot be sent) until staff hand them over.
 *   staff    (admin role) open the request ("in progress", assigned to them), map each PDF with the
 *            same forms tool the agency uses (routes/bondDesk/forms.js mounted under
 *            /api/admin/bd-setup/:id), then hand over ("ready": the forms appear in the agency's
 *            library and the agency gets a push and an e-mail). Every step is audit-logged.
 */
import { logIgnored } from '../../utils/ignored.js';
import { audit } from '../../utils/audit.js';
import { msg, normalizeLang } from '../../i18n/index.js';
import { sendPushToUser } from '../pushDelivery.js';
import { agencyFor, sendAgentEmail } from './core.js';
import { LedgerError } from './payments.js';
import { appUrl } from './connect.js';

const REQ_COLS = 'id, agent_id, status, note, staff_note, handled_by, started_at, ready_at, cancelled_at, created_at, updated_at';
const pub = (r, forms = []) => ({
  id: Number(r.id), status: r.status, note: r.note, staff_note: r.staff_note, created_at: r.created_at, started_at: r.started_at,
  ready_at: r.ready_at, cancelled_at: r.cancelled_at,
  forms: forms.map((f) => ({ id: Number(f.id), name: f.name, page_count: Number(f.page_count), mapped: Object.keys(f.field_map || {}).length,
    text_fields: (f.fields || []).filter((x) => x.type === 'text').length, created_at: f.created_at })),
});

async function formsOf(db, requestId) {
  return await db.all('SELECT id, name, page_count, field_map, fields, created_at FROM bd_forms WHERE setup_request_id = ? AND NOT archived ORDER BY id LIMIT 100', [requestId]);
}

// ── Agency ───────────────────────────────────────────────────────────────────

/** GET /bond-desk/forms-setup → { requests: [...] } (latest first) */
export async function listForAgency(db, agentId) {
  const rows = await db.all(`SELECT ${REQ_COLS} FROM bd_setup_requests WHERE agent_id = ? ORDER BY id DESC LIMIT 20`, [agentId]);
  const out = [];
  for (const r of rows) out.push(pub(r, await formsOf(db, r.id)));
  return out;
}

export async function createRequest(db, { agentId, note, req }) {
  const open = await db.get(`SELECT id FROM bd_setup_requests WHERE agent_id = ? AND status IN ('requested','in_progress')`, [agentId]);
  if (open) throw new LedgerError(409, 'setup_open');
  const r = await db.get(`INSERT INTO bd_setup_requests (agent_id, note) VALUES (?, ?) RETURNING ${REQ_COLS}`, [agentId, note]);
  await audit('bond_desk.forms_setup_requested', { userId: req?.user?.id, req, entityType: 'bd_setup_request', entityId: r.id, metadata: { agent_id: agentId } });
  return pub(r);
}

/** The agency's own open request (uploading files to it). */
export async function openRequestOf(db, agentId, requestId) {
  const r = await db.get(`SELECT ${REQ_COLS} FROM bd_setup_requests WHERE id = ? AND agent_id = ?`, [requestId, agentId]);
  if (!r) throw new LedgerError(404, 'not_found');
  if (!['requested', 'in_progress'].includes(r.status)) throw new LedgerError(409, 'setup_closed');
  return r;
}

export async function cancelRequest(db, { agentId, requestId, req }) {
  const r = await db.get(
    `UPDATE bd_setup_requests SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = ? AND agent_id = ? AND status = 'requested'
     RETURNING ${REQ_COLS}`, [requestId, agentId]);
  if (!r) throw new LedgerError(409, 'setup_closed');
  // forms uploaded to a cancelled request go to the agency's library as they are (the agency can map them itself)
  await db.run('UPDATE bd_forms SET setup_pending = FALSE, updated_at = NOW() WHERE setup_request_id = ?', [requestId]);
  await audit('bond_desk.forms_setup_cancelled', { userId: req?.user?.id, req, entityType: 'bd_setup_request', entityId: requestId, metadata: { agent_id: agentId } });
  return pub(r);
}

// ── Staff (admin role) ───────────────────────────────────────────────────────

export async function listForStaff(db, status) {
  const st = ['requested', 'in_progress', 'ready', 'cancelled', 'open', 'all'].includes(status) ? status : 'open';
  const where = st === 'all' ? 'TRUE' : st === 'open' ? `r.status IN ('requested','in_progress')` : 'r.status = ?';
  const rows = await db.all(
    `SELECT r.id, r.agent_id, r.status, r.note, r.staff_note, r.handled_by, r.started_at, r.ready_at, r.cancelled_at, r.created_at, r.updated_at,
            p.company_name, u.email AS agent_email, h.display_name AS handled_by_name,
            (SELECT COUNT(*)::int FROM bd_forms f WHERE f.setup_request_id = r.id AND NOT f.archived) AS forms
       FROM bd_setup_requests r JOIN users u ON u.id = r.agent_id LEFT JOIN bondsman_profiles p ON p.user_id = r.agent_id
       LEFT JOIN users h ON h.id = r.handled_by
      WHERE ${where} ORDER BY r.created_at ASC, r.id ASC LIMIT 200`, ['open', 'all'].includes(st) ? [] : [st]);
  return rows.map((r) => ({ ...pub(r), agent_id: Number(r.agent_id), agency: r.company_name || r.agent_email, agent_email: r.agent_email,
    handled_by: r.handled_by == null ? null : Number(r.handled_by), handled_by_name: r.handled_by_name || null, form_count: r.forms }));
}

export async function requestForStaff(db, requestId) {
  const r = await db.get(`SELECT ${REQ_COLS} FROM bd_setup_requests WHERE id = ?`, [requestId]);
  if (!r) throw new LedgerError(404, 'not_found');
  const a = await agencyFor(db, r.agent_id);
  return { ...pub(r, await formsOf(db, r.id)), agent_id: Number(r.agent_id), agency: a.agency || a.agent_name, agent_email: a.email || null, agent_phone: a.phone || null };
}

/** Staff open a request: in progress, assigned to them. */
export async function startRequest(db, { adminId, requestId, req }) {
  const r = await db.get(
    `UPDATE bd_setup_requests SET status = 'in_progress', handled_by = ?, started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      WHERE id = ? AND status IN ('requested','in_progress') RETURNING ${REQ_COLS}`, [adminId, requestId]);
  if (!r) throw new LedgerError(409, 'setup_closed');
  await audit('admin.bd_setup_started', { userId: adminId, req, entityType: 'bd_setup_request', entityId: requestId, metadata: { agent_id: Number(r.agent_id) } });
  return pub(r);
}

/** Hand the forms over: ready; the forms appear in the agency's library; the agency is told. */
export async function finishRequest(db, { adminId, requestId, note, req }) {
  const forms = await db.get('SELECT COUNT(*)::int AS n FROM bd_forms WHERE setup_request_id = ? AND NOT archived', [requestId]);
  const r = await db.transaction(async (tx) => {
    const row = await tx.get(
      `UPDATE bd_setup_requests SET status = 'ready', ready_at = NOW(), staff_note = ?, handled_by = COALESCE(handled_by, ?), updated_at = NOW()
        WHERE id = ? AND status = 'in_progress' RETURNING ${REQ_COLS}`, [note, adminId, requestId]);
    if (!row) throw new LedgerError(409, 'setup_not_started');
    if (!forms.n) throw new LedgerError(409, 'setup_no_forms');
    await tx.run('UPDATE bd_forms SET setup_pending = FALSE, updated_at = NOW() WHERE setup_request_id = ?', [requestId]);
    return row;
  });
  await audit('admin.bd_setup_ready', { userId: adminId, req, entityType: 'bd_setup_request', entityId: requestId, metadata: { agent_id: Number(r.agent_id), forms: forms.n } });
  const u = await db.get('SELECT preferred_language FROM users WHERE id = ?', [r.agent_id]).catch(() => null);
  const lang = normalizeLang(u?.preferred_language) || 'en';
  const p = { n: forms.n };
  await sendPushToUser(Number(r.agent_id), { title: msg(lang, 'bd.setup.ready_title'), body: msg(lang, 'bd.setup.ready_body', p), data: { type: 'bd_forms_ready', screen: 'BondForms' } }).catch(logIgnored('services/bondDesk/formsSetup'));
  const a = await agencyFor(db, r.agent_id);
  await sendAgentEmail({ to: a.email, subject: msg(lang, 'bd.setup.ready_title'), text: `${msg(lang, 'bd.setup.ready_body', p)}${note ? `\n\n${note}` : ''}\n\n${appUrl()}/bond-desk/forms` });
  return pub(r);
}
