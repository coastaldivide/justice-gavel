/**
 * services/bondDesk/payments.js — posting a payment to a bond's ledger. Every payment, typed in
 * by the agent or paid by card (automatic payment plan, the agency's pay page), goes through
 * postPayment: the bond is locked, the payment never exceeds the balance (unless the money was
 * already taken by card — see `taken`), a receipt number is drawn from the agency's own series in
 * the same transaction, and a card payment (Stripe PaymentIntent id) is posted at most once.
 */
import { liveTotal, money, usDate, bondMoney } from './money.js';
import { receiptPdf } from './pdf.js';
import { agencyFor, agentToday, sendAgentTextRecord, sendAgentEmail } from './core.js';
import { msg } from '../../i18n/index.js';
import { fitSms } from '../smsText.js';

export class LedgerError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params || {}; }
}

export const receiptNo = (series, n) => `${series}-${String(n).padStart(6, '0')}`;
export const PAYMENT_COLS = 'id, receipt_no, amount_cents, method, reference, payer_name, received_on, created_at, voided_at, void_reason, source';
export const publicPayment = (p) => ({ ...p, id: Number(p.id), receipt_no: receiptNo('R', p.receipt_no), amount_cents: Number(p.amount_cents), source: p.source || 'manual' });

/** The bond's balance (non-void charges − non-void payments), read inside the caller's transaction. */
export async function balanceOf(tx, bondId) {
  const charges = await tx.all('SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ?', [bondId]);
  const payments = await tx.all('SELECT amount_cents, voided_at FROM bd_payments WHERE bond_id = ?', [bondId]);
  return liveTotal(charges) - liveTotal(payments);
}

/**
 * Post one payment. Must run inside a transaction (tx). → { payment, duplicate }
 *   stripePiId  a card payment: posted once; a second call answers the first payment (duplicate: true)
 *   taken       the money was already collected by card: over the balance it is still recorded
 *               (the agency really received it) — otherwise 409 over_balance
 */
export async function postPayment(tx, { agentId, bondId, amountCents, method, payerName, reference = null, receivedOn,
  createdBy = null, stripePiId = null, source = 'manual', taken = false }) {
  const bond = await tx.get('SELECT id FROM bd_bonds WHERE id = ? AND agent_id = ? FOR UPDATE', [bondId, agentId]);   // serialises payments on this bond
  if (!bond) throw new LedgerError(404, 'not_found');
  if (stripePiId) {
    const done = await tx.get(`SELECT ${PAYMENT_COLS} FROM bd_payments WHERE stripe_pi_id = ?`, [stripePiId]);
    if (done) return { payment: publicPayment(done), duplicate: true };
  }
  const balance = await balanceOf(tx, bondId);
  if (amountCents > balance && !taken) throw new LedgerError(409, 'over_balance', { balance_cents: balance });
  const n = await tx.get(
    `INSERT INTO bd_counters (agent_id, series, last_no) VALUES (?, 'R', 1)
     ON CONFLICT (agent_id, series) DO UPDATE SET last_no = bd_counters.last_no + 1 RETURNING last_no`, [agentId]);
  const p = await tx.get(
    `INSERT INTO bd_payments (bond_id, agent_id, receipt_no, amount_cents, method, reference, payer_name, received_on, created_by, stripe_pi_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${PAYMENT_COLS}`,
    [bondId, agentId, Number(n.last_no), amountCents, method, reference, payerName, receivedOn, createdBy, stripePiId, source]);
  await tx.run('UPDATE bd_bonds SET updated_at = NOW() WHERE id = ?', [bondId]);
  return { payment: publicPayment(p), duplicate: false, over_balance_cents: Math.max(0, amountCents - balance) };
}

/**
 * The premium for forms and the surety report: premium charges the agent entered, plus the
 * premium stated in an imported CSV (the imported opening balance is not premium by itself).
 */
export async function premiumCentsFor(db, bondId) {
  const b = await db.get('SELECT imported_premium_cents FROM bd_bonds WHERE id = ?', [bondId]);
  const rows = await db.all(`SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ? AND kind = 'premium' AND source IS DISTINCT FROM 'import'`, [bondId]);
  return liveTotal(rows) + Number(b?.imported_premium_cents || 0);
}

/** SQL expression for the same premium (surety report). `b` = bd_bonds alias. */
export const PREMIUM_SQL = `(COALESCE(b.imported_premium_cents, 0) + COALESCE((SELECT SUM(amount_cents) FROM bd_charges c
  WHERE c.bond_id = b.id AND c.kind = 'premium' AND c.voided_at IS NULL AND c.source IS DISTINCT FROM 'import'), 0))`;

/**
 * Send a payment's receipt to the payer: e-mail (free) and/or a text (5¢, only when the payer
 * asked for it). → { email, sms }
 */
export async function sendReceipt(db, { paymentId, lang = 'en', email = null, phone = null, smsOk = false }) {
  const p = await db.get(
    `SELECT p.agent_id, p.bond_id, p.receipt_no, p.amount_cents, p.received_on, p.payer_name, b.defendant_name
       FROM bd_payments p JOIN bd_bonds b ON b.id = p.bond_id WHERE p.id = ?`, [paymentId]);
  if (!p) return { email: null, sms: null };
  const a = await agencyFor(db, p.agent_id);
  const params = { agency: a.agency || a.agent_name, receipt: receiptNo('R', p.receipt_no), amount: money(p.amount_cents),
    date: usDate(p.received_on), defendant: p.defendant_name, payer: p.payer_name, phone: a.phone || '' };
  const out = { email: null, sms: null };
  if (email) {
    out.email = await sendAgentEmail({ to: email, subject: msg(lang, 'bd.email.receipt_subject', params), text: msg(lang, 'bd.email.receipt_body', params) });
  }
  if (phone && smsOk) {
    const body = fitSms((f) => msg(lang, 'bd.sms.receipt', f), params, [['defendant', 6], ['agency', 12]], { lang });
    out.sms = (await sendAgentTextRecord(db, { agentId: p.agent_id, bondId: p.bond_id, purpose: 'payment_receipt', to: phone, body })).status;
  }
  return out;
}

// ── Receipt PDFs (the receipt download and the export ZIP) ───────────────────

const METHOD_LABEL = { cash: 'Cash', check: 'Check', card: 'Card', money_order: 'Money order', bank_transfer: 'Bank transfer', other: 'Other' };

/** The payment receipt PDF (bytes). */
export async function paymentReceiptPdf(db, agentId, paymentId) {
  const p = await db.get(
    `SELECT p.*, b.defendant_name, b.case_number, b.bond_amount_cents FROM bd_payments p JOIN bd_bonds b ON b.id = p.bond_id
      WHERE p.id = ? AND p.agent_id = ?`, [paymentId, agentId]);
  if (!p) throw new LedgerError(404, 'not_found');
  const a = await agencyFor(db, agentId);
  const today = await agentToday(db, agentId);
  const [charges, payments] = await Promise.all([
    db.all('SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ?', [p.bond_id]),
    db.all('SELECT amount_cents, voided_at FROM bd_payments WHERE bond_id = ?', [p.bond_id]),
  ]);
  const m = bondMoney({ charges, payments, installments: [], planChargedCents: null }, today);
  return await receiptPdf({
    title: 'Payment Receipt', receipt_no: receiptNo('R', p.receipt_no), agency: a.agency, license: a.license, agency_phone: a.phone,
    date: usDate(p.received_on),
    lines: [
      ['Received from', p.payer_name], ['Amount', money(p.amount_cents)],
      ['Method', METHOD_LABEL[p.method] + (p.reference ? ` — ${p.reference}` : '')],
      ['For', `Bail bond premium / fees — ${p.defendant_name}${p.case_number ? `, case ${p.case_number}` : ''}`],
      ['Bond amount', money(p.bond_amount_cents)],
      [`Balance owed as of ${usDate(today)}`, money(m.balance_cents)],
    ],
    void_note: p.voided_at ? `VOID — ${p.void_reason}` : null,
    footer: 'Keep this receipt. Premium paid for a bail bond is earned when the bond is posted.',
  });
}

/** The collateral receipt PDF (bytes). */
export async function collateralReceiptPdf(db, agentId, collateralId) {
  const c = await db.get(
    `SELECT c.*, b.defendant_name, b.case_number FROM bd_collateral c JOIN bd_bonds b ON b.id = c.bond_id WHERE c.id = ? AND c.agent_id = ?`,
    [collateralId, agentId]);
  if (!c) throw new LedgerError(404, 'not_found');
  const a = await agencyFor(db, agentId);
  const kinds = { cash: 'Cash', real_estate: 'Real estate', vehicle: 'Vehicle', jewelry: 'Jewelry', other: 'Other' };
  return await receiptPdf({
    title: 'Collateral Receipt', receipt_no: receiptNo('C', c.receipt_no), agency: a.agency, license: a.license, agency_phone: a.phone,
    date: usDate(c.received_on),
    lines: [
      ['Received from', c.received_from], ['Type', kinds[c.kind]], ['Description', c.description],
      ['Stated value', Number(c.value_cents) > 0 ? money(c.value_cents) : '—'],
      ['Held as security for the bail bond of', `${c.defendant_name}${c.case_number ? `, case ${c.case_number}` : ''}`],
      ['Returned', c.returned_on ? `${usDate(c.returned_on)} to ${c.returned_to}` : 'Not yet returned'],
    ],
    footer: 'Collateral is returned when the bond is discharged and every amount owed under the agreement is paid, as state law and the agreement provide.',
  });
}
