/**
 * direction.ts — right-to-left layout for Arabic.
 *
 *   isRtlLang(l)      true for languages written right to left ('ar')
 *   isRTL()           is the screen laid out right to left right now?
 *   applyDirection(l, { restart })
 *                     web: sets <html dir="rtl|ltr" lang="…"> at once (react-native-web turns
 *                     start/end styles into CSS logical properties, so the page flips live).
 *                     iOS / Android: React Native reads the direction only at start-up, so
 *                     (Expo's documented approach) I18nManager.allowRTL + forceRTL save the new
 *                     direction and the app restarts with Updates.reloadAsync() (DevSettings.reload
 *                     in development). Only a saved choice restarts the app (`restart: true`):
 *                     a language shown for one visit (the pay page, a text's link) changes the
 *                     words but not the layout, so the next start does not bounce back.
 *                     app.json extra.supportsRTL tells Expo Go / dev clients RTL is allowed.
 *
 * Styles on the core screens use start/end (marginStart, borderStartWidth, start: …) so they
 * follow the direction on every platform; left/right would stay put on the web.
 */
import { DevSettings, I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Last restart for a direction change ('rtl:<ms>'): never restart twice in a row for the same one. */
const RESTART_KEY = 'dir_restart';
const RESTART_GUARD_MS = 2 * 60 * 1000;

export const RTL_LANGS: readonly string[] = ['ar'];
export const isRtlLang = (l: string): boolean => RTL_LANGS.includes(l);

let webRtl = false;

/** Is the layout right to left now (web: the document's direction; native: I18nManager). */
export function isRTL(): boolean {
  if (Platform.OS === 'web') return webRtl;
  return !!I18nManager?.isRTL;
}

let restarting = false;
/** Tests only: a fresh start (in the app a restart reloads this module). */
export function resetDirectionStateForTests(): void { restarting = false; webRtl = false; }

async function restartApp(): Promise<boolean> {
  try {
    const Updates = await import('expo-updates');
    if (typeof Updates.reloadAsync === 'function') { await Updates.reloadAsync(); return true; }
  } catch { /* development build or updates disabled: fall through */ }
  try {
    if (typeof DevSettings?.reload === 'function') { DevSettings.reload(); return true; }
  } catch { /* not available */ }
  return false;
}

/**
 * Lay the app out for `l`. Returns 'same' (nothing to do), 'applied' (web: done), 'restarting'
 * (native: the app restarts now) or 'needs_restart' (native, and the app could not restart
 * itself: the caller asks the person to close and reopen it).
 */
export async function applyDirection(l: string, { restart = true }: { restart?: boolean } = {}):
  Promise<'same' | 'applied' | 'restarting' | 'needs_restart'> {
  const rtl = isRtlLang(l);
  if (Platform.OS === 'web') {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (root) { root.dir = rtl ? 'rtl' : 'ltr'; root.lang = l; }
    const changed = webRtl !== rtl;
    webRtl = rtl;
    return changed ? 'applied' : 'same';
  }
  if (!I18nManager || !!I18nManager.isRTL === rtl) return 'same';
  if (!restart || restarting) return 'same';
  const target = rtl ? 'rtl' : 'ltr';
  // A restart that did not change the direction (a platform that ignores forceRTL) must not
  // turn into a restart loop: one try per direction every couple of minutes.
  const last = await AsyncStorage.getItem(RESTART_KEY).catch(() => null);
  const [lastDir, lastAt] = String(last || '').split(':');
  if (lastDir === target && Date.now() - Number(lastAt) < RESTART_GUARD_MS) return 'needs_restart';
  await AsyncStorage.setItem(RESTART_KEY, `${target}:${Date.now()}`).catch(() => { /* non-fatal */ });
  try {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
    I18nManager.swapLeftAndRightInRTL?.(true);
  } catch { return 'same'; }
  restarting = true;
  if (await restartApp()) return 'restarting';
  restarting = false;
  return 'needs_restart';
}

/**
 * textAlign for text that sits at the end of a row. iOS and Android mirror 'left' / 'right'
 * themselves in a right-to-left layout; the web does not, so there it is flipped here.
 */
export function endAlign(): 'left' | 'right' {
  return Platform.OS === 'web' && webRtl ? 'left' : 'right';
}
