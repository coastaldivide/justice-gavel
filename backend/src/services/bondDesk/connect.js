/**
 * services/bondDesk/connect.js — card payments for bail agencies through Stripe Connect
 * (Express accounts). docs/BOND_DESK.md "Card payments".
 *
 * Money a defendant or indemnitor pays goes to the agency, never to Justice Gavel: every card
 * payment is a DIRECT charge on the agency's own connected account (Checkout / PaymentIntent
 * created with the Stripe-Account header). The agency is the merchant of record (its name on the
 * card statement), Stripe's processing fee is taken from the agency's balance by Stripe, saved
 * cards (customers, payment methods) live on the agency's account, and Justice Gavel's 99¢ per
 * automatic charge is the charge's application fee (plans.js AUTOPAY_FEE_CENTS).
 *
 * Onboarding: the owner reads the fee terms and taps "Set up card payments" → an Express account
 * is created once (metadata.agent_id) and Stripe's hosted onboarding opens (account link). Stripe
 * sends account.updated to the Connect webhook; the flags (charges_enabled, payouts_enabled,
 * details_submitted) are copied to bd_connect_accounts. The app also re-reads the account when
 * the owner comes back from onboarding.
 */
import crypto from 'node:crypto';
import { stripeClient } from '../../routes/billing/_shared.js';
import { stripeConfigured } from '../../config.js';
import { AUTOPAY_FEE_CENTS, PAY_LINK_MIN_CENTS, PAY_LINK_MAX_CENTS } from '../../routes/billing/plans.js';
import { agencyFor } from './core.js';
import { LedgerError } from './payments.js';
import logger from '../../utils/logger.js';

export const appUrl = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
export const payPageLink = (slug) => (slug ? `${appUrl()}/pay/${slug}` : null);
const newSlug = () => {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(14), (b) => abc[b % abc.length]).join('');
};

/** Stripe, or 503 payments_unavailable. */
export function stripeOr503() {
  const s = stripeConfigured() ? stripeClient() : null;
  if (!s) throw new LedgerError(503, 'payments_unavailable');
  return s;
}

const stateOf = (row) => {
  if (!row) return 'none';
  if (row.charges_enabled) return 'enabled';
  return row.details_submitted ? 'restricted' : 'onboarding';
};

/** What the Bond Desk settings screen shows about card payments. */
export async function connectState(db, agentId, { autopayOn = false } = {}) {
  const row = await db.get('SELECT * FROM bd_connect_accounts WHERE agent_id = ?', [agentId]);
  return {
    status: stateOf(row),
    charges_enabled: !!row?.charges_enabled,
    payouts_enabled: !!row?.payouts_enabled,
    details_submitted: !!row?.details_submitted,
    disabled_reason: row?.disabled_reason || null,
    fees_acknowledged_at: row?.fees_ack_at || null,
    pay_link: row?.charges_enabled && row?.pay_link_on ? payPageLink(row.pay_slug) : null,
    pay_link_on: row ? !!row.pay_link_on : false,
    payments_live: stripeConfigured(),
    autopay_available: autopayOn,
    autopay_fee_cents: AUTOPAY_FEE_CENTS,
    pay_link_limits: { min_cents: PAY_LINK_MIN_CENTS, max_cents: PAY_LINK_MAX_CENTS },
  };
}

/** Copy an Account object's flags (webhook account.updated, or a fresh retrieve). */
export async function syncAccount(db, account) {
  if (!account?.id) return null;
  const r = await db.get(
    `UPDATE bd_connect_accounts SET charges_enabled = ?, payouts_enabled = ?, details_submitted = ?, disabled_reason = ?, updated_at = NOW()
      WHERE stripe_account_id = ? RETURNING agent_id`,
    [!!account.charges_enabled, !!account.payouts_enabled, !!account.details_submitted,
      account.requirements?.disabled_reason ? String(account.requirements.disabled_reason).slice(0, 120) : null, account.id]);
  return r ? Number(r.agent_id) : null;
}

/**
 * Create the agency's Express account (once) and a fresh onboarding link. The owner must have
 * acknowledged the fees (Stripe's card fee is the agency's; 99¢ per automatic payment). → { url }
 */
export async function startOnboarding(db, { agentId, user }) {
  const stripe = stripeOr503();
  let row = await db.get('SELECT * FROM bd_connect_accounts WHERE agent_id = ?', [agentId]);
  if (!row) {
    const a = await agencyFor(db, agentId);
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: a.email || user?.email || undefined,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: a.agency || undefined, product_description: 'Bail bond premium and fees', support_phone: a.phone || undefined },
      metadata: { agent_id: String(agentId), source: 'justice_gavel_bond_desk' },
    }, { idempotencyKey: `bd-connect-account-${agentId}` });
    row = await db.get(
      `INSERT INTO bd_connect_accounts (agent_id, stripe_account_id, fees_ack_at, pay_slug) VALUES (?, ?, NOW(), ?)
       ON CONFLICT (agent_id) DO UPDATE SET fees_ack_at = bd_connect_accounts.fees_ack_at RETURNING *`,
      [agentId, account.id, newSlug()]);
    await syncAccount(db, account);
  }
  const link = await stripe.accountLinks.create({
    account: row.stripe_account_id,
    refresh_url: `${appUrl()}/bond-desk/settings?connect=refresh`,
    return_url: `${appUrl()}/bond-desk/settings?connect=return`,
    type: 'account_onboarding',
  });
  return { url: link.url };
}

/** Re-read the account from Stripe (the owner came back from onboarding). */
export async function refreshAccount(db, agentId) {
  const row = await db.get('SELECT stripe_account_id FROM bd_connect_accounts WHERE agent_id = ?', [agentId]);
  if (!row) return;
  const stripe = stripeOr503();
  try { await syncAccount(db, await stripe.accounts.retrieve(row.stripe_account_id)); } catch (e) {
    logger.warn({ err: e?.message }, '[bond-desk] connect account refresh failed');
    throw new LedgerError(502, 'stripe_unreachable');
  }
}

/** A sign-in link to the agency's Stripe Express dashboard (payouts, payments, disputes). */
export async function dashboardLink(db, agentId) {
  const row = await db.get('SELECT stripe_account_id, details_submitted FROM bd_connect_accounts WHERE agent_id = ?', [agentId]);
  if (!row?.details_submitted) throw new LedgerError(409, 'payments_not_set_up');
  const stripe = stripeOr503();
  const link = await stripe.accounts.createLoginLink(row.stripe_account_id);
  return { url: link.url };
}

/** The agency's account when it can take card payments now; otherwise 409 payments_not_set_up. */
export async function chargeableAccount(db, agentId) {
  const row = await db.get('SELECT * FROM bd_connect_accounts WHERE agent_id = ?', [agentId]);
  if (!row?.charges_enabled) throw new LedgerError(409, 'payments_not_set_up');
  return row;
}

/** Turn the public pay page on or off (the slug stays the same). */
export async function setPayLink(db, agentId, on) {
  const r = await db.run('UPDATE bd_connect_accounts SET pay_link_on = ?, updated_at = NOW() WHERE agent_id = ?', [!!on, agentId]);
  if (!r.changes) throw new LedgerError(409, 'payments_not_set_up');
}
