/**
 * anthropic-mock-lib.mjs — the Messages API behaviour shared by scripts/anthropic-mock.mjs
 * (smoke / sweep / web journeys) and the jest integration harness, so every test speaks the
 * documented shapes (docs read 2026-11-02, see services/aiClient.js):
 *
 *   POST /v1/messages               JSON or SSE (stream: true)
 *   POST /v1/messages/count_tokens  { input_tokens }
 *
 * Faithful details:
 *   - structured outputs: output_config.format.schema → the text block is JSON for that schema
 *     (state.json when set, else a minimal valid instance);
 *   - adaptive thinking (Claude 5.x default): a `thinking` block with empty text + signature comes
 *     first (display "omitted"); streams send thinking_delta "" + signature_delta;
 *   - prompt caching: cache_control breakpoints (system blocks, top-level automatic) write the
 *     prefix on first sight (cache_creation_input_tokens + cache_creation.ephemeral_5m/1h) and
 *     read it afterwards (cache_read_input_tokens); input_tokens = the uncached rest;
 *   - refusals: stop_reason "refusal" + stop_details { type, category, explanation }; with
 *     `fallbacks` (beta server-side-fallback-2026-07-01) the fallback model answers, a `fallback`
 *     content block marks the hand-off and usage.iterations lists both attempts;
 *   - citations (search-results + citations pages): when the user turns carry `search_result`
 *     blocks with citations enabled, the answer is several text blocks — uncited connecting text
 *     and blocks with `citations: [{ type: 'search_result_location', source, title, cited_text,
 *     search_result_index, start_block_index, end_block_index }]` (index across every
 *     search_result in the request, in order); streams send `citations_delta` events inside
 *     the block. state.citeMode: auto (cite the newest results) | none (state.text, no
 *     citations) | foreign (citations to results that were never sent) | blocks (state.blocks
 *     verbatim: [{ text, citations? }]);
 *   - the request is checked like the real API (400 invalid_request_error): sampling params,
 *     thinking values per model, forced tool use / prefill on Opus 5.5 & Sonnet 5.5, fallbacks
 *     without the beta header or on Haiku 5.5, unsupported schema keywords, > 4 cache breakpoints,
 *     a 1h breakpoint after a 5m one.
 *
 * Modes (state.mode): ok | slow | long | 429 | 500 | 529 | 401 | drop | error_event | hang |
 *   refusal (declines; served by the fallback model when the request has `fallbacks`) |
 *   refusal_mid (streams some text, then declines — or hands off to the fallback model) |
 *   refusal_hard (declines even with fallbacks) | invalid_json | max_tokens
 * state.refuseModels: only these models decline (default: every model) — lets a test show the
 *   client-side retry on another model succeeding.
 */
import { sampleFor } from '../src/ai/schemas/index.js';

export const DEFAULT_TEXT = 'MOCK REPLY: this is general legal information, not legal advice.';
export const FALLBACK_MODEL = 'claude-opus-4-8';

export function freshState(extra = {}) {
  return { mode: 'ok', text: null, json: null, delayMs: 30, tokens: 40, category: 'general_harms', refuseModels: null, citeMode: 'auto', blocks: null, ...extra };
}

const caches = new Map();   // prefix key → ttl ('5m' | '1h')
let seq = 0;
export function resetCaches() { caches.clear(); }

const est = (s) => Math.ceil(String(s || '').length / 3);
const blockText = (b) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text
  : b?.type === 'search_result' ? `${b.title || ''} ${(b.content || []).map((c) => c?.text || '').join(' ')}`
  : b?.type ? JSON.stringify(b).slice(0, 4000) : '');
const contentText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(blockText).join('') : '');

/** Rough input tokens of a request body (chars ÷ 3; images 1,600). */
export function countInputTokens(body = {}) {
  let n = 0;
  const sys = body.system;
  n += typeof sys === 'string' ? est(sys) : (sys || []).reduce((a, b) => a + est(b?.text), 0);
  for (const m of body.messages || []) {
    if (Array.isArray(m.content)) for (const b of m.content) n += b?.type === 'image' ? 1600 : b?.type === 'document' ? 3000 : est(blockText(b));
    else n += est(m.content);
  }
  for (const t of body.tools || []) n += est(JSON.stringify(t));
  if (body.output_config?.format) n += est(JSON.stringify(body.output_config.format));
  return Math.max(1, n);
}

const UNSUPPORTED_SCHEMA = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'uniqueItems'];
function schemaProblem(s, p = '$') {
  if (!s || typeof s !== 'object') return null;
  for (const k of UNSUPPORTED_SCHEMA) if (k in s) return `${p}: '${k}' is not supported`;
  if ('minItems' in s && ![0, 1].includes(s.minItems)) return `${p}: minItems must be 0 or 1`;
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('object')) {
    if (s.additionalProperties !== false) return `${p}: objects must set additionalProperties: false`;
    for (const [k, v] of Object.entries(s.properties || {})) { const e = schemaProblem(v, `${p}.${k}`); if (e) return e; }
  }
  if (s.items) return schemaProblem(s.items, `${p}[]`);
  for (const v of s.anyOf || []) { const e = schemaProblem(v, p); if (e) return e; }
  return null;
}

/** Every search_result block of the request, in request order (user turns + tool results). */
export function searchResultsOf(body = {}) {
  const out = [];
  for (const m of body.messages || []) {
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b?.type === 'search_result') out.push({ block: b, role: m.role });
      else if (b?.type === 'tool_result' && Array.isArray(b.content)) for (const c of b.content) if (c?.type === 'search_result') out.push({ block: c, role: m.role });
    }
  }
  return out;
}
const citationsOn = (body) => searchResultsOf(body).some((r) => r.block.citations?.enabled === true)
  || (body.messages || []).some((m) => Array.isArray(m.content) && m.content.some((b) => b?.type === 'document' && b.citations?.enabled === true));

function searchResultProblem(body) {
  const all = searchResultsOf(body);
  for (const { block: b, role } of all) {
    if (role !== 'user') return 'search_result blocks can only appear in user messages';
    if (typeof b.source !== 'string' || !b.source) return 'search_result.source: field required';
    if (typeof b.title !== 'string' || !b.title) return 'search_result.title: field required';
    if (!Array.isArray(b.content) || !b.content.length) return 'search_result.content: field required';
    if (b.content.some((c) => c?.type !== 'text' || typeof c.text !== 'string' || !c.text)) return 'search_result.content: each item must be a non-empty text block';
  }
  for (const m of body.messages || []) {
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b?.type === 'tool_result' && Array.isArray(b.content) && b.content.some((c) => c?.type === 'search_result') && b.content.some((c) => c?.type !== 'search_result')) {
        return 'tool_result content mixing search_result with other block types is not allowed';
      }
    }
  }
  const docs = (body.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b?.type === 'document');
  const settings = new Set([...all.map((r) => r.block.citations?.enabled === true), ...docs.map((d) => d.citations?.enabled === true)]);
  if (settings.size > 1) return 'citations must be enabled on all or none of the search_result / document blocks';
  if (citationsOn(body) && body.output_config?.format) return 'citations are not supported together with output_config.format (structured outputs)';
  return null;
}

const fam = (m) => (/^claude-opus-5-5/.test(m) ? 'opus55' : /^claude-sonnet-5-5/.test(m) ? 'sonnet55' : /^claude-haiku-5-5/.test(m) ? 'haiku55' : 'other');

/** null, or the message of the 400 the real API would return. */
export function requestProblem(body, headers = {}) {
  if (!body || typeof body !== 'object') return 'body must be JSON';
  const model = String(body.model || '');
  if (!model) return 'model: field required';
  if (!Array.isArray(body.messages)) return 'messages: field required';
  if (!Number.isFinite(body.max_tokens) || body.max_tokens < 1) return 'max_tokens: must be a positive integer';
  for (const k of ['temperature', 'top_p', 'top_k']) if (k in body && /^claude-(opus|sonnet|haiku)-5/.test(model)) return `${k}: not supported on ${model}`;
  const f = fam(model);
  const t = body.thinking?.type;
  const effort = body.output_config?.effort;
  const high = ['xhigh', 'max'].includes(effort);
  if (t === 'enabled' && f !== 'other') return 'thinking.type "enabled" is not supported on this model; use "adaptive"';
  if (t === 'disabled' && (f === 'opus55' || f === 'sonnet55')) return `thinking.type "disabled" is not supported on ${model}`;
  if (t === 'disabled' && f === 'haiku55' && high) return 'thinking "disabled" is not allowed at effort xhigh/max';
  if (t === 'between_tools' && (f !== 'sonnet55' || high || Object.keys(body.thinking).length > 1)) return 'thinking.type "between_tools" is not valid here';
  if (body.thinking?.display && !['omitted', 'summarized'].includes(body.thinking.display)) return 'thinking.display: unknown value';
  if (effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) return 'output_config.effort: unknown value';
  const last = body.messages[body.messages.length - 1];
  if (last?.role === 'assistant') return 'prefilling the final assistant turn is not supported on this model';
  if ((f === 'opus55' || f === 'sonnet55') && ['any', 'tool'].includes(body.tool_choice?.type)) return 'forced tool use is not supported on this model';
  if ('output_format' in body) return 'output_format is deprecated; use output_config.format';
  const sr = searchResultProblem(body);
  if (sr) return sr;
  if (body.output_config?.format) {
    const fmt = body.output_config.format;
    if (fmt.type !== 'json_schema' || !fmt.schema) return 'output_config.format: type json_schema with a schema is required';
    const e = schemaProblem(fmt.schema);
    if (e) return `output_config.format.schema ${e}`;
  }
  if ('fallbacks' in body) {
    const beta = String(headers['anthropic-beta'] || '');
    if (!beta.split(',').map((x) => x.trim()).includes('server-side-fallback-2026-07-01')) return 'fallbacks requires the beta header server-side-fallback-2026-07-01';
    if (f === 'haiku55' && Array.isArray(body.fallbacks)) return 'fallbacks is not supported on claude-haiku-5-5';
    if (body.fallbacks !== 'default' && !Array.isArray(body.fallbacks)) return 'fallbacks must be "default" or a list';
  }
  // cache breakpoints
  let bps = body.cache_control ? 1 : 0;
  let seen5m = false;
  const sys = Array.isArray(body.system) ? body.system : [];
  const all = [...(body.tools || []), ...sys, ...body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))];
  for (const b of all) {
    if (!b?.cache_control) continue;
    bps += 1;
    if (b.cache_control.type !== 'ephemeral') return 'cache_control.type must be "ephemeral"';
    const ttl = b.cache_control.ttl || '5m';
    if (!['5m', '1h'].includes(ttl)) return 'cache_control.ttl must be "5m" or "1h"';
    if (ttl === '1h' && seen5m) return 'a 1h cache breakpoint cannot come after a 5m one';
    if (ttl === '5m') seen5m = true;
  }
  if (bps > 4) return 'a maximum of 4 blocks with cache_control may be provided';
  return null;
}

/** Usage for a request, applying cache breakpoints (writes on first sight, reads afterwards). */
export function usageFor(body, outputTokens) {
  const total = countInputTokens(body);
  const sys = Array.isArray(body.system) ? body.system : [];
  // Breakpoint positions in the system prefix (tools → system → messages)
  let prefix = '';
  let cachedUpTo = 0;
  let read = 0, w5 = 0, w1 = 0;
  for (const b of sys) {
    prefix += b.text || '';
    if (!b.cache_control) continue;
    const key = `${body.model}|${prefix}`;
    const tok = est(prefix);
    const ttl = b.cache_control.ttl || '5m';
    if (tok < 512) continue;                       // under the 5.5 models' minimum: not cached
    const add = tok - cachedUpTo;
    if (caches.has(key)) read += add; else { caches.set(key, ttl); if (ttl === '1h') w1 += add; else w5 += add; }
    cachedUpTo = tok;
  }
  if (body.cache_control) {                        // automatic: breakpoint on the last block
    const key = `${body.model}|${prefix}|${JSON.stringify(body.messages)}`;
    const tok = total - est(JSON.stringify(body.output_config?.format || ''));
    if (tok >= 512 && tok > cachedUpTo) {
      // a follow-up turn reads the earlier conversation: find the longest cached message prefix
      let best = 0;
      for (let i = body.messages.length - 1; i > 0; i--) {
        const k = `${body.model}|${prefix}|${JSON.stringify(body.messages.slice(0, i))}`;
        if (caches.has(k)) { best = est(prefix) + body.messages.slice(0, i).reduce((a, m) => a + est(contentText(m.content)), 0); break; }
      }
      if (best > cachedUpTo) { read += best - cachedUpTo; cachedUpTo = best; }
      const add = tok - cachedUpTo;
      caches.set(key, '5m');
      w5 += add; cachedUpTo = tok;
    }
  }
  const input = Math.max(0, total - read - w5 - w1);
  return {
    input_tokens: input,
    output_tokens: outputTokens,
    cache_creation_input_tokens: w5 + w1,
    cache_read_input_tokens: read,
    cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 },
  };
}

const thinkingOn = (body) => body.thinking?.type === 'adaptive' || (!body.thinking && /^claude-(opus|sonnet|haiku)-5/.test(String(body.model)));

function answerText(body, state) {
  const schema = body.output_config?.format?.schema;
  if (state.mode === 'invalid_json') return schema ? '{"not": "the schema"' : '';
  if (schema) return JSON.stringify(state.json ?? sampleFor(schema));
  if (state.mode === 'long') return Array.from({ length: Number(state.tokens) || 40 }, (_, i) => `word${i} `).join('');
  return String(state.text || DEFAULT_TEXT);
}

/**
 * The text blocks of an answer to a request with citable search results.
 * auto: an uncited opening, then one cited block per search result of the LAST user turn (up to
 * 3; the cited sentence quotes the passage's first block, like a model citing it), then an
 * uncited closing line with no legal words.
 */
export function citedBlocks(body, state) {
  const all = searchResultsOf(body);
  if (!all.length || !citationsOn(body)) return null;
  const mode = state.citeMode || 'auto';
  if (mode === 'blocks' && Array.isArray(state.blocks)) return state.blocks.map((b) => ({ type: 'text', text: String(b.text), ...(b.citations ? { citations: b.citations } : {}) }));
  if (mode === 'none') return [{ type: 'text', text: String(state.text || DEFAULT_TEXT) }];
  const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
  const newest = new Set((Array.isArray(lastUser?.content) ? lastUser.content : []).filter((b) => b?.type === 'search_result'));
  const picks = all.map((r, i) => ({ ...r, i })).filter((r) => newest.has(r.block)).slice(0, 3);
  const use = picks.length ? picks : all.map((r, i) => ({ ...r, i })).slice(-1);
  const out = [{ type: 'text', text: 'Here is what I found. ' }];
  for (const r of use) {
    const first = r.block.content[0].text;
    const cite = { type: 'search_result_location', source: r.block.source, title: r.block.title, cited_text: first, search_result_index: r.i, start_block_index: 0, end_block_index: 1 };
    if (mode === 'foreign') {
      out.push({ type: 'text', text: `${first.trim()} `, citations: [{ ...cite, search_result_index: all.length + 5, source: 'https://evil.example/fake', title: 'Not a result we were given' }] });
    } else {
      out.push({ type: 'text', text: `${first.trim()} `, citations: [cite] });
    }
  }
  out.push({ type: 'text', text: 'I hope this helps.' });
  return out;
}

const declines = (state, model) => !state.refuseModels || state.refuseModels.includes(model);

/** The full non-streamed response for a request. → { status, headers, body } */
export function messageResponse(body, state, headers = {}) {
  const problem = requestProblem(body, headers);
  const reqId = `req_mock_${++seq}`;
  if (problem) return { status: 400, headers: { 'request-id': reqId }, body: { type: 'error', error: { type: 'invalid_request_error', message: problem } } };
  const model = body.model;
  const text = answerText(body, state);
  const parts = text.split(/(?<=\s)/);
  const content = [];
  if (thinkingOn(body)) content.push({ type: 'thinking', thinking: '', signature: 'mock-signature' });
  const refusalMode = ['refusal', 'refusal_mid', 'refusal_hard'].includes(state.mode) && declines(state, model);
  const stopDetails = { type: 'refusal', category: state.category ?? null, explanation: 'This request was declined (mock).' };
  if (refusalMode) {
    const serverFallback = 'fallbacks' in body && state.mode !== 'refusal_hard';
    if (!serverFallback) {
      return { status: 200, headers: { 'request-id': reqId }, body: {
        id: `msg_mock_${seq}`, type: 'message', role: 'assistant', model, content: [],
        stop_reason: 'refusal', stop_sequence: null, stop_details: stopDetails,
        usage: { ...usageFor(body, 0), output_tokens: 0 } } };
    }
    const fbUsage = usageFor({ ...body, model: FALLBACK_MODEL }, parts.length);
    return { status: 200, headers: { 'request-id': reqId }, body: {
      id: `msg_mock_${seq}`, type: 'message', role: 'assistant', model: FALLBACK_MODEL,
      content: [{ type: 'fallback', from: { model }, to: { model: FALLBACK_MODEL }, trigger: { type: 'refusal', category: state.category ?? null } },
        { type: 'text', text }],
      stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
      usage: { ...fbUsage, iterations: [
        { type: 'message', model, input_tokens: countInputTokens(body), output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        { type: 'fallback_message', model: FALLBACK_MODEL, ...fbUsage },
      ] } } };
  }
  const maxed = state.mode === 'max_tokens';
  const cited = citedBlocks(body, state);
  if (cited) content.push(...cited);
  else content.push({ type: 'text', text: maxed ? text.slice(0, Math.max(1, Math.floor(text.length / 2))) : text });
  return { status: 200, headers: { 'request-id': reqId }, body: {
    id: `msg_mock_${seq}`, type: 'message', role: 'assistant', model, content,
    stop_reason: maxed ? 'max_tokens' : 'end_turn', stop_sequence: null, stop_details: null,
    usage: usageFor(body, parts.length) } };
}

/**
 * The SSE events of a streamed response, as [{ event, data, pauseMs? }]. Special markers:
 * { drop: true } (cut the connection) and { error: {...} } (an `error` event).
 */
export function streamEvents(body, state) {
  const model = body.model;
  const text = answerText(body, state);
  const parts = text.split(/(?<=\s)/);
  const ev = [];
  const push = (data, pauseMs = 0) => ev.push({ event: data.type, data, pauseMs });
  const pause = state.mode === 'slow' || state.mode === 'drop' ? Number(state.delayMs) || 30 : 0;
  const refusalMode = ['refusal', 'refusal_mid', 'refusal_hard'].includes(state.mode) && declines(state, model);
  const serverFallback = refusalMode && 'fallbacks' in body && state.mode !== 'refusal_hard';
  const preOutputFallback = serverFallback && state.mode === 'refusal';
  const usage = usageFor(preOutputFallback ? { ...body, model: FALLBACK_MODEL } : body, 0);
  push({ type: 'message_start', message: { id: `msg_mock_${++seq}`, type: 'message', role: 'assistant',
    model: preOutputFallback ? FALLBACK_MODEL : model, content: [], stop_reason: null, stop_sequence: null, usage } });
  let index = 0;
  if (preOutputFallback) {
    push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: { model }, to: { model: FALLBACK_MODEL }, trigger: { type: 'refusal', category: state.category ?? null } } });
    push({ type: 'content_block_stop', index }); index += 1;
  }
  if (thinkingOn(body)) {
    push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: '' } });
    push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'mock-signature' } });
    push({ type: 'content_block_stop', index }); index += 1;
  }
  if (refusalMode && !serverFallback && state.mode !== 'refusal_mid') {
    push({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: state.category ?? null, explanation: 'declined (mock)' } }, usage: { output_tokens: 0 } });
    push({ type: 'message_stop' });
    return ev;
  }
  const cited = refusalMode ? null : citedBlocks(body, state);
  if (cited) {
    let words = 0;
    for (const blk of cited) {
      push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const c of blk.citations || []) push({ type: 'content_block_delta', index, delta: { type: 'citations_delta', citation: c } });
      for (const w of String(blk.text).split(/(?<=\s)/)) {
        words += 1;
        if (state.mode === 'drop' && words === 3) { ev.push({ drop: true }); return ev; }
        push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: w } }, pause);
      }
      push({ type: 'content_block_stop', index }); index += 1;
    }
    push({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null }, usage: { output_tokens: words } });
    push({ type: 'message_stop' });
    return ev;
  }
  push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
  const cut = Math.max(1, Math.floor(parts.length / 3));
  for (let i = 0; i < parts.length; i++) {
    if (state.mode === 'drop' && i === cut) { ev.push({ drop: true }); return ev; }
    if (state.mode === 'error_event' && i === Math.max(1, Math.floor(parts.length / 2))) {
      ev.push({ error: { type: 'error', error: { type: 'overloaded_error', message: 'mock overloaded' } } });
      return ev;
    }
    if (state.mode === 'refusal_mid' && refusalMode && i === cut) {
      push({ type: 'content_block_stop', index });
      if (!serverFallback) {
        push({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: state.category ?? null, explanation: 'declined (mock)' } }, usage: { output_tokens: i } });
        push({ type: 'message_stop' });
        return ev;
      }
      index += 1;
      push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: { model }, to: { model: FALLBACK_MODEL }, trigger: { type: 'refusal', category: state.category ?? null } } });
      push({ type: 'content_block_stop', index }); index += 1;
      push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    }
    push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: parts[i] } }, pause);
  }
  push({ type: 'content_block_stop', index });
  const finalUsage = { output_tokens: parts.length };
  if (serverFallback) {
    finalUsage.iterations = [
      { type: 'message', model, input_tokens: countInputTokens(body), output_tokens: state.mode === 'refusal_mid' ? cut : 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: 'fallback_message', model: FALLBACK_MODEL, ...usageFor({ ...body, model: FALLBACK_MODEL }, parts.length) },
    ];
  }
  push({ type: 'message_delta', delta: { stop_reason: state.mode === 'max_tokens' ? 'max_tokens' : 'end_turn', stop_sequence: null, stop_details: null }, usage: finalUsage });
  push({ type: 'message_stop' });
  return ev;
}

/** POST /v1/messages/count_tokens */
export function countTokensResponse(body) {
  const b = body || {};
  if (!b.model || !Array.isArray(b.messages)) return { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'model and messages are required' } } };
  return { status: 200, body: { input_tokens: countInputTokens(b) } };
}
