/**
 * corePath.test.tsx — "Just arrested?" core path screens, every state:
 *
 *   JustArrested   step 1 script + source; progress saved and resumed; step 3
 *                  signed out → sign-in prompt, signed in → add court date;
 *                  works with no network (bundled script)
 *   RightsCard     free (no subscription call); sourced sections; state notice;
 *                  offline → this phone's copy with a banner; nothing cached and
 *                  offline → bundled general card with sources
 *   HelpNow        lawyers + bail together, badges, filters re-query, report a
 *                  listing (payload, never edits), offline copy, error, empty
 *   CourtDates     guest prompt; list upcoming/past; form validation; save →
 *                  reminders toast + detail; offline copy; follow with a code
 *   CourtDateDetail courthouse, reminder rows, .ics, missed guidance (last line
 *                  "Call your lawyer or the court clerk."), family invite needs
 *                  consent, stop sharing
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
const mockSetAppAuth = jest.fn();
jest.mock('../../services/auth', () => ({ __esModule: true, setAppAuth: (...a: unknown[]) => mockSetAppAuth(...a), registerAuthSetter: jest.fn(), setGuestStart: jest.fn(), getGuestStart: () => 'Onboarding' }));
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
const mockExportIcs = jest.fn((..._a: unknown[]) => Promise.resolve('download'));
jest.mock('../../utils/icsExport', () => ({ __esModule: true, exportCourtDateIcs: (...a: unknown[]) => mockExportIcs(...a) }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

import JustArrestedScreen from '../../screens/JustArrestedScreen';
import RightsCardScreen from '../../screens/RightsCardScreen';
import HelpNowScreen from '../../screens/HelpNowScreen';
import CourtDatesScreen from '../../screens/CourtDatesScreen';
import CourtDateDetailScreen from '../../screens/CourtDateDetailScreen';
import EmergencyShareScreen from '../../screens/EmergencyShareScreen';
import { apiMock, makeNavigation } from './apiMock';
const { on, reject, reset, calls } = apiMock();

const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const netErr = () => Promise.reject(Object.assign(new Error('Network error. Please check your connection.'), { code: 'ERR_NETWORK' }));

const SECTION = (key: string, heading: string, body: string, source: string) =>
  ({ key, topic: key, heading, body, source, source_url: null, last_reviewed: '2026-04', lawyer_reviewed: false, reviewed_by: null });
const PENDING_TN = "State-specific details for Tennessee haven't been reviewed yet — ask a local lawyer or public defender.";
// A server card carrying one UNREVIEWED state note (generic source, no URL, no reviewer) — what an
// old server / an old saved copy looks like. The app must never show it.
const CARD_TN = {
  state: 'TN', state_name: 'Tennessee', language: 'en', state_specific_available: true, state_notice: null, disclaimer: 'x',
  general: [SECTION('rc_1', '1. RIGHT TO REMAIN SILENT  (5th Amendment)', 'Say clearly…', 'U.S. Constitution, 5th Amendment (as summarized in the Justice Gavel rights card)')],
  state_specific: [SECTION('state_stop_TN', 'IF STOPPED — TENNESSEE', 'Tennessee: You must provide your name if lawfully detained.', 'Published state statutes and case law (Justice Gavel state summary, as recorded April 2026; no specific citation recorded)')],
  script: { say: [], dont: [], source: 'Summarized from the Justice Gavel rights card (sections 1–6) and its Just Arrested guidance', last_reviewed: '2026-04', lawyer_reviewed: false },
};

beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockToken = null;
  await AsyncStorage.clear();
});

// ── JustArrested ─────────────────────────────────────────────────────────────
describe('JustArrestedScreen — the three-step path', () => {
  const mainNav = () => {
    const nav = makeNavigation();
    nav.getParent = jest.fn(() => ({ getState: () => ({ routeNames: ['HomeTab', 'MoreTab'] }) }));
    return nav;
  };

  it('step 1 shows the 30-second script with its source, even with no network', async () => {
    wrap(<JustArrestedScreen navigation={mainNav()} route={{} as any} />);
    expect(await screen.findByTestId('core-step-rights')).toBeTruthy();
    expect(screen.getByText('STEP 1 OF 3')).toBeTruthy();
    expect(screen.getByText('“I am invoking my right to remain silent.”')).toBeTruthy();
    expect(screen.getByText(/Do not talk about your case on jail phone calls/)).toBeTruthy();
    expect(screen.getByTestId('core-script-source').props.children.join('')).toMatch(/Source: Summarized from the Justice Gavel rights card.*Last reviewed: April 2026.*Not yet reviewed by a lawyer/);
  });

  it('a state with no reviewed notes says "haven\'t been reviewed yet"', async () => {
    await AsyncStorage.setItem('jg_user_state', 'TN');
    on('get', '/rights/TN', { ...CARD_TN, state_specific: [], state_notice: PENDING_TN });
    wrap(<JustArrestedScreen navigation={mainNav()} route={{} as any} />);
    expect(await screen.findByTestId('core-state-notice')).toBeTruthy();
    expect(screen.getByText(new RegExp("Tennessee haven't been reviewed yet"))).toBeTruthy();
  });

  it('progress is saved and resumed ("Step 2 of 3"), and step 2 opens the combined results', async () => {
    const nav = mainNav();
    const first = wrap(<JustArrestedScreen navigation={nav} route={{} as any} />);
    fireEvent.press(await screen.findByTestId('core-next-1'));
    expect(await screen.findByTestId('core-step-help')).toBeTruthy();
    await waitFor(async () => expect(JSON.parse(String(await AsyncStorage.getItem('core_path_progress'))).current).toBe(2));
    first.unmount();
    wrap(<JustArrestedScreen navigation={nav} route={{} as any} />);
    expect(await screen.findByText('STEP 2 OF 3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('core-find-help'));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'HelpNow', params: undefined }));
  });

  it('step 3 signed out: a clear sign-in prompt; signed in: add a court date', async () => {
    await AsyncStorage.setItem('core_path_progress', JSON.stringify({ current: 3, done: { rights: true, help: true, court: false } }));
    const nav = mainNav();
    const r = wrap(<JustArrestedScreen navigation={nav} route={{} as any} />);
    expect(await screen.findByTestId('core-court-sign-in')).toBeTruthy();
    expect(screen.getByText(/Sign in to save your court date/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('core-sign-up'));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'Register', params: undefined }));
    r.unmount();
    mockToken = 'jwt';
    wrap(<JustArrestedScreen navigation={nav} route={{} as any} />);
    fireEvent.press(await screen.findByTestId('core-add-court-date'));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'CourtDates', params: { add: true } }));
  });

  it('from the signed-out first screen it enters browse mode and queues the screen', async () => {
    const guestNav = makeNavigation();   // no MoreTab in the parent
    wrap(<JustArrestedScreen navigation={guestNav} route={{} as any} />);
    fireEvent.press(await screen.findByTestId('core-open-rights-card'));
    await waitFor(() => expect(mockSetAppAuth).toHaveBeenCalledWith('browsing'));
    expect(JSON.parse(String(await AsyncStorage.getItem('core_path_pending_route')))).toEqual({ screen: 'RightsCard' });
  });

  it('a queued screen keeps its params (signed out → "Missed a court date?" opens the guidance)', async () => {
    await AsyncStorage.setItem('core_path_progress', JSON.stringify({ current: 3, done: { rights: true, help: true, court: false } }));
    wrap(<JustArrestedScreen navigation={makeNavigation()} route={{} as any} />);
    fireEvent.press(await screen.findByTestId('core-missed'));
    await waitFor(() => expect(mockSetAppAuth).toHaveBeenCalledWith('browsing'));
    const { consumePendingRoute } = jest.requireActual<typeof import('../../services/corePath')>('../../services/corePath');
    expect(await consumePendingRoute()).toEqual({ screen: 'CourtDates', params: { guidance: 'missed' } });
    expect(await AsyncStorage.getItem('core_path_pending_route')).toBeNull();
  });
});

// ── RightsCard ───────────────────────────────────────────────────────────────
describe('RightsCardScreen — free, sourced, offline', () => {
  it('online: unreviewed state notes are never shown (review-pending notice); no subscription check; copy saved', async () => {
    await AsyncStorage.setItem('jg_user_state', 'TN');
    on('get', '/rights/TN', CARD_TN);
    wrap(<RightsCardScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText(new RegExp("Tennessee haven't been reviewed yet"))).toBeTruthy();
    expect(screen.queryByText('Tennessee: You must provide your name if lawfully detained.')).toBeNull();
    expect(screen.queryAllByTestId('rights-state-section')).toHaveLength(0);
    expect(screen.getAllByTestId('rights-section').length).toBe(8);   // full general card (translated bundle)
    expect(screen.getAllByTestId('rights-source').length).toBeGreaterThanOrEqual(8);
    expect(screen.getAllByText(/Last reviewed: April 2026/).length).toBeGreaterThan(0);
    expect(calls.some(c => /billing/.test(c.url))).toBe(false);
    expect(screen.queryByText(/Subscribe/i)).toBeNull();
    // one saved copy per language and state
    await waitFor(async () => expect(await AsyncStorage.getItem('cache_rights_v3_en_TN')).toBeTruthy());
    expect(await AsyncStorage.getItem('cache_rights_v3_en_TN')).not.toContain('You must provide your name');
  });

  it('a cited / reviewed state section IS shown', async () => {
    await AsyncStorage.setItem('jg_user_state', 'TN');
    on('get', '/rights/TN', { ...CARD_TN, state_specific: [{ ...CARD_TN.state_specific[0], body: 'Reviewed TN text.', source: 'Tenn. Code Ann. § 40-7-123', reviewed_by: 'A. Lawyer, Esq.', lawyer_reviewed: true }] });
    wrap(<RightsCardScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText('Reviewed TN text.')).toBeTruthy();
    expect(screen.getAllByTestId('rights-state-section')).toHaveLength(1);
  });

  it('offline: an old saved copy (v1, or a v2 copy with an unreviewed note) never shows the note', async () => {
    await AsyncStorage.setItem('jg_user_state', 'TN');
    await AsyncStorage.setItem('cache_rights_v1_TN', JSON.stringify({ card: CARD_TN, at: '2026-10-01T10:00:00Z' }));
    await AsyncStorage.setItem('cache_rights_v2_TN', JSON.stringify({ card: CARD_TN, at: '2026-10-01T10:00:00Z' }));
    on('get', '/rights/TN', () => netErr());
    wrap(<RightsCardScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('rights-offline')).toBeTruthy();
    expect(screen.queryByText('Tennessee: You must provide your name if lawfully detained.')).toBeNull();
    expect(screen.getByText(new RegExp("Tennessee haven't been reviewed yet"))).toBeTruthy();
    expect(screen.getAllByTestId('rights-section').length).toBe(8);
  });

  it('a state without reviewed notes: general card + "haven\'t been reviewed yet"', async () => {
    on('get', '/rights/PR', { ...CARD_TN, state: 'PR', state_name: 'Puerto Rico', state_specific: [], state_specific_available: false, state_notice: "State-specific details for Puerto Rico haven't been reviewed yet — ask a local lawyer or public defender." });
    wrap(<RightsCardScreen navigation={makeNavigation()} route={{ params: { state: 'PR' } } as any} />);
    expect(await screen.findByText(/Puerto Rico haven't been reviewed yet/)).toBeTruthy();
    expect(screen.getAllByTestId('rights-section').length).toBe(8);
  });

  it('nothing saved and offline: the bundled general card still shows, with its sources', async () => {
    await AsyncStorage.setItem('jg_user_state', 'GA');
    on('get', '/rights/GA', () => netErr());
    wrap(<RightsCardScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText(/Georgia haven't been reviewed yet/)).toBeTruthy();
    expect(screen.getAllByTestId('rights-section').length).toBe(8);
    expect(screen.getAllByText(/U\.S\. Constitution, 4th Amendment/).length).toBe(1);
  });
});

// ── HelpNow ──────────────────────────────────────────────────────────────────
const P = (over: Record<string, unknown>) => ({
  id: 1, kind: 'lawyer', name: 'Ada Counsel', organization: 'Counsel Law', phone: '(615) 254-1010', website: 'https://x.test', address: '1 Main St, Nashville',
  city: 'Nashville', state: 'TN', lat: 36.16, lng: -86.78, distance_km: 1.2, hours: 'x', hours_known: true, is_24_7: false, open_now: true,
  rating: 4.8, review_count: 12, languages: ['English'], free_consultation: true, license_number: null, completeness: 4, ...over,
});
const RESULT = {
  lawyers: [P({})],
  bail_agents: [P({ id: 9, kind: 'bail_agent', name: 'Fast Bail', organization: null, is_24_7: true, free_consultation: null, license_number: 'TN-42' })],
  public_defender: { name: 'Tennessee District Public Defenders', phone: '(615) 741-5562', url: 'https://pd.test', eligibility: 'Low income', about: null, note: 'If you cannot afford a lawyer, ask the court how to request a public defender.' },
  inmate_lookup: [{ id: 5, name: 'Inmate Lookup: Davidson County', phone: null, url: 'https://lookup.test' }],
  meta: { state: 'TN', ranking: 'Sorted by distance and how complete the listing is (real phone, hours, website, address). Never by payment.', hours_note: 'Call to confirm.', charge_note: null },
};

describe('HelpNowScreen — lawyers and bail agents together', () => {
  beforeEach(async () => { await AsyncStorage.setItem('jg_user_state', 'TN'); });

  it('lists both, with open-now / 24/7 badges, public defender and inmate lookup', async () => {
    on('get', '/help/nearby', RESULT);
    wrap(<HelpNowScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('help-lawyer-card')).toBeTruthy();
    expect(screen.getByTestId('help-bail-card')).toBeTruthy();
    expect(screen.getByTestId('help-open-badge')).toBeTruthy();
    expect(screen.getByTestId('help-247-badge')).toBeTruthy();
    expect(screen.getByTestId('help-public-defender')).toBeTruthy();
    expect(screen.getByTestId('help-inmate-lookup')).toBeTruthy();
    // Results first: the ranking explanation is folded under "How results are sorted"
    expect(screen.queryByText(/Never by payment/)).toBeNull();
    fireEvent.press(screen.getByTestId('help-sort-toggle'));
    expect(screen.getByTestId('help-ranking-note').props.children.join('')).toMatch(/Never by payment.*Call to confirm/);
    expect(calls.find(c => c.url === '/help/nearby')).toBeTruthy();
  });

  it('a filter re-runs the search with that filter', async () => {
    on('get', '/help/nearby', RESULT);
    const { api } = apiMock();
    wrap(<HelpNowScreen navigation={makeNavigation()} route={{} as any} />);
    await screen.findByTestId('help-lawyer-card');
    fireEvent.press(screen.getByTestId('help-filter-open'));
    fireEvent.press(screen.getByTestId('help-filter-charge-dui'));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/help/nearby', { params: expect.objectContaining({ state: 'TN', open_now: 1, charge: 'DUI' }) }));
  });

  it('"Report a problem" sends the reason for the listing (the listing is not edited)', async () => {
    on('get', '/help/nearby', RESULT);
    on('post', '/help/reports', { ok: true, report_id: 3, message: 'Thanks — our team will check this listing.' });
    wrap(<HelpNowScreen navigation={makeNavigation()} route={{} as any} />);
    await screen.findByTestId('help-lawyer-card');
    fireEvent.press(screen.getAllByTestId('help-report')[1]);
    expect(await screen.findByTestId('report-modal')).toBeTruthy();
    fireEvent.press(screen.getByTestId('report-reason-wrong_phone'));
    fireEvent.changeText(screen.getByTestId('report-details'), 'disconnected');
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(calls.find(c => c.method === 'post' && c.url === '/help/reports')?.data)
      .toEqual({ provider_type: 'bail_agent', provider_id: 9, reason: 'wrong_phone', details: 'disconnected' }));
    expect(await screen.findByText(/our team will check this listing/)).toBeTruthy();
    expect(calls.some(c => ['put', 'patch', 'delete'].includes(c.method))).toBe(false);
  });

  it('"Claim this listing": signed out → sign in; signed in → request with the license (admin reviews)', async () => {
    on('get', '/help/nearby', RESULT);
    on('post', '/help/claims', { ok: true, claim_id: 4, status: 'pending', message: 'Thanks — we will check your license and link the listing to your account.' });
    const nav = makeNavigation();
    const r = wrap(<HelpNowScreen navigation={nav} route={{} as any} />);
    await screen.findByTestId('help-lawyer-card');
    fireEvent.press(screen.getAllByTestId('help-claim')[0]);
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('Login'));
    r.unmount();
    mockToken = 'jwt';
    wrap(<HelpNowScreen navigation={nav} route={{} as any} />);
    await screen.findByTestId('help-lawyer-card');
    fireEvent.press(screen.getAllByTestId('help-claim')[0]);
    fireEvent.changeText(await screen.findByTestId('claim-license'), 'BPR012345');
    fireEvent.press(screen.getByTestId('claim-submit'));
    await waitFor(() => expect(calls.find(c => c.method === 'post' && c.url === '/help/claims')?.data)
      .toEqual(expect.objectContaining({ provider_type: 'lawyer', provider_id: 1, license_number: 'BPR012345', license_state: 'TN' })));
    expect(await screen.findByText(/we will check your license/)).toBeTruthy();
  });

  it('offline: the last results saved on this phone, labelled', async () => {
    await AsyncStorage.setItem('helpnow_cache_v3_en', JSON.stringify({ result: RESULT, at: '2026-10-01T00:00:00Z' }));
    on('get', '/help/nearby', () => netErr());
    wrap(<HelpNowScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('help-offline')).toBeTruthy();
    expect(screen.getByTestId('help-lawyer-card')).toBeTruthy();
  });

  it('a server error is an error with "Try again"; no results is said plainly', async () => {
    let fail = true;
    on('get', '/help/nearby', () => (fail ? Promise.reject(reject(500, { error: 'Could not search right now. Please try again.' })) : Promise.resolve({ data: { ...RESULT, lawyers: [], bail_agents: [] } })));
    wrap(<HelpNowScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('help-error')).toBeTruthy();
    fail = false;
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('help-empty-lawyers')).toBeTruthy();
    expect(screen.getByTestId('help-empty-bail')).toBeTruthy();
  });

  it('no saved state and no location: asks for a city instead of guessing', async () => {
    await AsyncStorage.removeItem('jg_user_state');
    wrap(<HelpNowScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('help-need-location')).toBeTruthy();
    on('get', '/help/nearby', RESULT);
    fireEvent.changeText(screen.getByTestId('help-city-input'), 'Nashville, TN');
    fireEvent.press(screen.getByTestId('help-city-search'));
    expect(await screen.findByTestId('help-lawyer-card')).toBeTruthy();
  });
});

// ── CourtDates ───────────────────────────────────────────────────────────────
const CD = (over: Record<string, unknown> = {}) => ({
  id: 7, case_id: 3, case_title: 'DUI — Davidson County', case_state: 'TN', court_date: '2026-11-05', court_time: '09:30', court_time_label: '9:30 AM',
  hearing_type: 'arraignment', status: 'scheduled', location: null, is_past: false, archived: false,
  courthouse: { id: 2, name: 'Davidson County Courthouse', address: '1 Public Sq, Nashville', phone: '(615) 862-5000', hours: 'Mon-Fri', lat: 36.1, lng: -86.7, directions_url: 'https://www.google.com/maps/dir/?api=1&destination=36.1,-86.7' },
  ...over,
});

describe('CourtDatesScreen', () => {
  it('signed out: a clear sign-in prompt, and the checklist still shows', async () => {
    const nav = makeNavigation();
    wrap(<CourtDatesScreen navigation={nav} route={{ params: { guidance: 'missed' } } as any} />);
    expect(await screen.findByTestId('court-dates-sign-in')).toBeTruthy();
    expect(screen.getByTestId('court-checklist')).toBeTruthy();
    expect(screen.getByText('4. Call your lawyer or the court clerk.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('court-dates-register'));
    expect(nav.navigate).toHaveBeenCalledWith('Register');
  });

  it('signed in: upcoming and past (archive), followed cases; saved for offline', async () => {
    mockToken = 'jwt';
    on('get', '/court-dates/guidance', () => netErr());
    on('get', '/court-dates', { upcoming: [CD()], past: [CD({ id: 6, court_date: '2026-09-01', is_past: true, archived: true })], time_zone: 'America/Chicago' });
    on('get', '/following', { following: [{ follow_id: 1, case_id: 9, case_title: 'Theft case', state: 'TN', owner_first_name: 'Sam', share_reminders: true, next_court_date: '2026-12-01',
      court_dates: [{ id: 30, court_date: '2026-12-01', court_time: null, court_time_label: null, hearing_type: null, location: null, status: 'scheduled', is_past: false, courthouse: null }] }] });
    wrap(<CourtDatesScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText(/Thursday, November 5, 2026 · 9:30 AM/)).toBeTruthy();
    expect(screen.getByTestId('following-case')).toBeTruthy();
    expect(screen.getByText(/Sam: Theft case/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('court-dates-past-toggle'));
    expect(await screen.findByText(/September 1, 2026/)).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getItem('cache_court_dates_v1')).toBeTruthy());
    expect(String(await AsyncStorage.getItem('cache_court_dates_v1'))).not.toContain('notes');
  });

  it('undeliverable reminders: a one-time "turn on notifications or add an e-mail" prompt', async () => {
    mockToken = 'jwt';
    const rd = { undeliverable: 2, last_undeliverable_at: '2026-10-18T14:00:00.000Z', channels: { push: false, email: false, sms: false },
      needs_attention: true, message: 'We could not send your court reminders. Turn on notifications or add an e-mail so we can remind you.' };
    on('get', '/court-dates/guidance', () => netErr());
    on('get', '/court-dates', { upcoming: [CD()], past: [], time_zone: 'America/Chicago', reminder_delivery: rd });
    on('get', '/following', { following: [] });
    const nav = makeNavigation();
    const first = wrap(<CourtDatesScreen navigation={nav} route={{} as any} />);
    expect(await screen.findByTestId('reminder-delivery-prompt')).toBeTruthy();
    expect(screen.getByText(/Turn on notifications or add an e-mail so we can remind you/)).toBeTruthy();
    expect(screen.getByTestId('reminder-delivery-notifications')).toBeTruthy();
    fireEvent.press(screen.getByTestId('reminder-delivery-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('reminder-delivery-prompt')).toBeNull());
    first.unmount();
    // same problem again → not shown a second time
    wrap(<CourtDatesScreen navigation={nav} route={{} as any} />);
    expect(await screen.findByText(/Thursday, November 5, 2026 · 9:30 AM/)).toBeTruthy();
    await new Promise<void>(r => { setTimeout(r, 50); });
    expect(screen.queryByTestId('reminder-delivery-prompt')).toBeNull();
  });

  it('no prompt when reminders are reaching the person', async () => {
    mockToken = 'jwt';
    on('get', '/court-dates/guidance', () => netErr());
    on('get', '/court-dates', { upcoming: [CD()], past: [], reminder_delivery: { undeliverable: 0, last_undeliverable_at: null, channels: { push: true, email: false, sms: false }, needs_attention: false, message: null } });
    on('get', '/following', { following: [] });
    wrap(<CourtDatesScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText(/Thursday, November 5, 2026 · 9:30 AM/)).toBeTruthy();
    await new Promise<void>(r => { setTimeout(r, 50); });
    expect(screen.queryByTestId('reminder-delivery-prompt')).toBeNull();
  });

  it('offline: the court dates saved on this phone, with a banner', async () => {
    mockToken = 'jwt';
    await AsyncStorage.setItem('cache_court_dates_v1', JSON.stringify({ list: { upcoming: [CD()], past: [] }, at: '2026-10-01T00:00:00Z' }));
    on('get', '/court-dates', () => netErr());
    wrap(<CourtDatesScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('court-dates-offline')).toBeTruthy();
    expect(screen.getByText(/November 5, 2026/)).toBeTruthy();
  });

  it('add: a bad date is explained; a good one is saved with reminders and opens the detail', async () => {
    mockToken = 'jwt';
    on('get', '/court-dates', { upcoming: [], past: [] });
    on('get', '/following', { following: [] });
    on('get', '/cases', []);
    on('post', '/court-dates', { ...CD(), reminders: [0, 1, 3, 7].map(d => ({ id: d, days_before: d, deliver_at: '2026-11-01T14:00:00Z' })) });
    const nav = makeNavigation();
    wrap(<CourtDatesScreen navigation={nav} route={{ params: { add: true } } as any} />);
    const date = await screen.findByTestId('court-form-date');
    fireEvent.changeText(screen.getByTestId('court-form-title'), 'DUI — Davidson County');
    fireEvent.changeText(date, '11/05/2026');
    fireEvent.press(screen.getByTestId('court-form-save'));
    expect(await screen.findByTestId('court-form-error')).toBeTruthy();
    fireEvent.changeText(date, '2026-11-05');
    fireEvent.changeText(screen.getByTestId('court-form-time'), '09:30');
    fireEvent.press(screen.getByTestId('court-form-hearing-arraignment'));
    fireEvent.press(screen.getByTestId('court-form-save'));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('CourtDateDetail', { id: 7 }));
    expect(calls.find(c => c.method === 'post' && c.url === '/court-dates')?.data).toEqual(expect.objectContaining({
      court_date: '2026-11-05', court_time: '09:30', hearing_type: 'arraignment', case_title: 'DUI — Davidson County',
    }));
    expect(await screen.findByText(/7 days, 3 days, 1 day before and the morning of/)).toBeTruthy();
  });

  it('follow a family member with their code', async () => {
    mockToken = 'jwt';
    on('get', '/court-dates', { upcoming: [], past: [] });
    on('get', '/following', { following: [] });
    on('post', '/following/accept', { ok: true });
    wrap(<CourtDatesScreen navigation={makeNavigation()} route={{} as any} />);
    fireEvent.changeText(await screen.findByTestId('follow-code-input'), 'ABCDE-FGHJK');
    fireEvent.press(screen.getByTestId('follow-code-submit'));
    await waitFor(() => expect(calls.find(c => c.url === '/following/accept')?.data).toEqual({ code: 'ABCDE-FGHJK' }));
  });
});

// ── CourtDateDetail ──────────────────────────────────────────────────────────
describe('CourtDateDetailScreen', () => {
  const route = { params: { id: 7 } } as any;
  const detail = { ...CD(), time_zone: 'America/Chicago', reminders: [
    { id: 1, days_before: 7, deliver_at: '2026-10-29T14:00:00Z', title: 'x' }, { id: 2, days_before: 3, deliver_at: '2026-11-02T15:00:00Z', title: 'x' },
    { id: 3, days_before: 1, deliver_at: '2026-11-05T00:00:00Z', title: 'x' }, { id: 4, days_before: 0, deliver_at: '2026-11-05T12:30:00Z', title: 'x' }] };

  beforeEach(() => { mockToken = 'jwt'; });

  it('shows the courthouse, the 4 reminders and exports the .ics', async () => {
    on('get', '/court-dates/7', detail);
    on('get', '/cases/3/followers', []);
    on('get', '/court-dates/preferences', { sms_reminders: false, has_phone: false, sms_available: false });
    wrap(<CourtDateDetailScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByText('Davidson County Courthouse')).toBeTruthy();
    expect(screen.getAllByTestId('court-reminder-row')).toHaveLength(4);
    expect(screen.getByText(/7 days before/)).toBeTruthy();
    expect(screen.getByText(/Morning of/)).toBeTruthy();
    expect(screen.getByTestId('court-date-call-clerk')).toBeTruthy();
    fireEvent.press(screen.getByTestId('court-date-ics'));
    await waitFor(() => expect(mockExportIcs).toHaveBeenCalledWith(7));
  });

  it('"I missed this court date" marks it and shows guidance ending with "call your lawyer or the court clerk"', async () => {
    on('get', '/court-dates/7', detail);
    on('get', '/cases/3/followers', []);
    on('patch', '/court-dates/7', { ...detail, status: 'missed', reminders: [] });
    wrap(<CourtDateDetailScreen navigation={makeNavigation()} route={route} />);
    fireEvent.press(await screen.findByTestId('court-date-missed'));
    expect(await screen.findByTestId('missed-guidance')).toBeTruthy();
    expect(screen.getByText('4. Call your lawyer or the court clerk.')).toBeTruthy();
    await waitFor(() => expect(calls.find(c => c.method === 'patch')?.data).toEqual({ status: 'missed' }));
  });

  it('family invite needs explicit consent; the code is shown; sharing can be stopped', async () => {
    on('get', '/court-dates/7', detail);
    on('get', '/cases/3/followers', [{ id: 11, status: 'active', name: 'Mom', email: null, share_reminders: true }]);
    on('post', '/cases/3/followers', { invite_code: 'ABCDEFGHJK', share_message: 'code ABCDEFGHJK' });
    on('delete', '/cases/3/followers/11', { ok: true });
    wrap(<CourtDateDetailScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('court-date-follower')).toBeTruthy();
    fireEvent.press(screen.getByTestId('court-date-share-family'));
    const create = await screen.findByTestId('family-create-invite');
    fireEvent.press(create);
    expect(calls.some(c => c.method === 'post' && c.url === '/cases/3/followers')).toBe(false);   // no consent yet
    fireEvent.press(screen.getByTestId('family-consent'));
    fireEvent.press(screen.getByTestId('family-create-invite'));
    expect(await screen.findByTestId('family-code-text')).toBeTruthy();
    expect(calls.find(c => c.method === 'post' && c.url === '/cases/3/followers')?.data).toEqual(expect.objectContaining({ consent: true, share_reminders: true }));
    await act(async () => { fireEvent.press(screen.getByText('Done')); });
    fireEvent.press(screen.getByTestId('court-date-stop-sharing'));
    await waitFor(() => expect(calls.some(c => c.method === 'delete' && c.url === '/cases/3/followers/11')).toBe(true));
  });

  it('invite e-mail limit: the 429 message is shown as is', async () => {
    on('get', '/court-dates/7', detail);
    on('get', '/cases/3/followers', []);
    on('post', '/cases/3/followers', () => Promise.reject(reject(429, { error: 'You have sent 10 invite e-mails today, the daily limit. Leave the e-mail empty and share the code yourself (text or call), or try again tomorrow.', code: 'invite_email_daily_limit' })));
    wrap(<CourtDateDetailScreen navigation={makeNavigation()} route={route} />);
    fireEvent.press(await screen.findByTestId('court-date-share-family'));
    fireEvent.press(await screen.findByTestId('family-consent'));
    fireEvent.press(screen.getByTestId('family-create-invite'));
    expect(await screen.findByText(/daily limit\. Leave the e-mail empty and share the code yourself/)).toBeTruthy();
    expect(screen.queryByTestId('family-code-text')).toBeNull();
  });

  it('offline: the saved copy of the date, without network actions', async () => {
    await AsyncStorage.setItem('cache_court_dates_v1', JSON.stringify({ list: { upcoming: [CD()], past: [], time_zone: 'America/Chicago' }, at: '2026-10-01T00:00:00Z' }));
    on('get', '/court-dates/7', () => netErr());
    wrap(<CourtDateDetailScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByTestId('court-date-offline')).toBeTruthy();
    expect(screen.getByText('Davidson County Courthouse')).toBeTruthy();
  });

  it('someone else\'s / unknown id → "could not be found"', async () => {
    on('get', '/court-dates/7', () => Promise.reject(reject(404, { error: 'Court date not found.' })));
    wrap(<CourtDateDetailScreen navigation={makeNavigation()} route={route} />);
    expect(await screen.findByText('This court date could not be found.')).toBeTruthy();
  });
});

// ── Share arrest info with family ────────────────────────────────────────────
describe('EmergencyShareScreen — arrest details for the family', () => {
  it('who / where held / booking number / charges go into the message (kept on this phone)', async () => {
    await AsyncStorage.setItem('contacts', JSON.stringify(['6155550101']));
    on('get', '/providers/bail', [{ name: 'Fast Bail', phone: '(615) 555-0199' }]);
    on('get', '/providers/lawyers', []);
    wrap(<EmergencyShareScreen navigation={makeNavigation()} route={{} as any} />);
    fireEvent.changeText(await screen.findByTestId('arrest-who'), 'Jordan Lee');
    fireEvent.changeText(screen.getByTestId('arrest-where'), 'Davidson County Jail');
    fireEvent.changeText(screen.getByTestId('arrest-booking'), 'B-2026-4411');
    fireEvent.changeText(screen.getByTestId('arrest-charges'), 'DUI');
    await waitFor(async () => expect(JSON.parse(String(await AsyncStorage.getItem('arrest_info_v1'))).booking).toBe('B-2026-4411'));
    fireEvent.press(screen.getByTestId('emergency-share-go'));
    const preview = await screen.findByTestId('emergency-share-preview');
    const text = String(preview.props.children);
    expect(text).toContain('Arrested: Jordan Lee');
    expect(text).toContain('Held at: Davidson County Jail');
    expect(text).toContain('Booking number: B-2026-4411');
    expect(text).toContain('Charges: DUI');
    expect(text).toContain('(615) 555-0199');
  });
});
