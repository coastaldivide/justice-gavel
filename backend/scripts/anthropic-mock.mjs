#!/usr/bin/env node
/**
 * anthropic-mock.mjs — a scriptable stand-in for the Anthropic Messages API, used by the web
 * journeys (frontend/scripts/web-journeys-*.cjs), the smoke test / route sweep and CI.
 * The API behaviour (structured outputs, thinking blocks, prompt-cache usage, refusals and
 * server-side fallback, count_tokens, 400s for requests the real API rejects) lives in
 * scripts/anthropic-mock-lib.mjs, shared with the jest integration harness.
 *
 *   node scripts/anthropic-mock.mjs [port]        (default 4399, binds 127.0.0.1)
 *
 * Start the API with ANTHROPIC_API_KEY=<anything> ANTHROPIC_BASE_URL=http://127.0.0.1:<port>.
 *
 * Control API:
 *   POST /__mode {mode, text, json, delayMs, tokens, category, refuseModels, citeMode, blocks}
 *        mode: ok | slow | long | 429 | 500 | 529 | 401 | drop | error_event | hang |
 *              refusal | refusal_mid | refusal_hard | invalid_json | max_tokens
 *        text: the answer (default: a short general-information reply)
 *        json: the structured-output answer (default: a minimal instance of the request's schema)
 *        delayMs: pause between streamed words (slow / drop), default 30
 *        tokens: number of words for `long`, default 40
 *        category: refusal category (default general_harms); refuseModels: only these decline
 *        citeMode: auto | text | none | foreign | blocks — answers to requests with citable search
 *          results (scripts/anthropic-mock-lib.mjs citedBlocks); blocks: [{ text, citations? }]
 *   GET  /__requests   the upstream requests received so far: [{ path, headers, body }]
 *   Message Batches: POST /v1/messages/batches, GET /v1/messages/batches/{id}, GET …/{id}/results,
 *        POST …/{id}/cancel (scripts/anthropic-mock-lib.mjs createBatchStore; __mode also takes
 *        batchPolls, batchErrors, batchJson, pages, fetchUrls, rogueFetch)
 *   Files API: POST /v1/files (multipart), GET /v1/files, GET /v1/files/{id}, GET …/{id}/content,
 *        DELETE /v1/files/{id} (scripts/anthropic-mock-lib.mjs createFileStore); image / document
 *        blocks with file_id sources are resolved against it (404 for an unknown id)
 *   POST /__reset      mode back to ok, request log, prompt cache, batches and files cleared
 * Every other POST is answered as POST /v1/messages (JSON, or SSE when the body has
 * stream: true), except POST /v1/messages/count_tokens.
 */
import http from 'node:http';
import { freshState, resetCaches, messageResponse, streamEvents, countTokensResponse, requestProblem, createBatchStore, batchRoute, createFileStore, filesRoute } from './anthropic-mock-lib.mjs';

const PORT = Number(process.argv[2] || process.env.ANTHROPIC_MOCK_PORT || 4399);
let state = freshState();
let requests = [];
let batches = createBatchStore();
let files = createFileStore();

const sleep = (ms) => new Promise(r => { setTimeout(r, ms); });

function errorBody(status) {
  const type = { 401: 'authentication_error', 429: 'rate_limit_error', 500: 'api_error', 529: 'overloaded_error' }[status];
  return JSON.stringify({ type: 'error', error: { type, message: `mock ${status}` } });
}

async function answer(req, res, body, url) {
  if (url.endsWith('/count_tokens')) {
    const r = countTokensResponse(body, { files });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(r.body));
  }
  const mode = state.mode;
  if (mode === 'hang') return;   // never answers; the caller's timeout must fire
  const status = Number(mode);
  if ([401, 429, 500, 529].includes(status)) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 429 ? { 'retry-after': '1' } : {}) });
    return res.end(errorBody(status));
  }
  if (!body?.stream) {
    const r = messageResponse(body, { ...state, files }, req.headers);
    const words = String(r.body?.content?.find?.(b => b.type === 'text')?.text || '').split(/\s+/).length;
    if (mode === 'slow') await sleep((Number(state.delayMs) || 30) * words);
    if (mode === 'drop') { req.socket.destroy(); return; }
    res.writeHead(r.status, { 'Content-Type': 'application/json', ...r.headers });
    return res.end(JSON.stringify(r.body));
  }
  const problem = requestProblem(body, req.headers);
  if (problem) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: problem } }));
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'request-id': `req_mock_stream_${Date.now()}` });
  for (const e of streamEvents(body, state)) {
    if (res.destroyed) return;
    if (e.drop) { req.socket.destroy(); return; }
    if (e.error) { res.write(`event: error\ndata: ${JSON.stringify(e.error)}\n\n`); return res.end(); }
    res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    if (e.pauseMs) await sleep(e.pauseMs);
  }
  res.end();
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => { chunks.push(c); });
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const data = String(req.headers['content-type'] || '').startsWith('multipart/') ? '' : raw.toString('utf8');
    let body = null;
    try { body = data ? JSON.parse(data) : null; } catch { /* not JSON */ }
    const url = req.url.split('?')[0];
    if (url === '/__mode' && req.method === 'POST') {
      state = freshState(body || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(state));
    }
    if (url === '/__requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(requests));
    }
    if (url === '/__reset') {
      state = freshState(); requests = []; resetCaches(); batches = createBatchStore(); files = createFileStore();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    // Message Batches: POST /v1/messages/batches, GET …/{id}, GET …/{id}/results, POST …/{id}/cancel
    const br = batchRoute(batches, req.method, url, body, req.headers, state, `http://127.0.0.1:${PORT}`);
    if (br) {
      requests.push({ path: url, method: req.method, headers: (({ 'x-api-key': _k, ...h }) => h)(req.headers), body });
      if (requests.length > 500) requests = requests.slice(-500);
      if (br.text !== undefined) { res.writeHead(br.status, { 'Content-Type': 'application/binary' }); return res.end(br.text); }
      res.writeHead(br.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(br.json));
    }
    // Files API: POST /v1/files (multipart), GET /v1/files[/{id}[/content]], DELETE /v1/files/{id}
    const fr = filesRoute(files, req.method, url, raw, req.headers);
    if (fr) {
      requests.push({ path: url, method: req.method, headers: (({ 'x-api-key': _k, ...h }) => h)(req.headers), body: null, bytes: raw.length });
      if (requests.length > 500) requests = requests.slice(-500);
      res.writeHead(fr.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(fr.json));
    }
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    const { 'x-api-key': _key, ...headers } = req.headers;
    requests.push({ path: url, headers, body });
    if (requests.length > 500) requests = requests.slice(-500);
    answer(req, res, body, url).catch(() => { try { res.destroy(); } catch { /* gone */ } });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[anthropic-mock] listening on 127.0.0.1:${PORT}`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
