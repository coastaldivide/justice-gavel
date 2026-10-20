/**
 * chatStream.ts — one AI chat question, answered as a stream (web) or a job.
 *
 *   askChat(body, { signal, onToken }) → Promise<ChatAnswer>
 *
 * Web: POST /chat/stream (Server-Sent Events). Tokens are handed to onToken as
 * they arrive. Native (React Native fetch cannot read a streamed body) and any
 * web request whose stream never started: POST /chat/ask, then the job is
 * polled. `body.clientMessageId` makes a retry safe: the server replays an
 * answer it already finished instead of asking (and counting) the question
 * again.
 *
 * Failures reject with ChatError: `code` (chat_limit_reached, disclaimer_required,
 * ai_unavailable, ai_busy, ai_timeout, ai_failed, offline, …), `status` for HTTP
 * refusals, `message` already in the app language, and `partial` — the text
 * that had arrived before the stream broke. An abort (the person pressed
 * Stop) rejects with ChatError code 'stopped'.
 */
import { Platform } from 'react-native';
import { API_BASE_URL, api, deviceTimeZone } from './api';
import { pollJob, JobError } from './jobPoller';
import { getToken } from '../utils/secureStorage';
import { getLang, t } from '../i18n';

export interface RightsRef { key: string; heading: string; source: string; last_reviewed: string | null }
export interface ChatAnswer {
  text: string;
  intent?: string;
  suggestLawyerSearch?: boolean;
  rightsRefs?: RightsRef[];
  replayed?: boolean;
}
export interface ChatRequest {
  message: string;
  sessionId: string;
  clientMessageId: string;
  mode?: string;
  caseContext?: string | null;
  caseId?: string | null;
  caseTitle?: string | null;
  user_state?: string | null;
  user_state_name?: string | null;
}

export class ChatError extends Error {
  code: string;
  status?: number;
  partial: string;
  data?: Record<string, unknown>;
  constructor(code: string, message: string, opts: { status?: number; partial?: string; data?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.status = opts.status;
    this.partial = opts.partial || '';
    this.data = opts.data;
  }
}

/** Server refusals answered the same way by /stream and /ask: never re-sent to the other one. */
const TERMINAL_STATUSES = new Set([400, 401, 402, 403, 429, 451, 503]);

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

export function chatErrorText(code: string): string {
  switch (code) {
    case 'chat_limit_reached': return t('x_ch_ve_used_free_ai');
    case 'disclaimer_required': return t('x_ch_before_using_ai_chat');
    case 'ai_unavailable': return t('x_ch_ai_chat_temporarily_unavailable');
    case 'ai_busy': return t('chat_err_busy');
    case 'ai_timeout': return t('chat_err_timeout');
    case 'offline': return t('x_ch_no_connection_check_internet');
    case 'connection_lost': return t('chat_err_connection_lost');
    default: return t('x_ch_sorry_i_had_trouble');
  }
}

function fromHttp(status: number, data: Record<string, unknown>): ChatError {
  const code = String(data?.code || data?.error || (status === 451 ? 'disclaimer_required' : status === 402 ? 'chat_limit_reached' : 'ai_failed'));
  const known = ['chat_limit_reached', 'disclaimer_required', 'ai_unavailable'].includes(code);
  const message = known ? chatErrorText(code) : (typeof data?.message === 'string' ? data.message : chatErrorText(code));
  return new ChatError(code, message, { status, data });
}

function toAnswer(d: Record<string, unknown>, text: string): ChatAnswer {
  return {
    text,
    intent: typeof d.intent === 'string' ? d.intent : undefined,
    suggestLawyerSearch: !!d.suggestLawyerSearch,
    rightsRefs: Array.isArray(d.rights_refs) ? (d.rights_refs as RightsRef[]) : undefined,
    replayed: !!d.replayed,
  };
}

/** Read the SSE body. Resolves with the final answer; rejects with ChatError. */
async function readStream(response: Response, onToken: (s: string) => void): Promise<ChatAnswer> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (isAbort(e)) throw new ChatError('stopped', '', { partial: text });
      throw new ChatError('connection_lost', chatErrorText('connection_lost'), { partial: text });
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === 'token' && typeof ev.text === 'string') {
        text += ev.text;
        onToken(ev.text);
      } else if (ev.type === 'done') {
        return toAnswer(ev, typeof ev.full_text === 'string' ? ev.full_text : text);
      } else if (ev.type === 'error') {
        const code = String(ev.code || 'ai_failed');
        throw new ChatError(code, typeof ev.message === 'string' ? ev.message : chatErrorText(code), { partial: text });
      }
    }
  }
  // The stream ended without a "done" frame: the connection dropped.
  throw new ChatError('connection_lost', chatErrorText('connection_lost'), { partial: text });
}

async function viaStream(body: ChatRequest, signal: AbortSignal, onToken: (s: string) => void): Promise<ChatAnswer | null> {
  const token = await getToken();
  const tz = deviceTimeZone();
  let response: Response;
  try {
    response = await fetch(API_BASE_URL + '/chat/stream', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': getLang(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(tz ? { 'X-Timezone': tz } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (isAbort(e)) throw new ChatError('stopped', '');
    return null; // could not connect: try the job path once
  }
  if (!response.ok || !response.body) {
    if (TERMINAL_STATUSES.has(response.status)) {
      const data = await response.json().catch(() => ({}));
      throw fromHttp(response.status, data as Record<string, unknown>);
    }
    return null;
  }
  return readStream(response, onToken);
}

async function viaJob(body: ChatRequest, signal: AbortSignal): Promise<ChatAnswer> {
  let jobId: string | undefined;
  try {
    const res = await api.post('/chat/ask', body, { signal });
    jobId = res.data?.jobId;
  } catch (e) {
    const err = e as { name?: string; code?: string; response?: { status: number; data: Record<string, unknown> } };
    if (isAbort(e) || err.code === 'ERR_CANCELED') throw new ChatError('stopped', '');
    if (err.response) throw fromHttp(err.response.status, err.response.data || {});
    throw new ChatError('offline', chatErrorText('offline'));
  }
  if (!jobId) throw new ChatError('ai_failed', chatErrorText('ai_failed'));
  try {
    const job = await pollJob(jobId, { signal, timeoutMs: 90_000 });
    const d = (job.result || {}) as Record<string, unknown>;
    const text = typeof d.reply === 'string' ? d.reply : '';
    if (!text) throw new ChatError('ai_failed', chatErrorText('ai_failed'));
    return toAnswer(d, text);
  } catch (e) {
    if (e instanceof ChatError) throw e;
    if (e instanceof JobError) throw new ChatError(e.code === 'aborted' ? 'stopped' : e.code, e.message);
    throw new ChatError('ai_failed', chatErrorText('ai_failed'));
  }
}

/** Streams on web; the job path on native or when the stream cannot start. */
export async function askChat(body: ChatRequest, { signal, onToken }: { signal: AbortSignal; onToken: (s: string) => void }): Promise<ChatAnswer> {
  const canStream = Platform.OS === 'web' && typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
  if (canStream) {
    const streamed = await viaStream(body, signal, onToken);
    if (streamed) return streamed;
  }
  return viaJob(body, signal);
}
