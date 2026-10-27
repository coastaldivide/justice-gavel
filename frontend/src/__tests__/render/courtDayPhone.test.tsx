/**
 * Render tests for migration 40's screens:
 *   - Plan your court day on a court date: saved checklist, 211 / cited transit agency /
 *     directions, ride offers accepted by the owner, the phone line's number when it is on
 *   - "Offer a ride" for a follower who gets reminders
 *   - Verify phone: code sent, code confirmed; no texts → says so, sends nothing
 *   - "Your bail agent" card: verify prompt when links are held
 *   - Ameelio card: the wording and the link
 *   - Results page: nothing until published; then the numbers and the methods note
 *   - Admin results: publish disabled under 100 answers
 */
import React from 'react';
import { Linking } from 'react-native';
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
  getItem: jest.fn(() => Promise.resolve(JSON.stringify({ id: 1 }))),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: () => Promise.resolve(true) }) }));

import CourtDayPlan, { type PlanItem } from '../../components/CourtDayPlan';
import AmeelioCard, { AMEELIO_URL } from '../../components/AmeelioCard';
import BailAgentCard from '../../components/BailAgentCard';
import VerifyPhoneScreen from '../../screens/VerifyPhoneScreen';
import ResultsScreen from '../../screens/ResultsScreen';
import AdminResultsScreen from '../../screens/AdminResultsScreen';
import { makeStyles } from '../../screens/CourtDatesScreen';
import { themeColors } from '../../constants/theme';
import { apiMock, makeNavigation } from './apiMock';

const { on, reject, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const PLAN: PlanItem[] = ['ride', 'time_off', 'child_care', 'documents', 'address_room'].map(id => ({ id: id as PlanItem['id'], done: id === 'ride', note: id === 'ride' ? 'Bus 52' : null }));
const HELP = {
  call_211: { phone: '211', url: 'https://www.211.org' },
  transit: { agency: 'WeGo Public Transit', serves: 'Nashville and Davidson County', url: 'https://www.wegotransit.com/', trip_planner: false, source_url: 'https://wegotransit.com/ride', checked: '2026-10-27' },
  directions_url: 'https://www.google.com/maps/dir/?api=1&destination=36.1,-86.7', public_defender: null,
};
const SNAP = {
  id: 3, published_at: '2026-10-20T15:00:00Z', period: { from: '2026-07-01', to: '2026-09-30' },
  court_dates: 240, asked: 200, answered: 180, attended: 150, rescheduled: 10, missed: 20, no_answer: 20,
  appearance_rate: 88.2, reminders_sent: 900, texted_numbers: 120, opted_out: 3, opt_out_rate: 2.5, methods_version: 1, methods: 'x',
};

let openSpy: jest.SpyInstance;
beforeEach(() => { reset(); openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never); });
afterEach(() => openSpy.mockRestore());

describe('Plan your court day', () => {
  test('saves the checklist, shows help links with the source date, answers a ride offer, shows the phone line', async () => {
    const onOffers = jest.fn();
    on('put', '/court-dates/9/plan', () => Promise.resolve({ data: { plan: PLAN.map(p => (p.id === 'documents' ? { ...p, done: true } : p)) } }));
    on('post', '/court-dates/9/ride-offers/4', () => Promise.resolve({ data: { ride_offers: [{ id: 4, status: 'accepted', name: 'Fran' }] } }));
    wrap(<CourtDayPlan courtDateId={9} plan={PLAN} help={HELP} offers={[{ id: 4, status: 'offered', name: 'Fran' }]} phoneLine={{ number: '+18005550199' }}
      styles={makeStyles(themeColors())} onOffers={onOffers} />);
    expect(screen.getByText(t('cdp_title'))).toBeTruthy();
    expect(screen.getByTestId('plan-ride-note').props.value).toBe('Bus 52');
    fireEvent.press(screen.getByTestId('plan-documents-done'));
    fireEvent.press(screen.getByTestId('plan-save'));
    await waitFor(() => expect(calls.find(c => c.method === 'put')).toBeTruthy());
    const body = calls.find(c => c.method === 'put')!.data as { items: Record<string, { done: boolean; note: string }> };
    expect(body.items.documents.done).toBe(true);
    expect(body.items.ride).toEqual({ done: true, note: 'Bus 52' });
    expect(screen.getByText(t('cdp_transit_site', { agency: 'WeGo Public Transit' }))).toBeTruthy();
    expect(screen.getByText(t('cdp_transit_serves', { area: 'Nashville and Davidson County', date: '2026-10-27' }))).toBeTruthy();
    fireEvent.press(screen.getByTestId('court-help-211'));
    expect(openSpy).toHaveBeenCalledWith('tel:211');
    fireEvent.press(screen.getByTestId('court-help-directions'));
    expect(openSpy).toHaveBeenCalledWith(HELP.directions_url);
    expect(screen.getByText(t('cdp_ride_status_offered', { name: 'Fran' }))).toBeTruthy();
    fireEvent.press(screen.getByTestId('ride-accept'));
    await waitFor(() => expect(onOffers).toHaveBeenCalledWith([{ id: 4, status: 'accepted', name: 'Fran' }]));
    expect(calls.find(c => c.url === '/court-dates/9/ride-offers/4')!.data).toEqual({ decision: 'accept' });
    expect(screen.getByText(t('cdp_phone_line', { number: '+18005550199' }))).toBeTruthy();
  });
  test('a county without a cited transit agency shows 211 and directions only', () => {
    wrap(<CourtDayPlan courtDateId={9} plan={PLAN} help={{ ...HELP, transit: null }} offers={[]} styles={makeStyles(themeColors())} onOffers={jest.fn()} />);
    expect(screen.queryByTestId('court-help-transit')).toBeNull();
    expect(screen.getByTestId('court-help-211')).toBeTruthy();
    expect(screen.queryByTestId('ride-offers')).toBeNull();
    expect(screen.queryByTestId('court-phone-line')).toBeNull();
  });
});

describe('Verify phone', () => {
  test('sends a code, confirms it, says how many enrollments were linked', async () => {
    let verified = false;
    on('get', '/me/phone', () => Promise.resolve({ data: { phone: null, phone_verified: verified, verified_at: null, sms_available: true, pending: null } }));
    on('post', '/me/phone/verify', () => Promise.resolve({ data: { sent: true, phone_masked: '•••-•••-0123', expires_at: '' } }));
    on('post', '/me/phone/confirm', () => { verified = true; return Promise.resolve({ data: { verified: true, linked: 1 } }); });
    wrap(<VerifyPhoneScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    fireEvent.changeText(await screen.findByTestId('verify-phone-input'), '615-555-0123');
    fireEvent.press(screen.getByTestId('verify-phone-send'));
    fireEvent.changeText(await screen.findByTestId('verify-phone-code'), '12a3456');
    expect(screen.getByTestId('verify-phone-code').props.value).toBe('123456');
    fireEvent.press(screen.getByTestId('verify-phone-confirm'));
    await screen.findByTestId('verify-phone-done');
    expect(calls.find(c => c.url === '/me/phone/confirm')!.data).toEqual({ code: '123456' });
  });
  test('without text messages it says so and offers no send button', async () => {
    on('get', '/me/phone', { phone: null, phone_verified: false, verified_at: null, sms_available: false, pending: null });
    wrap(<VerifyPhoneScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    await screen.findByTestId('verify-phone-no-sms');
    expect(screen.queryByTestId('verify-phone-send')).toBeNull();
  });
  test('the bail-agent card asks to verify when links are held', async () => {
    const onVerify = jest.fn();
    on('get', '/me/bail-agent', { agents: [], phone_verified: false, verify_prompt: true });
    wrap(<BailAgentCard onCheckIn={jest.fn()} onVerifyPhone={onVerify} />);
    expect(await screen.findByText(t('bac_verify_prompt'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('bail-agent-verify-btn'));
    expect(onVerify).toHaveBeenCalled();
  });
  test('no agents and nothing held: the card renders nothing', async () => {
    on('get', '/me/bail-agent', { agents: [], phone_verified: false, verify_prompt: false });
    wrap(<BailAgentCard onCheckIn={jest.fn()} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('bail-agent-verify')).toBeNull();
  });
  void reject;
});

describe('Ameelio and results', () => {
  test('Ameelio card: wording and link', () => {
    wrap(<AmeelioCard />);
    expect(screen.getByText(t('ame_body'))).toBeTruthy();
    expect(t('ame_body')).toMatch(/free through Ameelio \(a nonprofit\)/);
    fireEvent.press(screen.getByTestId('ameelio-card-link'));
    expect(openSpy).toHaveBeenCalledWith(AMEELIO_URL);
    expect(AMEELIO_URL).toBe('https://www.ameelio.org');
  });
  test('the results page shows nothing until something is published', async () => {
    on('get', '/results', () => Promise.reject(reject(404, { code: 'not_published' })));
    wrap(<ResultsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    await screen.findByTestId('results-none');
    expect(screen.queryByTestId('results-rate')).toBeNull();
  });
  test('the results page shows the published snapshot and the methods note', async () => {
    on('get', '/results', { snapshot: SNAP });
    wrap(<ResultsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    await screen.findByTestId('results-rate');
    expect(screen.getByText('88.2%')).toBeTruthy();
    expect(screen.getByText(t('pres_methods_v1'))).toBeTruthy();
    expect(t('pres_methods_v1')).toMatch(/not a controlled study/);
    expect(screen.getByTestId('results-published')).toBeTruthy();
  });
  test('admin: publishing is disabled under 100 answers', async () => {
    const preview = { ...SNAP, answered: 95, can_publish: false, min_answered: 100 };
    on('get', '/admin/results/preview', { ...preview });
    on('get', '/admin/results/snapshots', { snapshots: [] });
    wrap(<AdminResultsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    await screen.findByTestId('ares-too-small');
    expect(screen.getByTestId('ares-publish').props.accessibilityState?.disabled ?? screen.getByTestId('ares-publish').props.disabled).toBeTruthy();
    expect(calls.some(c => c.method === 'post')).toBe(false);
  });
});
