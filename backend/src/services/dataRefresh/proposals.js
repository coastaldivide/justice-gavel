/**
 * dataRefresh/proposals.js — review queue for scraped provider changes.
 *
 * applyProposal() is the ONLY path by which a scrape result reaches an
 * existing lawyers / bail_agents / recovery_agents row, and only because an
 * admin asked for it. It writes exactly one column (the proposal's field) and
 * updated_at, inside one transaction that:
 *   - locks the proposal and the provider row,
 *   - refuses (409 stale) when the row's current value is no longer the value
 *     the proposal was made against, unless force=true,
 *   - marks the proposal applied, supersedes other pending proposals for the
 *     same field,
 *   - writes provider_update_log (field / old / new / who) and audit_log.
 * rejectProposal() only changes the proposal's status (a rejected value is
 * never proposed again — see migration 15).
 */
import { FIELD_RULES, castForColumn, valueText } from './normalize.js';
import { isProposableField, PROVIDER_TABLES } from './providerStore.js';

export const PROPOSAL_STATUSES = ['pending', 'applied', 'rejected', 'superseded'];
export const MAX_BULK = 500;

export class ProposalError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const clampInt = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

export async function listProposals(db, q = {}) {
  const where = []; const params = [];
  const status = PROPOSAL_STATUSES.includes(q.status) ? q.status : (q.status === 'all' ? null : 'pending');
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (q.table) {
    if (!PROVIDER_TABLES[q.table]) throw new ProposalError(400, 'bad_table', 'table must be lawyers, bail_agents or recovery_agents');
    where.push('p.table_name = ?'); params.push(q.table);
  }
  if (q.field) {
    if (!FIELD_RULES[q.field]) throw new ProposalError(400, 'bad_field', 'unknown field');
    where.push('p.field = ?'); params.push(q.field);
  }
  if (q.record_id !== undefined && q.record_id !== '') {
    const rid = parseInt(q.record_id, 10);
    if (!Number.isFinite(rid)) throw new ProposalError(400, 'bad_record_id', 'record_id must be an integer');
    where.push('p.record_id = ?'); params.push(rid);
  }
  if (q.run_id !== undefined && q.run_id !== '') {
    const run = parseInt(q.run_id, 10);
    if (!Number.isFinite(run)) throw new ProposalError(400, 'bad_run_id', 'run_id must be an integer');
    where.push('p.run_id = ?'); params.push(run);
  }
  const limit = clampInt(q.limit, 50, 1, 500);
  const offset = clampInt(q.offset, 0, 0, 1_000_000);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT p.id, p.table_name, p.record_id, p.field, p.old_value, p.new_value, p.source, p.source_ref,
            p.run_id, p.status, p.fetched_at, p.last_seen_at, p.seen_count, p.decided_by, p.decided_at,
            p.decision_note, p.created_at,
            COALESCE(l.name, b.name, r.name)   AS provider_name,
            COALESCE(l.city, b.city, r.city)   AS provider_city,
            COALESCE(l.state, b.state, r.state) AS provider_state
       FROM provider_update_proposals p
       LEFT JOIN lawyers         l ON p.table_name = 'lawyers'         AND l.id = p.record_id
       LEFT JOIN bail_agents     b ON p.table_name = 'bail_agents'     AND b.id = p.record_id
       LEFT JOIN recovery_agents r ON p.table_name = 'recovery_agents' AND r.id = p.record_id
       ${w}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await db.get(`SELECT COUNT(*)::int AS n FROM provider_update_proposals p ${w}`, params);
  return { total: total?.n ?? 0, limit, offset, rows };
}

async function audit(tx, userId, action, p, details) {
  await tx.run(
    `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, entity_type)
     VALUES (?, ?, ?, ?, ?, 'provider_update_proposal')`,
    [userId, action, p.table_name, String(p.record_id), JSON.stringify({ proposal_id: Number(p.id), field: p.field, ...details })],
  );
}

export async function applyProposal(db, id, { userId, note = null, force = false } = {}) {
  const pid = parseInt(id, 10);
  if (!Number.isFinite(pid)) throw new ProposalError(400, 'bad_id', 'proposal id must be an integer');
  return await db.transaction(async (tx) => {
    const p = await tx.get('SELECT * FROM provider_update_proposals WHERE id = ? FOR UPDATE', [pid]);
    if (!p) throw new ProposalError(404, 'not_found', 'Proposal not found');
    if (p.status !== 'pending') throw new ProposalError(409, 'not_pending', `Proposal is ${p.status}`);
    // Defense in depth: the field is interpolated as a column name below.
    if (!isProposableField(p.table_name, p.field)) throw new ProposalError(400, 'bad_field', 'field is not updatable');
    const table = p.table_name; const field = p.field;
    const row = await tx.get(`SELECT id, ${field} AS cur FROM ${table} WHERE id = ? FOR UPDATE`, [p.record_id]);
    if (!row) throw new ProposalError(404, 'record_missing', 'The provider row no longer exists');
    const current = valueText(row.cur);
    if (!force && current !== p.old_value
        && !(current !== null && p.old_value !== null && FIELD_RULES[field].same(row.cur, p.old_value))) {
      throw new ProposalError(409, 'stale', `The row's ${field} changed since this proposal was made (now ${JSON.stringify(current)}); re-check it or pass force=true`);
    }
    const value = castForColumn(field, p.new_value);
    await tx.run(`UPDATE ${table} SET ${field} = ?, updated_at = NOW() WHERE id = ?`, [value, p.record_id]);
    await tx.run(
      `UPDATE provider_update_proposals SET status = 'applied', decided_by = ?, decided_at = NOW(), decision_note = ?
        WHERE id = ?`, [userId ?? null, note ? String(note).slice(0, 500) : null, pid]);
    await tx.run(
      `UPDATE provider_update_proposals SET status = 'superseded', decided_at = NOW(),
              decision_note = 'superseded: proposal ' || ?::text || ' applied'
        WHERE table_name = ? AND record_id = ? AND field = ? AND status = 'pending' AND id <> ?`,
      [String(pid), table, p.record_id, field, pid]);
    await tx.run(
      `INSERT INTO provider_update_log (table_name, record_id, provider_id, field, old_value, new_value, source, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [table, p.record_id, p.record_id, field, current, p.new_value, `proposal:${pid}:${p.source}`, userId ?? null]);
    await audit(tx, userId ?? null, 'provider_proposal_applied', p,
      { old_value: current, new_value: p.new_value, source: p.source, forced: !!force, note: note || undefined });
    return { id: pid, status: 'applied', table, record_id: Number(p.record_id), field, old_value: current, new_value: p.new_value };
  });
}

export async function rejectProposal(db, id, { userId, note = null } = {}) {
  const pid = parseInt(id, 10);
  if (!Number.isFinite(pid)) throw new ProposalError(400, 'bad_id', 'proposal id must be an integer');
  return await db.transaction(async (tx) => {
    const p = await tx.get('SELECT * FROM provider_update_proposals WHERE id = ? FOR UPDATE', [pid]);
    if (!p) throw new ProposalError(404, 'not_found', 'Proposal not found');
    if (p.status !== 'pending') throw new ProposalError(409, 'not_pending', `Proposal is ${p.status}`);
    await tx.run(
      `UPDATE provider_update_proposals SET status = 'rejected', decided_by = ?, decided_at = NOW(), decision_note = ?
        WHERE id = ?`, [userId ?? null, note ? String(note).slice(0, 500) : null, pid]);
    await audit(tx, userId ?? null, 'provider_proposal_rejected', p, { new_value: p.new_value, source: p.source, note: note || undefined });
    return { id: pid, status: 'rejected', table: p.table_name, record_id: Number(p.record_id), field: p.field };
  });
}

/** Bulk apply / reject: each id in its own transaction; per-id outcome. */
export async function bulkDecide(db, ids, action, opts) {
  if (!Array.isArray(ids) || !ids.length) throw new ProposalError(400, 'no_ids', 'ids must be a non-empty array');
  if (ids.length > MAX_BULK) throw new ProposalError(400, 'too_many', `at most ${MAX_BULK} ids per request`);
  const unique = [...new Set(ids.map(v => parseInt(v, 10)))];
  if (unique.some(n => !Number.isFinite(n))) throw new ProposalError(400, 'bad_id', 'ids must be integers');
  const fn = action === 'apply' ? applyProposal : rejectProposal;
  const results = [];
  for (const id of unique) {
    try { results.push({ ok: true, ...(await fn(db, id, opts)) }); }
    catch (e) {
      if (!(e instanceof ProposalError)) throw e;
      results.push({ ok: false, id, status: e.status, code: e.code, error: e.message });
    }
  }
  return { processed: results.length, succeeded: results.filter(r => r.ok).length, results };
}
