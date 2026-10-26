/**
 * Render tests: Bond Desk (bail agents) — docs/BOND_DESK.md.
 *
 *   - Access: an agent without a plan sees the plans prompt, a non-agent sees what it is for.
 *   - Dashboard tiles and the bond list come from the server; a new bond is validated
 *     (name, exact cents) before it is sent.
 *   - Money: a payment above the balance is refused before sending; the payment-plan editor
 *     cannot save until the installments add up exactly to the charges.
 *   - Status: a forfeiture needs its deadline.
 *   - Paperwork: texting the link needs the consent box; the links come back once with copy.
 *   - Forms: a PDF text field is mapped to a case-file value and saved.
 *   - Powers: a range over 500 is refused; reports format the server's cents.
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
  getItem: jest.fn(() => Promise.resolve(JSON.stringify({ id: 9, accountType: 'bail_agent' }))),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});
jest.mock('../../components/AuthGate', () => ({
  __esModule: true,
  useAuthGate: () => ({ requireAuth: (fn: () => void) => fn(), AuthGateModal: () => null }),
}));
jest.mock('expo-clipboard', () => ({ __esModule: true, setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })) }));
const mockFetchFile = jest.fn((..._a: unknown[]) => Promise.resolve('view'));
jest.mock('../../services/fileDownload', () => ({ __esModule: true, fetchFile: (...a: unknown[]) => mockFetchFile(...a), appendPicked: jest.fn() }));

import BondDeskScreen from '../../screens/BondDeskScreen';
import BondDetailScreen from '../../screens/BondDetailScreen';
import BondFormsScreen from '../../screens/BondFormsScreen';
import PowersScreen, { rangeBody } from '../../screens/PowersScreen';
import BondReportsScreen from '../../screens/BondReportsScreen';
import { apiMock, makeNavigation } from './apiMock';
import { checkPlan, parseCents, splitPlan } from '../../services/bondDesk';

const { on, reject, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const ACCESS = { allowed: true, reason: null, plan: 'starter', texts_live: true, email_live: true, storage_live: true, text_cents: 5 };
const disabled = (id: string) => !!screen.getByTestId(id).props.accessibilityState?.disabled;
const has = (x: string) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const BOND = {
  id: 7, status: 'active', defendant_name: 'Ana Lopez', defendant_dob: null, defendant_phone: '+16155550100', defendant_email: 'ana@example.test',
  defendant_address: null, case_number: 'GS-1', court_name: 'Davidson General Sessions', county: 'Davidson', state: 'TN', court_date: '2026-12-01',
  charges: null, bond_amount_cents: 500000, surety_name: 'Acme Surety', posted_on: '2026-10-20', forfeited_on: null, forfeiture_deadline_on: null,
  discharged_on: null, forfeiture_paid_cents: null, checkin_enrollment_id: null, notes: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', power: null,
};
const detail = (over: Record<string, unknown> = {}) => ({
  bond: BOND, indemnitors: [{ id: 3, bond_id: 7, full_name: 'Luis Lopez', relationship: 'Brother', phone: '+16155550101', email: null, address: null, dob: null, employer: null, created_at: '' }],
  charges: [{ id: 1, kind: 'premium', amount_cents: 50000, description: '10%', created_at: '', voided_at: null, void_reason: null }],
  payments: [{ id: 2, receipt_no: 'R-000001', amount_cents: 10000, method: 'cash', reference: null, payer_name: 'Luis Lopez', received_on: '2026-10-20', created_at: '', voided_at: null, void_reason: null }],
  installments: [], collateral: [], packets: [],
  money: { charged_cents: 50000, paid_cents: 10000, balance_cents: 40000, plan_scheduled_cents: 0, plan_in_sync: true, overdue_cents: 0, next_due: null },
  ...over,
});

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  reset(); mockFetchFile.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[buttons.length - 1]?.onPress?.(); });
});
afterEach(() => alertSpy.mockRestore());

describe('money helpers are exact', () => {
  it('parses dollars to cents without floating point and splits plans to the cent', () => {
    expect(parseCents('1,234.5')).toBe(123450);
    expect(parseCents('$0.29')).toBe(29);
    expect(parseCents('19.999')).toBeNull();
    expect(parseCents('abc')).toBeNull();
    const rows = splitPlan(100000, 3, '2026-11-01', 30);
    expect(rows.map(r => r.amount)).toEqual(['333.34', '333.33', '333.33']);
    expect(rows.map(r => r.due_on)).toEqual(['2026-11-01', '2026-12-01', '2026-12-31']);
    expect(checkPlan(rows, 100000).ok).toBe(true);
    expect(checkPlan(rows, 100001)).toMatchObject({ ok: false, error: 'total' });
  });
});

describe('Bond Desk access and dashboard', () => {
  it('an agent without a plan is sent to the bail-agent plans', async () => {
    on('get', '/bond-desk/access', { ...ACCESS, allowed: false, reason: 'no_plan', plan: null });
    const nav = makeNavigation();
    wrap(<BondDeskScreen navigation={nav} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('bond-desk-plans'));
    expect(nav.navigate).toHaveBeenCalledWith('Subscription', undefined);
    expect(calls.some(c => c.url === '/bond-desk/dashboard')).toBe(false);
  });

  it('a non-agent account sees what the desk is for', async () => {
    on('get', '/bond-desk/access', { ...ACCESS, allowed: false, reason: 'not_agent', plan: null });
    wrap(<BondDeskScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('bond-desk-not-agent')).toBeTruthy();
  });

  it('shows the server totals, the bond list, and validates a new bond before saving it', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/dashboard', {
      counts: { prospect: 1, active: 4, forfeited: 1 }, liability_cents: 2500000, receivable_cents: 123456, overdue_cents: 20000,
      overdue: [{ bond_id: 7, defendant_name: 'Ana Lopez', due_on: '2026-10-01', amount_due_cents: 20000 }],
      forfeitures: [{ bond_id: 8, defendant_name: 'Ben Ray', deadline_on: '2026-11-05', days_left: 10 }],
      awaiting_signature: [], texts_this_month: { count: 12, cents: 60 },
    });
    on('get', '/bond-desk/bonds', { bonds: [{ ...BOND, balance_cents: 40000, packet_status: null }] });
    on('post', '/bond-desk/bonds', { bond: { ...BOND, id: 11 } });
    const nav = makeNavigation();
    wrap(<BondDeskScreen navigation={nav} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('tile-liability')).toHaveTextContent(has(usd(2500000)));
    expect(screen.getByTestId('tile-receivable')).toHaveTextContent(has(usd(123456)));
    expect(screen.getByTestId('bond-desk-forfeitures')).toHaveTextContent(has('Ben Ray'));
    expect(await screen.findByTestId('bond-row-7')).toHaveTextContent(has('Ana Lopez'));

    fireEvent.press(screen.getByTestId('bond-desk-new'));
    fireEvent.changeText(screen.getByTestId('bond-f-bond_amount'), '2500.505');
    fireEvent.press(screen.getByTestId('bond-new-save'));
    expect(await screen.findByTestId('bond-new-error')).toHaveTextContent(has(t('bdk_err_name')));
    fireEvent.changeText(screen.getByTestId('bond-f-defendant_name'), 'Cara Diaz');
    fireEvent.press(screen.getByTestId('bond-new-save'));
    expect(await screen.findByText(t('bdk_err_amount'))).toBeTruthy();
    expect(calls.some(c => c.method === 'post' && c.url === '/bond-desk/bonds')).toBe(false);
    fireEvent.changeText(screen.getByTestId('bond-f-bond_amount'), '2,500.50');
    fireEvent.changeText(screen.getByTestId('bond-f-state'), 'tn');
    fireEvent.press(screen.getByTestId('bond-new-save'));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('BondDetail', { bondId: 11 }));
    const post = calls.find(c => c.method === 'post' && c.url === '/bond-desk/bonds');
    expect(post?.data).toMatchObject({ defendant_name: 'Cara Diaz', bond_amount_cents: 250050, state: 'TN' });
  });
});

describe('bond detail', () => {
  const open = async (over?: Record<string, unknown>, tab?: string) => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/bonds/7', detail(over));
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7, tab } } as never} />);
    await screen.findByTestId('bond-tab-overview');
  };

  it('money: refuses a payment above the balance, records one within it', async () => {
    on('post', '/bond-desk/bonds/7/payments', { payment: { id: 5, receipt_no: 'R-000002' } });
    await open(undefined, 'money');
    expect(screen.getByTestId('money-balance')).toHaveTextContent(has(usd(40000)));
    fireEvent.press(screen.getByTestId('payment-add'));
    fireEvent.changeText(screen.getByTestId('payment-amount'), '400.01');
    fireEvent.changeText(screen.getByTestId('payment-payer'), 'Luis Lopez');
    fireEvent.press(screen.getByTestId('payment-save'));
    expect(await screen.findByTestId('payment-error')).toHaveTextContent(has(t('bdk_err_over_balance', { balance: usd(40000) })));
    expect(calls.some(c => c.url === '/bond-desk/bonds/7/payments')).toBe(false);
    fireEvent.changeText(screen.getByTestId('payment-amount'), '400');
    fireEvent.press(screen.getByTestId('payment-method-check'));
    fireEvent.press(screen.getByTestId('payment-save'));
    await waitFor(() => expect(calls.find(c => c.url === '/bond-desk/bonds/7/payments')?.data).toMatchObject({ amount_cents: 40000, method: 'check', payer_name: 'Luis Lopez' }));
  });

  it('money: the plan editor only saves when the installments add up to the charges', async () => {
    on('put', '/bond-desk/bonds/7/plan', { ok: true });
    await open(undefined, 'money');
    fireEvent.press(screen.getByTestId('plan-edit'));
    fireEvent.press(screen.getByTestId('plan-add-row'));
    fireEvent.changeText(screen.getByTestId('plan-due-0'), '2026-11-01');
    fireEvent.changeText(screen.getByTestId('plan-amt-0'), '250');
    fireEvent.press(screen.getByTestId('plan-add-row'));
    fireEvent.changeText(screen.getByTestId('plan-due-1'), '2026-12-01');
    fireEvent.changeText(screen.getByTestId('plan-amt-1'), '249.99');
    expect(disabled('plan-save')).toBe(true);
    fireEvent.press(screen.getByTestId('plan-save'));
    expect(calls.some(c => c.method === 'put')).toBe(false);
    fireEvent.changeText(screen.getByTestId('plan-amt-1'), '250');
    expect(disabled('plan-save')).toBe(false);
    fireEvent.press(screen.getByTestId('plan-save'));
    await waitFor(() => expect(calls.find(c => c.method === 'put')?.data).toEqual({ installments: [
      { due_on: '2026-11-01', amount_cents: 25000 }, { due_on: '2026-12-01', amount_cents: 25000 },
    ] }));
  });

  it('status: a forfeiture needs the deadline', async () => {
    on('post', '/bond-desk/bonds/7/status', { bond: BOND });
    await open();
    fireEvent.press(screen.getByTestId('bond-move-forfeited'));
    fireEvent.press(screen.getByTestId('bond-move-save'));
    expect(await screen.findByTestId('bond-move-error')).toHaveTextContent(has(t('bdk_err_deadline')));
    fireEvent.changeText(screen.getByTestId('bond-move-date'), '2026-10-25');
    fireEvent.changeText(screen.getByTestId('bond-move-deadline'), '2027-04-23');
    fireEvent.press(screen.getByTestId('bond-move-save'));
    await waitFor(() => expect(calls.find(c => c.url === '/bond-desk/bonds/7/status')?.data).toMatchObject({ status: 'forfeited', date: '2026-10-25', deadline_on: '2027-04-23' }));
  });

  it('a final status offers no moves', async () => {
    await open({ bond: { ...BOND, status: 'exonerated' } });
    expect(screen.getByTestId('bond-status-final')).toBeTruthy();
  });

  it('paperwork: texting needs consent; the signing links come back once with a copy button', async () => {
    on('get', '/bond-desk/forms', { forms: [{ id: 21, name: 'Indemnity agreement', page_count: 2, roles: ['indemnitor'], fields: [], field_map: {}, archived: false, created_at: '' }], data_keys: [] });
    on('post', '/bond-desk/bonds/7/packets', { packet: { id: 40 }, signers: [{ id: 51, name: 'Luis Lopez', role: 'indemnitor', link: 'https://justicegavel.app/sign/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', delivery: { sms: 'sent', email: null } }] });
    await open(undefined, 'paperwork');
    fireEvent.press(screen.getByTestId('packet-compose'));
    fireEvent.press(await screen.findByTestId('packet-form-21'));
    fireEvent.press(screen.getByTestId('packet-signer-defendant'));   // off
    fireEvent.press(screen.getByTestId('packet-signer-3'));
    fireEvent.press(screen.getByTestId('packet-deliver-sms'));
    fireEvent.press(screen.getByTestId('packet-send'));
    expect(await screen.findByTestId('packet-error')).toHaveTextContent(has(t('bdk_err_consent')));
    expect(calls.some(c => c.url === '/bond-desk/bonds/7/packets')).toBe(false);
    fireEvent.press(screen.getByTestId('packet-consent'));
    fireEvent.press(screen.getByTestId('packet-send'));
    expect(await screen.findByTestId('packet-link-51')).toHaveTextContent(has('/sign/abcdefghij'));
    expect(calls.find(c => c.url === '/bond-desk/bonds/7/packets')?.data).toMatchObject({
      form_ids: [21], signers: [{ role: 'indemnitor', indemnitor_id: 3 }], deliver: 'sms', consent_confirmed: true,
    });
    fireEvent.press(screen.getByTestId('packet-copy-51'));
    const Clipboard = jest.requireMock('expo-clipboard') as { setStringAsync: jest.Mock };
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://justicegavel.app/sign/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'));
  });

  it('a 403 no_plan on the bond shows the plans prompt', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/bonds/7', () => Promise.reject(reject(403, { error: 'Plan needed', code: 'no_plan' })));
    wrap(<BondDetailScreen navigation={makeNavigation()} route={{ params: { bondId: 7 } } as never} />);
    expect(await screen.findByTestId('bond-desk-no-plan')).toBeTruthy();
  });
});

describe('forms, powers, reports', () => {
  it('maps a PDF text field to a case-file value and saves it', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/forms', { forms: [{ id: 21, name: 'Application', page_count: 1, roles: ['defendant'], fields: [{ name: 'DefName', type: 'text' }, { name: 'Agree', type: 'checkbox' }], field_map: {}, archived: false, created_at: '' }] });
    on('patch', '/bond-desk/forms/21', { form: { id: 21, name: 'Application', page_count: 1, roles: ['defendant'], fields: [{ name: 'DefName', type: 'text' }], field_map: { DefName: 'bond.defendant_name' }, archived: false, created_at: '' } });
    wrap(<BondFormsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('form-21'));
    expect(screen.getByTestId('form-field-DefName')).toHaveTextContent(has(t('bdk_not_filled')));
    expect(screen.queryByTestId('form-field-Agree')).toBeNull();
    fireEvent.press(screen.getByTestId('form-field-DefName'));
    fireEvent.press(await screen.findByTestId('data-key-bond.defendant_name'));
    expect(screen.getByTestId('form-field-DefName')).toHaveTextContent(has(t('bdk_dk_bond_defendant_name')));
    fireEvent.press(screen.getByTestId('form-save'));
    await waitFor(() => expect(calls.find(c => c.method === 'patch')?.data).toEqual({ name: 'Application', roles: ['defendant'], field_map: { DefName: 'bond.defendant_name' } }));
  });

  it('powers: a range over 500 is refused before sending', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/powers', { powers: [{ id: 1, surety_name: 'Acme', number: 'S-100', limit_cents: 1000000, status: 'available' }], sureties: ['Acme'] });
    wrap(<PowersScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('power-1')).toHaveTextContent(has(usd(1000000)));
    fireEvent.press(screen.getByTestId('powers-add'));
    fireEvent.changeText(screen.getByTestId('powers-surety'), 'Acme');
    fireEvent.changeText(screen.getByTestId('powers-start'), '1');
    fireEvent.changeText(screen.getByTestId('powers-end'), '501');
    fireEvent.changeText(screen.getByTestId('powers-limit'), '10000');
    fireEvent.press(screen.getByTestId('powers-save'));
    expect(await screen.findByTestId('powers-error')).toHaveTextContent(has(t('bdk_err_range_size')));
    expect(calls.some(c => c.method === 'post')).toBe(false);
  });

  it('reports: shows the server sums as money and exports CSV', async () => {
    on('get', '/bond-desk/access', ACCESS);
    on('get', '/bond-desk/reports/liability', { total_cents: 1500000, by_surety: [{ surety_name: 'Acme', bonds: 3, amount_cents: 1500000 }], bonds: [] });
    wrap(<BondReportsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('report-total-total_cents')).toHaveTextContent(has(usd(1500000)));
    expect(screen.getByTestId('report-table-by_surety')).toHaveTextContent(has('Acme'));
    fireEvent.press(screen.getByTestId('report-csv'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith(expect.stringMatching(/^\/bond-desk\/reports\/liability\?format=csv$/), expect.stringMatching(/\.csv$/), 'text/csv'));
  });
});

describe('power ranges keep the surety\'s zero padding', () => {
  it('sends start / end exactly as typed', () => {
    const r = rangeBody({ surety: 'Acme', prefix: 'S25-', start: '000101', end: '000150', limit: '15000', received: '2026-10-01', expires: '' });
    expect(r.body).toMatchObject({ start: '000101', end: '000150', limit_cents: 1500000 });
    expect(r.count).toBe(50);
    expect(rangeBody({ surety: 'Acme', prefix: '', start: '9', end: '3', limit: '1', received: '2026-10-01', expires: '' }).error).toBe('bdk_err_range');
  });
});
