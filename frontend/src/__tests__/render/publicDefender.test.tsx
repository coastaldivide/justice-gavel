/**
 * Render tests: the public defender channel (A11, ⚖ PUBLIC_DEFENDER_CHANNEL_ENABLED).
 *
 *   - Home card: only for office members, only while the setting is on; unread count
 *   - Office dashboard: consent statement (admin ticks it; staff wait), baseline vs pilot with the
 *     rate definition and the "no claim about cause" line, appearance per month, export; setting off
 *   - Clients: list, add one by one, open the CSV upload; not a member
 *   - CSV upload: per-row errors block the import; a clean file imports all at once
 *   - Client: court dates with status buttons, the texts of a hearing, the conversation, reply, handled
 *   - Inbox: open conversations with unread counts
 *   - Staff: seats, invite (admin only)
 *   - Admin: create an office, preview and create the annual invoice (texts included)
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
  getItem: jest.fn(() => Promise.resolve(JSON.stringify({ id: 1 }))),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) };
});
const mockPick = jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///c.csv', name: 'clients.csv', size: 100 }] }));
jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: () => mockPick() }));
const mockFetchFile = jest.fn((..._a: unknown[]) => Promise.resolve('download'));
jest.mock('../../services/fileDownload', () => ({ __esModule: true, fetchFile: (...a: unknown[]) => mockFetchFile(...a), appendPicked: jest.fn(() => Promise.resolve()) }));

import PdOfficeScreen from '../../screens/PdOfficeScreen';
import PdClientsScreen from '../../screens/PdClientsScreen';
import PdImportScreen from '../../screens/PdImportScreen';
import PdClientScreen from '../../screens/PdClientScreen';
import PdInboxScreen from '../../screens/PdInboxScreen';
import PdStaffScreen from '../../screens/PdStaffScreen';
import AdminPdOfficesScreen from '../../screens/AdminPdOfficesScreen';
import { PdHomeCard } from '../../components/publicDefender/PdParts';
import { apiMock, makeNavigation } from './apiMock';

const { on, reject, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const has = (x: string) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const OFFICE = {
  id: 3, name: 'Metro Nashville Public Defender', county: 'Davidson', state: 'TN', phone: '+16155550190', seat_limit: 5, billing_email: 'b@x.test',
  status: 'active', created_at: '', pilot_start: '2026-09-01', baseline: null, consent: null,
};
const DASH = (over: Record<string, unknown> = {}) => ({
  office: OFFICE, today: '2026-10-27', clients: 4, upcoming_30_days: 2, unread: 3, opt_outs: 1, rate_definition: 'attended / (attended + missed)',
  upcoming: [{ court_date_id: 9, court_date: '2026-11-03', court_time: '09:30', court_name: 'General Sessions', client_id: 21, name: 'Ana Lopez', case_number: 'GS-100' }],
  appearance: [{ month: '2026-10', hearings: 4, asked: 3, attended: 2, rescheduled: 1, missed: 1, no_answer: 0, appearance_rate: 66.7 }],
  pilot: { since: '2026-09-01', hearings: 4, asked: 3, attended: 2, rescheduled: 1, missed: 1, no_answer: 0, appearance_rate: 66.7 },
  baseline: { from: '2026-06-01', to: '2026-08-31', hearings: 200, appeared: 150, missed: 40, source: 'CMS report', set_at: '', appearance_rate: 78.9 },
  messages: [{ month: '2026-10', sent: 20, failed: 0, staff_replies: 2, received: 5 }], ...over,
});
const CLIENT = { id: 21, name: 'Ana Lopez', phone: '+16155550401', lang: 'es', case_number: 'GS-100', email: null, reminders_on: true, opted_out: false,
  created_at: '', last_message_at: null, next_court_date: '2026-11-03', unread: 2 };

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  reset(); mockNavigate.mockClear(); mockFetchFile.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[buttons.length - 1]?.onPress?.(); });
});
afterEach(() => alertSpy.mockRestore());

describe('home card', () => {
  it('shows for an office member with the unread count', async () => {
    on('get', '/pd/status', { enabled: true, member: { office_id: 3, office: 'Metro Nashville Public Defender', role: 'staff', unread: 4 }, texts_live: true });
    wrap(<PdHomeCard navigation={{ navigate: mockNavigate }} />);
    expect(await screen.findByTestId('pd-home-card', {}, { timeout: 5000 })).toHaveTextContent(has(t('pd_unread_n', { n: 4 })));
    fireEvent.press(screen.getByTestId('pd-home-inbox'));
    expect(mockNavigate).toHaveBeenCalledWith('PdInbox');
  });
  it('is hidden for everyone else and while the setting is off', async () => {
    on('get', '/pd/status', { enabled: true, member: null, texts_live: true });
    wrap(<PdHomeCard navigation={{ navigate: mockNavigate }} />);
    await waitFor(() => expect(calls.some(c => c.url === '/pd/status')).toBe(true));
    expect(screen.queryByTestId('pd-home-card')).toBeNull();
    reset();
    on('get', '/pd/status', { enabled: false, member: null, texts_live: true });
    wrap(<PdHomeCard navigation={{ navigate: mockNavigate }} />);
    await waitFor(() => expect(calls.some(c => c.url === '/pd/status')).toBe(true));
    expect(screen.queryByTestId('pd-home-card')).toBeNull();
  });
});

describe('office dashboard', () => {
  it('an office admin ticks the consent statement; baseline vs pilot shows the definition and no claim about cause', async () => {
    on('get', '/pd/dashboard', DASH());
    on('get', '/pd/office', { role: 'admin', consent_statement: t('pd_consent_statement'), texts_live: true, office: OFFICE });
    on('post', '/pd/office/consent', { office: OFFICE });
    on('get', '/pd/export.zip', {});
    wrap(<PdOfficeScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('pd-baseline-rate')).toHaveTextContent(/78\.9%/);
    expect(screen.getByTestId('pd-pilot-rate')).toHaveTextContent(/66\.7%/);
    expect(screen.getByTestId('pd-compare')).toHaveTextContent(has(t('pd_rate_definition')));
    expect(screen.getByTestId('pd-compare')).toHaveTextContent(has(t('pd_no_claim')));
    expect(screen.getByTestId('pd-month-2026-10')).toHaveTextContent(has(t('pd_month_counts', { h: 4, a: 2, r: 1, m: 1, n: 0 })));
    await waitFor(() => expect(screen.getByTestId('pd-consent-check')).toBeTruthy());
    expect(screen.getByTestId('pd-consent-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('pd-consent-check'));
    fireEvent.press(screen.getByTestId('pd-consent-save'));
    await waitFor(() => expect(calls.some(c => c.method === 'post' && c.url === '/pd/office/consent' && (c.data as { agree: boolean }).agree === true)).toBe(true));
    fireEvent.press(screen.getByTestId('pd-export'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('/pd/export.zip', 'public-defender-export-2026-10-27.zip', 'application/zip'));
  });
  it('staff wait for an office admin; a recorded consent shows who and when', async () => {
    on('get', '/pd/dashboard', DASH());
    on('get', '/pd/office', { role: 'staff', consent_statement: '', texts_live: false, office: OFFICE });
    wrap(<PdOfficeScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('pd-consent')).toHaveTextContent(has(t('pd_consent_wait_admin')));
    expect(await screen.findByTestId('pd-texts-not-live')).toBeTruthy();
    expect(screen.queryByTestId('pd-baseline-edit')).toBeNull();
  });
  it('setting off and not a member', async () => {
    on('get', '/pd/dashboard', () => Promise.reject(reject(503, { code: 'feature_unavailable', error: 'off' })));
    on('get', '/pd/office', () => Promise.reject(reject(503, { code: 'feature_unavailable', error: 'off' })));
    wrap(<PdOfficeScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('pd-off')).toBeTruthy();
    reset();
    on('get', '/pd/clients', () => Promise.reject(reject(403, { code: 'not_member', error: 'no' })));
    wrap(<PdClientsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('pd-not-member')).toBeTruthy();
  });
});

describe('clients and upload', () => {
  it('lists clients, adds one, opens the upload', async () => {
    on('get', '/pd/clients', { clients: [CLIENT], page: 1, page_size: 50, total: 1 });
    on('post', '/pd/clients', { client: { ...CLIENT, id: 22 }, court_dates: [] });
    const nav = makeNavigation();
    wrap(<PdClientsScreen navigation={nav} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('pd-client-21')).toHaveTextContent(has(t('pd_unread_n', { n: 2 })));
    fireEvent.press(screen.getByTestId('pd-add-toggle'));
    fireEvent.changeText(screen.getByTestId('pd-add-name'), 'Ben Okafor');
    fireEvent.changeText(screen.getByTestId('pd-add-phone'), '615-555-0402');
    fireEvent.press(screen.getByTestId('pd-add-lang-vi'));
    fireEvent.changeText(screen.getByTestId('pd-add-case'), 'GS-200');
    fireEvent.changeText(screen.getByTestId('pd-add-date'), '2026-11-10');
    fireEvent.press(screen.getByTestId('pd-add-save'));
    await waitFor(() => expect(calls.find(c => c.method === 'post' && c.url === '/pd/clients')?.data).toEqual({
      name: 'Ben Okafor', phone: '615-555-0402', lang: 'vi', case_number: 'GS-200', court_dates: [{ court_date: '2026-11-10', court_time: null, court_name: null }] }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('PdClient', { clientId: 22 }));
    fireEvent.press(screen.getByTestId('pd-open-import'));
    expect(nav.navigate).toHaveBeenCalledWith('PdImport');
  });
  it('per-row errors block the import; a clean file imports in one go', async () => {
    on('post', '/pd/clients/import/preview', { total: 2, valid: 1, invalid: 1, adds: 1, updates: 0, file_errors: [], unknown_columns: [],
      rows: [{ line: 2, values: { name: 'Ana' }, errors: [], action: 'add' }, { line: 3, values: { name: 'Bad' }, errors: [{ field: 'phone', code: 'bad_phone' }], action: null }] });
    wrap(<PdImportScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    fireEvent.press(screen.getByTestId('pd-import-pick'));
    expect(await screen.findByTestId('pd-import-row-3')).toHaveTextContent(has(`${t('pd_col_phone')}: ${t('pd_imp_err_bad_phone')}`));
    expect(screen.getByTestId('pd-import-go')).toBeDisabled();
    on('post', '/pd/clients/import/preview', { total: 1, valid: 1, invalid: 0, adds: 0, updates: 1, file_errors: [], unknown_columns: [],
      rows: [{ line: 2, values: { name: 'Ana' }, errors: [], action: 'update' }] });
    on('post', /^\/pd\/clients\/import$/, { imported: 1, added: 0, updated: 1, court_dates_added: 1, court_dates_removed: 1 });
    fireEvent.press(screen.getByTestId('pd-import-pick'));
    await waitFor(() => expect(screen.getByTestId('pd-import-go')).not.toBeDisabled());
    expect(screen.getByTestId('pd-import-summary')).toHaveTextContent(has(t('pd_imp_summary', { total: 1, valid: 1, invalid: 0, adds: 0, updates: 1 })));
    fireEvent.press(screen.getByTestId('pd-import-go'));
    expect(await screen.findByTestId('pd-import-done')).toHaveTextContent(has(t('pd_imp_done_detail', { added: 0, updated: 1, dadd: 1, drem: 1 })));
  });
});

describe('client, inbox, staff', () => {
  it('court dates, their texts, the conversation, reply and handled', async () => {
    on('get', '/pd/clients/21', { client: CLIENT, court_dates: [{ id: 9, court_date: '2026-11-03', court_time: '09:30', court_name: 'General Sessions', room: '2A',
      status: 'scheduled', status_source: null, status_at: null, asked_at: null,
      texts: [{ step: 'd7', send_at: '2026-10-27T14:00:00Z', status: 'sent', reason: null, sent_at: '2026-10-27T14:00:00Z', delivery: 'delivered' }] }] });
    on('get', '/pd/clients/21/messages', { messages: [
      { id: 7, direction: 'in', kind: 'inbound', body: 'Can I get a ride?', status: 'received', delivery: null, created_at: '2026-10-27T15:00:00Z', sent_by_name: null },
      { id: 6, direction: 'out', kind: 'reminder', body: 'Metro Nashville Public Defender: Ana, tiene corte…', status: 'sent', delivery: 'delivered', created_at: '2026-10-27T14:00:00Z', sent_by_name: null },
    ], next_before: 6, handled: false });
    on('patch', '/pd/court-dates/9', {});
    on('post', '/pd/clients/21/messages', { message: { id: 8, status: 'sent' } });
    on('post', '/pd/clients/21/handled', { ok: true });
    wrap(<PdClientScreen navigation={makeNavigation()} route={{ params: { clientId: 21 } } as never} />);
    expect(await screen.findByTestId('pd-msg-7')).toHaveTextContent(/Can I get a ride\?/);
    expect(screen.getByTestId('pd-msg-6')).toHaveTextContent(/delivered/);
    fireEvent.press(screen.getByTestId('pd-cd-9-texts'));
    expect(screen.getByTestId('pd-cd-9')).toHaveTextContent(has(t('pd_step_d7')));
    fireEvent.press(screen.getByTestId('pd-cd-9-attended'));
    await waitFor(() => expect(calls.some(c => c.method === 'patch' && (c.data as { status: string })?.status === 'attended')).toBe(true));
    expect(screen.getByTestId('pd-send')).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('pd-reply'), 'Yes, call 211.');
    fireEvent.press(screen.getByTestId('pd-send'));
    await waitFor(() => expect(calls.some(c => c.method === 'post' && c.url === '/pd/clients/21/messages' && (c.data as { body: string }).body === 'Yes, call 211.')).toBe(true));
    fireEvent.press(screen.getByTestId('pd-handled'));
    await waitFor(() => expect(calls.some(c => c.url === '/pd/clients/21/handled' && (c.data as { handled: boolean }).handled === true)).toBe(true));
  });
  it('a client who replied STOP cannot be texted', async () => {
    on('get', '/pd/clients/21', { client: { ...CLIENT, opted_out: true }, court_dates: [] });
    on('get', '/pd/clients/21/messages', { messages: [], next_before: null, handled: true });
    wrap(<PdClientScreen navigation={makeNavigation()} route={{ params: { clientId: 21 } } as never} />);
    expect(await screen.findByTestId('pd-client-opted-out')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('pd-reply'), 'Hello');
    expect(screen.getByTestId('pd-send')).toBeDisabled();
  });
  it('the inbox lists open conversations with unread counts', async () => {
    on('get', '/pd/inbox', { conversations: [{ client_id: 21, name: 'Ana Lopez', case_number: 'GS-100', last_message_at: '2026-10-27T15:00:00Z',
      last_preview: 'Can I get a ride?', last_direction: 'in', unread: 2, opted_out: false, handled: false }], page: 1, page_size: 30, total: 1, unread_total: 2 });
    const nav = makeNavigation();
    wrap(<PdInboxScreen navigation={nav} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('pd-conv-21')).toHaveTextContent(has(t('pd_unread_n', { n: 2 })));
    expect(calls.find(c => c.url === '/pd/inbox')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pd-open-conv-21'));
    expect(nav.navigate).toHaveBeenCalledWith('PdClient', { clientId: 21 });
  });
  it('staff: seats and invitations (admin only)', async () => {
    on('get', '/pd/staff', { role: 'admin', seats: { limit: 5, used: 2, members: 2, pending: 0 },
      members: [{ user_id: 1, role: 'admin', email: 'a@x.test', name: 'Avery', added_at: '2026-10-01' }, { user_id: 2, role: 'staff', email: 's@x.test', name: 'Sam', added_at: '2026-10-02' }], invites: [] });
    on('post', '/pd/staff/invites', { link: 'https://justicegavel.app/pd/join/x', email_status: 'skipped', invite: { id: 1 } });
    wrap(<PdStaffScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('pd-seats')).toHaveTextContent(has(t('pd_seats', { used: 2, limit: 5 })));
    fireEvent.changeText(screen.getByTestId('pd-invite-email'), 'new@x.test');
    fireEvent.press(screen.getByTestId('pd-invite-send'));
    expect(await screen.findByTestId('pd-invite-link')).toHaveTextContent(/pd\/join\/x/);
    expect(calls.find(c => c.method === 'post' && c.url === '/pd/staff/invites')?.data).toEqual({ email: 'new@x.test', role: 'staff' });
  });
});

describe('Justice Gavel admin', () => {
  it('creates an office, previews and creates the annual invoice', async () => {
    on('get', '/admin/pd-offices', { offices: [{ ...OFFICE, members: 1, pending_invites: 0, clients: 4 }], prices: { setup_cents: 2000000, per_client_cents: 200 } });
    on('post', '/admin/pd-offices', { office: OFFICE, invite: { link: 'l', email_status: 'sent' } });
    on('get', '/admin/pd-offices/3', { office: OFFICE, seats: { limit: 5, used: 1, members: 1, pending: 0 }, members: [], invites: [], invoices: [] });
    on('get', '/admin/pd-offices/3/invoice-preview', { year: 2026, existing: null, active_clients: 4, setup_cents: 2000000, per_client_cents: 200, clients_cents: 800, amount_cents: 2000800, billing_email: 'b@x.test' });
    on('post', '/admin/pd-offices/3/invoices', { invoice: { id: 1 }, created: true });
    wrap(<AdminPdOfficesScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('admin-pd-prices')).toHaveTextContent(has(t('pd_adm_prices', { setup: '$20,000.00', per: '$2.00' })));
    fireEvent.press(screen.getByTestId('admin-pd-new'));
    fireEvent.changeText(screen.getByTestId('admin-pd-name'), 'Knox County PD');
    fireEvent.changeText(screen.getByTestId('admin-pd-admin-email'), 'head@knox.test');
    fireEvent.press(screen.getByTestId('admin-pd-create'));
    await waitFor(() => expect(calls.find(c => c.method === 'post' && c.url === '/admin/pd-offices')?.data).toMatchObject({ name: 'Knox County PD', admin_email: 'head@knox.test', state: 'TN', seat_limit: 5 }));
    fireEvent.press(screen.getByTestId('admin-pd-open-3'));
    fireEvent.press(await screen.findByTestId('admin-pd-preview'));
    expect(await screen.findByTestId('admin-pd-preview-total')).toHaveTextContent(/\$20,008\.00/);
    expect(screen.getByTestId('admin-pd-preview-box')).toHaveTextContent(has(t('pd_adm_texts_included')));
    fireEvent.press(screen.getByTestId('admin-pd-invoice'));
    await waitFor(() => expect(calls.find(c => c.method === 'post' && c.url === '/admin/pd-offices/3/invoices')?.data).toEqual({ year: new Date().getFullYear(), confirm: true }));
  });
});
