/**
 * ai_citations.test.js — verified citations (ai/citations.js, ai/legalCorpus.js,
 * services/sourcedAnswers.js, the gateway's citation paths) against the documented shapes the
 * mock speaks (scripts/anthropic-mock-lib.mjs: search_result blocks, search_result_location
 * citations, citations_delta in streams, the 400s for mixed settings / citations + format).
 *
 *   request    search_result blocks after the cached system prompt; citations never combined
 *              with output_config.format (gateway refuses; the mock returns the API's 400)
 *   verify     citations parsed and bound to the exact passage we sent; foreign ids, other
 *              citation types, wrong titles / block ranges / cited text dropped and counted
 *   withhold   uncited legal statements replaced by the "no source" marker (8 languages)
 *   retrieval  relevant passages in the person's language, other states' tables left out,
 *              nothing relevant → nothing_found (no model call), non-legal → plain
 *   stream     citations_delta collected per block; parts shown only after checking
 *   cache      the follow-up rebuilds the earlier turn byte-for-byte → the mock reads the cache
 *   corpus     data/guideCorpus.js matches the app's texts (generator re-run)
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  freshState, resetCaches, messageResponse, streamEvents, countTokensResponse, requestProblem,
} from '../../scripts/anthropic-mock-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mock = { server: null, state: freshState(), requests: [] };
let gw, cit, corpus, sa, helpers, budget;

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
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
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
  cit = await import('../ai/citations.js');
  corpus = await import('../ai/legalCorpus.js');
  sa = await import('../services/sourcedAnswers.js');
  helpers = await import('../routes/chat/_helpers.js');
  budget = await import('../services/aiBudget.js');
});
afterAll(async () => { await new Promise((r) => mock.server.close(r)); });
beforeEach(() => { mock.state = freshState(); mock.requests = []; resetCaches(); budget._resetAiBudgetForTests(); });
const quiet = () => [jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'info').mockImplementation(() => {})];
const sentReqs = () => mock.requests.filter((r) => r.path === '/v1/messages');

const body = (over = {}) => ({
  message: 'Can police search my car without a warrant?', sessionId: 's1', clientMessageId: null, city: '', lat: null, lng: null,
  caseContext: null, user_state: 'TN', user_state_name: 'Tennessee', ...over,
});
const chatReq = (over = {}, history = [], lang = 'en', defender = false) => helpers.buildChatRequest({ history, body: body(over), lang, defender });

describe('request shape', () => {
  test('passages go to the user turn as search_result blocks after the cached system prompt', () => {
    const r = chatReq();
    expect(r.mode).toBe('grounded');
    const built = gw.buildRequest({ task: r.task, system: r.system, messages: r.messages, maxTokens: r.max_tokens, cacheConversation: true });
    expect(built.citations).toBe(true);
    expect(built.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(built.body.system[0].text).toContain('SOURCES RULES');
    expect(built.body.system[0].text).not.toContain('[VERIFIED RIGHTS CONTENT');   // the card is a citable passage now
    const content = built.body.messages.at(-1).content;
    expect(content.at(-1)).toMatchObject({ type: 'text' });
    const results = content.filter((b) => b.type === 'search_result');
    expect(results.length).toBeGreaterThan(0);
    for (const b of results) {
      expect(b).toMatchObject({ type: 'search_result', citations: { enabled: true } });
      expect(b.source).toMatch(/^jg:/);
      expect(typeof b.title).toBe('string');
      expect(b.content.every((c) => c.type === 'text' && c.text.length > 0)).toBe(true);
      expect(b.cache_control).toBeUndefined();                     // after the breakpoint, not one of their own
    }
    expect(built.body.output_config?.format).toBeUndefined();
    expect(requestProblem(built.body, built.headers)).toBeNull();
    expect(r.sent.map((x) => `jg:${x.id}`)).toEqual(results.map((b) => b.source));
  });

  test('citations + structured outputs: the gateway refuses to build it; the API (mock) answers 400', () => {
    const r = chatReq();
    expect(() => gw.buildRequest({ task: 'motion_review', messages: r.messages })).toThrow(/citations cannot be combined/);
    const bad = { model: 'claude-sonnet-5-5', max_tokens: 100, messages: r.messages, output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } } } };
    expect(requestProblem(bad)).toMatch(/citations are not supported together with output_config.format/);
  });

  test('the mock enforces the documented search_result rules', () => {
    const sr = (enabled) => ({ type: 'search_result', source: 'jg:x', title: 'T', content: [{ type: 'text', text: 'a' }], citations: { enabled } });
    const base = { model: 'claude-sonnet-5-5', max_tokens: 100 };
    expect(requestProblem({ ...base, messages: [{ role: 'user', content: [sr(true), sr(false), { type: 'text', text: 'q' }] }] })).toMatch(/all or none/);
    expect(requestProblem({ ...base, messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: [sr(true)] }, { role: 'user', content: 'q' }] })).toMatch(/only appear in user messages/);
    expect(requestProblem({ ...base, messages: [{ role: 'user', content: [{ ...sr(true), content: [] }] }] })).toMatch(/content/);
  });

  test('preflight counts the passages (not just the question)', () => {
    const r = chatReq();
    const built = gw.buildRequest({ task: r.task, system: r.system, messages: r.messages });
    const withSources = gw.estimateInputTokens(built.body).tokens;
    const without = gw.estimateInputTokens({ ...built.body, messages: [{ role: 'user', content: 'Can police search my car without a warrant?' }] }).tokens;
    expect(withSources - without).toBeGreaterThan(50);
  });
});

describe('verification', () => {
  const sentFor = () => chatReq().sent;

  test('citations are parsed, bound to the exact passage sent, numbered by first use', async () => {
    const r = chatReq();
    const out = await gw.aiMessage({ task: r.task, system: r.system, messages: r.messages, maxTokens: r.max_tokens, cacheConversation: true });
    expect(out.content.some((b) => Array.isArray(b.citations) && b.citations[0].type === 'search_result_location')).toBe(true);
    const a = cit.buildCitedAnswer(out.content, r.sent);
    expect(a.dropped).toBe(0);
    expect(a.sources.length).toBeGreaterThan(0);
    expect(a.sources.map((s) => s.n)).toEqual(a.sources.map((_, i) => i + 1));
    for (const s of a.sources) {
      const rec = r.sent.find((x) => x.id === s.id);
      expect(rec.blocks.join('')).toContain(s.passage);           // our stored text, not the model's copy
      expect(s).toHaveProperty('title'); expect(s).toHaveProperty('checked'); expect(s).toHaveProperty('jurisdiction');
    }
    expect(a.segments.some((g) => g.cites?.length)).toBe(true);
  });

  test('citations to sources we did not send are dropped; the legal sentence is then withheld', () => {
    const sent = sentFor();
    const legal = 'You have the right to refuse a search of your car.';
    const content = [
      { type: 'text', text: legal, citations: [{ type: 'search_result_location', source: 'https://evil.example', title: 'x', cited_text: 'x', search_result_index: 99, start_block_index: 0, end_block_index: 1 }] },
      { type: 'text', text: ' Police must get a warrant.', citations: [{ type: 'char_location', cited_text: 'x', document_index: 0, document_title: 'x', start_char_index: 0, end_char_index: 1 }] },
    ];
    const a = cit.buildCitedAnswer(content, sent);
    expect(a.dropped).toBe(2);
    expect(a.dropReasons).toMatchObject({ index_out_of_range: 1, 'type:char_location': 1 });
    expect(a.segments).toEqual([{ withheld: true }]);
    expect(a.sources).toEqual([]);
  });

  test('a citation with a swapped source id, wrong title, bad block range or invented cited text is dropped', () => {
    const sent = sentFor();
    const ok = { type: 'search_result_location', source: `jg:${sent[0].id}`, title: sent[0].title, cited_text: sent[0].blocks[0], search_result_index: 0, start_block_index: 0, end_block_index: 1 };
    expect(cit.verifyCitation(ok, sent).ok).toBe(true);
    expect(cit.verifyCitation({ ...ok, source: `jg:${sent[sent.length - 1].id}x` }, sent).reason).toBe('source_mismatch');
    expect(cit.verifyCitation({ ...ok, title: 'Some other title' }, sent).reason).toBe('title_mismatch');
    expect(cit.verifyCitation({ ...ok, end_block_index: 999 }, sent).reason).toBe('block_range');
    expect(cit.verifyCitation({ ...ok, start_block_index: 1, end_block_index: 1 }, sent).reason).toBe('block_range');
    expect(cit.verifyCitation({ ...ok, cited_text: 'The law says something we never sent.' }, sent).reason).toBe('cited_text_mismatch');
  });

  test('mock foreign mode end to end: nothing cited survives, the answer becomes "no source found"', async () => {
    mock.state.citeMode = 'foreign';
    const r = chatReq();
    const out = await gw.aiMessage({ task: r.task, system: r.system, messages: r.messages });
    const s = helpers.sourcedReply(r, out, 'en');
    expect(s.answer.sources).toEqual([]);
    expect(s.answer.dropped).toBeGreaterThan(0);
    expect(s.answer.no_source).toBe(true);
    expect(s.reply).toContain('[No source found for this part — not shown]');
    expect(s.content).not.toMatch(/right|search|warrant/i);       // nothing uncited and legal is kept
  });

  test('uncited legal statements are withheld, plain kind words kept (grounded answer)', () => {
    const sent = sentFor();
    const a = cit.buildCitedAnswer([
      { type: 'text', text: 'I am sorry this happened. ' },
      { type: 'text', text: 'You must file within 30 days.' },
      { type: 'text', text: ' Police can always search a car.' },
    ], sent);
    expect(a.segments).toEqual([{ text: 'I am sorry this happened. ', cites: [] }, { withheld: true }]);
    expect(a.withheld).toBe(2);
  });

  test('looksLegal: legal statements in 8 languages; kind words, referrals and crisis lines are not', () => {
    for (const t of ['You have the right to stay silent.', 'Usted tiene derecho a guardar silencio.', 'Você tem direito a um advogado.',
      'Bạn có quyền giữ im lặng.', 'Ou gen dwa pou w rete an silans.', '您有权保持沉默。', 'لديك الحق في التزام الصمت.', 'May karapatan kang manahimik.',
      'File within 30 days.', 'See 18 U.S.C. § 3142.']) expect([t, cit.looksLegal(t)]).toEqual([t, true]);
    for (const t of ['I am sorry you are going through this.', 'Call 911 now.', 'Text or call 988.', 'See your rights card or call a legal aid office.',
      'Estoy aquí para ayudarle.', 'Tap Court dates, then Add.']) expect([t, cit.looksLegal(t)]).toEqual([t, false]);
  });

  test('plain text: markers + a source list for text-only clients; stored words without markers', () => {
    const answer = { segments: [{ text: 'A.', cites: [1] }, { withheld: true }, { text: ' B.', cites: [] }], sources: [{ n: 1, title: 'Rights card: Search', url: null }] };
    expect(cit.plainText(answer, 'en')).toBe('A.[1] [No source found for this part — not shown] B.\n\nSources:\n[1] Rights card: Search');
    expect(cit.plainText(answer, 'en', { markers: false })).toBe('A. B.');
    expect(cit.plainText(answer, 'es')).toContain('[No se encontró una fuente para esta parte — no se muestra]');
  });
});

describe('retrieval and modes', () => {
  test('relevant passages in the person\'s language; the rights card answers a search question', () => {
    expect(corpus.retrieve('Can police search my car?')[0].id).toBe('rights.rc_3.en');
    expect(corpus.retrieve('¿Puede la policía registrar mi carro?', { lang: 'es' })[0].id).toBe('rights.rc_3.es');
    expect(corpus.retrieve('警察可以搜查我的车吗', { lang: 'zh' })[0].id).toBe('rights.rc_3.zh');
    expect(corpus.retrieve('what should I wear to court')[0].kind).toBe('court_guide');
  });

  test('state tables: only the person\'s state (or the states the question names)', () => {
    const tn = corpus.retrieve('can a DUI be expunged', { state: 'TN' });
    expect(tn.length).toBeGreaterThan(0);
    expect(tn.filter((p) => p.kind === 'expungement').every((p) => p.jurisdiction === 'TN')).toBe(true);
    const named = corpus.retrieve('can a DUI be expunged in Texas', { state: 'TN' });
    expect(named.some((p) => p.jurisdiction === 'TX')).toBe(true);
    const none = corpus.retrieve('can a DUI be expunged');
    expect(none.some((p) => p.kind === 'expungement')).toBe(false);   // no state → no state verdicts
  });

  test('every passage has a source and no empty blocks; nothing unsourced is in the corpus', () => {
    for (const p of corpus.allPassages()) {
      expect(p.blocks.length).toBeGreaterThan(0);
      expect(p.blocks.every((b) => b.trim().length > 0)).toBe(true);
      expect(p.publisher || p.url).toBeTruthy();
      if (['expungement', 'recording_law'].includes(p.kind)) expect(p.url).toMatch(/^https?:\/\//);
    }
  });

  test('nothing relevant for a legal question → nothing_found, no model call; non-legal → plain', async () => {
    const legal = chatReq({ message: 'Is quuxification lawful?' });
    expect(legal.mode).toBe('nothing_found');
    const s = helpers.sourcedReply(legal, {}, 'en');
    expect(s.answer.nothing_found).toBe(true);
    expect(s.reply).toMatch(/won't answer it from memory/);
    expect(sentReqs()).toHaveLength(0);
    expect(chatReq({ message: 'hello there, how are you today' }).mode).toBe('plain');
    expect(helpers.sourcedReply(legal, {}, 'ar').reply).toMatch(/لن نجيب/);
  });

  test('plain mode: a sentence that still states law is withheld', () => {
    const r = chatReq({ message: 'hello there, how are you today' });
    const s = helpers.sourcedReply(r, { text: 'Hi! I am here to help. You must appear in court within 3 days.' }, 'en');
    expect(s.answer.segments).toEqual([{ text: 'Hi! ', cites: [] }, { text: 'I am here to help. ', cites: [] }, { withheld: true }]);
  });

  test('a follow-up does not resend passages already in the conversation; earlier ones stay citable', () => {
    const first = chatReq();
    const history = [
      { role: 'user', content: 'Can police search my car without a warrant?', ai_sent: helpers.sentOf(first) },
      { role: 'assistant', content: 'Earlier answer.' },
    ];
    const second = chatReq({ message: 'And can they search my phone?' }, history);
    const ids1 = first.fresh.map((x) => x.id);
    expect(second.fresh.some((x) => ids1.includes(x.id))).toBe(false);
    expect(second.sent.slice(0, ids1.length).map((x) => x.id)).toEqual(ids1);     // request order: history first
    // a citation to the first turn's passage (index 0) still verifies
    const c = { type: 'search_result_location', source: `jg:${ids1[0]}`, title: first.fresh[0].title, cited_text: first.fresh[0].blocks[0], search_result_index: 0, start_block_index: 0, end_block_index: 1 };
    expect(cit.verifyCitation(c, second.sent).ok).toBe(true);
  });
});

describe('prompt caching with citations', () => {
  test('the follow-up resends the earlier turn byte-for-byte → the conversation is read from cache', async () => {
    const first = chatReq();
    const out1 = await gw.aiMessage({ task: first.task, system: first.system, messages: first.messages, cacheConversation: true });
    expect(out1.usage.cache_creation.ephemeral_1h_input_tokens).toBeGreaterThan(0);   // system prompt, 1 hour
    const s1 = helpers.sourcedReply(first, out1, 'en');
    const history = [
      { role: 'user', content: 'Can police search my car without a warrant?', ai_sent: helpers.sentOf(first) },
      { role: 'assistant', content: s1.content },
    ];
    const second = chatReq({ message: 'What if they ask to look in my trunk?' }, history);
    expect(JSON.stringify(second.messages[0])).toBe(JSON.stringify(first.messages[0]));
    const out2 = await gw.aiMessage({ task: second.task, system: second.system, messages: second.messages, cacheConversation: true });
    expect(out2.usage.cache_read_input_tokens).toBeGreaterThan(out1.usage.cache_creation.ephemeral_1h_input_tokens);
  });
});

describe('streaming', () => {
  test('citations_delta are collected per block; only checked parts are emitted', async () => {
    const r = chatReq();
    const s = await gw.aiStream({ task: r.task, system: r.system, messages: r.messages, cacheConversation: true });
    const emitted = [];
    const asm = sa.streamAnswer(r, (e) => emitted.push(e));
    const out = await s.read(asm.onText, { onBlock: asm.onBlock });
    asm.end();
    await s.record('completed');
    expect(out.blocks.some((b) => b.citations.length > 0)).toBe(true);
    const ans = sa.finishAssembled(asm.result(), { mode: r.mode });
    expect(ans.sources.length).toBeGreaterThan(0);
    expect(emitted.map((e) => e.segment)).toEqual(ans.segments);
    expect(emitted.flatMap((e) => e.sources).map((x) => x.n)).toEqual(ans.sources.map((x) => x.n));
    // the stream and the non-streamed path give the same answer
    resetCaches();
    const nonStream = await gw.aiMessage({ task: r.task, system: r.system, messages: r.messages });
    expect(cit.buildCitedAnswer(nonStream.content, r.sent).segments).toEqual(ans.segments);
  });

  test('a refusal before the answer is still a refusal (nothing emitted)', async () => {
    const q = quiet();
    try {
      process.env.AI_FALLBACK = 'off';
      mock.state.mode = 'refusal';
      const r = chatReq();
      const s = await gw.aiStream({ task: r.task, system: r.system, messages: r.messages });
      const emitted = [];
      const asm = sa.streamAnswer(r, (e) => emitted.push(e));
      const out = await s.read(asm.onText, { onBlock: asm.onBlock });
      await s.record('failed');
      expect(out.refused).toBe(true);
      expect(emitted).toEqual([]);
    } finally { delete process.env.AI_FALLBACK; q.forEach((x) => x.mockRestore()); }
  });
});

describe('guide corpus', () => {
  test('backend/src/data/guideCorpus.js matches the app (re-run of the generator)', async () => {
    const gen = await import('../../scripts/build-guide-corpus.mjs');
    const file = fs.readFileSync(path.join(HERE, '../data/guideCorpus.js'), 'utf8');
    expect(gen.renderCorpus()).toBe(file);
  });
});
