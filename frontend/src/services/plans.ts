/**
 * services/plans.ts — plan cards from the server's price list.
 *
 * Names, prices, trial lengths and what each plan includes all come from
 * GET /api/billing/tiers (and /billing/bondsman/tiers): the same list the server
 * charges from and enforces (backend routes/billing/plans.js). Nothing here
 * hard-codes a price or a feature a plan does not have.
 */
import { unwrapList } from './api';
import { t } from '../i18n';

export type Tier = {
  key: string; name: string; audience: 'consumer' | 'attorney'; billing: 'monthly' | 'annual';
  display_price: string; monthly_cents: number; annual_cents: number | null; matches_monthly: string | null;
  trial_days: number; features: string[];
};

export type ConsumerPlan = {
  key: string; label: string; price: string; monthlyCents: number; trialDays: number; features: string[];
  annualKey: string | null; annualPrice: string | null; annualCents: number | null; annualTrialDays: number | null; annualSavings: string | null;
};

/** "$19.99" / "$100" for a cents amount. */
export function usd(cents: number): string {
  const n = Number(cents) / 100;
  return Number.isInteger(n) ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

const FEATURE_KEYS: Record<string, string> = {
  ai_chat_unlimited: 'plan_feat_ai_chat_unlimited',
  legal_research: 'plan_feat_legal_research',
  bar_prep: 'plan_feat_bar_prep',
  interpreter: 'plan_feat_interpreter',
  audio_transcription: 'plan_feat_audio_transcription',
  video_consultation: 'plan_feat_video_consultation',
  arrest_monitor: 'plan_feat_arrest_monitor',
};
/** The person-facing name of a plan feature (server key). */
export const featureLabel = (key: string): string => (FEATURE_KEYS[key] ? t(FEATURE_KEYS[key]) : key);

export const isTier = (x: unknown): x is Tier => !!x && typeof (x as Tier).key === 'string' && typeof (x as Tier).display_price === 'string';

/** Plan cards for one audience: monthly plans, each with its annual variant when there is one. */
export function plansFrom(body: unknown, audience: 'consumer' | 'attorney' = 'consumer'): ConsumerPlan[] {
  const tiers = unwrapList<Tier>(body, 'tiers').filter(x => isTier(x) && x.audience === audience);
  return tiers.filter(x => x.billing === 'monthly').map(m => {
    const annual = tiers.find(x => x.billing === 'annual' && x.matches_monthly === m.key) || null;
    const saving = annual?.annual_cents ? m.monthly_cents * 12 - annual.annual_cents : 0;
    return {
      key: m.key, label: m.name, price: m.display_price, monthlyCents: m.monthly_cents,
      trialDays: Number(m.trial_days) || 0, features: Array.isArray(m.features) ? m.features : [],
      annualKey: annual?.key ?? null,
      annualPrice: annual?.annual_cents ? t('x_consumer_subscription_price_per_year', { price: usd(annual.annual_cents) }) : null,
      annualCents: annual?.annual_cents ?? null,
      annualTrialDays: annual ? Number(annual.trial_days) || 0 : null,
      annualSavings: saving > 0 ? t('x_consumer_subscription_save_amount', { amount: usd(saving) }) : null,
    };
  });
}

/** Back-compat name used by the Insurance and plans screens. */
export const consumerPlansFrom = (body: unknown): ConsumerPlan[] => plansFrom(body, 'consumer');

export type SubscriptionView = {
  id: number; tier: string; name: string; audience: string | null; billing: string | null; status: string; paid: boolean;
  amount_cents: number | null; trial_ends_at: string | null; current_period_end: string | null;
  cancel_at_period_end: boolean; features: string[]; created_at: string;
};
