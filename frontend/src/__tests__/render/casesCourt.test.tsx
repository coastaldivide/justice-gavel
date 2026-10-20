/**
 * casesCourt.test.tsx — section D (cases & court) regressions.
 *
 *  1  a tapped push opens its screen: court reminder → its hearing, check-in
 *     reminder → Check-in with the enrollment, follower push ("Following") →
 *     Court dates, message → the case thread; unknown screens open nothing
 *     (court / check-in / message taps used to go nowhere)
 *  2  CaseScreen editor: the state is saved (it was dropped), an impossible
 *     date is refused before sending, offline a NEW case keeps its court date
 *     and state in the queue (both were lost), "Delete case" deletes
 *  3  CaseScreen tabs: Messages lists the threads with unread counts (it showed
 *     the case list), Tools shows only tools
 *  4  CheckIn without a link finds the enrollment by account; after checking in
 *     it says the agent was notified only when the push really went out
 *  5  Deadline calculator: the federal habeas (AEDPA) year is one year in every
 *     state (it used a state table — 10 years for Maryland); judgment-based
 *     deadlines need only the judgment date
 *  6  timeline event dates and scan / share helpers never shift the day
 *  7  signed out, Cases offers to sign in (it showed an empty list whose
 *     "Create first case" ended in "Authentication required.") and sends nothing
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve('jwt-test')),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
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
jest.mock('../../utils/webCompat', () => ({ ...jest.requireActual('../../utils/webCompat'), hapticImpact: jest.fn(() => Promise.resolve()), hapticNotification: jest.fn(() => Promise.resolve()) }));
// the offline queue as the web build runs it (AsyncStorage-backed)
jest.mock('../../services/offlineSync', () => jest.requireActual('../../services/offlineSync.web'));
jest.mock('../../services/haptics', () => ({ __esModule: true, hapticSuccess: jest.fn(), hapticWarn: jest.fn() }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import { notificationTarget } from '../../services/notificationRoute';
import CaseScreen, { parseScanResult, courtDateShareText } from '../../screens/CaseScreen';
import CheckInScreen, { dueLabel } from '../../screens/CheckInScreen';
import { DEADLINE_RULES } from '../../screens/DeadlineCalculatorScreen';
import { formatEventDate } from '../../screens/CaseTimelineScreen';
import { validCourtDate } from '../../utils/dateUtils';
import { getOfflineCases } from '../../services/offlineSync';
import { apiMock, makeNavigation } from './apiMock';
const { on, reset, calls } = apiMock();

const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const netErr = () => Promise.reject(Object.assign(new Error('Network error. Please check your connection.'), { code: 'ERR_NETWORK' }));

beforeEach(async () => { reset(); jest.clearAllMocks(); await AsyncStorage.clear(); });

describe('1 push taps', () => {
  it('opens the right screen with its ids; unknown screens open nothing', () => {
    expect(notificationTarget({ type: 'court_reminder', screen: 'Cases', case_id: 4, court_date_id: 9 })).toEqual({ screen: 'CourtDateDetail', params: { id: 9 } });
    expect(notificationTarget({ type: 'checkin_reminder', screen: 'CheckIn', enrollment_id: 7 })).toEqual({ screen: 'CheckIn', params: { enrollmentId: 7 } });
    expect(notificationTarget({ type: 'follower_court_reminder', screen: 'Following' })).toEqual({ screen: 'CourtDates' });
    expect(notificationTarget({ type: 'message', screen: 'Messages', caseId: 3 })).toEqual({ screen: 'Messages', params: { caseId: 3 } });
    expect(notificationTarget({ screen: 'Home' })).toEqual({ tab: 'HomeTab' });
    expect(notificationTarget({ type: 'arrest_alert' })).toEqual({ screen: 'ArrestMonitor' });
    expect(notificationTarget({ screen: 'NoSuchScreen' })).toBeNull();
    expect(notificationTarget(null)).toBeNull();
  });
});

describe('2–3 CaseScreen', () => {
  const nav = makeNavigation();
  const route = { key: 'c', name: 'Cases' } as any;
  const common = () => {
    on('get', '/cases/family', []);
    on('get', '/push/reminders', { reminders: [] });
    on('get', '/messages/threads', { threads: [{ case_id: 1, title: 'DUI case', status: 'Open', unread: 2, last_message_at: null, counsel_count: 1, role: 'client' }] });
    on('get', '/saved/lawyers', []);
  };

  it('saves the state and refuses an impossible date', async () => {
    common();
    on('get', '/cases', []);
    on('post', '/cases', { id: 5, title: 'New', status: 'Open' });
    wrap(<CaseScreen navigation={nav} route={route} />);
    fireEvent.press(await screen.findByTestId('case-add-button'));
    fireEvent.changeText(await screen.findByTestId('case-title-input'), 'Theft — Shelby');
    fireEvent.changeText(screen.getByTestId('case-court-date-input'), '2027-02-30');
    fireEvent.changeText(screen.getByTestId('case-state-input'), 'tn');
    fireEvent.press(screen.getByTestId('case-save'));
    expect(await screen.findByTestId('case-editor-error')).toBeTruthy();
    expect(calls.some(c => c.method === 'post' && c.url === '/cases')).toBe(false);
    fireEvent.changeText(screen.getByTestId('case-court-date-input'), '2027-02-27');
    fireEvent.press(screen.getByTestId('case-save'));
    await waitFor(() => expect(calls.find(c => c.method === 'post' && c.url === '/cases')?.data).toMatchObject({ title: 'Theft — Shelby', state: 'TN', next_court_date: '2027-02-27' }));
  });

  it('offline: a new case keeps its court date and state in the queue', async () => {
    common();
    on('get', '/cases', []);
    on('post', '/cases', () => netErr());
    wrap(<CaseScreen navigation={nav} route={route} />);
    fireEvent.press(await screen.findByTestId('case-add-button'));
    fireEvent.changeText(await screen.findByTestId('case-title-input'), 'Offline case');
    fireEvent.changeText(screen.getByTestId('case-court-date-input'), '2027-03-01');
    fireEvent.changeText(screen.getByTestId('case-state-input'), 'GA');
    fireEvent.press(screen.getByTestId('case-save'));
    await waitFor(async () => expect(await getOfflineCases()).toEqual([expect.objectContaining({ title: 'Offline case', next_court_date: '2027-03-01', state: 'GA' })]));
  });

  it('Delete case asks, then deletes', async () => {
    common();
    on('get', '/cases', [{ id: 8, title: 'Old case', status: 'Closed', next_court_date: null, notes: '', created_at: '2026-01-02T00:00:00Z' }]);
    on('delete', '/cases/8', { ok: true });
    wrap(<CaseScreen navigation={nav} route={route} />);
    fireEvent.press(await screen.findByTestId('case-edit'));
    const ask = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.find(b => b.style === 'destructive')?.onPress?.(); });
    fireEvent.press(await screen.findByTestId('case-delete'));
    expect(ask).toHaveBeenCalledWith('Delete this case?', expect.stringContaining('Old case'), expect.anything(), expect.anything());
    await waitFor(() => expect(calls.some(c => c.method === 'delete' && c.url === '/cases/8')).toBe(true));
  });

  it('Messages tab lists threads with unread counts; Tools shows tools only', async () => {
    common();
    on('get', '/cases', [{ id: 1, title: 'DUI case', status: 'Open', next_court_date: null, notes: '', created_at: '2026-01-02T00:00:00Z' }]);
    wrap(<CaseScreen navigation={nav} route={route} />);
    await screen.findByTestId('case-card');
    fireEvent.press(screen.getByTestId('case-tab-messages'));
    expect(await screen.findByTestId('case-thread-row')).toBeTruthy();
    expect(screen.queryByTestId('case-card')).toBeNull();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId('case-tab-tools'));
    expect(await screen.findByTestId('case-tool-deadlines')).toBeTruthy();
    expect(screen.queryByTestId('case-card')).toBeNull();
  });

  it('signed out: a sign-in prompt instead of "Authentication required", and no requests', async () => {
    const { getToken } = jest.requireMock('../../utils/secureStorage') as { getToken: jest.Mock };
    getToken.mockImplementation(() => Promise.resolve(null));
    try {
      wrap(<CaseScreen navigation={nav} route={route} />);
      expect(await screen.findByTestId('case-sign-in')).toBeTruthy();
      expect(screen.queryByTestId('case-add-button')).toBeNull();
      fireEvent.press(screen.getByTestId('case-tab-messages'));
      expect(await screen.findByTestId('case-messages-sign-in')).toBeTruthy();
      expect(calls).toEqual([]);
    } finally {
      getToken.mockImplementation(() => Promise.resolve('jwt-test'));
    }
  });
});

describe('4 CheckInScreen', () => {
  const enrollment = { id: 7, defendant_name: 'Dana', case_number: null, court_date: null, check_in_freq: 'daily', agent_name: 'Ace Bail',
    checked_in_today: false, done_for_period: false, next_due: '2026-10-20', streak: 0, total_checkins: 0, today: '2026-10-20', time_zone: 'America/Chicago' };

  it('finds the enrollment without a link and is honest about the notification', async () => {
    on('get', '/checkins/mine', { enrollments: [enrollment] });
    on('post', '/checkins/submit', { agent_notified: false, next_due: '2026-10-21', streak: 1, total_checkins: 1, today: '2026-10-20' });
    wrap(<CheckInScreen navigation={makeNavigation()} route={{ key: 'k', name: 'CheckIn' } as any} />);
    expect(await screen.findByText(/Ace Bail/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('checkin-submit-button'));
    expect(await screen.findByTestId('checkin-success-screen')).toBeTruthy();
    expect(screen.getByText('Your check-in is saved. Your bail agent sees it in their list.')).toBeTruthy();
    expect(screen.queryByText(/was notified/)).toBeNull();
    expect(screen.getByTestId('checkin-next-due').props.children).toBe('Next check-in: tomorrow.');
    expect(calls.find(c => c.url === '/checkins/submit')?.data).not.toHaveProperty('lat');   // location stays off unless turned on
  });

  it('due labels are relative to the defendant\'s own day', () => {
    expect(dueLabel('2026-10-20', '2026-10-20')).toBe('today');
    expect(dueLabel('2026-11-01', '2026-10-31')).toBe('tomorrow');
    expect(dueLabel('2026-11-05', '2026-10-31')).toMatch(/^on Thursday, November 5, 2026$/);
  });
});

describe('5 Deadline calculator', () => {
  const rules = DEADLINE_RULES();
  const aedpa = rules.find(r => r.note.includes('2244'));
  it('AEDPA is one year in every state', () => {
    const judgment = new Date(2026, 0, 15);
    for (const st of ['MD', 'IL', 'TX', 'TN', '']) {
      const d = aedpa?.compute(null, judgment, st);
      expect(d && [d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 0, 15]);
    }
  });
  it('judgment-based deadlines need only the judgment date', () => {
    for (const r of rules.filter(x => x.basis === 'judgment')) expect(r.compute(null, new Date(2026, 5, 1), 'TN')).toBeInstanceOf(Date);
    for (const r of rules.filter(x => x.basis === 'arrest')) expect(r.compute(null, new Date(2026, 5, 1), 'TN')).toBeNull();
  });
});

describe('6 dates never shift', () => {
  it('event dates, scan dates, share text', () => {
    expect(formatEventDate('2026-11-01')).toBe('Nov 1, 2026');
    expect(formatEventDate('2026-11-01T00:00:00.000Z')).toBe('Nov 1, 2026');
    expect(validCourtDate('2026-02-29')).toBe(false);
    expect(validCourtDate('2028-02-29')).toBe(true);
    expect(parseScanResult('Charged with DUI. Court 3/9/2027 in TN.', {})).toMatchObject({ state: 'TN', courtDate: '2027-03-09' });
    expect(parseScanResult('', { _intake: { title: 'DUI', state: 'tn', court_date: '2027-01-02', defendant_name: 'Al' } }))
      .toMatchObject({ title: 'DUI', state: 'TN', courtDate: '2027-01-02', notes: 'Defendant: Al' });
    expect(courtDateShareText({ title: 'My case', next_court_date: '2026-12-01' })).toBe('My court date for My case: Tuesday, December 1, 2026.');
  });
});
