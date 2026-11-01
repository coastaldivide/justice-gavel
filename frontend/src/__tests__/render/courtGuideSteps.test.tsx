/**
 * Render tests for "Going to court: how to dress and act" (CourtGuideScreen) and
 * "Your case, step by step" (CaseStepsScreen):
 *   - the guide: eight sections with their sources (links) and the label; jump chips; buttons to the
 *     rights card / missed-court guidance / court dates; a court date with posted rules shows them,
 *     one without says so
 *   - case steps, guest: progress saved on the phone; stage picked by the person; court dates on the
 *     phone tick their items (and cannot be unticked)
 *   - case steps, signed in: loads the case's progress, saves ticks and the stage, the share switch,
 *     the record stage shows only cited verdicts for the state; a case that isn't theirs → error
 *   - Arabic: both screens with no English left; the new screens use start / end styles only (RTL)
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { Linking } from 'react-native';
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

import CourtGuideScreen from '../../screens/CourtGuideScreen';
import CaseStepsScreen from '../../screens/CaseStepsScreen';
import { setLang, t, type Lang } from '../../i18n';
import { COURT_GUIDE } from '../../constants/courtGuide';
import { GUIDE_SOURCES } from '../../constants/guideSources';
import { GUEST_STEPS_KEY } from '../../services/caseSteps';
import { apiMock, makeNavigation } from './apiMock';
import en from '../../i18n/en.json';
import ar from '../../i18n/ar.json';

const { on, reset, calls } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const route = (params?: Record<string, unknown>) => ({ key: 'r', name: 'X', params } as any);

let openSpy: jest.SpyInstance;
beforeEach(async () => {
  reset();
  mockToken = 'jwt-test';
  await AsyncStorage.clear();
  openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});
afterEach(() => openSpy.mockRestore());
afterAll(() => setLang('en', { persist: false }));

const RULES = [{ id: 'tn-davidson-general-sessions-dress', court: 'General Sessions Court of Metropolitan Nashville & Davidson County', title: 'Dress Code', covers: ['dress'], url: 'https://gscourt.nashville.gov/coming-to-court/dress-code/', checked: '2026-11-01' }];

describe('Going to court: how to dress and act', () => {
  test('eight sections, each with its sources; the label; buttons go to the rights card, missed-court guidance, court dates', async () => {
    mockToken = null;
    const nav = makeNavigation();
    wrap(<CourtGuideScreen navigation={nav} route={route()} />);
    expect(screen.getByText(t('cgd_title'))).toBeTruthy();
    expect(screen.getByText(t('cgd_label'))).toBeTruthy();
    for (const s of COURT_GUIDE) {
      expect(screen.getByTestId(`court-guide-${s.id}`)).toBeTruthy();
      for (const id of s.sources) expect(screen.getByTestId(`court-guide-${s.id}-sources-${id}`)).toBeTruthy();
    }
    expect(screen.getByText(t('cgd_wear_1'))).toBeTruthy();
    expect(screen.getByText(t('cgd_wear_help'))).toBeTruthy();
    expect(screen.getByText(t('cgd_say_4'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('court-guide-wear-sources-tn_dhs'));
    expect(openSpy).toHaveBeenCalledWith(GUIDE_SOURCES.tn_dhs.url);
    fireEvent.press(screen.getByTestId('court-guide-link-rights'));
    expect(nav.navigate).toHaveBeenCalledWith('RightsCard');
    fireEvent.press(screen.getByTestId('court-guide-link-missed'));
    expect(nav.navigate).toHaveBeenCalledWith('CourtDates', { guidance: 'missed' });
    fireEvent.press(screen.getByTestId('court-guide-link-court_dates'));
    expect(nav.navigate).toHaveBeenCalledWith('CourtDates', { add: true });
    expect(screen.getByTestId('court-guide-jump-late')).toBeTruthy();
    // signed out: no court-date request, no posted-rules box
    expect(calls.length).toBe(0);
    expect(screen.queryByTestId('court-rules')).toBeNull();
  });

  test('for a court date at a court with posted rules: the court\'s page, what it covers, the date checked', async () => {
    on('get', '/court-dates/5', { id: 5, court_rules: RULES });
    const nav = makeNavigation();
    wrap(<CourtGuideScreen navigation={nav} route={route({ courtDateId: 5 })} />);
    expect(await screen.findByTestId('court-rules')).toBeTruthy();
    expect(screen.getByText(t('cgd_court_rules_title'))).toBeTruthy();
    expect(screen.getByText(t('cgd_covers', { list: t('cgd_cover_dress') }))).toBeTruthy();
    fireEvent.press(screen.getByText(t('cgd_court_rules_open', { court: `${RULES[0].court} — Dress Code` })));
    expect(openSpy).toHaveBeenCalledWith(RULES[0].url);
    fireEvent.press(screen.getByTestId('court-guide-back-to-date'));
    expect(nav.navigate).toHaveBeenCalledWith('CourtDateDetail', { id: 5 });
  });

  test('a court without posted rules: the general guide only, and it says so', async () => {
    on('get', '/court-dates/6', { id: 6, court_rules: [] });
    wrap(<CourtGuideScreen navigation={makeNavigation()} route={route({ courtDateId: 6 })} />);
    expect(await screen.findByTestId('court-rules-none')).toBeTruthy();
    expect(screen.queryByTestId('court-rules')).toBeNull();
  });
});

describe('Your case, step by step — guest', () => {
  test('nothing picked until the person picks; ticks and the stage are saved on the phone; court dates on the phone tick their items', async () => {
    mockToken = null;
    const soon = new Date(); soon.setDate(soon.getDate() + 10);
    const ymd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    await AsyncStorage.setItem('guest_court_dates_v1', JSON.stringify([{ id: 'g', court_date: ymd, court_time: null, place: null, notification_ids: [], created_at: new Date().toISOString() }]));
    const nav = makeNavigation();
    wrap(<CaseStepsScreen navigation={nav} route={route()} />);
    expect(await screen.findByTestId('steps-guest')).toBeTruthy();
    expect(screen.getByText(t('cst_not_set'))).toBeTruthy();
    expect(screen.getByText(t('cst_label'))).toBeTruthy();
    // the first stage is open: explanation, sources, items, buttons
    expect(screen.getByText(t('cst_arrest_body'))).toBeTruthy();
    expect(screen.getByTestId('steps-arrest-sources-jg_rights')).toBeTruthy();
    fireEvent.press(screen.getByTestId('steps-item-arrest-silent'));
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(GUEST_STEPS_KEY)) || '{}').checked).toEqual({ 'arrest.silent': true }));
    fireEvent.press(screen.getByTestId('steps-action-arrest-rights'));
    expect(nav.navigate).toHaveBeenCalledWith('RightsCard', undefined);
    // open "Before trial": "I know my next court date" is ticked by the phone's court date and cannot be unticked
    fireEvent.press(screen.getByTestId('steps-stage-pretrial-toggle'));
    const auto = screen.getByTestId('steps-item-pretrial-next_date');
    expect(auto.props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(screen.getByTestId('steps-auto-pretrial-next_date')).toBeTruthy();
    fireEvent.press(screen.getByTestId('steps-set-pretrial'));
    expect(await screen.findByTestId('steps-here-pretrial')).toBeTruthy();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(GUEST_STEPS_KEY)) || '{}').stage).toBe('pretrial'));
    // no share switch for a guest
    expect(screen.queryByTestId('steps-share')).toBeNull();
  });
});

describe('Your case, step by step — signed in', () => {
  const STEPS = { case_id: 9, case_title: 'My case', state: 'TN', stage: 'pretrial', checked: { 'pretrial.calls': true }, auto: { 'first.date_saved': true, 'pretrial.next_date': true }, share_stage: false, next_court_date: '2031-04-02' };
  test('loads the case\'s progress, saves a tick, the stage and the share switch on the account', async () => {
    on('get', '/cases', [{ id: 9, title: 'My case', state: 'TN' }, { id: 10, title: 'Old case', state: 'TN' }]);
    on('get', '/custody/status', { enabled: false });
    on('get', '/case-steps/9', STEPS);
    on('put', '/case-steps/9', (_u: string, { data }: any) => Promise.resolve({ data: { ...STEPS, ...(data.stage !== undefined ? { stage: data.stage } : {}), ...(data.share_stage !== undefined ? { share_stage: data.share_stage } : {}), checked: { ...STEPS.checked, ...(data.checked || {}) } } }));
    const nav = makeNavigation();
    wrap(<CaseStepsScreen navigation={nav} route={route({ caseId: 9 })} />);
    expect(await screen.findByTestId('steps-here-pretrial')).toBeTruthy();
    expect(screen.getByTestId('steps-case-picker')).toBeTruthy();
    expect(screen.getByTestId('steps-item-pretrial-calls').props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId('steps-item-pretrial-papers'));
    await waitFor(() => expect(calls.find(c => c.method === 'put')?.data).toEqual({ checked: { 'pretrial.papers': true } }));
    // custody alerts are off: no button for them
    fireEvent.press(screen.getByTestId('steps-stage-release-toggle'));
    expect(screen.queryByTestId('steps-action-release-custody')).toBeNull();
    fireEvent.press(screen.getByTestId('steps-set-release'));
    await waitFor(() => expect(calls.filter(c => c.method === 'put').map(c => c.data)).toContainEqual({ stage: 'release' }));
    fireEvent.press(screen.getByTestId('steps-share-toggle'));
    await waitFor(() => expect(calls.filter(c => c.method === 'put').map(c => c.data)).toContainEqual({ share_stage: true }));
    fireEvent.press(screen.getByTestId('steps-action-release-help'));
    expect(nav.navigate).toHaveBeenCalledWith('HelpNow', undefined);
  });

  test('clearing your record: only cited verdicts for the state; the rest "check with legal aid"', async () => {
    on('get', '/cases', [{ id: 9, title: 'My case', state: 'TN' }]);
    on('get', '/custody/status', { enabled: true });
    on('get', '/case-steps/9', { ...STEPS, stage: 'record' });
    on('get', /\/expungement\/check\?state=TN&status=Dismissed/, { eligibility: { result: 'eligible', waitYears: null, citation: 'Tenn. Code Ann. § 40-32-101(a)(1)(A)' } });
    on('get', /\/expungement\/check\?state=TN&status=Convicted&type=misdemeanor/, { eligibility: { result: 'conditional', waitYears: 5, citation: 'Tenn. Code Ann. § 40-32-101(g)' } });
    on('get', /\/expungement\/check\?state=TN&status=Convicted&type=felony/, { eligibility: { result: 'unsourced', waitYears: null, citation: null } });
    const nav = makeNavigation();
    wrap(<CaseStepsScreen navigation={nav} route={route({ caseId: 9 })} />);
    expect(await screen.findByTestId('steps-record-dismissed')).toBeTruthy();
    expect(screen.getByText(`${t('cst_rec_dismissed')}: ${t('cst_rec_eligible')}`)).toBeTruthy();
    expect(screen.getByText(t('cst_rec_wait', { years: '5' }))).toBeTruthy();
    expect(screen.getByText(`${t('cst_rec_felony')}: ${t('cst_rec_unchecked')}`)).toBeTruthy();
    expect(screen.getByText(t('cst_rec_source', { citation: 'Tenn. Code Ann. § 40-32-101(g)' }))).toBeTruthy();
    fireEvent.press(screen.getByTestId('steps-record-open'));
    expect(nav.navigate).toHaveBeenCalledWith('Expungement', { state: 'TN' });
    // custody alerts are on: the release stage offers them
    fireEvent.press(screen.getByTestId('steps-stage-release-toggle'));
    expect(screen.getByTestId('steps-action-release-custody')).toBeTruthy();
  });

  test('a case that is not theirs (404) shows the error, not someone else\'s progress', async () => {
    on('get', '/cases', [{ id: 9, title: 'My case', state: 'TN' }]);
    on('get', '/custody/status', { enabled: false });
    on('get', '/case-steps/9', () => Promise.reject(Object.assign(new Error('nf'), { response: { status: 404, data: { code: 'not_found' } } })));
    wrap(<CaseStepsScreen navigation={makeNavigation()} route={route({ caseId: 9 })} />);
    expect(await screen.findByTestId('steps-load-error')).toBeTruthy();
    expect(screen.queryByTestId('steps-stage-arrest')).toBeNull();
  });
});

// ── Arabic (right to left) ───────────────────────────────────────────────────
function englishFragments(): string[] {
  const target = Object.values(ar as Record<string, string>).join('\n');
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
function visibleText(): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const p = n.props || {};
    for (const k of ['accessibilityLabel', 'accessibilityHint', 'placeholder']) if (typeof p[k] === 'string') out.push(p[k]);
    (n.children || []).forEach(walk);
  };
  walk(screen.toJSON());
  // publisher and page names are proper names, shown as published (constants/guideSources.ts)
  let text = out.join('\n');
  for (const src of Object.values(GUIDE_SOURCES)) for (const n of [src.org, src.page]) if (n) text = text.split(n).join('');
  return text;
}

describe('Arabic (right to left)', () => {
  beforeEach(() => { act(() => setLang('ar' as Lang, { persist: false })); });
  afterEach(() => { act(() => setLang('en', { persist: false })); });

  test('the guide in Arabic, no English left (publisher names stay as published)', async () => {
    mockToken = null;
    wrap(<CourtGuideScreen navigation={makeNavigation()} route={route()} />);
    expect(screen.getByText(ar.cgd_title)).toBeTruthy();
    expect(screen.getByText(ar.cgd_inside_2)).toBeTruthy();
    const text = visibleText();
    expect(englishFragments().filter(f => text.includes(f))).toEqual([]);
  });

  test('case steps in Arabic, no English left', async () => {
    mockToken = null;
    wrap(<CaseStepsScreen navigation={makeNavigation()} route={route()} />);
    expect(await screen.findByTestId('steps-guest')).toBeTruthy();
    expect(screen.getByText(ar.cst_title)).toBeTruthy();
    expect(screen.getByText(ar.cst_arrest_body)).toBeTruthy();
    const text = visibleText();
    expect(englishFragments().filter(f => text.includes(f))).toEqual([]);
  });

  test('the new screens lay out with start / end only (they mirror in right-to-left)', () => {
    for (const f of ['screens/CourtGuideScreen.tsx', 'screens/CaseStepsScreen.tsx', 'components/GuideSourceList.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      expect([f, src.match(/\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|left:|right:)|textAlign:\s*'(left|right)'/g)]).toEqual([f, null]);
    }
  });
});
