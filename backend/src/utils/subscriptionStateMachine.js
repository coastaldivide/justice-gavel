/**
 * subscriptionStateMachine.js
 *
 * Subscription price tiers (Stripe product names):
 *   free         → $0/month    → basic rights info, bail calculator, emergency
 *   legal_radar  → $19.99/mo   → AI chat (3/day), research, case tracking
 *   advisor      → $24.99/mo   → AI chat (10/day), attorney match, motions
 *   legal_pro    → $34.99/mo   → unlimited AI, video consultation, firm features
 *   esquire      → $49.99/mo   → everything + priority + white-glove
 *
 * Subscription lifecycle states:
 *   trialing → active → past_due → canceled → unpaid
 *
 * Access levels derived from (tier + status):
 *   full      — active/trialing subscriber
 *   grace     — past_due within 3-day grace period
 *   degraded  — past_due beyond grace, or unpaid
 *   free      — no subscription, or canceled + period expired
 */

export const TIERS = {
  FREE:        'free',
  LEGAL_RADAR: 'legal_radar',
  ADVISOR:     'advisor',
  LEGAL_PRO:   'legal_pro',
  ESQUIRE:     'esquire',
};

export const TIER_ORDER = ['free','legal_radar','advisor','legal_pro','esquire'];

export const SUB_STATES = {
  TRIALING:  'trialing',
  ACTIVE:    'active',
  PAST_DUE:  'past_due',
  CANCELED:  'canceled',
  UNPAID:    'unpaid',
};

const GRACE_PERIOD_DAYS = 3;

// Feature matrix — which tiers get access to which features
const FEATURE_TIERS = {
  // Free features
  rights_cards:         ['free','legal_radar','advisor','legal_pro','esquire'],
  bail_calculator:      ['free','legal_radar','advisor','legal_pro','esquire'],
  emergency:            ['free','legal_radar','advisor','legal_pro','esquire'],
  crisis:               ['free','legal_radar','advisor','legal_pro','esquire'],
  attorney_search:      ['free','legal_radar','advisor','legal_pro','esquire'],
  bondsman_search:      ['free','legal_radar','advisor','legal_pro','esquire'],
  // Radar+ features
  ai_chat:              ['legal_radar','advisor','legal_pro','esquire'],
  ai_chat_daily_limit:  3,  // legal_radar gets 3/day
  case_tracking:        ['legal_radar','advisor','legal_pro','esquire'],
  expungement_check:    ['legal_radar','advisor','legal_pro','esquire'],
  research:             ['legal_radar','advisor','legal_pro','esquire'],
  // Advisor+ features
  attorney_match:       ['advisor','legal_pro','esquire'],
  ai_chat_10perday:     ['advisor','legal_pro','esquire'],
  motions:              ['advisor','legal_pro','esquire'],
  documents:            ['advisor','legal_pro','esquire'],
  // Legal Pro+ features
  video_consultation:   ['legal_pro','esquire'],
  unlimited_ai:         ['legal_pro','esquire'],
  matter_intelligence:  ['legal_pro','esquire'],
  firm_platform:        ['legal_pro','esquire'],
  conflict_check:       ['legal_pro','esquire'],
  // Esquire only
  priority_support:     ['esquire'],
  white_glove:          ['esquire'],
  api_access:           ['esquire'],
};

/**
 * Returns the effective access level given a subscription row.
 * @param {object|string|null} sub — subscription DB row OR tier string OR null
 * @returns {'full'|'grace'|'degraded'|'free'}
 */
export function getAccessLevel(sub) {
  if (!sub) return 'free';
  // Accept tier string directly (e.g. 'legal_pro') for quick checks
  if (typeof sub === 'string') return TIER_ORDER.includes(sub) ? 'full' : 'free';

  const { status, current_period_end } = sub;
  if (status === SUB_STATES.ACTIVE || status === SUB_STATES.TRIALING) return 'full';
  if (status === SUB_STATES.PAST_DUE) {
    const graceExpiry = new Date(current_period_end || Date.now());
    graceExpiry.setDate(graceExpiry.getDate() + GRACE_PERIOD_DAYS);
    return new Date() < graceExpiry ? 'grace' : 'degraded';
  }
  if (status === SUB_STATES.CANCELED) {
    const periodEnd = new Date(current_period_end || 0);
    return new Date() < periodEnd ? 'full' : 'free';
  }
  return 'free';
}

/**
 * Returns the subscription tier string.
 * @param {object|string|null} sub — subscription row or tier string
 * @returns {string} tier name
 */
export function getTier(sub) {
  if (!sub) return TIERS.FREE;
  if (typeof sub === 'string') return TIER_ORDER.includes(sub) ? sub : TIERS.FREE;
  return sub.tier || TIERS.FREE;
}

/**
 * Check if a sub has access to a specific feature.
 * @param {object|string|null} sub — subscription row or tier string
 * @param {string} feature — feature key from FEATURE_TIERS
 * @returns {boolean}
 */
export function canAccessFeature(sub, feature) {
  const level = getAccessLevel(sub);
  const tier  = getTier(sub);

  // Degraded/free users only get always-free features
  if (level === 'degraded' || level === 'free') {
    const freeFeatures = Object.entries(FEATURE_TIERS)
      .filter(([k,v]) => Array.isArray(v) && v.includes('free'))
      .map(([k]) => k);
    return freeFeatures.includes(feature);
  }

  // Full/grace access: check tier
  const allowed = FEATURE_TIERS[feature];
  if (!allowed) return false;
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(tier);
}

export { FEATURE_TIERS };
