/**
 * payments/common.ts — shared types/constants for the payments layer.
 *
 * Stripe is optional: when no publishable key is configured (or on web),
 * every payment call resolves with a `payments_unavailable` error so screens
 * can show a friendly "Payments are coming soon" message instead of crashing.
 */

export const PAYMENTS_COMING_SOON = 'Payments aren’t available yet. No charge was made — free features keep working.';

export interface PaymentSheetError {
  code: string;
  message: string;
}

export interface PaymentSheetApi {
  /** True when a real Stripe PaymentSheet can be presented on this device. */
  available: boolean;
  initPaymentSheet: (params: Record<string, unknown>) => Promise<{ error?: PaymentSheetError }>;
  presentPaymentSheet: () => Promise<{ error?: PaymentSheetError }>;
}

const unavailableResult = async (): Promise<{ error: PaymentSheetError }> => ({
  error: { code: 'payments_unavailable', message: PAYMENTS_COMING_SOON },
});

export const UNAVAILABLE_SHEET: PaymentSheetApi = {
  available: false,
  initPaymentSheet: unavailableResult,
  presentPaymentSheet: unavailableResult,
};

/** Publishable key from the build environment (empty when Stripe isn't set up). */
export const STRIPE_PUBLISHABLE_KEY: string =
  (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim();
