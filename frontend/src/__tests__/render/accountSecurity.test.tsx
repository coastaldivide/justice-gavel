/**
 * Render tests for the sandbox review of 2026-11-17 (the app side of each fix):
 *   1  FirmJoinScreen: an invitation is accepted with the e-mailed link's token, by the invited address
 *   2  ConfirmEmailScreen: the "confirm your new e-mail" link; this device is signed out after it
 *   4  "Forgot password?" with a phone number sends the link by text
 *   6  the free-question limit says when the next free question is (rolling 24 hours)
 *   8  Terms: on a short screen the checkboxes scroll with the summary instead of being cut off
 *  10  the browser tab title is never an internal route name
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../services/push', () => ({ __esModule: true, registerForPush: jest.fn(() => Promise.resolve()) }));
const mockGetToken = jest.fn(() => Promise.resolve<string | null>('jwt-test'));
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: () => mockGetToken(),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
const mockSignOut = jest.fn((_o?: unknown) => Promise.resolve());
jest.mock('../../services/session', () => ({ __esModule: true, signOut: (o?: unknown) => mockSignOut(o), startSession: jest.fn(() => Promise.resolve()) }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]) };
});

import FirmJoinScreen from '../../screens/FirmJoinScreen';
import ConfirmEmailScreen from '../../screens/ConfirmEmailScreen';
import LoginScreen from '../../screens/LoginScreen';
import TermsAcceptanceModal, { footerScrolls, MIN_SUMMARY_HEIGHT } from '../../screens/TermsAcceptanceModal';
import { chatLimitText } from '../../services/chatStream';
import { documentTitleFor } from '../../navigation/documentTitle';
import { apiMock, makeNavigation } from './apiMock';

const { on, api, reject, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const TOKEN = 'A'.repeat(43);
const HEX = 'c'.repeat(64);

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  reset(); mockSignOut.mockClear(); mockGetToken.mockImplementation(() => Promise.resolve('jwt-test'));
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[buttons.length - 1]?.onPress?.(); });
});
afterEach(() => alertSpy.mockRestore());

describe('1 firm invitation by link', () => {
  const PREVIEW = { firm: 'Smith & Lee', role: 'partner', email: 'bob@firm.test', email_matches: true, invited_by_name: 'Ann Smith', expires_at: '2026-11-24T00:00:00Z' };

  it('shows the firm and role, and joins with the link token', async () => {
    on('get', `/firm-acquisition/invite/${TOKEN}`, PREVIEW);
    on('post', '/firm-acquisition/invite/accept', { joined: true, firm: 'Smith & Lee', role: 'partner' });
    wrap(<FirmJoinScreen navigation={makeNavigation()} route={{ params: { token: TOKEN } } as any} />);
    expect(await screen.findByText(t('fa_invited', { firm: 'Smith & Lee' }))).toBeTruthy();
    fireEvent.press(screen.getByTestId('firm-join-accept'));
    expect(await screen.findByTestId('firm-join-done')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/firm-acquisition/invite/accept', { token: TOKEN });
  });

  it('another address: says which one, and the button is off', async () => {
    on('get', `/firm-acquisition/invite/${TOKEN}`, { ...PREVIEW, email_matches: false });
    wrap(<FirmJoinScreen navigation={makeNavigation()} route={{ params: { token: TOKEN } } as any} />);
    expect(await screen.findByTestId('firm-join-other-email')).toBeTruthy();
    expect(screen.getByText(t('fj_other_email', { email: 'bob@firm.test' }))).toBeTruthy();
    fireEvent.press(screen.getByTestId('firm-join-accept'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('an invalid or used link shows the server message', async () => {
    on('get', `/firm-acquisition/invite/${TOKEN}`, () => Promise.reject(reject(404, { error: 'This invitation is no longer valid.' })));
    wrap(<FirmJoinScreen navigation={makeNavigation()} route={{ params: { token: TOKEN } } as any} />);
    expect(await screen.findByTestId('firm-join-error')).toBeTruthy();
    expect(screen.getByText('This invitation is no longer valid.')).toBeTruthy();
  });

  it('signed out: asks to sign in with the invited address', async () => {
    mockGetToken.mockImplementation(() => Promise.resolve(null));
    wrap(<FirmJoinScreen navigation={makeNavigation()} route={{ params: { token: TOKEN } } as any} />);
    expect(await screen.findByText(t('fj_sign_in'))).toBeTruthy();
  });
});

describe('2 confirm a new e-mail address', () => {
  it('confirms with the token, signs this device out and offers sign-in', async () => {
    on('post', '/auth/confirm-email', { ok: true, message: 'Your e-mail address was changed. Sign in again with the new address.' });
    wrap(<ConfirmEmailScreen navigation={makeNavigation()} route={{ params: { token: HEX } } as any} />);
    expect(await screen.findByTestId('confirm-email-done')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/auth/confirm-email', { token: HEX });
    expect(mockSignOut).toHaveBeenCalledWith({ serverDone: true });
    expect(screen.getByTestId('confirm-email-sign-in')).toBeTruthy();
  });

  it('an expired link shows the server message and changes nothing on this device', async () => {
    on('post', '/auth/confirm-email', () => Promise.reject(reject(400, { error: 'This confirmation link is invalid or has expired. Ask for a new one in Settings.' })));
    wrap(<ConfirmEmailScreen navigation={makeNavigation()} route={{ params: { token: HEX } } as any} />);
    expect(await screen.findByText(/invalid or has expired/)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('an incomplete link is not sent to the server', async () => {
    wrap(<ConfirmEmailScreen navigation={makeNavigation()} route={{ params: { token: 'abc' } } as any} />);
    expect(await screen.findByText(t('ce_no_token'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('4 forgot password with a phone number', () => {
  it('asks to text the link and posts the identifier', async () => {
    mockGetToken.mockImplementation(() => Promise.resolve(null));
    on('post', '/auth/forgot-password', { sent: true });
    wrap(<LoginScreen navigation={makeNavigation()} />);
    fireEvent.changeText(screen.getByTestId('login-email-input'), '615 555 0100');
    fireEvent.press(screen.getByText(t('x_lg_forgot_password')));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { identifier: '615 555 0100' }));
    expect(alertSpy.mock.calls[0][1]).toBe(t('lg_send_reset_text', { phone: '615 555 0100' }));
  });

  it('an e-mail address still gets the e-mail wording; nonsense is caught before asking', async () => {
    mockGetToken.mockImplementation(() => Promise.resolve(null));
    on('post', '/auth/forgot-password', { sent: true });
    wrap(<LoginScreen navigation={makeNavigation()} />);
    fireEvent.changeText(screen.getByTestId('login-email-input'), 'abc');
    fireEvent.press(screen.getByText(t('x_lg_forgot_password')));
    expect(await screen.findByText(t('lg_reset_bad_identifier'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('login-email-input'), 'dana@example.com');
    fireEvent.press(screen.getByText(t('x_lg_forgot_password')));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { identifier: 'dana@example.com' }));
    expect(alertSpy.mock.calls.at(-1)[1]).toBe(t('x_lg_send_reset_link', { email: 'dana@example.com' }));
  });
});

describe('6 the free-question limit', () => {
  it('names the time the next question is free (same day: the time only)', () => {
    const now = new Date(2026, 10, 17, 10, 0);
    const text = chatLimitText(new Date(2026, 10, 17, 15, 45).toISOString(), now);
    expect(text).toContain('3 every 24 hours');
    expect(text).toMatch(/3:45/);
    expect(text).not.toMatch(/tomorrow/i);
  });
  it('another day: the weekday too; no or past time: the general sentence', () => {
    const now = new Date(2026, 10, 17, 22, 0);
    expect(chatLimitText(new Date(2026, 10, 18, 9, 5).toISOString(), now)).toMatch(/Wednesday.*9:05/);
    expect(chatLimitText(undefined, now)).toBe(t('x_ch_ve_used_free_ai'));
    expect(chatLimitText(new Date(2026, 10, 17, 21, 0).toISOString(), now)).toBe(t('x_ch_ve_used_free_ai'));
  });
});

describe('8 Terms on a short screen', () => {
  it('footerScrolls: pinned while the summary keeps its room, scrolling when it would not', () => {
    expect(footerScrolls(900, 100, 330, 900)).toBe(false);                    // 470 px left for the summary
    expect(footerScrolls(568, 110, 330, 568)).toBe(true);                     // 320×568: 128 px left
    expect(footerScrolls(568, 110, 568 - 110 - MIN_SUMMARY_HEIGHT, 568)).toBe(false);
    expect(footerScrolls(0, 0, 0, 568)).toBe(true);                           // before measuring: by the window
    expect(footerScrolls(0, 0, 0, 900)).toBe(false);
  });

  it('a short screen: the checkboxes and button are inside the scroll, reachable, and unlock after the summary', async () => {
    on('post', '/auth/accept-tos', { ok: true });
    on('post', '/auth/disclaimer/accept', { accepted: true });
    const onAccepted = jest.fn();
    wrap(<TermsAcceptanceModal visible onAccepted={onAccepted} />);
    const lay = (id: string, height: number) =>
      fireEvent(screen.getByTestId(id), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height } } });
    // jest's window is 750 px tall: measure a 320×568 phone instead — the pinned footer would leave 128 px
    lay('tos-container', 568);
    lay('tos-header', 110);
    lay('tos-footer', 330);
    lay('tos-scroll', 128);
    await waitFor(() => expect(within(screen.getByTestId('tos-scroll')).getByTestId('tos-footer')).toBeTruthy());
    fireEvent(screen.getByTestId('tos-scroll'), 'contentSizeChange', 320, 1900);
    fireEvent.press(screen.getByTestId('tos-check-terms'));
    fireEvent.press(screen.getByTestId('tos-check-no-advice'));
    const btn = screen.getByTestId('tos-accept-button');
    expect(btn.props.accessibilityState?.disabled).toBe(true);              // the summary has not been seen yet
    fireEvent.scroll(screen.getByTestId('tos-scroll'), { nativeEvent: {
      layoutMeasurement: { height: 400, width: 320 }, contentOffset: { y: 1500, x: 0 }, contentSize: { height: 1900, width: 320 },
    } });
    await waitFor(() => expect(screen.getByTestId('tos-accept-button').props.accessibilityState?.disabled).toBe(false));
    fireEvent.press(screen.getByTestId('tos-accept-button'));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  });
});

describe('8c Terms layout does not jump while in use', () => {
  it('once decided for a height, a footer that grows or shrinks does not switch the layout; a new height does', async () => {
    wrap(<TermsAcceptanceModal visible onAccepted={jest.fn()} />);
    const lay = (id: string, height: number) =>
      fireEvent(screen.getByTestId(id), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });
    lay('tos-container', 640); lay('tos-header', 110); lay('tos-footer', 300);       // 230 px left: pinned
    await waitFor(() => expect(within(screen.getByTestId('tos-scroll')).queryByTestId('tos-footer')).toBeNull());
    lay('tos-footer', 360);                                                           // an error line appears
    await new Promise<void>(r => { setTimeout(r, 50); });
    expect(within(screen.getByTestId('tos-scroll')).queryByTestId('tos-footer')).toBeNull();   // still pinned
    lay('tos-container', 568);                                                        // the screen really changed
    await waitFor(() => expect(within(screen.getByTestId('tos-scroll')).getByTestId('tos-footer')).toBeTruthy());
  });
});

describe('8b Terms on a tall screen', () => {
  it('the checkboxes and button stay pinned below the summary', async () => {
    wrap(<TermsAcceptanceModal visible onAccepted={jest.fn()} />);
    const lay = (id: string, height: number) =>
      fireEvent(screen.getByTestId(id), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
    lay('tos-container', 844);
    lay('tos-header', 110);
    lay('tos-footer', 330);
    await waitFor(() => expect(within(screen.getByTestId('tos-scroll')).queryByTestId('tos-footer')).toBeNull());
    expect(screen.getByTestId('tos-footer')).toBeTruthy();
  });
});

describe('10 browser tab title', () => {
  it('a screen title plus the app name; never a route name', () => {
    expect(documentTitleFor({ title: 'Home' }, 'Justice Gavel')).toBe('Home · Justice Gavel');
    expect(documentTitleFor({}, 'Justice Gavel')).toBe('Justice Gavel');
    expect(documentTitleFor(undefined, 'Justice Gavel')).toBe('Justice Gavel');
    expect(documentTitleFor({ title: 'Justice Gavel' }, 'Justice Gavel')).toBe('Justice Gavel');
    expect(documentTitleFor({ title: '  ' }, 'Justice Gavel')).toBe('Justice Gavel');
  });
});
