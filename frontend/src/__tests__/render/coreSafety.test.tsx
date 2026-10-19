/**
 * coreSafety.test.tsx — section A (core path & safety) regressions:
 *
 *   sos            the SOS reports what the server really delivered; nothing
 *                  sent → the messages app for every phone contact; no server →
 *                  the same alert text built on the phone
 *   offlineSync    a case saved offline is retried after a network / 5xx error
 *                  (it was marked failed forever), never posted twice by two
 *                  listeners, and a crash mid-sync is resumed
 *   caseNotes      a voice note is APPENDED to the notes on the server (a screen
 *                  opened without the notes used to overwrite them)
 *   VoiceNote web  typed note → structured → "Save to case" appends
 *   Crisis lines   Veterans dials 988 (not "9881"); Crisis Text Line texts HOME
 *   ArrestMonitor  a Legal Pro subscriber gets the monitor (the screen read a
 *                  field the API never sends); the price is the server's; "no
 *                  state" is sent as no state (the old "ALL" was a 400)
 *   QuickConnect   $20.00 from the server's quote; pay → payment sheet →
 *                  confirm → contacts
 *   Home           "Cases" opens the case list; the attorney tile only for attorneys
 *   ErrorBoundary  a screen that could not be downloaded says "needs a
 *                  connection", never the raw module URL
 *   OfflineBanner  one translated, tappable banner
 */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
let mockUser: string | null = null;
let mockToken: string | null = null;
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(mockToken)),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn((k: string) => Promise.resolve(k === 'user' ? mockUser : null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/location', () => ({
  __esModule: true,
  getLocation: jest.fn(() => Promise.reject(new Error('denied'))),
  getLocationWithCity: jest.fn(() => Promise.reject(new Error('denied'))),
  detectAndSaveUserState: jest.fn(() => Promise.resolve(null)),
  formatDistance: () => '',
}));
const mockSheet = { available: true, initPaymentSheet: jest.fn(() => Promise.resolve({})), presentPaymentSheet: jest.fn(() => Promise.resolve({})) };
jest.mock('../../payments', () => ({
  __esModule: true,
  usePaymentSheet: () => mockSheet,
  PAYMENTS_COMING_SOON: () => 'Payments aren’t available yet.',
}));
jest.mock('../../components/AuthGate', () => ({
  __esModule: true,
  useAuthGate: () => ({ requireAuth: (fn: () => void) => fn(), AuthGateModal: () => null }),
}));

import { sendSos, reportSosResult, openSmsComposer } from '../../services/sos';
import { appendCaseNote } from '../../services/caseNotes';
import * as webSync from '../../services/offlineSync.web';
import VoiceNoteWeb from '../../screens/VoiceNoteScreen.web';
import CrisisResourcesScreen from '../../screens/CrisisResourcesScreen';
import ArrestMonitorScreen from '../../screens/ArrestMonitorScreen';
import QuickConnectScreen from '../../screens/QuickConnectScreen';
import HomeScreen from '../../screens/HomeScreen';
import ErrorBoundary from '../../components/ErrorBoundary';
import OfflineBanner from '../../components/OfflineBanner';
import { setLang, t } from '../../i18n';
import { apiMock, makeNavigation } from './apiMock';
const { on, reject, reset, calls, api } = apiMock();

const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const netErr = () => Promise.reject(Object.assign(new Error('Network error'), { code: 'ERR_NETWORK' }));
let openURL: jest.SpyInstance;

beforeEach(async () => {
  reset();
  await AsyncStorage.clear();
  mockUser = null; mockToken = null;
  act(() => setLang('en', { persist: false }));
  openURL = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));
  openURL.mockClear();   // jest-expo's Linking.openURL is already a mock: restoring keeps its calls
  // useConfirm on native → Alert.alert: press the confirming (non-cancel) button
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const ok = (buttons || []).find(b => b.style !== 'cancel');
    ok?.onPress?.();
  });
  mockSheet.initPaymentSheet.mockClear(); mockSheet.presentPaymentSheet.mockClear();
});
afterEach(() => jest.restoreAllMocks());

// ── SOS ──────────────────────────────────────────────────────────────────────
describe('SOS — the result is what the server really delivered', () => {
  it('nothing delivered → says so and opens the messages app for every phone number with the alert', async () => {
    on('post', '/alerts', { ok: false, sent: 0, total: 3, message: '🚨 EMERGENCY: Ana needs immediate help.', results: [
      { contact: '6155550101', method: 'sms', delivered: false, reason: 'sms_not_configured' },
      { contact: 'mom@x.test', method: 'email', delivered: false, reason: 'email_not_configured' },
      { contact: '(615) 555-0103', method: 'sms', delivered: false, reason: 'sms_not_configured' },
    ] });
    const r = await sendSos(['6155550101', 'mom@x.test', '(615) 555-0103']);
    expect(calls.find(c => c.url === '/alerts')?.data).toEqual({ userName: '', contacts: ['6155550101', 'mom@x.test', '(615) 555-0103'] });   // no location: still sent
    const confirm = jest.fn(() => Promise.resolve(true));
    const toast = jest.fn();
    const line = await reportSosResult(r, confirm, toast);
    expect(line).toBe(t('sos_sent_none', { n: 3 }));
    expect(confirm).toHaveBeenCalledWith(t('sos_text_them_title'), expect.stringContaining(line), { confirmLabel: t('sos_open_messages') });
    expect(openURL).toHaveBeenCalledWith(`sms:/open?addresses=6155550101,6155550103&body=${encodeURIComponent('🚨 EMERGENCY: Ana needs immediate help.')}`);
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/sent to/), 'success');
  });

  it('everyone reached → a success toast, no messages app', async () => {
    on('post', '/alerts', { ok: true, sent: 2, total: 2, message: 'x', results: [
      { contact: '6155550101', method: 'sms', delivered: true }, { contact: 'a@b.test', method: 'email', delivered: true }] });
    const toast = jest.fn();
    await reportSosResult(await sendSos(['6155550101', 'a@b.test']), jest.fn(), toast);
    expect(toast).toHaveBeenCalledWith(t('sos_sent_all', { n: 2 }), 'success');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('server unreachable → the alert text is built on the phone (typed name) and handed to the messages app', async () => {
    on('post', '/alerts', netErr);
    await AsyncStorage.setItem('userName', 'Jordan');
    const r = await sendSos(['6155550101']);
    expect(r).toMatchObject({ sent: 0, offline: true, notSent: ['6155550101'], message: t('sos_message_no_location', { name: 'Jordan' }) });
    expect(await openSmsComposer(['mom@x.test'], 'hi')).toBe(false);   // no number to text
  });
});

// ── offline sync (web implementation: same contract as native) ─────────────
describe('offline case queue', () => {
  it('a network or server error keeps the case queued; the next run sends it once', async () => {
    const id = await webSync.saveCaseOffline({ title: 'Offline case' });
    on('post', '/cases', netErr);
    expect(await webSync.processSyncQueue()).toEqual({ synced: 0, failed: 1 });
    on('post', '/cases', () => Promise.reject(reject(503, { error: 'db down' })));
    expect(await webSync.processSyncQueue()).toEqual({ synced: 0, failed: 1 });
    expect(await webSync.getOfflineCases()).toHaveLength(1);
    let posts = 0;
    on('post', '/cases', () => { posts++; return Promise.resolve({ data: { id: 77 } }); });
    const synced: string[] = [];
    // two listeners firing together (App.tsx + CaseScreen) → one POST
    const [a, b] = await Promise.all([webSync.processSyncQueue(t1 => synced.push(t1)), webSync.processSyncQueue()]);
    expect(a).toEqual({ synced: 1, failed: 0 });
    expect(b).toBe(a);
    expect(posts).toBe(1);
    expect(synced).toEqual([id]);
    expect(await webSync.getOfflineCases()).toHaveLength(0);
  });

  it('a request the server rejects (400) stops retrying but the case stays on the phone', async () => {
    await webSync.saveCaseOffline({ title: '' });
    on('post', '/cases', () => Promise.reject(reject(400, { error: 'title required' })));
    await webSync.processSyncQueue();
    let posts = 0;
    on('post', '/cases', () => { posts++; return Promise.resolve({ data: { id: 1 } }); });
    await webSync.processSyncQueue();
    expect(posts).toBe(0);
    expect(await webSync.getOfflineCases()).toHaveLength(1);
  });

  it('an item left "syncing" by a killed app is sent on the next run', async () => {
    await AsyncStorage.setItem('jg_sync_queue', JSON.stringify([{ temp_id: 't1', endpoint: '/cases', method: 'POST', body: '{"title":"x"}', status: 'syncing' }]));
    on('post', '/cases', { id: 5 });
    expect(await webSync.processSyncQueue()).toEqual({ synced: 1, failed: 0 });
  });
});

// ── voice note → case notes ──────────────────────────────────────────────────
describe('voice note is appended to the case notes', () => {
  it('appendCaseNote re-reads the notes and appends; unknown case → error', async () => {
    on('get', '/cases', [{ id: 9, title: 'Mine', notes: 'Old note' }]);
    on('put', '/cases/9', { id: 9 });
    expect(await appendCaseNote(9, '  New note ')).toBe('Old note\n\nNew note');
    expect(calls.find(c => c.method === 'put')?.data).toEqual({ notes: 'Old note\n\nNew note' });
    await expect(appendCaseNote(10, 'x')).rejects.toThrow('Case not found');
  });

  it('web voice note: transcription unavailable → typed → structured → saved to the case (appended)', async () => {
    on('post', '/transcribe/text', { note: { date: '2026-10-19', summary: 'Call the lawyer.', next_steps: ['Call the lawyer.'], flags: [], raw: 'Call the lawyer.' } });
    on('get', '/cases', [{ id: 3, title: 'Case', notes: 'KEEP ME' }]);
    on('put', '/cases/3', { id: 3 });
    const navigation = makeNavigation();
    wrap(<VoiceNoteWeb navigation={navigation} route={{ params: { caseId: 3, caseTitle: 'Case' } } as any} />);
    fireEvent.press(screen.getByTestId('voice-note-type-instead'));
    fireEvent.changeText(screen.getByTestId('voice-note-text'), 'Call the lawyer.');
    fireEvent.press(screen.getByTestId('voice-note-structure'));
    await screen.findByTestId('voice-note-result');
    fireEvent.press(screen.getByTestId('voice-note-save'));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(String((calls.find(c => c.method === 'put')?.data as { notes: string }).notes)).toMatch(/^KEEP ME\n\n📝 2026-10-19\n\nCall the lawyer\./);
    expect(await screen.findByText(t('vn_saved_to_case'))).toBeTruthy();
  });
});

// ── crisis lines ─────────────────────────────────────────────────────────────
describe('Crisis lines dial / text the right number', () => {
  it('Veterans → tel:988; Crisis Text Line → sms 741741 HOME; a guest makes no signed-in-only request', async () => {
    wrap(<CrisisResourcesScreen navigation={makeNavigation()} route={{} as any} />);
    await waitFor(() => expect(screen.getByTestId('crisis-line-veterans')).toBeTruthy());
    expect(calls.some(c => c.url.startsWith('/resources'))).toBe(false);
    fireEvent.press(screen.getByTestId('crisis-line-veterans'));
    fireEvent.press(screen.getByTestId('crisis-line-text'));
    expect(openURL).toHaveBeenNthCalledWith(1, 'tel:988');
    expect(openURL).toHaveBeenNthCalledWith(2, 'sms:741741&body=HOME');   // iOS form in tests
    expect(screen.getByText(t('crisis_988_press_1'))).toBeTruthy();
  });
});

// ── arrest monitor ───────────────────────────────────────────────────────────
describe('Arrest monitor', () => {
  it('signed out: the plan with the public Legal Pro price, no signed-in-only request', async () => {
    on('get', '/billing/tiers', { tiers: [{ key: 'legal_pro', monthly_cents: 3499 }] });
    wrap(<ArrestMonitorScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByText(t('am_upgrade_price', { price: t('am_per_month', { price: '$34.99' }) }))).toBeTruthy();
    expect(calls.map(c => c.url)).toEqual(['/billing/tiers?audience=consumer']);
  });

  it('a Legal Pro subscriber gets the monitor; a new name without a state is sent with no state', async () => {
    mockToken = 'jwt';
    on('get', '/billing/subscription', { subscription: { tier: 'legal_pro', status: 'active' }, tiers: [{ key: 'legal_pro', monthly_cents: 3499 }] });
    on('get', '/arrests/monitors', { monitors: [], count: 0 });
    on('post', '/arrests/monitors', { created: true, id: 1 });
    wrap(<ArrestMonitorScreen navigation={makeNavigation()} route={{} as any} />);
    await screen.findByTestId('arrest-monitor-list');
    fireEvent.press(screen.getByLabelText(t('x_arrest_monitor_add_name_monitor')));
    fireEvent.changeText(screen.getByPlaceholderText(t('x_arrest_monitor_full_name_e_g')), 'Jordan Sample');
    fireEvent.press(screen.getByText(t('x_arrest_monitor_start_monitoring')));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(calls.find(c => c.method === 'post')?.data).toEqual({ watch_name: 'Jordan Sample', county: 'All' });
  });

  it('no paid plan → the upgrade button shows the server\'s Legal Pro price in the language', async () => {
    mockToken = 'jwt';
    act(() => setLang('es', { persist: false }));
    on('get', '/billing/subscription', { subscription: null, tiers: [{ key: 'legal_pro', monthly_cents: 3499 }] });
    on('get', '/arrests/monitors', { monitors: [], count: 0 });
    wrap(<ArrestMonitorScreen navigation={makeNavigation()} route={{} as any} />);
    const btn = await screen.findByTestId('arrest-monitor-upgrade');
    expect(screen.getByText(/Mejorar a Legal Pro — \$34\.99\/mes/)).toBeTruthy();
    expect(btn).toBeTruthy();
  });
});

// ── Quick Connect ────────────────────────────────────────────────────────────
describe('Quick Connect', () => {
  it('shows the server price; pay → payment sheet → confirm → the contacts', async () => {
    mockToken = 'jwt';
    on('get', '/billing/quickconnect/quote', { price_cents: 2000, credit_cents: 0, amount_cents: 2000 });
    on('post', '/billing/quickconnect', { requires_payment: true, client_secret: 'pi_1_secret', payment_intent_id: 'pi_1', amount_cents: 2000 });
    on('post', '/billing/quickconnect/confirm', { success: true, charged: '$20.00', bondsman: { id: 1, name: 'Bail Co', phone: '+16155550111' }, lawyer: { id: 2, name: 'Defense Esq', phone: '+16155550122' } });
    wrap(<QuickConnectScreen navigation={makeNavigation()} route={{} as any} />);
    expect((await screen.findByTestId('qc-total')).props.children).toBe('$20.00');
    await waitFor(() => expect(screen.getByTestId('pay-button').props.accessibilityState?.disabled).not.toBe(true));
    fireEvent.press(screen.getByTestId('pay-button'));
    expect(await screen.findByText('Bail Co')).toBeTruthy();
    expect(mockSheet.initPaymentSheet).toHaveBeenCalledWith({ paymentIntentClientSecret: 'pi_1_secret', merchantDisplayName: 'Justice Gavel' });
    expect(mockSheet.presentPaymentSheet).toHaveBeenCalled();
    expect(calls.find(c => c.url === '/billing/quickconnect/confirm')?.data).toEqual({ payment_intent_id: 'pi_1' });
    expect(screen.getByText('Defense Esq')).toBeTruthy();
  });

  it('cancelling the payment sheet reveals nothing and charges nothing', async () => {
    mockToken = 'jwt';
    mockSheet.presentPaymentSheet.mockImplementationOnce(() => Promise.resolve({ error: { code: 'Canceled', message: 'Canceled' } }));
    on('get', '/billing/quickconnect/quote', { price_cents: 2000, credit_cents: 0, amount_cents: 2000 });
    on('post', '/billing/quickconnect', { requires_payment: true, client_secret: 's', payment_intent_id: 'pi_2', amount_cents: 2000 });
    wrap(<QuickConnectScreen navigation={makeNavigation()} route={{} as any} />);
    await waitFor(() => expect(screen.getByTestId('pay-button').props.accessibilityState?.disabled).not.toBe(true));
    fireEvent.press(screen.getByTestId('pay-button'));
    await waitFor(() => expect(mockSheet.presentPaymentSheet).toHaveBeenCalled());
    expect(calls.some(c => c.url === '/billing/quickconnect/confirm')).toBe(false);
  });
});

// ── Home links ───────────────────────────────────────────────────────────────
describe('Home links', () => {
  it('"Cases" opens the case list (it pointed at Home itself); no attorney tile for a consumer', async () => {
    mockUser = JSON.stringify({ id: 1, displayName: 'Ana', role: 'user' });
    const navigation = makeNavigation();
    wrap(<HomeScreen navigation={navigation} route={{} as any} />);
    await screen.findByText(t('home_welcome_1', { name: 'Ana' }));
    fireEvent.press(screen.getByTestId('tile-Cases'));
    expect(navigation.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'Cases' });
    expect(screen.queryByTestId('tile-AttyDash')).toBeNull();
  });

  it('an attorney sees the attorney dashboard tile', async () => {
    mockUser = JSON.stringify({ id: 2, displayName: 'Esq', role: 'attorney' });
    wrap(<HomeScreen navigation={makeNavigation()} route={{} as any} />);
    expect(await screen.findByTestId('tile-AttyDash')).toBeTruthy();
  });
});

// ── shell ────────────────────────────────────────────────────────────────────
describe('app shell', () => {
  const Boom = ({ err }: { err: Error }) => { throw err; };
  it('a screen that could not be downloaded → "needs a connection", never the raw module URL', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('Loading module http://localhost:8300/_expo/static/js/web/OfflineStatusScreen-e24e.js failed.');
    wrap(<ErrorBoundary><Boom err={err} /></ErrorBoundary>);
    expect(screen.getByText(t('eb_needs_connection'))).toBeTruthy();
    expect(screen.queryByText(/_expo\/static/)).toBeNull();
  });

  it('any other crash shows the friendly message, not the exception text', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    wrap(<ErrorBoundary><Boom err={new TypeError("Cannot read properties of undefined (reading 'map')")} /></ErrorBoundary>);
    expect(screen.getByText(t('x_error_boundary_unexpected_error_occurred'))).toBeTruthy();
    expect(screen.queryByText(/reading 'map'/)).toBeNull();
  });

  it('offline banner: nothing online; one translated, tappable banner offline', () => {
    act(() => setLang('vi', { persist: false }));
    const onPress = jest.fn();
    const { rerender } = wrap(<OfflineBanner visible={false} onPress={onPress} />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    rerender(<ThemeProvider><ToastProvider><OfflineBanner visible onPress={onPress} /></ToastProvider></ThemeProvider>);
    expect(screen.getByText(t('no_internet'))).toBeTruthy();
    expect(screen.queryByText('No internet connection')).toBeNull();
    fireEvent.press(screen.getByTestId('offline-banner'));
    expect(onPress).toHaveBeenCalled();
  });
});
