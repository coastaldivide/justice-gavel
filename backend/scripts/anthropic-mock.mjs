#!/usr/bin/env node
/**
 * anthropic-mock.mjs — a scriptable stand-in for the Anthropic Messages API,
 * used by the web journeys (frontend/scripts/web-journeys-*.cjs) and CI.
 *
 *   node scripts/anthropic-mock.mjs [port]        (default 4399, binds 127.0.0.1)
 *
 * Start the API with ANTHROPIC_API_KEY=<anything> ANTHROPIC_BASE_URL=http://127.0.0.1:<port>.
 *
 * Control API:
 *   POST /__mode {mode, text, delayMs, tokens}
 *        mode: ok | slow | long | 429 | 500 | 529 | 401 | drop | error_event | hang
 *        text: the answer (default: a short general-information reply)
 *        delayMs: pause between streamed words (slow / drop), default 30
 *        tokens: number of words for `long`, default 40
 *   GET  /__requests   the upstream requests received so far: [{ path, body }]
 *   POST /__reset      mode back to ok, request log cleared
 * Every other POST is answered as POST /v1/messages (JSON, or SSE when the
 * body has stream: true).
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || process.env.ANTHROPIC_MOCK_PORT || 4399);
const DEFAULT_TEXT = 'MOCK REPLY: this is general legal information, not legal advice.';
const fresh = () => ({ mode: 'ok', text: null, delayMs: 30, tokens: 40 });
let state = fresh();
let requests = [];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const words = () => {
  if (state.mode === 'long') return Array.from({ length: Number(state.tokens) || 40 }, (_, i) => `word${i}`);
  return String(state.text || DEFAULT_TEXT).split(/(?<=\s)/);
};
const usage = (n) => ({ input_tokens: 10, output_tokens: n });

function errorBody(status) {
  const type = { 401: 'authentication_error', 429: 'rate_limit_error', 500: 'api_error', 529: 'overloaded_error' }[status];
  return JSON.stringify({ type: 'error', error: { type, message: `mock ${status}` } });
}

async function answer(req, res, body) {
  const mode = state.mode;
  if (mode === 'hang') return;   // never answers; the caller's timeout must fire
  const status = Number(mode);
  if ([401, 429, 500, 529].includes(status)) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 429 ? { 'retry-after': '1' } : {}) });
    return res.end(errorBody(status));
  }
  const parts = words();
  const model = body?.model || 'mock';
  if (!body?.stream) {
    if (mode === 'slow') await sleep((Number(state.delayMs) || 30) * parts.length);
    if (mode === 'drop') { req.socket.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      id: 'msg_mock', type: 'message', role: 'assistant', model,
      content: [{ type: 'text', text: parts.join('') }],
      stop_reason: 'end_turn', stop_sequence: null, usage: usage(parts.length),
    }));
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: {
    id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: usage(0) } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  const delay = mode === 'slow' || mode === 'drop' ? Number(state.delayMs) || 30 : 0;
  for (let i = 0; i < parts.length; i++) {
    if (res.destroyed) return;
    if (mode === 'drop' && i === Math.max(1, Math.floor(parts.length / 3))) { req.socket.destroy(); return; }
    if (mode === 'error_event' && i === Math.max(1, Math.floor(parts.length / 2))) {
      send('error', { type: 'error', error: { type: 'overloaded_error', message: 'mock overloaded' } });
      return res.end();
    }
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: parts[i] } });
    if (delay) await sleep(delay);
  }
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: parts.length } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

const server = http.createServer((req, res) => {
  let data = '';
  req.on('data', c => { data += c; });
  req.on('end', () => {
    let body = null;
    try { body = data ? JSON.parse(data) : null; } catch { /* not JSON */ }
    const url = req.url.split('?')[0];
    if (url === '/__mode' && req.method === 'POST') {
      state = { ...fresh(), ...(body || {}) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(state));
    }
    if (url === '/__requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(requests));
    }
    if (url === '/__reset') {
      state = fresh(); requests = [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    requests.push({ path: url, body });
    if (requests.length > 500) requests = requests.slice(-500);
    answer(req, res, body).catch(() => { try { res.destroy(); } catch { /* gone */ } });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[anthropic-mock] listening on 127.0.0.1:${PORT}`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
