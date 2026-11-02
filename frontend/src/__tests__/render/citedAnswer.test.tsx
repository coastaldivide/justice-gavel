/**
 * Render tests for verified citations (components/CitedAnswer.tsx, services/sourced.ts) in the
 * chat bubble and in legal research:
 *   - cited parts carry their numbers; tapping [n] opens the exact passage, the source page and
 *     the app screen it comes from; a part with no source shows the "not shown" marker only
 *   - an answer with no source for its legal parts (or nothing found) points to the rights card
 *     and legal help
 *   - the reader drops citation numbers that name no listed source and non-http links
 *   - ChatScreen: a job answer and a saved history answer render the same citations
 *   - LegalResearchScreen: a saved session renders its citations
 *   - Arabic: labels translated, no English left; start / end styles only (right to left)
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { Linking } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
let mockToken: string | null = 'jwt';
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

import CitedAnswer from '../../components/CitedAnswer';
import ChatScreen from '../../screens/ChatScreen';
import LegalResearchScreen from '../../screens/LegalResearchScreen';
import { CONSENT_VERSION } from '../../components/LegalDisclaimerModal';
import { readSourced, appendSegment, type SourcedAnswer } from '../../services/sourced';
import { setLang, type Lang } from '../../i18n';
import { apiMock, makeNavigation } from './apiMock';
import en from '../../i18n/en.json';
import ar from '../../i18n/ar.json';

const { on, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);

const SOURCED: SourcedAnswer = {
  grounded: true,
  segments: [
    { text: 'I am sorry this happened. ', cites: [] },
    { text: 'You can say you do not consent to a search.', cites: [1] },
    { withheld: true },
    { text: ' Ask the court for a lawyer at your first hearing.', cites: [2] },
  ],
  sources: [
    { n: 1, id: 'rights.rc_3.en', kind: 'rights_card', title: 'Rights card: RIGHT AGAINST UNLAWFUL SEARCH', jurisdiction: 'US', year: 2026,
      url: null, publisher: 'U.S. Constitution, 4th Amendment (as summarized in the Justice Gavel rights card)', checked: '2026-04',
      app_link: 'RightsCard', also: [], passage: 'You can say: "I do not consent to a search."' },
    { n: 2, id: 'steps.first.en', kind: 'case_steps', title: 'Your case, step by step: The first court date', jurisdiction: 'US', year: 2026,
      url: 'https://www.azcourts.gov/legalinfohub/Legal-Info-Sheets/Criminal/Steps-in-a-Criminal-Case', publisher: 'Arizona Judicial Branch — Steps in a Criminal Case',
      checked: '2026-11-01', app_link: 'CaseSteps', also: [], passage: 'At the first court date the judge tells you the charges.' },
  ],
  withheld: 1, dropped: 0,
};

let openSpy: jest.SpyInstance;
beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockToken = 'jwt';
  await AsyncStorage.clear();
  openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});
afterEach(() => openSpy.mockRestore());
afterAll(() => setLang('en', { persist: false }));

describe('CitedAnswer', () => {
  test('cited parts carry numbers; the uncited legal part is replaced by the marker', () => {
    wrap(<CitedAnswer answer={SOURCED} onOpenApp={jest.fn()} />);
    expect(screen.getByTestId('cited-answer-cite-1')).toBeTruthy();
    expect(screen.getByTestId('cited-answer-cite-2')).toBeTruthy();
    expect(screen.getByTestId('cited-answer-withheld')).toBeTruthy();
    expect(screen.getByText(new RegExp(en.cite_withheld))).toBeTruthy();
    expect(screen.getByText(en.cite_sources)).toBeTruthy();
    expect(screen.getByText('Rights card: RIGHT AGAINST UNLAWFUL SEARCH')).toBeTruthy();
    expect(screen.getByText(/Rights card · U\.S\. · 2026 · checked April 2026/)).toBeTruthy();
    expect(screen.getByText(/checked November 1, 2026/)).toBeTruthy();
    expect(screen.queryByTestId('cited-answer-passage-1')).toBeNull();
    expect(screen.getByText(en.cite_label)).toBeTruthy();
  });

  test('tapping a number opens the exact passage, the source page and the app screen', () => {
    const onOpenApp = jest.fn();
    wrap(<CitedAnswer answer={SOURCED} onOpenApp={onOpenApp} />);
    fireEvent.press(screen.getByTestId('cited-answer-cite-2'));
    expect(screen.getByTestId('cited-answer-passage-2')).toBeTruthy();
    expect(screen.getByText('“At the first court date the judge tells you the charges.”')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cited-answer-open-url-2'));
    expect(openSpy).toHaveBeenCalledWith('https://www.azcourts.gov/legalinfohub/Legal-Info-Sheets/Criminal/Steps-in-a-Criminal-Case');
    fireEvent.press(screen.getByTestId('cited-answer-open-app-2'));
    expect(onOpenApp).toHaveBeenCalledWith('CaseSteps');
    // the rights card has no web page: only the in-app link
    fireEvent.press(screen.getByTestId('cited-answer-cite-1'));
    expect(screen.queryByTestId('cited-answer-open-url-1')).toBeNull();
    fireEvent.press(screen.getByTestId('cited-answer-open-app-1'));
    expect(onOpenApp).toHaveBeenCalledWith('RightsCard');
  });

  test('no source for the legal parts → the rights card and legal help', () => {
    const onOpenApp = jest.fn();
    wrap(<CitedAnswer answer={{ grounded: true, no_source: true, segments: [{ text: 'I am sorry. ', cites: [] }, { withheld: true }], sources: [] }} onOpenApp={onOpenApp} />);
    expect(screen.getByText(en.cite_no_source_title)).toBeTruthy();
    expect(screen.queryByText(en.cite_sources)).toBeNull();
    fireEvent.press(screen.getByTestId('cited-answer-open-rights'));
    fireEvent.press(screen.getByTestId('cited-answer-open-help'));
    expect(onOpenApp.mock.calls).toEqual([['RightsCard'], ['HelpNow']]);
  });

  test('the reader keeps only well-formed parts: unknown numbers, bad links and app screens dropped', () => {
    const r = readSourced({
      grounded: true,
      segments: [{ text: 'A', cites: [1, 7] }, { nope: 1 }, { withheld: true }],
      sources: [{ n: 1, title: 'T', url: 'javascript:alert(1)', app_link: 'Settings', passage: 'p' }],
    })!;
    expect(r.segments).toEqual([{ text: 'A', cites: [1] }, { withheld: true }]);
    expect(r.sources[0]).toMatchObject({ url: null, app_link: null });
    expect(readSourced('text')).toBeNull();
    // streamed parts: sources arrive with the first part that cites them; markers collapse
    let a = appendSegment(null, { text: 'X', cites: [1] }, [{ n: 1, title: 'T', passage: 'p' }]);
    a = appendSegment(a, { withheld: true }, []);
    a = appendSegment(a, { withheld: true }, []);
    expect(a.segments).toEqual([{ text: 'X', cites: [1] }, { withheld: true }]);
    expect(a.sources.map(s => s.n)).toEqual([1]);
  });
});

describe('ChatScreen with citations', () => {
  const sendViaInput = async (text: string) => {
    const input = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.changeText(input, text);
    fireEvent(input, 'submitEditing');
  };

  test('a job answer renders its citations in the bubble; a source opens the app screen', async () => {
    on('get', '/chat/history/', []);
    on('post', '/chat/ask', { jobId: 'job-c', status: 'pending', async: true });
    mockPollJob.mockResolvedValue({ status: 'done', result: { reply: 'plain [1]', sourced: SOURCED, intent: 'know_rights' } });
    const nav = makeNavigation();
    wrap(<ChatScreen navigation={nav} route={{ params: {} }} />);
    await screen.findByText('Know your rights');
    await sendViaInput('Can police search my car?');
    expect(await screen.findByTestId('chat-cited')).toBeTruthy();
    expect(screen.getByTestId('chat-cited-withheld')).toBeTruthy();
    fireEvent.press(screen.getByTestId('chat-cited-cite-1'));
    fireEvent.press(screen.getByTestId('chat-cited-open-app-1'));
    expect(nav.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'RightsCard' });
  });

  test('saved history renders the same citations later', async () => {
    await AsyncStorage.setItem('chat_session_id', 'sess-c');
    on('get', '/chat/history/sess-c', [
      { role: 'user', content: 'Can police search my car?', sourced: null },
      { role: 'assistant', content: 'You can say you do not consent to a search.', sourced: SOURCED },
    ]);
    wrap(<ChatScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('chat-cited')).toBeTruthy();
    expect(screen.getByText('Rights card: RIGHT AGAINST UNLAWFUL SEARCH')).toBeTruthy();
    expect(screen.getByTestId('chat-cited-cite-2')).toBeTruthy();
  });
});

describe('LegalResearchScreen with citations', () => {
  test('a saved session (History → session) renders its citations', async () => {
    on('get', '/research/status', { has_access: true, plans: [] });
    on('get', '/research/history', [{ id: 5, title: 'Search of a car', updated_at: '2026-11-02T10:00:00Z' }]);
    on('get', '/research/session/5', { id: 5, messages: [
      { role: 'user', content: 'Search of a car' },
      { role: 'assistant', content: 'You can say you do not consent [1]', sourced: SOURCED },
    ] });
    await AsyncStorage.setItem(`jg_consent_v${CONSENT_VERSION}`, 'true');     // the research disclaimer was accepted
    const nav = makeNavigation();
    const main = wrap(<LegalResearchScreen navigation={nav} route={{ params: {} } as any} />);
    // the header's History button (set through navigation.setOptions once access is known)
    let header: React.ReactElement | null = null;
    await waitFor(() => {
      const opts = nav.setOptions.mock.calls.map((c: any[]) => c[0]).reverse().find((o: any) => o.headerRight && o.headerRight());
      header = opts ? opts.headerRight() : null;
      expect(header).toBeTruthy();
    });
    const head = render(<ThemeProvider>{header as unknown as React.ReactElement}</ThemeProvider>);
    await act(async () => { fireEvent.press(head.getByLabelText(en.x_discovery_history)); });
    head.unmount();
    await main.findByText('Search of a car');
    const row = main.UNSAFE_getAllByProps({ accessibilityLabel: 'Search of a car' }).find((n: any) => typeof n.props.onPress === 'function');
    await act(async () => { row!.props.onPress(); });
    expect(await main.findByTestId('research-cited')).toBeTruthy();
    expect(main.getByTestId('research-cited-cite-1')).toBeTruthy();
    expect(main.getByTestId('research-cited-withheld')).toBeTruthy();
  });
});

describe('Arabic (right to left)', () => {
  beforeEach(() => { act(() => setLang('ar' as Lang, { persist: false })); });
  afterEach(() => { act(() => setLang('en', { persist: false })); });

  test('labels in Arabic, no English labels left', () => {
    const answer: SourcedAnswer = { ...SOURCED, no_source: true,
      segments: [{ text: 'لديك الحق في رفض التفتيش.', cites: [1] }, { withheld: true }] };
    wrap(<CitedAnswer answer={answer} onOpenApp={jest.fn()} />);
    expect(screen.getByText(ar.cite_sources)).toBeTruthy();
    expect(screen.getByText(new RegExp(ar.cite_withheld))).toBeTruthy();
    expect(screen.getByText(ar.cite_no_source_title)).toBeTruthy();
    expect(screen.getByText(ar.cite_btn_rights)).toBeTruthy();
    expect(screen.getByText(ar.cite_label)).toBeTruthy();
    fireEvent.press(screen.getByTestId('cited-answer-cite-1'));
    expect(screen.getByText(ar.cite_passage)).toBeTruthy();
    expect(screen.getByText(ar.cite_open_in_app)).toBeTruthy();
    for (const k of ['cite_sources', 'cite_withheld', 'cite_no_source_title', 'cite_btn_rights', 'cite_btn_help', 'cite_label', 'cite_passage', 'cite_open_in_app', 'cite_kind_rights_card'] as const) {
      expect(screen.queryByText(en[k])).toBeNull();
    }
  });

  test('CitedAnswer lays out with start / end only (it mirrors in right-to-left)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../components/CitedAnswer.tsx'), 'utf8');
    expect(src.match(/\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|left:|right:)|textAlign:\s*'(left|right)'/g)).toBeNull();
  });
});
