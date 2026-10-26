/**
 * Render tests — section C flows around the directory:
 *   Booking   prices are the server's ($10 / $15 / $25, not the old $9.99 /
 *             $14.99 / $24.99), times come from each slot's exact instant,
 *             lawyers not on the app cannot be booked (phone offered), payments
 *             off → a friendly message and nothing booked
 *   Match     the server answers with a job → the app polls it and shows the
 *             cards (it used to read the job envelope as an empty list);
 *             location off → asks for a place instead of matching near Nashville
 *   PI lead   the fee note matches the lead type ($100 employment), the state
 *             is sent, nothing is submitted without one
 *   Saved / Search / Booking / Golden Gavel  guests make no account calls (no 401s)
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
let mockToken: string | null = 'jwt-test';
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(mockToken)),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
let mockGps = true;
jest.mock('../../services/location', () => ({
  __esModule: true,
  getLocationWithCity: jest.fn(() => Promise.resolve(mockGps
    ? { lat: 36.16, lng: -86.78, city: 'Nashville', source: 'gps', permissionGranted: true }
    : { lat: 36.1627, lng: -86.7816, city: 'Nashville, TN', source: 'default', permissionGranted: false })),
  formatDistance: (km: number | null) => (km == null ? '' : `${km} km`),
}));
const mockPollJob = jest.fn();
jest.mock('../../services/jobPoller', () => ({ __esModule: true, pollJob: (...a: unknown[]) => mockPollJob(...a) }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import BookingScreen from '../../screens/BookingScreen';
import MatchScreen from '../../screens/MatchScreen';
import PILeadScreen from '../../screens/PILeadScreen';
import SavedLawyersScreen from '../../screens/SavedLawyersScreen';
import SearchScreen from '../../screens/SearchScreen';
import GoldenGavelScreen from '../../screens/GoldenGavelScreen';
import { apiMock, makeNavigation } from './apiMock';
const { on, api, reject, reset, calls } = apiMock();

const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const PRICES = [
  { duration_min: 15, fee_cents: 1000, fee_display: '$10.00' },
  { duration_min: 30, fee_cents: 1500, fee_display: '$15.00' },
  { duration_min: 60, fee_cents: 2500, fee_display: '$25.00' },
];
// 9:00 AM on the lawyer's clock (America/Chicago, CDT) = 14:00 UTC.
const START = '2026-10-22T14:00:00.000Z';
const SLOTS = {
  lawyer_id: 7, lawyer_name: 'Ada Counsel', lawyer_phone: '+16155550001', bookable: true, time_zone: 'America/Chicago',
  prices: PRICES, refund_cutoff_hours: 2,
  slots: [{ date: '2026-10-22', times: [{ time: '9:00 AM', starts_at: START, available: true }, { time: '10:00 AM', starts_at: '2026-10-22T15:00:00.000Z', available: false }] }],
};
const shownTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockToken = 'jwt-test';
  mockGps = true;
  await AsyncStorage.clear();
});

describe('BookingScreen', () => {
  const route = { key: 'b', name: 'Booking', params: { lawyerId: 7, lawyerName: 'Ada Counsel' } } as any;

  it('shows the server prices — what is charged is what is shown', async () => {
    on('get', '/consultations/slots/7', SLOTS);
    on('get', '/consultations/prefill', { suggested_notes: null });
    wrap(<BookingScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByText('$10.00')).toBeTruthy();
    expect(screen.getByText('$15.00')).toBeTruthy();
    expect(screen.getByText('$25.00')).toBeTruthy();
    expect(screen.queryByText('$14.99')).toBeNull();
  });

  it('times come from the slot instant; payments off → friendly message, the exact slot was sent', async () => {
    on('get', '/consultations/slots/7', SLOTS);
    on('get', '/consultations/prefill', { suggested_notes: null });
    on('post', '/consultations/book', () => Promise.reject(reject(503, { error: 'payments_unavailable', message: 'Payments are not available yet.' })));
    wrap(<BookingScreen navigation={makeNavigation()} route={route} />);
    fireEvent.press(await screen.findByTestId('booking-next'));
    const chips = await screen.findAllByTestId('booking-time');
    expect(chips).toHaveLength(1);                               // the taken 10:00 slot is not offered
    expect(screen.getByText(shownTime(START))).toBeTruthy();
    fireEvent.press(chips[0]);
    fireEvent.press(screen.getByTestId('booking-confirm-button'));
    expect(await screen.findByTestId('booking-refund-terms')).toBeTruthy();
    expect(screen.getByText(/non-refundable once the booking is confirmed/)).toBeTruthy();  // not the old "24h" promise
    fireEvent.press(screen.getByTestId('booking-confirm'));
    expect(await screen.findByText(/Payments are not available yet, so consultations cannot be booked/)).toBeTruthy();
    expect(calls.find(c => c.method === 'post' && c.url === '/consultations/book')?.data)
      .toMatchObject({ lawyer_id: 7, date_slot: '2026-10-22', time_slot: '9:00 AM', duration_min: 30 });
  });

  it('a lawyer who is not on the app cannot be booked: says so and offers the phone', async () => {
    on('get', '/consultations/slots/7', { ...SLOTS, bookable: false, slots: [], message: 'This lawyer does not take bookings or messages through Justice Gavel yet. Call or text the office directly.' });
    on('get', '/consultations/prefill', { suggested_notes: null });
    wrap(<BookingScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('booking-not-on-app')).toBeTruthy();
    expect(screen.getByText('Call (615) 555-0001')).toBeTruthy();
    expect(screen.queryByTestId('booking-next')).toBeNull();
  });
});

describe('MatchScreen', () => {
  it('polls the match job and shows the cards with their report', async () => {
    on('get', '/match/lawyers', { jobId: 'job-1', status: 'pending', async: true });
    mockPollJob.mockResolvedValue({ status: 'done', result: [
      { id: 7, rank: 1, name: 'Ada Counsel', phone: '+16155550001', address: '1 Main St', rating: 4.9, reviews: 10, matchReport: 'Close to you and offers a free consultation.' },
    ] });
    wrap(<MatchScreen />);
    fireEvent.press(screen.getByTestId('match-submit'));
    expect(await screen.findByText('Ada Counsel')).toBeTruthy();
    expect(screen.getByTestId('match-report')).toBeTruthy();
    expect(mockPollJob).toHaveBeenCalledWith('job-1', expect.anything());
    const call = api.get.mock.calls.find((c: any[]) => c[0] === '/match/lawyers');
    expect(call[1].params).toMatchObject({ lat: 36.16, lng: -86.78, limit: 3 });
  });

  it('location off and no place typed → asks for a place (no matching near a default city)', async () => {
    mockGps = false;
    wrap(<MatchScreen />);
    fireEvent.press(screen.getByTestId('match-submit'));
    expect(await screen.findByText(/Location is off/)).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/match/lawyers', expect.anything());
    on('get', '/match/lawyers', { status: 'done', matches: [], message: 'No lawyer in our directory matches these choices near you.' });
    fireEvent.changeText(screen.getByTestId('match-place'), 'Richmond, VA');
    fireEvent.press(screen.getByTestId('match-submit'));
    expect(await screen.findByText(/No lawyer in our directory matches/)).toBeTruthy();
    expect(api.get.mock.calls.find((c: any[]) => c[0] === '/match/lawyers')[1].params).toMatchObject({ city: 'Richmond, VA' });
  });
});

describe('PILeadScreen', () => {
  it('fee note matches the lead type ($100 for employment); the state is required and sent', async () => {
    on('get', '/billing/pi-lead/fees', { fees: [{ lead_type: 'employment', fee_display: '$100' }, { lead_type: 'personal_injury', fee_display: '$200' }] });
    on('post', '/billing/pi-lead/submit', { ok: true, lead_id: 3 });
    wrap(<PILeadScreen navigation={makeNavigation()} route={{ key: 'p', name: 'PILead', params: { caseType: 'Employment' } } as any} />);
    expect(await screen.findByText(/flat \$100 connection fee/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Minor'));
    fireEvent.changeText(screen.getByLabelText('Describe what happened'), 'I was fired the day after I reported a safety problem.');
    fireEvent.changeText(screen.getByTestId('pilead-city'), 'Nashville');
    fireEvent.press(screen.getByLabelText('Submit your case to attorneys'));
    await new Promise(r => { setTimeout(r, 50); });
    expect(calls.some(c => c.method === 'post')).toBe(false);   // no state chosen yet
    fireEvent(screen.getByTestId('pilead-state'), 'onValueChange', 'TN');
    fireEvent.press(screen.getByLabelText('Submit your case to attorneys'));
    await waitFor(() => expect(calls.find(c => c.method === 'post')?.data).toMatchObject({ case_type: 'Employment', state: 'TN', city: 'Nashville' }));
  });
});

describe('guests', () => {
  it('Saved lawyers: sign-in prompt, no 401 request', async () => {
    mockToken = null;
    wrap(<SavedLawyersScreen navigation={makeNavigation()} />);
    expect(await screen.findByTestId('saved-signed-out')).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('Search: sign-in prompt, no 401 request', async () => {
    mockToken = null;
    wrap(<SearchScreen navigation={makeNavigation()} route={{ key: 's', name: 'Search' } as any} />);
    expect(await screen.findByTestId('search-signed-out')).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/search', expect.anything());
  });

  it('Booking: no prefill request for a guest (no 401)', async () => {
    mockToken = null;
    on('get', '/consultations/slots/7', SLOTS);
    wrap(<BookingScreen navigation={makeNavigation()} route={{ key: 'b', name: 'Booking', params: { lawyerId: 7 } } as any} />);
    expect(await screen.findByText('$10.00')).toBeTruthy();
    await new Promise(r => { setTimeout(r, 30); });
    expect(api.get.mock.calls.map((c: any[]) => c[0])).not.toContain('/consultations/prefill');
  });

  it('Golden Gavel: a guest gets the public hall only (no status / eligibility 401s)', async () => {
    mockToken = null;
    on('get', '/golden-gavel/hall', []);
    wrap(<GoldenGavelScreen />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/golden-gavel/hall'));
    const urls = api.get.mock.calls.map((c: any[]) => c[0]);
    expect(urls).not.toContain('/golden-gavel/status');
    expect(urls).not.toContain('/golden-gavel/eligibility');
  });
});
