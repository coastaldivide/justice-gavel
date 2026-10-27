/**
 * Render tests: Bond Desk card payments, automatic payments, pay page, import, staff seats and
 * forms set-up (docs/BOND_DESK.md).
 *
 *   - Settings: card payments cannot be set up until the fee terms are accepted; set-up opens
 *     Stripe's page; seats used / included; over the seats the invite form becomes "move up a plan";
 *     staff do not get owner actions.
 *   - Money tab: automatic payments need card payments on; texting the link needs the consent box;
 *     the plan-changed warning and the attempts history.
 *   - The payer's page: the server's consent text is shown verbatim; nothing starts until "I agree";
 *     "Confirm payment" and "Stop automatic payments".
 *   - The pay page: amounts parsed to cents, limits and contact checked before anything is sent.
 *   - Import: rows with problems block the import; a clean file imports.
 *   - Staff invitation for another e-mail cannot be accepted; admin hands over a forms set-up.
 */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

let mockUser: Record<string, unknown> = { id: 9, accountType: 'bail_agent' };
jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve('jwt-test')),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(JSON.stringify(mockUser))),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});
jest.mock('../../components/AuthGate', () => ({ __esModule: true, useAuthGate: () => ({ requireAuth: (fn: () => void) => fn(), AuthGateModal: () => null }) }));
jest.mock('expo-clipboard', () => ({ __esModule: true, setStringAsync: jest.fn(() => Promise.resolve(true)) }));
const mockPick = jest.fn((..._a: unknown[]) => Promise.resolve({ canceled: true, assets: [] as unknown[] }));
jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: (...a: unknown[]) => mockPick(...a) }));
jest.mock('../../services/fileDownload', () => ({ __esModule: true, fetchFile: jest.fn(() => Promise.resolve('download')), appendPicked: jest.fn(() => Promise.resolve()) }));

import BondDetailScreen from '../../screens/BondDetailScreen';
import BondDeskSettingsScreen from '../../screens/BondDeskSettingsScreen';
import BondImportScreen from '../../screens/BondImportScreen';
import AutopayLinkScreen from '../../screens/AutopayLinkScreen';
import AgencyPayScreen, { payBody } from '../../screens/AgencyPayScreen';
import StaffJoinScreen from '../../screens/StaffJoinScreen';
import AdminFormsSetupScreen from '../../screens/AdminFormsSetupScreen';
import { apiMock, makeNavigation } from './apiMock';
import { bondsmanPlansFrom } from '../../screens/SubscriptionScreen';
import { importErrorText, seatsLeft } from '../../services/bondDesk';

const { on, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const ACCESS = { allowed: true, reason: null, plan: 'starter', role: 'owner', texts_live: true, email_live: true, storage_live: true, text_cents: 5, autopay_enabled: true };
const disabled = (id: string) => !!screen.getByTestId(id).props.accessibilityState?.disabled;
const has = (x: string) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const CONNECT_ON = { status: 'enabled', charges_enabled: true, payouts_enabled: true, details_submitted: true, disabled_reason: null, fees_acknowledged_at: '2026-10-01',
  pay_link: 'https://justicegavel.app/pay/abcdefghjk23', pay_link_on: true, payments_live: true, autopay_available: true, autopay_fee_cents: 99,
  pay_link_limits: { min_cents: 100, max_cents: 5000000 } };
const CONNECT_NONE = { ...CONNECT_ON, status: 'none', charges_enabled: false, payouts_enabled: false, details_submitted: false, pay_link: null, pay_link_on: false };

const BOND = {
  id: 7, status: 'active', defendant_name: 'Ana Lopez', defendant_dob: null, defendant_phone: '+16155550100', defendant_email: 'ana@example.test',
  defendant_address: null, case_number: 'GS-1', court_name: null, county: 'Davidson', state: 'TN', court_date: null, charges: null, bond_amount_cents: 500000,
  surety_name: null, posted_on: '2026-10-20', forfeited_on: null, forfeiture_deadline_on: null, discharged_on: null, forfeiture_paid_cents: null,
  checkin_enrollment_id: null, notes: null, created_at: '', updated_at: '', power: null,
};
const DETAIL = {
  bond: BOND, indemnitors: [], charges: [{ id: 1, kind: 'premium', amount_cents: 30000, description: null, created_at: '', voided_at: null, void_reason: null }],
  payments: [{ id: 2, receipt_no: 'R-000004', amount_cents: 10000, method: 'card', reference: 'Automatic payment', payer_name: 'Ana Lopez', received_on: '2026-10-27', created_at: '', voided_at: null, void_reason: null, source: 'autopay' }],
  installments: [{ id: 5, due_on: '2026-10-27', amount_cents: 10000, covered_cents: 10000, status: 'paid' }, { id: 6, due_on: '2026-11-27', amount_cents: 20000, covered_cents: 0, status: 'due' }],
  collateral: [], packets: [],
  money: { charged_cents: 30000, paid_cents: 10000, balance_cents: 20000, plan_scheduled_cents: 30000, plan_in_sync: true, overdue_cents: 0, next_due: null },
};
const AUTOPAY_NONE = { enabled: true, autopay: null, attempts: [], plan_changed: false, fee_cents: 99 };

let alertSpy: jest.SpyInstance;
let openSpy: jest.SpyInstance;
beforeEach(() => {
  reset(); mockPick.mockReset(); mockUser = { id: 9, accountType: 'bail_agent' };
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[buttons.length - 1]?.onPress?.(); });
  openSpy = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));
});
afterEach(() => { alertSpy.mockRestore(); openSpy.mockRestore(); });

describe('helpers', () => {
  it('pay page body: exact cents, limits, contact and agreement', () => {
    const lim = { min_cents: 100, max_cents: 5000000 };
    const f = { amount: '1,250.50', payer: 'Pat', phone: '', email: 'pat@example.com', defendant: 'Sam', textReceipt: true, agree: true };
    expect(payBody(f, lim).body).toMatchObject({ amount_cents: 125050, payer_email: 'pat@example.com', payer_phone: null, receipt_by_text: false, agree_final: true });
    expect(payBody({ ...f, amount: '0.99' }, lim).error).toBe('apy_err_amount');
    expect(payBody({ ...f, amount: '50000.01' }, lim).error).toBe('apy_err_amount');
    expect(payBody({ ...f, amount: '19.999' }, lim).error).toBe('apy_err_amount');
    expect(payBody({ ...f, email: '' }, lim).error).toBe('apy_err_contact');
    expect(payBody({ ...f, agree: false }, lim).error).toBe('apy_err_agree');
  });
  it('seats left never goes below zero; plan cards list seats; import errors read as words', () => {
    expect(seatsLeft({ included: 3, used: 4, staff: 2, pending: 1 })).toBe(0);
    expect(seatsLeft({ included: 10, used: 3, staff: 1, pending: 1 })).toBe(7);
    const plans = bondsmanPlansFrom({ tiers: [{ key: 'starter', name: 'Bondsman Starter', display: '$99/mo', annual_cents: 95000, annual_savings_cents: 23800, counties: 1, seats: 3, features: [{ key: 'bond_desk' }] }] });
    expect(plans[0].features).toContain(t('plan_feat_seats', { n: 3 }));
    expect(importErrorText({ field: 'power_number', code: 'power_duplicate', line: 3 })).toBe(t('bdk_imp_err_line', { field: t('bdk_imp_col_power_number'), problem: t('bdk_imp_err_power_duplicate', { line: 3 }) }));
  });
});

describe('Bond Desk settings', () => {
  it('fee terms first, then Stripe set-up opens; seats shown; over the seats → move up a plan', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/connect', CONNECT_NONE);
    on('get', '/bond-desk/staff', { seats: { included: 3, used: 3, staff: 1, pending: 1 }, owner: { user_id: 9, email: 'me@x.test', name: 'Me', role: 'owner' },
      staff: [{ user_id: 12, email: 'kim@x.test', name: 'Kim', role: 'staff', added_at: '' }], invites: [{ id: 4, email: 'lee@x.test', created_at: '', expires_at: '2026-11-10' }] });
    on('post', '/bond-desk/connect/start', { url: 'https://connect.stripe.com/setup/e/acct_1/abc' });
    const nav = makeNavigation();
    wrap(<BondDeskSettingsScreen navigation={nav} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('connect-fees')).toHaveTextContent(has(t('bdk_connect_fee_jg', { fee: '$0.99' })));
    expect(disabled('connect-start')).toBe(true);
    fireEvent.press(screen.getByTestId('connect-fees-ok'));
    fireEvent.press(screen.getByTestId('connect-start'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc'));
    expect(calls.find(c => c.url === '/bond-desk/connect/start')?.data).toEqual({ fees_acknowledged: true });
    expect(screen.getByTestId('staff-seats')).toHaveTextContent(has(t('bdk_seats_line', { used: 3, included: 3 })));
    expect(screen.getByTestId('seats-full')).toBeTruthy();
    expect(screen.queryByTestId('invite-email')).toBeNull();
    fireEvent.press(screen.getByTestId('seats-upgrade'));
    expect(nav.navigate).toHaveBeenCalledWith('Subscription');
    fireEvent.press(screen.getByTestId('staff-remove-12'));
    await waitFor(() => expect(calls.some(c => c.method === 'delete' && c.url === '/bond-desk/staff/12')).toBe(true));
  });

  it('with card payments on: the pay link; staff see no owner actions', async () => {
    on('get', '/bond-desk/access', { ...ACCESS, role: 'staff' });
    on('get', '/bond-desk/connect', CONNECT_ON);
    on('get', '/bond-desk/staff', { seats: { included: 10, used: 2, staff: 1, pending: 0 }, owner: { user_id: 3, email: 'boss@x.test', name: 'Boss', role: 'owner' },
      staff: [{ user_id: 9, email: 'me@x.test', name: 'Me', role: 'staff', added_at: '' }], invites: [] });
    wrap(<BondDeskSettingsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('paylink')).toHaveTextContent(has(CONNECT_ON.pay_link));
    expect(screen.queryByTestId('paylink-toggle')).toBeNull();
    expect(screen.queryByTestId('connect-dashboard')).toBeNull();
    expect(screen.queryByTestId('data-export')).toBeNull();
    expect(screen.queryByTestId('invite-email')).toBeNull();
    expect(screen.getByTestId('staff-leave')).toBeTruthy();
  });

  it('back from Stripe (connect=return) re-reads the account', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('post', '/bond-desk/connect/refresh', CONNECT_ON);
    on('get', '/bond-desk/staff', { seats: { included: 3, used: 1, staff: 0, pending: 0 }, owner: { user_id: 9, email: null, name: 'Me', role: 'owner' }, staff: [], invites: [] });
    on('post', '/bond-desk/staff/invites', { link: 'https://justicegavel.app/bond-desk/join/x', email_status: 'skipped' });
    wrap(<BondDeskSettingsScreen navigation={makeNavigation()} route={{ params: { connect: 'return' } } as never} />);
    expect(await screen.findByTestId('paylink')).toBeTruthy();
    expect(calls.some(c => c.url === '/bond-desk/connect/refresh')).toBe(true);
    fireEvent.changeText(screen.getByTestId('invite-email'), 'new@x.test');
    fireEvent.press(screen.getByTestId('invite-send'));
    expect(await screen.findByTestId('invite-link')).toHaveTextContent(has('/bond-desk/join/x'));
  });
});

describe('Money tab: automatic payments', () => {
  const detailMocks = (autopay: unknown, connect: unknown = CONNECT_ON) => {
    on('get', '/bond-desk/bonds/7', DETAIL);   // registered first: later handlers win, and this one matches by prefix
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/bonds/7/autopay', autopay);
    on('get', '/bond-desk/connect', connect);
  };
  it('needs card payments first', async () => {
    detailMocks(AUTOPAY_NONE, CONNECT_NONE);
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'money' } } as never} />);
    expect(await screen.findByTestId('autopay-needs-connect')).toBeTruthy();
    expect(screen.getByTestId('payment-2')).toHaveTextContent(has(t('bdk_pay_source_autopay')));
  });
  it('texting the link needs the consent box; the link is shown once', async () => {
    detailMocks(AUTOPAY_NONE);
    on('post', '/bond-desk/bonds/7/autopay/link', { link: 'https://justicegavel.app/autopay/TOKEN', delivery: { sms: 'sent', email: null }, autopay: null });
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'money' } } as never} />);
    fireEvent.press(await screen.findByTestId('autopay-open'));
    fireEvent.press(screen.getByTestId('autopay-send'));
    expect(await screen.findByTestId('autopay-error')).toHaveTextContent(has(t('bdk_err_consent')));
    expect(calls.some(c => c.url === '/bond-desk/bonds/7/autopay/link')).toBe(false);
    fireEvent.press(screen.getByTestId('autopay-consent'));
    fireEvent.press(screen.getByTestId('autopay-send'));
    expect(await screen.findByTestId('autopay-link')).toHaveTextContent(has('/autopay/TOKEN'));
    expect(calls.find(c => c.url === '/bond-desk/bonds/7/autopay/link')?.data).toMatchObject({ to: 'defendant', deliver: 'sms', consent_confirmed: true, lang: 'en' });
  });
  it('active: card, plan-changed warning, attempts, stop', async () => {
    detailMocks({ ...AUTOPAY_NONE, plan_changed: true,
      autopay: { id: 3, status: 'active', payer_role: 'defendant', indemnitor_id: null, payer_name: 'Ana Lopez', payer_phone_masked: null, payer_email: null,
        card: { brand: 'visa', last4: '4242' }, consent_at: '2026-10-20T10:00:00Z', consent_version: 'autopay-2026-10', consent_schedule: [], link_expires_at: '', activated_at: '', stopped_at: null, stopped_by: null, stop_reason: null, created_at: '' },
      attempts: [{ id: 1, installment_id: 5, due_on: '2026-10-27', attempt: 1, amount_cents: 10000, fee_cents: 99, status: 'failed', failure_code: 'card_declined', failure_message: 'Your card was declined.', retry_on: '2026-10-30', payment_id: null, created_at: '' }] });
    on('post', '/bond-desk/bonds/7/autopay/stop', AUTOPAY_NONE);
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab: 'money' } } as never} />);
    expect(await screen.findByTestId('autopay-status')).toHaveTextContent(has('4242'));
    expect(screen.getByTestId('autopay-plan-changed')).toBeTruthy();
    expect(screen.getByTestId('autopay-attempt-1')).toHaveTextContent(has(t('bdk_ap_att_failed')));
    fireEvent.press(screen.getByTestId('autopay-stop'));
    await waitFor(() => expect(calls.some(c => c.url === '/bond-desk/bonds/7/autopay/stop')).toBe(true));
  });
});

describe("The payer's pages", () => {
  const TOKEN = 'A'.repeat(43);
  const VIEW = { enabled: true, agency: { name: 'Alpha Bail', phone: '615-555-0199' }, payer_name: 'Luis', defendant_name: 'Ana Lopez', status: 'link_sent', stopped_by: null, card: null,
    balance_cents: 20000, schedule: [{ due_on: '2026-11-27', amount_cents: 20000 }], consent: { version: 'autopay-2026-10', lang: 'en', text: 'I authorize Alpha Bail…\nAll payments are final.' },
    action_needed: null, can_start: true };
  it('consent shown verbatim; nothing starts until I agree; then Stripe Checkout', async () => {
    on('get', `/bd-pay/autopay/${TOKEN}`, VIEW);
    on('post', `/bd-pay/autopay/${TOKEN}/start`, { url: 'https://checkout.stripe.com/c/pay/cs_1' });
    wrap(<AutopayLinkScreen navigation={makeNavigation()} route={{ params: { token: TOKEN } } as never} />);
    expect(await screen.findByTestId('autopay-link-consent-text')).toHaveTextContent(has('All payments are final.'));
    expect(disabled('autopay-link-start')).toBe(true);
    fireEvent.press(screen.getByTestId('autopay-link-agree'));
    fireEvent.press(screen.getByTestId('autopay-link-start'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1'));
    expect(calls.find(c => c.url.endsWith('/start'))?.data).toMatchObject({ agree: true, consent_version: 'autopay-2026-10' });
  });
  it('active with a payment to confirm; stop', async () => {
    on('get', `/bd-pay/autopay/${TOKEN}`, { ...VIEW, status: 'active', card: { brand: 'visa', last4: '4242' }, action_needed: { amount_cents: 12000, due_on: '2026-10-27' } });
    on('post', `/bd-pay/autopay/${TOKEN}/confirm`, { url: 'https://checkout.stripe.com/c/pay/cs_2' });
    on('post', `/bd-pay/autopay/${TOKEN}/stop`, { ...VIEW, status: 'stopped', stopped_by: 'payer' });
    wrap(<AutopayLinkScreen navigation={makeNavigation()} route={{ params: { token: TOKEN } } as never} />);
    expect(await screen.findByTestId('autopay-link-action')).toHaveTextContent(has('$120.00'));
    fireEvent.press(screen.getByTestId('autopay-link-confirm'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_2'));
    fireEvent.press(screen.getByTestId('autopay-link-stop'));
    expect(await screen.findByTestId('autopay-link-stopped')).toBeTruthy();
  });
  it('a bad link says so', async () => {
    wrap(<AutopayLinkScreen navigation={makeNavigation()} route={{ params: { token: 'short' } } as never} />);
    expect(await screen.findByTestId('autopay-link-error')).toHaveTextContent(has(t('apl_link_invalid')));
  });
  it('pay page: checks before sending, then Checkout with exact cents', async () => {
    on('get', '/bd-pay/agency/abcdefghjk23', { agency: { name: 'Alpha Bail', phone: null, license: 'TN-1' }, available: true, min_cents: 100, max_cents: 5000000 });
    on('post', '/bd-pay/agency/abcdefghjk23/checkout', { url: 'https://checkout.stripe.com/c/pay/cs_3' });
    wrap(<AgencyPayScreen navigation={makeNavigation()} route={{ params: { slug: 'abcdefghjk23' } } as never} />);
    fireEvent.changeText(await screen.findByTestId('apy-amount'), '0.50');
    fireEvent.press(screen.getByTestId('apy-pay'));
    expect(await screen.findByTestId('apy-error')).toHaveTextContent(has(t('apy_err_amount', { min: '$1.00', max: '$50,000.00' })));
    fireEvent.changeText(screen.getByTestId('apy-amount'), '250.10');
    fireEvent.changeText(screen.getByTestId('apy-payer'), 'Pat Payer');
    fireEvent.changeText(screen.getByTestId('apy-phone'), '615-555-0150');
    fireEvent.changeText(screen.getByTestId('apy-defendant'), 'Sam Stone');
    fireEvent.press(screen.getByTestId('apy-text-receipt'));
    fireEvent.press(screen.getByTestId('apy-pay'));
    expect(await screen.findByTestId('apy-error')).toHaveTextContent(has(t('apy_err_agree')));
    fireEvent.press(screen.getByTestId('apy-agree'));
    fireEvent.press(screen.getByTestId('apy-pay'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_3'));
    expect(calls.find(c => c.url.endsWith('/checkout'))?.data).toMatchObject({ amount_cents: 25010, payer_phone: '615-555-0150', receipt_by_text: true, agree_final: true });
  });
});

describe('Import, staff invitation, forms set-up', () => {
  it('rows with problems block the import; a clean file imports', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///b.csv', name: 'b.csv', size: 100 }] });
    let clean = false;
    on('post', '/bond-desk/import', { imported: 1, bond_ids: [40] });   // first: '/bond-desk/import/preview' below must win the prefix match
    on('post', '/bond-desk/import/preview', () => Promise.resolve({ data: clean
      ? { rows: [{ line: 2, values: { defendant_name: 'A', bond_amount: 10000 }, errors: [] }], total: 1, valid: 1, invalid: 0, file_errors: [], unknown_columns: [] }
      : { rows: [{ line: 2, values: { defendant_name: 'A' }, errors: [{ field: 'bond_amount', code: 'required' }] }], total: 1, valid: 0, invalid: 1, file_errors: [], unknown_columns: ['notes'] } }));
    wrap(<BondImportScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    fireEvent.press(screen.getByTestId('import-pick'));
    expect(await screen.findByTestId('import-row-2')).toHaveTextContent(has(t('bdk_imp_err_required')));
    expect(disabled('import-go')).toBe(true);
    clean = true;
    fireEvent.press(screen.getByTestId('import-pick'));
    await waitFor(() => expect(disabled('import-go')).toBe(false));
    fireEvent.press(screen.getByTestId('import-go'));
    expect(await screen.findByTestId('import-done')).toHaveTextContent(has(t('bdk_imp_done', { n: 1 })));
  });

  it('an invitation for another e-mail cannot be accepted', async () => {
    on('get', '/bond-desk/staff/invite/', { agency: 'Alpha Bail', email: 'kim@x.test', email_matches: false, expires_at: '' });
    wrap(<StaffJoinScreen navigation={makeNavigation()} route={{ params: { token: 'T'.repeat(43) } } as never} />);
    expect(await screen.findByTestId('staff-join-other-email')).toHaveTextContent(has('kim@x.test'));
    expect(disabled('staff-join-accept')).toBe(true);
  });

  it('admin: start a request, open the forms tool, hand over', async () => {
    mockUser = { id: 1, role: 'admin' };
    const row = { id: 5, status: 'in_progress', note: 'Our forms', staff_note: null, created_at: '', started_at: '', ready_at: null, cancelled_at: null, forms: [],
      agent_id: 9, agency: 'Alpha Bail', agent_email: 'a@x.test', form_count: 2, handled_by_name: null };
    on('get', '/admin/bd-setup', { requests: [row, { ...row, id: 6, status: 'requested' }] });
    on('post', '/admin/bd-setup/6/start', { request: { ...row, id: 6 } });
    on('post', '/admin/bd-setup/5/ready', { request: { ...row, status: 'ready' } });
    const nav = makeNavigation();
    wrap(<AdminFormsSetupScreen navigation={nav} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('setup-start-6'));
    await waitFor(() => expect(calls.some(c => c.url === '/admin/bd-setup/6/start')).toBe(true));
    fireEvent.press(screen.getByTestId('setup-tool-5'));
    expect(nav.navigate).toHaveBeenCalledWith('BondForms', { setupRequestId: 5, agency: 'Alpha Bail' });
    fireEvent.changeText(screen.getByTestId('setup-note-5'), 'Mapped');
    fireEvent.press(screen.getByTestId('setup-ready-5'));
    await waitFor(() => expect(calls.find(c => c.url === '/admin/bd-setup/5/ready')?.data).toEqual({ note: 'Mapped' }));
  });
});
