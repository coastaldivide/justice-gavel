/**
 * aiClient.js — every Anthropic Messages API call goes through here.
 *
 *   anthropicFetch(init, { route, userId, timeoutMs, retries, stream, signal })
 *
 * Drop-in for `fetch(API_URLS.ANTHROPIC, init)`: same init (method, headers,
 * body), returns a Response the caller reads exactly as before. On top it:
 *   1. refuses the call when today's AI budget is spent (services/aiBudget.js)
 *      — returns a synthetic 503 Response, so the caller's normal
 *      "AI unavailable" path runs; routes that mount requireAi() already
 *      answered 503 ai_unavailable before getting here;
 *   2. bounds the call with a timeout (default 60 s; streams: 30 s to the
 *      first byte, the caller bounds the stream) and retries transient
 *      failures (429 / 5xx / 529 / network) up to `retries` times (default 2)
 *      with backoff — a completion writes nothing, so a retry is safe;
 *   3. meters usage: input/output tokens → cost → ai_usage_log and the daily
 *      total. Streams are metered by the caller via recordAiUsage() (the
 *      token counts arrive in the stream's message_start / message_delta).
 *
 * The Anthropic SDK clients (aiQueue, questionExplainer) use anthropicSdk(),
 * which carries the same timeout/retry settings, plus meterSdkResponse().
 */
import Anthropic from '@anthropic-ai/sdk';
import { fetchWithTimeout } from '../utils/http.js';
import { ANTHROPIC_MESSAGES_URL, CLAUDE_MODEL, aiConfigured } from '../utils/ai.js';
import { assertAiBudget, recordAiUsage, AI_BUDGET_BODY, AiBudgetExceededError } from './aiBudget.js';
import logger from '../utils/logger.js';

export const AI_TIMEOUT_MS = 60_000;
export const AI_MAX_RETRIES = 2;

function budgetResponse() {
  return new Response(JSON.stringify({ type: 'error', error: { type: 'budget_exceeded', message: AI_BUDGET_BODY.message }, ...AI_BUDGET_BODY }), {
    status: 503, headers: { 'content-type': 'application/json', 'x-ai-budget': 'exhausted' },
  });
}

function modelOf(init) {
  try { return JSON.parse(init?.body || '{}').model || CLAUDE_MODEL; } catch { return CLAUDE_MODEL; }
}

export async function anthropicFetch(init = {}, {
  route = 'unknown', userId = null, timeoutMs = AI_TIMEOUT_MS, retries = AI_MAX_RETRIES,
  stream = false, fetchImpl,
} = {}) {
  try {
    await assertAiBudget();
  } catch (e) {
    if (e instanceof AiBudgetExceededError) {
      logger.warn({ route, userId }, '[ai] call refused — daily AI budget reached');
      return budgetResponse();
    }
    throw e;
  }
  const model = modelOf(init);
  const t0 = Date.now();
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
  headers['x-api-key'] = process.env.ANTHROPIC_API_KEY ?? '';
  const res = await fetchWithTimeout(ANTHROPIC_MESSAGES_URL, { method: 'POST', ...init, headers }, {
    timeoutMs: stream ? Math.min(timeoutMs, 30_000) : timeoutMs,
    retries,
    bodyTimeout: !stream,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  if (stream) return res;
  if (!res.ok) {
    await recordAiUsage({ route, userId, model, durationMs: Date.now() - t0, status: 'failed' });
    return res;
  }
  const data = await res.json();
  await recordAiUsage({
    route, userId, model: data?.model || model,
    inputTokens: data?.usage?.input_tokens, outputTokens: data?.usage?.output_tokens,
    durationMs: Date.now() - t0, status: 'completed',
  });
  return new Response(JSON.stringify(data), { status: res.status, headers: { 'content-type': 'application/json' } });
}

/**
 * Parse usage out of Anthropic SSE events for streamed calls:
 *   const meter = streamUsageMeter();  … meter.onEvent(parsed) …
 *   await meter.record({ route, userId, model, status })
 */
export function streamUsageMeter() {
  const t0 = Date.now();
  let inputTokens = 0, outputTokens = 0, model = null;
  return {
    onEvent(ev) {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'message_start') {
        model = ev.message?.model || model;
        inputTokens = ev.message?.usage?.input_tokens ?? inputTokens;
        outputTokens = ev.message?.usage?.output_tokens ?? outputTokens;
      } else if (ev.type === 'message_delta' && ev.usage) {
        outputTokens = ev.usage.output_tokens ?? outputTokens;
        if (ev.usage.input_tokens != null) inputTokens = ev.usage.input_tokens;
      }
    },
    record({ route, userId, model: fallbackModel = CLAUDE_MODEL, status = 'completed' }) {
      return recordAiUsage({ route, userId, model: model || fallbackModel, inputTokens, outputTokens, durationMs: Date.now() - t0, status });
    },
  };
}

let _sdk = null;
/** Anthropic SDK client with the same timeout / retry policy. */
export function anthropicSdk() {
  if (!aiConfigured()) {
    const e = new Error('AI provider not configured (ANTHROPIC_API_KEY missing)');
    e.status = 503; e.code = 'ai_unavailable';
    throw e;
  }
  if (!_sdk) _sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES });
  return _sdk;
}

/** messages.create via the SDK, budget-checked and metered. */
export async function sdkMessagesCreate(params, { route = 'unknown', userId = null } = {}) {
  await assertAiBudget();   // throws AiBudgetExceededError (status 503)
  const t0 = Date.now();
  try {
    const res = await anthropicSdk().messages.create(params);
    const cost = await recordAiUsage({
      route, userId, model: res?.model || params?.model,
      inputTokens: res?.usage?.input_tokens, outputTokens: res?.usage?.output_tokens,
      durationMs: Date.now() - t0, status: 'completed',
    });
    return Object.assign(res, { _cost_usd: cost, _duration_ms: Date.now() - t0 });
  } catch (e) {
    await recordAiUsage({ route, userId, model: params?.model, durationMs: Date.now() - t0, status: 'failed' });
    throw e;
  }
}
