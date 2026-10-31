/**
 * Render tests: HomeScreen (tiles, daily tip, court-date countdown, guest vs
 * signed-in loading) and ChatScreen (disclaimer, quick prompts, send → ask →
 * poll → reply, and the error path).
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
let mockToken: string | null = null;
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(mockToken)),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/location', () => ({
  __esModule: true,
  getLocation: jest.fn(() => Promise.reject(new Error('location unavailable'))),
  getLocationWithCity: jest.fn(() => Promise.reject(new Error('location unavailable'))),
  detectAndSaveUserState: jest.fn(() => Promise.resolve(null)),
  formatDistance: (km: number | null) => (km == null ? '' : `${km} km`),
}));
const mockPollJob = jest.fn();
jest.mock('../../services/jobPoller', () => ({
  __esModule: true,
  pollJob: (...a: unknown[]) => mockPollJob(...a),
  JobError: class JobError extends Error { code: string; constructor(code: string, m: string) { super(m); this.code = code; } },
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import HomeScreen from '../../screens/HomeScreen';
import ChatScreen from '../../screens/ChatScreen';

import { apiMock, makeNavigation } from './apiMock';
const { on, api, reject, reset, calls } = apiMock();

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
}

beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockToken = null;
  await AsyncStorage.clear();
});

describe('HomeScreen', () => {
  it('renders the brand, quick-access tiles and the daily legal tip', async () => {
    on('get', '/push/tip', { tip: 'You have the right to remain silent.', category: 'Criminal', lesson_query: 'rights' });
    wrap(<HomeScreen navigation={makeNavigation()} />);
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    expect(screen.getByText('Justice Gavel')).toBeTruthy();
    expect(screen.getByTestId('tile-Bail')).toBeTruthy();
    expect(screen.getByTestId('tile-Lawyers')).toBeTruthy();
    expect(await screen.findByText('You have the right to remain silent.')).toBeTruthy();
    // guest: no token → the private /cases call is never made
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/push/tip'));
    expect(api.get).not.toHaveBeenCalledWith('/cases');
  });

  it('signed in: the countdown counts calendar days in the person\'s zone (/court-dates `today`) and opens that hearing', async () => {
    mockToken = 'jwt';
    on('get', '/push/tip', { tip: 'Tip.' });
    // 23:30 in Chicago on Nov 1 is already Nov 2 in UTC: the hearing on Nov 6 is 5 days away, not 4.
    on('get', '/court-dates', { upcoming: [
      { id: 41, case_id: 1, case_title: 'State v. Me', court_date: '2026-11-06', court_time: '09:00' },
      { id: 42, case_id: 2, case_title: 'Later case', court_date: '2026-12-30', court_time: null },
    ], past: [], today: '2026-11-01', time_zone: 'America/Chicago' });
    const navigation = makeNavigation();
    wrap(<HomeScreen navigation={navigation} />);
    expect(await screen.findByText('State v. Me')).toBeTruthy();
    expect(screen.getByLabelText(/Court date in 5 days/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('home-court-countdown'));
    expect(navigation.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'CourtDateDetail', params: { id: 41 } });
  });

  it('More menu: Custody alerts and Bonds shared with me appear only when the server features are on (and a bond is shared)', async () => {
    mockToken = 'jwt';
    on('get', '/custody/status', { enabled: true });
    on('get', '/recovery-shares/status', { enabled: true, count: 0 });
    const { unmount } = wrap(<HomeScreen navigation={makeNavigation()} />);
    expect(await screen.findByTestId('tile-CustodyAlerts')).toBeTruthy();
    expect(screen.queryByTestId('tile-RecoveryShares')).toBeNull();
    unmount();
    reset();
    on('get', '/custody/status', { enabled: false });
    on('get', '/recovery-shares/status', { enabled: true, count: 1 });
    wrap(<HomeScreen navigation={makeNavigation()} />);
    expect(await screen.findByTestId('tile-RecoveryShares')).toBeTruthy();
    expect(screen.queryByTestId('tile-CustodyAlerts')).toBeNull();
    // Home asks the status route, never the share list (which answers 503 while the setting is off)
    expect(calls.some(c => c.url === '/recovery-shares')).toBe(false);
  });

  it('signed out: neither feature tile is shown', async () => {
    on('get', '/custody/status', { enabled: true });
    wrap(<HomeScreen navigation={makeNavigation()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId('tile-CustodyAlerts')).toBeNull();
    expect(screen.queryByTestId('tile-RecoveryShares')).toBeNull();
  });

  it('a failing API leaves the static tiles usable (no crash, no tip)', async () => {
    wrap(<HomeScreen navigation={makeNavigation()} />);   // no mocks: everything rejects
    expect(screen.getByTestId('tile-Bail')).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Court date/)).toBeNull();
  });

  it('tapping a tile navigates', () => {
    const navigation = makeNavigation();
    wrap(<HomeScreen navigation={navigation} />);
    fireEvent.press(screen.getByTestId('tile-Bail'));
    expect(navigation.navigate).toHaveBeenCalled();
  });
});

describe('ChatScreen', () => {
  beforeEach(() => { mockToken = 'jwt'; });
  const sendViaInput = async (text: string) => {
    const input = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.changeText(input, text);
    fireEvent(input, 'submitEditing');
  };

  it('shows the AI disclaimer and the quick prompts on an empty session', async () => {
    on('get', '/chat/history/', []);
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText(/AI Legal Information -- Not Legal Advice/)).toBeTruthy();
    expect(await screen.findByText('Know your rights')).toBeTruthy();
    // tapping the banner dismisses it and records consent
    fireEvent.press(screen.getByText(/AI Legal Information -- Not Legal Advice/));
    await waitFor(async () =>
      expect(await AsyncStorage.getItem('chat_consent_accepted')).toBe('1'));
    expect(screen.queryByText(/Tap to dismiss/)).toBeNull();
  });

  it('send → POST /chat/ask with sessionId → poll → assistant reply appears', async () => {
    on('get', '/chat/history/', []);
    on('post', '/chat/ask', { jobId: 'job-1', status: 'pending', async: true });
    mockPollJob.mockResolvedValue({
      status: 'done',
      result: { reply: 'You can refuse a search. This is not legal advice.', suggestLawyerSearch: false, intent: 'know_rights' },
    });

    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Know your rights');
    await sendViaInput('Can police search my car?');

    expect(await screen.findByText('Can police search my car?')).toBeTruthy();
    expect(await screen.findByText(/You can refuse a search/)).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/chat/ask', expect.objectContaining({
      message: 'Can police search my car?',
      sessionId: expect.any(String),
      clientMessageId: expect.any(String),     // a retry re-sends the same id: no duplicate answer
    }), expect.objectContaining({ signal: expect.any(Object) }));   // Stop aborts the request
    expect(mockPollJob).toHaveBeenCalledWith('job-1', expect.any(Object));
  });

  it('an answer grounded in the rights card links back to it, with its source', async () => {
    on('get', '/chat/history/', []);
    on('post', '/chat/ask', { jobId: 'job-2', status: 'pending', async: true });
    mockPollJob.mockResolvedValue({
      status: 'done',
      result: { reply: 'You can say you do not consent (see your rights card: rc_3).', suggestLawyerSearch: false, intent: 'know_rights',
        rights_refs: [{ key: 'rc_3', heading: '3. RIGHT AGAINST UNLAWFUL SEARCH  (4th Amendment)', source: 'U.S. Constitution, 4th Amendment (as summarized in the Justice Gavel rights card)', last_reviewed: '2026-04' }] },
    });
    const nav = makeNavigation();
    wrap(<ChatScreen navigation={nav} route={{ params: {} }} />);
    await screen.findByText('Know your rights');
    await sendViaInput('Can police search my car?');
    expect(await screen.findByTestId('chat-rights-refs')).toBeTruthy();
    expect(screen.getByText(/From your rights card: RIGHT AGAINST UNLAWFUL SEARCH/)).toBeTruthy();
    expect(screen.getByText(/Source: U.S. Constitution, 4th Amendment/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/From your rights card/));
    expect(nav.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'RightsCard' });
  });

  it('loads an existing session history on mount', async () => {
    await AsyncStorage.setItem('chat_session_id', 'sess-9');
    on('get', '/chat/history/sess-9', [
      { role: 'user', content: 'What is bail?' },
      { role: 'assistant', content: 'Bail is money the court holds…' },
    ]);
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText('What is bail?')).toBeTruthy();
    expect(screen.getByText(/Bail is money the court holds/)).toBeTruthy();
    expect(screen.queryByText('Know your rights')).toBeNull();   // not the empty state
  });

  it('a failed ask keeps the screen alive and shows an error bubble', async () => {
    on('get', '/chat/history/', []);
    on('post', '/chat/ask', () => Promise.reject(reject(503, { error: 'ai_unavailable' })));
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Know your rights');
    await sendViaInput('hello?');
    expect(await screen.findByText(/AI chat is temporarily unavailable/)).toBeTruthy();
    // the user's own message is kept in the thread
    expect(screen.getByText('hello?')).toBeTruthy();
    expect(screen.getByTestId('chat-retry')).toBeTruthy();
  });

  it('an answer is shown as text: HTML in it is never interpreted', async () => {
    on('get', '/chat/history/', []);
    on('post', '/chat/ask', { jobId: 'job-3', status: 'pending', async: true });
    mockPollJob.mockResolvedValue({ status: 'done', result: { reply: '**Stay calm.** <img src=x onerror=alert(1)>' } });
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Know your rights');
    await sendViaInput('What now?');
    expect(await screen.findByText('Stay calm.')).toBeTruthy();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
  });

  it('a crisis message shows the crisis lines before (and instead of waiting for) the AI', async () => {
    on('get', '/chat/history/', []);
    on('post', '/chat/ask', { jobId: 'job-4', status: 'pending', async: true });
    mockPollJob.mockReturnValue(new Promise(() => {}));
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Know your rights');
    await sendViaInput('no quiero vivir');
    expect(await screen.findByTestId('chat-crisis-card')).toBeTruthy();
  });

  it('a guest sees a sign-in card and the crisis lines, and nothing is sent', async () => {
    mockToken = null;
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('chat-sign-in')).toBeTruthy();
    expect(screen.getByTestId('chat-guest-crisis')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});
