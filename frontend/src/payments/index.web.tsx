/**
 * payments/index.web.tsx — web implementation.
 *
 * @stripe/stripe-react-native is native-only; on web we never import it.
 * Payment actions report `payments_unavailable` and screens fall back to the
 * backend's hosted checkout URL (when provided) or a "coming soon" message.
 */
import React from 'react';
import { UNAVAILABLE_SHEET, type PaymentSheetApi } from './common';

export * from './common';

export const paymentsEnabled = false;

export function PaymentsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function usePaymentSheet(): PaymentSheetApi {
  return UNAVAILABLE_SHEET;
}
