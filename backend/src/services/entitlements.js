/**
 * services/entitlements.js — what a person's plan unlocks, checked on the
 * server (never from client state).
 *
 * A subscriptions row grants access only in a paid state: 'trialing' or
 * 'active' (written after Stripe confirmed the card or the first payment —
 * routes/billing/subscriptions.js), or 'past_due' while Stripe retries the
 * card (Stripe then moves the subscription to canceled / unpaid and the webhook
 * syncs it). 'incomplete' (checkout not finished), 'canceled' and 'refunded'
 * grant nothing. Annual plans unlock their monthly plan's features.
 *
 * The feature lists are routes/billing/plans.js PLAN_FEATURES — the same list
 * GET /api/billing/tiers shows on the plan cards.
 */
import { planFeatures, monthlyKey } from '../routes/billing/plans.js';

export const PAID_STATUSES = Object.freeze(['trialing', 'active', 'past_due']);
const PAID_SQL = PAID_STATUSES.map(s => `'${s}'`).join(',');

/** The person's subscriptions that currently grant access (newest first). */
export async function activeSubscriptions(db, userId) {
  if (!userId) return [];
  return await db.all(
    `SELECT id, tier, status, provider_type, current_period_end, cancel_at_period_end
       FROM subscriptions
      WHERE user_id = ? AND status IN (${PAID_SQL})
      ORDER BY id DESC LIMIT 10`, [userId]);
}

/** True when one of the person's paid plans includes `feature` (FEATURES in plans.js). */
export async function hasFeature(db, userId, feature) {
  const subs = await activeSubscriptions(db, userId);
  return subs.some(s => planFeatures(s.tier).includes(feature));
}

/** True when the person has any paid plan (consumer or attorney). */
export async function hasPaidPlan(db, userId) {
  const subs = await activeSubscriptions(db, userId);
  return subs.some(s => !!monthlyKey(s.tier));
}
