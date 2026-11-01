/**
 * routes/bondDesk/reports.js — dashboard and reports (on screen, or ?format=csv).
 * Sums of whole cents the agent entered; nothing estimated. Mounted at /api/bond-desk.
 */
import { Router } from 'express';
import { BdError, handle, date, sendFile } from './_common.js';
import { agencyFor, agentToday } from '../../services/bondDesk/core.js';
import { rearrestAlertsEnabled } from '../../utils/counselFlags.js';
import { agentRearrests } from '../../services/bondDesk/rearrest.js';
import { TN_REPORT, previousQuarter, quarterRange, tnCsvRows, tnQuarterlyReport, tnReportPdf } from '../../services/bondDesk/tnReport.js';
import { bondMoney } from '../../services/bondDesk/money.js';
import { daysBetween } from '../../utils/timezone.js';
import { bondDeskAppearance } from '../../services/appearanceMetrics.js';
import { PREMIUM_SQL } from '../../services/bondDesk/payments.js';

const router = Router();
const OPEN = `('active','forfeited')`;
export const dollars = (c) => (Number(c) / 100).toFixed(2);

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
export const csv = (res, name, header, rows) => sendFile(res, Buffer.from(toCsv(header, rows), 'utf8'), { type: 'text/csv; charset=utf-8', name });

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
  // missed check-ins (routes/checkins.js, job checkin-missed) of bonds linked to a check-in enrollment
  const missed = await db.all(
    `SELECT m.local_day, m.enrollment_id, b.id AS bond_id, b.defendant_name
       FROM checkin_missed m
       JOIN checkin_enrollments e ON e.id = m.enrollment_id AND e.bondsman_id = ?
       JOIN bd_bonds b ON b.checkin_enrollment_id = m.enrollment_id AND b.agent_id = ?
      WHERE m.local_day >= (?::date - 7) ORDER BY m.local_day DESC, b.id LIMIT 50`, [me, me, today]);
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
    missed_checkins: missed.map((m) => ({ bond_id: Number(m.bond_id), enrollment_id: Number(m.enrollment_id), defendant_name: m.defendant_name, day: m.local_day })),
    // re-arrest matches of the last 30 days (A4; empty while BOND_REARREST_ALERTS_ENABLED is off)
    rearrests: rearrestAlertsEnabled() ? await agentRearrests(db, me) : [],
    today,
  });
}));

// ── Reports: each one → { json, csv: { name, header, rows } } (routes below and the export ZIP) ──

function range(q) {
  const from = date(q.from, 'from');
  const to = date(q.to, 'to');
  if (from && to && to < from) throw new BdError(400, 'bad_date', { field: 'to' });
  return { from, to };
}

async function liabilityReport(db, agentId) {
  const rows = await db.all(
    `SELECT b.id, b.defendant_name, b.case_number, b.status, b.bond_amount_cents, b.posted_on,
            COALESCE(pw.surety_name, b.surety_name, '') AS surety_name, pw.number AS power_number
       FROM bd_bonds b LEFT JOIN bd_powers pw ON pw.bond_id = b.id AND pw.status = 'executed'
      WHERE b.agent_id = ? AND b.status IN ${OPEN} ORDER BY surety_name, b.posted_on, b.id`, [agentId]);
  const by = new Map();
  for (const r of rows) {
    const k = r.surety_name || '';
    const x = by.get(k) || { surety_name: k, bonds: 0, amount_cents: 0 };
    x.bonds += 1; x.amount_cents += Number(r.bond_amount_cents);
    by.set(k, x);
  }
  const total = rows.reduce((s, r) => s + Number(r.bond_amount_cents), 0);
  return {
    json: { by_surety: [...by.values()], total_cents: total, bonds: rows.map((r) => ({ ...r, id: Number(r.id), bond_amount_cents: Number(r.bond_amount_cents) })) },
    csv: { name: 'liability.csv', header: ['Surety', 'Power', 'Defendant', 'Case', 'Status', 'Posted', 'Bond amount'],
      rows: rows.map((r) => [r.surety_name, r.power_number, r.defendant_name, r.case_number, r.status, r.posted_on, dollars(r.bond_amount_cents)]) },
  };
}

async function suretyReport(db, agentId, q = {}) {
  const { from, to } = range(q);
  const surety = typeof q.surety === 'string' && q.surety.trim() ? q.surety.trim() : null;
  const args = [agentId];
  let where = `pw.agent_id = ? AND pw.status = 'executed'`;
  if (surety) { where += ' AND pw.surety_name = ?'; args.push(surety); }
  if (from) { where += ' AND pw.executed_on >= ?'; args.push(from); }
  if (to) { where += ' AND pw.executed_on <= ?'; args.push(to); }
  const rows = await db.all(
    `SELECT pw.surety_name, pw.number AS power_number, pw.executed_on, pw.limit_cents, b.id AS bond_id, b.defendant_name, b.case_number,
            b.bond_amount_cents, b.status,
            ${PREMIUM_SQL} AS premium_cents
       FROM bd_powers pw JOIN bd_bonds b ON b.id = pw.bond_id
      WHERE ${where} ORDER BY pw.surety_name, pw.executed_on, pw.number`, args);
  const out = rows.map((r) => ({ surety_name: r.surety_name, power_number: r.power_number, executed_on: r.executed_on, bond_id: Number(r.bond_id),
    defendant_name: r.defendant_name, case_number: r.case_number, bond_amount_cents: Number(r.bond_amount_cents),
    premium_cents: Number(r.premium_cents), status: r.status }));
  const totals = { bonds: out.length, bond_amount_cents: out.reduce((s, r) => s + r.bond_amount_cents, 0), premium_cents: out.reduce((s, r) => s + r.premium_cents, 0) };
  return {
    json: { rows: out, totals, from, to, surety },
    csv: { name: 'surety-report.csv', header: ['Surety', 'Power', 'Executed', 'Defendant', 'Case', 'Bond amount', 'Premium charged', 'Status'],
      rows: out.map((r) => [r.surety_name, r.power_number, r.executed_on, r.defendant_name, r.case_number, dollars(r.bond_amount_cents), dollars(r.premium_cents), r.status]) },
  };
}

async function receivablesReport(db, agentId) {
  const today = await agentToday(db, agentId);
  const bonds = await db.all('SELECT id, defendant_name, case_number, status FROM bd_bonds WHERE agent_id = ? ORDER BY defendant_name, id', [agentId]);
  const m = await moneyFor(db, bonds.map((b) => Number(b.id)), today);
  const rows = bonds.map((b) => ({ b, x: m.get(Number(b.id)) })).filter(({ x }) => x.balance_cents > 0).map(({ b, x }) => ({
    bond_id: Number(b.id), defendant_name: b.defendant_name, case_number: b.case_number, status: b.status,
    charged_cents: x.charged_cents, paid_cents: x.paid_cents, balance_cents: x.balance_cents, overdue_cents: x.overdue_cents,
    next_due_on: x.next_due?.due_on || null, plan_in_sync: x.plan_in_sync,
  }));
  const totals = ['charged_cents', 'paid_cents', 'balance_cents', 'overdue_cents'].reduce((t, k) => ({ ...t, [k]: rows.reduce((s, r) => s + r[k], 0) }), {});
  return {
    json: { rows, totals, today },
    csv: { name: 'receivables.csv', header: ['Defendant', 'Case', 'Status', 'Charged', 'Paid', 'Balance', 'Overdue', 'Next due'],
      rows: rows.map((r) => [r.defendant_name, r.case_number, r.status, dollars(r.charged_cents), dollars(r.paid_cents), dollars(r.balance_cents), dollars(r.overdue_cents), r.next_due_on]) },
  };
}

async function receiptsReport(db, agentId, q = {}) {
  const { from, to } = range(q);
  const args = [agentId];
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
  const byMethod = {};
  for (const r of out) if (!r.voided) byMethod[r.method] = (byMethod[r.method] || 0) + r.amount_cents;
  const total = Object.values(byMethod).reduce((s, v) => s + v, 0);
  return {
    json: { rows: out, by_method: Object.entries(byMethod).map(([method, amount_cents]) => ({ method, amount_cents })), total_cents: total, from, to },
    csv: { name: 'receipts.csv', header: ['Receipt', 'Date', 'Payer', 'Defendant', 'Case', 'Method', 'Reference', 'Amount', 'Void'],
      rows: out.map((r) => [r.receipt_no, r.received_on, r.payer_name, r.defendant_name, r.case_number, r.method, r.reference, dollars(r.amount_cents), r.voided ? `VOID: ${r.void_reason}` : '']) },
  };
}

async function collateralReport(db, agentId) {
  const rows = await db.all(
    `SELECT c.id, c.receipt_no, c.kind, c.description, c.value_cents, c.received_from, c.received_on, b.id AS bond_id, b.defendant_name, b.case_number, b.status
       FROM bd_collateral c JOIN bd_bonds b ON b.id = c.bond_id WHERE c.agent_id = ? AND c.returned_on IS NULL ORDER BY c.received_on, c.receipt_no`, [agentId]);
  const out = rows.map((r) => ({ id: Number(r.id), receipt_no: `C-${String(r.receipt_no).padStart(6, '0')}`, kind: r.kind, description: r.description,
    value_cents: Number(r.value_cents), received_from: r.received_from, received_on: r.received_on, bond_id: Number(r.bond_id),
    defendant_name: r.defendant_name, case_number: r.case_number, bond_status: r.status }));
  return {
    json: { rows: out, total_value_cents: out.reduce((s, r) => s + r.value_cents, 0) },
    csv: { name: 'collateral-held.csv', header: ['Receipt', 'Received', 'From', 'Type', 'Description', 'Stated value', 'Defendant', 'Case', 'Bond status'],
      rows: out.map((r) => [r.receipt_no, r.received_on, r.received_from, r.kind, r.description, dollars(r.value_cents), r.defendant_name, r.case_number, r.bond_status]) },
  };
}

// "Did you make it to court?" for the agent's own bonds: per county and month of the hearing.
async function appearanceReport(db, agentId, q = {}) {
  const { from, to } = range(q);
  const rows = await bondDeskAppearance(db, { agentId, from: from ? from.slice(0, 7) : null, to: to ? to.slice(0, 7) : null });
  const totals = ['asked', 'attended', 'rescheduled', 'missed', 'no_answer'].reduce((t, k) => ({ ...t, [k]: rows.reduce((s, r) => s + r[k], 0) }), {});
  return {
    json: { rows: rows.map((r) => ({ region: r.region, month: r.month, asked: r.asked, attended: r.attended, rescheduled: r.rescheduled, missed: r.missed, no_answer: r.no_answer })), totals, from, to },
    csv: { name: 'court-appearance.csv', header: ['County / state', 'Month', 'Asked', 'Attended', 'Rescheduled', 'Missed', 'No answer'],
      rows: rows.map((r) => [r.region, r.month, r.asked, r.attended, r.rescheduled, r.missed, r.no_answer]) },
  };
}

/** Every report (the export ZIP writes each one's CSV, whole history). */
export const REPORTS = Object.freeze({
  liability: liabilityReport, surety: suretyReport, receivables: receivablesReport,
  receipts: receiptsReport, collateral: collateralReport, appearance: appearanceReport,
});

const report = (fn) => handle(async (req, res, db) => {
  const r = await fn(db, req.agentId, req.query);
  if (wantsCsv(req)) return csv(res, r.csv.name, r.csv.header, r.csv.rows);
  res.json(r.json);
});
router.get('/reports/liability', report(liabilityReport));
router.get('/reports/surety', report(suretyReport));
router.get('/reports/receivables', report(receivablesReport));
router.get('/reports/receipts', report(receiptsReport));
router.get('/reports/collateral', report(collateralReport));
router.get('/reports/appearance', report(appearanceReport));

// Tennessee quarterly report to the Department of Revenue (B5; services/bondDesk/tnReport.js has
// the law, the sources and the date they were checked). ?quarter=YYYY-Qn (default: the last full
// quarter) &format=csv|pdf.
router.get('/reports/tn-quarterly', handle(async (req, res, db) => {
  const today = await agentToday(db, req.agentId);
  const q = typeof req.query.quarter === 'string' && req.query.quarter ? req.query.quarter : previousQuarter(today);
  const range = quarterRange(q);
  if (!range) throw new BdError(400, 'invalid', { field: 'quarter' });
  if (range.from > today) throw new BdError(400, 'future_date', { field: 'quarter' });
  const r = await tnQuarterlyReport(db, req.agentId, range);
  const name = `tennessee-quarterly-${range.quarter}`;
  if (wantsCsv(req) || req.query.format === 'pdf') {
    const agency = await agencyFor(db, req.agentId);
    if (req.query.format === 'pdf') return sendFile(res, await tnReportPdf(r, agency), { type: 'application/pdf', name: `${name}.pdf` });
    const rows = tnCsvRows(r, agency);
    return csv(res, `${name}.csv`, rows[0], rows.slice(1));
  }
  res.json({ ...r, source_url: TN_REPORT.sources[0] });
}));

export default router;
