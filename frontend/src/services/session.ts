/**
 * session.ts — starting and ending a signed-in session (one place for both).
 *
 *   startSession(res.data)  after /auth/login or /auth/register: stores the
 *                           tokens + user, adopts the account's saved language
 *                           (unless one was chosen on this device), remembers the
 *                           account's home screen (attorney dashboard, bail-agent
 *                           lead dashboard) and switches the app to signed-in.
 *                           App.tsx opens that home once the Terms gate is done
 *                           (takePendingHome) — never underneath the Terms.
 *   signOut()               tells the server (refresh token revoked, this
 *                           device's push token removed), then removes the
 *                           account AND everything personal kept on this device —
 *                           emergency contacts, offline cases, cached court dates —
 *                           so the next person on the phone sees none of it.
 *
 * Device settings stay: language, theme, age check, app lock, saved US state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { setAppAuth, setGuestStart } from './auth';
import { clearAllCaches } from './offlineCache';
import { clearOfflineData, getOfflineCases } from './offlineSync';
import { currentPushToken, registerForPush } from './push';
import { clearAuth, getItem, setItem, setToken } from '../utils/secureStorage';
import { isLang, setLang } from '../i18n';

export type AccountType = 'consumer' | 'attorney' | 'bail_agent';

export interface SessionUser {
  id: number;
  email?: string | null;
  phone?: string | null;
  displayName?: string;
  role?: string;
  accountType?: AccountType;
  preferredLanguage?: string | null;
}

export interface SessionPayload {
  token: string;
  refreshToken?: string;
  user: SessionUser;
}

/** The MoreTab screen an account starts on after signing in; null = the normal Home. */
export function homeRouteFor(user: Pick<SessionUser, 'role' | 'accountType'> | null | undefined): 'AttorneyDashboard' | 'BondsmanDashboard' | null {
  if (!user) return null;
  if (user.accountType === 'attorney' || user.role === 'attorney' || user.role === 'defender') return 'AttorneyDashboard';
  if (user.accountType === 'bail_agent') return 'BondsmanDashboard';
  return null;
}

/**
 * Personal data kept on the device outside the secure store. Removed on sign-out
 * and account deletion (prefix entries end with '*').
 */
export const PERSONAL_KEYS = [
  'user', 'contacts', 'userName', 'arrest_info_v1', 'chat_session_id', 'chat_consent_accepted',
  'core_path_progress', 'core_path_pending_route', 'reminder_delivery_prompt_v1',
  'user_subscription', 'last_payment_method', 'completed_lessons', 'pending_save_lawyer',
  'jg_recent_searches', 'jg_last_search', 'home_visit_count', 'last_push_token',
  'upl_disclaimer_acknowledged_v1', 'has_browsed',
  'points_*', 'jg_timeline_*',
];

async function removePersonalData(): Promise<void> {
  const all = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  const exact = PERSONAL_KEYS.filter(k => !k.endsWith('*'));
  const prefixes = PERSONAL_KEYS.filter(k => k.endsWith('*')).map(k => k.slice(0, -1));
  const keys = all.filter(k => exact.includes(k) || prefixes.some(p => k.startsWith(p)));
  if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => undefined);
  await clearAllCaches().catch(() => undefined);
  await clearOfflineData().catch(() => undefined);
  api.clearCache();
  await import('./analytics').then(m => m.reset()).catch(() => undefined);
}

type HomeRoute = ReturnType<typeof homeRouteFor>;
let _pendingHome: HomeRoute = null;
/** The home screen of the account that just signed in (once; null after). */
export function takePendingHome(): HomeRoute {
  const h = _pendingHome;
  _pendingHome = null;
  return h;
}

/** Save a new session and switch the app to signed in. */
export async function startSession(data: SessionPayload): Promise<void> {
  await setToken(data.token);
  if (data.refreshToken) await setItem('refresh_token', data.refreshToken);
  await setItem('user', JSON.stringify(data.user));
  // A language picked on this device wins; otherwise use the account's saved one.
  const chosen = await AsyncStorage.getItem('lang').catch(() => null);
  if (!isLang(chosen) && isLang(data.user?.preferredLanguage)) setLang(data.user.preferredLanguage);
  await AsyncStorage.removeItem('has_browsed').catch(() => undefined);
  api.clearCache();
  // registerForPush() posts the token to /push/token itself (native only, no prompt).
  registerForPush().catch(() => undefined);
  _pendingHome = homeRouteFor(data.user);
  setAppAuth('authed');
}

/** Cases saved offline that never reached the server (they are lost on sign-out). */
export async function unsyncedCaseCount(): Promise<number> {
  return (await getOfflineCases().catch(() => [])).length;
}

/**
 * End the session on this device. The server call is best effort (offline
 * sign-out still clears the device); `serverDone: true` skips it (the account
 * was just deleted).
 */
export async function signOut({ serverDone = false }: { serverDone?: boolean } = {}): Promise<void> {
  if (!serverDone) {
    const [refreshToken, pushToken] = await Promise.all([getItem('refresh_token').catch(() => null), currentPushToken()]);
    await api.post('/auth/logout', { refreshToken: refreshToken || undefined, pushToken: pushToken || undefined }, { timeout: 8000 })
      .catch(() => undefined);
  }
  await clearAuth().catch(() => undefined);
  await removePersonalData();
  // Someone who has used the app before lands on Sign in, not the intro slides.
  setGuestStart('Login');
  setAppAuth('guest');
}
