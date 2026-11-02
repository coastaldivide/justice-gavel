/**
 * Render tests for AI step 5 (docs/AI_PLATFORM.md §12–13):
 *   - "What the assistant remembers about this chat": opens, shows the recap sections, "Forget this"
 *     deletes it (DELETE) and shows the forgotten state; empty / off / failed states; research path
 *   - Draft downloads: "Download as Word (.docx)" / "Download as PDF" call the document route with
 *     the format and the right MIME type; a failed download says so
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import { t } from '../../i18n';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: () => Promise.resolve(true) }) }));
const mockFetchFile = jest.fn((..._a: unknown[]) => Promise.resolve('download'));
jest.mock('../../services/fileDownload', () => ({ __esModule: true, fetchFile: (...a: unknown[]) => mockFetchFile(...a), appendPicked: jest.fn() }));

import ConversationMemory from '../../components/ConversationMemory';
import DraftDownloads from '../../components/DraftDownloads';
import { apiMock } from './apiMock';

const { on, calls, reset, reject } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const RECAP = {
  enabled: true, remembered: true, forgotten: false, covered_turns: 6, updated_at: '2026-11-02T10:00:00Z',
  recap: { case_stage: 'Arrested, first court date not set yet', places: ['Knox County'], dates: [{ what: 'Arrest', date: 'March 3' }], facts: ['Worried about what to bring'], asked: ['What happens next'] },
};

beforeEach(() => { reset(); mockFetchFile.mockClear(); });

describe('What the assistant remembers', () => {
  test('shows the recap and forgets it', async () => {
    on('get', '/chat/memory/s-1', RECAP);
    on('delete', '/chat/memory/s-1', { ok: true, enabled: true, remembered: false, forgotten: true, recap: null, covered_turns: 0, updated_at: null });
    wrap(<ConversationMemory kind="chat" conversationId="s-1" testID="chat-memory" />);
    fireEvent.press(screen.getByTestId('chat-memory-open'));
    expect(await screen.findByTestId('chat-memory-recap')).toBeTruthy();
    expect(screen.getByText(t('mem_title'))).toBeTruthy();
    expect(screen.getByText(t('mem_intro'))).toBeTruthy();
    expect(screen.getByText(t('mem_covers', { n: 6 }))).toBeTruthy();
    expect(screen.getByText('• Knox County')).toBeTruthy();
    expect(screen.getByText('• Arrest — March 3')).toBeTruthy();
    expect(screen.getByText('• What happens next')).toBeTruthy();
    expect(screen.getByText(t('mem_case_stage'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('chat-memory-forget'));
    expect(await screen.findByTestId('chat-memory-forgotten')).toBeTruthy();
    expect(calls.some((c) => c.method === 'delete' && c.url === '/chat/memory/s-1')).toBe(true);
    expect(screen.queryByTestId('chat-memory-forget')).toBeNull();
  });

  test('empty, off, failed; research uses its own route; nothing without a conversation', async () => {
    on('get', '/research/session/12/memory', { ...RECAP, remembered: false, recap: null, covered_turns: 0 });
    const r = wrap(<ConversationMemory kind="research" conversationId={12} testID="research-memory" />);
    fireEvent.press(screen.getByTestId('research-memory-open'));
    expect(await screen.findByTestId('research-memory-empty')).toBeTruthy();
    expect(calls.some((c) => c.url === '/research/session/12/memory')).toBe(true);
    r.unmount();

    on('get', '/chat/memory/s-off', { ...RECAP, enabled: false, remembered: false, recap: null });
    const r2 = wrap(<ConversationMemory kind="chat" conversationId="s-off" />);
    fireEvent.press(screen.getByTestId('memory-open'));
    expect(await screen.findByTestId('memory-off')).toBeTruthy();
    r2.unmount();

    on('get', '/chat/memory/s-bad', () => Promise.reject(reject(500, { error: 'server_error' })));
    const r3 = wrap(<ConversationMemory kind="chat" conversationId="s-bad" />);
    fireEvent.press(screen.getByTestId('memory-open'));
    expect(await screen.findByTestId('memory-failed')).toBeTruthy();
    r3.unmount();

    wrap(<ConversationMemory kind="chat" conversationId="" />);
    expect(screen.queryByTestId('memory-open')).toBeNull();
  });
});

describe('Draft downloads', () => {
  test('Word and PDF call the document route with the format and MIME type', async () => {
    wrap(<DraftDownloads path="/expungement/petition/9/document" fileBase="petition-9" testID="expungement-download" />);
    expect(screen.getByText(t('doc_download_word'))).toBeTruthy();
    expect(screen.getByText(t('doc_download_pdf'))).toBeTruthy();
    expect(screen.getByText(t('doc_download_note'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('expungement-download-docx'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('/expungement/petition/9/document?format=docx', 'petition-9.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    fireEvent.press(screen.getByTestId('expungement-download-pdf'));
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('/expungement/petition/9/document?format=pdf', 'petition-9.pdf', 'application/pdf'));
  });

  test('a failed download says so', async () => {
    mockFetchFile.mockImplementationOnce(() => Promise.reject({}));
    wrap(<DraftDownloads path="/motions/history/3/document" fileBase="motion-3" />);
    fireEvent.press(screen.getByTestId('draft-download-pdf'));
    expect(await screen.findByText(t('doc_download_failed'))).toBeTruthy();
  });
});
