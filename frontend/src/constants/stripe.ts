/**
 * stripe.ts — Stripe price ID constants
 *
 * All Stripe price IDs are sourced from environment variables at build time.
 * Never hard-code price IDs in component files.
 *
 * Usage:
 *   import { STRIPE_PRICE_IDS } from '../constants/stripe';
 *   api.post('/billing/subscribe', { priceId: STRIPE_PRICE_IDS.LEGAL_RADAR_MONTHLY });
 */

import Constants from 'expo-constants';

const env = Constants.expoConfig?.extra ?? {};

export const STRIPE_PRICE_IDS = {
  // Monthly tiers
  LEGAL_RADAR_MONTHLY:   env.STRIPE_LEGAL_RADAR_ID      ?? '',
  ADVISOR_MONTHLY:       env.STRIPE_ADVISOR_PRICE_ID     ?? '',
  LEGAL_PRO_MONTHLY:     env.STRIPE_LEGAL_PRO_PRICE_ID   ?? '',
  ESQUIRE_MONTHLY:       env.STRIPE_ESQUIRE_PRICE_ID      ?? '',

  // Annual tiers
  ADVISOR_ANNUAL:        env.STRIPE_ADVISOR_ANNUAL_ID    ?? '',
  LEGAL_PRO_ANNUAL:      env.STRIPE_LEGAL_PRO_ANNUAL_ID  ?? '',
  ESQUIRE_ANNUAL:        env.STRIPE_ESQUIRE_ANNUAL_ID    ?? '',
} as const;

export type StripePriceId = typeof STRIPE_PRICE_IDS[keyof typeof STRIPE_PRICE_IDS];

/** Human-readable plan names keyed by price ID */
export const PLAN_NAMES: Record<string, string> = {
  [STRIPE_PRICE_IDS.LEGAL_RADAR_MONTHLY]: 'Legal Radar',
  [STRIPE_PRICE_IDS.ADVISOR_MONTHLY]:     'Advisor',
  [STRIPE_PRICE_IDS.LEGAL_PRO_MONTHLY]:   'Legal Pro',
  [STRIPE_PRICE_IDS.ESQUIRE_MONTHLY]:     'Esquire',
  [STRIPE_PRICE_IDS.ADVISOR_ANNUAL]:      'Advisor (Annual)',
  [STRIPE_PRICE_IDS.LEGAL_PRO_ANNUAL]:    'Legal Pro (Annual)',
  [STRIPE_PRICE_IDS.ESQUIRE_ANNUAL]:      'Esquire (Annual)',
};

/** Monthly prices in USD for display only (not billing) */
export const PLAN_DISPLAY_PRICES = {
  legal_radar:  19.99,
  advisor:      24.99,
  legal_pro:    34.99,
  esquire:      49.00,
  advisor_annual:   199 / 12,   // ~$16.58/mo billed annually
  legal_pro_annual: 299 / 12,   // ~$24.92/mo billed annually
  esquire_annual:   410 / 12,   // ~$34.17/mo billed annually
} as const;
