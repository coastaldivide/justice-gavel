/**
 * session.test.ts — section B regressions for starting / ending a session.
 *
 *  - sign-out removes the account AND the personal data a previous user left on
 *    the device (emergency contacts, typed name, arrest info, offline cases,
 *    cached court dates…) but keeps device settings (language, theme, age check)
 *  - sign-out revokes the session on the server (refresh token + push token)
 *  - sign-in stores the refresh token, adopts the account's language only when
 *    none was chosen on this device, and remembers the account's home screen
 *  - the register form's identifier check matches the server's rule
 *  - the API client reads a JWT's expiry (used to renew before it runs out)
 */
const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn((k: string, v: string) => { mockStore[k] = v; return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { delete mockStore[k]; return Promise.resolve(); }),
    getAllKeys: jest.fn(() => Promise.resolve(Object.keys(mockStore))),
    multiRemove: jest.fn((ks: string[]) => { ks.forEach(k => delete mockStore[k]); return Promise.resolve(); }),
    multiSet: jest.fn((pairs: [string, string][]) => { pairs.forEach(([k, v]) => { mockStore[k] = v; }); return Promise.resolve(); }),
  },
}));
const mockSecure: Record<string, string> = {};
jest.mock('../utils/secureStorage', () => ({
  __esModule: true,
  setToken: jest.fn((v: string) => { mockSecure.token = v; return Promise.resolve(); }),
  setItem: jest.fn((k: string, v: string) => { mockSecure[k] = v; return Promise.resolve(); }),
  getItem: jest.fn((k: string) => Promise.resolve(mockSecure[k] ?? null)),
  getToken: jest.fn(() => Promise.resolve(mockSecure.token ?? null)),
  clearAuth: jest.fn(() => { Object.keys(mockSecure).forEach(k => delete mockSecure[k]); return Promise.resolve(); }),
}));
const mockPost = jest.fn((..._a: unknown[]) => Promise.resolve({ data: { ok: true } }));
jest.mock('../services/api', () => ({ __esModule: true, api: { post: (...a: unknown[]) => mockPost(...a), clearCache: jest.fn() } }));
const mockSetAppAuth = jest.fn();
jest.mock('../services/auth', () => ({ __esModule: true, setAppAuth: (s: string) => mockSetAppAuth(s), setGuestStart: jest.fn() }));
const mockClearOffline = jest.fn(() => Promise.resolve());
jest.mock('../services/offlineSync', () => ({ __esModule: true, clearOfflineData: () => mockClearOffline(), getOfflineCases: () => Promise.resolve([{ id: 'offline_1' }]) }));
jest.mock('../services/push', () => ({ __esModule: true, currentPushToken: () => Promise.resolve('ExponentPushToken[dev]'), registerForPush: () => Promise.resolve(null) }));
jest.mock('../services/analytics', () => ({ __esModule: true, reset: () => Promise.resolve() }));

import { signOut, startSession, takePendingHome, homeRouteFor, unsyncedCaseCount } from '../services/session';
import { getLang, setLang } from '../i18n';
import { isValidIdentifier } from '../utils/identifier';

const fill = (o: Record<string, string>) => { Object.keys(mockStore).forEach(k => delete mockStore[k]); Object.assign(mockStore, o); };

describe('signOut', () => {
  beforeEach(() => { mockPost.mockClear(); mockSetAppAuth.mockClear(); mockClearOffline.mockClear(); });

  it('removes the account and every personal key, keeps device settings', async () => {
    fill({
      contacts: '["+16155550101"]', userName: 'Ana', arrest_info_v1: '{}', chat_session_id: 's1',
      cache_court_dates_v1: '{}', cache_following_v1: '{}', core_path_progress: '{}', jg_timeline_12: '[]',
      points_7: '30', has_browsed: 'true', home_visit_count: '4', user: '{}',
      lang: 'es', jg_theme_mode: 'dark', age_verified: 'true', onboarding_done: 'true', jg_user_state: 'TN', biometric_enabled: 'true',
    });
    Object.assign(mockSecure, { token: 't', refresh_token: 'r', user: '{"id":1}' });
    await signOut();
    expect(Object.keys(mockStore).sort()).toEqual(['age_verified', 'biometric_enabled', 'jg_theme_mode', 'jg_user_state', 'lang', 'onboarding_done']);
    expect(mockSecure).toEqual({});
    expect(mockClearOffline).toHaveBeenCalled();
    expect(mockSetAppAuth).toHaveBeenLastCalledWith('guest');
  });

  it('tells the server which refresh token and push token to drop', async () => {
    Object.assign(mockSecure, { token: 't', refresh_token: 'refresh-1' });
    await signOut();
    expect(mockPost).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'refresh-1', pushToken: 'ExponentPushToken[dev]' }, { timeout: 8000 });
  });

  it('still signs out on this device when the server cannot be reached', async () => {
    mockPost.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    Object.assign(mockSecure, { token: 't' });
    await signOut();
    expect(mockSecure).toEqual({});
    expect(mockSetAppAuth).toHaveBeenLastCalledWith('guest');
  });

  it('after account deletion it does not call the server again', async () => {
    await signOut({ serverDone: true });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('counts cases saved offline that would be lost', async () => {
    expect(await unsyncedCaseCount()).toBe(1);
  });
});

describe('startSession', () => {
  const user = { id: 9, displayName: 'Lee', role: 'attorney', accountType: 'attorney' as const, preferredLanguage: 'pt' };

  it('stores token, refresh token and user; remembers the home screen once', async () => {
    fill({ has_browsed: 'true' });
    await startSession({ token: 'acc', refreshToken: 'ref', user });
    expect(mockSecure).toMatchObject({ token: 'acc', refresh_token: 'ref', user: JSON.stringify(user) });
    expect(mockStore.has_browsed).toBeUndefined();
    expect(mockSetAppAuth).toHaveBeenLastCalledWith('authed');
    expect(takePendingHome()).toBe('AttorneyDashboard');
    expect(takePendingHome()).toBeNull();
  });

  it('adopts the profile language only when none was chosen on this device', async () => {
    setLang('en', { persist: false });
    fill({});
    await startSession({ token: 'a', user });
    expect(getLang()).toBe('pt');
    fill({ lang: 'vi' });
    setLang('vi', { persist: false });
    await startSession({ token: 'a', user: { ...user, preferredLanguage: 'es' } });
    expect(getLang()).toBe('vi');
    setLang('en', { persist: false });
  });
});

describe('homeRouteFor', () => {
  it('sends each account type to its home', () => {
    expect(homeRouteFor({ accountType: 'attorney' })).toBe('AttorneyDashboard');
    expect(homeRouteFor({ role: 'defender' })).toBe('AttorneyDashboard');
    expect(homeRouteFor({ accountType: 'bail_agent', role: 'user' })).toBe('BondsmanDashboard');
    expect(homeRouteFor({ accountType: 'consumer', role: 'user' })).toBeNull();
    expect(homeRouteFor({ role: 'admin' })).toBeNull();
    expect(homeRouteFor(null)).toBeNull();
  });
});

describe('register identifier check', () => {
  it('accepts e-mails and 7–15 digit phone numbers, rejects the rest', () => {
    for (const ok of ['ana@test.dev', '(615) 555-1234', '+16155551234', '6155551234']) expect(isValidIdentifier(ok)).toBe(true);
    for (const bad of ['ana', 'ana@test', '12345', 'call me 6155551234', '1234567890123456']) expect(isValidIdentifier(bad)).toBe(false);
  });
});

describe('tokenExpiry', () => {
  it('reads exp from a base64url JWT payload; null when unreadable', () => {
    jest.isolateModules(() => {
      jest.unmock('../services/api');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tokenExpiry } = require('../services/api');
      const payload = Buffer.from(JSON.stringify({ id: 1, exp: 1800000000, n: 'ÿþ' })).toString('base64url');
      expect(tokenExpiry(`h.${payload}.s`)).toBe(1800000000 * 1000);
      expect(tokenExpiry('garbage')).toBeNull();
      expect(tokenExpiry(null)).toBeNull();
    });
  });
});
