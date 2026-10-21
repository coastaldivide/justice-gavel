/**
 * aiLearning.test.ts — section E (AI, research & learning) regressions:
 * crisis/DV detection in 4 languages, safe Markdown parsing, help-line links,
 * bar-prep category labels, job polling (codes, abort, expiry) and the chat
 * transport (job fallback, Stop, refusals worded for people).
 */
jest.mock('../services/api', () => ({
  API_BASE_URL: 'http://api.test/api',
  deviceTimeZone: () => 'America/Chicago',
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../utils/secureStorage', () => ({ getToken: jest.fn(async () => 'tok') }));
jest.mock('../constants/theme', () => ({ useTheme: () => ({ colors: {} }), themeMode: () => 'dark', themeColors: () => ({}) }));

import { api } from '../services/api';
import { detectCrisis, foldText } from '../utils/crisisDetect';
import { parseBlocks, parseInline } from '../components/MarkdownText';
import { helpLine } from '../utils/contact';
import { categoryLabel } from '../constants/barPrepCategories';
import { pollJob, JobError } from '../services/jobPoller';
import { askChat, ChatError } from '../services/chatStream';
import { setLang, t } from '../i18n';

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

beforeEach(() => { get.mockReset(); post.mockReset(); setLang('en', { persist: false }); });

describe('detectCrisis', () => {
  it.each([
    ['I want to end it all', 'crisis'],
    ['I want to kill myself tonight', 'crisis'],
    ['no quiero vivir más', 'crisis'],
    ['não quero viver', 'crisis'],
    ['tôi muốn chết', 'crisis'],
    ['my boyfriend is hitting me', 'dv'],
    ['he threatened to kill me', 'dv'],
    ['me está golpeando', 'dv'],
  ])('%s → %s', (text, kind) => expect(detectCrisis(text)).toBe(kind));

  it('matches whole words only and ignores ordinary questions', () => {
    expect(detectCrisis('I spend it all on rent')).toBeNull();
    expect(detectCrisis('Can police search my car?')).toBeNull();
    expect(detectCrisis('')).toBeNull();
  });

  it('works whatever the app language is', () => {
    setLang('vi', { persist: false });
    expect(detectCrisis('no quiero vivir')).toBe('crisis');
  });

  it('folds accents, case and punctuation', () => {
    expect(foldText('Não, QUERO… viver!')).toBe('nao quero viver');
    expect(foldText('đi')).toBe('di');
  });
});

describe('MarkdownText parsing is text-only', () => {
  it('keeps HTML as literal text', () => {
    const blocks = parseBlocks('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
    expect(blocks).toEqual([
      { kind: 'p', text: '<script>alert(1)</script>' },
      { kind: 'p', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
  it('parses headings, lists, rules and gaps', () => {
    expect(parseBlocks('## Your rights\n- stay silent\n2. ask for a lawyer\n\n\n---\nend').map(b => b.kind))
      .toEqual(['h', 'li', 'li', 'gap', 'hr', 'p']);
  });
  it('parses inline bold, code and links', () => {
    const kinds = parseInline('Say **nothing**, see `988` and [help](https://988lifeline.org)').map(s => s.kind);
    expect(kinds).toEqual(['text', 'bold', 'text', 'code', 'text', 'link']);
  });
});

describe('helpLine', () => {
  it('texts "Text HOME to 741741"', () => {
    expect(helpLine('Text HOME to 741741')).toMatchObject({ kind: 'sms', label: 'Text HOME to 741741' });
    expect(helpLine('Text HOME to 741741')?.url).toMatch(/^sms:741741[?&]body=HOME$/);
  });
  it('dials short codes and "988 then press 1"', () => {
    expect(helpLine('988')).toMatchObject({ kind: 'tel', url: 'tel:988' });
    expect(helpLine('988 then press 1')).toMatchObject({ kind: 'tel', url: 'tel:988', after: 'press 1' });
  });
  it('dials a normal number and returns null for nothing', () => {
    expect(helpLine('1-800-799-7233')?.url).toBe('tel:+18007997233');
    expect(helpLine('')).toBeNull();
  });
});

describe('bar-prep category labels', () => {
  it('translates known codes and never shows a raw code', () => {
    const en = categoryLabel('negligence');
    expect(en).toBe(t('x_bar_prep_home_negligence'));
    setLang('es', { persist: false });
    expect(categoryLabel('negligence')).toBe(t('x_bar_prep_home_negligence'));
    expect(categoryLabel('negligence')).not.toBe(en);
    expect(categoryLabel('something_new')).toBe('Something new');
    expect(categoryLabel(null)).toBe('');
  });
});

describe('pollJob', () => {
  it('resolves when the job is done', async () => {
    get.mockResolvedValueOnce({ data: { status: 'processing' } }).mockResolvedValueOnce({ data: { status: 'done', result: { ok: 1 } } });
    const job = await pollJob('j1', { intervalMs: 1 });
    expect(job.result).toEqual({ ok: 1 });
  });
  it('rejects a failed job with its code and the server sentence', async () => {
    get.mockResolvedValueOnce({ data: { status: 'failed', code: 'ai_busy', error: 'Muy ocupado' } });
    await expect(pollJob('j2', { intervalMs: 1 })).rejects.toMatchObject({ code: 'ai_busy', message: 'Muy ocupado' });
  });
  it('a vanished job is "expired", worded for people', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } });
    const err = await pollJob('j3', { intervalMs: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err.code).toBe('expired');
    expect(err.message).toBe(t('job_err_expired'));
  });
  it('stops polling when aborted', async () => {
    get.mockResolvedValue({ data: { status: 'processing' } });
    const ctrl = new AbortController();
    const p = pollJob('j4', { intervalMs: 5, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('askChat (job path, as on native)', () => {
  const body = { message: 'Can they search my phone?', sessionId: 's1', clientMessageId: 'abc123def' };
  it('returns the answer from the job', async () => {
    post.mockResolvedValueOnce({ data: { jobId: 'j' } });
    get.mockResolvedValueOnce({ data: { status: 'done', result: { reply: 'Generally, police need a warrant.' } } });
    const a = await askChat(body as never, { signal: new AbortController().signal, onToken: () => {} });
    expect(a.text).toBe('Generally, police need a warrant.');
    expect(post).toHaveBeenCalledWith('/chat/ask', body, expect.objectContaining({ signal: expect.anything() }));
  });
  it('the free-limit 402 becomes chat_limit_reached in the app language', async () => {
    post.mockRejectedValueOnce({ response: { status: 402, data: { error: 'chat_limit_reached', message: 'x' } } });
    const err = await askChat(body as never, { signal: new AbortController().signal, onToken: () => {} }).catch(e => e);
    expect(err).toBeInstanceOf(ChatError);
    expect(err.code).toBe('chat_limit_reached');
    expect(err.message).toBe(t('x_ch_ve_used_free_ai'));
  });
  it('no network → offline, Stop → stopped', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(askChat(body as never, { signal: new AbortController().signal, onToken: () => {} })).rejects.toMatchObject({ code: 'offline' });
    post.mockRejectedValueOnce({ code: 'ERR_CANCELED' });
    await expect(askChat(body as never, { signal: new AbortController().signal, onToken: () => {} })).rejects.toMatchObject({ code: 'stopped' });
  });
  it('a failed job keeps its code', async () => {
    post.mockResolvedValueOnce({ data: { jobId: 'j' } });
    get.mockResolvedValueOnce({ data: { status: 'failed', code: 'ai_timeout', error: 'Took too long' } });
    await expect(askChat(body as never, { signal: new AbortController().signal, onToken: () => {} })).rejects.toMatchObject({ code: 'ai_timeout', message: 'Took too long' });
  });
});
