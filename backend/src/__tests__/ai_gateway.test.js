/**
 * ai_gateway.test.js — the AI gateway (services/aiClient.js + ai/pricing.js, ai/tasks.js,
 * ai/schemas) against the documented API shapes, spoken by scripts/anthropic-mock-lib.mjs.
 *
 *   pricing    one table, cache read / write rates, Haiku long-context tier, refusal billing,
 *              fallback iterations, env overrides
 *   routing    class → model / effort / thinking (display "omitted"), per-model normalisation,
 *              server-side fallback only where supported, headroom
 *   requests   every task's request is one the real API accepts (the mock's 400 checks)
 *   schemas    supported keywords only; validation (enum casing, missing / extra keys)
 *   outcomes   structured output parsed + validated; invalid / cut-off → ai_invalid_output;
 *              refusal → ai_refused (server fallback answers; client fallback for Haiku;
 *              reasoning_extraction never retried); thinking text never returned
 *   preflight  local estimate vs count_tokens; refuse oversized / over-cap / over-budget
 *   streaming  thinking deltas skipped; mid-stream refusal flagged; fallback hand-off continues
 */
import { jest } from '@jest/globals';
import http from 'http';
import {
  freshState, resetCaches, messageResponse, streamEvents, countTokensResponse, requestProblem,
} from '../../scripts/anthropic-mock-lib.mjs';

const mock = { server: null, state: freshState(), requests: [] };
const ENV_KEYS = ['AI_FALLBACK', 'AI_FALLBACK_MODEL', 'AI_MODEL_QUICK', 'AI_MODEL_STANDARD', 'AI_MODEL_DEEP', 'AI_EFFORT_STANDARD',
  'AI_THINKING_QUICK', 'AI_THINKING_STANDARD', 'AI_CACHE', 'AI_CHAT_CACHE_TTL', 'AI_MAX_INPUT_TOKENS', 'AI_MAX_REQUEST_USD',
  'AI_COUNT_TOKENS_THRESHOLD', 'AI_DAILY_BUDGET_USD', 'AI_TRACE_PROPAGATION', 'AI_PRICE_INPUT_PER_MTOK', 'AI_PRICE_OUTPUT_PER_MTOK'];
let gw, pricing, tasks, schemas, budget;

beforeAll(async () => {
  mock.server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(data); } catch { /* keep null */ }
      mock.requests.push({ path: req.url, headers: req.headers, body });
      if (req.url.endsWith('/count_tokens')) {
        const r = countTokensResponse(body);
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(r.body));
      }
      if (body?.stream) {
        const p = requestProblem(body, req.headers);
        if (p) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: p } })); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'request-id': 'req_stream' });
        for (const e of streamEvents(body, mock.state)) res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
        return res.end();
      }
      const r = messageResponse(body, mock.state, req.headers);
      res.writeHead(r.status, { 'Content-Type': 'application/json', ...r.headers });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.server.address().port}`;
  gw = await import('../services/aiClient.js');
  pricing = await import('../ai/pricing.js');
  tasks = await import('../ai/tasks.js');
  schemas = await import('../ai/schemas/index.js');
  budget = await import('../services/aiBudget.js');
});
afterAll(async () => { await new Promise((r) => mock.server.close(r)); });
beforeEach(() => {
  mock.state = freshState(); mock.requests = []; resetCaches();
  for (const k of ENV_KEYS) delete process.env[k];
  budget._resetAiBudgetForTests();
});
const quiet = () => [jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'info').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {})];
const sent = () => mock.requests.filter((r) => r.path === '/v1/messages');
const LONG = 'Stable instructions. '.repeat(400);   // ~2,800 tokens by the ÷3 estimate (over the 512 minimum)

describe('pricing (ai/pricing.js)', () => {
  test('table rows match the pricing page (USD / MTok) and carry the doc URL + date', () => {
    expect(pricing.PRICING_SOURCE).toEqual({ url: 'https://platform.claude.com/docs/en/about-claude/pricing', read: '2026-11-02' });
    expect(pricing.priceRow('claude-sonnet-5-5')).toMatchObject({ input: 2, output: 10, write5m: 2.5, write1h: 4, read: 0.10 });
    expect(pricing.priceRow('claude-opus-5-5')).toMatchObject({ input: 4, output: 20, write5m: 5, write1h: 8, read: 0.20 });
    expect(pricing.priceRow('claude-haiku-5-5')).toMatchObject({ input: 0.10, output: 0.50, write5m: 0.125, write1h: 0.20, read: 0.01 });
    expect(pricing.priceRow('claude-sonnet-5')).toMatchObject({ input: 2, read: 0.20 });          // not swallowed by sonnet-5-5
    expect(pricing.priceRow('claude-sonnet-5-5-20261001')).toBe(pricing.PRICES['claude-sonnet-5-5']);
    expect(pricing.priceRow('claude-opus-4-1')).toMatchObject({ input: 15, output: 75 });          // unknown → conservative family
  });

  test('every token category is priced at its own rate', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 2_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } };
    expect(pricing.costUsd('claude-sonnet-5-5', usage)).toBeCloseTo(2 + 10 + 0.10 + 2.5 + 4);
    // no TTL breakdown → the whole write at the 5-minute rate
    expect(pricing.costUsd('claude-sonnet-5-5', { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(2.5);
  });

  test('Haiku 5.5 over 100,000 prompt tokens (cache reads + writes included) pays the long-context tier', () => {
    expect(pricing.costUsd('claude-haiku-5-5', { input_tokens: 100_000 })).toBeCloseTo(0.01);
    expect(pricing.costUsd('claude-haiku-5-5', { input_tokens: 60_000, cache_read_input_tokens: 50_000 })).toBeCloseTo((60_000 * 0.5 + 50_000 * 0.05) / 1e6);
  });

  test('refusal billing: only bio / frontier_llm / reasoning_extraction before output; mid-stream always', () => {
    const u = { input_tokens: 1_000_000, output_tokens: 0 };
    expect(pricing.responseCostUsd({ model: 'claude-sonnet-5-5', usage: u, stopReason: 'refusal', refusalCategory: 'cyber' })).toBe(0);
    expect(pricing.responseCostUsd({ model: 'claude-sonnet-5-5', usage: u, stopReason: 'refusal', refusalCategory: null })).toBe(0);
    expect(pricing.responseCostUsd({ model: 'claude-sonnet-5-5', usage: u, stopReason: 'refusal', refusalCategory: 'bio' })).toBeCloseTo(2);
    expect(pricing.responseCostUsd({ model: 'claude-sonnet-5-5', usage: { ...u, output_tokens: 100_000 }, stopReason: 'refusal', refusalCategory: 'cyber' })).toBeCloseTo(3);
  });

  test('server-side fallback: each attempt priced on its own model; the declined one under the refusal rule', () => {
    const usage = { input_tokens: 1_000, output_tokens: 1_000, iterations: [
      { type: 'message', model: 'claude-sonnet-5-5', input_tokens: 1_000_000, output_tokens: 0 },
      { type: 'fallback_message', model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 0 }] };
    expect(pricing.responseCostUsd({ model: 'claude-opus-5-5', usage, stopReason: 'end_turn', triggerCategory: 'cyber' })).toBeCloseTo(4);
    expect(pricing.responseCostUsd({ model: 'claude-opus-5-5', usage, stopReason: 'end_turn', triggerCategory: 'bio' })).toBeCloseTo(6);
  });

  test('AI_PRICE_*_PER_MTOK override every model (cache rates scale with the input override)', () => {
    process.env.AI_PRICE_INPUT_PER_MTOK = '4';
    process.env.AI_PRICE_OUTPUT_PER_MTOK = '30';
    expect(pricing.costUsd('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6 })).toBeCloseTo(4 + 30 + 0.2);
    expect(budget.estimateCostUsd('claude-sonnet-5-5', 0, 1_000_000)).toBeCloseTo(30);
  });
});

describe('routing (ai/tasks.js)', () => {
  test('classes default to haiku/low/disabled, sonnet/medium/adaptive, opus/high/adaptive; env overrides', () => {
    expect(tasks.classConfig('quick')).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low', thinking: 'disabled', headroom: 0 });
    expect(tasks.classConfig('standard')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium', thinking: 'adaptive', headroom: 2000 });
    expect(tasks.classConfig('deep')).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', thinking: 'adaptive', headroom: 6000 });
    process.env.AI_MODEL_DEEP = 'claude-sonnet-5-5';
    process.env.AI_EFFORT_STANDARD = 'default';
    process.env.AI_THINKING_QUICK = 'nonsense';
    expect(tasks.classConfig('deep').model).toBe('claude-sonnet-5-5');
    expect(tasks.classConfig('standard').effort).toBeNull();
    expect(tasks.classConfig('quick').thinking).toBe('disabled');
  });

  test('thinking is mapped onto what each model accepts (thinking text is always omitted)', () => {
    expect(tasks.normalizeThinking('claude-opus-5-5', 'adaptive', 'high')).toEqual({ type: 'adaptive', display: 'omitted' });
    expect(tasks.normalizeThinking('claude-opus-5-5', 'disabled', 'low')).toBeNull();
    expect(tasks.normalizeThinking('claude-sonnet-5-5', 'disabled', 'medium')).toEqual({ type: 'between_tools' });
    expect(tasks.normalizeThinking('claude-sonnet-5-5', 'disabled', 'xhigh')).toBeNull();
    expect(tasks.normalizeThinking('claude-haiku-5-5', 'disabled', 'low')).toEqual({ type: 'disabled' });
    expect(tasks.normalizeThinking('claude-haiku-5-5', 'disabled', 'max')).toBeNull();
    expect(tasks.normalizeEffort('claude-haiku-4-5', 'low')).toBeNull();
  });

  test('every call site task routes through a class; every request it builds is one the API accepts', () => {
    for (const [task, def] of Object.entries(tasks.TASKS)) {
      expect(tasks.CLASSES).toContain(def.cls);
      for (const stream of [false, true]) {
        const r = gw.buildRequest({ task, system: [{ text: LONG, cache: '1h' }, { text: 'x', cache: '5m' }], messages: [{ role: 'user', content: 'hi' }], cacheConversation: true, stream });
        expect(requestProblem(r.body, r.headers)).toBeNull();
        expect(r.body).not.toHaveProperty('temperature');
        if (def.schema) expect(r.body.output_config.format).toEqual({ type: 'json_schema', schema: schemas.SCHEMAS[def.schema] });
      }
    }
  });

  test('server-side fallback is sent (with its beta header) only where supported; never on Haiku 5.5', () => {
    const chat = gw.buildRequest({ task: 'chat', messages: [{ role: 'user', content: 'x' }] });
    expect(chat.body.fallbacks).toBe('default');
    expect(chat.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    const quick = gw.buildRequest({ task: 'translate', messages: [{ role: 'user', content: 'x' }] });
    expect(quick.body).not.toHaveProperty('fallbacks');
    expect(quick.body.thinking).toEqual({ type: 'disabled' });
    expect(quick.body.output_config).toEqual({ effort: 'low' });
    process.env.AI_FALLBACK = 'off';
    expect(gw.buildRequest({ task: 'chat', messages: [] }).body).not.toHaveProperty('fallbacks');
  });

  test('thinking headroom is added to max_tokens when thinking is on', () => {
    expect(gw.buildRequest({ task: 'chat', messages: [] }).body.max_tokens).toBe(800 + 2000);
    expect(gw.buildRequest({ task: 'motion_generate', messages: [] }).body.max_tokens).toBe(2000 + 6000);
    expect(gw.buildRequest({ task: 'translate', messages: [] }).body.max_tokens).toBe(1200);
  });

  test('prompt caching: 1h parts first, then 5m; chat TTL from AI_CHAT_CACHE_TTL; AI_CACHE=off removes every breakpoint', () => {
    let b = gw.buildRequest({ task: 'chat', system: [{ text: 'A', cache: 'chat' }, { text: 'B' }], messages: [], cacheConversation: true }).body;
    expect(b.system).toEqual([{ type: 'text', text: 'A', cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: 'B' }]);
    expect(b.cache_control).toEqual({ type: 'ephemeral' });
    b = gw.buildRequest({ task: 'chat', system: [{ text: 'A', cache: '5m' }, { text: 'B', cache: '1h' }], messages: [] }).body;
    expect(b.system[1].cache_control).toEqual({ type: 'ephemeral' });              // a 1h after a 5m would be a 400
    process.env.AI_CHAT_CACHE_TTL = '5m';
    expect(gw.buildRequest({ task: 'chat', system: [{ text: 'A', cache: 'chat' }], messages: [] }).body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    process.env.AI_CACHE = 'off';
    b = gw.buildRequest({ task: 'chat', system: [{ text: 'A', cache: 'chat' }], messages: [], cacheConversation: true }).body;
    expect(b.system[0]).not.toHaveProperty('cache_control');
    expect(b).not.toHaveProperty('cache_control');
  });
});

describe('schemas (ai/schemas)', () => {
  test('every schema uses only supported keywords and a minimal instance validates', () => {
    for (const [name, s] of Object.entries(schemas.SCHEMAS)) {
      const body = { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }], output_config: { format: { type: 'json_schema', schema: s } } };
      expect([name, requestProblem(body)]).toEqual([name, null]);
      expect(schemas.validate(s, schemas.sampleFor(s)).ok).toBe(true);
    }
  });

  test('validation: enum casing normalised; missing / extra / wrong-typed keys rejected', () => {
    const s = schemas.SCHEMAS.motion_review;
    expect(schemas.validate(s, { score: 'PASS', issues: [], suggestions: [], missing_fields: [] })).toEqual({ ok: true, value: { score: 'pass', issues: [], suggestions: [], missing_fields: [] } });
    expect(schemas.validate(s, { score: 'pass', issues: [] }).ok).toBe(false);
    expect(schemas.validate(s, { score: 'pass', issues: [], suggestions: [], missing_fields: [], extra: 1 }).ok).toBe(false);
    expect(schemas.validate(s, { score: 'great', issues: [], suggestions: [], missing_fields: [] }).ok).toBe(false);
    expect(schemas.validate(s, { score: 'pass', issues: [1], suggestions: [], missing_fields: [] }).ok).toBe(false);
    expect(schemas.parseStructured('motion_review', '```json\n{}```').ok).toBe(false);   // fences are not JSON
  });
});

describe('aiMessage outcomes', () => {
  test('plain answer: thinking blocks skipped, usage metered with cache tokens at their prices', async () => {
    const before = (await budget.budgetStatus()).spent_usd;
    const sys = [{ text: LONG, cache: 'chat' }, { text: 'LANGUAGE: English' }];
    const r1 = await gw.aiMessage({ task: 'chat', system: sys, messages: [{ role: 'user', content: 'hi' }], userId: 1 });
    expect(r1.text).toBe('MOCK REPLY: this is general legal information, not legal advice.');
    expect(r1.model).toBe('claude-sonnet-5-5');
    expect(r1.usage.cache_creation.ephemeral_1h_input_tokens).toBeGreaterThan(500);
    const r2 = await gw.aiMessage({ task: 'chat', system: sys, messages: [{ role: 'user', content: 'again' }] });
    expect(r2.usage.cache_read_input_tokens).toBe(r1.usage.cache_creation.ephemeral_1h_input_tokens);
    expect(r2.costUsd).toBeLessThan(r1.costUsd);                                   // a read is 0.05× a 1h write (Sonnet 5.5)
    expect(r1.costUsd).toBeCloseTo(pricing.costUsd('claude-sonnet-5-5', r1.usage), 9);
    expect((await budget.budgetStatus()).spent_usd).toBeCloseTo(before + r1.costUsd + r2.costUsd, 6);
    const content = sent()[0];
    expect(content.body.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
    expect(content.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
  });

  test('structured output is parsed and validated', async () => {
    mock.state.json = { score: 'Warn', issues: ['No case number'], suggestions: [], missing_fields: ['case number'] };
    const r = await gw.aiMessage({ task: 'motion_review', messages: [{ role: 'user', content: 'draft' }] });
    expect(r.json).toEqual({ score: 'warn', issues: ['No case number'], suggestions: [], missing_fields: ['case number'] });
    expect(sent()[0].body.output_config.format.schema).toEqual(schemas.SCHEMAS.motion_review);
    expect(sent()[0].body.model).toBe('claude-opus-5-5');
  });

  test('an answer that fails its schema, or is cut off at max_tokens, is never returned', async () => {
    const q = quiet();
    try {
      mock.state.mode = 'invalid_json';
      await expect(gw.aiMessage({ task: 'motion_review', messages: [{ role: 'user', content: 'd' }] })).rejects.toMatchObject({ code: 'ai_invalid_output' });
      mock.state = freshState({ mode: 'max_tokens' });
      await expect(gw.aiMessage({ task: 'contract_review', messages: [{ role: 'user', content: 'd' }] })).rejects.toMatchObject({ code: 'ai_invalid_output' });
      mock.state = freshState({ json: { score: 'pass' } });                      // valid JSON, wrong shape
      await expect(gw.aiMessage({ task: 'motion_review', messages: [{ role: 'user', content: 'd' }] })).rejects.toMatchObject({ code: 'ai_invalid_output' });
    } finally { q.forEach((s) => s.mockRestore()); }
  });

  test('refusal: server-side fallback answers on the fallback model (chat)', async () => {
    mock.state.mode = 'refusal';
    const r = await gw.aiMessage({ task: 'chat', messages: [{ role: 'user', content: 'x' }] });
    expect(r.model).toBe('claude-opus-4-8');
    expect(r.fallbackModel).toBe('claude-opus-4-8');
    expect(r.text).toContain('MOCK REPLY');
    expect(sent()).toHaveLength(1);
  });

  test('refusal with no fallback answer → ai_refused, nothing returned', async () => {
    const q = quiet();
    try {
      mock.state.mode = 'refusal_hard';
      await expect(gw.aiMessage({ task: 'chat', messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'ai_refused', category: 'general_harms' });
      process.env.AI_FALLBACK = 'off';
      mock.requests = [];
      mock.state = freshState({ mode: 'refusal' });
      await expect(gw.aiMessage({ task: 'research', messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'ai_refused' });
      expect(sent().every((s) => !('fallbacks' in s.body))).toBe(true);
    } finally { q.forEach((s) => s.mockRestore()); }
  });

  test('Haiku 5.5 (no server-side fallback): one client-side retry on AI_FALLBACK_MODEL', async () => {
    const q = quiet();
    try {
      mock.state = freshState({ mode: 'refusal', refuseModels: ['claude-haiku-5-5'] });
      const r = await gw.aiMessage({ task: 'translate', messages: [{ role: 'user', content: 'hola' }] });
      expect(r.model).toBe('claude-sonnet-5-5');
      expect(r.fallbackModel).toBe('claude-sonnet-5-5');
      expect(sent().map((s) => s.body.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
      expect(sent()[1].body.thinking).toEqual({ type: 'between_tools' });          // 'disabled' is a 400 on Sonnet 5.5
      expect(sent()[1].body).not.toHaveProperty('fallbacks');                     // never both client and server fallback
      // reasoning_extraction: never retried (the docs: change the prompt instead)
      mock.requests = [];
      mock.state = freshState({ mode: 'refusal', category: 'reasoning_extraction' });
      await expect(gw.aiMessage({ task: 'translate', messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'ai_refused' });
      expect(sent()).toHaveLength(1);
    } finally { q.forEach((s) => s.mockRestore()); }
  });

  test('a provider error keeps its code (busy / unavailable)', async () => {
    const q = quiet();
    try {
      const fetchImpl = jest.fn(() => Promise.resolve(new Response('{"type":"error"}', { status: 529 })));
      await expect(gw.aiMessage({ task: 'chat', messages: [{ role: 'user', content: 'x' }], fetchImpl, retries: 0 })).rejects.toMatchObject({ code: 'ai_busy' });
      const f401 = jest.fn(() => Promise.resolve(new Response('{}', { status: 401 })));
      await expect(gw.aiMessage({ task: 'chat', messages: [{ role: 'user', content: 'x' }], fetchImpl: f401, retries: 0 })).rejects.toMatchObject({ code: 'ai_unavailable' });
    } finally { q.forEach((s) => s.mockRestore()); }
  });

  test('AI_TRACE_PROPAGATION=on sends a W3C traceparent', async () => {
    process.env.AI_TRACE_PROPAGATION = 'on';
    await gw.aiMessage({ task: 'translate', messages: [{ role: 'user', content: 'x' }] });
    expect(sent()[0].headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    delete process.env.AI_TRACE_PROPAGATION;
    mock.requests = [];
    await gw.aiMessage({ task: 'translate', messages: [{ role: 'user', content: 'x' }] });
    expect(sent()[0].headers).not.toHaveProperty('traceparent');
  });
});

describe('preflight (token counting + caps)', () => {
  test('small text requests use the local estimate (no count call); documents and big ones are counted', async () => {
    await gw.aiMessage({ task: 'chat', messages: [{ role: 'user', content: 'short' }] });
    expect(mock.requests.filter((r) => r.path.endsWith('/count_tokens'))).toHaveLength(0);
    const pdf = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.7\n1 0 obj\n%%EOF\n').toString('base64') } };
    await gw.aiMessage({ task: 'discovery_analysis', messages: [{ role: 'user', content: [pdf, { type: 'text', text: 'analyze' }] }] });
    const counts = mock.requests.filter((r) => r.path.endsWith('/count_tokens'));
    expect(counts).toHaveLength(1);
    expect(counts[0].body).toMatchObject({ model: 'claude-opus-5-5', output_config: { format: { type: 'json_schema' } } });
    expect(counts[0].body).not.toHaveProperty('max_tokens');
    expect(counts[0].body).not.toHaveProperty('fallbacks');
    process.env.AI_COUNT_TOKENS_THRESHOLD = '10';
    await gw.aiMessage({ task: 'chat', messages: [{ role: 'user', content: 'a bit longer than ten tokens of text here' }] });
    expect(mock.requests.filter((r) => r.path.endsWith('/count_tokens'))).toHaveLength(2);
  });

  test('refused before sending: over AI_MAX_INPUT_TOKENS, over AI_MAX_REQUEST_USD, over what is left of today', async () => {
    const q = quiet();
    try {
      process.env.AI_MAX_INPUT_TOKENS = '1000';
      await expect(gw.aiMessage({ task: 'chat', messages: [{ role: 'user', content: 'x'.repeat(9000) }] })).rejects.toMatchObject({ code: 'ai_too_large', reason: 'max_input_tokens' });
      delete process.env.AI_MAX_INPUT_TOKENS;
      process.env.AI_MAX_REQUEST_USD = '0.01';                   // deep: 8,000 max_tokens × $20/MTok = $0.16 worst case
      await expect(gw.aiMessage({ task: 'motion_generate', messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'ai_too_large', reason: 'max_request_usd' });
      delete process.env.AI_MAX_REQUEST_USD;
      process.env.AI_DAILY_BUDGET_USD = '0.05';
      await budget.recordAiUsage({ route: 't', model: 'claude-sonnet-5-5', outputTokens: 4000 });   // $0.04 spent
      await expect(gw.aiMessage({ task: 'motion_generate', messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'ai_too_large', reason: 'daily_budget_remaining' });
      expect(sent()).toHaveLength(0);                               // nothing was sent
      expect(gw.aiErrorCode(new budget.AiBudgetExceededError({}))).toBe('ai_unavailable');
    } finally { q.forEach((s) => s.mockRestore()); }
  });
});

describe('aiStream', () => {
  const read = async (opts = {}) => {
    const s = await gw.aiStream({ task: 'chat', messages: [{ role: 'user', content: 'x' }], ...opts });
    let text = '';
    const out = await s.read((t) => { text += t; });
    await s.record(text ? 'completed' : 'failed');
    return { out, text };
  };

  test('text only (thinking deltas skipped), metered once', async () => {
    const { out, text } = await read();
    expect(text).toBe('MOCK REPLY: this is general legal information, not legal advice.');
    expect(out).toMatchObject({ refused: false, stopReason: 'end_turn', model: 'claude-sonnet-5-5' });
  });

  test('a refusal mid-answer is flagged so the caller can discard what streamed', async () => {
    process.env.AI_FALLBACK = 'off';
    mock.state.mode = 'refusal_mid';
    const { out, text } = await read();
    expect(out.refused).toBe(true);
    expect(text.length).toBeGreaterThan(0);                      // partial text arrived — the caller must drop it
  });

  test('with server-side fallback the fallback model continues the same stream', async () => {
    mock.state.mode = 'refusal_mid';
    const { out, text } = await read();
    expect(out.refused).toBe(false);
    expect(text).toContain('MOCK REPLY');
  });

  test('a refusal before any output', async () => {
    mock.state.mode = 'refusal_hard';
    const { out, text } = await read();
    expect(out.refused).toBe(true);
    expect(text).toBe('');
  });
});
