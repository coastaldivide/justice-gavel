/**
 * Render tests: the public signing page (sign/<token>) and the Case Pass card.
 *
 *   - A bad / expired link says so and asks for a new one.
 *   - Questions are saved before documents are prepared.
 *   - Sign stays disabled until every document was opened, the typed name matches the
 *     signer's name and both agreements are ticked; the typed name is what is sent.
 *     There is no drawn-signature pad.
 *   - Case Pass: price from the server, one-time purchase through the purchase flow,
 *     "add 90 days" when active.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve('jwt-test')),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(JSON.stringify({ id: 1, accountType: 'consumer' }))),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});
jest.mock('../../components/AuthGate', () => ({
  __esModule: true,
  useAuthGate: () => ({ requireAuth: (fn: () => void) => fn(), AuthGateModal: () => null }),
}));
jest.mock('expo-image-picker', () => ({
  __esModule: true, CameraType: { front: 'front', back: 'back' },
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })),
}));
jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })) }));
const mockFetchFile = jest.fn((..._a: unknown[]) => Promise.resolve('view'));
jest.mock('../../services/fileDownload', () => ({ __esModule: true, fetchFile: (...a: unknown[]) => mockFetchFile(...a), appendPicked: jest.fn() }));
const mockSheet = { available: true, initPaymentSheet: jest.fn(() => Promise.resolve({})), presentPaymentSheet: jest.fn(() => Promise.resolve({})) };
jest.mock('../../payments', () => ({ __esModule: true, usePaymentSheet: () => mockSheet, PAYMENTS_COMING_SOON: () => 'Payments aren’t available yet.' }));

import SignPacketScreen from '../../screens/SignPacketScreen';
import ConsumerSubscriptionScreen from '../../screens/ConsumerSubscriptionScreen';
import { apiMock, makeNavigation } from './apiMock';

const { on, reject, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const BASE = `/sign/${TOKEN}`;
const route = (token = TOKEN) => ({ params: { token } }) as never;
const disabled = (id: string) => !!screen.getByTestId(id).props.accessibilityState?.disabled;
const has = (x: string) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const INFO = {
  agency: { name: 'Liberty Bail Bonds', phone: '615-555-0199', license: 'TN-12345' },
  signer: { name: 'Luis Lopez', role: 'indemnitor' }, status: 'opened', defendant_name: 'Ana Lopez',
  questions: [], answers: {}, doc_requests: [], documents: [], prepared: false, signed_at: null,
  consent: { version: '2026-10-26', text_key: 'sgn_esign_consent' },
};

beforeEach(() => { reset(); mockFetchFile.mockClear(); });

describe('signing link', () => {
  it('a malformed link never calls the server; an expired one says so', async () => {
    wrap(<SignPacketScreen navigation={makeNavigation()} route={route('short')} />);
    expect(await screen.findByTestId('sign-link-error')).toHaveTextContent(has(t('sgn_link_invalid')));
    expect(calls.length).toBe(0);
  });

  it('an expired link asks for a new one', async () => {
    on('get', BASE, () => Promise.reject(reject(410, { error: 'link_expired', code: 'link_expired' })));
    wrap(<SignPacketScreen navigation={makeNavigation()} route={route()} />);
    expect(await screen.findByTestId('sign-link-error')).toHaveTextContent(has(t('sgn_link_expired')));
  });

  it('saves the required answers before the documents step', async () => {
    let saved = false;
    on('get', BASE, () => Promise.resolve({ data: saved
      ? { ...INFO, questions: [{ key: 'address', label_key: 'sgn_q_address', label: null, required: true }], answers: { address: '1 Main St' }, doc_requests: [{ kind: 'id_front', uploaded: false }] }
      : { ...INFO, questions: [{ key: 'address', label_key: 'sgn_q_address', label: null, required: true }] } }));
    on('post', `${BASE}/answers`, () => { saved = true; return Promise.resolve({ data: { ok: true } }); });
    wrap(<SignPacketScreen navigation={makeNavigation()} route={route()} />);
    fireEvent.press(await screen.findByTestId('sign-answers-save'));
    expect(await screen.findByTestId('sign-error')).toHaveTextContent(has(t('sgn_answer_required', { q: t('sgn_q_address') })));
    fireEvent.changeText(screen.getByTestId('sign-q-address'), '1 Main St');
    fireEvent.press(screen.getByTestId('sign-answers-save'));
    expect(await screen.findByTestId('sign-up-id_front')).toBeTruthy();
    expect(calls.find(c => c.url === `${BASE}/answers`)?.data).toEqual({ answers: { address: '1 Main St' } });
    expect(disabled('sign-prepare-btn')).toBe(true);   // the requested ID is not uploaded yet
  });

  it('Sign stays disabled until every document is opened, the name matches and both boxes are ticked', async () => {
    let signed = false;
    const prepared = { ...INFO, prepared: true, documents: [{ id: 1, name: 'Indemnity agreement', viewed: false }, { id: 2, name: 'Application', viewed: false }] };
    on('get', BASE, () => Promise.resolve({ data: signed ? { ...prepared, signed_at: '2026-10-26T15:00:00Z' } : prepared }));
    on('post', `${BASE}/sign`, () => { signed = true; return Promise.resolve({ data: { signed_at: '2026-10-26T15:00:00Z' } }); });
    wrap(<SignPacketScreen navigation={makeNavigation()} route={route()} />);
    expect(await screen.findByTestId('sign-esign-text')).toHaveTextContent(has(t('sgn_esign_consent')));
    expect(screen.queryByText(/draw|finger/i)).toBeNull();

    fireEvent.changeText(screen.getByTestId('sign-typed-name'), 'luis  lopez');
    fireEvent.press(screen.getByTestId('sign-agree-esign'));
    fireEvent.press(screen.getByTestId('sign-agree-terms'));
    expect(screen.getByTestId('sign-need-view')).toBeTruthy();
    expect(disabled('sign-submit')).toBe(true);

    fireEvent.press(screen.getByTestId('sign-doc-1'));
    await waitFor(() => expect(screen.getByTestId('sign-doc-state-1')).toHaveTextContent(has(t('sgn_doc_opened'))));
    expect(disabled('sign-submit')).toBe(true);
    fireEvent.press(screen.getByTestId('sign-doc-2'));
    await waitFor(() => expect(disabled('sign-submit')).toBe(false));
    expect(mockFetchFile).toHaveBeenCalledWith(`${BASE}/documents/1.pdf`, 'Indemnity agreement.pdf', 'application/pdf', 'view');

    fireEvent.changeText(screen.getByTestId('sign-typed-name'), 'Luis Lopes');
    expect(screen.getByTestId('sign-name-mismatch')).toBeTruthy();
    expect(disabled('sign-submit')).toBe(true);
    fireEvent.changeText(screen.getByTestId('sign-typed-name'), ' luis  LOPEZ ');
    expect(disabled('sign-submit')).toBe(false);
    fireEvent.press(screen.getByTestId('sign-submit'));
    expect(await screen.findByTestId('sign-done')).toBeTruthy();
    expect(calls.find(c => c.url === `${BASE}/sign`)?.data).toEqual({ typed_name: 'luis  LOPEZ', agree_esign: true, agree_terms: true, lang: 'en' });
    fireEvent.press(screen.getByTestId('sign-download'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith(`${BASE}/signed.pdf`, 'signed-bail-documents.pdf', 'application/pdf', 'download'));
  });
});

describe('Case Pass card', () => {
  const TIERS = { tiers: [{ key: 'legal_pro', audience: 'consumer', name: 'Legal Pro', billing: 'monthly', display_price: '$19.99/mo', monthly_cents: 1999, annual_cents: null, matches_monthly: null, trial_days: 7, features: ['ai_chat_unlimited'] }] };
  let os: typeof Platform.OS;
  beforeEach(() => { os = Platform.OS; Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }); });
  afterEach(() => Object.defineProperty(Platform, 'OS', { value: os, configurable: true }));

  it('shows the one-time price and buys it through the payment sheet + server confirm', async () => {
    let active: string | null = null;
    on('get', '/billing/tiers', TIERS);
    on('get', '/billing/consumer/subscription', { subscription: null });
    on('get', '/billing/case-pass', () => Promise.resolve({ data: { cents: 2900, extend_cents: 1900, days: 90, payments_live: true, active_until: active, can_extend: !!active, features: ['ai_chat_unlimited', 'interpreter'] } }));
    on('post', '/billing/case-pass/buy', { requires_payment: true, client_secret: 'pi_1_secret', payment_intent_id: 'pi_1', amount_cents: 2900 });
    on('post', '/billing/case-pass/confirm', () => { active = '2027-01-24T00:00:00Z'; return Promise.resolve({ data: { ok: true, active_until: active, message: 'Case Pass active.' } }); });
    wrap(<ConsumerSubscriptionScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('case-pass-price')).toHaveTextContent(has(t('cp_price', { price: '$29', days: 90 })));
    expect(screen.getByText(t('cp_final'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('case-pass-buy'));
    expect(await screen.findByTestId('case-pass-active')).toBeTruthy();
    expect(calls.find(c => c.url === '/billing/case-pass/buy')?.data).toEqual({ ui: 'sheet', return_path: '/plans' });
    expect(calls.find(c => c.url === '/billing/case-pass/confirm')?.data).toEqual({ payment_intent_id: 'pi_1' });
    expect(screen.getByTestId('case-pass-buy')).toHaveTextContent(has(t('cp_extend', { days: 90, price: '$19' })));
  });

  it('is not sold inside the iOS app (bought on the website)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    on('get', '/billing/tiers', TIERS);
    on('get', '/billing/consumer/subscription', { subscription: null });
    on('get', '/billing/case-pass', { cents: 2900, extend_cents: 1900, days: 90, active_until: null, can_extend: false, features: [] });
    const { Alert } = jest.requireActual('react-native');
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    wrap(<ConsumerSubscriptionScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('case-pass-buy'));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(calls.some(c => c.url === '/billing/case-pass/buy')).toBe(false);
    spy.mockRestore();
  });
});
