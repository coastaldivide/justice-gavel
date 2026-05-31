/**
 * subscriptionStateMachine.js
 *
 * Subscription states:
 *   trialing → active → past_due → canceled → unpaid
 *
 * Access rules:
 *   trialing:  full access
 *   active:    full access
 *   past_due:  grace period — 3 days full, then degraded
 *   canceled:  access until current_period_end, then free tier
 *   unpaid:    degraded immediately
 *
 * This module is the single source of truth for feature gating.
 */

export const SUB_STATES = {
  TRIALING:  'trialing',
  ACTIVE:    'active',
  PAST_DUE:  'past_due',
  CANCELED:  'canceled',
  UNPAID:    'unpaid',
};

const GRACE_PERIOD_DAYS = 3;

/**
 * Returns the effective access tier for a subscription.
 * @param {object} sub - subscription row from DB
 * @returns {'full'|'grace'|'degraded'|'free'}
 */
export function getAccessLevel(sub) {
  if (!sub) return 'free';
  const { status, current_period_end, canceled_at } = sub;

  if (status === SUB_STATES.ACTIVE || status === SUB_STATES.TRIALING)
    return 'full';

  if (status === SUB_STATES.PAST_DUE) {
    const graceExpiry = new Date(current_period_end || Date.now());
    graceExpiry.setDate(graceExpiry.getDate() + GRACE_PERIOD_DAYS);
    return new Date() < graceExpiry ? 'grace' : 'degraded';
  }

  if (status === SUB_STATES.CANCELED) {
    const periodEnd = new Date(current_period_end || 0);
    return new Date() < periodEnd ? 'full' : 'free';
  }

  return 'free'; // unpaid or unknown
}

export function canAccessFeature(sub, feature) {
  const level = getAccessLevel(sub);
  const FREE_FEATURES   = ['rights_cards','bail_calculator','emergency','crisis'];
  const PAID_FEATURES   = ['ai_chat','research','motions','case_management','attorney_match'];
  const FULL_FEATURES   = ['unlimited_ai','matter_intelligence','firm_platform'];

  if (level === 'full' || level === 'grace') return true;
  if (level === 'free')  return FREE_FEATURES.includes(feature);
  if (level === 'degraded') return FREE_FEATURES.includes(feature) || !FULL_FEATURES.includes(feature);
  return false;
}
