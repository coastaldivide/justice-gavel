/**
 * Render tests: section G — plans, billing and pro dashboards.
 *
 *   - Plan screens show the server's price list (no hard-coded prices, no consumer
 *     plans on the provider screen) and a payments-off server answers with the
 *     friendly "payments aren't available" message, nothing marked paid.
 *   - Attorney inbox shows the direct messages people sent (they were stored but
 *     never displayed before).
 *   - Conflict check shows exact / possible matches from the server.
 *   - Admin review screen refuses non-admin accounts without calling the queue.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
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

import SubscriptionScreen from '../../screens/SubscriptionScreen';
import ConsumerSubscriptionScreen from '../../screens/ConsumerSubscriptionScreen';
import AttorneyInboxScreen from '../../screens/AttorneyInboxScreen';
import ConflictCheckScreen from '../../screens/ConflictCheckScreen';
import AdminVerificationScreen from '../../screens/AdminVerificationScreen';
import { apiMock, makeNavigation } from './apiMock';

const { on, reject, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const route = { params: {} } as never;

const TIERS = { tiers: [
  { key: 'legal_radar', audience: 'consumer', name: 'Legal Radar', billing: 'monthly', display_price: '$19.99/mo', monthly_cents: 1999, annual_cents: null, matches_monthly: null, trial_days: 7, features: ['ai_chat_unlimited', 'legal_research'] },
  { key: 'legal_pro', audience: 'consumer', name: 'Legal Pro', billing: 'monthly', display_price: '$34.99/mo', monthly_cents: 3499, annual_cents: null, matches_monthly: null, trial_days: 7, features: ['ai_chat_unlimited', 'arrest_monitor'] },
  { key: 'esquire', audience: 'attorney', name: 'Justice Gavel Esquire', billing: 'monthly', display_price: '$49/mo', monthly_cents: 4900, annual_cents: null, matches_monthly: null, trial_days: 30, features: ['legal_research'] },
] };

beforeEach(() => { reset(); mockUser = null; });

describe('plans come from the server', () => {
  it('provider screen: attorney + bail agent prices from the backend, no consumer plans, no invented claims', async () => {
    mockUser = { id: 5, role: 'attorney', accountType: 'attorney' };
    on('get', '/billing/tiers', TIERS);
    on('get', '/billing/subscription', { subscription: null });
    on('get', '/billing/bondsman/tiers', { tiers: [
      { key: 'starter', name: 'Bondsman Starter', display: '$49/mo', monthly_cents: 4900, annual_cents: 49000, annual_savings_cents: 9800, counties: 1, features: [{ key: 'lead_alerts', counties: 1 }] },
      { key: 'pro', name: 'Bondsman Pro', display: '$149/mo', monthly_cents: 14900, annual_cents: 149000, annual_savings_cents: 29800, counties: 3, features: [{ key: 'lead_alerts', counties: 3 }] },
      { key: 'market', name: 'Bondsman Market', display: '$349/mo', monthly_cents: 34900, annual_cents: 349000, annual_savings_cents: 69800, counties: 'all', features: [{ key: 'lead_alerts', counties: 'all' }] },
    ] });
    on('get', '/billing/bondsman/subscription', { subscription: null });
    wrap(<SubscriptionScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('plan-price-esquire')).toBeTruthy();
    expect(screen.getByText('$49/mo')).toBeTruthy();
    expect(screen.queryByText(/Legal Radar|Legal Pro/)).toBeNull();
    fireEvent.press(screen.getByTestId('provider-type-bail_agent'));
    expect(await screen.findByText('$149/mo')).toBeTruthy();
    expect(screen.getByText('$349/mo')).toBeTruthy();
    expect(screen.getByText(t('plan_feat_lead_alerts_other', { n: 3 }))).toBeTruthy();
    expect(screen.getByText(t('plan_feat_lead_alerts_all'))).toBeTruthy();
    expect(screen.queryByText(/top placement|verified badge/i)).toBeNull();
  });

  it('provider screen for a bail agent: a slow attorney price list never replaces the agent\'s plans', async () => {
    mockUser = { id: 6, role: 'user', accountType: 'bail_agent' };
    let releaseAttorney: () => void = () => undefined;
    on('get', '/billing/tiers', () => new Promise(r => { releaseAttorney = () => r({ data: TIERS }); }));
    on('get', '/billing/subscription', { subscription: null });
    on('get', '/billing/bondsman/tiers', { tiers: [
      { key: 'starter', name: 'Bondsman Starter', display: '$49/mo', monthly_cents: 4900, annual_cents: 49000, annual_savings_cents: 9800, counties: 1, features: [{ key: 'lead_alerts', counties: 1 }] },
    ] });
    on('get', '/billing/bondsman/subscription', { subscription: null });
    wrap(<SubscriptionScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('plan-price-starter')).toBeTruthy();
    releaseAttorney();   // the attorney list (asked for first) arrives last
    await new Promise(r => { setTimeout(r, 50); });
    expect(screen.getByTestId('plan-price-starter')).toBeTruthy();
    expect(screen.queryByTestId('plan-price-esquire')).toBeNull();
  });

  it('consumer screen: server prices and features; with payments off, subscribing says so and nothing turns paid', async () => {
    mockUser = { id: 1, role: 'user', accountType: 'consumer' };
    on('get', '/billing/tiers', TIERS);
    on('get', '/billing/consumer/subscription', { subscription: null });
    on('post', '/billing/consumer/subscribe', () => Promise.reject(reject(503, { error: 'payments_unavailable', code: 'payments_unavailable' })));
    // Android: iOS sends digital subscriptions to the website (App Store rule 3.1.1).
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    wrap(<ConsumerSubscriptionScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('consumer-price-legal_radar')).toBeTruthy();
    expect(screen.getByText('$19.99/mo')).toBeTruthy();
    expect(screen.getByText('$34.99/mo')).toBeTruthy();
    expect(screen.queryByText(/Esquire/)).toBeNull();
    expect(screen.queryByText(/Intel tier|\$14\.99|24\/7/)).toBeNull();
    expect(screen.getAllByText(t('plan_feat_arrest_monitor')).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId('subscribe-legal_radar'));
    const notice = await screen.findByTestId('plan-notice');
    expect(notice).toHaveTextContent(t('x_common_payments_aren_t_available'));
    expect(screen.queryByTestId('current-plan')).toBeNull();
    expect(calls.some(c => c.url === '/billing/subscription/confirm')).toBe(false);
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  });
});

describe('attorney inbox', () => {
  it('shows direct messages (stored by /messages/direct, never displayed before)', async () => {
    mockUser = { id: 5, role: 'attorney', accountType: 'attorney' };
    on('get', '/attorney/inbox', {
      summary: { unread_direct: 1, unread_messages: 0, pending_assignments: 0, today_events: 0 },
      direct_messages: [{ user_id: 1, name: 'Maria P.', last_message: 'I was arrested last night, can you help?', last_from_me: false, last_at: '2026-10-20T11:00:00Z', unread: 1, case_id: null }],
      unread_messages: [], pending_assignments: [], upcoming_consultations: [], today_hearings: [], recent_cases: [], today: '2026-10-20',
    });
    wrap(<AttorneyInboxScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('inbox-direct')).toBeTruthy();
    expect(screen.getByText('Maria P.')).toBeTruthy();
    expect(screen.getByText(/I was arrested last night/)).toBeTruthy();
    expect(screen.queryByTestId('inbox-empty')).toBeNull();
  });
});

describe('conflict check', () => {
  it('runs the check for the firm and labels exact vs possible matches', async () => {
    mockUser = { id: 5, role: 'attorney', accountType: 'attorney' };
    on('get', '/firm-acquisition/status', { has_firm: true, firm: { id: 9, name: 'Voss Defense' } });
    on('post', '/conflicts/check', { clear: false, checked_count: 1, index_size: 4, conflicts: [
      { name: 'José Ramírez Jr.', matches: [
        { matched_name: 'Jose Ramirez', role: 'adverse', match: 'exact', matter_title: 'State v. Lee' },
        { matched_name: 'Jose R. Ramirez', role: 'witness', match: 'partial', matter_title: 'Doe v. City' },
      ] },
    ] });
    wrap(<ConflictCheckScreen navigation={makeNavigation()} route={route} />);
    fireEvent.changeText(await screen.findByTestId('cc-names'), 'José Ramírez Jr.');
    fireEvent.press(screen.getByTestId('cc-run'));
    expect(await screen.findByTestId('cc-result')).toBeTruthy();
    expect(screen.getByText(t('cc_found_one'))).toBeTruthy();
    expect(screen.getByText(t('cc_exact'))).toBeTruthy();
    expect(screen.getByText(t('cc_possible'))).toBeTruthy();
    const body = calls.find(c => c.url === '/conflicts/check')?.data as { parties: { name: string }[]; firm_id?: number };
    expect(body.parties).toEqual([{ name: 'José Ramírez Jr.' }]);
    expect(body.firm_id).toBeUndefined();     // the server uses the caller's own firm
  });
});

describe('admin review', () => {
  it('a non-admin account sees "for administrators" and the queue is never requested', async () => {
    mockUser = { id: 5, role: 'attorney', accountType: 'attorney' };
    wrap(<AdminVerificationScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('admin-not-allowed')).toBeTruthy();
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/admin/'))).toBe(false));
  });

  it('an admin sees the bar queue with the counts per queue', async () => {
    mockUser = { id: 2, role: 'admin', accountType: 'consumer' };
    on('get', '/admin/queue/summary', { bar: 1, claims: 0, reports: 2, reviews: 0 });
    on('get', '/admin/queue/bar', { pending: [{ user_id: 7, display_name: 'Ada Counsel', email: 'ada@example.com', bar_number: '123456', bar_state: 'TN', bar_submitted_at: '2026-10-19T00:00:00Z' }] });
    wrap(<AdminVerificationScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('adm-bar')).toBeTruthy();
    expect(screen.getByText('Ada Counsel')).toBeTruthy();
    expect(screen.getByTestId('adm-tab-reports')).toHaveTextContent(/\(2\)/);
  });
});
