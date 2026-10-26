/**
 * services/leadCredits.js — prepaid lead credits (services/leadRules.js CREDIT_PACKS).
 *
 * A ledger (attorney_lead_credits, migration 034): a paid pack adds credits once per
 * PaymentIntent (the confirm route and the Stripe webhook may both run, in any order);
 * answering a request the attorney chose spends that lead type's credits. The price is
 * fixed per credit and per lead type — it never depends on whether the person hires the
 * lawyer (Tenn. Op. 2018-F-165; ABA Model Rule 5.4). Credits are never refunded for outcome.
 */
import { CREDIT_PACKS, CREDIT_CENTS, allowsCredits, leadRuleFor } from './leadRules.js';
import { attorneyLeadCredits } from '../routes/billing/attorneyLeadFee.js';
import { BillingError } from './stripeBilling.js';

export async function creditBalance(db, attorneyId) {
  const r = await db.get('SELECT COALESCE(SUM(delta), 0)::int AS n FROM attorney_lead_credits WHERE attorney_id = ?', [attorneyId]);
  return Number(r?.n || 0);
}

/** A verified 'lead_credits' PaymentIntent → { created, credits }. */
export async function recordCreditPurchase(db, { attorneyId, pi }) {
  const key = pi?.metadata?.pack;
  const pack = Object.prototype.hasOwnProperty.call(CREDIT_PACKS, key || '') ? CREDIT_PACKS[key] : null;
  if (!pack || Number(pi.amount) !== pack.cents) throw new BillingError(409, 'payment_not_found');
  const r = await db.run(
    `INSERT INTO attorney_lead_credits (attorney_id, delta, reason, pack, amount_cents, stripe_pi_id)
     VALUES (?, ?, 'purchase', ?, ?, ?) ON CONFLICT DO NOTHING`,
    [attorneyId, pack.credits, key, Number(pi.amount), pi.id]);
  return { created: !!r.changes, credits: pack.credits };
}

const OPEN_SQL = `(status = 'open' OR (status = 'reserved' AND reserved_until < NOW()))`;

/**
 * Spend credits on one open lead → { lead, credits, balance }. One buyer per lead, as with card
 * payments; the person's contact details are returned to this attorney only.
 */
export async function claimLeadWithCredits(db, { attorneyId, leadId }) {
  return await db.transaction(async (tx) => {
    // Serialise this attorney's claims (row lock) so two claims can't spend the same credits.
    await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [attorneyId]);
    const lead = await tx.get(
      `SELECT id, case_type, state, status, accepted_by, user_id FROM pi_leads WHERE id = ? FOR UPDATE`, [leadId]);
    if (!lead) throw new BillingError(404, 'lead_not_found');
    if (Number(lead.user_id || 0) === Number(attorneyId)) throw new BillingError(404, 'lead_not_found');
    if (lead.status === 'accepted') {
      throw new BillingError(409, Number(lead.accepted_by) === Number(attorneyId) ? 'lead_owned' : 'lead_taken');
    }
    const open = await tx.get(`SELECT id FROM pi_leads WHERE id = ? AND ${OPEN_SQL}`, [leadId]);
    if (!open) throw new BillingError(409, 'lead_taken');
    if (!allowsCredits(lead.state)) {
      const rule = leadRuleFor(lead.state);
      throw new BillingError(403, 'leads_not_sold_in_state', { state: rule.state, mode: rule.mode });
    }
    const cost = attorneyLeadCredits(lead.case_type);
    const bal = await creditBalance(tx, attorneyId);
    if (bal < cost) throw new BillingError(402, 'not_enough_credits', { needed: cost, balance: bal });
    const entry = await tx.get(
      `INSERT INTO attorney_lead_credits (attorney_id, delta, reason, lead_id) VALUES (?, ?, 'claim', ?) RETURNING id`,
      [attorneyId, -cost, leadId]);
    await tx.run(
      `UPDATE pi_leads SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), fee_charged = ?, credit_entry_id = ?,
              paid_with = 'credits', reserved_until = NULL, updated_at = NOW()
        WHERE id = ?`, [attorneyId, cost * CREDIT_CENTS, entry.id, leadId]);
    const row = await tx.get(
      `SELECT pl.id, pl.case_type, pl.incident_date, pl.description, pl.severity, pl.city, pl.state,
              pl.lead_fee_cents, pl.accepted_at,
              u.display_name AS contact_name, u.email AS contact_email, u.phone AS contact_phone
         FROM pi_leads pl LEFT JOIN users u ON u.id = pl.user_id
        WHERE pl.id = ?`, [leadId]);
    return { lead: { ...row, id: Number(row.id), lead_fee_cents: Number(row.lead_fee_cents) }, credits: cost, balance: bal - cost };
  });
}
