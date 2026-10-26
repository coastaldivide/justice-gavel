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
 * A one-time Case Pass (case_passes) unlocks PLAN_FEATURES.case_pass until it ends.
 *
 * The feature lists are routes/billing/plans.js PLAN_FEATURES — the same list
 * GET /api/billing/tiers shows on the plan cards.
 */
import { planFeatures, monthlyKey } from '../routes/billing/plans.js';
import { activeFamilyPass } from './casePass.js';

export const PAID_STATUSES = Object.freeze(['trialing', 'active', 'past_due']);
const PAID_SQL = PAID_STATUSES.map(s => `'${s}'`).join(',');

/**
 * The person's plans that currently grant access (newest first): paid subscriptions, plus a
 * one-time Case Pass while it lasts (case_passes; shown as tier 'case_pass').
 */
export async function activeSubscriptions(db, userId) {
  if (!userId) return [];
  const subs = await db.all(
    `SELECT id, tier, status, provider_type, current_period_end, cancel_at_period_end
       FROM subscriptions
      WHERE user_id = ? AND status IN (${PAID_SQL})
      ORDER BY id DESC LIMIT 10`, [userId]);
  const pass = await db.get(
    `SELECT MAX(ends_at) AS ends_at FROM case_passes WHERE user_id = ? HAVING MAX(ends_at) > NOW()`, [userId]).catch(() => null);
  if (pass?.ends_at) {
    subs.push({ id: null, tier: 'case_pass', status: 'active', provider_type: 'case_pass', current_period_end: pass.ends_at, cancel_at_period_end: 1 });
  } else {
    // A Family Case Pass bought by someone in this person's case circle.
    const fam = await activeFamilyPass(db, userId);
    if (fam?.ends_at) subs.push({ id: null, tier: 'case_pass', status: 'active', provider_type: 'family_case_pass', current_period_end: fam.ends_at, cancel_at_period_end: 1 });
  }
  return subs;
}

/** True when one of the person's paid plans includes `feature` (FEATURES in plans.js). */
export async function hasFeature(db, userId, feature) {
  const subs = await activeSubscriptions(db, userId);
  return subs.some(s => planFeatures(s.tier).includes(feature));
}

/** True when the person has any paid plan (consumer or attorney). */
export async function hasPaidPlan(db, userId) {
  const subs = await activeSubscriptions(db, userId);
  return subs.some(s => !!monthlyKey(s.tier) || s.tier === 'case_pass');
}
