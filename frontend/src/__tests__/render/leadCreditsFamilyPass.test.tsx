/**
 * Render tests: debug scan Oct 30, 2026 (docs/DEBUG_SCAN_2026-10-30.md issues 6 and 7).
 *
 *   - Lawyer dashboard, credit-pack state (Tennessee): the request is answered with credits — no card
 *     button that the server would refuse — with the balance, the packs and the disclosure shown.
 *   - Per-lead state (New York): the card purchase stays.
 *   - Plans screen: the Family Case Pass can be bought (it existed only on the server).
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
let mockUser: Record<string, unknown> | null = null;
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(mockUser ? 'jwt-test' : null)),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn((k: string) => Promise.resolve(k === 'user' && mockUser ? JSON.stringify(mockUser) : null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import AttorneyDashboardScreen from '../../screens/AttorneyDashboardScreen';
import ConsumerSubscriptionScreen from '../../screens/ConsumerSubscriptionScreen';
import { apiMock, makeNavigation } from './apiMock';

const { on, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const PROFILE = {
  name: 'Ada Counsel', bar_number: 'TN-1', bar_state: 'TN', bar_verified: true, pending_bar_verification: false, bar_rejection_reason: null,
  office_id: null, office_name: null, listing: null, plan: null, stats: { active_cases: 0, unread_messages: 0, upcoming_hearings: 0, leads_bought: 0 },
};
const lead = (o: Record<string, unknown>) => ({ id: 7, case_type: 'personal_injury', severity: 'serious', city: 'Nashville', state: 'TN',
  lead_fee_cents: 25000, lead_fee_display: '$250', created_at: '2026-10-29T15:00:00Z', ...o });
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  reset(); mockUser = null;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[buttons.length - 1]?.onPress?.(); });
});
afterEach(() => alertSpy.mockRestore());

describe('lawyer dashboard: leads by the state rule', () => {
  it('credit-pack state: shows balance, packs and disclosure; answers with credits (never the refused card route)', async () => {
    mockUser = { id: 5, role: 'attorney', accountType: 'attorney' };
    on('get', '/attorney/profile', PROFILE);
    on('get', '/billing/pi-leads', [lead({ credits: 10, pay_by_card: false })]);
    on('get', '/billing/pi-leads/mine', { leads: [] });
    on('get', '/billing/pi-lead/credits', { balance: 12, credit_cents: 2500, packs: [{ key: 'pack_20', credits: 20, cents: 50000 }] });
    on('post', '/billing/pi-lead/claim/7', { ok: true, credits_spent: 10, balance: 2 });
    wrap(<AttorneyDashboardScreen navigation={makeNavigation()} route={{ params: { tab: 'leads' } } as never} />);
    // generous first wait: the dashboard's first render compiles a large screen on a cold test run
    expect(await screen.findByTestId('ad-answer-lead-7', {}, { timeout: 8000 })).toHaveTextContent(t('ad_lead_answer_cta', { credits: 10 }));
    expect(screen.queryByTestId('ad-buy-lead-7')).toBeNull();
    expect(screen.getByTestId('ad-credits-balance')).toHaveTextContent(t('ad_credits_balance', { n: 12 }));
    expect(screen.getByTestId('ad-credits-buy-pack_20')).toBeTruthy();
    expect(screen.getByTestId('ad-lead-disclosure')).toHaveTextContent(t('ad_lead_disclosure'));
    fireEvent.press(screen.getByTestId('ad-answer-lead-7'));
    await waitFor(() => expect(calls.some(c => c.method === 'post' && c.url === '/billing/pi-lead/claim/7')).toBe(true));
    expect(calls.some(c => c.url === '/billing/pi-lead/accept/7')).toBe(false);
    expect(await screen.findByTestId('ad-leads-notice')).toHaveTextContent(t('ad_lead_bought'));
  });

  it('per-lead state: the card purchase stays', async () => {
    mockUser = { id: 5, role: 'attorney', accountType: 'attorney' };
    on('get', '/attorney/profile', PROFILE);
    on('get', '/billing/pi-leads', [lead({ id: 8, state: 'NY', city: 'Albany', credits: 10, pay_by_card: true })]);
    on('get', '/billing/pi-leads/mine', { leads: [] });
    on('get', '/billing/pi-lead/credits', { balance: 0, credit_cents: 2500, packs: [] });
    wrap(<AttorneyDashboardScreen navigation={makeNavigation()} route={{ params: { tab: 'leads' } } as never} />);
    expect(await screen.findByTestId('ad-buy-lead-8')).toHaveTextContent(t('ad_lead_buy_cta', { fee: '$250' }));
    expect(screen.queryByTestId('ad-answer-lead-8')).toBeNull();
  });
});

describe('plans screen: Family Case Pass', () => {
  it('is offered next to the Case Pass and bought with family: true', async () => {
    mockUser = { id: 1, role: 'user', accountType: 'consumer' };
    on('get', '/billing/tiers', { tiers: [] });
    on('get', '/billing/consumer/subscription', { subscription: null });
    on('get', '/billing/case-pass', { cents: 2900, extend_cents: 1900, days: 90, active_until: null, can_extend: false, features: ['ai_chat_unlimited'],
      family: { cents: 3900, extend_cents: 2500, days: 90 } });
    on('post', '/billing/case-pass/buy', { requires_payment: true });   // no sheet in tests: the screen reports it
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    wrap(<ConsumerSubscriptionScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    await screen.findByTestId('family-pass', {}, { timeout: 8000 });
    expect(screen.getByText(t('cp_family_title'))).toBeTruthy();
    expect(screen.getByText(t('cp_family_body', { days: 90 }))).toBeTruthy();
    expect(screen.getByTestId('family-pass-buy')).toHaveTextContent(t('cp_family_buy', { price: '$39' }));
    fireEvent.press(screen.getByTestId('family-pass-buy'));
    await waitFor(() => expect(calls.some(c => c.method === 'post' && c.url === '/billing/case-pass/buy')).toBe(true));
    expect(calls.find(c => c.url === '/billing/case-pass/buy')?.data).toMatchObject({ family: true });
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  });
});
