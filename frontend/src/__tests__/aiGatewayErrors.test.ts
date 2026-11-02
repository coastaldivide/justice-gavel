/**
 * aiGatewayErrors.test.ts — the AI gateway's new outcomes reach people correctly:
 *   - ai_refused on the chat stream drops the partial text that already arrived (the server
 *     sends `discard: true`) and keeps the server's wording;
 *   - ai_refused / ai_too_large / ai_invalid_output from a job are worded in the app language;
 *   - other stream errors still keep the partial text (so a retry can replace it).
 */
jest.mock('../services/api', () => ({
  API_BASE_URL: 'http://api.test/api',
  deviceTimeZone: () => 'America/Chicago',
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../utils/secureStorage', () => ({ getToken: jest.fn(async () => 'tok') }));

import { Platform } from 'react-native';
import { api } from '../services/api';
import { askChat, chatErrorText, ChatError } from '../services/chatStream';
import { pollJob, jobErrorText } from '../services/jobPoller';
import { setLang, t } from '../i18n';

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const body = { message: 'q', sessionId: 's1', clientMessageId: 'c1abcdef' };

function sseResponse(frames: object[]): Response {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const realOS = Platform.OS;
const realFetch = globalThis.fetch;
beforeEach(() => { get.mockReset(); post.mockReset(); setLang('en', { persist: false }); (Platform as { OS: string }).OS = 'web'; });
afterEach(() => { globalThis.fetch = realFetch; (Platform as { OS: string }).OS = realOS; });

describe('chat stream refusal', () => {
  it('ai_refused discards the partial text and keeps the server wording', async () => {
    globalThis.fetch = jest.fn(async () => sseResponse([
      { type: 'disclaimer', required: true },
      { type: 'token', text: 'Partial ' },
      { type: 'token', text: 'answer' },
      { type: 'error', code: 'ai_refused', message: "This request can't be answered here.", discard: true },
    ])) as never;
    const tokens: string[] = [];
    const err = await askChat(body as never, { signal: new AbortController().signal, onToken: (s) => tokens.push(s) }).catch((e) => e);
    expect(tokens.join('')).toBe('Partial answer');          // they streamed …
    expect(err).toBeInstanceOf(ChatError);
    expect(err.code).toBe('ai_refused');
    expect(err.partial).toBe('');                              // … and are dropped
    expect(err.message).toBe("This request can't be answered here.");
  });

  it('a broken stream (ai_busy) still keeps what arrived', async () => {
    globalThis.fetch = jest.fn(async () => sseResponse([
      { type: 'token', text: 'Some text' },
      { type: 'error', code: 'ai_busy', message: 'busy' },
    ])) as never;
    const err = await askChat(body as never, { signal: new AbortController().signal, onToken: () => {} }).catch((e) => e);
    expect(err.code).toBe('ai_busy');
    expect(err.partial).toBe('Some text');
  });
});

describe('job codes are worded for people', () => {
  it('ai_refused from a job reaches the chat as ai_refused', async () => {
    globalThis.fetch = jest.fn(async () => { throw new TypeError('no stream'); }) as never;
    post.mockResolvedValueOnce({ data: { jobId: 'j1' } });
    get.mockResolvedValueOnce({ data: { status: 'failed', code: 'ai_refused', error: 'No se puede responder esta solicitud aquí.' } });
    await expect(askChat(body as never, { signal: new AbortController().signal, onToken: () => {} }))
      .rejects.toMatchObject({ code: 'ai_refused', message: 'No se puede responder esta solicitud aquí.' });
  });

  it.each(['ai_refused', 'ai_too_large', 'ai_invalid_output'])('%s has its own text in every language', async (code) => {
    const key = { ai_refused: 'chat_err_refused', ai_too_large: 'chat_err_too_large', ai_invalid_output: 'chat_err_invalid_output' }[code] as string;
    for (const lang of ['en', 'es', 'pt', 'vi', 'zh', 'tl', 'ht', 'ar']) {
      setLang(lang as never, { persist: false });
      expect(chatErrorText(code)).toBe(t(key));
      expect(jobErrorText(code)).toBe(t(key));
      expect(t(key)).not.toBe(key);
    }
    setLang('es', { persist: false });
    expect(chatErrorText('ai_refused')).toMatch(/^No se puede responder/);
    get.mockResolvedValueOnce({ data: { status: 'failed', code } });
    await expect(pollJob('j2', { intervalMs: 1 })).rejects.toMatchObject({ code });
  });
});
