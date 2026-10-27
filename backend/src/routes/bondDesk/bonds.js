/**
 * routes/bondDesk/bonds.js — bonds, indemnitors, the ledger (charges, payments, payment plan,
 * receipts), collateral, powers and texts. Mounted at /api/bond-desk (docs/BOND_DESK.md).
 * Every row is the calling agent's own (agent_id = req.agentId).
 */
import { Router } from 'express';
import { BdError, handle, id, text, date, cents, phone, email, oneOf, sendFile, body } from './_common.js';
import { bondMoney, planError, money, usDate, liveTotal } from '../../services/bondDesk/money.js';
import { agencyFor, agentToday, sendAgentText, sendAgentEmail, reminderMessage } from '../../services/bondDesk/core.js';
import { postPayment, PAYMENT_COLS, publicPayment, paymentReceiptPdf, collateralReceiptPdf } from '../../services/bondDesk/payments.js';
import { normalizeLang } from '../../i18n/index.js';
import logger from '../../utils/logger.js';
import { planBond, syncBondCourtDate, mirrorBondFormCourtDate } from '../../services/bondDesk/courtDates.js';
import { syncSharesWithStatus } from '../../services/bondDesk/recoveryShares.js';

const router = Router();

export const BOND_STATUSES = ['prospect', 'active', 'forfeited', 'exonerated', 'surrendered', 'forfeiture_paid', 'cancelled'];
const MOVES = {
  prospect: ['active', 'cancelled'],
  active: ['forfeited', 'exonerated', 'surrendered'],
  forfeited: ['active', 'exonerated', 'surrendered', 'forfeiture_paid'],
};
const FINAL = ['exonerated', 'surrendered', 'forfeiture_paid', 'cancelled'];
const METHODS = ['cash', 'check', 'card', 'money_order', 'bank_transfer', 'other'];
const COLLATERAL_KINDS = ['cash', 'real_estate', 'vehicle', 'jewelry', 'other'];

const BOND_COLS = `b.id, b.status, b.defendant_name, b.defendant_dob, b.defendant_phone, b.defendant_email, b.defendant_address,
  b.case_number, b.court_name, b.county, b.state, b.court_date, b.charges, b.bond_amount_cents, b.surety_name, b.posted_on,
  b.forfeited_on, b.forfeiture_deadline_on, b.discharged_on, b.forfeiture_paid_cents, b.checkin_enrollment_id, b.notes,
  b.plan_charged_cents, b.created_at, b.updated_at`;

const receiptNo = (series, n) => `${series}-${String(n).padStart(6, '0')}`;

/** The agent's bond (with its executed power), or 404. `lock` → SELECT … FOR UPDATE (inside a transaction). */
export async function loadBond(db, agentId, bondId, { lock = false } = {}) {
  const b = await db.get(`SELECT ${BOND_COLS} FROM bd_bonds b WHERE b.id = ? AND b.agent_id = ? ${lock ? 'FOR UPDATE' : ''}`, [bondId, agentId]);
  if (!b) throw new BdError(404, 'not_found');
  const p = await db.get(`SELECT id, surety_name, number, limit_cents FROM bd_powers WHERE bond_id = ? AND status = 'executed'`, [b.id]);
  return publicBond(b, p);
}

function publicBond(b, p) {
  const out = { ...b, id: Number(b.id), bond_amount_cents: Number(b.bond_amount_cents),
    forfeiture_paid_cents: b.forfeiture_paid_cents == null ? null : Number(b.forfeiture_paid_cents),
    checkin_enrollment_id: b.checkin_enrollment_id == null ? null : Number(b.checkin_enrollment_id),
    power: p ? { id: Number(p.id), surety_name: p.surety_name, number: p.number, limit_cents: Number(p.limit_cents) } : null };
  delete out.plan_charged_cents;
  return out;
}

/** charges, payments, installments and the money block for a bond. */
export async function ledger(db, bondId, today, planChargedCents) {
  const [charges, payments, installments] = await Promise.all([
    db.all('SELECT id, kind, amount_cents, description, created_at, voided_at, void_reason FROM bd_charges WHERE bond_id = ? ORDER BY id', [bondId]),
    db.all(`SELECT ${PAYMENT_COLS} FROM bd_payments WHERE bond_id = ? ORDER BY id`, [bondId]),
    db.all('SELECT id, due_on, amount_cents FROM bd_installments WHERE bond_id = ? ORDER BY due_on, id', [bondId]),
  ]);
  const m = bondMoney({ charges, payments, installments, planChargedCents }, today);
  return {
    charges: charges.map((c) => ({ ...c, id: Number(c.id), amount_cents: Number(c.amount_cents) })),
    payments: payments.map(publicPayment),
    installments: m.installments,
    money: { charged_cents: m.charged_cents, paid_cents: m.paid_cents, balance_cents: m.balance_cents,
      plan_scheduled_cents: m.plan_scheduled_cents, plan_in_sync: m.plan_in_sync, overdue_cents: m.overdue_cents, next_due: m.next_due },
  };
}

// ── Bond fields ───────────────────────────────────────────────────────────────

async function bondFields(db, agentId, b, { partial }) {
  const f = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const want = (k) => !partial || has(k);
  if (want('defendant_name')) f.defendant_name = text(b.defendant_name, 160, 'defendant_name', { required: true });
  if (want('defendant_dob')) f.defendant_dob = date(b.defendant_dob, 'defendant_dob');
  if (want('defendant_phone')) f.defendant_phone = phone(b.defendant_phone, 'defendant_phone');
  if (want('defendant_email')) f.defendant_email = email(b.defendant_email, 'defendant_email');
  if (want('defendant_address')) f.defendant_address = text(b.defendant_address, 300, 'defendant_address');
  if (want('case_number')) f.case_number = text(b.case_number, 80, 'case_number');
  if (want('court_name')) f.court_name = text(b.court_name, 160, 'court_name');
  if (want('county')) f.county = text(b.county, 80, 'county');
  if (want('state')) {
    const s = text(b.state, 2, 'state');
    if (s && !/^[A-Za-z]{2}$/.test(s)) throw new BdError(400, 'invalid', { field: 'state' });
    f.state = s ? s.toUpperCase() : null;
  }
  if (want('court_date')) f.court_date = date(b.court_date, 'court_date');
  if (want('charges')) f.charges = text(b.charges, 1000, 'charges');
  if (want('bond_amount_cents')) f.bond_amount_cents = cents(b.bond_amount_cents, 'bond_amount_cents');
  if (want('surety_name')) f.surety_name = text(b.surety_name, 120, 'surety_name');
  if (want('notes')) f.notes = text(b.notes, 4000, 'notes');
  if (want('checkin_enrollment_id')) {
    if (b.checkin_enrollment_id == null || b.checkin_enrollment_id === '') f.checkin_enrollment_id = null;
    else {
      const eid = Number.parseInt(String(b.checkin_enrollment_id), 10);
      const e = Number.isSafeInteger(eid) ? await db.get('SELECT id FROM checkin_enrollments WHERE id = ? AND bondsman_id = ?', [eid, agentId]) : null;
      if (!e) throw new BdError(400, 'invalid', { field: 'checkin_enrollment_id' });
      f.checkin_enrollment_id = eid;
    }
  }
  return f;
}

// ── Bonds ─────────────────────────────────────────────────────────────────────

router.get('/bonds', handle(async (req, res, db) => {
  const status = BOND_STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const args = [req.agentId];
  let where = 'b.agent_id = ?';
  if (status) { where += ' AND b.status = ?'; args.push(status); }
  if (q) { where += ` AND (b.defendant_name ILIKE ? OR COALESCE(b.case_number, '') ILIKE ?)`; const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; args.push(like, like); }
  const rows = await db.all(
    `SELECT ${BOND_COLS},
            COALESCE((SELECT SUM(amount_cents) FROM bd_charges c WHERE c.bond_id = b.id AND c.voided_at IS NULL), 0)
          - COALESCE((SELECT SUM(amount_cents) FROM bd_payments p WHERE p.bond_id = b.id AND p.voided_at IS NULL), 0) AS balance_cents,
            (SELECT status FROM bd_packets k WHERE k.bond_id = b.id ORDER BY k.id DESC LIMIT 1) AS packet_status,
            pw.id AS pw_id, pw.surety_name AS pw_surety, pw.number AS pw_number, pw.limit_cents AS pw_limit
       FROM bd_bonds b LEFT JOIN bd_powers pw ON pw.bond_id = b.id AND pw.status = 'executed'
      WHERE ${where} ORDER BY b.updated_at DESC, b.id DESC LIMIT 500`, args);
  res.json({ bonds: rows.map((r) => ({
    ...publicBond(r, r.pw_id ? { id: r.pw_id, surety_name: r.pw_surety, number: r.pw_number, limit_cents: r.pw_limit } : null),
    balance_cents: Number(r.balance_cents), packet_status: r.packet_status || null,
    pw_id: undefined, pw_surety: undefined, pw_number: undefined, pw_limit: undefined, balance: undefined,
  })) });
}));

router.post('/bonds', handle(async (req, res, db) => {
  const f = await bondFields(db, req.agentId, body(req), { partial: false });
  const cols = Object.keys(f);
  const row = await db.get(
    `INSERT INTO bd_bonds (agent_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')}) RETURNING id`,
    [req.agentId, ...cols.map((c) => f[c])]);
  // the form's court date becomes the bond's first hearing (routes/bondDesk/courtDates.js)
  if (f.court_date) {
    await mirrorBondFormCourtDate(db, { bondId: Number(row.id), oldDate: null, newDate: f.court_date, courtName: f.court_name });
    await syncBondCourtDate(db, Number(row.id));
  }
  res.status(201).json({ bond: await loadBond(db, req.agentId, Number(row.id)) });
}));

router.get('/bonds/:id', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const raw = await db.get('SELECT plan_charged_cents FROM bd_bonds WHERE id = ?', [bond.id]);
  const today = await agentToday(db, req.agentId);
  const [l, indemnitors, collateral, packets] = await Promise.all([
    ledger(db, bond.id, today, raw.plan_charged_cents),
    db.all('SELECT id, bond_id, full_name, relationship, phone, email, address, dob, employer, created_at FROM bd_indemnitors WHERE bond_id = ? ORDER BY id', [bond.id]),
    db.all(`SELECT id, receipt_no, kind, description, value_cents, received_from, received_on, returned_on, returned_to, created_at
              FROM bd_collateral WHERE bond_id = ? ORDER BY id`, [bond.id]),
    db.all('SELECT id, status, created_at, completed_at, voided_at FROM bd_packets WHERE bond_id = ? ORDER BY id DESC', [bond.id]),
  ]);
  const signers = packets.length
    ? await db.all(`SELECT packet_id, id, name, role, status FROM bd_signers WHERE packet_id IN (${packets.map(() => '?').join(',')}) ORDER BY id`, packets.map((p) => p.id))
    : [];
  res.json({
    bond,
    indemnitors: indemnitors.map((i) => ({ ...i, id: Number(i.id), bond_id: Number(i.bond_id) })),
    charges: l.charges, payments: l.payments, installments: l.installments, money: l.money,
    collateral: collateral.map((c) => ({ ...c, id: Number(c.id), receipt_no: receiptNo('C', c.receipt_no), value_cents: Number(c.value_cents) })),
    packets: packets.map((p) => ({ ...p, id: Number(p.id),
      signers: signers.filter((s) => Number(s.packet_id) === Number(p.id)).map((s) => ({ id: Number(s.id), name: s.name, role: s.role, status: s.status })) })),
  });
}));

router.patch('/bonds/:id', handle(async (req, res, db) => {
  const bondId = id(req.params.id);
  const f = await bondFields(db, req.agentId, body(req), { partial: true });
  const before = await db.transaction(async (tx) => {
    const bond = await loadBond(tx, req.agentId, bondId, { lock: true });
    if (f.bond_amount_cents && bond.power && f.bond_amount_cents > bond.power.limit_cents) throw new BdError(409, 'power_limit');
    const cols = Object.keys(f);
    if (!cols.length) return bond;
    await tx.run(`UPDATE bd_bonds SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = NOW() WHERE id = ? AND agent_id = ?`,
      [...cols.map((c) => f[c]), bondId, req.agentId]);
    return bond;
  });
  // the form's single court date moves / adds a hearing; texts follow the number, place and zone
  if (Object.keys(f).length) {
    if (f.court_date) await mirrorBondFormCourtDate(db, { bondId, oldDate: before.court_date, newDate: f.court_date, courtName: f.court_name ?? before.court_name });
    if (['court_date', 'defendant_phone', 'state', 'county'].some((k) => k in f)) await planBond(db, bondId);
    await syncBondCourtDate(db, bondId);
  }
  res.json({ bond: await loadBond(db, req.agentId, bondId) });
}));

router.post('/bonds/:id/status', handle(async (req, res, db) => {
  const bondId = id(req.params.id);
  const b = body(req);
  const to = oneOf(b.status, BOND_STATUSES, 'status');
  const today = await agentToday(db, req.agentId);
  await db.transaction(async (tx) => {
    const bond = await loadBond(tx, req.agentId, bondId, { lock: true });
    if (!(MOVES[bond.status] || []).includes(to)) throw new BdError(409, 'bad_transition', { from: bond.status, to });
    const set = { status: to };
    const d = to === 'cancelled' ? null : date(b.date, 'date', { required: true });
    if (d && d > today) throw new BdError(400, 'future_date', { field: 'date' });
    if (to === 'active' && bond.status === 'prospect') set.posted_on = d;
    if (to === 'active' && bond.status === 'forfeited') { set.forfeited_on = null; set.forfeiture_deadline_on = null; }   // reinstated
    if (to === 'forfeited') {
      set.forfeited_on = d;
      set.forfeiture_deadline_on = date(b.deadline_on, 'deadline_on', { required: true });
      if (set.forfeiture_deadline_on < d) throw new BdError(400, 'bad_date', { field: 'deadline_on' });
    }
    if (to === 'exonerated' || to === 'surrendered' || to === 'forfeiture_paid') set.discharged_on = d;
    if (to === 'forfeiture_paid') set.forfeiture_paid_cents = cents(b.amount_cents, 'amount_cents');
    if (to === 'cancelled' && bond.power) throw new BdError(409, 'void_power_first');
    const note = text(b.note, 500, 'note');
    if (note) {
      const raw = await tx.get('SELECT notes FROM bd_bonds WHERE id = ?', [bondId]);
      set.notes = `${raw.notes ? `${raw.notes}\n` : ''}${today} — ${bond.status} → ${to}: ${note}`.slice(-4000);
    }
    const cols = Object.keys(set);
    await tx.run(`UPDATE bd_bonds SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = NOW() WHERE id = ?`, [...cols.map((c) => set[c]), bondId]);
    // a power assigned while the bond was a prospect is executed the day the bond is posted
    if (set.posted_on) await tx.run(`UPDATE bd_powers SET executed_on = ? WHERE bond_id = ? AND status = 'executed'`, [set.posted_on, bondId]);
  });
  await planBond(db, bondId);   // court texts start when the bond is posted, stop when it is closed or forfeited
  await syncSharesWithStatus(db, bondId, to);   // a recovery agent's access ends when the bond is no longer forfeited
  res.json({ bond: await loadBond(db, req.agentId, bondId) });
}));

router.post('/bonds/:id/power', handle(async (req, res, db) => {
  const bondId = id(req.params.id);
  const powerId = id(body(req).power_id);
  const today = await agentToday(db, req.agentId);
  await db.transaction(async (tx) => {
    const bond = await loadBond(tx, req.agentId, bondId, { lock: true });
    if (FINAL.includes(bond.status)) throw new BdError(409, 'bond_closed');
    if (bond.power) throw new BdError(409, 'bond_has_power');
    const p = await tx.get('SELECT id, status, limit_cents, expires_on FROM bd_powers WHERE id = ? AND agent_id = ? FOR UPDATE', [powerId, req.agentId]);
    if (!p || p.status !== 'available') throw new BdError(409, 'power_unavailable');
    if (p.expires_on && p.expires_on < today) throw new BdError(409, 'power_expired');
    if (Number(p.limit_cents) < bond.bond_amount_cents) throw new BdError(409, 'power_limit');
    await tx.run(`UPDATE bd_powers SET status = 'executed', bond_id = ?, executed_on = ? WHERE id = ?`, [bondId, bond.posted_on || today, powerId]);
    await tx.run('UPDATE bd_bonds SET updated_at = NOW() WHERE id = ?', [bondId]);
  });
  res.json({ bond: await loadBond(db, req.agentId, bondId) });
}));

// ── Indemnitors ───────────────────────────────────────────────────────────────

function indemnitorFields(b, { partial }) {
  const f = {};
  const want = (k) => !partial || Object.prototype.hasOwnProperty.call(b, k);
  if (want('full_name')) f.full_name = text(b.full_name, 160, 'full_name', { required: true });
  if (want('relationship')) f.relationship = text(b.relationship, 80, 'relationship');
  if (want('phone')) f.phone = phone(b.phone, 'phone');
  if (want('email')) f.email = email(b.email, 'email');
  if (want('address')) f.address = text(b.address, 300, 'address');
  if (want('dob')) f.dob = date(b.dob, 'dob');
  if (want('employer')) f.employer = text(b.employer, 160, 'employer');
  return f;
}
const IND_COLS = 'id, bond_id, full_name, relationship, phone, email, address, dob, employer, created_at';
const pubInd = (i) => ({ ...i, id: Number(i.id), bond_id: Number(i.bond_id) });

async function loadIndemnitor(db, agentId, indId) {
  const i = await db.get(`SELECT i.id, i.bond_id FROM bd_indemnitors i JOIN bd_bonds b ON b.id = i.bond_id WHERE i.id = ? AND b.agent_id = ?`, [indId, agentId]);
  if (!i) throw new BdError(404, 'not_found');
  return i;
}

router.post('/bonds/:id/indemnitors', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const f = indemnitorFields(body(req), { partial: false });
  const n = await db.get('SELECT COUNT(*)::int AS n FROM bd_indemnitors WHERE bond_id = ?', [bond.id]);
  if (n.n >= 10) throw new BdError(409, 'too_many');
  const cols = Object.keys(f);
  const row = await db.get(`INSERT INTO bd_indemnitors (bond_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')}) RETURNING ${IND_COLS}`,
    [bond.id, ...cols.map((c) => f[c])]);
  res.status(201).json({ indemnitor: pubInd(row) });
}));

router.patch('/indemnitors/:id', handle(async (req, res, db) => {
  const i = await loadIndemnitor(db, req.agentId, id(req.params.id));
  const f = indemnitorFields(body(req), { partial: true });
  const cols = Object.keys(f);
  if (cols.length) await db.run(`UPDATE bd_indemnitors SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => f[c]), i.id]);
  if ('phone' in f) await planBond(db, Number(i.bond_id));   // a new number needs a new confirmation
  const row = await db.get(`SELECT ${IND_COLS} FROM bd_indemnitors WHERE id = ?`, [i.id]);
  res.json({ indemnitor: pubInd(row) });
}));

router.delete('/indemnitors/:id', handle(async (req, res, db) => {
  const i = await loadIndemnitor(db, req.agentId, id(req.params.id));
  const used = await db.get('SELECT 1 FROM bd_signers WHERE indemnitor_id = ? LIMIT 1', [i.id]);
  if (used) throw new BdError(409, 'on_packet');
  await db.run('DELETE FROM bd_indemnitors WHERE id = ?', [i.id]);
  await planBond(db, Number(i.bond_id));
  res.json({ ok: true });
}));

// ── Charges ───────────────────────────────────────────────────────────────────

router.post('/bonds/:id/charges', handle(async (req, res, db) => {
  const b = body(req);
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const kind = oneOf(b.kind, ['premium', 'fee'], 'kind');
  const amount = cents(b.amount_cents, 'amount_cents');
  const description = text(b.description, 200, 'description');
  const row = await db.get(
    `INSERT INTO bd_charges (bond_id, kind, amount_cents, description, created_by) VALUES (?, ?, ?, ?, ?)
     RETURNING id, kind, amount_cents, description, created_at, voided_at, void_reason`,
    [bond.id, kind, amount, description, req.user.id]);
  await db.run('UPDATE bd_bonds SET updated_at = NOW() WHERE id = ?', [bond.id]);
  res.status(201).json({ charge: { ...row, id: Number(row.id), amount_cents: Number(row.amount_cents) } });
}));

router.post('/charges/:id/void', handle(async (req, res, db) => {
  const chargeId = id(req.params.id);
  const reason = text(body(req).reason, 300, 'reason', { required: true });
  await db.transaction(async (tx) => {
    const c = await tx.get(`SELECT c.id, c.bond_id, c.amount_cents, c.voided_at FROM bd_charges c JOIN bd_bonds b ON b.id = c.bond_id
                             WHERE c.id = ? AND b.agent_id = ?`, [chargeId, req.agentId]);
    if (!c) throw new BdError(404, 'not_found');
    await loadBond(tx, req.agentId, Number(c.bond_id), { lock: true });
    const cur = await tx.get('SELECT voided_at FROM bd_charges WHERE id = ?', [chargeId]);   // re-read under the bond lock
    if (cur.voided_at) throw new BdError(409, 'already_void');
    const charges = await tx.all('SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ?', [c.bond_id]);
    const payments = await tx.all('SELECT amount_cents, voided_at FROM bd_payments WHERE bond_id = ?', [c.bond_id]);
    if (liveTotal(charges) - Number(c.amount_cents) < liveTotal(payments)) throw new BdError(409, 'would_go_negative');
    await tx.run('UPDATE bd_charges SET voided_at = NOW(), void_reason = ? WHERE id = ?', [reason, chargeId]);
    await tx.run('UPDATE bd_bonds SET updated_at = NOW() WHERE id = ?', [c.bond_id]);
  });
  res.json({ ok: true });
}));

// ── Payments ──────────────────────────────────────────────────────────────────

router.post('/bonds/:id/payments', handle(async (req, res, db) => {
  const bondId = id(req.params.id);
  const b = body(req);
  const amount = cents(b.amount_cents, 'amount_cents');
  const method = oneOf(b.method, METHODS, 'method');
  const payer = text(b.payer_name, 160, 'payer_name', { required: true });
  const reference = text(b.reference, 120, 'reference');
  const today = await agentToday(db, req.agentId);
  const receivedOn = date(b.received_on, 'received_on') || today;
  if (receivedOn > today) throw new BdError(400, 'future_date', { field: 'received_on' });
  await loadBond(db, req.agentId, bondId);
  // the same posting every card payment uses (services/bondDesk/payments.js): receipt number, balance check
  const { payment } = await db.transaction((tx) => postPayment(tx, {
    agentId: req.agentId, bondId, amountCents: amount, method, payerName: payer, reference, receivedOn, createdBy: req.user.id,
  }));
  res.status(201).json({ payment });
}));

router.post('/payments/:id/void', handle(async (req, res, db) => {
  const pid = id(req.params.id);
  const reason = text(body(req).reason, 300, 'reason', { required: true });
  const r = await db.run(
    `UPDATE bd_payments SET voided_at = NOW(), void_reason = ? WHERE id = ? AND agent_id = ? AND voided_at IS NULL`, [reason, pid, req.agentId]);
  if (!r.changes) {
    const p = await db.get('SELECT voided_at FROM bd_payments WHERE id = ? AND agent_id = ?', [pid, req.agentId]);
    throw p ? new BdError(409, 'already_void') : new BdError(404, 'not_found');
  }
  res.json({ ok: true });
}));

router.get('/payments/:id/receipt.pdf', handle(async (req, res, db) => {
  const p = await db.get('SELECT id, receipt_no FROM bd_payments WHERE id = ? AND agent_id = ?', [id(req.params.id), req.agentId]);
  if (!p) throw new BdError(404, 'not_found');
  sendFile(res, await paymentReceiptPdf(db, req.agentId, Number(p.id)), { type: 'application/pdf', name: `receipt-${receiptNo('R', p.receipt_no)}.pdf` });
}));

// ── Payment plan ──────────────────────────────────────────────────────────────

router.put('/bonds/:id/plan', handle(async (req, res, db) => {
  const bondId = id(req.params.id);
  const list = body(req).installments;
  await db.transaction(async (tx) => {
    await loadBond(tx, req.agentId, bondId, { lock: true });
    const charges = await tx.all('SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ?', [bondId]);
    const charged = liveTotal(charges);
    const err = planError(list, charged);
    if (err) throw new BdError(err === 'plan_total' ? 409 : 400, err, err === 'plan_total' ? { charged_cents: charged } : {});
    await tx.run('DELETE FROM bd_installments WHERE bond_id = ?', [bondId]);
    for (const i of list) await tx.run('INSERT INTO bd_installments (bond_id, due_on, amount_cents) VALUES (?, ?, ?)', [bondId, i.due_on, Number(i.amount_cents)]);
    await tx.run('UPDATE bd_bonds SET plan_charged_cents = ?, updated_at = NOW() WHERE id = ?', [list.length ? charged : null, bondId]);
  });
  const today = await agentToday(db, req.agentId);
  const raw = await db.get('SELECT plan_charged_cents FROM bd_bonds WHERE id = ?', [bondId]);
  const l = await ledger(db, bondId, today, raw.plan_charged_cents);
  res.json({ installments: l.installments, money: l.money });
}));

router.post('/bonds/:id/remind', handle(async (req, res, db) => {
  const b = body(req);
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const to = oneOf(b.to, ['defendant', 'indemnitor'], 'to');
  const channel = oneOf(b.channel, ['sms', 'email'], 'channel');
  if (channel === 'sms' && b.consent_confirmed !== true) throw new BdError(400, 'consent_required');
  let person = { phone: bond.defendant_phone, email: bond.defendant_email };
  if (to === 'indemnitor') {
    const i = await db.get('SELECT phone, email FROM bd_indemnitors WHERE id = ? AND bond_id = ?', [id(b.indemnitor_id), bond.id]);
    if (!i) throw new BdError(404, 'not_found');
    person = i;
  }
  const today = await agentToday(db, req.agentId);
  const raw = await db.get('SELECT plan_charged_cents FROM bd_bonds WHERE id = ?', [bond.id]);
  const l = await ledger(db, bond.id, today, raw.plan_charged_cents);
  if (l.money.balance_cents <= 0) throw new BdError(409, 'nothing_owed');
  const a = await agencyFor(db, req.agentId);
  const next = l.money.next_due;
  const lang = normalizeLang(b.lang) || 'en';
  const m = reminderMessage(lang, {
    agency: a.agency, defendant: bond.defendant_name, phone: a.phone,
    amount: money(next ? next.amount_cents - next.covered_cents : l.money.balance_cents),
    date: next ? usDate(next.due_on) : null, balance: money(l.money.balance_cents),
  });
  const status = channel === 'sms'
    ? (person.phone ? await sendAgentText(db, { agentId: req.agentId, bondId: bond.id, purpose: 'payment_reminder', to: person.phone, body: m.sms }) : 'skipped')
    : await sendAgentEmail({ to: person.email, subject: m.subject, text: m.email });
  if (status === 'opted_out') throw new BdError(409, 'opted_out');
  if (status !== 'sent') logger.info({ status, channel }, '[bond-desk] payment reminder not sent');
  res.json({ status });
}));

// ── Collateral ────────────────────────────────────────────────────────────────

router.post('/bonds/:id/collateral', handle(async (req, res, db) => {
  const bondId = id(req.params.id);
  const b = body(req);
  const kind = oneOf(b.kind, COLLATERAL_KINDS, 'kind');
  const description = text(b.description, 500, 'description', { required: true });
  const value = cents(b.value_cents, 'value_cents', { min: 0, required: false }) ?? 0;
  const from = text(b.received_from, 160, 'received_from', { required: true });
  const today = await agentToday(db, req.agentId);
  const on = date(b.received_on, 'received_on') || today;
  if (on > today) throw new BdError(400, 'future_date', { field: 'received_on' });
  const row = await db.transaction(async (tx) => {
    await loadBond(tx, req.agentId, bondId, { lock: true });
    const n = await tx.get(
      `INSERT INTO bd_counters (agent_id, series, last_no) VALUES (?, 'C', 1)
       ON CONFLICT (agent_id, series) DO UPDATE SET last_no = bd_counters.last_no + 1 RETURNING last_no`, [req.agentId]);
    return await tx.get(
      `INSERT INTO bd_collateral (bond_id, agent_id, receipt_no, kind, description, value_cents, received_from, received_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, receipt_no, kind, description, value_cents, received_from, received_on, returned_on, returned_to, created_at`,
      [bondId, req.agentId, Number(n.last_no), kind, description, value, from, on]);
  });
  res.status(201).json({ collateral: { ...row, id: Number(row.id), receipt_no: receiptNo('C', row.receipt_no), value_cents: Number(row.value_cents) } });
}));

router.post('/collateral/:id/return', handle(async (req, res, db) => {
  const cid = id(req.params.id);
  const b = body(req);
  const to = text(b.returned_to, 160, 'returned_to', { required: true });
  const today = await agentToday(db, req.agentId);
  const on = date(b.returned_on, 'returned_on') || today;
  if (on > today) throw new BdError(400, 'future_date', { field: 'returned_on' });
  const c = await db.get('SELECT received_on, returned_on FROM bd_collateral WHERE id = ? AND agent_id = ?', [cid, req.agentId]);
  if (!c) throw new BdError(404, 'not_found');
  if (c.returned_on) throw new BdError(409, 'already_returned');
  if (on < c.received_on) throw new BdError(400, 'bad_date', { field: 'returned_on' });
  await db.run('UPDATE bd_collateral SET returned_on = ?, returned_to = ? WHERE id = ? AND returned_on IS NULL', [on, to, cid]);
  res.json({ ok: true });
}));

router.get('/collateral/:id/receipt.pdf', handle(async (req, res, db) => {
  const c = await db.get('SELECT id, receipt_no FROM bd_collateral WHERE id = ? AND agent_id = ?', [id(req.params.id), req.agentId]);
  if (!c) throw new BdError(404, 'not_found');
  sendFile(res, await collateralReceiptPdf(db, req.agentId, Number(c.id)), { type: 'application/pdf', name: `collateral-${receiptNo('C', c.receipt_no)}.pdf` });
}));

// ── Powers ────────────────────────────────────────────────────────────────────

router.get('/powers', handle(async (req, res, db) => {
  const status = ['available', 'executed', 'void', 'returned'].includes(req.query.status) ? req.query.status : null;
  const surety = typeof req.query.surety === 'string' && req.query.surety.trim() ? req.query.surety.trim().slice(0, 120) : null;
  const args = [req.agentId];
  let where = 'p.agent_id = ?';
  if (status) { where += ' AND p.status = ?'; args.push(status); }
  if (surety) { where += ' AND p.surety_name = ?'; args.push(surety); }
  const rows = await db.all(
    `SELECT p.id, p.surety_name, p.number, p.limit_cents, p.received_on, p.expires_on, p.status, p.bond_id, p.executed_on, p.void_reason,
            b.defendant_name
       FROM bd_powers p LEFT JOIN bd_bonds b ON b.id = p.bond_id
      WHERE ${where} ORDER BY p.surety_name, p.number LIMIT 2000`, args);
  const sureties = await db.all('SELECT DISTINCT surety_name FROM bd_powers WHERE agent_id = ? ORDER BY surety_name', [req.agentId]);
  res.json({
    powers: rows.map((r) => ({ ...r, id: Number(r.id), limit_cents: Number(r.limit_cents), bond_id: r.bond_id == null ? null : Number(r.bond_id) })),
    sureties: sureties.map((s) => s.surety_name),
  });
}));

router.post('/powers', handle(async (req, res, db) => {
  const b = body(req);
  const surety = text(b.surety_name, 120, 'surety_name', { required: true });
  const prefix = text(b.prefix, 20, 'prefix') || '';
  if (prefix && !/^[A-Za-z0-9-]+$/.test(prefix)) throw new BdError(400, 'invalid', { field: 'prefix' });
  const start = String(b.start ?? '').trim();
  const end = String(b.end ?? '').trim();
  if (!/^\d{1,12}$/.test(start)) throw new BdError(400, 'invalid', { field: 'start' });
  if (!/^\d{1,12}$/.test(end)) throw new BdError(400, 'invalid', { field: 'end' });
  const s = Number(start); const e = Number(end);
  if (e < s) throw new BdError(400, 'invalid', { field: 'end' });
  if (e - s + 1 > 500) throw new BdError(400, 'too_many_powers');
  const width = start.length;   // keep the surety's zero padding (000101 … 000150)
  const limit = cents(b.limit_cents, 'limit_cents');
  const received = date(b.received_on, 'received_on', { required: true });
  const expires = date(b.expires_on, 'expires_on');
  if (expires && expires < received) throw new BdError(400, 'bad_date', { field: 'expires_on' });
  let created = 0;
  await db.transaction(async (tx) => {
    for (let n = s; n <= e; n++) {
      const r = await tx.run(
        `INSERT INTO bd_powers (agent_id, surety_name, number, limit_cents, received_on, expires_on) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent_id, surety_name, number) DO NOTHING`,
        [req.agentId, surety, `${prefix}${String(n).padStart(width, '0')}`, limit, received, expires]);
      created += r.changes ? 1 : 0;
    }
  });
  res.status(201).json({ created, skipped: e - s + 1 - created });
}));

router.post('/powers/:id/void', handle(async (req, res, db) => {
  const pid = id(req.params.id);
  const reason = text(body(req).reason, 300, 'reason', { required: true });
  const r = await db.run(
    `UPDATE bd_powers SET status = 'void', void_reason = ? WHERE id = ? AND agent_id = ? AND status IN ('available', 'executed')`, [reason, pid, req.agentId]);
  if (!r.changes) {
    const p = await db.get('SELECT status FROM bd_powers WHERE id = ? AND agent_id = ?', [pid, req.agentId]);
    throw p ? new BdError(409, 'power_unavailable') : new BdError(404, 'not_found');
  }
  res.json({ ok: true });
}));

router.post('/powers/:id/return', handle(async (req, res, db) => {
  const pid = id(req.params.id);
  const r = await db.run(`UPDATE bd_powers SET status = 'returned' WHERE id = ? AND agent_id = ? AND status = 'available'`, [pid, req.agentId]);
  if (!r.changes) {
    const p = await db.get('SELECT status FROM bd_powers WHERE id = ? AND agent_id = ?', [pid, req.agentId]);
    throw p ? new BdError(409, 'power_unavailable') : new BdError(404, 'not_found');
  }
  res.json({ ok: true });
}));

// ── Texts sent for the agent ─────────────────────────────────────────────────

router.get('/texts', handle(async (req, res, db) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month || '')) ? req.query.month : new Date().toISOString().slice(0, 7);
  const rows = await db.all(
    `SELECT t.sent_at, t.purpose, t.to_masked, t.bond_id, t.cents, d.status AS delivery_status, d.error_code
       FROM bd_texts t LEFT JOIN sms_delivery d ON d.provider_id = t.provider_id
      WHERE t.agent_id = ? AND t.sent_at >= (?::date) AND t.sent_at < ((?::date) + INTERVAL '1 month') ORDER BY t.sent_at DESC LIMIT 2000`,
    [req.agentId, `${month}-01`, `${month}-01`]);
  res.json({
    month, count: rows.length, cents: rows.reduce((s, r) => s + Number(r.cents), 0),
    rows: rows.map((r) => ({ at: r.sent_at, purpose: r.purpose, to_masked: r.to_masked, bond_id: r.bond_id == null ? null : Number(r.bond_id),
      // null until the carrier reports back (delivered / delivery_failed / sending_failed / delivery_unconfirmed)
      delivery_status: r.delivery_status || null, error_code: r.error_code || null })),
  });
}));

export default router;
