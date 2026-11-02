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
 *   - web fetch tool (agents-and-tools/tool-use/web-fetch-tool + server-tools "Domain filtering",
 *     read 2026-11-02): a `web_fetch_*` tool makes the answer [text, server_tool_use, web_fetch_tool_result…,
 *     final text]; URLs come from the user turns (or earlier fetched pages — url_not_in_prior_context
 *     otherwise), allowed_domains / blocked_domains match the domain and its subdomains (never a path),
 *     errors are web_fetch_tool_result_error { error_code } (url_not_allowed, url_not_accessible,
 *     max_uses_exceeded …), usage.server_tool_use.web_fetch_requests counts the fetches; 400 for a
 *     wildcard / scheme in a domain, allowed + blocked together, an unknown tool version.
 *     state.pages { url: text | { pdf: true } | null (gone) }, state.fetchUrls (URLs to fetch, in order),
 *     state.rogueFetch (a URL returned as fetched whatever the rules — to prove the app's own check);
 *   - Message Batches (build-with-claude/batch-processing): createBatchStore() — POST /v1/messages/batches,
 *     GET …/{id}, GET …/{id}/results (.jsonl, NOT in request order), POST …/{id}/cancel; custom_id
 *     ^[a-zA-Z0-9_-]{1,64}$ unique per batch (400); params checked like /v1/messages, plus `stream` and
 *     `fallbacks` rejected — per request, as an errored result (invalid_request_error); results
 *     succeeded { message } | errored { error: { type: 'error', error: { type, message }, request_id } }
 *     | canceled | expired. state.batchPolls (retrieves that still say in_progress), state.batchErrors
 *     { custom_id: { type, times } } (errored the first `times` attempts; type 'expired' → expired),
 *     state.batchJson { custom_id: json } (the structured answer for that request).
 *
 *   - images and PDFs (build-with-claude/vision + pdf-support + files, read 2026-11-02): `image` blocks
 *     with source base64 (media_type image/jpeg|png|gif|webp, and the bytes must BE that type —
 *     400 otherwise), url, or file { file_id }; `document` blocks with base64 application/pdf (the
 *     bytes must start %PDF-), text/plain `text` sources, url, or file. More than 100 PDF pages
 *     (pages counted from the PDF's /Type /Page objects), more than 100 images, a request over 32 MB
 *     (413 request_too_large), a file block whose file is the wrong type for the block (400) are
 *     refused like the API; a file_id the store does not have → 404 not_found_error; an expired
 *     file → 400 (requests referencing it fail before inference). count_tokens / usage price an image
 *     at width × height / 750 (scaled to a 1568-px long edge, as the API resizes) and a PDF page at
 *     ~2,300 tokens (text + page image).
 *   - Files API (build-with-claude/files): createFileStore() — POST /v1/files (multipart `file` +
 *     optional `expires_in_seconds` 3,600–7,776,000; filename 1–255 chars without < > : " | ? * \ /
 *     or control characters; 500 MB max → 413), GET /v1/files (newest first), GET /v1/files/{id},
 *     GET …/{id}/content (400: uploaded files are not downloadable), DELETE …/{id} → { id, type:
 *     'file_deleted' }; unknown id → 404 not_found_error. No beta header required (the API is out of
 *     beta; `files-api-2025-04-14` is accepted too). state.files = the store, for /v1/messages.
 *
 * Modes (state.mode): ok | slow | long | 429 | 500 | 529 | 401 | drop | error_event | hang |
 *   refusal (declines; served by the fallback model when the request has `fallbacks`) |
 *   refusal_mid (streams some text, then declines — or hands off to the fallback model) |
 *   refusal_hard (declines even with fallbacks) | invalid_json | max_tokens
 * state.refuseModels: only these models decline (default: every model) — lets a test show the
 *   client-side retry on another model succeeding.
 */
import zlib from 'node:zlib';
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
let mediaTokens = () => 1600;   // defined with the media checks below
const blockText = (b) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text
  : b?.type === 'search_result' ? `${b.title || ''} ${(b.content || []).map((c) => c?.text || '').join(' ')}`
  : b?.type ? JSON.stringify(b).slice(0, 4000) : '');
const contentText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(blockText).join('') : '');

/** Rough input tokens of a request body (chars ÷ 3; images w × h / 750; PDF pages ~2,300). */
export function countInputTokens(body = {}, files = null) {
  let n = 0;
  const sys = body.system;
  n += typeof sys === 'string' ? est(sys) : (sys || []).reduce((a, b) => a + est(b?.text), 0);
  for (const m of body.messages || []) {
    if (Array.isArray(m.content)) for (const b of m.content) n += b?.type === 'image' || b?.type === 'document' ? mediaTokens(b, files) : est(blockText(b));
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

export const WEB_FETCH_VERSIONS = ['web_fetch_20250910', 'web_fetch_20260209', 'web_fetch_20260309', 'web_fetch_20260318'];
const webFetchToolOf = (body) => (body.tools || []).find((t) => /^web_fetch_/.test(String(t?.type || '')));
function toolProblem(body) {
  for (const t of body.tools || []) {
    if (!/^web_fetch_/.test(String(t?.type || ''))) continue;
    if (!WEB_FETCH_VERSIONS.includes(t.type)) return `tools: unknown tool type ${t.type}`;
    if (t.name !== 'web_fetch') return 'tools: web fetch tool name must be "web_fetch"';
    if (t.allowed_domains && t.blocked_domains) return 'tools: allowed_domains and blocked_domains cannot be used together';
    for (const d of [...(t.allowed_domains || []), ...(t.blocked_domains || [])]) {
      const dom = String(d).split('/')[0];
      if (/:\/\//.test(String(d))) return `tools: domain "${d}" must not include a scheme`;
      if (dom.includes('*')) return `tools: wildcards are not allowed in the domain ("${d}")`;
      if (!/^[a-z0-9.-]+$/i.test(dom) || !dom.includes('.')) return `tools: invalid domain "${d}"`;
    }
    if ('max_uses' in t && !(Number.isInteger(t.max_uses) && t.max_uses > 0)) return 'tools: max_uses must be a positive integer';
    if ('max_content_tokens' in t && !(Number.isInteger(t.max_content_tokens) && t.max_content_tokens > 0)) return 'tools: max_content_tokens must be a positive integer';
    if ('use_cache' in t && t.type < 'web_fetch_20260309') return 'tools: use_cache requires web_fetch_20260309 or later';
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s)>"'\]]+/g;
const hostOfUrl = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
const domainMatch = (host, d) => { const x = String(d).toLowerCase().split('/')[0]; return host === x || host.endsWith(`.${x}`); };
/** The page text the mock serves for a URL (state.pages), null = gone, { pdf: true } = a PDF. */
function pageFor(url, state) {
  const pages = state.pages || {};
  if (Object.prototype.hasOwnProperty.call(pages, url)) return pages[url];
  return `Official page at ${url}. This page states the rule exactly as the office published it today. Contact the office for help.`;
}
/**
 * Run the web fetch tool for a request: → { blocks, pages: [{ url, text, pdf }], fetches, extraTokens }
 * (blocks = server_tool_use + web_fetch_tool_result pairs, in order).
 */
export function runWebFetch(body, state = {}) {
  const tool = webFetchToolOf(body);
  if (!tool) return null;
  const userText = (body.messages || []).filter((m) => m.role === 'user').map((m) => contentText(m.content)).join('\n');
  const prior = new Set(userText.match(URL_RE) || []);
  const wanted = Array.isArray(state.fetchUrls) && state.fetchUrls.length ? state.fetchUrls : [...prior].slice(0, 1);
  const blocks = []; const pages = []; let n = 0; let extra = 0;
  const maxUses = Number.isInteger(tool.max_uses) ? tool.max_uses : Infinity;
  for (const url of wanted) {
    const id = `srvtoolu_mock_${++seq}`;
    blocks.push({ type: 'server_tool_use', id, name: 'web_fetch', input: { url } });
    n += 1;
    const err = (code) => blocks.push({ type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_tool_result_error', error_code: code } });
    if (n > maxUses) { err('max_uses_exceeded'); continue; }
    if (String(url).length > 250) { err('url_too_long'); continue; }
    const host = hostOfUrl(url);
    if (!host) { err('invalid_tool_input'); continue; }
    if (!prior.has(url)) { err('url_not_in_prior_context'); continue; }
    if (tool.allowed_domains && !tool.allowed_domains.some((d) => domainMatch(host, d))) { err('url_not_allowed'); continue; }
    if (tool.blocked_domains && tool.blocked_domains.some((d) => domainMatch(host, d))) { err('url_not_allowed'); continue; }
    const page = pageFor(url, state);
    if (page === null || page === undefined) { err('url_not_accessible'); continue; }
    const pdf = typeof page === 'object' && page.pdf;
    const text = pdf ? null : String(page);
    const source = pdf ? { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4 mock').toString('base64') }
      : { type: 'text', media_type: 'text/plain', data: text };
    blocks.push({ type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_result', url,
      content: { type: 'document', source, title: `Page ${url}` }, retrieved_at: new Date().toISOString() } });
    pages.push({ url, text, pdf: !!pdf });
    for (const u of (text || '').match(URL_RE) || []) prior.add(u);     // links on a fetched page may be fetched next
    extra += pdf ? 3000 : est(text);
  }
  if (state.rogueFetch) {
    const id = `srvtoolu_mock_${++seq}`;
    const text = `Commercial copy of the rule at ${state.rogueFetch}. This page states the rule exactly as the office published it today.`;
    blocks.push({ type: 'server_tool_use', id, name: 'web_fetch', input: { url: state.rogueFetch } });
    blocks.push({ type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_result', url: state.rogueFetch,
      content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text }, title: 'Copy' }, retrieved_at: new Date().toISOString() } });
    pages.push({ url: state.rogueFetch, text, pdf: false });
    n += 1;
  }
  return { blocks, pages, fetches: n, extraTokens: extra };
}

/**
 * The default structured answer to a web-fetch request (source_check / source_proposal shapes).
 * Like the model is asked to: the quote is the page sentence that best states the stored text
 * (most shared words), and stored_claim is copied word for word from the stored text.
 */
function webFetchAnswer(schema, wf, body = {}) {
  const props = schema?.properties || {};
  const page = wf.pages.find((p) => p.text) || wf.pages[0] || null;
  const userText = (body.messages || []).filter((m) => m.role === 'user').map((m) => contentText(m.content)).join('\n');
  const stored = (userText.split('Stored text:\n')[1] || '').trim();
  const words = (t) => new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 || /\d/.test(w)));
  const overlap = (a, b) => { const B = words(b); let n = 0; for (const w of words(a)) if (B.has(w)) n += 1; return n; };
  const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const long = page?.text ? sentences(page.text).filter((x) => x.split(' ').length >= 5) : [];
  const firstSentence = page?.text ? (long.slice().sort((a, b) => overlap(b, stored) - overlap(a, stored))[0] || page.text) : null;
  const claim = stored ? (sentences(stored).sort((a, b) => overlap(b, firstSentence) - overlap(a, firstSentence))[0] || stored) : null;
  if ('verdict' in props) {
    return page ? { verdict: 'still_matches', quote: firstSentence, stored_claim: claim, what_changed: null, fetched_url: page.url }
      : { verdict: 'page_gone', quote: null, stored_claim: null, what_changed: null, fetched_url: null };
  }
  if ('found' in props) return page ? { found: true, url: page.url, quote: firstSentence, explanation: 'The page states the rule.' } : { found: false, url: null, quote: null, explanation: null };
  return null;
}

const fam = (m) => (/^claude-opus-5-5/.test(m) ? 'opus55' : /^claude-sonnet-5-5/.test(m) ? 'sonnet55' : /^claude-haiku-5-5/.test(m) ? 'haiku55' : 'other');

/** null, or the message of the 400 the real API would return. */
/**
 * Context management (AI step 5 — the app does not send these; the mock enforces the documented
 * rules so a request that ever did would fail here as it would on the API):
 *   context editing — build-with-claude/context-editing (read 2026-11-02): `context_management.edits`
 *     needs anthropic-beta context-management-2025-06-27; edit types clear_tool_uses_20250919 /
 *     clear_thinking_20251015 (listed first when both) / compact_20260112 (threshold compaction,
 *     beta compact-2026-01-12, trigger input_tokens ≥ 50,000);
 *   on-demand compaction — build-with-claude/compaction (+ -background, -keep-recent-turns):
 *     top-level `compaction: { type: "summarize" }`, beta compact-2026-09-04, not with
 *     context_management, not on Haiku 4.5 / Opus 4.5 / Sonnet 4.5.
 */
export function contextProblem(body, headers = {}) {
  const betas = String(headers['anthropic-beta'] || '').split(',').map((x) => x.trim());
  const model = String(body.model || '');
  if ('compaction' in body) {
    if (!betas.includes('compact-2026-09-04')) return 'compaction requires the beta header compact-2026-09-04';
    if ('context_management' in body) return 'compaction cannot be combined with context_management';
    if (/^claude-(haiku|opus|sonnet)-4-5/.test(model)) return `compaction is not supported on ${model}`;
    if (body.compaction?.type !== 'summarize') return 'compaction.type must be "summarize"';
  }
  if ('context_management' in body) {
    const edits = body.context_management?.edits;
    if (!Array.isArray(edits)) return 'context_management.edits: field required';
    const types = edits.map((e) => e?.type);
    for (const t of types) {
      if (t === 'compact_20260112') {
        if (!betas.includes('compact-2026-01-12')) return 'compact_20260112 requires the beta header compact-2026-01-12';
      } else if (['clear_tool_uses_20250919', 'clear_thinking_20251015'].includes(t)) {
        if (!betas.includes('context-management-2025-06-27')) return 'context editing requires the beta header context-management-2025-06-27';
      } else return `context_management.edits: unknown type ${String(t)}`;
    }
    if (types.includes('clear_thinking_20251015') && types[0] !== 'clear_thinking_20251015') return 'clear_thinking_20251015 must be listed first in edits';
    const compact = edits.find((e) => e?.type === 'compact_20260112');
    if (compact?.trigger && (compact.trigger.type !== 'input_tokens' || !(compact.trigger.value >= 50_000))) return 'compact_20260112 trigger must be input_tokens with value >= 50000';
  }
  return null;
}

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
  const tp = toolProblem(body);
  if (tp) return tp;
  const cm = contextProblem(body, headers);
  if (cm) return cm;
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
  const mp = mediaProblem(body, state.files);
  if (mp) return { status: mp.status, headers: { 'request-id': reqId }, body: { type: 'error', error: { type: mp.type, message: mp.message }, request_id: reqId } };
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
  const wf = runWebFetch(body, state);
  if (wf) {
    const schema = body.output_config?.format?.schema;
    const ans = schema ? JSON.stringify(state.json ?? webFetchAnswer(schema, wf, body) ?? sampleFor(schema)) : text;
    content.push({ type: 'text', text: 'I will open the page first.' }, ...wf.blocks, { type: 'text', text: maxed ? ans.slice(0, Math.floor(ans.length / 2)) : ans });
    const u = usageFor(body, ans.split(/(?<=\s)/).length + 20);
    if (state.mode === 'pause_turn') content.splice(content.length - 1, 1);
    return { status: 200, headers: { 'request-id': reqId }, body: {
      id: `msg_mock_${seq}`, type: 'message', role: 'assistant', model, content,
      stop_reason: state.mode === 'pause_turn' ? 'pause_turn' : maxed ? 'max_tokens' : 'end_turn', stop_sequence: null, stop_details: null,
      usage: { ...u, input_tokens: u.input_tokens + wf.extraTokens, server_tool_use: { web_fetch_requests: wf.fetches } } } };
  }
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

/** POST /v1/messages/count_tokens (state.files: the Files API store, for file_id blocks) */
export function countTokensResponse(body, state = {}) {
  const b = body || {};
  if (!b.model || !Array.isArray(b.messages)) return { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'model and messages are required' } } };
  const mp = mediaProblem(b, state.files);
  if (mp) return { status: mp.status, body: { type: 'error', error: { type: mp.type, message: mp.message } } };
  return { status: 200, body: { input_tokens: countInputTokens(b, state.files) } };
}

// ── Message Batches ───────────────────────────────────────────────────────────
const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const errorBodyOf = (message) => ({ type: 'error', error: { type: 'invalid_request_error', message } });

/** A small in-memory Message Batches service. `base` = the mock's own URL (for results_url). */
export function createBatchStore() {
  const batches = new Map();
  let n = 0;
  const view = (b) => ({
    id: b.id, type: 'message_batch', processing_status: b.status, request_counts: b.counts,
    ended_at: b.endedAt, created_at: b.createdAt, expires_at: b.expiresAt, cancel_initiated_at: b.cancelAt, archived_at: null,
    results_url: b.status === 'ended' ? `${b.base}/v1/messages/batches/${b.id}/results` : null,
  });
  const finish = (b, state) => {
    if (b.lines) return;
    const lines = [];
    for (const r of b.requests) {
      const errs = state.batchErrors || {};
      const e = errs[r.custom_id];
      if (b.canceled) { lines.push({ custom_id: r.custom_id, result: { type: 'canceled' } }); continue; }
      if (e && (e.times ?? 1) > 0) {
        e.times = (e.times ?? 1) - 1;
        if (e.type === 'expired') { lines.push({ custom_id: r.custom_id, result: { type: 'expired' } }); continue; }
        lines.push({ custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: { type: e.type || 'api_error', message: 'mock batch error' }, request_id: `req_mock_b${++seq}` } } });
        continue;
      }
      const p = r.params || {};
      if (p.stream) { lines.push({ custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'stream is not supported in batches' }, request_id: `req_mock_b${++seq}` } } }); continue; }
      if ('fallbacks' in p) { lines.push({ custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks is not supported in batches' }, request_id: `req_mock_b${++seq}` } } }); continue; }
      const json = state.batchJson && Object.prototype.hasOwnProperty.call(state.batchJson, r.custom_id) ? state.batchJson[r.custom_id] : state.json;
      const res = messageResponse(p, { ...state, json, mode: ['refusal', 'refusal_hard', 'invalid_json', 'max_tokens', 'pause_turn'].includes(state.mode) ? state.mode : 'ok' }, b.headers);
      if (res.status !== 200) lines.push({ custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: res.body.error, request_id: res.headers['request-id'] } } });
      else lines.push({ custom_id: r.custom_id, result: { type: 'succeeded', message: res.body } });
    }
    lines.reverse();   // the API returns results in any order — never rely on request order
    b.lines = lines;
    const c = { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 };
    for (const l of lines) c[l.result.type] += 1;
    b.counts = c; b.status = 'ended'; b.endedAt = new Date().toISOString();
  };
  return {
    batches,
    /** POST /v1/messages/batches */
    create(body, headers = {}, state = {}, base = '') {
      const reqs = body?.requests;
      if (!Array.isArray(reqs) || !reqs.length) return { status: 400, body: errorBodyOf('requests: at least one request is required') };
      if (reqs.length > 100000) return { status: 400, body: errorBodyOf('requests: at most 100,000 requests') };
      const ids = new Set();
      for (const r of reqs) {
        if (!CUSTOM_ID.test(String(r?.custom_id || ''))) return { status: 400, body: errorBodyOf(`custom_id must match ^[a-zA-Z0-9_-]{1,64}$ (got ${String(r?.custom_id).slice(0, 80)})`) };
        if (ids.has(r.custom_id)) return { status: 400, body: errorBodyOf(`custom_id ${r.custom_id} is not unique in this batch`) };
        ids.add(r.custom_id);
        if (!r.params || typeof r.params !== 'object') return { status: 400, body: errorBodyOf('params: field required') };
      }
      const id = `msgbatch_mock_${++n}`;
      const now = new Date();
      const b = { id, base, headers, requests: reqs, status: 'in_progress', polls: Number(state.batchPolls) || 0, lines: null,
        counts: { processing: reqs.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), endedAt: null, cancelAt: null };
      batches.set(id, b);
      return { status: 200, body: view(b) };
    },
    /** GET /v1/messages/batches/{id} */
    retrieve(id, state = {}) {
      const b = batches.get(id);
      if (!b) return { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'batch not found' } } };
      if (b.status !== 'ended') { if (b.polls > 0) b.polls -= 1; else finish(b, state); }
      return { status: 200, body: view(b) };
    },
    /** GET /v1/messages/batches/{id}/results → .jsonl text */
    results(id) {
      const b = batches.get(id);
      if (!b) return { status: 404, text: JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'batch not found' } }) };
      if (b.status !== 'ended') return { status: 409, text: JSON.stringify(errorBodyOf('results are not available until the batch has ended')) };
      return { status: 200, text: `${b.lines.map((l) => JSON.stringify(l)).join('\n')}\n` };
    },
    /** POST /v1/messages/batches/{id}/cancel */
    cancel(id, state = {}) {
      const b = batches.get(id);
      if (!b) return { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'batch not found' } } };
      if (b.status === 'in_progress') { b.canceled = true; b.cancelAt = new Date().toISOString(); b.status = 'canceling'; b.polls = 0; finish(b, state); }
      return { status: 200, body: view(b) };
    },
  };
}

/**
 * Route a batch request to the store: → null (not a batch path) or { status, json?, text? }.
 */
export function batchRoute(store, method, url, body, headers, state, base) {
  const path = String(url || '').split('?')[0];
  if (!path.startsWith('/v1/messages/batches')) return null;
  const m = /^\/v1\/messages\/batches(?:\/([^/]+))?(?:\/(results|cancel))?$/.exec(path);
  if (!m) return { status: 404, json: { type: 'error', error: { type: 'not_found_error', message: 'unknown path' } } };
  const [, id, sub] = m;
  if (!id && method === 'POST') { const r = store.create(body, headers, state, base); return { status: r.status, json: r.body }; }
  if (id && !sub && method === 'GET') { const r = store.retrieve(id, state); return { status: r.status, json: r.body }; }
  if (id && sub === 'results' && method === 'GET') { const r = store.results(id); return { status: r.status, text: r.text }; }
  if (id && sub === 'cancel' && method === 'POST') { const r = store.cancel(id, state); return { status: r.status, json: r.body }; }
  return { status: 405, json: { type: 'error', error: { type: 'invalid_request_error', message: 'method not allowed' } } };
}

// ── Images, PDFs and the Files API (AI step 4) ───────────────────────────────
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const h6 = buf.subarray(0, 6).toString('latin1');
  if (h6 === 'GIF87a' || h6 === 'GIF89a') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}
/** Pages of a PDF: its /Type /Page objects (not /Pages), also inside compressed object streams. */
export function pdfPages(buf) {
  const PAGE = /\/Type\s*\/Page(?![a-zA-Z])/g;
  const text = buf.toString('latin1');
  let n = (text.match(PAGE) || []).length;
  const re = /(?<!end)stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try { n += (zlib.inflateSync(buf.subarray(start, end)).toString('latin1').match(PAGE) || []).length; } catch { /* not deflate */ }
    re.lastIndex = end;
  }
  return Math.max(1, n);
}
function pngSize(buf) { try { return sniff(buf) === 'image/png' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null; } catch { return null; } }
function bytesOf(block, files) {
  const src = block?.source || {};
  if (src.type === 'base64') { try { return Buffer.from(String(src.data || ''), 'base64'); } catch { return null; } }
  if (src.type === 'file' && files) return files.files.get(src.file_id)?.bytes || null;
  return null;
}
mediaTokens = (block, files) => {
  const buf = bytesOf(block, files);
  if (block.type === 'image') {
    const d = buf && pngSize(buf);
    if (!d) return 1600;
    const scale = Math.min(1, 1568 / Math.max(d.w, d.h));
    return Math.min(1600, Math.max(1, Math.round((d.w * scale) * (d.h * scale) / 750)));
  }
  if (block.source?.type === 'text') return est(block.source.data);
  return buf ? pdfPages(buf) * 2300 : 3000;
};

/** Checks the API makes on image / document blocks. → { status, type, message } | null */
export function mediaProblem(body, files = null) {
  const bad = (message, status = 400, type = 'invalid_request_error') => ({ status, type, message });
  if (Buffer.byteLength(JSON.stringify(body || {})) > 32 * 1024 * 1024) return bad('request exceeds the maximum size of 32 MB', 413, 'request_too_large');
  let images = 0; let pages = 0;
  for (const m of body?.messages || []) {
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b?.type !== 'image' && b?.type !== 'document') continue;
      const src = b.source || {};
      if (src.type === 'file') {
        if (typeof src.file_id !== 'string' || !src.file_id) return bad(`${b.type}.source.file_id: field required`);
        const f = files?.files.get(src.file_id);
        if (!f) return bad(`File \`${src.file_id}\` not found.`, 404, 'not_found_error');
        if (f.expiresAt && Date.parse(f.expiresAt) <= Date.now()) return bad(`File \`${src.file_id}\` has expired.`);
        if (b.type === 'image' && !IMAGE_TYPES.includes(f.mime)) return bad(`File \`${src.file_id}\` (${f.mime}) cannot be used in an image block`);
        if (b.type === 'document' && !['application/pdf', 'text/plain'].includes(f.mime)) return bad(`File \`${src.file_id}\` (${f.mime}) cannot be used in a document block`);
        if (b.type === 'image') images += 1; else if (f.mime === 'application/pdf') pages += pdfPages(f.bytes);
        continue;
      }
      if (src.type === 'url') { if (!/^https?:\/\//.test(String(src.url || ''))) return bad(`${b.type}.source.url: invalid URL`); if (b.type === 'image') images += 1; continue; }
      if (b.type === 'document' && src.type === 'text') { if (src.media_type !== 'text/plain' || typeof src.data !== 'string') return bad('document.source: text sources need media_type text/plain and data'); continue; }
      if (b.type === 'document' && src.type === 'content') continue;
      if (src.type !== 'base64') return bad(`${b.type}.source.type: must be one of base64, url, file${b.type === 'document' ? ', text, content' : ''}`);
      if (typeof src.data !== 'string' || !src.data || !B64.test(src.data)) return bad(`${b.type}.source.data: invalid base64 data`);
      const buf = Buffer.from(src.data, 'base64');
      if (b.type === 'image') {
        if (!IMAGE_TYPES.includes(src.media_type)) return bad(`image.source.media_type: must be one of ${IMAGE_TYPES.join(', ')}`);
        if (sniff(buf) !== src.media_type) return bad(`Image does not match the provided media type ${src.media_type}`);
        const d = pngSize(buf);
        if (d && (d.w > 8000 || d.h > 8000)) return bad('image dimensions exceed max allowed size: 8000 pixels');
        images += 1;
      } else {
        if (src.media_type !== 'application/pdf') return bad('document.source.media_type: must be application/pdf for base64 documents');
        if (sniff(buf) !== 'application/pdf') return bad('The PDF specified was not valid.');
        pages += pdfPages(buf);
      }
    }
  }
  if (images > 100) return bad('too many images: at most 100 per request');
  if (pages > 100) return bad('A maximum of 100 PDF pages may be provided.');
  return null;
}

/** Split a multipart/form-data body. → [{ name, filename, contentType, data: Buffer }] */
export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  if (!m || !Buffer.isBuffer(buf)) return null;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.subarray(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.subarray(start + 2, next - 2);   // skip CRLF after boundary, CRLF before the next
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8');
      const name = /name="([^"]*)"/i.exec(head)?.[1] ?? null;
      const filename = /filename="([^"]*)"/i.exec(head)?.[1] ?? null;
      const ct = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? null;
      parts.push({ name, filename, contentType: ct, data: part.subarray(sep + 4) });
    }
    pos = next;
  }
  return parts;
}

/** A small in-memory Files API. */
export function createFileStore() {
  const files = new Map();
  let n = 0;
  const view = (f) => ({ id: f.id, type: 'file', filename: f.filename, mime_type: f.mime, size_bytes: f.bytes.length, created_at: f.createdAt, downloadable: false, expires_at: f.expiresAt });
  const err = (status, type, message) => ({ status, body: { type: 'error', error: { type, message }, request_id: `req_mock_f${++seq}` } });
  return {
    files,
    deleted: [],
    upload(raw, headers = {}) {
      const parts = parseMultipart(raw, headers['content-type']);
      if (!parts) return err(400, 'invalid_request_error', 'request must be multipart/form-data');
      const file = parts.find((p) => p.name === 'file' && p.filename != null);
      if (!file) return err(400, 'invalid_request_error', 'file: field required');
      const name = file.filename;
      if (!name.length || name.length > 255 || /[<>:"|?*\\/\u0000-\u001f]/.test(name)) return err(400, 'invalid_request_error', 'Invalid file name');
      if (file.data.length > 500 * 1024 * 1024) return err(413, 'request_too_large', 'File exceeds the maximum size of 500 MB');
      const exp = parts.find((p) => p.name === 'expires_in_seconds');
      let expiresAt = null;
      if (exp) {
        const s = Number(exp.data.toString());
        if (!Number.isInteger(s) || s < 3600 || s > 7_776_000) return err(400, 'invalid_request_error', 'expires_in_seconds must be an integer between 3600 and 7776000');
        expiresAt = new Date(Date.now() + s * 1000).toISOString();
      }
      const id = `file_mock_${String(++n).padStart(6, '0')}`;
      const f = { id, filename: name, mime: file.contentType || 'application/octet-stream', bytes: Buffer.from(file.data), createdAt: new Date().toISOString(), expiresAt };
      files.set(id, f);
      return { status: 200, body: view(f) };
    },
    get(id) { const f = files.get(id); return f ? { status: 200, body: view(f) } : err(404, 'not_found_error', `File \`${id}\` not found.`); },
    list() { return { status: 200, body: { data: [...files.values()].reverse().map(view) } }; },
    content(id) { return files.has(id) ? err(400, 'invalid_request_error', 'This file is not downloadable') : err(404, 'not_found_error', `File \`${id}\` not found.`); },
    remove(id) {
      if (!files.has(id)) return err(404, 'not_found_error', `File \`${id}\` not found.`);
      files.delete(id); this.deleted.push(id);
      return { status: 200, body: { id, type: 'file_deleted' } };
    },
  };
}

/** Route a /v1/files request: → null (not a files path) or { status, json }. `raw` = the body bytes. */
export function filesRoute(store, method, url, raw, headers = {}) {
  const path = String(url || '').split('?')[0];
  if (!path.startsWith('/v1/files')) return null;
  const m = /^\/v1\/files(?:\/([^/]+))?(?:\/(content))?$/.exec(path);
  if (!m) return { status: 404, json: { type: 'error', error: { type: 'not_found_error', message: 'unknown path' } } };
  const [, id, sub] = m;
  let r;
  if (!id && method === 'POST') r = store.upload(raw, headers);
  else if (!id && method === 'GET') r = store.list();
  else if (id && !sub && method === 'GET') r = store.get(decodeURIComponent(id));
  else if (id && sub === 'content' && method === 'GET') r = store.content(decodeURIComponent(id));
  else if (id && !sub && method === 'DELETE') r = store.remove(decodeURIComponent(id));
  else r = { status: 405, body: { type: 'error', error: { type: 'invalid_request_error', message: 'method not allowed' } } };
  return { status: r.status, json: r.body };
}
