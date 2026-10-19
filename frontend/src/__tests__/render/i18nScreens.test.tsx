/**
 * i18nScreens.test.tsx — the priority screens render with no English left in
 * Spanish, Portuguese and Vietnamese:
 *
 *   CaseScreen (list, statuses, offline banner) · Settings · Chat (AI
 *   disclaimer, quick prompts) · AI disclaimer banner · legal disclaimer modal
 *   · terms-acceptance modal · Register · "payments are not available yet".
 *
 * Every visible string (text, accessibility labels / hints, placeholders) is
 * collected and checked against English sentence fragments from en.json
 * (same detector as i18nCorePath.test.tsx). Data that is not app text (a case
 * title someone typed) is chosen so it contains no en.json phrase.
 */
import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react-native';
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
jest.mock('../../services/auth', () => ({ __esModule: true, setAppAuth: jest.fn(), registerAuthSetter: jest.fn() }));
jest.mock('../../services/push', () => ({ __esModule: true, registerForPush: jest.fn(() => Promise.resolve()) }));
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
  explain: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../services/jobPoller', () => ({ __esModule: true, pollJob: jest.fn(() => new Promise(() => {})) }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import CaseScreen from '../../screens/CaseScreen';
import SettingsScreen from '../../screens/SettingsScreen';
import ChatScreen from '../../screens/ChatScreen';
import RegisterScreen from '../../screens/RegisterScreen';
import TermsAcceptanceModal from '../../screens/TermsAcceptanceModal';
import LegalDisclaimerModal from '../../components/LegalDisclaimerModal';
import AIDisclaimer from '../../components/AIDisclaimer';
import { PAYMENTS_COMING_SOON } from '../../payments';
import { setLang, type Lang } from '../../i18n';
import { apiMock, makeNavigation } from './apiMock';
import en from '../../i18n/en.json';
import es from '../../i18n/es.json';
import pt from '../../i18n/pt.json';
import vi from '../../i18n/vi.json';

const { on, reset } = apiMock();
const FILES: Record<string, Record<string, string>> = { es, pt, vi };
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);

function englishFragments(lang: string): string[] {
  const target = Object.values(FILES[lang]).join('\n');
  const out = new Set<string>();
  for (const v of Object.values(en as Record<string, string>)) {
    for (const raw of v.split(/[.!?:;—•\n()“”"·→←]+/)) {
      const f = raw.trim();
      if (f.length < 8 || (f.match(/[A-Za-z]{2,}/g) || []).length < 2) continue;
      if (/\{\w+\}/.test(f) || target.includes(f)) continue;
      out.add(f);
    }
  }
  return [...out];
}

function visibleStrings(): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const p = n.props || {};
    for (const k of ['accessibilityLabel', 'accessibilityHint', 'placeholder', 'title']) if (typeof p[k] === 'string') out.push(p[k]);
    (n.children || []).forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}

function expectNoEnglish(lang: string) {
  const text = visibleStrings().join('\n');
  const leaks = englishFragments(lang).filter(f => text.includes(f));
  expect([lang, leaks]).toEqual([lang, []]);
  return text;
}

const tx = (lang: string, key: string) => FILES[lang][key];

beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockToken = 'jwt-test';
  await AsyncStorage.clear();
  await AsyncStorage.setItem('jg_user_state', 'TN');
});
afterAll(() => setLang('en', { persist: false }));

describe.each(['es', 'pt', 'vi'] as Lang[])('priority screens in %s — no English left', (lang) => {
  beforeEach(() => { act(() => setLang(lang, { persist: false })); });

  it('CaseScreen: case list with a stored English status shown in the language', async () => {
    on('get', '/cases/family', []);
    on('get', '/push/reminders', { reminders: [] });
    on('get', '/messages/unread/count', { count: 0 });
    on('get', '/saved/lawyers', []);
    on('get', '/cases', [{ id: 9, title: 'Caso 9', status: 'Open', case_type: 'DUI', next_court_date: '2031-04-02', state: 'TN' }]);
    wrap(<CaseScreen navigation={makeNavigation()} route={{ key: 'c', name: 'Cases' } as any} />);
    expect((await screen.findAllByText(/Caso 9/)).length).toBeGreaterThan(0);
    const text = expectNoEnglish(lang);
    expect(text).toContain(tx(lang, 'case_status_open'));
  });

  it('CaseScreen: a failed load is an error in the language', async () => {
    on('get', '/cases/family', []);
    on('get', '/push/reminders', { reminders: [] });
    on('get', '/messages/unread/count', { count: 0 });
    on('get', '/saved/lawyers', []);
    on('get', '/cases', () => Promise.reject(Object.assign(new Error('x'), { code: 'ERR_NETWORK' })));
    wrap(<CaseScreen navigation={makeNavigation()} route={{ key: 'c', name: 'Cases' } as any} />);
    expect(await screen.findByTestId('case-load-error')).toBeTruthy();
    expectNoEnglish(lang);
  });

  it('Settings (signed in)', async () => {
    on('get', '/push/preferences', {});
    on('get', '/billing/consumer/subscription', {});
    on('get', '/auth/me', { user: { id: 1, email: 'ana@example.test', role: 'consumer', first_name: 'Ana' } });
    wrap(<SettingsScreen navigation={makeNavigation()} route={{ key: 's', name: 'Settings' } as any} />);
    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
    await screen.findByTestId('account-delete-open');
    expectNoEnglish(lang);
    fireEvent.press(screen.getByTestId('account-delete-open'));
    await screen.findByTestId('account-delete-confirm');
    expectNoEnglish(lang);
  });

  it('Chat: disclaimer, quick prompts and the input', async () => {
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    expect(await screen.findByText(tx(lang, 'x_ch_i_am_ai_guide'))).toBeTruthy();
    expectNoEnglish(lang);
  });

  it('AI disclaimer banner', async () => {
    wrap(<AIDisclaimer variant="banner" />);
    expectNoEnglish(lang);
  });

  it('legal disclaimer modal', async () => {
    wrap(<LegalDisclaimerModal visible onAccept={jest.fn()} />);
    const text = expectNoEnglish(lang);
    expect(text).toContain(tx(lang, 'x_legal_disclaimer_modal_text'));
  });

  it('terms-acceptance modal', async () => {
    wrap(<TermsAcceptanceModal visible onAccepted={jest.fn()} />);
    expect(screen.getByTestId('tos-scroll')).toBeTruthy();
    expectNoEnglish(lang);
  });

  it('Register', async () => {
    wrap(<RegisterScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    expect(await screen.findByTestId('register-screen')).toBeTruthy();
    expectNoEnglish(lang);
    fireEvent.press(screen.getByTestId('register-submit-button'));
    await waitFor(() => expect(screen.getByTestId('register-error-message')).toBeTruthy());
    expectNoEnglish(lang);
  });

  it('"payments are not available yet" is in the language', () => {
    expect(PAYMENTS_COMING_SOON()).toBe(tx(lang, 'x_common_payments_aren_t_available'));
    expect(PAYMENTS_COMING_SOON()).not.toBe((en as Record<string, string>).x_common_payments_aren_t_available);
  });
});
