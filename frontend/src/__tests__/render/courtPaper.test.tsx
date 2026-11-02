/**
 * Render tests for AI step 4 (docs/AI_PLATFORM.md §11):
 *   - CourtPaperScreen: a picked paper is read into an editable, pre-filled form with the words
 *     each line came from and a confidence flag, under "We read this from your paper…"; nothing is
 *     saved until "Save court date", which goes through POST /court-dates (source 'paper'); the
 *     paper is attached to the case only when the person turns that on; not a court paper →
 *     message, nothing saved; feature off → add by hand
 *   - BondFormsScreen (staff set-up) → AI suggestions: suggest, accept, choose another, reject;
 *     a PDF without fillable fields says so
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve('jwt-test')), setToken: jest.fn(() => Promise.resolve()), setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)), removeItem: jest.fn(() => Promise.resolve()), clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});
jest.mock('../../utils/userState', () => ({ __esModule: true, getUserState: jest.fn(() => Promise.resolve({ code: 'TN' })) }));
jest.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: () => Promise.resolve(true) }) }));
const mockPick = jest.fn();
jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: (...a: unknown[]) => mockPick(...a) }));
jest.mock('expo-image-manipulator', () => ({ __esModule: true, SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: jest.fn((uri: string) => Promise.resolve({ uri: `${uri}#jpeg` })) }));
jest.mock('expo-image-picker', () => ({ __esModule: true, requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })), launchCameraAsync: jest.fn() }));
const mockAppend = jest.fn((..._a: unknown[]) => Promise.resolve());
jest.mock('../../services/fileDownload', () => ({ __esModule: true, fetchFile: jest.fn(() => Promise.resolve('view')), appendPicked: (...a: unknown[]) => mockAppend(...a) }));

import CourtPaperScreen from '../../screens/CourtPaperScreen';
import BondFormsScreen from '../../screens/BondFormsScreen';
import { apiMock, makeNavigation } from './apiMock';

const { on, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const F = (value: string, source_text: string, confidence = 'high') => ({ value, source_text, confidence });
const READ = {
  result: 'read', notice: 'We read this from your paper. Check every line against the paper before saving.', warnings: ['no_time'], pages: 1, via_file_id: false,
  fields: {
    court_date: F('2027-03-02', 'TUESDAY, MARCH 2, 2027'), court_time: F('', '', 'not_found'),
    court_name: F('General Sessions Court', 'GENERAL SESSIONS COURT OF DAVIDSON COUNTY'), court_address: F('408 2nd Ave N, Nashville, TN 37201', '408 2nd Avenue North'),
    courtroom: F('Courtroom 4B', 'Courtroom 4B', 'medium'), case_number: F('GS-778812', 'Docket No. GS-778812', 'low'), judge: F('', '', 'not_found'),
    hearing_type: F('arraignment', 'ARRAIGNMENT'),
  },
  bring: [{ text: 'Photo ID', source_text: 'Bring a photo ID', confidence: 'high' }],
};

beforeEach(() => {
  reset(); mockPick.mockReset(); mockAppend.mockClear();
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///paper.pdf', name: 'paper.pdf', size: 40_000, mimeType: 'application/pdf' }] });
  on('get', '/court-papers/status', { enabled: true, max_mb: 8, max_pages: 10, types: ['image/jpeg', 'application/pdf'], reads_left_today: 19 });
  on('get', '/cases', { cases: [{ id: 7, title: 'My case' }] });
  on('get', '/messages/7', { messages: [] });
});

describe('Read my court paper', () => {
  test('review screen: pre-filled lines, their words and confidence; nothing saved until confirm', async () => {
    on('post', '/court-papers/read', READ);
    on('post', '/court-dates', { id: 55, case_id: 7, reminders: [] });
    const nav = makeNavigation();
    wrap(<CourtPaperScreen navigation={nav} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('court-paper-pdf'));
    expect(await screen.findByTestId('court-paper-review')).toBeTruthy();
    expect(screen.getByText(`${t('cpr_notice')} ${t('cpr_info_only')}`)).toBeTruthy();
    expect(screen.getByText(t('cpr_w_no_time'))).toBeTruthy();
    expect(screen.getByTestId('court-paper-input-court_date').props.value).toBe('2027-03-02');
    expect(screen.getByTestId('court-paper-input-courtroom').props.value).toBe('Courtroom 4B');
    expect(screen.getByTestId('court-paper-source-court_date').props.children).toBe(t('cpr_from_paper', { text: 'TUESDAY, MARCH 2, 2027' }));
    expect(screen.getByTestId('court-paper-source-judge').props.children).toBe(t('cpr_not_on_paper'));
    expect(screen.getAllByText(t('cpr_conf_low')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('cpr_conf_medium')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('court-paper-input-bring').props.value).toBe('Photo ID');
    // the paper went to the read endpoint as a file; nothing was saved
    expect(mockAppend).toHaveBeenCalledWith(expect.anything(), 'file', { uri: 'file:///paper.pdf', name: 'paper.pdf', type: 'application/pdf' });
    expect(calls.some((c) => c.url === '/court-dates')).toBe(false);
    // the person corrects a line, then confirms
    fireEvent.changeText(screen.getByTestId('court-paper-input-case_number'), 'GS-778813');
    fireEvent.changeText(screen.getByTestId('court-paper-input-court_time'), '09:30');
    fireEvent.press(screen.getByTestId('court-paper-save'));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('CourtDateDetail', { id: 55 }));
    expect(calls.find((c) => c.method === 'post' && c.url === '/court-dates')?.data).toEqual({
      court_date: '2027-03-02', court_time: '09:30', source: 'paper', hearing_type: 'arraignment',
      location: 'General Sessions Court, 408 2nd Ave N, Nashville, TN 37201', courtroom: 'Courtroom 4B', case_number: 'GS-778813', bring: 'Photo ID', case_id: 7,
    });
    expect(calls.some((c) => c.url === '/messages/attachment')).toBe(false);   // not attached unless chosen
  });

  test('a bad date is caught before anything is sent; attaching the paper is the person\'s choice', async () => {
    on('post', '/court-papers/read', READ);
    on('post', '/court-dates', { id: 56, case_id: 7, reminders: [] });
    on('post', '/messages/attachment', { id: 9 });
    const nav = makeNavigation();
    wrap(<CourtPaperScreen navigation={nav} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('court-paper-pdf'));
    await screen.findByTestId('court-paper-review');
    fireEvent.changeText(screen.getByTestId('court-paper-input-court_date'), 'March 2');
    fireEvent.press(screen.getByTestId('court-paper-save'));
    expect(await screen.findByText(t('cpr_err_date'))).toBeTruthy();
    expect(calls.some((c) => c.url === '/court-dates')).toBe(false);
    fireEvent.changeText(screen.getByTestId('court-paper-input-court_date'), '2027-03-02');
    fireEvent.press(screen.getByTestId('court-paper-attach-attach'));
    fireEvent.press(screen.getByTestId('court-paper-save'));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('CourtDateDetail', { id: 56 }));
    expect(calls.findIndex((c) => c.url === '/messages/attachment')).toBeGreaterThan(calls.findIndex((c) => c.url === '/court-dates'));
  });

  test('not a court paper: the message, nothing saved, add by hand', async () => {
    on('post', '/court-papers/read', { result: 'not_court_paper', fields: null, bring: [], warnings: [], notice: 'x', message: 'This does not look like a court paper with a court date. Nothing was saved.' });
    const nav = makeNavigation();
    wrap(<CourtPaperScreen navigation={nav} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('court-paper-pdf'));
    expect(await screen.findByText('This does not look like a court paper with a court date. Nothing was saved.')).toBeTruthy();
    expect(screen.queryByTestId('court-paper-review')).toBeNull();
    fireEvent.press(screen.getAllByTestId('court-paper-by-hand')[0]);
    expect(nav.navigate).toHaveBeenCalledWith('CourtDates', { add: true, caseId: 7 });
    expect(calls.some((c) => c.url === '/court-dates')).toBe(false);
  });

  test('feature off: no reading, add by hand; a case document can be read', async () => {
    on('get', '/court-papers/status', { enabled: false, max_mb: 8, max_pages: 10, types: [], reads_left_today: 0 });
    const { unmount } = wrap(<CourtPaperScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    expect(await screen.findByTestId('court-paper-off')).toBeTruthy();
    expect(screen.queryByTestId('court-paper-pdf')).toBeNull();
    unmount();
    on('get', '/court-papers/status', { enabled: true, max_mb: 8, max_pages: 10, types: [], reads_left_today: 3 });
    on('get', '/messages/7', { messages: [{ attachment_id: 31, attachment_name: 'notice.pdf', attachment_type: 'application/pdf' }, { attachment_id: 32, attachment_name: 'note.txt', attachment_type: 'text/plain' }] });
    on('post', '/court-papers/read-attachment', { ...READ, via_file_id: true, case_id: 7, attachment_id: 31 });
    wrap(<CourtPaperScreen navigation={makeNavigation()} route={{ params: { caseId: 7 } } as never} />);
    fireEvent.press(await screen.findByTestId('court-paper-doc-31'));
    expect(screen.queryByTestId('court-paper-doc-32')).toBeNull();
    expect(await screen.findByTestId('court-paper-review')).toBeTruthy();
    expect(calls.find((c) => c.url === '/court-papers/read-attachment')?.data).toEqual({ attachment_id: 31 });
    expect(screen.queryByTestId('court-paper-attach-attach')).toBeNull();   // already a case document
  });
});

describe('Staff: AI field-mapping suggestions', () => {
  const FORM = { id: 3, name: 'Surety app', page_count: 1, roles: ['defendant'], fields: [{ name: 'DefName', type: 'text' }, { name: 'Amt', type: 'text' }, { name: 'Office', type: 'text' }], field_map: {}, archived: false, created_at: '2026-11-01' };
  const SUG = { id: 9, form_id: 3, status: 'open', no_fields: false, decisions: {}, suggestions: [
    { field: 'DefName', data_key: 'bond.defendant_name', confidence: 'high', reason: 'Label "Defendant"', page: 1 },
    { field: 'Amt', data_key: 'bond.premium', confidence: 'medium', reason: 'Label "Amount"', page: 1 },
    { field: 'Office', data_key: null, confidence: 'low', reason: '', page: 1 },
  ] };
  beforeEach(() => {
    on('get', '/bond-desk/access', { allowed: true, storage_live: true });
    on('get', '/admin/bd-setup/5/forms', { forms: [FORM] });
    on('get', '/admin/bd-setup/5/forms/3/map-suggestions', { suggestion: null });
  });

  test('suggest, accept, choose another, reject — each decision posted; nothing applied before', async () => {
    on('post', '/admin/bd-setup/5/forms/3/map-suggestions', { suggestion: SUG });
    on('post', '/admin/bd-setup/5/forms/3/map-suggestions/9/decide', (_u: string, { data }: { data?: any }) => Promise.resolve({ data: {
      suggestion: { ...SUG, decisions: { [data.field]: { action: data.action, data_key: data.action === 'accept' ? (data.data_key || 'bond.defendant_name') : null } } },
      form: { ...FORM, field_map: data.action === 'accept' ? { [data.field]: data.data_key || 'bond.defendant_name' } : {} } } }));
    wrap(<BondFormsScreen navigation={makeNavigation()} route={{ params: { setupRequestId: 5, agency: 'Alpha Bail' } } as never} />);
    fireEvent.press(await screen.findByTestId('form-3'));
    fireEvent.press(await screen.findByTestId('form-ai-suggest'));
    expect(await screen.findByTestId('form-ai-item-DefName')).toBeTruthy();
    expect(screen.getByText(t('bdk_ai_reason', { reason: 'Label "Defendant"' }))).toBeTruthy();
    expect(screen.getByText(t('bdk_ai_suggest_none'))).toBeTruthy();
    expect(screen.queryByTestId('form-ai-accept-Office')).toBeNull();   // nothing to accept without a suggestion
    expect(screen.getByText(t('bdk_ai_signature_note'))).toBeTruthy();
    expect(calls.some((c) => c.url.includes('/decide'))).toBe(false);
    fireEvent.press(screen.getByTestId('form-ai-accept-DefName'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/decide'))?.data).toEqual({ field: 'DefName', action: 'accept' }));
    expect(await screen.findByTestId('form-ai-decided-DefName')).toBeTruthy();
    fireEvent.press(screen.getByTestId('form-ai-other-Amt'));
    fireEvent.press(await screen.findByTestId('form-ai-key-bond.bond_amount'));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/decide')).pop()?.data).toEqual({ field: 'Amt', action: 'accept', data_key: 'bond.bond_amount' }));
    fireEvent.press(screen.getByTestId('form-ai-reject-Office'));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/decide')).pop()?.data).toEqual({ field: 'Office', action: 'reject' }));
  });

  test('a PDF without fillable fields says so', async () => {
    on('post', '/admin/bd-setup/5/forms/3/map-suggestions', { suggestion: { ...SUG, no_fields: true, suggestions: [], status: 'done' } });
    wrap(<BondFormsScreen navigation={makeNavigation()} route={{ params: { setupRequestId: 5, agency: 'Alpha Bail' } } as never} />);
    fireEvent.press(await screen.findByTestId('form-3'));
    fireEvent.press(await screen.findByTestId('form-ai-suggest'));
    expect(await screen.findByText(t('bdk_ai_no_fields'))).toBeTruthy();
  });

  test('the agency\'s own library has no AI suggestions', async () => {
    on('get', '/bond-desk/forms', { forms: [FORM] });
    on('get', '/bond-desk/forms-setup', { requests: [] });
    wrap(<BondFormsScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    fireEvent.press(await screen.findByTestId('form-3'));
    await screen.findByTestId('form-editor');
    expect(screen.queryByTestId('form-ai')).toBeNull();
  });
});
