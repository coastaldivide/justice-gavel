/**
 * i18nDirection.test.ts — the eight languages in the app, and Arabic's right-to-left layout.
 *
 *   - LANGS / ENDONYMS / device-locale mapping cover ht, zh, ar, tl
 *   - a saved choice of Arabic sets I18nManager.allowRTL + forceRTL and restarts the app once
 *     (iOS / Android read the direction at start-up); leaving Arabic does the reverse
 *   - a language shown for one visit (persist: false — pay page, a text's link) never restarts
 *   - on the web the document's dir / lang change at once, no restart
 *   - a platform that ignores forceRTL does not restart in a loop
 *   - Haitian Creole court dates are written with Haitian day / month names (Intl has none)
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return { __esModule: true, default: {
    getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => { store[k] = v; return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { delete store[k]; return Promise.resolve(); }),
  } };
});
import { DevSettings, I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LANGS, ENDONYMS, langFromLocale, setLang, getLang, isLang, htDay, rtlLang, applyDirection, isRTL, t,
} from '../i18n';
import { endAlign, resetDirectionStateForTests } from '../i18n/direction';
import { formatCourtDay, formatCourtTime } from '../services/corePath';

const flush = () => new Promise(r => setTimeout(r, 0));
const mgr = I18nManager as unknown as { isRTL: boolean; allowRTL: jest.Mock; forceRTL: jest.Mock };
const reload = DevSettings.reload as unknown as jest.Mock;

beforeEach(async () => {
  (Platform as { OS: string }).OS = 'ios';
  mgr.isRTL = false;
  mgr.allowRTL.mockClear(); mgr.forceRTL.mockClear(); reload.mockClear();
  await AsyncStorage.removeItem('dir_restart');
  resetDirectionStateForTests();
});
afterAll(() => { (Platform as { OS: string }).OS = 'ios'; setLang('en', { persist: false }); });

describe('the eight languages', () => {
  it('lists them with their own names', () => {
    expect(LANGS).toEqual(['en', 'es', 'pt', 'vi', 'ht', 'zh', 'ar', 'tl']);
    expect(ENDONYMS).toMatchObject({ ht: 'Kreyòl ayisyen', zh: '中文', ar: 'العربية', tl: 'Tagalog' });
    for (const l of LANGS) expect(isLang(l)).toBe(true);
  });
  it('maps device locales', () => {
    expect(langFromLocale('zh_Hans_CN')).toBe('zh');
    expect(langFromLocale('zh-CN')).toBe('zh');
    expect(langFromLocale('ar_EG')).toBe('ar');
    expect(langFromLocale('fil-PH')).toBe('tl');
    expect(langFromLocale('ht')).toBe('ht');
    expect(langFromLocale('es_MX')).toBe('es');
    expect(langFromLocale('de-DE')).toBeNull();
  });
  it('only Arabic is right to left', () => {
    expect(LANGS.filter(l => rtlLang(l))).toEqual(['ar']);
  });
  it('every language has the new language names', () => {
    for (const l of LANGS) {
      setLang(l, { persist: false });
      for (const c of ['ht', 'zh', 'ar', 'tl']) expect(t(`bdk_lang_${c}`)).not.toBe(`bdk_lang_${c}`);
    }
    setLang('en', { persist: false });
  });
});

describe('Arabic layout on iOS / Android', () => {
  it('a saved choice of Arabic turns on RTL and restarts the app', async () => {
    setLang('ar');
    await flush(); await flush(); await flush();
    expect(getLang()).toBe('ar');
    expect(mgr.allowRTL).toHaveBeenCalledWith(true);
    expect(mgr.forceRTL).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('leaving Arabic (app laid out RTL) turns it off and restarts', async () => {
    mgr.isRTL = true;
    expect(await applyDirection('es')).toBe('restarting');
    expect(mgr.forceRTL).toHaveBeenCalledWith(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('a language shown for one visit never restarts the app', async () => {
    setLang('ar', { persist: false });
    await flush(); await flush();
    expect(mgr.forceRTL).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  it('nothing happens when the direction already matches', async () => {
    mgr.isRTL = true;
    expect(await applyDirection('ar')).toBe('same');
    mgr.isRTL = false;
    expect(await applyDirection('zh')).toBe('same');
    expect(reload).not.toHaveBeenCalled();
  });
  it('a platform that ignored forceRTL is not restarted again right away (no restart loop)', async () => {
    expect(await applyDirection('ar')).toBe('restarting');
    // the "restarted" app still reports LTR: the guard (kept in storage) stops a second restart
    resetDirectionStateForTests();
    expect(await applyDirection('ar')).toBe('needs_restart');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('Arabic layout on the web', () => {
  it('sets <html dir lang> at once, no restart', async () => {
    (Platform as { OS: string }).OS = 'web';
    const root = { dir: '', lang: '' };
    (global as unknown as { document: unknown }).document = { documentElement: root };
    expect(await applyDirection('ar')).toBe('applied');
    expect(root).toEqual({ dir: 'rtl', lang: 'ar' });
    expect(isRTL()).toBe(true);
    expect(endAlign()).toBe('left');
    expect(await applyDirection('tl')).toBe('applied');
    expect(root).toEqual({ dir: 'ltr', lang: 'tl' });
    expect(endAlign()).toBe('right');
    expect(reload).not.toHaveBeenCalled();
    delete (global as unknown as { document?: unknown }).document;
  });
});

describe('dates in the newer languages', () => {
  it('Haitian Creole has its own day and month names', () => {
    expect(htDay(new Date(Date.UTC(2026, 10, 5, 12)))).toBe('jedi 5 novanm 2026');
    setLang('ht', { persist: false });
    expect(formatCourtDay('2026-09-30')).toBe('mèkredi 30 septanm 2026');
    expect(formatCourtTime('14:05')).toBe('14:05');
    setLang('tl', { persist: false });
    expect(formatCourtTime('14:05')).toBe('2:05 PM');
    setLang('en', { persist: false });
  });
});
