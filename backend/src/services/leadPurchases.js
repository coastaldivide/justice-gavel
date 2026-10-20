/**
 * services/leadPurchases.js — recording a paid lead, exactly once.
 *
 * Called by the app's confirm routes and by the Stripe webhook with a
 * PaymentIntent that stripeBilling.verifyPayment / the signed webhook already
 * proved succeeded. Both may run for the same payment, in any order, any
 * number of times: the payment id is unique (migration 027), so a replay
 * never records or credits a second purchase.
 *
 * Rules (from routes/billing):
 *   bail lead  — every bail agent may buy an arrest record once; a second
 *                payment by the same agent for the same record is refunded.
 *   case lead  — sold to ONE attorney (the consumer was told "only the one
 *                attorney who takes your case"); it is reserved for the buyer
 *                while they pay, and a payment that arrives after someone else
 *                bought it is refunded.
 */
import { stripeClient } from '../routes/billing/_shared.js';
import logger from '../utils/logger.js';

const ARREST_COLS = 'id, name, booking_date, charges, bail_amount, county, state, jail_location';

async function refund(pi, why) {
  try {
    await stripeClient().refunds.create(
      { payment_intent: pi.id, reason: 'duplicate', metadata: { jg_reason: why } },
      { idempotencyKey: `refund_${pi.id}` });
    return true;
  } catch (e) {
    logger.error('[leads] refund failed', pi.id, e?.message);
    return false;
  }
}

/** → { arrest, created, refunded } */
export async function recordBailLead(db, { bondsmanId, arrestId, pi }) {
  const arrest = await db.get(`SELECT ${ARREST_COLS} FROM arrest_records WHERE id = ?`, [arrestId]);
  if (!arrest) return { arrest: null, created: false, refunded: false };
  const mine = await db.get(`SELECT id, stripe_pi_id FROM lead_purchases WHERE bondsman_id = ? AND arrest_id = ? AND status = 'charged' ORDER BY id LIMIT 1`, [bondsmanId, arrestId]);
  if (mine && mine.stripe_pi_id === pi.id) return { arrest, created: false, refunded: false };
  if (mine) {
    // Already owned through another payment: give this one back.
    const done = await db.get(`SELECT id FROM lead_purchases WHERE stripe_pi_id = ?`, [pi.id]);
    if (!done) {
      await db.run(
        `INSERT INTO lead_purchases (bondsman_id, arrest_id, bail_amount, lead_fee_cents, status, contact_revealed, stripe_pi_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'refunded', 0, ?, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [bondsmanId, arrestId, arrest.bail_amount, pi.amount, pi.id]);
      await refund(pi, 'lead_already_owned');
    }
    return { arrest, created: false, refunded: true };
  }
  const r = await db.run(
    `INSERT INTO lead_purchases (bondsman_id, arrest_id, bail_amount, lead_fee_cents, status, contact_revealed, stripe_pi_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'charged', 1, ?, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [bondsmanId, arrestId, arrest.bail_amount, pi.amount, pi.id]);
  if (r.changes) {
    await db.run('UPDATE bondsman_profiles SET leads_accepted = COALESCE(leads_accepted, 0) + 1 WHERE user_id = ?', [bondsmanId]);
    return { arrest, created: true, refunded: false };
  }
  // Lost a race with the other path (webhook vs confirm) for the same payment.
  const row = await db.get(`SELECT status FROM lead_purchases WHERE stripe_pi_id = ?`, [pi.id]);
  return { arrest, created: false, refunded: row?.status === 'refunded' };
}

/**
 * Case (PI / civil rights / employment / ICE) lead → { lead, created, refunded }.
 * `lead` carries the description and the consumer's contact details only for the buyer.
 */
export async function recordCaseLead(db, { attorneyId, leadId, pi }) {
  const claim = await db.run(
    `UPDATE pi_leads SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), fee_charged = ?, stripe_pi_id = ?,
            reserved_until = NULL, updated_at = NOW()
      WHERE id = ? AND (status = 'open' OR (status = 'reserved' AND (accepted_by = ? OR reserved_until < NOW())))`,
    [attorneyId, pi.amount, pi.id, leadId, attorneyId]);
  const created = !!claim.changes;
  const cur = await db.get('SELECT status, accepted_by, stripe_pi_id FROM pi_leads WHERE id = ?', [leadId]);
  if (!cur) return { lead: null, created: false, refunded: false };
  if (!created && !(cur.status === 'accepted' && Number(cur.accepted_by) === Number(attorneyId) && cur.stripe_pi_id === pi.id)) {
    // Someone else bought it (or this attorney already owns it through another payment).
    const refunded = await refund(pi, 'case_lead_taken');
    return { lead: null, created: false, refunded, taken: Number(cur.accepted_by) !== Number(attorneyId), owned: Number(cur.accepted_by) === Number(attorneyId) };
  }
  const lead = await db.get(
    `SELECT pl.id, pl.case_type, pl.incident_date, pl.description, pl.severity, pl.city, pl.state,
            pl.lead_fee_cents, pl.accepted_at,
            u.display_name AS contact_name, u.email AS contact_email, u.phone AS contact_phone
       FROM pi_leads pl LEFT JOIN users u ON u.id = pl.user_id
      WHERE pl.id = ? AND pl.accepted_by = ?`, [leadId, attorneyId]);
  return { lead, created, refunded: false };
}
