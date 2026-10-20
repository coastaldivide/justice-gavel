/**
 * services/subscriptionStore.js — our copy of a Stripe subscription.
 *
 * Plans for consumers and attorneys live in `subscriptions`, bail-agent plans in
 * `bondsman_subscriptions`. A row is written as 'incomplete' when the checkout
 * starts and takes Stripe's status only once the subscription is paid for
 * (stripeBilling.subscriptionPaid) — by the app's confirm call or by the
 * webhook, whichever comes first; both are idempotent (keyed by stripe_sub_id).
 */
import { TIERS, BONDSMAN_TIERS, chargeFor, bondsmanCharge, planForPrice } from '../routes/billing/plans.js';
import { periodEnd, trialEnd, subscriptionPaid } from './stripeBilling.js';

const providerTypeOf = (tier) => (TIERS[tier]?.audience === 'attorney' ? 'lawyer' : 'consumer');

/** Stripe statuses we keep; anything else (incomplete_expired, unpaid, paused) grants nothing. */
const KEEP = new Set(['trialing', 'active', 'past_due', 'canceled']);
const ourStatus = (s) => (KEEP.has(s) ? s : s === 'incomplete' ? 'incomplete' : 'canceled');

/** Which plan a Stripe subscription is on now: its price first (a plan change), then its metadata. */
export function planOf(sub) {
  const fromPrice = planForPrice(sub?.items?.data?.[0]?.price);
  const kind = sub?.metadata?.kind === 'bondsman' || sub?.metadata?.type === 'bondsman_tier' ? 'bondsman' : 'tier';
  if (fromPrice && (fromPrice.kind === 'bondsman') === (kind === 'bondsman')) return { kind, tier: fromPrice.key, billing: fromPrice.billing };
  const tier = sub?.metadata?.tier;
  if (kind === 'bondsman' ? BONDSMAN_TIERS[tier] : TIERS[tier]) return { kind, tier, billing: sub.metadata.billing === 'annual' ? 'annual' : (TIERS[tier]?.billing || 'monthly') };
  return null;
}

/** Row written when a sheet checkout starts: grants nothing until it is paid. */
export async function recordIncomplete(db, { userId, kind, tier, billing, stripeSubId, customer, cents }) {
  if (kind === 'bondsman') {
    await db.run(
      `INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, stripe_cus_id, amount_cents, billing_period, created_at, updated_at)
       VALUES (?, ?, 'incomplete', ?, ?, ?, ?, NOW(), NOW())`,
      [userId, tier, stripeSubId, customer, cents, billing]);
    return;
  }
  await db.run(
    `INSERT INTO subscriptions (user_id, provider_type, tier, status, amount_cents, stripe_sub_id, stripe_cus_id, created_at, updated_at)
     VALUES (?, ?, ?, 'incomplete', ?, ?, ?, NOW(), NOW())`,
    [userId, providerTypeOf(tier), tier, cents, stripeSubId, customer]);
}

/**
 * Bring our row in line with a Stripe subscription. `paid` must be true before an
 * 'incomplete' row may take a paying status (the caller checked subscriptionPaid).
 * Creates the row when it does not exist yet (Checkout). Returns the row.
 */
export async function syncFromStripe(db, sub, { paid = subscriptionPaid(sub) } = {}) {
  const plan = planOf(sub);
  const userId = Number(sub?.metadata?.user_id);
  if (!plan || !Number.isSafeInteger(userId) || userId <= 0) return null;
  const status = ourStatus(sub.status);
  const cancelFlag = sub.cancel_at_period_end ? 1 : 0;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null;

  if (plan.kind === 'bondsman') {
    const cents = bondsmanCharge(plan.tier, plan.billing)?.cents ?? null;
    const existing = await db.get('SELECT id, status FROM bondsman_subscriptions WHERE stripe_sub_id = ? ORDER BY id LIMIT 1', [sub.id]);
    if (!existing) {
      if (!paid && status !== 'canceled') return null;
      await db.run(
        `INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, stripe_cus_id, amount_cents, billing_period, renews_at, cancel_at_period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [userId, plan.tier, status, sub.id, customer, cents, plan.billing, periodEnd(sub), cancelFlag]);
    } else {
      const next = existing.status === 'incomplete' && !paid && status !== 'canceled' ? 'incomplete' : status;
      await db.run(
        `UPDATE bondsman_subscriptions SET tier = ?, status = ?, amount_cents = ?, billing_period = ?, renews_at = ?,
                cancel_at_period_end = ?, cancelled_at = CASE WHEN ? = 'canceled' THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END,
                updated_at = NOW()
          WHERE id = ?`,
        [plan.tier, next, cents, plan.billing, periodEnd(sub), cancelFlag, next, existing.id]);
    }
    return db.get('SELECT id, user_id, tier, status, billing_period, renews_at, cancel_at_period_end FROM bondsman_subscriptions WHERE stripe_sub_id = ? ORDER BY id LIMIT 1', [sub.id]);
  }

  const cents = chargeFor(plan.tier)?.cents ?? null;
  const existing = await db.get('SELECT id, status FROM subscriptions WHERE stripe_sub_id = ? ORDER BY id LIMIT 1', [sub.id]);
  if (!existing) {
    if (!paid && status !== 'canceled') return null;
    await db.run(
      `INSERT INTO subscriptions (user_id, provider_type, tier, status, amount_cents, stripe_sub_id, stripe_cus_id,
                                  trial_ends_at, current_period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [userId, providerTypeOf(plan.tier), plan.tier, status, cents, sub.id, customer, trialEnd(sub), periodEnd(sub), cancelFlag]);
  } else {
    const next = existing.status === 'incomplete' && !paid && status !== 'canceled' ? 'incomplete' : status;
    await db.run(
      `UPDATE subscriptions SET tier = ?, provider_type = ?, status = ?, amount_cents = ?, trial_ends_at = ?,
              current_period_end = ?, cancel_at_period_end = ?, updated_at = NOW()
        WHERE id = ? AND status <> 'refunded'`,
      [plan.tier, providerTypeOf(plan.tier), next, cents, trialEnd(sub), periodEnd(sub), cancelFlag, existing.id]);
  }
  return db.get(
    `SELECT id, user_id, provider_type, tier, status, amount_cents, trial_ends_at, current_period_end, cancel_at_period_end
       FROM subscriptions WHERE stripe_sub_id = ? ORDER BY id LIMIT 1`, [sub.id]);
}

/** Mark our row by Stripe id (invoice failed / subscription deleted). Never revives a refunded row. */
export async function setStatusByStripeId(db, stripeSubId, status) {
  await db.run(`UPDATE subscriptions SET status = ?, updated_at = NOW() WHERE stripe_sub_id = ? AND status NOT IN ('refunded', 'incomplete')`, [status, stripeSubId]);
  await db.run(
    `UPDATE bondsman_subscriptions SET status = ?, updated_at = NOW(),
            cancelled_at = CASE WHEN ? = 'canceled' THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END
      WHERE stripe_sub_id = ? AND status <> 'incomplete'`, [status, status, stripeSubId]);
}
