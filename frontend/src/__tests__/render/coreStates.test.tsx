/**
 * coreStates.test.tsx — checklist items 35, 36, 39, 49 on the core path.
 *
 *  35  loading / empty / error states that tell the truth:
 *      - LawyerProfile: network failure → message + "Try again" (re-fetches);
 *        404 → "not available"
 *      - BailCalculator: a state with no schedule says so; a guest is told to
 *        sign in (not "could not load")
 *      - CourtLocator: a search with no hits says "No courthouses found"
 *      - CaseScreen: a failed load is an error with "Try again", never
 *        "No cases yet"
 *  36  CaseScreen offline: court dates come from this device's copy, with a
 *      banner; the copy never contains case notes
 *  39  a double tap on "Save" (LawyerProfile) posts once
 *  49  in-app account deletion: asks for the password, shows the server's
 *      error, and on success signs out locally
 */
import React from 'react';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
let mockToken: string | null = 'jwt-test';
const mockClearAuth = jest.fn(() => Promise.resolve());
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(mockToken)),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: () => mockClearAuth(),
}));
const mockSetAppAuth = jest.fn();
jest.mock('../../services/auth', () => ({ __esModule: true, setAppAuth: (...a: unknown[]) => mockSetAppAuth(...a), registerAuthSetter: jest.fn() }));
jest.mock('../../services/location', () => ({
  __esModule: true,
  getLocation: jest.fn(() => Promise.reject(new Error('denied'))),
  getLocationWithCity: jest.fn(() => Promise.reject(new Error('denied'))),
  detectAndSaveUserState: jest.fn(() => Promise.resolve(null)),
  formatDistance: () => '',
}));
jest.mock('../../services/permissions', () => ({
  __esModule: true,
  requestNotificationsInContext: jest.fn(() => Promise.resolve('declined')),
  requestLocationInContext: jest.fn(() => Promise.resolve('declined')),
  locationGranted: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import LawyerProfileScreen from '../../screens/LawyerProfileScreen';
import BailCalculatorScreen from '../../screens/BailCalculatorScreen';
import CourtLocatorScreen from '../../screens/CourtLocatorScreen';
import CaseScreen from '../../screens/CaseScreen';
import SettingsScreen from '../../screens/SettingsScreen';
import { apiMock, makeNavigation } from './apiMock';
const { on, api, reject, reset, calls } = apiMock();

const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const netErr = () => Promise.reject(Object.assign(new Error('Network error. Please check your connection.'), { code: 'ERR_NETWORK' }));

beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockToken = 'jwt-test';
  await AsyncStorage.clear();
});

describe('LawyerProfileScreen', () => {
  const route = { key: 'p', name: 'LawyerProfile', params: { lawyerId: 5 } } as any;

  it('network failure → honest message and a working "Try again"', async () => {
    let fail = true;
    on('get', '/providers/lawyers/5', () => (fail ? netErr() : Promise.resolve({ data: { id: 5, name: 'Ada Counsel', city: 'Nashville', state: 'TN', specialties: [] } })));
    on('get', '/reviews', { reviews: [] });
    wrap(<LawyerProfileScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByText(/Could not load this attorney/)).toBeTruthy();
    fail = false;
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(await screen.findAllByText(/Ada Counsel/)).toBeTruthy();
  });

  it('404 → "not available" (no retry offered)', async () => {
    on('get', '/providers/lawyers/5', () => Promise.reject(reject(404, { error: 'Not found' })));
    on('get', '/reviews', { reviews: [] });
    wrap(<LawyerProfileScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByText('Attorney profile not available.')).toBeTruthy();
    expect(screen.queryByLabelText('Try again')).toBeNull();
  });

  it('a double tap on Save posts once', async () => {
    on('get', '/providers/lawyers/5', { id: 5, name: 'Ada Counsel', city: 'Nashville', state: 'TN', specialties: [] });
    on('get', '/reviews', { reviews: [] });
    let release: (v: unknown) => void = () => {};
    on('post', '/saved/lawyers', () => new Promise(r => { release = r; }));
    wrap(<LawyerProfileScreen navigation={makeNavigation()} route={route} />);
    const btn = await screen.findByLabelText('⭐ Save');
    fireEvent.press(btn);
    fireEvent.press(btn);
    fireEvent.press(btn);
    await act(async () => { release({ data: { saved: true, id: 1 } }); });
    expect(calls.filter(c => c.method === 'post' && c.url === '/saved/lawyers')).toHaveLength(1);
  });
});

describe('BailCalculatorScreen', () => {
  it('a state with no schedule on file says so', async () => {
    on('get', /\/help\/bail-schedule/, { data: [] });
    wrap(<BailCalculatorScreen navigation={makeNavigation()} route={{ key: 'b', name: 'BailCalculator' } as any} />);
    expect(await screen.findByTestId('bail-no-schedules')).toBeTruthy();
  });

  it('works signed out (public ranges); a failure is an honest error with retry', async () => {
    mockToken = null;
    on('get', /\/help\/bail-schedule/, () => netErr());
    wrap(<BailCalculatorScreen navigation={makeNavigation()} route={{ key: 'b', name: 'BailCalculator' } as any} />);
    expect(await screen.findByText(/Could not load bail schedules/)).toBeTruthy();
    expect(screen.getByText('Tap to retry')).toBeTruthy();
  });

  it('linked to a case: the case\'s state and charge are pre-filled', async () => {
    on('get', /\/help\/bail-schedule\?state=CA/, { data: [
      { id: 1, state: 'CA', charge: 'DUI/DWI First Offense', charge_type: 'misdemeanor', severity: 'Misdemeanor', bail_min: 500, bail_max: 10000, source: 'NIJ_Vera_state_court_data', last_reviewed: null },
      { id: 2, state: 'CA', charge: 'Burglary', charge_type: 'felony', severity: 'Felony', bail_min: 20000, bail_max: 50000 },
    ] });
    wrap(<BailCalculatorScreen navigation={makeNavigation()} route={{ key: 'b', name: 'BailCalculator', params: { state: 'CA', chargeType: 'DUI', caseTitle: 'My DUI case' } } as any} />);
    expect(await screen.findByTestId('bail-case-link')).toBeTruthy();
    const rows = await screen.findAllByTestId('bail-schedule-row');
    expect(rows).toHaveLength(1);
    fireEvent.press(rows[0]);
    expect(await screen.findByTestId('bail-source')).toBeTruthy();
    expect(screen.getByText(/Review date not recorded/)).toBeTruthy();
  });
});

describe('CourtLocatorScreen', () => {
  it('a search with no hits says "No courthouses found"', async () => {
    on('get', /\/courthouses/, []);
    wrap(<CourtLocatorScreen />);
    fireEvent.changeText(await screen.findByPlaceholderText(/Search by city/), 'Nowhereville');
    expect(await screen.findByText(/No courthouses found for “Nowhereville”/, {}, { timeout: 3000 })).toBeTruthy();
  });
});

describe('CaseScreen', () => {
  const nav = makeNavigation();
  const route = { key: 'c', name: 'Cases' } as any;
  const common = () => {
    on('get', '/cases/family', []);
    on('get', '/push/reminders', { reminders: [] });
    on('get', '/messages/unread/count', { count: 0 });
    on('get', '/saved/lawyers', []);
  };

  it('a failed load is an error with "Try again" — never "No cases yet"', async () => {
    common();
    on('get', '/cases', () => netErr());
    wrap(<CaseScreen navigation={nav} route={route} />);
    expect(await screen.findByTestId('case-load-error')).toBeTruthy();
    expect(screen.queryByTestId('case-empty-state')).toBeNull();
  });

  it('offline: court dates come from the device copy (cached without notes) with a banner', async () => {
    common();
    on('get', '/cases', [{ id: 9, title: 'DUI — Davidson', status: 'Open', next_court_date: '2031-04-02', notes: 'PRIVATE' }]);
    const first = wrap(<CaseScreen navigation={nav} route={route} />);
    expect(await screen.findAllByText(/DUI — Davidson/)).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getAllKeys()).toEqual(expect.arrayContaining([expect.stringMatching(/case/i)])));
    const stored = (await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).map(([, v]) => v).join(' ');
    expect(stored).toContain('2031-04-02');
    expect(stored).not.toContain('PRIVATE');
    first.unmount();

    reset(); common();
    on('get', '/cases', () => netErr());
    wrap(<CaseScreen navigation={nav} route={route} />);
    expect(await screen.findByTestId('case-list-offline')).toBeTruthy();
    expect(await screen.findAllByText(/DUI — Davidson/)).toBeTruthy();
  });
});

describe('SettingsScreen — in-app account deletion', () => {
  const route = { key: 's', name: 'Settings' } as any;
  const common = () => {
    on('get', '/push/preferences', {});
    on('get', '/billing/consumer/subscription', {});
  };

  it('requires the password, shows the server error, then deletes and signs out locally', async () => {
    common();
    let attempt = 0;
    on('delete', '/auth/account', (_u: string, { config }: any) => {
      attempt++;
      if (config?.data?.password !== 'Correct9!') return Promise.reject(reject(401, { error: 'Incorrect password.', message: 'Incorrect password.' }));
      return Promise.resolve({ data: { ok: true } });
    });
    wrap(<SettingsScreen navigation={makeNavigation()} route={route} />);
    fireEvent.press(await screen.findByTestId('account-delete-open'));
    fireEvent.press(screen.getByTestId('account-delete-confirm'));
    expect(await screen.findByText('Enter your password to confirm.')).toBeTruthy();
    expect(attempt).toBe(0);

    fireEvent.changeText(screen.getByTestId('account-delete-password'), 'wrong');
    fireEvent.press(screen.getByTestId('account-delete-confirm'));
    expect(await screen.findByText('Incorrect password.')).toBeTruthy();
    expect(mockClearAuth).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('account-delete-password'), 'Correct9!');
    fireEvent.press(screen.getByTestId('account-delete-confirm'));
    await waitFor(() => expect(mockSetAppAuth).toHaveBeenCalledWith('guest'));
    expect(mockClearAuth).toHaveBeenCalled();
    expect(api.delete).toHaveBeenLastCalledWith('/auth/account', { data: { password: 'Correct9!' } });
  });

  it('guests see why they cannot delete (nothing to delete server-side)', async () => {
    mockToken = null;
    common();
    wrap(<SettingsScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('account-delete-signed-out')).toBeTruthy();
    expect(screen.queryByTestId('account-delete-open')).toBeNull();
  });
});
