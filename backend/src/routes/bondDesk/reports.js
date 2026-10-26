/**
 * routes/bondDesk/reports.js — dashboard and reports (on screen, or ?format=csv).
 * Sums of whole cents the agent entered; nothing estimated. Mounted at /api/bond-desk.
 */
import { Router } from 'express';
import { BdError, handle, date, sendFile } from './_common.js';
import { bondMoney } from '../../services/bondDesk/money.js';
import { agentToday } from '../../services/bondDesk/core.js';
import { daysBetween } from '../../utils/timezone.js';

const router = Router();
const OPEN = `('active','forfeited')`;
const dollars = (c) => (Number(c) / 100).toFixed(2);

/** RFC 4180 CSV; cells that start with = + - @ are prefixed with ' (spreadsheet formula injection). */
export function toCsv(header, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
const wantsCsv = (req) => req.query.format === 'csv';
const csv = (res, name, header, rows) => sendFile(res, Buffer.from(toCsv(header, rows), 'utf8'), { type: 'text/csv; charset=utf-8', name });

/** Money blocks for many bonds at once. */
async function moneyFor(db, bondIds, today) {
  if (!bondIds.length) return new Map();
  const ph = bondIds.map(() => '?').join(',');
  const [charges, payments, installments, bonds] = await Promise.all([
    db.all(`SELECT bond_id, amount_cents, voided_at FROM bd_charges WHERE bond_id IN (${ph})`, bondIds),
    db.all(`SELECT bond_id, amount_cents, voided_at FROM bd_payments WHERE bond_id IN (${ph})`, bondIds),
    db.all(`SELECT bond_id, id, due_on, amount_cents FROM bd_installments WHERE bond_id IN (${ph})`, bondIds),
    db.all(`SELECT id, plan_charged_cents FROM bd_bonds WHERE id IN (${ph})`, bondIds),
  ]);
  const by = (rows) => { const m = new Map(); for (const r of rows) { const k = Number(r.bond_id); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const c = by(charges); const p = by(payments); const i = by(installments);
  const plan = new Map(bonds.map((b) => [Number(b.id), b.plan_charged_cents]));
  const out = new Map();
  for (const id of bondIds) {
    out.set(id, bondMoney({ charges: c.get(id) || [], payments: p.get(id) || [], installments: i.get(id) || [], planChargedCents: plan.get(id) }, today));
  }
  return out;
}

router.get('/dashboard', handle(async (req, res, db) => {
  const me = req.agentId;
  const today = await agentToday(db, me);
  const [counts, liability, bonds, forfeitures, awaiting, texts] = await Promise.all([
    db.all('SELECT status, COUNT(*)::int AS n FROM bd_bonds WHERE agent_id = ? GROUP BY status', [me]),
    db.get(`SELECT COALESCE(SUM(bond_amount_cents), 0)::bigint AS c FROM bd_bonds WHERE agent_id = ? AND status IN ${OPEN}`, [me]),
    db.all('SELECT id, defendant_name FROM bd_bonds WHERE agent_id = ?', [me]),
    db.all(`SELECT id, defendant_name, forfeiture_deadline_on FROM bd_bonds WHERE agent_id = ? AND status = 'forfeited' ORDER BY forfeiture_deadline_on, id`, [me]),
    db.all(`SELECT p.id, p.bond_id, b.defendant_name, COUNT(s.id) FILTER (WHERE s.status NOT IN ('signed','declined'))::int AS pending
              FROM bd_packets p JOIN bd_bonds b ON b.id = p.bond_id JOIN bd_signers s ON s.packet_id = p.id
             WHERE p.agent_id = ? AND p.status IN ('sent','in_progress') GROUP BY p.id, p.bond_id, b.defendant_name
            HAVING COUNT(s.id) FILTER (WHERE s.status NOT IN ('signed','declined')) > 0 ORDER BY p.id DESC LIMIT 50`, [me]),
    db.get(`SELECT COUNT(*)::int AS n, COALESCE(SUM(cents), 0)::bigint AS c FROM bd_texts WHERE agent_id = ? AND sent_at >= date_trunc('month', NOW())`, [me]),
  ]);
  const m = await moneyFor(db, bonds.map((b) => Number(b.id)), today);
  let receivable = 0; let overdueTotal = 0; const overdue = [];
  for (const b of bonds) {
    const x = m.get(Number(b.id));
    receivable += Math.max(0, x.balance_cents);
    overdueTotal += x.overdue_cents;
    for (const i of x.installments.filter((y) => y.status === 'overdue')) {
      overdue.push({ bond_id: Number(b.id), defendant_name: b.defendant_name, due_on: i.due_on, amount_due_cents: i.amount_cents - i.covered_cents });
    }
  }
  overdue.sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : a.bond_id - b.bond_id));
  const c = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  res.json({
    counts: { prospect: c.prospect || 0, active: c.active || 0, forfeited: c.forfeited || 0 },
    liability_cents: Number(liability.c), receivable_cents: receivable, overdue_cents: overdueTotal,
    overdue: overdue.slice(0, 100),
    forfeitures: forfeitures.map((f) => ({ bond_id: Number(f.id), defendant_name: f.defendant_name, deadline_on: f.forfeiture_deadline_on,
      days_left: f.forfeiture_deadline_on ? daysBetween(today, f.forfeiture_deadline_on) : null })),
    awaiting_signature: awaiting.map((a) => ({ packet_id: Number(a.id), bond_id: Number(a.bond_id), defendant_name: a.defendant_name, pending: a.pending })),
    texts_this_month: { count: texts.n, cents: Number(texts.c) },
    today,
  });
}));

router.get('/reports/liability', handle(async (req, res, db) => {
  const rows = await db.all(
    `SELECT b.id, b.defendant_name, b.case_number, b.status, b.bond_amount_cents, b.posted_on,
            COALESCE(pw.surety_name, b.surety_name, '') AS surety_name, pw.number AS power_number
       FROM bd_bonds b LEFT JOIN bd_powers pw ON pw.bond_id = b.id AND pw.status = 'executed'
      WHERE b.agent_id = ? AND b.status IN ${OPEN} ORDER BY surety_name, b.posted_on, b.id`, [req.agentId]);
  const by = new Map();
  for (const r of rows) {
    const k = r.surety_name || '';
    const x = by.get(k) || { surety_name: k, bonds: 0, amount_cents: 0 };
    x.bonds += 1; x.amount_cents += Number(r.bond_amount_cents);
    by.set(k, x);
  }
  const total = rows.reduce((s, r) => s + Number(r.bond_amount_cents), 0);
  if (wantsCsv(req)) {
    return csv(res, 'liability.csv', ['Surety', 'Power', 'Defendant', 'Case', 'Status', 'Posted', 'Bond amount'],
      rows.map((r) => [r.surety_name, r.power_number, r.defendant_name, r.case_number, r.status, r.posted_on, dollars(r.bond_amount_cents)]));
  }
  res.json({ by_surety: [...by.values()], total_cents: total,
    bonds: rows.map((r) => ({ ...r, id: Number(r.id), bond_amount_cents: Number(r.bond_amount_cents) })) });
}));

function range(req) {
  const from = date(req.query.from, 'from');
  const to = date(req.query.to, 'to');
  if (from && to && to < from) throw new BdError(400, 'bad_date', { field: 'to' });
  return { from, to };
}

router.get('/reports/surety', handle(async (req, res, db) => {
  const { from, to } = range(req);
  const surety = typeof req.query.surety === 'string' && req.query.surety.trim() ? req.query.surety.trim() : null;
  const args = [req.agentId];
  let where = `pw.agent_id = ? AND pw.status = 'executed'`;
  if (surety) { where += ' AND pw.surety_name = ?'; args.push(surety); }
  if (from) { where += ' AND pw.executed_on >= ?'; args.push(from); }
  if (to) { where += ' AND pw.executed_on <= ?'; args.push(to); }
  const rows = await db.all(
    `SELECT pw.surety_name, pw.number AS power_number, pw.executed_on, pw.limit_cents, b.id AS bond_id, b.defendant_name, b.case_number,
            b.bond_amount_cents, b.status,
            COALESCE((SELECT SUM(amount_cents) FROM bd_charges c WHERE c.bond_id = b.id AND c.kind = 'premium' AND c.voided_at IS NULL), 0) AS premium_cents
       FROM bd_powers pw JOIN bd_bonds b ON b.id = pw.bond_id
      WHERE ${where} ORDER BY pw.surety_name, pw.executed_on, pw.number`, args);
  const out = rows.map((r) => ({ surety_name: r.surety_name, power_number: r.power_number, executed_on: r.executed_on, bond_id: Number(r.bond_id),
    defendant_name: r.defendant_name, case_number: r.case_number, bond_amount_cents: Number(r.bond_amount_cents),
    premium_cents: Number(r.premium_cents), status: r.status }));
  const totals = { bonds: out.length, bond_amount_cents: out.reduce((s, r) => s + r.bond_amount_cents, 0), premium_cents: out.reduce((s, r) => s + r.premium_cents, 0) };
  if (wantsCsv(req)) {
    return csv(res, 'surety-report.csv', ['Surety', 'Power', 'Executed', 'Defendant', 'Case', 'Bond amount', 'Premium charged', 'Status'],
      out.map((r) => [r.surety_name, r.power_number, r.executed_on, r.defendant_name, r.case_number, dollars(r.bond_amount_cents), dollars(r.premium_cents), r.status]));
  }
  res.json({ rows: out, totals, from, to, surety });
}));

router.get('/reports/receivables', handle(async (req, res, db) => {
  const today = await agentToday(db, req.agentId);
  const bonds = await db.all('SELECT id, defendant_name, case_number, status FROM bd_bonds WHERE agent_id = ? ORDER BY defendant_name, id', [req.agentId]);
  const m = await moneyFor(db, bonds.map((b) => Number(b.id)), today);
  const rows = bonds.map((b) => ({ b, x: m.get(Number(b.id)) })).filter(({ x }) => x.balance_cents > 0).map(({ b, x }) => ({
    bond_id: Number(b.id), defendant_name: b.defendant_name, case_number: b.case_number, status: b.status,
    charged_cents: x.charged_cents, paid_cents: x.paid_cents, balance_cents: x.balance_cents, overdue_cents: x.overdue_cents,
    next_due_on: x.next_due?.due_on || null, plan_in_sync: x.plan_in_sync,
  }));
  const totals = ['charged_cents', 'paid_cents', 'balance_cents', 'overdue_cents'].reduce((t, k) => ({ ...t, [k]: rows.reduce((s, r) => s + r[k], 0) }), {});
  if (wantsCsv(req)) {
    return csv(res, 'receivables.csv', ['Defendant', 'Case', 'Status', 'Charged', 'Paid', 'Balance', 'Overdue', 'Next due'],
      rows.map((r) => [r.defendant_name, r.case_number, r.status, dollars(r.charged_cents), dollars(r.paid_cents), dollars(r.balance_cents), dollars(r.overdue_cents), r.next_due_on]));
  }
  res.json({ rows, totals, today });
}));

router.get('/reports/receipts', handle(async (req, res, db) => {
  const { from, to } = range(req);
  const args = [req.agentId];
  let where = 'p.agent_id = ?';
  if (from) { where += ' AND p.received_on >= ?'; args.push(from); }
  if (to) { where += ' AND p.received_on <= ?'; args.push(to); }
  const rows = await db.all(
    `SELECT p.id, p.receipt_no, p.received_on, p.amount_cents, p.method, p.reference, p.payer_name, p.voided_at, p.void_reason,
            b.id AS bond_id, b.defendant_name, b.case_number
       FROM bd_payments p JOIN bd_bonds b ON b.id = p.bond_id WHERE ${where} ORDER BY p.received_on, p.receipt_no`, args);
  const out = rows.map((r) => ({ id: Number(r.id), receipt_no: `R-${String(r.receipt_no).padStart(6, '0')}`, received_on: r.received_on,
    amount_cents: Number(r.amount_cents), method: r.method, reference: r.reference, payer_name: r.payer_name, voided: !!r.voided_at,
    void_reason: r.void_reason, bond_id: Number(r.bond_id), defendant_name: r.defendant_name, case_number: r.case_number }));
  const by_method = {};
  for (const r of out) if (!r.voided) by_method[r.method] = (by_method[r.method] || 0) + r.amount_cents;
  const total = Object.values(by_method).reduce((s, v) => s + v, 0);
  if (wantsCsv(req)) {
    return csv(res, 'receipts.csv', ['Receipt', 'Date', 'Payer', 'Defendant', 'Case', 'Method', 'Reference', 'Amount', 'Void'],
      out.map((r) => [r.receipt_no, r.received_on, r.payer_name, r.defendant_name, r.case_number, r.method, r.reference, dollars(r.amount_cents), r.voided ? `VOID: ${r.void_reason}` : '']));
  }
  res.json({ rows: out, by_method: Object.entries(by_method).map(([method, amount_cents]) => ({ method, amount_cents })), total_cents: total, from, to });
}));

router.get('/reports/collateral', handle(async (req, res, db) => {
  const rows = await db.all(
    `SELECT c.id, c.receipt_no, c.kind, c.description, c.value_cents, c.received_from, c.received_on, b.id AS bond_id, b.defendant_name, b.case_number, b.status
       FROM bd_collateral c JOIN bd_bonds b ON b.id = c.bond_id WHERE c.agent_id = ? AND c.returned_on IS NULL ORDER BY c.received_on, c.receipt_no`, [req.agentId]);
  const out = rows.map((r) => ({ id: Number(r.id), receipt_no: `C-${String(r.receipt_no).padStart(6, '0')}`, kind: r.kind, description: r.description,
    value_cents: Number(r.value_cents), received_from: r.received_from, received_on: r.received_on, bond_id: Number(r.bond_id),
    defendant_name: r.defendant_name, case_number: r.case_number, bond_status: r.status }));
  if (wantsCsv(req)) {
    return csv(res, 'collateral-held.csv', ['Receipt', 'Received', 'From', 'Type', 'Description', 'Stated value', 'Defendant', 'Case', 'Bond status'],
      out.map((r) => [r.receipt_no, r.received_on, r.received_from, r.kind, r.description, dollars(r.value_cents), r.defendant_name, r.case_number, r.bond_status]));
  }
  res.json({ rows: out, total_value_cents: out.reduce((s, r) => s + r.value_cents, 0) });
}));

export default router;
