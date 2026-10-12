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
}));

import HomeScreen from '../../screens/HomeScreen';
import ChatScreen from '../../screens/ChatScreen';

import { apiMock, makeNavigation } from './apiMock';
const { on, api, reject, reset } = apiMock();

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

  it('signed in: shows the court-date countdown from /cases', async () => {
    mockToken = 'jwt';
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    on('get', '/push/tip', { tip: 'Tip.' });
    on('get', '/cases', [
      { id: 1, title: 'State v. Me', next_court_date: soon },
      { id: 2, title: 'No date case' },
    ]);
    wrap(<HomeScreen navigation={makeNavigation()} />);
    expect(await screen.findByText('State v. Me')).toBeTruthy();
    expect(screen.getByLabelText(/Court date in \d+ days/)).toBeTruthy();
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
    }));
    expect(mockPollJob).toHaveBeenCalledWith('job-1', expect.any(Object));
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
  });
});
