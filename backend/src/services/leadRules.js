/**
 * services/leadRules.js — SINGLE SOURCE OF TRUTH for how attorneys may pay for
 * case leads, state by state (docs/LEAD_FEE_RULES.md, Oct 26 2026).
 *
 * Rules that apply everywhere (enforced in routes/billing/pi_leads.js):
 *   R1  Flat price per lead type. It never changes with retention, the case's
 *       value or the lawyer's fee; never a percentage (ABA Model Rule 5.4).
 *   R2  No recommendation: matching is by disclosed, neutral criteria only
 *       (state, city, case type) and every lead screen shows LEAD_DISCLOSURE.
 *   R3  The person asked to be contacted; attorneys only answer requests.
 *
 * Modes:
 *   per_lead        pay for one lead at a time (Stripe), or spend credits
 *   credits         only prepaid credit packs: a fixed number of credits at a fixed
 *                   price, spent on requests the lawyer chooses (Tenn. Op. 2018-F-165:
 *                   "fixed-price quote packages" used at the lawyer's discretion)
 *   subscription    only a flat periodic fee for chosen areas (Tex. Ops. 561, 573) —
 *                   no per-lead sale; the subscription product is not on sale yet,
 *                   so leads in these states are not sold
 *   directory_only  no lead sales at all; people call listed lawyers directly
 *
 * `registration` names a filing the operator must complete first; until the
 * matching env flag is set, that state is treated as directory_only.
 *
 * Imports only the dependency-free fee table (routes/billing/attorneyLeadFee.js).
 */
import { LEAD_CREDIT_CENTS } from '../routes/billing/attorneyLeadFee.js';

export const LEAD_MODES = Object.freeze({
  PER_LEAD: 'per_lead', CREDITS: 'credits', SUBSCRIPTION: 'subscription', DIRECTORY_ONLY: 'directory_only',
});

export const LEAD_DISCLOSURE =
  'Justice Gavel does not recommend or endorse any lawyer. Lawyers pay to receive requests. ' +
  'Requests are shown by state, city and case type only, and the price never depends on whether you hire the lawyer.';

/** Every state not listed uses DEFAULT_RULE (ABA Model Rule 7.2 framework). */
export const DEFAULT_RULE = Object.freeze({
  mode: LEAD_MODES.CREDITS,
  source: 'ABA Model Rule 7.2(b)(1) and cmt. [5]; Rule 5.4(a)',
  note: 'Default: prepaid credit packs, flat per lead type.',
});

export const STATE_LEAD_RULES = Object.freeze({
  TN: { mode: LEAD_MODES.CREDITS, source: 'Tenn. Formal Ethics Op. 2018-F-165',
        note: 'Fixed-price quote packages the lawyer uses at their discretion are allowed; fees by the number of people who contact or hire the lawyer are not.' },
  NY: { mode: LEAD_MODES.PER_LEAD, source: 'NYSBA Ethics Op. 1294 (Mar. 2026); Op. 1131',
        note: 'Per-lead or credits, if no recommendation, neutral disclosed selection, and the price does not vary with retention or fee.' },
  WA: { mode: LEAD_MODES.PER_LEAD, source: 'WSBA Advisory Op. 201401',
        note: 'Flat, monthly or pay-per-click; matching on disclosed objective criteria.' },
  TX: { mode: LEAD_MODES.SUBSCRIPTION, source: 'Tex. Ethics Ops. 561, 573; Tex. Penal Code § 38.12',
        note: 'Fixed subscription for chosen areas only; paid solicitation is barratry.' },
  FL: { mode: LEAD_MODES.CREDITS, registration: 'FL_QUALIFYING_PROVIDER', source: 'R. Regulating Fla. Bar 4-7.22',
        note: 'Register as a Qualifying Provider and file annual reports first; no fee division.' },
  CA: { mode: LEAD_MODES.DIRECTORY_ONLY, registration: 'CA_CERTIFIED_LRS', registered_mode: LEAD_MODES.CREDITS,
        source: 'Cal. Bus. & Prof. Code § 6155; Jackson v. LegalMatch.com (2019); AB 931 / SB 37 (2026)',
        note: 'Sending a request to chosen lawyers is a referral and needs State Bar certification.' },
  CO: { mode: LEAD_MODES.DIRECTORY_ONLY, source: 'Colo. SB 26-174, C.R.S. § 6-1-741 (eff. Aug. 12, 2026)',
        note: 'Lead generation for legal services is banned in every form, including subscriptions.' },
  NJ: { mode: LEAD_MODES.CREDITS, source: 'N.J. ACPE Op. 732 / CAA Op. 44 / UPL Op. 54 (2017)', note: 'Flat fees only; no per-matter marketing fee.' },
  OH: { mode: LEAD_MODES.CREDITS, source: 'Ohio Bd. Prof. Conduct Op. 2016-3', note: 'Flat fees only; no per-matter marketing fee.' },
  PA: { mode: LEAD_MODES.CREDITS, source: 'Pa. Bar Ass’n Formal Op. 2016-200', note: 'Flat fees only; no per-matter marketing fee.' },
  SC: { mode: LEAD_MODES.CREDITS, source: 'S.C. Ethics Adv. Op. 16-06', note: 'Flat fees only; no per-matter marketing fee.' },
});

/** Env flags that record a completed registration (set by the operator, never by code). */
export const REGISTRATION_ENV = Object.freeze({
  FL_QUALIFYING_PROVIDER: 'LEAD_REG_FL_QUALIFYING_PROVIDER',
  CA_CERTIFIED_LRS: 'LEAD_REG_CA_CERTIFIED_LRS',
});

const registered = (key, env) => !!key && env[REGISTRATION_ENV[key]] === '1';

/** The registration flags as the server sees them now (read by name so config.js / the env docs list them). */
const serverEnv = () => ({
  LEAD_REG_FL_QUALIFYING_PROVIDER: process.env.LEAD_REG_FL_QUALIFYING_PROVIDER,
  LEAD_REG_CA_CERTIFIED_LRS: process.env.LEAD_REG_CA_CERTIFIED_LRS,
});

/** The rule in force for a 2-letter state code: { state, mode, source, note, registration, registered }. */
export function leadRuleFor(state, env = serverEnv()) {
  const code = String(state || '').trim().toUpperCase();
  const base = STATE_LEAD_RULES[code] || DEFAULT_RULE;
  let mode = base.mode;
  const reg = base.registration || null;
  const done = reg ? registered(reg, env) : true;
  if (reg && done && base.registered_mode) mode = base.registered_mode;
  if (reg && !done) mode = LEAD_MODES.DIRECTORY_ONLY;
  return { state: code || null, mode, source: base.source, note: base.note, registration: reg, registered: done };
}

/** May a lead in this state be bought one at a time with a card? */
export const allowsPerLeadPayment = (state, env) => leadRuleFor(state, env).mode === LEAD_MODES.PER_LEAD;
/** May a lead in this state be claimed with prepaid credits? */
export const allowsCredits = (state, env) => {
  const m = leadRuleFor(state, env).mode;
  return m === LEAD_MODES.PER_LEAD || m === LEAD_MODES.CREDITS;
};
/** Is any lead sale possible in this state right now? */
export const leadsSellable = (state, env) => allowsCredits(state, env);

/** States where leads may be sold right now (for SQL filters). */
export function sellableStates(env = serverEnv()) {
  const all = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO',
    'MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  return all.filter(s => leadsSellable(s, env));
}

// ── Credit packs (prepaid, fixed price per credit, never refunded for outcome) ──
/** One credit = $25. A lead costs a fixed number of credits by type (= its flat fee). */
export const CREDIT_CENTS = LEAD_CREDIT_CENTS;
export const CREDIT_PACKS = Object.freeze({
  pack_20:  { credits: 20,  cents: 20 * CREDIT_CENTS },
  pack_40:  { credits: 40,  cents: 40 * CREDIT_CENTS },
  pack_100: { credits: 100, cents: 100 * CREDIT_CENTS },
});
