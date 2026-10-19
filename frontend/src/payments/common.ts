/**
 * payments/common.ts — shared types/constants for the payments layer.
 *
 * Stripe is optional: when no publishable key is configured (or on web),
 * every payment call resolves with a `payments_unavailable` error so screens
 * can show a friendly "Payments are coming soon" message instead of crashing.
 */

export const PAYMENTS_COMING_SOON = perLang(() => t('x_common_payments_aren_t_available'));

export interface PaymentSheetError {
  code: string;
  message: string;
}

// Type-only import: erased at build time, so the native-only Stripe module is
// never resolved into the web bundle (index.web.tsx also uses this file).
import type { PaymentSheet } from '@stripe/stripe-react-native';
import { t, perLang } from '../i18n';

/** What screens pass to initPaymentSheet — Stripe's real SetupParams. */
export type PaymentSheetSetupParams = PaymentSheet.SetupParams;

export interface PaymentSheetApi {
  /** True when a real Stripe PaymentSheet can be presented on this device. */
  available: boolean;
  initPaymentSheet: (params: PaymentSheetSetupParams) => Promise<{ error?: PaymentSheetError }>;
  presentPaymentSheet: () => Promise<{ error?: PaymentSheetError }>;
}

const unavailableResult = async (): Promise<{ error: PaymentSheetError }> => ({
  error: { code: 'payments_unavailable', message: PAYMENTS_COMING_SOON() },
});

export const UNAVAILABLE_SHEET: PaymentSheetApi = {
  available: false,
  initPaymentSheet: unavailableResult,
  presentPaymentSheet: unavailableResult,
};

/** Publishable key from the build environment (empty when Stripe isn't set up). */
export const STRIPE_PUBLISHABLE_KEY: string =
  (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim();
