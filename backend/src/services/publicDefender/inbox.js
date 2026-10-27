/**
 * services/publicDefender/inbox.js — the office's shared inbox (A11 step 4;
 * docs/PUBLIC_DEFENDER.md "Two-way messages").
 *
 * One conversation per client: every text the office sent (reminders, questions, staff replies)
 * and every text the client sent, newest first. A conversation is "open" when the client wrote
 * after it was last marked handled. Unread = the client's texts no one in the office has opened.
 * Every list is paged with bounds (≤ 50 conversations, ≤ 100 messages per page).
 */
import { decrypt } from '../encryption.js';
import { PdError } from './common.js';

const truthy = (v) => v === true || v === 't' || v === 1;

/** GET /api/pd/inbox?filter=open|all&page= → { conversations, page, page_size, total, unread_total } */
export async function inbox(db, officeId, { filter = 'all', page = 1, pageSize = 30 } = {}) {
  const p = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), 1000);
  const size = Math.min(Math.max(1, Number.parseInt(pageSize, 10) || 30), 50);
  const open = filter === 'open'
    ? ' AND c.last_inbound_at IS NOT NULL AND (c.handled_at IS NULL OR c.handled_at < c.last_inbound_at)' : '';
  const where = `c.office_id = ? AND c.last_message_at IS NOT NULL${open}`;
  const total = await db.get(`SELECT COUNT(*)::int AS n FROM pd_clients c WHERE ${where}`, [officeId]);
  const rows = await db.all(
    `SELECT c.id, c.name, c.case_number, c.phone, c.last_message_at, c.last_inbound_at, c.handled_at,
            EXISTS (SELECT 1 FROM sms_opt_outs x WHERE x.phone = c.phone) AS opted_out,
            (SELECT COUNT(*)::int FROM pd_messages m WHERE m.pd_client_id = c.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread,
            (SELECT m.body FROM pd_messages m WHERE m.pd_client_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
            (SELECT m.direction FROM pd_messages m WHERE m.pd_client_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_direction
       FROM pd_clients c WHERE ${where}
      ORDER BY c.last_message_at DESC, c.id DESC LIMIT ? OFFSET ?`, [officeId, size, (p - 1) * size]);
  return {
    conversations: rows.map((r) => ({
      client_id: Number(r.id), name: r.name, case_number: r.case_number, last_message_at: r.last_message_at,
      last_preview: String(decrypt(r.last_body) || '').slice(0, 140), last_direction: r.last_direction,
      unread: Number(r.unread || 0), opted_out: truthy(r.opted_out),
      handled: !r.last_inbound_at || (!!r.handled_at && new Date(r.handled_at) >= new Date(r.last_inbound_at)),
    })),
    page: p, page_size: size, total: total.n, unread_total: await unreadTotal(db, officeId),
  };
}

export async function unreadTotal(db, officeId) {
  const r = await db.get(`SELECT COUNT(*)::int AS n FROM pd_messages WHERE office_id = ? AND direction = 'in' AND read_at IS NULL`, [officeId]);
  return r.n;
}

/**
 * GET /api/pd/clients/:id/messages?before=<message id>&limit= → { messages (newest first), next_before }
 * Opening the conversation marks the client's texts read.
 */
export async function conversation(db, officeId, clientId, { before = null, limit = 50 } = {}) {
  const c = await db.get('SELECT id, handled_at, last_inbound_at FROM pd_clients WHERE id = ? AND office_id = ?', [clientId, officeId]);
  if (!c) throw new PdError(404, 'not_found');
  const size = Math.min(Math.max(1, Number.parseInt(limit, 10) || 50), 100);
  const b = before == null || before === '' ? null : Number.parseInt(before, 10);
  if (before != null && before !== '' && (!Number.isSafeInteger(b) || b <= 0)) throw new PdError(400, 'invalid', { field: 'before' });
  const rows = await db.all(
    `SELECT m.id, m.direction, m.kind, m.body, m.status, m.created_at, m.read_at, d.status AS delivery,
            COALESCE(u.display_name, u.name) AS sent_by_name
       FROM pd_messages m LEFT JOIN sms_delivery d ON d.provider_id = m.provider_id LEFT JOIN users u ON u.id = m.sent_by
      WHERE m.pd_client_id = ? ${b ? 'AND m.id < ?' : ''}
      ORDER BY m.id DESC LIMIT ?`, b ? [c.id, b, size + 1] : [c.id, size + 1]);
  const more = rows.length > size;
  const page = rows.slice(0, size);
  await db.run(`UPDATE pd_messages SET read_at = NOW() WHERE pd_client_id = ? AND direction = 'in' AND read_at IS NULL`, [c.id]);
  return {
    messages: page.map((m) => ({
      id: Number(m.id), direction: m.direction, kind: m.kind, body: decrypt(m.body), status: m.status,
      delivery: m.delivery || null, created_at: m.created_at, sent_by_name: m.sent_by_name || null,
    })),
    next_before: more ? Number(page[page.length - 1].id) : null,
    handled: !c.last_inbound_at || (!!c.handled_at && new Date(c.handled_at) >= new Date(c.last_inbound_at)),
  };
}

/** POST /api/pd/clients/:id/handled { handled: true|false } */
export async function markHandled(db, { officeId, clientId, userId, handled = true }) {
  const r = handled
    ? await db.run(`UPDATE pd_clients SET handled_at = NOW(), handled_by = ? WHERE id = ? AND office_id = ?`, [userId, clientId, officeId])
    : await db.run(`UPDATE pd_clients SET handled_at = NULL, handled_by = NULL WHERE id = ? AND office_id = ?`, [clientId, officeId]);
  if (!r.changes) throw new PdError(404, 'not_found');
  if (handled) await db.run(`UPDATE pd_messages SET read_at = NOW() WHERE pd_client_id = ? AND direction = 'in' AND read_at IS NULL`, [clientId]);
}
