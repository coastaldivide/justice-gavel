/**
 * Render tests: check-ins by text link (A2), missed check-ins (A3), location
 * alerts (B1) and the "Your bail agent" card (B6).
 *
 *   - The public page (c/<token>): a bad / expired link says so without
 *     guessing; it shows the agency and first name; location is off until
 *     ticked, read once at the check-in, and off again afterwards; an extra
 *     check-in on a done day says it is not counted again.
 *   - Check-In Manager: the text channel needs the consent box; the request
 *     carries the channel; text rows offer "text the link again" / "reset
 *     link" and show missed days; the home-point controls are hidden when the
 *     server setting is off.
 *   - Home card: agency, phone, court date, balance and a Check in button;
 *     nothing at all without a linked enrollment.
 */
import React from 'react';
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
  getItem: jest.fn(() => Promise.resolve(JSON.stringify({ id: 1, accountType: 'bail_agent' }))),
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
const mockLocation = {
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({ coords: { latitude: 36.17, longitude: -86.78 } })),
};
jest.mock('expo-location', () => ({
  __esModule: true, Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => mockLocation.requestForegroundPermissionsAsync(),
  getCurrentPositionAsync: () => mockLocation.getCurrentPositionAsync(),
}));

import CheckInLinkScreen from '../../screens/CheckInLinkScreen';
import CheckInManagerScreen, { textStateKey } from '../../screens/CheckInManagerScreen';
import BailAgentCard from '../../components/BailAgentCard';
import { apiMock, makeNavigation } from './apiMock';

const { on, reject, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const BASE = `/checkins/link/${TOKEN}`;
const route = (token = TOKEN) => ({ params: { token } }) as never;
const has = (x: string) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const INFO = {
  agency: { name: 'Liberty Bail Bonds', phone: '615-555-0199' }, first_name: 'Ana', frequency: 'daily',
  checked_in_today: false, done_for_period: false, next_due: '2026-10-27', today: '2026-10-27', time_zone: 'America/Chicago',
  location: { optional: true, distance_alerts: false },
};

beforeEach(() => { reset(); mockLocation.getCurrentPositionAsync.mockClear(); mockLocation.requestForegroundPermissionsAsync.mockClear(); });

describe('check-in text link page', () => {
  it('a malformed link never calls the server; an expired one says so', async () => {
    const { unmount } = wrap(<CheckInLinkScreen navigation={makeNavigation()} route={route('short')} />);
    expect(await screen.findByTestId('checkin-link-error')).toHaveTextContent(has(t('ckl_link_invalid')));
    expect(calls.length).toBe(0);
    unmount();
    on('get', BASE, () => Promise.reject(reject(410, { error: 'expired', code: 'link_expired' })));
    wrap(<CheckInLinkScreen navigation={makeNavigation()} route={route()} />);
    expect(await screen.findByTestId('checkin-link-error')).toHaveTextContent(has(t('ckl_link_expired')));
  });

  it('shows the agency and first name; checks in without location unless ticked, and asks again next time', async () => {
    on('get', BASE, INFO);
    on('post', BASE, ({}, { data }: { data?: unknown }) => Promise.resolve({ data: { ...INFO, checked_in_today: true, done_for_period: true, counted: true, location_shared: !!(data as { lat?: number })?.lat } }));
    wrap(<CheckInLinkScreen navigation={makeNavigation()} route={route()} />);
    expect(await screen.findByTestId('checkin-link-agency')).toHaveTextContent(has(t('ckl_from_agency', { agency: 'Liberty Bail Bonds' })));
    expect(screen.getByTestId('checkin-link-hello')).toHaveTextContent(has(t('ckl_hello', { name: 'Ana' })));
    expect(screen.getByTestId('checkin-link-location-note')).toHaveTextContent(has(t('ckl_location_note', { agency: 'Liberty Bail Bonds' })));
    expect(screen.getByTestId('checkin-link-share-location').props.accessibilityState).toMatchObject({ checked: false });

    fireEvent.press(screen.getByTestId('checkin-link-submit'));
    expect(await screen.findByTestId('checkin-link-done')).toHaveTextContent(has(t('ckl_done')));
    expect(calls.filter(c => c.method === 'post')[0].data).toEqual({});
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('checkin-link-share-location'));
    fireEvent.changeText(screen.getByTestId('checkin-link-note'), 'At work');
    fireEvent.press(screen.getByTestId('checkin-link-submit'));
    await waitFor(() => expect(calls.filter(c => c.method === 'post').length).toBe(2));
    expect(calls.filter(c => c.method === 'post')[1].data).toEqual({ lat: 36.17, lng: -86.78, note: 'At work' });
    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('checkin-link-share-location').props.accessibilityState).toMatchObject({ checked: false }));
  });

  it('a second check-in on a done day says it is recorded but not counted again', async () => {
    on('get', BASE, { ...INFO, checked_in_today: true, done_for_period: true });
    on('post', BASE, { ...INFO, checked_in_today: true, done_for_period: true, counted: false, location_shared: false });
    wrap(<CheckInLinkScreen navigation={makeNavigation()} route={route()} />);
    expect(await screen.findByTestId('checkin-link-status')).toHaveTextContent(has(t('ckl_status_done_today')));
    fireEvent.press(screen.getByTestId('checkin-link-submit'));
    expect(await screen.findByTestId('checkin-link-done')).toHaveTextContent(has(t('ckl_done_extra')));
  });

  it('says so when the location cannot be read, and sends nothing', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockImplementationOnce(() => Promise.resolve({ status: 'denied' }));
    on('get', BASE, INFO);
    wrap(<CheckInLinkScreen navigation={makeNavigation()} route={route()} />);
    fireEvent.press(await screen.findByTestId('checkin-link-share-location'));
    fireEvent.press(screen.getByTestId('checkin-link-submit'));
    expect(await screen.findByTestId('checkin-link-error-msg')).toHaveTextContent(has(t('ckl_location_failed')));
    expect(calls.filter(c => c.method === 'post').length).toBe(0);
  });
});

const ROW = {
  id: 7, defendant_name: 'Sam Textwell', defendant_phone: '+16155550161', defendant_email: null, case_number: null, court_date: null,
  check_in_freq: 'daily', active: 1, linked: false, total_checkins: 2, checkins_today: 0, done_for_period: false, next_due: '2026-10-27',
  today: '2026-10-27', last_checkin: null, checkin_link: null, channel: 'sms', text_consent: true, text_ready: true, missed_text_defendant: true,
  home: null, recent_missed: ['2026-10-26'], last_text: { kind: 'reminder', status: 'sent', at: '2026-10-27T15:00:00Z', delivery_status: 'delivered' },
};
const LIST = { enrollments: [ROW], total_active: 1, fee_cents: 0, monthly_cost_cents: 0, billing_active: false, can_text: true, text_cents: 5,
  location_alerts_enabled: false, agent_settings: { missed_alert_text: false, alert_phone: null } };

describe('Check-In Manager: text channel, missed check-ins', () => {
  it('text rows show the channel, last text, missed days and the link actions; missed check-ins are listed', async () => {
    on('get', '/checkins/enrollments', LIST);
    on('get', '/checkins/missed', { missed: [{ enrollment_id: 7, local_day: '2026-10-26', defendant_name: 'Sam Textwell' }] });
    on('post', '/checkins/enrollments/7/link', { status: 'sent', link: 'https://x/c/y', rotated: false });
    wrap(<CheckInManagerScreen navigation={makeNavigation()} route={{ key: 'k', name: 'CheckInManager' } as never} />);
    expect(await screen.findByTestId('checkin-manager-missed')).toBeTruthy();
    expect(screen.getByTestId('checkin-manager-row-text')).toHaveTextContent(has(t('ckm_last_text', { state: t('ckm_text_delivered') })));
    expect(screen.getByTestId('checkin-manager-row-missed')).toBeTruthy();
    expect(screen.queryByTestId('checkin-manager-send-link')).toBeNull();
    fireEvent.press(screen.getByTestId('checkin-manager-text-link'));
    await waitFor(() => expect(calls.find(c => c.url === '/checkins/enrollments/7/link')?.data).toEqual({ rotate: false }));
  });

  it('enrolling by text needs the consent box; the request carries the channel and consent', async () => {
    on('get', '/checkins/enrollments', { ...LIST, enrollments: [] });
    on('get', '/checkins/missed', { missed: [] });
    on('post', '/checkins/enroll', { enrollment: { ...ROW, id: 8, defendant_name: 'New Person' }, checkin_link: 'https://x/c/z', share_message: 'm', text_status: 'sent' });
    wrap(<CheckInManagerScreen navigation={makeNavigation()} route={{ key: 'k', name: 'CheckInManager' } as never} />);
    fireEvent.press(await screen.findByTestId('checkin-manager-enroll'));
    fireEvent.changeText(screen.getByTestId('checkin-enroll-name'), 'New Person');
    fireEvent.changeText(screen.getByTestId('checkin-enroll-phone'), '6155550123');
    fireEvent.press(screen.getByTestId('checkin-enroll-channel-sms'));
    fireEvent.press(screen.getByTestId('checkin-enroll-save'));
    expect(await screen.findByTestId('checkin-enroll-error')).toHaveTextContent(has(t('ckm_err_consent')));
    expect(calls.find(c => c.url === '/checkins/enroll')).toBeUndefined();
    fireEvent.press(screen.getByTestId('checkin-enroll-consent'));
    fireEvent.press(screen.getByTestId('checkin-enroll-save'));
    await waitFor(() => expect(calls.find(c => c.url === '/checkins/enroll')).toBeTruthy());
    expect(calls.find(c => c.url === '/checkins/enroll')?.data).toMatchObject({ channel: 'sms', consent_confirmed: true, missed_text_defendant: true, defendant_phone: '6155550123' });
  });

  it('home-point controls show only when the server has location alerts on', async () => {
    on('get', '/checkins/missed', { missed: [] });
    const hist = (on_: boolean) => ({ records: [{ id: 3, checked_in_at: '2026-10-27T15:00:00Z', local_day: '2026-10-27', location_label: null, notes: null, lat: 36.1, lng: -86.7, distance_miles: 12.5, outside_radius: true }],
      compliance: { window_days: 30, expected: 1, completed: 1, missed: 0, rate: 100 }, time_zone: 'America/Chicago', missed: [], enrollment: { home: { lat: 36, lng: -86, radius_miles: 5 } }, location_alerts_enabled: on_ });
    on('get', '/checkins/enrollments', LIST);
    on('get', '/checkins/history/7', hist(false));
    const { unmount } = wrap(<CheckInManagerScreen navigation={makeNavigation()} route={{ key: 'k', name: 'CheckInManager' } as never} />);
    fireEvent.press(await screen.findByTestId('checkin-manager-history'));
    expect(await screen.findByTestId('checkin-history-outside')).toBeTruthy();
    expect(screen.queryByTestId('checkin-home')).toBeNull();
    unmount();
    on('get', '/checkins/history/7', hist(true));
    on('put', '/checkins/enrollments/7/home', { home: { lat: 36.1, lng: -86.7, radius_miles: 5 } });
    wrap(<CheckInManagerScreen navigation={makeNavigation()} route={{ key: 'k', name: 'CheckInManager' } as never} />);
    fireEvent.press(await screen.findByTestId('checkin-manager-history'));
    expect(await screen.findByTestId('checkin-home')).toBeTruthy();
    fireEvent.press(screen.getByTestId('checkin-home-from-3'));
    await waitFor(() => expect(calls.find(c => c.method === 'put' && c.url === '/checkins/enrollments/7/home')?.data).toEqual({ radius_miles: 5, record_id: 3 }));
  });

  it('textStateKey prefers the carrier report', () => {
    expect(textStateKey({ kind: 'link', status: 'sent', at: '', delivery_status: 'delivered' })).toBe('ckm_text_delivered');
    expect(textStateKey({ kind: 'link', status: 'sent', at: '', delivery_status: 'delivery_failed' })).toBe('ckm_text_not_delivered');
    expect(textStateKey({ kind: 'link', status: 'opted_out', at: '', delivery_status: null })).toBe('ckm_text_opted_out');
    expect(textStateKey(null)).toBeNull();
  });
});

describe('"Your bail agent" card', () => {
  const AGENT = {
    enrollment_id: 5, agency: { name: 'Liberty Bail Bonds', phone: '615-555-0199' }, next_court_date: '2026-11-15',
    check_in: { frequency: 'daily', next_due: '2026-10-27', checked_in_today: false, done_for_period: false, today: '2026-10-27', time_zone: 'America/Chicago' },
    bond: { status: 'active', balance_cents: 75000, next_payment: null },
  };
  it('shows the agency, court date, balance and a Check in button', async () => {
    on('get', '/me/bail-agent', { agents: [AGENT] });
    const onCheckIn = jest.fn();
    wrap(<BailAgentCard onCheckIn={onCheckIn} />);
    expect(await screen.findByTestId('bail-agent-name')).toHaveTextContent('Liberty Bail Bonds');
    expect(screen.getByTestId('bail-agent-call')).toBeTruthy();
    expect(screen.getByTestId('bail-agent-court')).toBeTruthy();
    expect(screen.getByTestId('bail-agent-balance')).toHaveTextContent(/750/);
    expect(screen.getByTestId('bail-agent-checkin')).toHaveTextContent(has(t('bac_checkin_due_today')));
    fireEvent.press(screen.getByTestId('bail-agent-check-in'));
    expect(onCheckIn).toHaveBeenCalledWith(5);
  });
  it('renders nothing without a linked enrollment (or when the server is unreachable)', async () => {
    on('get', '/me/bail-agent', { agents: [] });
    wrap(<BailAgentCard onCheckIn={jest.fn()} />);
    await waitFor(() => expect(calls.some(c => c.url === '/me/bail-agent')).toBe(true));
    expect(screen.queryByTestId('bail-agent-card')).toBeNull();
  });
});
