/**
 * Render tests: re-arrest alerts (A4), custody alerts for families (A9), sharing a forfeited
 * bond with a recovery agent (B4) and the Tennessee quarterly report (B5).
 *
 *   - Bond detail: the Alerts / Recovery tabs exist only when the server's ⚖ settings are on.
 *   - Alerts tab: the coverage line names the counties we import (never "nationwide"); a
 *     possible match can be dismissed; the timeline lists events.
 *   - Recovery tab: the state's rule with how it was checked; sharing needs the acknowledgement;
 *     a banned state cannot be shared; views are listed; revoke asks first.
 *   - Follow card: hidden when the setting is off; consent required; texts need number + consent.
 *   - Custody alerts screen: roster wording ("no longer listed"), unfollow; taken-down records.
 *   - Recovery agent's view: read only, the "views are logged" notice, the file contents.
 *   - Tennessee report: quarter field, CSV and PDF downloads.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve('jwt-test')),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(JSON.stringify({ id: 1, accountType: 'bail_agent' }))),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) };
});
jest.mock('../../components/AuthGate', () => ({
  __esModule: true,
  useAuthGate: () => ({ requireAuth: (fn: () => void) => fn(), AuthGateModal: () => null }),
}));
jest.mock('expo-clipboard', () => ({ __esModule: true, setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })) }));
const mockFetchFile = jest.fn((..._a: unknown[]) => Promise.resolve('view'));
jest.mock('../../services/fileDownload', () => ({ __esModule: true, fetchFile: (...a: unknown[]) => mockFetchFile(...a), appendPicked: jest.fn() }));

import BondDetailScreen from '../../screens/BondDetailScreen';
import BondDeskScreen from '../../screens/BondDeskScreen';
import BondReportsScreen, { previousQuarter, isQuarter } from '../../screens/BondReportsScreen';
import CustodyAlertsScreen from '../../screens/CustodyAlertsScreen';
import RecoverySharesScreen from '../../screens/RecoverySharesScreen';
import RecoveryInviteScreen from '../../screens/RecoveryInviteScreen';
import { FollowBookingCard } from '../../components/FollowBookingCard';
import { apiMock, makeNavigation } from './apiMock';

const { on, reject, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const has = (x: string) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const ACCESS = { allowed: true, reason: null, plan: 'starter', texts_live: true, email_live: true, storage_live: true, text_cents: 5 };
const ON = { ...ACCESS, features: { rearrest_alerts: true, recovery_sharing: true } };
const BOND = {
  id: 7, status: 'forfeited', defendant_name: 'Ana Lopez', defendant_dob: null, defendant_phone: null, defendant_email: null, defendant_address: null,
  case_number: 'GS-1', court_name: null, county: 'Davidson', state: 'TN', court_date: null, charges: null, bond_amount_cents: 500000, surety_name: null,
  posted_on: '2026-10-01', forfeited_on: '2026-10-20', forfeiture_deadline_on: '2027-01-20', discharged_on: null, forfeiture_paid_cents: null,
  checkin_enrollment_id: null, notes: null, created_at: '', updated_at: '', power: null,
};
const DETAIL = { bond: BOND, indemnitors: [], charges: [], payments: [], installments: [], collateral: [], packets: [],
  money: { charged_cents: 0, paid_cents: 0, balance_cents: 0, plan_scheduled_cents: 0, plan_in_sync: true, overdue_cents: 0, next_due: null } };
const MATCH = (over: Record<string, unknown> = {}) => ({ id: 31, bond_id: 7, arrest_id: 900, match: 'possible', status: 'pending', created_at: '2026-10-27T15:00:00Z', decided_at: null,
  booking: { name: 'LOPEZ, ANA', booking_date: '2026-10-27', county: 'Davidson', state: 'TN', facility: 'Downtown Detention', charges: 'THEFT', dob_on_roster: false },
  alerts: { push: 'sent', email: 'sent', text: null }, ...over });
const TN_RULE = { state: 'TN', allowed: true, license: false, agency: null, law: 'Tenn. Code Ann. §§ 40-11-318', notes: 'Present the warrant…', source_url: 'https://example.test/tn', checked: 'secondary' };

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  reset(); mockFetchFile.mockClear(); mockNavigate.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[buttons.length - 1]?.onPress?.(); });
});
afterEach(() => alertSpy.mockRestore());

describe('bond detail: the ⚖ tabs', () => {
  it('Alerts and Recovery tabs are hidden while the server settings are off', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/bonds/7', DETAIL);
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'collateral' } } as never} />);
    expect(await screen.findByTestId('bond-tab-collateral')).toBeTruthy();
    await waitFor(() => expect(calls.some(c => c.url === '/bond-desk/access')).toBe(true));
    expect(screen.queryByTestId('bond-tab-alerts')).toBeNull();
    expect(screen.queryByTestId('bond-tab-recovery')).toBeNull();
  });

  it('Alerts: coverage names the counties we import, a possible match is dismissed, the timeline lists events', async () => {
    on('get', '/bond-desk/access', ON);
    on('get', '/bond-desk/bonds/7', DETAIL);
    on('get', '/bond-desk/bonds/7/rearrests', { coverage: { feeds_configured: true, counties: [{ county: 'Davidson', state: 'TN' }, { county: 'Shelby', state: 'TN' }] },
      watching: true, dob_on_file: false, matches: [MATCH()], settings: { rearrest_text: false, alert_phone: null }, text_cents: 5 });
    on('get', '/bond-desk/bonds/7/timeline', { events: [{ id: 1, kind: 'rearrest_possible', detail: { county: 'Davidson', state: 'TN' }, at: '2026-10-27T15:00:00Z' }] });
    on('post', '/bond-desk/rearrests/31/dismiss', { ok: true, status: 'dismissed' });
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'alerts' } } as never} />);
    expect(await screen.findByTestId('rearrest-coverage')).toHaveTextContent(has(t('bdw_coverage', { counties: 'Davidson, TN · Shelby, TN' })));
    expect(screen.getByTestId('rearrest-coverage')).not.toHaveTextContent(/nationwide/i);
    expect(screen.getByTestId('rearrest-no-dob')).toBeTruthy();
    expect(screen.getByTestId('rearrest-31')).toHaveTextContent(has(t('bdw_possible')));
    expect(screen.getByTestId('timeline-rearrest_possible')).toHaveTextContent(has('Davidson, TN'));
    fireEvent.press(screen.getByTestId('rearrest-dismiss-31'));
    await waitFor(() => expect(calls.some(c => c.method === 'post' && c.url === '/bond-desk/rearrests/31/dismiss')).toBe(true));
  });

  it('Alerts: with no roster imported it says so instead of implying coverage', async () => {
    on('get', '/bond-desk/access', ON);
    on('get', '/bond-desk/bonds/7', DETAIL);
    on('get', '/bond-desk/bonds/7/rearrests', { coverage: { feeds_configured: false, counties: [] }, watching: true, dob_on_file: true, matches: [],
      settings: { rearrest_text: false, alert_phone: null }, text_cents: 5 });
    on('get', '/bond-desk/bonds/7/timeline', { events: [] });
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'alerts' } } as never} />);
    expect(await screen.findByTestId('rearrest-no-coverage')).toHaveTextContent(has(t('bdw_no_coverage')));
  });

  it('Recovery: the state rule shows how it was checked; sharing needs the acknowledgement; views and revoke', async () => {
    on('get', '/bond-desk/access', ON);
    on('get', '/bond-desk/bonds/7', DETAIL);
    on('get', '/bond-desk/bonds/7/recovery', { bond_status: 'forfeited', state: 'TN', state_rule: TN_RULE,
      shares: [{ id: 5, invite_email: 'ra@example.test', share_locations: false, created_at: '2026-10-27T10:00:00Z', accepted_at: '2026-10-27T11:00:00Z',
        account_name: 'Ray', status: 'active', ended_at: null, ended_reason: null, views: [{ what: 'details', at: '2026-10-27T12:00:00Z' }] }] });
    on('post', '/bond-desk/bonds/7/recovery/shares', { share: { id: 6 }, email_status: 'skipped', link: 'https://justicegavel.app/recovery/abc', shares: [] });
    on('post', '/bond-desk/recovery/shares/5/revoke', { ok: true });
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'recovery' } } as never} />);
    expect(await screen.findByTestId('recovery-rule-checked')).toHaveTextContent(has(t('bdr_rule_secondary')));
    expect(screen.getByTestId('recovery-share-5')).toHaveTextContent(has(t('bdr_views', { n: 1 })));
    expect(screen.getByTestId('recovery-share').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('recovery-email'), 'new@example.test');
    fireEvent.press(screen.getByTestId('recovery-ack'));
    fireEvent.press(screen.getByTestId('recovery-share'));
    expect(await screen.findByTestId('recovery-sent')).toHaveTextContent(has(t('bdr_sent_no_email')));
    expect(calls.find(c => c.method === 'post' && c.url === '/bond-desk/bonds/7/recovery/shares')?.data).toEqual({ email: 'new@example.test', share_locations: false, rule_acknowledged: true });
    fireEvent.press(screen.getByTestId('recovery-revoke-5'));
    await waitFor(() => expect(calls.some(c => c.url === '/bond-desk/recovery/shares/5/revoke')).toBe(true));
  });

  it('Recovery: a state whose recorded rule bans recovery cannot be shared; an unverified rule says so', async () => {
    on('get', '/bond-desk/access', ON);
    on('get', '/bond-desk/bonds/7', DETAIL);
    on('get', '/bond-desk/bonds/7/recovery', { bond_status: 'forfeited', state: 'IL', state_rule: { ...TN_RULE, state: 'IL', allowed: false }, shares: [] });
    const { unmount } = wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'recovery' } } as never} />);
    expect(await screen.findByTestId('recovery-rule-banned')).toBeTruthy();
    expect(screen.queryByTestId('recovery-share-form')).toBeNull();
    unmount();
    on('get', '/bond-desk/bonds/7/recovery', { bond_status: 'forfeited', state: 'AL', state_rule: { state: 'AL', allowed: null, license: null, agency: null, law: null, notes: 'Not verified yet', source_url: null, checked: 'unverified' }, shares: [] });
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'recovery' } } as never} />);
    expect(await screen.findByTestId('recovery-rule-checked')).toHaveTextContent(has(t('bdr_rule_unverified')));
  });
});

describe('Bond Desk dashboard', () => {
  it('lists re-arrests (possible ones say confirm or dismiss) and opens the bond on the Alerts tab', async () => {
    on('get', '/bond-desk/access', ON);
    on('get', '/bond-desk/bonds', { bonds: [] });
    on('get', '/bond-desk/dashboard', { counts: { prospect: 0, active: 1, forfeited: 0 }, liability_cents: 0, receivable_cents: 0, overdue_cents: 0,
      overdue: [], forfeitures: [], awaiting_signature: [], texts_this_month: { count: 0, cents: 0 },
      rearrests: [{ ...MATCH(), defendant_name: 'Ana Lopez' }] });
    const nav = makeNavigation();
    wrap(<BondDeskScreen navigation={nav} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('bond-desk-rearrests')).toHaveTextContent(has('Ana Lopez'));
    fireEvent.press(screen.getByTestId('dash-rearrest-31'));
    expect(nav.navigate).toHaveBeenCalledWith('BondDetail', { bondId: 7, tab: 'alerts' });
  });
});

describe('custody alerts (families)', () => {
  it('the follow card stays hidden when the setting is off', async () => {
    on('get', '/custody/status', { enabled: false, max_follows: 10, texts_live: true });
    wrap(<FollowBookingCard arrestId={900} />);
    await waitFor(() => expect(calls.some(c => c.url === '/custody/status')).toBe(true));
    expect(screen.queryByTestId('follow-booking-card')).toBeNull();
  });

  it('following needs consent; texts go to the verified phone only and need their own consent', async () => {
    on('get', '/custody/status', { enabled: true, max_follows: 10, texts_live: true, verified_phone_last4: '0160' });
    on('get', '/custody/arrest/900', { follow_id: null, trackable: true });
    on('post', '/custody/follows', { follow_id: 44, follows: [] });
    wrap(<FollowBookingCard arrestId={900} />);
    expect(await screen.findByTestId('follow-booking-card')).toBeTruthy();
    expect(screen.getByTestId('follow-booking').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('follow-consent'));
    fireEvent.press(screen.getByTestId('follow-texts'));
    expect(screen.queryByTestId('follow-phone')).toBeNull();   // no number is typed
    expect(screen.getByTestId('follow-verified-phone')).toHaveTextContent(has(t('cus_texts_verified', { last4: '0160' })));
    fireEvent.press(screen.getByTestId('follow-booking'));
    expect(await screen.findByTestId('follow-error')).toHaveTextContent(has(t('cus_text_needed')));
    fireEvent.press(screen.getByTestId('follow-text-consent'));
    fireEvent.press(screen.getByTestId('follow-booking'));
    expect(await screen.findByTestId('follow-following')).toBeTruthy();
    expect(calls.find(c => c.method === 'post')?.data).toEqual({ arrest_id: 900, consent: true, text_opt_in: true, text_consent: true });
  });

  it('without a verified phone, texts offer "Verify my number" instead', async () => {
    on('get', '/custody/status', { enabled: true, max_follows: 10, texts_live: true, verified_phone_last4: null });
    on('get', '/custody/arrest/900', { follow_id: null, trackable: true });
    wrap(<FollowBookingCard arrestId={900} />);
    expect(await screen.findByTestId('follow-booking-card')).toBeTruthy();
    fireEvent.press(screen.getByTestId('follow-consent'));
    fireEvent.press(screen.getByTestId('follow-texts'));
    expect(screen.getByTestId('follow-verify-first')).toHaveTextContent(has(t('cus_verify_first')));
    fireEvent.press(screen.getByTestId('follow-verify-phone'));
    expect(mockNavigate).toHaveBeenCalledWith('VerifyPhone');
    fireEvent.press(screen.getByTestId('follow-booking'));
    expect(await screen.findByTestId('follow-error')).toHaveTextContent(has(t('cus_verify_first')));
    expect(calls.some(c => c.method === 'post')).toBe(false);
  });

  it('a booking not from a roster we re-check cannot be followed', async () => {
    on('get', '/custody/status', { enabled: true, max_follows: 10, texts_live: false });
    on('get', '/custody/arrest/900', { follow_id: null, trackable: false });
    wrap(<FollowBookingCard arrestId={900} />);
    expect(await screen.findByTestId('follow-not-trackable')).toBeTruthy();
  });

  it('the screen repeats the roster ("no longer listed"), never "released"; taken-down records show no details; unfollow', async () => {
    on('get', '/cases', []);
    on('get', '/custody/follows', { follows: [
      { id: 44, arrest_id: 900, available: true, created_at: '2026-10-26T10:00:00Z', case_id: null, case_title: null, text_opt_in: true, text_phone_last4: '0160',
        booking: { name: 'LOPEZ, ANA', county: 'Davidson', state: 'TN', facility: 'Riverbend', status: 'Transferred', jail_phone: '(615) 555-0199',
          booking_date: '2026-10-25T00:00:00Z', listed: false, not_listed_since: '2026-10-27T21:00:00Z', last_seen_at: '2026-10-27T19:00:00Z' },
        events: [{ id: 2, kind: 'not_listed', old_value: null, new_value: null, observed_at: '2026-10-27T21:00:00Z' },
          { id: 1, kind: 'status_changed', old_value: 'In custody', new_value: 'Transferred', observed_at: '2026-10-27T19:00:00Z' }] },
      { id: 45, arrest_id: 901, available: false, created_at: '2026-10-26T10:00:00Z', case_id: null, case_title: null, text_opt_in: false, text_phone_last4: null },
    ] });
    on('delete', '/custody/follows/44', { ok: true });
    wrap(<CustodyAlertsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('custody-event-2')).toHaveTextContent(has(t('cus_ev_not_listed')));
    expect(screen.getByTestId('custody-event-1')).toHaveTextContent(has(t('cus_ev_status', { old: 'In custody', new: 'Transferred' })));
    expect(screen.getByTestId('custody-follow-44')).not.toHaveTextContent(/released/i);
    expect(screen.getByTestId('custody-texts-on-44')).toHaveTextContent(has('0160'));
    expect(screen.getByTestId('custody-removed-45')).toBeTruthy();
    fireEvent.press(screen.getByTestId('custody-unfollow-44'));
    await waitFor(() => expect(calls.some(c => c.method === 'delete' && c.url === '/custody/follows/44')).toBe(true));
  });

  it('when the setting is off the screen says so', async () => {
    on('get', '/cases', []);
    on('get', '/custody/follows', () => Promise.reject(reject(503, { error: 'off', code: 'feature_unavailable' })));
    wrap(<CustodyAlertsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('custody-off')).toBeTruthy();
  });
});

describe('recovery agent', () => {
  const FILE = {
    share: { id: 5, share_locations: true },
    defendant: { name: 'Ana Lopez', dob: '1990-04-05', photo_available: true },
    bond: { case_number: 'GS-1', court_name: null, county: 'Davidson', state: 'TN', charges: null, bond_amount_cents: 500000, forfeited_on: '2026-10-20',
      forfeiture_deadline_on: '2027-01-20', days_left: 85 },
    addresses: [{ value: '12 Elm St', source: 'questionnaire' }], phones: [{ value: '615-555-0144', source: 'bond' }], employers: [], references: [], vehicles: [],
    checkins: [{ at: '2026-10-25T15:00:00Z', via: 'link', location: { lat: 36.16, lng: -86.78 } }, { at: '2026-10-24T15:00:00Z', via: 'app', location: null }],
    rearrests: [], agent: { agency: 'Sigma Bail Bonds', name: 'Sam', license: 'TN-77', phone: '615-555-0177', email: 'a@example.test' }, state_rule: TN_RULE,
  };
  it('opens a shared file read only, says views are logged, and opens the photo on request', async () => {
    on('get', /^\/recovery-shares\/5$/, FILE);
    on('get', /^\/recovery-shares$/, { shares: [{ id: 5, defendant_name: 'Ana Lopez', forfeiture_deadline_on: '2027-01-20', state: 'TN', agency: 'Sigma Bail Bonds', accepted_at: '' }] });
    wrap(<RecoverySharesScreen navigation={makeNavigation()} route={{ params: { shareId: 5 } } as never} />);
    expect(await screen.findByTestId('recovery-logged-note')).toHaveTextContent(has(t('rsh_logged')));
    expect(screen.getByTestId('recovery-share-file')).toHaveTextContent(has('12 Elm St'));
    expect(screen.getByTestId('recovery-share-file')).toHaveTextContent(has(t('rsh_checkin_no_location')));
    fireEvent.press(screen.getByTestId('recovery-photo'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('/recovery-shares/5/photo', 'defendant-5.jpg', 'image/jpeg', 'view'));
  });
  it('the invitation link asks a signed-out person to sign in with the invited address', async () => {
    on('post', '/recovery-shares/accept', () => Promise.reject(reject(401, { error: 'auth' })));
    wrap(<RecoveryInviteScreen navigation={makeNavigation()} route={{ params: { token: 'A'.repeat(43) } } as never} />);
    expect(await screen.findByTestId('recovery-invite-signin')).toHaveTextContent(has(t('rsh_invite_signin')));
  });
  it('a signed-in person accepts and is taken to the file', async () => {
    on('post', '/recovery-shares/accept', { share_id: 5 });
    const nav = makeNavigation();
    wrap(<RecoveryInviteScreen navigation={nav} route={{ params: { token: 'A'.repeat(43) } } as never} />);
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('MainTabs', { screen: 'MoreTab', params: { screen: 'RecoveryShares', params: { shareId: 5 } } }));
  });
});

describe('Tennessee quarterly report', () => {
  it('quarter helpers', () => {
    expect(previousQuarter('2026-10-27')).toBe('2026-Q3');
    expect(previousQuarter('2026-02-01')).toBe('2025-Q4');
    expect(isQuarter('2026-Q4')).toBe(true);
    expect(isQuarter('2026-Q5')).toBe(false);
  });
  it('runs for a quarter and downloads CSV and PDF', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/reports/liability', { by_surety: [], bonds: [], total_cents: 0 });
    on('get', '/bond-desk/reports/tn-quarterly', { quarter: '2026-Q3', period_from: '2026-07-01', period_to: '2026-09-30', due_on: '2026-10-25',
      citation: 'Tenn. Pub. Ch. 396 (2025), T.C.A. § 40-11-314', checked_on: '2026-10-27',
      totals: { bonds_issued: 2, liability_issued_cents: 350000, open_bonds_at_end: 2, liability_open_at_end_cents: 350000 },
      counties: [{ county: 'Davidson', bonds_issued: 2, liability_issued_cents: 350000, open_bonds_at_end: 2, liability_open_at_end_cents: 350000 }], needs_county: [] });
    wrap(<BondReportsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('report-tn_quarterly'));
    fireEvent.changeText(await screen.findByTestId('report-quarter'), '2026-Q3');
    fireEvent.press(screen.getByTestId('report-run-tn'));
    expect(await screen.findByTestId('report-table-counties')).toHaveTextContent(has('Davidson'));
    expect(screen.getByTestId('report-result')).toHaveTextContent(has('40-11-314'));
    fireEvent.press(screen.getByTestId('report-pdf'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('/bond-desk/reports/tn-quarterly?quarter=2026-Q3&format=pdf', 'tennessee-quarterly-2026-Q3.pdf', 'application/pdf'));
    fireEvent.press(screen.getByTestId('report-csv'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('/bond-desk/reports/tn-quarterly?quarter=2026-Q3&format=csv', 'tennessee-quarterly-2026-Q3.csv', 'text/csv'));
    fireEvent.changeText(screen.getByTestId('report-quarter'), '2026-Q9');
    fireEvent.press(screen.getByTestId('report-run-tn'));
    expect(await screen.findByTestId('report-error')).toHaveTextContent(has(t('bdk_err_quarter')));
  });
});
