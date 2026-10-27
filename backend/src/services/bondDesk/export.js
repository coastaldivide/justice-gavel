/**
 * services/bondDesk/export.js — "Export everything" (A12 step 4): one ZIP per agency, streamed,
 * with every report as CSV (whole history), the agency's records as CSV, every signed PDF, every
 * payment and collateral receipt PDF, and a README listing what is inside. The agency owns its
 * Bond Desk data and can export it at any time (docs/TERMS_OF_SERVICE.md).
 */
import { ZipWriter } from './zip.js';
import { toCsv, REPORTS, dollars } from '../../routes/bondDesk/reports.js';
import { paymentReceiptPdf, collateralReceiptPdf, receiptNo } from './payments.js';
import { getFile } from './packets.js';
import { agencyFor, agentToday } from './core.js';
import logger from '../../utils/logger.js';

const safe = (s, max = 60) => String(s || '').normalize('NFKD').replace(/[^\w .-]+/g, '').trim().replace(/\s+/g, '-').slice(0, max) || 'x';
const csvBuf = (header, rows) => Buffer.from(toCsv(header, rows), 'utf8');

/** The agency's own records as CSV files (name → { header, rows }). */
async function recordTables(db, agentId) {
  const q = (sql) => db.all(sql, [agentId]);
  const [bonds, inds, charges, payments, plans, collateral, powers, courts] = await Promise.all([
    q(`SELECT id, status, defendant_name, defendant_dob, defendant_phone, defendant_email, defendant_address, case_number, court_name, county, state,
              court_date, charges, bond_amount_cents, surety_name, posted_on, forfeited_on, forfeiture_deadline_on, discharged_on, forfeiture_paid_cents,
              imported_premium_cents, notes, created_at FROM bd_bonds WHERE agent_id = ? ORDER BY id`),
    q(`SELECT i.id, i.bond_id, i.full_name, i.relationship, i.phone, i.email, i.address, i.dob, i.employer FROM bd_indemnitors i
         JOIN bd_bonds b ON b.id = i.bond_id WHERE b.agent_id = ? ORDER BY i.id`),
    q(`SELECT c.id, c.bond_id, c.kind, c.amount_cents, c.description, c.created_at, c.voided_at, c.void_reason FROM bd_charges c
         JOIN bd_bonds b ON b.id = c.bond_id WHERE b.agent_id = ? ORDER BY c.id`),
    q(`SELECT id, bond_id, receipt_no, amount_cents, method, reference, payer_name, received_on, source, voided_at, void_reason FROM bd_payments
        WHERE agent_id = ? ORDER BY receipt_no`),
    q(`SELECT i.bond_id, i.due_on, i.amount_cents FROM bd_installments i JOIN bd_bonds b ON b.id = i.bond_id WHERE b.agent_id = ? ORDER BY i.bond_id, i.due_on`),
    q(`SELECT id, bond_id, receipt_no, kind, description, value_cents, received_from, received_on, returned_on, returned_to FROM bd_collateral
        WHERE agent_id = ? ORDER BY receipt_no`),
    q(`SELECT id, surety_name, number, limit_cents, received_on, expires_on, status, bond_id, executed_on, void_reason FROM bd_powers
        WHERE agent_id = ? ORDER BY surety_name, number`),
    q(`SELECT cd.bond_id, cd.court_date, cd.court_time, cd.court_name, cd.room, cd.status FROM bd_court_dates cd JOIN bd_bonds b ON b.id = cd.bond_id
        WHERE b.agent_id = ? AND cd.deleted_at IS NULL ORDER BY cd.bond_id, cd.court_date`),
  ]);
  const d = (c) => (c == null ? '' : dollars(c));
  return {
    'records/bonds.csv': { header: ['Bond id', 'Status', 'Defendant', 'Date of birth', 'Phone', 'E-mail', 'Address', 'Case', 'Court', 'County', 'State',
      'Next court date', 'Charges', 'Bond amount', 'Surety', 'Posted', 'Forfeited', 'Forfeiture deadline', 'Discharged', 'Forfeiture paid', 'Imported premium', 'Notes', 'Created'],
    rows: bonds.map((r) => [r.id, r.status, r.defendant_name, r.defendant_dob, r.defendant_phone, r.defendant_email, r.defendant_address, r.case_number,
      r.court_name, r.county, r.state, r.court_date, r.charges, d(r.bond_amount_cents), r.surety_name, r.posted_on, r.forfeited_on, r.forfeiture_deadline_on,
      r.discharged_on, d(r.forfeiture_paid_cents), d(r.imported_premium_cents), r.notes, r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at]) },
    'records/indemnitors.csv': { header: ['Indemnitor id', 'Bond id', 'Name', 'Relationship', 'Phone', 'E-mail', 'Address', 'Date of birth', 'Employer'],
      rows: inds.map((r) => [r.id, r.bond_id, r.full_name, r.relationship, r.phone, r.email, r.address, r.dob, r.employer]) },
    'records/charges.csv': { header: ['Charge id', 'Bond id', 'Kind', 'Amount', 'Description', 'Created', 'Voided', 'Void reason'],
      rows: charges.map((r) => [r.id, r.bond_id, r.kind, d(r.amount_cents), r.description, r.created_at, r.voided_at, r.void_reason]) },
    'records/payments.csv': { header: ['Receipt', 'Bond id', 'Amount', 'Method', 'Reference', 'Payer', 'Received', 'How', 'Voided', 'Void reason'],
      rows: payments.map((r) => [receiptNo('R', r.receipt_no), r.bond_id, d(r.amount_cents), r.method, r.reference, r.payer_name, r.received_on, r.source, r.voided_at, r.void_reason]) },
    'records/payment-plans.csv': { header: ['Bond id', 'Due', 'Amount'], rows: plans.map((r) => [r.bond_id, r.due_on, d(r.amount_cents)]) },
    'records/collateral.csv': { header: ['Receipt', 'Bond id', 'Type', 'Description', 'Stated value', 'Received from', 'Received', 'Returned', 'Returned to'],
      rows: collateral.map((r) => [receiptNo('C', r.receipt_no), r.bond_id, r.kind, r.description, d(r.value_cents), r.received_from, r.received_on, r.returned_on, r.returned_to]) },
    'records/powers.csv': { header: ['Surety', 'Power', 'Limit', 'Received', 'Expires', 'Status', 'Bond id', 'Executed', 'Void reason'],
      rows: powers.map((r) => [r.surety_name, r.number, d(r.limit_cents), r.received_on, r.expires_on, r.status, r.bond_id, r.executed_on, r.void_reason]) },
    'records/court-dates.csv': { header: ['Bond id', 'Court date', 'Time', 'Court', 'Room', 'Status'],
      rows: courts.map((r) => [r.bond_id, r.court_date, r.court_time, r.court_name, r.room, r.status]) },
  };
}

/**
 * Stream the agency's ZIP. `write(buf)` → Promise; `storage` (attachment storage) or null when
 * file storage is off (then the signed PDFs are listed in the README as not included).
 * → { files, signed, receipts, missing }
 */
export async function writeAgencyExport(db, { agentId, write, storage, now = new Date() }) {
  const zip = new ZipWriter(write, { now });
  const listing = [];
  const add = async (name, data, opts) => { const n = await zip.addEntry(name, data, opts); listing.push(n); return n; };
  const a = await agencyFor(db, agentId);
  const today = await agentToday(db, agentId);

  for (const fn of Object.values(REPORTS)) {
    const r = await fn(db, agentId, {});
    await add(`reports/${r.csv.name}`, csvBuf(r.csv.header, r.csv.rows));
  }
  for (const [name, t] of Object.entries(await recordTables(db, agentId))) await add(name, csvBuf(t.header, t.rows));

  let receipts = 0;
  const pays = await db.all('SELECT p.id, p.receipt_no, b.defendant_name FROM bd_payments p JOIN bd_bonds b ON b.id = p.bond_id WHERE p.agent_id = ? ORDER BY p.receipt_no', [agentId]);
  for (const p of pays) {
    await add(`receipts/payments/${receiptNo('R', p.receipt_no)}-${safe(p.defendant_name, 40)}.pdf`, await paymentReceiptPdf(db, agentId, Number(p.id)), { store: true });
    receipts += 1;
  }
  const cols = await db.all('SELECT c.id, c.receipt_no, b.defendant_name FROM bd_collateral c JOIN bd_bonds b ON b.id = c.bond_id WHERE c.agent_id = ? ORDER BY c.receipt_no', [agentId]);
  for (const c of cols) {
    await add(`receipts/collateral/${receiptNo('C', c.receipt_no)}-${safe(c.defendant_name, 40)}.pdf`, await collateralReceiptPdf(db, agentId, Number(c.id)), { store: true });
    receipts += 1;
  }

  let signed = 0; const missing = [];
  const docs = await db.all(
    `SELECT d.id, d.name, d.signed_key, s.name AS signer, s.role, b.id AS bond_id, b.defendant_name, p.id AS packet_id
       FROM bd_documents d JOIN bd_signers s ON s.id = d.signer_id JOIN bd_packets p ON p.id = d.packet_id JOIN bd_bonds b ON b.id = p.bond_id
      WHERE p.agent_id = ? AND d.status = 'signed' AND d.signed_key IS NOT NULL ORDER BY b.id, d.id`, [agentId]);
  for (const d of docs) {
    const name = `signed/${safe(d.defendant_name, 40)}-bond-${d.bond_id}/packet-${d.packet_id}-${safe(d.name, 50)}-${safe(d.signer, 30)}.pdf`;
    if (!storage) { missing.push(name); continue; }
    try { await add(name, await getFile(storage, d.signed_key), { store: true }); signed += 1; } catch (e) {
      logger.warn({ err: e?.message, doc: d.id }, '[bond-desk] export: signed copy not read');
      missing.push(name);
    }
  }

  const readme = [
    `Bond Desk export — ${a.agency || a.agent_name}`,
    `Made ${now.toISOString()} (agency date ${today}).`,
    '',
    'Your agency owns this data. You can export it from Bond Desk at any time.',
    'Money is in dollars with two decimals; dates are YYYY-MM-DD.',
    '',
    'reports/      the Bond Desk reports (liability, surety, receivables, receipts, collateral held, court appearance), whole history',
    'records/      every bond, indemnitor, charge, payment, payment plan, collateral item, power and court date',
    `receipts/     every payment receipt and collateral receipt as PDF (${receipts})`,
    `signed/       every signed document with its signature certificate (${signed})`,
    ...(missing.length ? ['', `Not included (file storage could not be read — export again later or contact support): ${missing.length}`, ...missing.map((m) => `  ${m}`)] : []),
    '',
    'Files:',
    ...listing.map((n) => `  ${n}`),
    '  README.txt',
    '',
  ].join('\r\n');
  await zip.addEntry('README.txt', readme);
  await zip.finish();
  return { files: listing.length + 1, signed, receipts, missing: missing.length };
}
