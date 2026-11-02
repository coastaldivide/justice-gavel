/**
 * aiClient.js — the AI gateway. Every Anthropic Messages API call goes through here.
 *
 *   aiMessage({ task, system, messages, … })   one answer (text, or schema-checked JSON)
 *   aiStream({ task, system, messages, … })    a streamed answer (chat), read with .read()
 *   anthropicFetch(init, opts)                 low-level metered transport (kept for callers
 *                                              and tests that speak raw request bodies)
 *
 * What the gateway adds to every call (docs/AI_PLATFORM.md has the full story):
 *   1. Routing — the task names a class (ai/tasks.js: quick / standard / deep) which picks the
 *      model, output_config.effort and thinking (display "omitted": thinking text is never
 *      returned to a person). No call site names a model.
 *   2. Structured output — tasks with a schema send output_config.format (ai/schemas); the text
 *      is parsed and validated, and an answer that fails validation is never shown or saved
 *      (code ai_invalid_output).
 *   3. Refusals — stop_reason "refusal" is a first-class outcome (code ai_refused): nothing is
 *      saved, partial streamed text is discarded, the refusal is metered under the documented
 *      billing rule. Fallback: server-side `fallbacks: "default"` where the model supports it,
 *      else one client-side retry on AI_FALLBACK_MODEL (ai/tasks.js fallbackMode()).
 *   4. Prompt caching — system parts marked { cache: '1h' | '5m' } get cache_control
 *      breakpoints; `cacheConversation: true` adds top-level automatic caching for multi-turn
 *      history. Cache reads/writes are metered at their own prices (ai/pricing.js).
 *   5. Preflight — large requests (documents, images, or an estimate ≥ AI_COUNT_TOKENS_THRESHOLD)
 *      are counted with POST /v1/messages/count_tokens; smaller ones use a documented
 *      chars ÷ 3 estimate. A request over AI_MAX_INPUT_TOKENS, over AI_MAX_REQUEST_USD worst
 *      case, or over what is left of today's budget is refused before it is sent
 *      (code ai_too_large).
 *   6. Budget + metering + tracing — daily cap (services/aiBudget.js); one ai_usage_log row per
 *      attempt with task, class, requested/served model, tokens (input, output, cache read,
 *      cache write 5m / 1h), cost, latency, stop reason, refusal + category, error code,
 *      request-id and (AI_TRACE_PROPAGATION=on) the W3C trace id sent as `traceparent`.
 *   7. Timeouts and retries — per attempt (default 60 s, streams 30 s to first byte) and up to
 *      2 retries of transient failures (429 / 5xx / 529 / network). A completion writes
 *      nothing, so a retry is safe.
 *
 * Request shapes follow the official docs (read 2026-11-02):
 *   structured outputs  https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 *   prompt caching      https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 *   effort              https://platform.claude.com/docs/en/build-with-claude/effort
 *   thinking            https://platform.claude.com/docs/en/build-with-claude/thinking
 *   token counting      https://platform.claude.com/docs/en/build-with-claude/token-counting
 *   refusals/fallback   https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
 *   citations           https://platform.claude.com/docs/en/build-with-claude/citations
 *   search results      https://platform.claude.com/docs/en/build-with-claude/search-results
 *     (read 2026-11-02 — `search_result` blocks with `citations: { enabled: true }` in the user turn,
 *     no beta header; responses carry text blocks with `citations` / streams `citations_delta`;
 *     citations + output_config.format is a 400, so buildRequest() refuses to combine them.
 *     Parsing and verification: ai/citations.js.)
 * Privacy: prompts and documents are never logged — only ids, sizes, token counts.
 */
import { randomBytes } from 'crypto';
import { fetchWithTimeout } from '../utils/http.js';
import { ANTHROPIC_BASE_URL, ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, CLAUDE_MODEL } from '../utils/ai.js';
import {
  assertAiBudget, recordAiUsage, budgetStatus, AI_BUDGET_BODY, AiBudgetExceededError,
} from './aiBudget.js';
import { taskDef, classConfig, normalizeEffort, normalizeThinking, serverFallbackSupported, fallbackMode, clientFallbackModel } from '../ai/tasks.js';
import { outputFormat, parseStructured } from '../ai/schemas/index.js';
import { hasFileSources } from '../ai/media.js';
import { costUsd, ratesFor, responseCostUsd, tokensOf } from '../ai/pricing.js';
import logger from '../utils/logger.js';
import { msg } from '../i18n/index.js';

export const AI_TIMEOUT_MS = 60_000;
export const AI_MAX_RETRIES = 2;
export const COUNT_TOKENS_URL = `${ANTHROPIC_MESSAGES_URL}/count_tokens`;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/**
 * Files API (AI step 4) — https://platform.claude.com/docs/en/build-with-claude/files (read 2026-11-02):
 * the Files page says the API is out of beta and the header is optional (with it, list responses
 * keep the legacy shape); the vision page (same date) still says image `file` sources need it. A
 * request that references a file_id therefore sends it (harmless per the Files page); the Files
 * endpoints themselves are called without it (services/aiFiles.js). Live check: LIVE_TEST.md §O.
 */
export const FILES_BETA = 'files-api-2025-04-14';

/** Codes a person can be shown (worded in i18n ai.job.<code>). */
export const AI_ERROR_CODES = Object.freeze(['ai_unavailable', 'ai_busy', 'ai_timeout', 'ai_failed', 'ai_refused', 'ai_too_large', 'ai_invalid_output']);

export class AiError extends Error {
  constructor(code, message = code, extra = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * What went wrong with an AI call, in words a person can be shown (the upstream body is
 * logged, never shown):
 *   ai_unavailable    no / invalid key, daily budget spent (503 / 401 / 403)
 *   ai_busy           the provider is rate-limiting or overloaded (429 / 529 / 5xx)
 *   ai_timeout        no answer in time
 *   ai_refused        the model declined (stop_reason "refusal") and no fallback answered
 *   ai_too_large      refused before sending: too many tokens / over the per-request or daily cap
 *   ai_invalid_output the answer did not match its schema (or was cut off) — not shown
 *   ai_failed         anything else
 */
export function aiErrorCode(err) {
  if (!err) return 'ai_failed';
  if (AI_ERROR_CODES.includes(err.code)) return err.code;
  if (err instanceof AiBudgetExceededError || err.code === 'budget_exceeded' || err.code === 'ai_budget_exceeded') return 'ai_unavailable';
  if (err.code === 'ETIMEDOUT' || err.name === 'TimeoutError' || /timed out/i.test(String(err.message))) return 'ai_timeout';
  // The AI service could not be reached at all (refused / DNS / reset): temporary.
  if (err.name === 'APIConnectionError' || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(err.code)
    || /connection error|fetch failed|socket hang up|ECONNREFUSED|ENOTFOUND/i.test(String(err.message))) return 'ai_busy';
  const status = Number(err.status ?? err.statusCode ?? (/\b([45]\d\d)\b/.exec(String(err.message || '')) || [])[1]);
  if (status === 503 || status === 401 || status === 403) return 'ai_unavailable';
  if (status === 429 || status === 529 || (status >= 500 && status < 600)) return 'ai_busy';
  return 'ai_failed';
}

/** HTTP status for an AI error code on a synchronous route. */
export function aiErrorStatus(code) {
  return { ai_refused: 422, ai_too_large: 413, ai_invalid_output: 502, ai_failed: 500 }[code] ?? 503;
}

/** Answer a synchronous route's AI failure: { error, code, message } in the request language. */
export function sendAiError(res, lang, err) {
  const code = aiErrorCode(err);
  return res.status(aiErrorStatus(code)).json({ error: code, code, message: msg(lang, `ai.job.${code}`) });
}

/** An Error for a non-2xx Anthropic response: status + code, upstream text only in the log. */
export async function aiHttpError(res, route = 'unknown') {
  const body = await res.text().catch(() => '');
  logger.warn({ route, status: res.status, body: body.slice(0, 300) }, '[ai] upstream error');
  const e = new Error(`AI provider error ${res.status}`);
  e.status = res.status;
  e.code = aiErrorCode(e);
  return e;
}

function budgetResponse() {
  return new Response(JSON.stringify({ type: 'error', error: { type: 'budget_exceeded', message: AI_BUDGET_BODY.message }, ...AI_BUDGET_BODY }), {
    status: 503, headers: { 'content-type': 'application/json', 'x-ai-budget': 'exhausted' },
  });
}

const str = (v) => String(v ?? '').trim();
const num = (v, d) => { const n = Number(str(v)); return str(v) !== '' && Number.isFinite(n) && n > 0 ? n : d; };

// ── Tracing ───────────────────────────────────────────────────────────────────
/**
 * AI_TRACE_PROPAGATION=on sends a W3C `traceparent` header on every call (the SDK's OpenTelemetry
 * integration sends the same header; we use raw fetch, so the gateway writes it) and stores the
 * trace id in ai_usage_log so a call can be matched with the API's own trace. The response's
 * `request-id` header is always stored.
 */
function traceHeaders() {
  if (str(process.env.AI_TRACE_PROPAGATION).toLowerCase() !== 'on') return { traceId: null, headers: {} };
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  return { traceId, headers: { traceparent: `00-${traceId}-${spanId}-01` } };
}

// ── Transport ─────────────────────────────────────────────────────────────────
function post(url, payload, extraHeaders, { timeoutMs = AI_TIMEOUT_MS, retries = AI_MAX_RETRIES, stream = false, signal, fetchImpl } = {}) {
  const headers = { 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION };
  for (const [k, v] of Object.entries(extraHeaders || {})) headers[k.toLowerCase()] = v;
  headers['x-api-key'] = process.env.ANTHROPIC_API_KEY ?? '';
  return fetchWithTimeout(url, {
    method: 'POST', headers, body: typeof payload === 'string' ? payload : JSON.stringify(payload), ...(signal ? { signal } : {}),
  }, {
    timeoutMs: stream ? Math.min(timeoutMs, 30_000) : timeoutMs,
    retries,
    bodyTimeout: !stream,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

function modelOf(init) {
  try { return JSON.parse(init?.body || '{}').model || CLAUDE_MODEL; } catch { return CLAUDE_MODEL; }
}

/**
 * Drop-in for `fetch(API_URLS.ANTHROPIC, init)` (budget-checked, timed out, retried, metered).
 * Returns a Response. Prefer aiMessage(): this path has no routing or schema.
 */
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
  const res = await post(ANTHROPIC_MESSAGES_URL, init.body || '{}', init.headers, { timeoutMs, retries, stream, signal: init.signal, fetchImpl });
  if (stream) return res;
  if (!res.ok) {
    await recordAiUsage({ route, userId, model, durationMs: Date.now() - t0, status: 'failed', errorCode: `http_${res.status}` });
    return res;
  }
  const data = await res.json();
  const facts = responseFacts(data);
  await recordAiUsage({
    route, userId, model: facts.model || model, requestedModel: model, usage: data?.usage,
    costUsd: facts.cost, durationMs: Date.now() - t0, status: facts.refused ? 'refused' : 'completed',
    stopReason: facts.stopReason, refusal: facts.refused, refusalCategory: facts.category,
    fallbackModel: facts.fallbackModel, requestId: res.headers.get('request-id'),
  });
  return new Response(JSON.stringify(data), { status: res.status, headers: { 'content-type': 'application/json' } });
}

/**
 * Any other Anthropic API call (Message Batches: create / retrieve / results / cancel — AI step 3,
 * services/aiBatch.js). `path` is under the API base (e.g. '/v1/messages/batches') or an absolute
 * results_url on the API host. Returns the Response; the caller reads it. Not metered here: batch
 * usage is metered per result when the results are read (at the batch price).
 */
export async function anthropicApi(method, path, { body, timeoutMs = AI_TIMEOUT_MS, retries = AI_MAX_RETRIES, headers: extra = {}, fetchImpl } = {}) {
  const url = /^https?:\/\//.test(path) ? path : `${ANTHROPIC_BASE_URL}${path}`;
  const headers = { 'anthropic-version': ANTHROPIC_VERSION };
  // A FormData body (Files API upload, multipart) sets its own content-type with the boundary.
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !multipart) headers['content-type'] = 'application/json';
  for (const [k, v] of Object.entries(extra || {})) headers[k.toLowerCase()] = v;
  headers['x-api-key'] = process.env.ANTHROPIC_API_KEY ?? '';
  return fetchWithTimeout(url, {
    method, headers, ...(body !== undefined ? { body: multipart || typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  }, { timeoutMs, retries, ...(fetchImpl ? { fetchImpl } : {}) });
}

// ── Response reading ──────────────────────────────────────────────────────────
/** The visible answer: every `text` block joined (thinking / fallback blocks are skipped). */
export function responseText(data) {
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text).join('');
}

/**
 * The final answer of a response that used server tools (web fetch): the text blocks after the
 * last server_tool_use / *_tool_result block (Claude may write a line before it calls the tool;
 * structured output applies to its final answer). Without tool blocks: every text block.
 */
export function finalText(content) {
  const blocks = Array.isArray(content) ? content : [];
  let last = -1;
  blocks.forEach((b, i) => { if (b?.type === 'server_tool_use' || /_tool_result$/.test(String(b?.type || ''))) last = i; });
  return blocks.slice(last + 1).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
}

/** Facts the gateway needs from a non-streamed response. */
export function responseFacts(data, requestedModel = null) {
  const stopReason = data?.stop_reason ?? null;
  const refused = stopReason === 'refusal' || data?.stop_details?.type === 'refusal';
  const category = refused ? data?.stop_details?.category ?? null : null;
  const fb = (Array.isArray(data?.content) ? data.content : []).find((b) => b?.type === 'fallback');
  const model = data?.model || requestedModel;
  const fallbackModel = fb?.to?.model || (requestedModel && model && model !== requestedModel ? model : null);
  const cost = responseCostUsd({ model, usage: data?.usage, stopReason, refusalCategory: category, triggerCategory: fb?.trigger?.category ?? null });
  return { stopReason, refused, category, model, fallbackModel, triggerCategory: fb?.trigger?.category ?? null, cost };
}

// ── Request building ──────────────────────────────────────────────────────────
/** Does any user message carry search results / documents with citations enabled? */
export function hasCitableBlocks(messages) {
  const on = (b) => (b?.type === 'search_result' || b?.type === 'document') && b.citations?.enabled === true;
  for (const m of Array.isArray(messages) ? messages : []) {
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (on(b)) return true;
      if (b?.type === 'tool_result' && Array.isArray(b.content) && b.content.some(on)) return true;
    }
  }
  return false;
}

/**
 * system: a string, or parts [{ text, cache?: '1h' | '5m' }]. A part with `cache` ends with a
 * cache_control breakpoint (prompt-caching page: max 4 breakpoints, 1h ones before 5m ones,
 * prefix order tools → system → messages, minimum 512 tokens on the 5.5 models — shorter
 * prefixes are simply not cached).
 */
export function systemBlocks(system) {
  if (system == null || system === '') return undefined;
  if (typeof system === 'string') return system;
  const cacheOn = str(process.env.AI_CACHE).toLowerCase() !== 'off';
  let seen5m = false;
  const blocks = system.filter((p) => p && String(p.text || '').length).map((p) => {
    const b = { type: 'text', text: String(p.text) };
    let ttl = p.cache === 'chat' ? chatCacheTtl() : p.cache;
    if (ttl === '1h' && seen5m) ttl = '5m';          // longer TTLs must come first
    if (cacheOn && (ttl === '1h' || ttl === '5m')) {
      b.cache_control = ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
      if (ttl === '5m') seen5m = true;
    }
    return b;
  });
  return blocks.length ? blocks : undefined;
}

/** AI_CHAT_CACHE_TTL: '1h' (default — see the break-even in docs/AI_PLATFORM.md) or '5m'. */
export function chatCacheTtl() {
  return str(process.env.AI_CHAT_CACHE_TTL).toLowerCase() === '5m' ? '5m' : '1h';
}

/**
 * The request body + headers for a task. Pure (no I/O) — tests call it directly.
 *   { task, system, messages, maxTokens?, schema?, cacheConversation?, stream?, model? }
 * `model` is for the evaluation scripts only (they compare models on purpose).
 */
export function buildRequest({ task, system, messages, maxTokens, schema, cacheConversation = false, stream = false, model: modelOverride = null, fallback = true, tools = null, batch = false }) {
  if (batch && stream) throw new AiError('ai_failed', 'a batch request cannot stream');
  const def = taskDef(task);
  const cfg = classConfig(def.cls);
  const model = modelOverride || cfg.model;
  const effort = normalizeEffort(model, cfg.effort);
  const thinking = normalizeThinking(model, cfg.thinking, effort);
  const thinkingOn = thinking?.type === 'adaptive' || (thinking === null && /^claude-(opus|sonnet|haiku)-5/.test(model));
  const visible = Math.max(1, Math.round(maxTokens ?? def.maxTokens));
  const body = {
    model,
    max_tokens: visible + (thinkingOn ? cfg.headroom : 0),
    // Server tools (web fetch — AI step 3) come first: the cache prefix order is tools → system → messages.
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
    ...(systemBlocks(system) !== undefined ? { system: systemBlocks(system) } : {}),
    messages,
  };
  if (thinking) body.thinking = thinking;
  const schemaName = schema ?? def.schema ?? null;
  const citations = hasCitableBlocks(messages);
  // The citations page: enabling citations together with output_config.format is a 400. A cited
  // answer is prose; structured output is used only where nothing needs a citation.
  if (citations && schemaName) throw new AiError('ai_failed', 'citations cannot be combined with structured outputs');
  const output = {};
  if (effort) output.effort = effort;
  if (schemaName) output.format = outputFormat(schemaName);
  if (Object.keys(output).length) body.output_config = output;
  if (cacheConversation && str(process.env.AI_CACHE).toLowerCase() !== 'off') body.cache_control = { type: 'ephemeral' };
  if (stream) body.stream = true;
  const headers = {};
  // Message Batches reject `fallbacks` (batch-processing page), so a batch request never carries it.
  const useServerFallback = !batch && fallback && def.fallback !== false && fallbackMode() === 'auto' && serverFallbackSupported(model);
  const betas = [];
  if (useServerFallback) {
    body.fallbacks = 'default';
    betas.push(FALLBACK_BETA);
  }
  if (hasFileSources(messages)) betas.push(FILES_BETA);
  if (betas.length) headers['anthropic-beta'] = betas.join(',');
  return { body, headers, task: def.task, cls: def.cls, model, schemaName, citations, serverFallback: useServerFallback };
}

// ── Preflight: token counting + caps ──────────────────────────────────────────
const textLen = (c) => {
  if (typeof c === 'string') return { chars: c.length, heavy: 0 };
  let chars = 0, heavy = 0;
  for (const b of Array.isArray(c) ? c : []) {
    if (b?.type === 'text') chars += String(b.text || '').length;
    else if (b?.type === 'search_result') {
      // title + every text block (the docs: citations add a little input for chunking — errs high with ÷3)
      chars += String(b.title || '').length + String(b.source || '').length + 40;
      for (const c of Array.isArray(b.content) ? b.content : []) chars += String(c?.text || '').length + 8;
    } else if (b?.type === 'tool_result') {
      const r = textLen(b.content); chars += r.chars; heavy += r.heavy;
    } else if (b?.type === 'image') heavy += 1600;                 // vision: ≤ ~1,600 tokens per image
    else if (b?.type === 'document') heavy += Math.max(3000, Math.ceil(String(b.source?.data || '').length * 0.75 / 30));
  }
  return { chars, heavy };
};

/**
 * Local estimate of input tokens: characters ÷ 3 (the 5.x tokenizer gives ~30 % more tokens than
 * the old ~4 chars/token rule, so ÷3 errs high), images 1,600 each, PDFs ~1 token per 30 bytes
 * (min 3,000). `heavy` = the request has images / documents (estimate unreliable → count).
 */
export function estimateInputTokens(body) {
  let chars = 0, heavy = 0;
  const sys = body.system;
  if (typeof sys === 'string') chars += sys.length;
  else for (const b of sys || []) chars += String(b?.text || '').length;
  for (const m of body.messages || []) { const r = textLen(m.content); chars += r.chars; heavy += r.heavy; }
  for (const t of body.tools || []) chars += JSON.stringify(t).length;
  if (body.output_config?.format) chars += JSON.stringify(body.output_config.format).length;
  return { tokens: Math.ceil(chars / 3) + heavy, heavy: heavy > 0 };
}

/** POST /v1/messages/count_tokens (free; separate rate limit). Returns input_tokens or null. */
export async function countTokens(body, { fetchImpl, timeoutMs = 10_000 } = {}) {
  const payload = {};
  for (const k of ['model', 'messages', 'system', 'tools', 'thinking', 'output_config', 'cache_control', 'tool_choice']) {
    if (body[k] !== undefined) payload[k] = body[k];
  }
  try {
    const res = await post(COUNT_TOKENS_URL, payload, hasFileSources(body.messages) ? { 'anthropic-beta': FILES_BETA } : {}, { timeoutMs, retries: 1, fetchImpl });
    if (!res.ok) { await res.text().catch(() => ''); return null; }
    const data = await res.json();
    return Number.isFinite(Number(data?.input_tokens)) ? Number(data.input_tokens) : null;
  } catch (e) {
    logger.warn({ err: e.message }, '[ai] token count failed — using the local estimate');
    return null;
  }
}

export function preflightLimits() {
  return {
    countThreshold: num(process.env.AI_COUNT_TOKENS_THRESHOLD, 20_000),
    maxInputTokens: num(process.env.AI_MAX_INPUT_TOKENS, 150_000),
    maxRequestUsd: num(process.env.AI_MAX_REQUEST_USD, 2),
  };
}

/**
 * Refuse an oversized request before it is sent. Worst case = every input token uncached at
 * the input rate + max_tokens of output. Throws AiError ai_too_large / AiBudgetExceededError.
 */
export async function preflight(body, { route, fetchImpl } = {}) {
  const lim = preflightLimits();
  const est = estimateInputTokens(body);
  let inputTokens = est.tokens, method = 'estimated';
  if (est.heavy || est.tokens >= lim.countThreshold) {
    const counted = await countTokens(body, { fetchImpl });
    if (counted != null) { inputTokens = counted; method = 'counted'; }
  }
  const r = ratesFor(body.model, inputTokens);
  const worstUsd = (inputTokens * r.input + (body.max_tokens || 0) * r.output) / 1_000_000;
  const out = { inputTokens, method, worstUsd };
  if (inputTokens > lim.maxInputTokens) {
    logger.warn({ route, inputTokens, method, limit: lim.maxInputTokens }, '[ai] request refused before sending — too many input tokens');
    throw new AiError('ai_too_large', 'input too large', { preflight: out, reason: 'max_input_tokens' });
  }
  if (worstUsd > lim.maxRequestUsd) {
    logger.warn({ route, inputTokens, worstUsd, limit: lim.maxRequestUsd }, '[ai] request refused before sending — over the per-request cost cap');
    throw new AiError('ai_too_large', 'request too expensive', { preflight: out, reason: 'max_request_usd' });
  }
  const b = await budgetStatus();
  if (b.exhausted) throw new AiBudgetExceededError(b);
  if (b.remaining_usd != null && worstUsd > b.remaining_usd) {
    logger.warn({ route, worstUsd, remaining: b.remaining_usd }, '[ai] request refused before sending — larger than what is left of today\'s budget');
    throw new AiError('ai_too_large', 'over remaining budget', { preflight: out, reason: 'daily_budget_remaining' });
  }
  return out;
}

// ── aiMessage ─────────────────────────────────────────────────────────────────
/**
 * One non-streamed answer.
 *   aiMessage({ task, system, messages, maxTokens?, schema?, cacheConversation?, route?, userId?,
 *               signal?, timeoutMs?, retries?, model?, fetchImpl? })
 *   → { text, json, model, requestedModel, stopReason, usage, costUsd, durationMs, fallbackModel, task, cls }
 * Throws AiError (code in AI_ERROR_CODES) — never returns refused, truncated-JSON or invalid output.
 */
export async function aiMessage(opts) {
  const { route = opts.task, userId = null, signal, timeoutMs = AI_TIMEOUT_MS, retries = AI_MAX_RETRIES, fetchImpl } = opts;
  const req = buildRequest(opts);
  const first = await attempt(req, { route, userId, signal, timeoutMs, retries, fetchImpl });
  if (first.kind === 'refused' && !req.serverFallback && fallbackMode() === 'auto' && first.category !== 'reasoning_extraction') {
    const fbModel = clientFallbackModel();
    if (fbModel && fbModel !== req.model) {
      logger.info({ route, task: req.task, fromModel: req.model, toModel: fbModel, category: first.category }, '[ai] refusal — retrying once on the fallback model');
      const retryReq = buildRequest({ ...opts, model: fbModel, fallback: false });
      retryReq.cls = req.cls; retryReq.fallbackFrom = req.model;
      const second = await attempt(retryReq, { route, userId, signal, timeoutMs, retries, fetchImpl, declinedBefore: true });
      return finish(second, retryReq, route);
    }
  }
  return finish(first, req, route);
}

function finish(a, req, route) {
  if (a.kind === 'refused') {
    throw new AiError('ai_refused', 'the model declined this request', { category: a.category, route });
  }
  return a.result;
}

async function attempt(req, { route, userId, signal, timeoutMs, retries, fetchImpl }) {
  let pre;
  try {
    pre = await preflight(req.body, { route, fetchImpl });
  } catch (e) {
    if (e instanceof AiBudgetExceededError) logger.warn({ route, userId }, '[ai] call refused — daily AI budget reached');
    throw e;
  }
  const trace = traceHeaders();
  const t0 = Date.now();
  const meta = {
    route, userId, task: req.task, taskClass: req.cls, requestedModel: req.fallbackFrom || req.model,
    traceId: trace.traceId, inputTokensEstimated: pre.inputTokens, preflightMethod: pre.method,
  };
  let res;
  try {
    res = await post(ANTHROPIC_MESSAGES_URL, req.body, { ...req.headers, ...trace.headers }, { timeoutMs, retries, signal, fetchImpl });
  } catch (e) {
    const code = aiErrorCode(e);
    await recordAiUsage({ ...meta, model: req.model, durationMs: Date.now() - t0, status: 'failed', errorCode: code });
    throw new AiError(code, e?.message || code, { cause: e, name: e?.name === 'AbortError' ? 'AbortError' : 'AiError' });
  }
  const requestId = res.headers?.get?.('request-id') ?? null;
  if (!res.ok) {
    const err = await aiHttpError(res, route);
    await recordAiUsage({ ...meta, model: req.model, durationMs: Date.now() - t0, status: 'failed', errorCode: err.code, requestId });
    throw err;
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    const code = aiErrorCode(e) === 'ai_timeout' ? 'ai_timeout' : 'ai_failed';
    await recordAiUsage({ ...meta, model: req.model, durationMs: Date.now() - t0, status: 'failed', errorCode: code, requestId });
    throw new AiError(code, 'unreadable AI response');
  }
  const durationMs = Date.now() - t0;
  const f = responseFacts(data, req.model);
  const fallbackModel = req.fallbackFrom ? f.model : f.fallbackModel;
  const usageRow = {
    ...meta, model: f.model, usage: data.usage, costUsd: f.cost, durationMs, stopReason: f.stopReason,
    refusal: f.refused || !!f.triggerCategory, refusalCategory: f.category ?? f.triggerCategory, fallbackModel, requestId,
  };
  if (f.refused) {
    // Client-side fallback still to come → this attempt is 'declined', else the final 'refused'.
    const willRetry = !req.serverFallback && fallbackMode() === 'auto' && f.category !== 'reasoning_extraction'
      && !req.fallbackFrom && clientFallbackModel() !== req.model;
    await recordAiUsage({ ...usageRow, status: willRetry ? 'declined' : 'refused' });
    logger.warn({ route, task: req.task, model: f.model, category: f.category }, '[ai] model declined the request');
    return { kind: 'refused', category: f.category };
  }
  const text = responseText(data);
  let json = null;
  let invalid = null;
  if (req.schemaName) {
    if (f.stopReason === 'max_tokens') invalid = 'max_tokens';
    else {
      const parsed = parseStructured(req.schemaName, text);
      if (parsed.ok) json = parsed.value; else invalid = parsed.errors.slice(0, 5).join('; ');
    }
  } else if (!text.trim()) invalid = 'empty';
  if (invalid) {
    await recordAiUsage({ ...usageRow, status: 'invalid', errorCode: 'ai_invalid_output' });
    logger.warn({ route, task: req.task, stopReason: f.stopReason, problem: invalid, chars: text.length }, '[ai] answer failed validation — not shown');
    throw new AiError(req.schemaName ? 'ai_invalid_output' : 'ai_failed', 'AI answer failed validation');
  }
  const cost = await recordAiUsage({ ...usageRow, status: 'completed' });
  return {
    kind: 'ok',
    result: {
      text, json, content: Array.isArray(data.content) ? data.content : [], model: f.model, requestedModel: meta.requestedModel, stopReason: f.stopReason, usage: data.usage,
      costUsd: cost, durationMs, fallbackModel, task: req.task, cls: req.cls, requestId,
    },
  };
}

// ── aiStream ──────────────────────────────────────────────────────────────────
/**
 * A streamed answer. Throws AiError before streaming (budget, too large, upstream HTTP error).
 *   const s = await aiStream({ task, system, messages, route, userId, signal, cacheConversation });
 *   const out = await s.read((text) => …, { onBlock });   // { text, blocks, refused, category, stopReason, model, error }
 *     onBlock(block) — called when a text block is complete: { type: 'text', text, citations: [...] }
 *     (citations_delta events are collected into the block; a cited answer is shown block by block
 *     only after its citations were verified — ai/citations.js)
 *   await s.record(status)                    // meters the call (once)
 * Text deltas from thinking blocks never reach onText. With server-side fallback the fallback
 * model continues the same stream (a `fallback` content block marks the hand-off).
 */
export async function aiStream(opts) {
  const { route = opts.task, userId = null, signal, fetchImpl } = opts;
  const req = buildRequest({ ...opts, stream: true });
  const pre = await preflight(req.body, { route, fetchImpl });
  const trace = traceHeaders();
  const meter = streamUsageMeter({ requestedModel: req.model });
  const meta = { route, userId, task: req.task, taskClass: req.cls, requestedModel: req.model, traceId: trace.traceId,
    inputTokensEstimated: pre.inputTokens, preflightMethod: pre.method };
  let res;
  try {
    res = await post(ANTHROPIC_MESSAGES_URL, req.body, { ...req.headers, ...trace.headers }, { stream: true, signal, fetchImpl, timeoutMs: opts.timeoutMs ?? AI_TIMEOUT_MS });
  } catch (e) {
    const code = aiErrorCode(e);
    await recordAiUsage({ ...meta, model: req.model, durationMs: meter.elapsed(), status: 'failed', errorCode: code });
    throw new AiError(code, e?.message || code, { cause: e, name: e?.name === 'AbortError' ? 'AbortError' : 'AiError' });
  }
  const requestId = res.headers?.get?.('request-id') ?? null;
  if (!res.ok || !res.body) {
    const err = res.ok ? new AiError('ai_failed', 'no stream body') : await aiHttpError(res, route);
    await recordAiUsage({ ...meta, model: req.model, durationMs: meter.elapsed(), status: 'failed', errorCode: err.code, requestId });
    throw err;
  }
  let recorded = false;
  return {
    meter,
    request: req,
    async read(onText = () => {}, { onBlock } = {}) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let text = '';
      let error = null;
      const blocks = [];
      const open = new Map();   // content block index → text block being built
      // A delta for a block whose start we did not see (a lenient proxy / stub) still builds a block.
      const blockAt = (i) => { if (!open.has(i)) open.set(i, { type: 'text', text: '', citations: [] }); return open.get(i); };
      const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') return;
        let ev;
        try { ev = JSON.parse(raw); } catch { return; }
        if (!ev || typeof ev !== 'object') return;
        meter.onEvent(ev);
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
          open.set(ev.index, { type: 'text', text: String(ev.content_block.text || ''), citations: [...(ev.content_block.citations || [])] });
        } else if (ev.type === 'content_block_stop' && open.has(ev.index)) {
          const blk = open.get(ev.index);
          open.delete(ev.index);
          blocks.push(blk);
          if (onBlock) onBlock(blk);
        }
        // Only text_delta is answer text (thinking blocks stream thinking_delta / signature_delta).
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          const t = ev.delta.text ?? '';
          text += t;
          blockAt(ev.index).text += t;
          onText(t);
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'citations_delta') {
          if (ev.delta.citation) blockAt(ev.index).citations.push(ev.delta.citation);
        } else if (ev.type === 'error') {
          error = ev.error?.type === 'overloaded_error' || ev.error?.type === 'rate_limit_error' ? 'ai_busy' : 'ai_failed';
          logger.warn({ route, error: ev.error?.type }, '[ai] upstream stream error');
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
      pending += decoder.decode();
      if (pending) handleLine(pending);
      // blocks the stream never closed (cut off, or no content_block_stop) end here
      for (const blk of open.values()) { blocks.push(blk); if (onBlock) onBlock(blk); }
      open.clear();
      const s = meter.state();
      return { text, blocks, error, refused: s.refused, category: s.category, stopReason: s.stopReason, model: s.model };
    },
    async record(status) {
      if (recorded) return 0;
      recorded = true;
      return await meter.record({ ...meta, requestId, status });
    },
  };
}

/**
 * Usage + outcome of a streamed call, from its SSE events:
 *   message_start (model, usage incl. cache fields), content_block_start (fallback hand-off),
 *   message_delta (stop_reason, stop_details, final usage incl. iterations).
 *   const meter = streamUsageMeter();  … meter.onEvent(parsed) …  await meter.record({ route, userId, status })
 */
export function streamUsageMeter({ requestedModel = null } = {}) {
  const t0 = Date.now();
  const s = { model: null, usage: {}, stopReason: null, refused: false, category: null, fallbackModel: null, triggerCategory: null };
  const merge = (u) => { if (u && typeof u === 'object') for (const [k, v] of Object.entries(u)) if (v != null) s.usage[k] = v; };
  return {
    elapsed: () => Date.now() - t0,
    state: () => ({ ...s }),
    onEvent(ev) {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'message_start') {
        s.model = ev.message?.model || s.model;
        merge(ev.message?.usage);
      } else if (ev.type === 'content_block_start') {
        if (ev.content_block?.type === 'fallback') {
          s.fallbackModel = ev.content_block.to?.model || s.fallbackModel;
          s.triggerCategory = ev.content_block.trigger?.category ?? s.triggerCategory;
        }
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) s.stopReason = ev.delta.stop_reason;
        const sd = ev.delta?.stop_details;
        if (s.stopReason === 'refusal' || sd?.type === 'refusal') { s.refused = true; s.category = sd?.category ?? null; }
        merge(ev.usage);
      }
    },
    async record({ route = 'unknown', userId = null, model: fallback = CLAUDE_MODEL, status, ...meta } = {}) {
      const served = s.fallbackModel || s.model || requestedModel || fallback;
      const finalStatus = s.refused ? 'refused' : (status || 'completed');
      const usage = { ...s.usage };
      // Mid-stream the iterations array (when present) carries per-model usage; top level is the served attempt.
      const cost = responseCostUsd({ model: served, usage, stopReason: s.refused ? 'refusal' : s.stopReason, refusalCategory: s.category, triggerCategory: s.triggerCategory });
      return await recordAiUsage({
        route, userId, model: served, requestedModel: meta.requestedModel || requestedModel || s.model, usage, costUsd: cost,
        durationMs: Date.now() - t0, status: finalStatus, stopReason: s.stopReason, refusal: s.refused || !!s.triggerCategory,
        refusalCategory: s.category ?? s.triggerCategory, fallbackModel: s.fallbackModel,
        ...meta,
      });
    },
  };
}

// Re-exported for callers that estimate costs (admin tools, tests).
export { costUsd, tokensOf };
