/**
 * services/publicDefender/billing.js — the annual invoice of a public defender office (A11 step 6;
 * docs/PUBLIC_DEFENDER.md "Billing").
 *
 * A Justice Gavel admin previews and then creates the invoice for one office and one year
 * ("Create annual invoice"). Stripe invoicing (collection by e-mailed invoice, due in 30 days):
 *   setup fee      PD_SETUP_FEE_CENTS, on the office's first invoice only (default $20,000)
 *   active clients × PD_CLIENT_YEAR_CENTS (default $2.00). An active client is a client on the
 *                  office's list with at least one court date (not removed or cancelled) from 365
 *                  days before the invoice day onwards.
 * Texts are a platform cost included in these fees — never billed per text.
 *
 * Idempotent per office + year: a pd_invoices row (unique office_id, year) freezes the counts and
 * amounts when first created; every Stripe call carries an idempotency key derived from that row
 * (customer, invoice, each line, finalize, send). A failure leaves the row 'pending' with the
 * error; creating it again continues from where it stopped and never makes a second invoice.
 */
import { stripeClient } from '../../routes/billing/_shared.js';
import { stripeConfigured } from '../../config.js';
import { PdError, pdPrices } from './common.js';
import { getOffice } from './offices.js';

export const DUE_DAYS = 30;
const usd = (c) => `$${(Number(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

export function invoiceYear(v, now = new Date()) {
  if (v == null || v === '') return now.getUTCFullYear();
  const n = /^\d{4}$/.test(String(v)) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 2020 || n > 2100) throw new PdError(400, 'bad_year', { field: 'year' });
  return n;
}

/** Active clients of an office as of `now` (see header). */
export async function activeClients(db, officeId, now = new Date()) {
  const r = await db.get(
    `SELECT COUNT(DISTINCT cd.pd_client_id)::int AS n FROM pd_court_dates cd
      WHERE cd.office_id = ? AND cd.deleted_at IS NULL AND cd.status <> 'cancelled'
        AND cd.court_date >= (CAST(? AS timestamptz) AT TIME ZONE 'UTC')::date - 365`, [officeId, now.toISOString()]);
  return r.n;
}

const shapeInvoice = (r) => (r ? {
  id: Number(r.id), office_id: Number(r.office_id), year: Number(r.year), active_clients: Number(r.active_clients),
  setup_cents: Number(r.setup_cents), per_client_cents: Number(r.per_client_cents), amount_cents: Number(r.amount_cents),
  status: r.status, stripe_invoice_id: r.stripe_invoice_id, hosted_invoice_url: r.hosted_invoice_url, last_error: r.last_error,
  created_at: r.created_at, sent_at: r.sent_at,
} : null);

/** GET /api/admin/pd-offices/:id/invoice-preview?year= */
export async function previewInvoice(db, officeId, year, now = new Date()) {
  const office = await getOffice(db, officeId);
  const existing = await db.get('SELECT * FROM pd_invoices WHERE office_id = ? AND year = ?', [office.id, year]);
  if (existing) return { year, existing: shapeInvoice(existing), ...shapeInvoice(existing), billing_email: office.billing_email };
  const prices = pdPrices();
  const earlier = await db.get('SELECT 1 AS x FROM pd_invoices WHERE office_id = ? AND year <> ? LIMIT 1', [office.id, year]);
  const n = await activeClients(db, office.id, now);
  const setup = earlier ? 0 : prices.setup_cents;
  return {
    year, existing: null, active_clients: n, setup_cents: setup, per_client_cents: prices.per_client_cents,
    clients_cents: n * prices.per_client_cents, amount_cents: setup + n * prices.per_client_cents, billing_email: office.billing_email,
  };
}

export async function listInvoices(db, officeId) {
  const rows = await db.all('SELECT * FROM pd_invoices WHERE office_id = ? ORDER BY year DESC LIMIT 50', [officeId]);
  return rows.map(shapeInvoice);
}

/** POST /api/admin/pd-offices/:id/invoices { year } → { invoice, created } */
export async function createInvoice(db, { officeId, year, adminId, now = new Date() }) {
  if (!stripeConfigured()) throw new PdError(503, 'payments_unavailable');
  const office = await getOffice(db, officeId);
  if (!office.billing_email) throw new PdError(409, 'billing_email_required');
  let row = await db.get('SELECT * FROM pd_invoices WHERE office_id = ? AND year = ?', [office.id, year]);
  let created = false;
  if (!row) {
    const p = await previewInvoice(db, office.id, year, now);
    if (p.amount_cents <= 0) throw new PdError(409, 'nothing_to_invoice');
    row = await db.get(
      `INSERT INTO pd_invoices (office_id, year, active_clients, setup_cents, per_client_cents, amount_cents, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (office_id, year) DO NOTHING RETURNING *`,
      [office.id, year, p.active_clients, p.setup_cents, p.per_client_cents, p.amount_cents, adminId]);
    created = !!row;
    if (!row) row = await db.get('SELECT * FROM pd_invoices WHERE office_id = ? AND year = ?', [office.id, year]);
  }
  if (row.status === 'sent') return { invoice: shapeInvoice(row), created: false };
  const stripe = stripeClient();
  try {
    // 1. the office as a Stripe customer
    let customer = office.stripe_customer_id;
    if (!customer) {
      const c = await stripe.customers.create(
        { name: office.name, email: office.billing_email, metadata: { pd_office_id: String(office.id) } },
        { idempotencyKey: `pd-office-${office.id}-customer` });
      customer = c.id;
      await db.run('UPDATE pd_offices SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL', [customer, office.id]);
    }
    // 2. the draft invoice (only its own lines)
    let invId = row.stripe_invoice_id;
    if (!invId) {
      const inv = await stripe.invoices.create({
        customer, collection_method: 'send_invoice', days_until_due: DUE_DAYS, auto_advance: false, pending_invoice_items_behavior: 'exclude',
        description: `Justice Gavel public defender channel — ${year}`,
        metadata: { pd_invoice_id: String(row.id), pd_office_id: String(office.id), year: String(year) },
      }, { idempotencyKey: `pd-inv-${row.id}-invoice` });
      invId = inv.id;
      await db.run('UPDATE pd_invoices SET stripe_invoice_id = ? WHERE id = ?', [invId, row.id]);
    }
    let inv = await stripe.invoices.retrieve(invId);
    if (inv.status === 'draft') {
      // 3. the lines
      if (Number(row.setup_cents) > 0) {
        await stripe.invoiceItems.create({ customer, invoice: invId, currency: 'usd', amount: Number(row.setup_cents),
          description: 'Setup fee (one time)', metadata: { pd_invoice_id: String(row.id), line: 'setup' } },
        { idempotencyKey: `pd-inv-${row.id}-setup` });
      }
      const clientsCents = Number(row.active_clients) * Number(row.per_client_cents);
      if (clientsCents > 0) {
        await stripe.invoiceItems.create({ customer, invoice: invId, currency: 'usd', amount: clientsCents,
          description: `Active clients ${year}: ${row.active_clients} × ${usd(row.per_client_cents)} (texts included)`,
          metadata: { pd_invoice_id: String(row.id), line: 'clients' } },
        { idempotencyKey: `pd-inv-${row.id}-clients` });
      }
      // 4. finalize and e-mail it
      inv = await stripe.invoices.finalizeInvoice(invId, {}, { idempotencyKey: `pd-inv-${row.id}-finalize` });
    }
    if (inv.status === 'open') inv = await stripe.invoices.sendInvoice(invId, {}, { idempotencyKey: `pd-inv-${row.id}-send` });
    await db.run(`UPDATE pd_invoices SET status = 'sent', hosted_invoice_url = ?, last_error = NULL, sent_at = NOW() WHERE id = ?`,
      [inv.hosted_invoice_url || null, row.id]);
  } catch (e) {
    await db.run('UPDATE pd_invoices SET last_error = ? WHERE id = ?', [String(e?.message || 'stripe_error').slice(0, 300), row.id]);
    throw e;
  }
  return { invoice: shapeInvoice(await db.get('SELECT * FROM pd_invoices WHERE id = ?', [row.id])), created };
}
