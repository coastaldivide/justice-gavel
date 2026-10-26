/**
 * billing/plans.js — SINGLE SOURCE OF TRUTH for every plan the app sells:
 * names, prices, trial lengths and what each plan unlocks.
 *
 *   TIERS            consumer + attorney subscriptions (subscriptions table)
 *   BONDSMAN_TIERS   bail-agent subscriptions (bondsman_subscriptions table)
 *   PLAN_FEATURES    the features each plan unlocks — the same list the server
 *                    enforces (services/entitlements.js) and GET /billing/tiers
 *                    returns, so the plan cards can never promise more than the
 *                    code delivers.
 *
 * Every screen reads prices from GET /api/billing/tiers or
 * /api/billing/bondsman/tiers; the amounts charged come from here as well.
 * Dependency-free on purpose (services and tests import it directly).
 */


// ── Features (each one is enforced somewhere — see services/entitlements.js) ──
export const FEATURES = Object.freeze({
  AI_CHAT_UNLIMITED:   'ai_chat_unlimited',   // routes/chat/_helpers.js  (free: 3 questions a day)
  LEGAL_RESEARCH:      'legal_research',      // routes/research.js
  BAR_PREP:            'bar_prep',            // routes/barPrep.js        (free: 10-question sample)
  INTERPRETER:         'interpreter',         // routes/translate.js      POST /message
  AUDIO_TRANSCRIPTION: 'audio_transcription', // routes/transcribe.js     POST /audio
  VIDEO_CONSULTATION:  'video_consultation',  // routes/video.js
  ARREST_MONITOR:      'arrest_monitor',      // routes/arrests.js        POST /monitors
});

const RADAR = [FEATURES.AI_CHAT_UNLIMITED, FEATURES.LEGAL_RESEARCH, FEATURES.BAR_PREP, FEATURES.INTERPRETER];
const ADVISOR = [...RADAR, FEATURES.AUDIO_TRANSCRIPTION];
const PRO = [...ADVISOR, FEATURES.VIDEO_CONSULTATION, FEATURES.ARREST_MONITOR];

/** Monthly plan key → features. Annual plans use their monthly plan's list. */
export const PLAN_FEATURES = Object.freeze({
  case_pass:   Object.freeze(ADVISOR),   // one-time 90-day pass (CASE_PASS)
  legal_radar: Object.freeze(RADAR),
  advisor:     Object.freeze(ADVISOR),
  legal_pro:   Object.freeze(PRO),
  esquire:     Object.freeze(PRO),
});

// ── Consumer and attorney plans ───────────────────────────────────────────────
// monthly_cents = the charge per month (monthly plans) or annual_cents / 12
//                 (annual plans, shown as "only $X/mo"); annual_cents = the
//                 yearly charge. trial_days: a card is required to start a trial
//                 (nothing unlocks before Stripe has confirmed the card).
export const TIERS = Object.freeze({
  // Oct 26 2026 pricing (docs/MONETIZATION_PLAN.md, competitor-matched): one consumer plan,
  // Legal Pro $19.99/mo or $149/yr, plus the one-time Case Pass. Legal Radar and 24 Hour Advisor
  // are retired (legacy: kept so old rows still resolve, never sold).
  legal_radar: {
    legacy: true, audience: 'consumer', name: 'Legal Radar', display_price: '$19.99/mo',
    price_env: 'STRIPE_LEGAL_RADAR_ID', price_id: process.env.STRIPE_LEGAL_RADAR_ID || null, monthly_cents: 1999, annual_cents: null,
    billing: 'monthly', tier_rank: 1, trial_days: 7,
  },
  advisor: {
    legacy: true, audience: 'consumer', name: '24 Hour Advisor', display_price: '$24.99/mo',
    price_env: 'STRIPE_ADVISOR_PRICE_ID', price_id: process.env.STRIPE_ADVISOR_PRICE_ID || null, monthly_cents: 2499, annual_cents: null,
    billing: 'monthly', tier_rank: 2, trial_days: 7,
  },
  legal_pro: {
    audience: 'consumer', name: 'Legal Pro', display_price: '$19.99/mo',
    price_env: 'STRIPE_LEGAL_PRO_PRICE_ID', price_id: process.env.STRIPE_LEGAL_PRO_PRICE_ID || null, monthly_cents: 1999, annual_cents: null,
    billing: 'monthly', tier_rank: 3, trial_days: 7,
  },
  esquire: {
    audience: 'attorney', name: 'Justice Gavel Esquire', display_price: '$49.00/mo',
    price_env: 'STRIPE_ESQUIRE_PRICE_ID', price_id: process.env.STRIPE_ESQUIRE_PRICE_ID || null, monthly_cents: 4900, annual_cents: null,
    billing: 'monthly', tier_rank: 4, trial_days: 30,
  },
  advisor_annual: {
    legacy: true, audience: 'consumer', name: '24 Hour Advisor (Annual)', display_price: '$16.58/mo billed $199/yr',
    price_env: 'STRIPE_ADVISOR_ANNUAL_ID', price_id: process.env.STRIPE_ADVISOR_ANNUAL_ID || null, monthly_cents: 1658, annual_cents: 19900,
    billing: 'annual', tier_rank: 2, trial_days: 7, matches_monthly: 'advisor',
  },
  pro_annual: {
    audience: 'consumer', name: 'Legal Pro (Annual)', display_price: '$12.42/mo billed $149/yr',
    price_env: 'STRIPE_LEGAL_PRO_ANNUAL_ID', price_id: process.env.STRIPE_LEGAL_PRO_ANNUAL_ID || null, monthly_cents: 1242, annual_cents: 14900,
    billing: 'annual', tier_rank: 3, trial_days: 7, matches_monthly: 'legal_pro',
  },
  esquire_annual: {
    audience: 'attorney', name: 'Justice Gavel Esquire (Annual)', display_price: '$34.17/mo billed $410/yr',
    price_env: 'STRIPE_ESQUIRE_ANNUAL_ID', price_id: process.env.STRIPE_ESQUIRE_ANNUAL_ID || null, monthly_cents: 3417, annual_cents: 41000,
    billing: 'annual', tier_rank: 4, trial_days: 7, matches_monthly: 'esquire',
  },
  // Legacy aliases — only so old subscriptions keep their access. Never sold.
  starter_annual:  { legacy: true, audience: 'consumer', name: 'Advisor Annual (legacy)', price_env: 'STRIPE_ADVISOR_ANNUAL_ID', price_id: process.env.STRIPE_ADVISOR_ANNUAL_ID || null,
    monthly_cents: 1658, annual_cents: 19900, billing: 'annual', tier_rank: 2, trial_days: 0, matches_monthly: 'advisor' },
  attorney_annual: { legacy: true, audience: 'attorney', name: 'Esquire Annual (legacy)', price_env: 'STRIPE_ESQUIRE_ANNUAL_ID', price_id: process.env.STRIPE_ESQUIRE_ANNUAL_ID || null,
    monthly_cents: 3417, annual_cents: 41000, billing: 'annual', tier_rank: 4, trial_days: 0, matches_monthly: 'esquire' },
});

// ── Bail-agent plans: new-arrest alerts for the counties the agent covers ─────
// A flat recurring price for market access (no bail-scaled component). A plan
// sends a push alert when a new arrest record with bail set lands in one of the
// first `counties` counties saved on the agent's profile (ALL_COUNTIES = every
// county); services/leadAlerts.js. Browsing the lead list needs no plan, and
// every lead is bought separately at the flat fee in ./leadFee.js.
export const ALL_COUNTIES = 999;

/** Texts sent on a bail agent's behalf (check-in / court / payment reminders): 5¢ each, billed monthly. */
export const AGENT_TEXT_CENTS = 5;

/**
 * One-time Case Pass: the Legal Pro features for 90 days, no renewal. $19 to extend 90 days.
 * Sold as a single Stripe PaymentIntent (routes/billing/casePass.js); each payment is a
 * case_passes row (90 days from the end of the current pass, or now) and grants
 * PLAN_FEATURES.case_pass until then (services/entitlements.js).
 */
export const CASE_PASS = Object.freeze({ cents: 2900, extend_cents: 1900, days: 90, display: '$29 for 90 days', extend_display: '$19 for 90 more days' });

/**
 * Attorney marketing products, priced to match the market (Avvo Pro $49.95/mo; LegalMatch from
 * $455/mo). NOT SOLD YET: the profile perks (Pro badge, photo/bio, profile stats) and exclusive
 * case-match requests are not built. Selling them before they exist would be a deceptive claim
 * (FTC Act § 5). Flip `on_sale` only when the features ship.
 */
export const ATTORNEY_MARKETING = Object.freeze({
  pro_profile: { name: 'Pro Profile', monthly_cents: 4995, annual_cents: 49900, on_sale: false },
  case_match:  { name: 'Case Match', monthly_cents: 45500, annual_cents: null, on_sale: false },
});
export const BONDSMAN_TIERS = Object.freeze({
  // Oct 26 2026: matched to eBail's published tiers ($99 / $199 / $349 a month, 20% off annual).
  // Check-ins, court reminders and the Bond Desk (bonds, paperwork + e-sign, receivables) are
  // included; texts sent for the agent are metered at AGENT_TEXT_CENTS each (Captira/eBail: 5¢).
  starter: {
    name: 'Bondsman Starter', monthly_cents: 9900, display: '$99/mo', counties: 1,
    price_env: 'STRIPE_BONDSMAN_STARTER_ID', price_id: process.env.STRIPE_BONDSMAN_STARTER_ID || null, annual_cents: 95000, annual_price_env: 'STRIPE_BONDSMAN_STARTER_ANNUAL_ID', annual_price_id: process.env.STRIPE_BONDSMAN_STARTER_ANNUAL_ID || null,
  },
  pro: {
    name: 'Bondsman Pro', monthly_cents: 19900, display: '$199/mo', counties: 3,
    price_env: 'STRIPE_BONDSMAN_PRO_ID', price_id: process.env.STRIPE_BONDSMAN_PRO_ID || null, annual_cents: 191000, annual_price_env: 'STRIPE_BONDSMAN_PRO_ANNUAL_ID', annual_price_id: process.env.STRIPE_BONDSMAN_PRO_ANNUAL_ID || null,
  },
  market: {
    name: 'Bondsman Market', monthly_cents: 34900, display: '$349/mo', counties: ALL_COUNTIES,
    price_env: 'STRIPE_BONDSMAN_MARKET_ID', price_id: process.env.STRIPE_BONDSMAN_MARKET_ID || null, annual_cents: 335000, annual_price_env: 'STRIPE_BONDSMAN_MARKET_ANNUAL_ID', annual_price_id: process.env.STRIPE_BONDSMAN_MARKET_ANNUAL_ID || null,
  },
});

/** 'pro_annual' → 'legal_pro'; a monthly key stays itself; unknown → null. */
export function monthlyKey(tier) {
  const t = TIERS[tier];
  if (!t) return null;
  return t.matches_monthly || tier;
}

/** Features a plan unlocks (annual plans: their monthly plan's list). */
export function planFeatures(tier) {
  if (tier === 'case_pass') return PLAN_FEATURES.case_pass;
  return PLAN_FEATURES[monthlyKey(tier)] || [];
}

/** The amount charged per billing period for a plan, and the period. */
export function chargeFor(tier) {
  const t = TIERS[tier];
  if (!t) return null;
  return t.billing === 'annual'
    ? { cents: t.annual_cents, interval: 'year' }
    : { cents: t.monthly_cents, interval: 'month' };
}

export function bondsmanCharge(tier, billing = 'monthly') {
  const t = BONDSMAN_TIERS[tier];
  if (!t) return null;
  return billing === 'annual'
    ? { cents: t.annual_cents, interval: 'year', price_id: t.annual_price_id }
    : { cents: t.monthly_cents, interval: 'month', price_id: t.price_id };
}

/**
 * Which plan a Stripe price belongs to (webhooks / plan changes): by configured
 * price id first, then by amount + interval (plans created with inline
 * price_data). Returns { kind: 'tier'|'bondsman', key, billing } or null.
 */
export function planForPrice(price) {
  if (!price) return null;
  const id = typeof price === 'string' ? price : price.id;
  const amount = typeof price === 'object' ? Number(price.unit_amount) : NaN;
  const interval = typeof price === 'object' ? price.recurring?.interval : null;
  for (const [key, t] of Object.entries(BONDSMAN_TIERS)) {
    if (id && t.price_id === id) return { kind: 'bondsman', key, billing: 'monthly' };
    if (id && t.annual_price_id === id) return { kind: 'bondsman', key, billing: 'annual' };
  }
  for (const [key, t] of Object.entries(TIERS)) {
    if (!t.legacy && id && t.price_id === id) return { kind: 'tier', key, billing: t.billing };
  }
  if (!Number.isFinite(amount) || !interval) return null;
  for (const [key, t] of Object.entries(TIERS)) {
    const c = chargeFor(key);
    if (!t.legacy && c.cents === amount && c.interval === interval) return { kind: 'tier', key, billing: t.billing };
  }
  for (const [key, t] of Object.entries(BONDSMAN_TIERS)) {
    if (interval === 'month' && t.monthly_cents === amount) return { kind: 'bondsman', key, billing: 'monthly' };
    if (interval === 'year' && t.annual_cents === amount) return { kind: 'bondsman', key, billing: 'annual' };
  }
  return null;
}

/** "$19.99" / "$100" — dollars for a cents amount (whole dollars without decimals). */
export function usd(cents) {
  const n = Number(cents) / 100;
  return Number.isInteger(n) ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}
