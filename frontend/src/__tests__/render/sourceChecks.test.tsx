/**
 * Render tests for AI step 3 (docs/AI_PLATFORM.md §9–§10):
 *   - Admin → Source checks: the queue shows the row, stored text, verdict, quote (found or not),
 *     the proposed official source; approve / withhold / edit post the decision; "run now";
 *     the review file download for a translation-draft batch
 *   - GuideSourceList: a newer verified "checked" date from /legal-sources/status replaces the
 *     bundled one; a withheld source loses its link and says "being re-checked"
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: () => Promise.resolve(true) }) }));
const mockFetchFile = jest.fn((..._a: unknown[]) => Promise.resolve('download'));
jest.mock('../../services/fileDownload', () => ({ fetchFile: (...a: unknown[]) => mockFetchFile(...a) }));

import AdminSourceChecksScreen from '../../screens/AdminSourceChecksScreen';
import GuideSourceList, { _resetGuideSourceStatus } from '../../components/GuideSourceList';
import { makeStyles } from '../../screens/CourtDatesScreen';
import { themeColors } from '../../constants/theme';
import { apiMock, makeNavigation } from './apiMock';

const { on, calls, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const REVIEWS = [
  { id: 7, dataset: 'bail_schedules', row_key: '12', kind: 'proposal', label: 'TN bail — theft', state: 'TN', source_url: null,
    old_text: 'Bail for theft (low) in TN: $500.', verdict: 'source_found', quote: 'The judge sets bail for each case.', quote_verified: true,
    reason: 'quote_on_page', what_changed: null, fetched_url: 'https://www.tncourts.gov/', proposed_source_url: 'https://www.tncourts.gov/', status: 'pending',
    created_at: '2026-11-02T10:00:00Z', editable: { kind: 'fields', fields: ['bail_note', 'notes'] } },
  { id: 8, dataset: 'guide', row_key: 'ny_tips', kind: 'recheck', label: 'NY courts — Tips', state: null, source_url: 'https://nycourts.gov/tips',
    old_text: 'NY courts publish "Tips for Your Day in Court".', verdict: 'still_matches', quote: 'Words not on the page at all.', quote_verified: false,
    reason: 'quote_not_on_page', what_changed: null, fetched_url: 'https://nycourts.gov/tips', proposed_source_url: null, status: 'pending',
    created_at: '2026-11-02T10:00:00Z', editable: { kind: 'correction' } },
];

let openSpy: jest.SpyInstance;
beforeEach(() => {
  reset(); _resetGuideSourceStatus(); mockFetchFile.mockClear();
  openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  on('get', '/admin/source-checks/reviews', { rows: REVIEWS });
  on('get', '/admin/source-checks/withheld', { rows: [{ dataset: 'transit', row_key: 'TN-Knox', withheld_reason: 'correction_pending_deploy', correction: 'New KAT address.' }] });
  on('get', '/admin/ai-batches', { batches: [{ id: 3, kind: 'translate_keys', status: 'processed', item_count: 2, cost_usd: 0.0012 }, { id: 2, kind: 'eval_answer', status: 'processed', item_count: 10, cost_usd: 0.04, eval_mean: 6.5, eval_questions: 10 }] });
  on('get', /^\/admin\/source-checks$/, { datasets: [{ dataset: 'expungement', rows: 306, shown: 295, recheck: 118, propose: 11, not_official: 177, no_url: 0 }] });
});
afterEach(() => openSpy.mockRestore());

describe('Admin → Source checks', () => {
  test('shows each item with its stored text, verdict, quote state and proposed source; decisions post', async () => {
    on('post', '/admin/source-checks/reviews/', { status: 'approved' });
    wrap(<AdminSourceChecksScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    const items = await screen.findAllByTestId('asc-review');
    expect(items).toHaveLength(2);
    expect(screen.getByText('Bail for theft (low) in TN: $500.')).toBeTruthy();
    expect(screen.getByText(t('asc_reason_quote_not_on_page'))).toBeTruthy();
    expect(screen.getByText(`${t('asc_quote')} ${t('asc_quote_unverified')}`)).toBeTruthy();
    expect(screen.getByText(`${t('asc_quote')} ${t('asc_quote_ok')}`)).toBeTruthy();
    expect(screen.getByText(t('asc_ds_line', { rows: 306, shown: 295, recheck: 118, manual: 188 }))).toBeTruthy();
    fireEvent.press(screen.getByTestId('asc-proposed'));
    expect(openSpy).toHaveBeenCalledWith('https://www.tncourts.gov/');

    fireEvent.press(screen.getAllByTestId('asc-approve')[0]);
    await waitFor(() => expect(calls.some((c) => c.method === 'post' && c.url === '/admin/source-checks/reviews/7')).toBe(true));
    expect(calls.find((c) => c.url === '/admin/source-checks/reviews/7')?.data).toMatchObject({ action: 'approve' });

    fireEvent.press(screen.getAllByTestId('asc-withhold')[1]);
    await waitFor(() => expect(calls.some((c) => c.url === '/admin/source-checks/reviews/8')).toBe(true));
    expect(calls.find((c) => c.url === '/admin/source-checks/reviews/8')?.data).toMatchObject({ action: 'withhold' });
  });

  test('edit a row in code: a correction for a developer', async () => {
    on('post', '/admin/source-checks/reviews/8', { status: 'edited', needs_developer: true });
    wrap(<AdminSourceChecksScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    await screen.findAllByTestId('asc-review');
    fireEvent.press(screen.getAllByTestId('asc-edit')[1]);
    expect(await screen.findByText(t('asc_edit_hint_code'))).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('asc-edit-text'), 'The page title changed.');
    fireEvent.press(screen.getByTestId('asc-save-edit'));
    await waitFor(() => expect(calls.find((c) => c.url === '/admin/source-checks/reviews/8')?.data).toMatchObject({ action: 'edit', text: 'The page title changed.' }));
  });

  test('run now, withheld rows with restore, batch tools (eval score, review file download)', async () => {
    on('post', '/admin/source-checks/run', { batch: { id: 9 }, created: true });
    on('post', '/admin/source-checks/rows/restore', { withheld: false });
    wrap(<AdminSourceChecksScreen navigation={makeNavigation()} route={{ params: {} } as never} />);
    await screen.findAllByTestId('asc-review');
    expect(screen.getByText(t('asc_correction', { text: 'New KAT address.' }))).toBeTruthy();
    expect(screen.getByTestId('abt-eval-score')).toBeTruthy();
    fireEvent.press(screen.getByTestId('asc-run'));
    await waitFor(() => expect(calls.some((c) => c.method === 'post' && c.url === '/admin/source-checks/run')).toBe(true));
    fireEvent.press(screen.getByTestId('asc-restore'));
    await waitFor(() => expect(calls.find((c) => c.url === '/admin/source-checks/rows/restore')?.data).toEqual({ dataset: 'transit', key: 'TN-Knox' }));
    fireEvent.press(screen.getByTestId('abt-download'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('/admin/ai-batches/3/translation-draft', 'translation-draft-3.json', 'application/json'));
  });
});

describe('GuideSourceList follows the source re-checks', () => {
  const styles = makeStyles(themeColors());
  test('a newer verified date replaces the bundled one; a withheld source loses its link', async () => {
    on('get', '/legal-sources/status', { datasets: { guide: { tn_dhs: { checked_on: '2026-12-06', withheld: false }, ny_tips: { checked_on: null, withheld: true } } } });
    wrap(<GuideSourceList ids={['tn_dhs', 'ny_tips']} styles={styles} testID="gsl" />);
    await screen.findByText(new RegExp(t('cgd_source_rechecking')));
    expect(screen.getByTestId('gsl-tn_dhs').props.accessibilityRole).toBe('link');
    expect(screen.getByTestId('gsl-ny_tips').props.accessibilityRole).toBeUndefined();
    expect(screen.queryByText(/2026/)).toBeTruthy();
  });
  test('no answer from the server → the bundled dates, links kept', async () => {
    wrap(<GuideSourceList ids={['ny_tips']} styles={styles} testID="gsl" />);
    await waitFor(() => expect(calls.some((c) => c.url === '/legal-sources/status')).toBe(true));
    expect(screen.getByTestId('gsl-ny_tips').props.accessibilityRole).toBe('link');
  });
});
