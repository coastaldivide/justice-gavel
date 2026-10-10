/**
 * payments/index.tsx — native implementation (iOS / Android).
 *
 * Metro picks `index.web.tsx` for web builds, so @stripe/stripe-react-native
 * is never resolved into the web bundle.
 *
 * StripeProvider is only mounted when EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is
 * set. Without a key the app runs with payments disabled and
 * usePaymentSheet() returns stubs that report `payments_unavailable`.
 */
import React from 'react';
import { STRIPE_PUBLISHABLE_KEY, UNAVAILABLE_SHEET, type PaymentSheetApi } from './common';

export * from './common';

export const paymentsEnabled = STRIPE_PUBLISHABLE_KEY.length > 0;

export function PaymentsProvider({ children }: { children: React.ReactNode }) {
  if (!paymentsEnabled) return <>{children}</>;
  // Lazy require so the native module is only touched when Stripe is configured.
  const { StripeProvider } = require('@stripe/stripe-react-native');
  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      merchantIdentifier="merchant.com.justicegavel"
      urlScheme="justicegavel"
    >
      {children as React.ReactElement}
    </StripeProvider>
  );
}

function useStripePaymentSheet(): PaymentSheetApi {
  const { useStripe } = require('@stripe/stripe-react-native');
  const stripe = useStripe();
  return {
    available: true,
    initPaymentSheet: stripe.initPaymentSheet,
    presentPaymentSheet: stripe.presentPaymentSheet,
  };
}

function useUnavailablePaymentSheet(): PaymentSheetApi {
  return UNAVAILABLE_SHEET;
}

/**
 * PaymentSheet API. Chosen once at module load (the key is a build-time
 * constant), so the hook order is stable across renders.
 */
export const usePaymentSheet: () => PaymentSheetApi =
  paymentsEnabled ? useStripePaymentSheet : useUnavailablePaymentSheet;
