/**
 * services/purchase.ts — the app side of every purchase (plans, leads).
 *
 *   1. `start(ui)` asks the server to create the Stripe object. The server picks the
 *      amount; nothing is unlocked yet.
 *   2. Phone: Stripe's payment sheet collects the card (client_secret; a free trial
 *      uses a SetupIntent). Browser: the server returns a Stripe Checkout URL and the
 *      page goes there; Stripe sends the person back with ?checkout_session_id=…
 *   3. `confirm(ids)` asks the server to check the payment with Stripe and record it.
 *      A lost connection after paying is safe: confirming again never charges again,
 *      and the server's webhook finishes it too.
 * Without Stripe keys every start answers 503 payments_unavailable → the friendly
 * "Payments are not available yet" message.
 */
import { Platform } from 'react-native';
import { apiErrorMessage, isPaymentsUnavailable } from './api';
import { usePaymentSheet, PAYMENTS_COMING_SOON } from '../payments';
import { t } from '../i18n';

export type PurchaseUi = 'sheet' | 'checkout';
export type StartResponse = {
  requires_payment?: boolean;
  client_secret?: string;
  intent_type?: 'setup' | 'payment';
  subscription_id?: string;
  payment_intent_id?: string;
  checkout_url?: string;
  checkout_session_id?: string;
};
export type ConfirmIds = { subscription_id?: string; payment_intent_id?: string; checkout_session_id?: string };
export type PurchaseResult<T> =
  | { status: 'done'; data: T }
  | { status: 'redirected' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; code?: string; retry?: ConfirmIds };

/** Browsers use Stripe Checkout; phones use the payment sheet. */
export const purchaseUi = (): PurchaseUi => (Platform.OS === 'web' ? 'checkout' : 'sheet');

/** The person-facing message for a failed purchase step. */
export function purchaseError(e: unknown, fallbackKey = 'pay_failed'): { message: string; code?: string } {
  const err = e as { response?: { status?: number; data?: { code?: string; error?: string } } } | undefined;
  if (isPaymentsUnavailable(e) || err?.response?.status === 503) return { message: PAYMENTS_COMING_SOON(), code: 'payments_unavailable' };
  if (!err?.response) return { message: t('pay_offline'), code: 'offline' };
  return { message: apiErrorMessage(e, t(fallbackKey)), code: err.response.data?.code };
}

const PENDING_KEY = 'jg_pending_checkout';
type Pending = { key: string; ctx?: Record<string, string | number> };

/** Remember what a Stripe Checkout redirect was for (web only; same tab). */
function rememberCheckout(p: Pending) {
  try { globalThis.sessionStorage?.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* private mode: the session id in the URL is enough */ }
}
/** The pending checkout for `key` (and forget it), or null. */
export function takePendingCheckout(key: string): Pending | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    if (p?.key !== key) return null;
    globalThis.sessionStorage?.removeItem(PENDING_KEY);
    return p;
  } catch { return null; }
}
/** Drop ?checkout_session_id=… from the address bar once it was confirmed (web). */
export function clearCheckoutParam() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has('checkout_session_id')) return;
    u.searchParams.delete('checkout_session_id');
    window.history.replaceState(window.history.state, '', u.pathname + (u.search ? u.search : '') + u.hash);
  } catch { /* nothing to clean */ }
}

export function usePurchase() {
  const sheet = usePaymentSheet();

  /**
   * start → card → confirm. `key` names the purchase so the screen can finish a
   * Checkout redirect when the browser comes back (takePendingCheckout).
   */
  async function run<T>({ key, ctx, start, confirm }: {
    key: string;
    ctx?: Record<string, string | number>;
    start: (ui: PurchaseUi) => Promise<StartResponse>;
    confirm: (ids: ConfirmIds) => Promise<T>;
  }): Promise<PurchaseResult<T>> {
    let started: StartResponse;
    try { started = await start(purchaseUi()); }
    catch (e) { return { status: 'error', ...purchaseError(e) }; }

    if (started.checkout_url) {
      rememberCheckout({ key, ctx });
      if (typeof window !== 'undefined') window.location.assign(started.checkout_url);
      return { status: 'redirected' };
    }
    if (!started.client_secret || !sheet.available) return { status: 'error', message: PAYMENTS_COMING_SOON(), code: 'payments_unavailable' };
    const init = await sheet.initPaymentSheet({
      merchantDisplayName: 'Justice Gavel',
      ...(started.intent_type === 'setup' ? { setupIntentClientSecret: started.client_secret } : { paymentIntentClientSecret: started.client_secret }),
    });
    if (init.error) return { status: 'error', message: init.error.message || t('pay_failed') };
    const paid = await sheet.presentPaymentSheet();
    if (paid.error) {
      if (paid.error.code === 'Canceled') return { status: 'cancelled' };
      return { status: 'error', message: paid.error.message || t('pay_declined') };
    }
    const ids: ConfirmIds = started.subscription_id ? { subscription_id: started.subscription_id } : { payment_intent_id: started.payment_intent_id };
    try { return { status: 'done', data: await confirm(ids) }; }
    catch (e) { return { status: 'error', ...purchaseError(e, 'pay_confirm_retry'), retry: ids }; }
  }

  /** Finish a purchase whose payment went through (retry after a lost connection, or a Checkout return). */
  async function finish<T>(confirm: (ids: ConfirmIds) => Promise<T>, ids: ConfirmIds): Promise<PurchaseResult<T>> {
    try { const data = await confirm(ids); clearCheckoutParam(); return { status: 'done', data }; }
    catch (e) { return { status: 'error', ...purchaseError(e, 'pay_confirm_retry'), retry: ids }; }
  }

  return { run, finish, sheetAvailable: sheet.available };
}
