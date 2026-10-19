/**
 * i18nCorePath.test.tsx — the core path really is in Spanish, Portuguese and
 * Vietnamese. For each language: switch the app language, render the screen
 * with the server answering in that language (as it does — the server text
 * comes from the same catalogs, checked by the backend i18n test), collect
 * every visible string (text, accessibility labels, hints, placeholders) and
 * fail on any English sentence fragment from en.json.
 *
 *   Just arrested hub (steps 1–3) · Rights card (TN) · Help now results ·
 *   Court dates list (+ family follow, checklist, missed-date guidance) ·
 *   Court date detail (reminder schedule, courthouse, sharing) ·
 *   Home (the tab behind the hub: tiles, banners, countdown, tip, nudge).
 *
 * Data that is not app text (provider / courthouse names, the case title a
 * person typed, phone numbers) is chosen so it contains no en.json phrase.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
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
jest.mock('../../services/auth', () => ({ __esModule: true, setAppAuth: jest.fn(), registerAuthSetter: jest.fn() }));
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
jest.mock('../../utils/icsExport', () => ({ __esModule: true, exportCourtDateIcs: jest.fn(() => Promise.resolve('download')) }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import JustArrestedScreen from '../../screens/JustArrestedScreen';
import RightsCardScreen from '../../screens/RightsCardScreen';
import HelpNowScreen from '../../screens/HelpNowScreen';
import CourtDatesScreen, { bundledGuidance } from '../../screens/CourtDatesScreen';
import CourtDateDetailScreen from '../../screens/CourtDateDetailScreen';
import HomeScreen from '../../screens/HomeScreen';
import { setLang, t, type Lang } from '../../i18n';
import { apiMock, makeNavigation } from './apiMock';
import en from '../../i18n/en.json';
import es from '../../i18n/es.json';
import pt from '../../i18n/pt.json';
import vi from '../../i18n/vi.json';

const { on, reset } = apiMock();
const FILES: Record<string, Record<string, string>> = { es, pt, vi };
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);

/** English sentence fragments (2+ words, 8+ chars) from en.json, minus any that also occur in `lang`'s file (brand names). */
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

/** Every string a person can see or hear on the rendered screen. */
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

const tx = (lang: string, key: string, params?: Record<string, string | number>) => {
  let s = FILES[lang][key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
};

/** The rights card the server sends in `lang` (same catalogs as the app's bundle). */
function serverCard(lang: string) {
  const sec = (i: number) => ({
    key: `rc_${i}`, topic: `t${i}`, heading: tx(lang, `rc_h${i}`), body: tx(lang, `rc_b${i}`),
    source: i <= 3 ? tx(lang, `rc_src_${i}`) : tx(lang, 'rc_src_card'), source_url: null,
    last_reviewed: '2026-04', lawyer_reviewed: false, reviewed_by: null, language: lang,
  });
  return {
    state: 'TN', state_name: 'Tennessee', state_name_local: 'Tennessee', language: lang, mixed_language: false,
    general: [1, 2, 3, 4, 5, 6, 7, 8].map(sec), state_specific: [], state_specific_available: false,
    state_notice: tx(lang, 'rc_state_pending', { state: 'Tennessee' }), disclaimer: tx(lang, 'rc_footer'),
    script: {
      say: [1, 2, 3, 4, 5].map(n => ({ key: `rs_say_${n}`, text: tx(lang, `rs_say_${n}`), from: 'rc_1' })),
      dont: [1, 2, 3, 4, 5].map(n => ({ key: `rs_dont_${n}`, text: tx(lang, `rs_dont_${n}`), from: 'rc_2' })),
      source: tx(lang, 'rc_script_source'), last_reviewed: '2026-04', lawyer_reviewed: false, language: lang,
    },
  };
}

const COURTHOUSE = { id: 3, name: 'Tribunal 3 — Nashville', address: '1 Public Sq, Nashville, TN', phone: '(615) 862-5000', hours: '8–16', lat: 36.16, lng: -86.78, directions_url: 'https://maps.test' };
const HEARING = {
  id: 7, case_id: 2, case_title: 'DUI 2026', case_state: 'TN', court_date: '2026-11-05', court_time: '09:30', court_time_label: 'x',
  hearing_type: 'arraignment', status: 'scheduled', location: '4B', courthouse: COURTHOUSE, is_past: false, archived: false,
};

beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockToken = null;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('jg_user_state', 'TN');
});
afterAll(() => setLang('en', { persist: false }));

describe.each(['es', 'pt', 'vi'] as Lang[])('core path in %s — no English left', (lang) => {
  beforeEach(() => { act(() => setLang(lang, { persist: false })); });

  it('Just arrested hub: all three steps', async () => {
    on('get', '/rights/TN', serverCard(lang));
    const nav = makeNavigation();
    nav.getParent = jest.fn(() => ({ getState: () => ({ routeNames: ['HomeTab', 'MoreTab'] }) }));
    wrap(<JustArrestedScreen navigation={nav} route={{} as any} />);
    expect(await screen.findByTestId('core-step-rights')).toBeTruthy();
    await screen.findByTestId('core-state-notice');
    expect(screen.getByText(`“${tx(lang, 'rs_say_1')}”`)).toBeTruthy();
    expectNoEnglish(lang);
    fireEvent.press(screen.getByTestId('core-next-1'));
    expect(await screen.findByTestId('core-step-help')).toBeTruthy();
    expectNoEnglish(lang);
    fireEvent.press(screen.getByTestId('core-next-2'));
    expect(await screen.findByTestId('core-court-sign-in')).toBeTruthy();
    expectNoEnglish(lang);
  });

  it('Rights card: every section, the script, sources and the state notice', async () => {
    on('get', '/rights/TN', serverCard(lang));
    wrap(<RightsCardScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText(new RegExp(tx(lang, 'rc_state_pending', { state: 'Tennessee' }).slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    expect(screen.getAllByTestId('rights-section')).toHaveLength(8);
    const text = expectNoEnglish(lang);
    for (let i = 1; i <= 8; i++) expect(text).toContain(tx(lang, `rc_b${i}`));
    // the review month is written in the language too
    expect(text).toContain(new Date(Date.UTC(2026, 3, 15)).toLocaleDateString({ es: 'es-US', pt: 'pt-BR', vi: 'vi-VN' }[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  });

  it('Rights card offline with nothing saved: the bundled card is in the language too', async () => {
    wrap(<RightsCardScreen navigation={makeNavigation()} route={{} as any} />);
    expect((await screen.findAllByTestId('rights-section')).length).toBe(8);
    expectNoEnglish(lang);
  });

  it('Help now: labels, badges, filters, public defender', async () => {
    on('get', '/help/nearby', {
      lawyers: [{ id: 1, kind: 'lawyer', name: 'Ada Counsel', organization: null, phone: '(615) 254-1010', website: 'https://x.test', address: '1 Main St', city: 'Nashville', state: 'TN', lat: 1, lng: 1, distance_km: 3.2, hours: 'x', hours_known: true, is_24_7: false, open_now: true, rating: null, review_count: null, languages: [], free_consultation: true, license_number: null, completeness: 4 }],
      bail_agents: [{ id: 9, kind: 'bail_agent', name: 'Fianzas 24', organization: null, phone: '(615) 555-0100', website: null, address: null, city: 'Nashville', state: 'TN', lat: 1, lng: 1, distance_km: 20, hours: null, hours_known: false, is_24_7: true, open_now: null, rating: null, review_count: null, languages: [], free_consultation: null, license_number: 'TN-42', completeness: 2 }],
      public_defender: { name: 'TN PD', phone: '(615) 741-5562', url: 'https://pd.test', eligibility: null, about: null, note: t('hn_pd_title') },
      inmate_lookup: [],
      meta: { state: 'TN', ranking: '', hours_note: '', charge_note: null, language: lang },
    });
    wrap(<HelpNowScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('help-lawyer-card')).toBeTruthy();
    expect(screen.getAllByText(tx(lang, 'hn_open_now')).length).toBeGreaterThan(0);
    expectNoEnglish(lang);
  });

  it('Court dates: list, family follow, checklist and missed-date guidance', async () => {
    mockToken = 'jwt';
    on('get', '/court-dates/guidance', bundledGuidance());
    on('get', '/court-dates', { upcoming: [HEARING], past: [], time_zone: 'America/Chicago', reminder_delivery: { undeliverable: 0, last_undeliverable_at: null, channels: { push: true, email: false, sms: false }, needs_attention: false, message: null } });
    on('get', '/following', { following: [{ follow_id: 1, case_id: 5, case_title: 'Caso 5', state: 'TN', owner_first_name: 'Ana', share_reminders: true, next_court_date: '2026-11-05', court_dates: [{ ...HEARING, id: 8 }] }] });
    wrap(<CourtDatesScreen navigation={makeNavigation()} route={{ params: { guidance: 'missed' } } as any} />);
    expect(await screen.findByTestId('court-date-row')).toBeTruthy();
    expect(screen.getByTestId('missed-guidance')).toBeTruthy();
    const text = expectNoEnglish(lang);
    expect(text).toContain(tx(lang, 'hearing_arraignment'));
    expect(text).toContain(tx(lang, 'cg_missed_4'));
    // the day is written in the language ("jueves" / "quinta-feira" / "Thứ Năm")
    expect(text).toMatch({ es: /jueves/, pt: /quinta-feira/, vi: /Thứ Năm/ }[lang] as RegExp);
  });

  it('Court date detail: reminder schedule, courthouse, sharing, guidance', async () => {
    mockToken = 'jwt';
    on('get', '/court-dates/7', {
      ...HEARING, time_zone: 'America/Chicago', language: lang,
      reminders: [7, 3, 1, 0].map((d, i) => ({ id: i + 1, days_before: d, deliver_at: `2026-11-0${4 - Math.min(d, 3)}T15:00:00Z`, title: 'x' })),
      guidance: bundledGuidance(),
    });
    on('get', '/cases/2/followers', [{ id: 4, status: 'pending', name: null, email: null, share_reminders: true }]);
    on('get', '/court-dates/preferences', { sms_reminders: false, has_phone: false, sms_available: false });
    wrap(<CourtDateDetailScreen navigation={makeNavigation()} route={{ params: { id: 7 } } as any} />);
    expect(await screen.findByTestId('court-date-reminders')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('court-reminder-row')).toHaveLength(4));
    await screen.findByTestId('court-date-follower');
    const text = expectNoEnglish(lang);
    expect(text).toContain(tx(lang, 'cdd_morning_of'));
    expect(text).toContain(tx(lang, 'cg_bring_1'));
    fireEvent.press(screen.getByTestId('court-date-share-family'));
    expect(await screen.findByTestId('family-share-modal')).toBeTruthy();
    expectNoEnglish(lang);
  });

  it('Home: tiles, banners, court countdown, legal tip, guest nudge', async () => {
    mockToken = 'jwt';
    on('get', '/court-dates', { upcoming: [{ id: 7, case_id: 2, case_title: 'Caso 2', court_date: '2026-11-07', court_time: null }], past: [], today: '2026-11-05', time_zone: 'America/Chicago' });
    on('get', '/push/tip', { tip: tx(lang, 'rs_say_1'), category: 'Criminal', lesson_query: 'rights', language: lang });
    wrap(<HomeScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText(tx(lang, 'rs_say_1'))).toBeTruthy();
    expect(await screen.findByText('Caso 2')).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(tx(lang, 'home_court_a11y', { n: 'NN' }).split('NN')[0]))).toBeTruthy();
    const text = expectNoEnglish(lang);
    for (const k of ['home_tile_Bail', 'home_tile_Rights', 'home_qc_sub', 'home_emergency_title', 'ja_create', 'home_quick_access']) expect(text).toContain(tx(lang, k));
  });
});

describe('the English detector is real', () => {
  it('finds English fragments when the screens are shown in English', async () => {
    act(() => setLang('en', { persist: false }));
    mockToken = 'jwt';
    on('get', '/court-dates/guidance', bundledGuidance());
    on('get', '/court-dates', { upcoming: [HEARING], past: [], time_zone: 'America/Chicago' });
    on('get', '/following', { following: [] });
    wrap(<CourtDatesScreen navigation={makeNavigation()} route={{ params: { guidance: 'missed' } } as any} />);
    expect(await screen.findByTestId('court-date-row')).toBeTruthy();
    const text = visibleStrings().join('\n');
    const leaks = englishFragments('es').filter(f => text.includes(f));
    expect(leaks.length).toBeGreaterThan(20);
  });
});

describe('switching language re-renders a mounted screen', () => {
  it('Just arrested: English → Español without leaving the screen', async () => {
    act(() => setLang('en', { persist: false }));
    wrap(<JustArrestedScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText('STEP 1 OF 3')).toBeTruthy();
    act(() => setLang('es', { persist: false }));
    expect(await screen.findByText(tx('es', 'ja_step_of', { n: 1 }))).toBeTruthy();
    expectNoEnglish('es');
  });
});
