/**
 * ai_source_checks.test.js — AI step 3, the parts that need no database (docs/AI_PLATFORM.md §9–§10):
 *
 *   allow-list   official hosts only (.gov, state.<xx>.us, the explicit list); commercial hosts
 *                never, even under an allowed parent; no wildcards / schemes ever reach
 *                allowed_domains; every request the job builds is one the API accepts
 *   web fetch    the mock speaks the documented tool shapes; a non-allowed URL is not fetched
 *   verdicts     "still matches" moves the date ONLY with a quote that is on the page fetched from
 *                the row's own official host; everything else is queued; a page from another host
 *                (even if the API returned one) is never accepted; PDFs are queued
 *   proposals    only an allowed, actually fetched page with the quote on it is proposed
 *   batch        request params (no `fallbacks`, never streams, custom_id rules), result reading
 *                (succeeded / errored nested shape / expired / pause_turn / invalid), JSONL,
 *                batch pricing at 50 %
 *   translation  draft checks = the parity tests' rules
 */
import {
  requestProblem, messageResponse, freshState, runWebFetch, createBatchStore, batchRoute,
} from '../../scripts/anthropic-mock-lib.mjs';

let dom, sc, reg, batch, pricing, gw, tr, overlay;
beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  dom = await import('../ai/sourceDomains.js');
  sc = await import('../services/sourceChecks/index.js');
  reg = await import('../services/sourceChecks/registry.js');
  batch = await import('../services/aiBatch.js');
  pricing = await import('../ai/pricing.js');
  gw = await import('../services/aiClient.js');
  tr = await import('../services/translationDrafts.js');
  overlay = await import('../ai/sourceOverlay.js');
});

const page = (url, text) => ({ type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_fetch_result', url,
  content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text }, title: 'x' }, retrieved_at: '2026-11-02T00:00:00Z' } });
const pdfPage = (url) => ({ type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_2', content: { type: 'web_fetch_result', url,
  content: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } }, retrieved_at: '2026-11-02T00:00:00Z' } });
const msgOf = (...blocks) => ({ content: [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_fetch', input: { url: 'x' } }, ...blocks, { type: 'text', text: '{}' }] });
const ROW = { dataset: 'court_rules', key: 'tn-x', label: 'X court — Dress Code', state: 'TN', jurisdiction: 'TN',
  source_url: 'https://gscourt.nashville.gov/coming-to-court/dress-code/', text: 'The court dress code: shorts, tank tops and hats are not allowed in the courtroom.', checked: '2026-11-01', shown: true, storage: 'code' };
const QUOTE = 'Shorts, tank tops and hats are not allowed in the courtroom.';
const CLAIM = 'shorts, tank tops and hats are not allowed in the courtroom';

describe('allow-list (ai/sourceDomains.js)', () => {
  test('official hosts only; the never-list wins; ASCII only', () => {
    for (const h of ['uscourts.gov', 'www.uscourts.gov', 'tncourts.gov', 'capitol.tn.gov', 'gscourt.nashville.gov', 'leg.state.nv.us', 'gencourt.state.nh.us',
      'ksrevisor.org', 'www.mainelegislature.org', 'wegotransit.com']) expect(dom.isAllowedHost(h)).toBe(true);
    for (const h of ['law.justia.com', 'justia.com', 'www.findlaw.com', 'scdag.squarespace.com', 'ccresourcecenter.org', 'fastdemocracy.com',
      'example.com', 'gov.example.com', 'notgov', 'evilgov.com', 'x.gov.evil.com', '', 'law.cornell.edu']) expect(dom.isAllowedHost(h)).toBe(false);
    expect(dom.isAllowedUrl('https://www.tn.gov/x')).toBe(true);
    expect(dom.isAllowedUrl('https://user:pw@www.tn.gov/x')).toBe(false);          // credentials
    expect(dom.isAllowedUrl('ftp://www.tn.gov/x')).toBe(false);
    expect(dom.isAllowedUrl('https://xn--tn-gov-abc.gov/')).toBe(false);           // punycode / homographs
    expect(dom.isAllowedUrl('https://tn.gov.evil.example/x')).toBe(false);
  });

  test('allowed_domains entries are bare official hosts — never a wildcard, scheme or path', () => {
    expect(dom.fetchDomainFor('https://www.tncourts.gov/rules/x')).toBe('tncourts.gov');
    expect(dom.fetchDomainFor('https://gscourt.nashville.gov/a')).toBe('gscourt.nashville.gov');
    expect(dom.fetchDomainFor('https://law.justia.com/codes/tn/')).toBeNull();
    for (const [, p] of Object.entries(dom.PROPOSAL_SOURCES)) {
      for (const d of p.domains) expect(dom.isAllowedHost(d)).toBe(true);
      for (const u of p.start) expect(dom.isAllowedUrl(u)).toBe(true);
    }
  });

  test('every item the job builds (all registry rows) is a request the API accepts, with official domains only', async () => {
    const rows = await reg.allRows(null);
    expect(rows.length).toBeGreaterThan(400);
    let built = 0;
    for (const row of rows) {
      const item = reg.checkMode(row) === 'recheck' ? sc.recheckItem(row) : sc.proposalItem(row);
      if (!item) { expect(reg.checkMode(row) === 'recheck' && dom.fetchDomainFor(row.source_url)).toBeFalsy(); continue; }
      built += 1;
      const r = batch.itemRequest(item);
      expect(requestProblem(r.params, {})).toBeNull();
      expect(r.params).not.toHaveProperty('fallbacks');
      expect(r.params).not.toHaveProperty('stream');
      expect(batch.CUSTOM_ID_RE.test(item.customId)).toBe(true);
      const tool = r.params.tools[0];
      expect(tool).toMatchObject({ type: 'web_fetch_20250910', name: 'web_fetch' });
      expect(tool).not.toHaveProperty('citations');                                // citations + output_config.format = 400
      for (const d of tool.allowed_domains) { expect(dom.isAllowedHost(d)).toBe(true); expect(d).not.toMatch(/[*/:]/); }
    }
    expect(built).toBeGreaterThan(150);
    // a row whose source is commercial is never re-checked (no fetch of a non-allowed domain)
    const justia = rows.find((x) => /justia\.com/.test(x.source_url || '') && x.shown);
    expect(reg.checkMode(justia)).toBe('not_official');
    expect(sc.recheckItem(justia)).toBeNull();
  });

  test('custom_ids are unique across the whole registry', async () => {
    const rows = await reg.allRows(null);
    const ids = rows.map((r) => sc.customIdFor(reg.checkMode(r) === 'recheck' ? 'r' : 'p', r));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('web fetch tool in the mock (documented shapes)', () => {
  test('the API 400s a wildcard, a scheme, allowed + blocked together, an unknown version', () => {
    const base = { model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'see https://www.tn.gov/a' }] };
    const t = (x) => requestProblem({ ...base, tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', ...x }] });
    expect(t({ allowed_domains: ['*.gov'] })).toMatch(/wildcard/);
    expect(t({ allowed_domains: ['https://tn.gov'] })).toMatch(/scheme/);
    expect(t({ allowed_domains: ['tn.gov'], blocked_domains: ['x.gov'] })).toMatch(/together/);
    expect(requestProblem({ ...base, tools: [{ type: 'web_fetch_2099', name: 'web_fetch' }] })).toMatch(/unknown tool/);
    expect(t({ allowed_domains: ['tn.gov'], max_uses: 2 })).toBeNull();
  });

  test('a URL outside allowed_domains is never fetched (url_not_allowed); a URL not in the conversation neither', () => {
    const body = { model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'open https://law.justia.com/x and https://www.tn.gov/a' }],
      tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', allowed_domains: ['tn.gov'], max_uses: 3 }] };
    const wf = runWebFetch(body, freshState({ fetchUrls: ['https://law.justia.com/x', 'https://www.tn.gov/a', 'https://www.tn.gov/never-mentioned'] }));
    const errs = wf.blocks.filter((b) => b.content?.type === 'web_fetch_tool_result_error').map((b) => b.content.error_code);
    expect(errs).toEqual(['url_not_allowed', 'url_not_in_prior_context']);
    expect(wf.pages.map((p) => p.url)).toEqual(['https://www.tn.gov/a']);
    const r = messageResponse(body, freshState({ fetchUrls: ['https://www.tn.gov/a'] }));
    expect(r.body.content.map((b) => b.type)).toEqual(['thinking', 'text', 'server_tool_use', 'web_fetch_tool_result', 'text']);
    expect(r.body.usage.server_tool_use).toEqual({ web_fetch_requests: 1 });
    expect(gw.finalText(r.body.content)).toBe(r.body.content.at(-1).text);
  });
});

describe('verdict handling (pure)', () => {
  const ok = (json, ...blocks) => sc.decideRecheck(ROW, json, msgOf(...blocks));
  test('still matches + quote on the row\'s own official page → the only automatic change (date)', () => {
    const d = ok({ verdict: 'still_matches', quote: QUOTE, stored_claim: CLAIM, fetched_url: ROW.source_url }, page(ROW.source_url, `Dress code. ${QUOTE} Thank you.`));
    expect(d).toMatchObject({ outcome: 'verified', quoteVerified: true, reason: 'quote_on_page' });
    // whitespace / curly quotes / dashes normalised
    expect(ok({ verdict: 'still_matches', quote: 'Shorts,  tank tops and hats are not allowed in the courtroom.', stored_claim: CLAIM }, page(ROW.source_url, `Dress code: x ${QUOTE.replace(/ /g, '\n ')} y`)).outcome).toBe('verified');
  });
  // Review finding #1: the quote must support the STORED text, not just be some sentence on the page.
  describe('the quote must support the stored rule (48 hours → 12 hours)', () => {
    const R48 = { dataset: 'court_rules', key: 'tn-48', label: 'TN — first appearance', state: 'TN', jurisdiction: 'TN',
      source_url: 'https://www.tncourts.gov/first-appearance', text: 'A person who is arrested must be brought before a judge within 48 hours.', checked: '2026-01-01', shown: true, storage: 'code' };
    const NEW_PAGE = 'Welcome to the Tennessee courts website. A person who is arrested must be brought before a judge within 12 hours under the 2026 amendment.';
    const OLD_PAGE = 'Welcome to the Tennessee courts website. A person who is arrested must be brought before a judge within 48 hours after the arrest.';
    const dec = (json, text) => sc.decideRecheck(R48, { verdict: 'still_matches', fetched_url: R48.source_url, what_changed: null, ...json }, msgOf(page(R48.source_url, text)));
    const CL = 'must be brought before a judge within 48 hours';
    test('the welcome line (on the page, unrelated) never renews the date', () => {
      expect(dec({ quote: 'Welcome to the Tennessee courts website.', stored_claim: null }, NEW_PAGE)).toMatchObject({ outcome: 'queue', reason: 'stored_claim_missing' });
      expect(dec({ quote: 'Welcome to the Tennessee courts website.', stored_claim: CL }, NEW_PAGE)).toMatchObject({ outcome: 'queue', reason: 'claim_numbers_not_in_quote' });
      expect(dec({ quote: 'Welcome to the Tennessee courts website.', stored_claim: 'A person who is arrested' }, OLD_PAGE)).toMatchObject({ outcome: 'queue', reason: 'claim_terms_not_in_quote' });
    });
    test('a quote whose numbers differ from the stored text → queued', () => {
      const q = 'A person who is arrested must be brought before a judge within 12 hours under the 2026 amendment.';
      expect(dec({ quote: q, stored_claim: CL }, NEW_PAGE)).toMatchObject({ outcome: 'queue', reason: 'claim_numbers_not_in_quote', quoteVerified: true });
      // the model "quoting" a stored claim that the row does not have
      expect(dec({ quote: q, stored_claim: 'must be brought before a judge within 12 hours' }, NEW_PAGE)).toMatchObject({ outcome: 'queue', reason: 'stored_claim_not_in_row' });
    });
    test('every number of the whole row must be on the page', () => {
      const two = { ...R48, text: `${R48.text} A bail hearing must be held within 72 hours.` };
      const d = sc.decideRecheck(two, { verdict: 'still_matches', quote: 'A person who is arrested must be brought before a judge within 48 hours after the arrest.', stored_claim: CL, fetched_url: R48.source_url },
        msgOf(page(R48.source_url, OLD_PAGE)));
      expect(d).toMatchObject({ outcome: 'queue', reason: 'row_numbers_not_on_page' });
    });
    test('the page still says 48 hours and the quote carries it → verified', () => {
      expect(dec({ quote: 'A person who is arrested must be brought before a judge within 48 hours after the arrest.', stored_claim: CL }, OLD_PAGE))
        .toMatchObject({ outcome: 'verified', reason: 'quote_on_page' });
    });
    test('helpers: numbers and key words', () => {
      expect([...sc.numberTokens('$1,500 fine, 48-hour hold, § 40-32-101, 2.5 days')]).toEqual(['1500', '48', '40-32-101', '2.5']);
      expect(sc.supportsStored(R48, 'A person who is arrested must be brought before a judge within 48 hours.', CL, OLD_PAGE).ok).toBe(true);
    });
  });
  test('still matches but the quote is not on the page / too short / page is a PDF → queued, never dated', () => {
    expect(ok({ verdict: 'still_matches', quote: 'An invented sentence that the page does not contain.' }, page(ROW.source_url, `Dress code. ${QUOTE}`)))
      .toMatchObject({ outcome: 'queue', quoteVerified: false, reason: 'quote_not_on_page' });
    expect(ok({ verdict: 'still_matches', quote: 'Dress code.' }, page(ROW.source_url, 'Dress code. Other words here.')).outcome).toBe('queue');
    expect(ok({ verdict: 'still_matches', quote: QUOTE }, pdfPage(ROW.source_url))).toMatchObject({ outcome: 'queue', reason: 'pdf_not_verifiable' });
    expect(ok({ verdict: 'still_matches', quote: QUOTE })).toMatchObject({ outcome: 'queue', reason: 'source_page_not_fetched' });
  });
  test('changed / page gone / can\'t tell → queued with what the model said', () => {
    expect(ok({ verdict: 'changed', quote: QUOTE, what_changed: 'hats now allowed' }, page(ROW.source_url, QUOTE))).toMatchObject({ outcome: 'queue', reason: 'changed', whatChanged: 'hats now allowed' });
    expect(ok({ verdict: 'page_gone', quote: null })).toMatchObject({ outcome: 'queue', reason: 'page_gone' });
    expect(ok({ verdict: 'cant_tell', quote: QUOTE }, page(ROW.source_url, QUOTE))).toMatchObject({ outcome: 'queue', reason: 'cant_tell' });
  });
  test('a page from a non-allowed host is never accepted — even if the API returned it and it holds the quote', () => {
    const rogue = 'https://law.justia.com/copy';
    const d = ok({ verdict: 'still_matches', quote: QUOTE, fetched_url: rogue }, page(rogue, `Copy. ${QUOTE}`));
    expect(d).toMatchObject({ outcome: 'queue', reason: 'fetched_page_not_allowed', fetchedUrl: null });
    // another official site is not the row's source either
    expect(ok({ verdict: 'still_matches', quote: QUOTE }, page('https://www.tn.gov/other', QUOTE)).outcome).toBe('queue');
  });
  test('proposals: only an allowed page that was fetched and holds the quote', () => {
    const W = { ...ROW, shown: false, source_url: null };
    const url = 'https://www.tncourts.gov/rules/bail';
    const p = (json, ...b) => sc.decideProposal(W, json, msgOf(...b), ['tn.gov', 'tncourts.gov']);
    expect(p({ found: true, url, quote: QUOTE }, page(url, QUOTE))).toMatchObject({ outcome: 'propose', quoteVerified: true });
    expect(p({ found: true, url: 'https://law.justia.com/x', quote: QUOTE }, page('https://law.justia.com/x', QUOTE))).toMatchObject({ outcome: 'none', reason: 'proposed_url_not_allowed' });
    expect(p({ found: true, url: 'https://www.uscourts.gov/x', quote: QUOTE }, page('https://www.uscourts.gov/x', QUOTE))).toMatchObject({ outcome: 'none', reason: 'proposed_url_outside_domains' });
    expect(p({ found: true, url, quote: QUOTE })).toMatchObject({ outcome: 'none', reason: 'proposed_url_not_fetched' });
    expect(p({ found: true, url, quote: 'Words the page does not have anywhere at all.' }, page(url, QUOTE))).toMatchObject({ outcome: 'none', reason: 'quote_not_on_page' });
    expect(p({ found: false, url: null, quote: null })).toMatchObject({ outcome: 'none' });
    expect(p({ found: true, url, quote: QUOTE }, pdfPage(url))).toMatchObject({ outcome: 'propose', quoteVerified: false, reason: 'pdf_not_verifiable' });
  });
});

describe('overlay (what the app reads)', () => {
  afterEach(() => overlay.setOverlay([]));
  test('checked date = the later of the row\'s own and the verified check; withheld rows disappear', async () => {
    const cr = await import('../data/court_rules.js');
    const ta = await import('../data/transit_agencies.js');
    const before = cr.courtRulesFor({ state: 'TN', county: 'Davidson' });
    expect(before.length).toBeGreaterThan(0);
    overlay.setOverlay([{ dataset: 'court_rules', row_key: before[0].id, checked_on: '2026-12-01', withheld: false },
      { dataset: 'court_rules', row_key: before[1].id, checked_on: '2020-01-01', withheld: true },
      { dataset: 'transit', row_key: 'TN-Davidson', checked_on: '2026-12-02' }]);
    const after = cr.courtRulesFor({ state: 'TN', county: 'Davidson' });
    expect(after.find((r) => r.id === before[0].id).checked).toBe('2026-12-01');
    expect(after.find((r) => r.id === before[1].id)).toBeUndefined();
    expect(ta.transitAgencyFor('Davidson', 'TN').checked).toBe('2026-12-02');
    expect(overlay.checkedOn('x', 'y', '2026-01-01')).toBe('2026-01-01');
    overlay.setOverlay([{ dataset: 'x', row_key: 'y', checked_on: '2025-01-01' }]);
    expect(overlay.checkedOn('x', 'y', '2026-01-01')).toBe('2026-01-01');          // an older check never moves a date back
  });
});

describe('batch layer (pure parts)', () => {
  test('batch price = 50 % of every category; worst case includes fetched pages', () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 }, cache_creation_input_tokens: 1_000_000 };
    expect(pricing.costUsd('claude-sonnet-5-5', u, { batch: true })).toBeCloseTo(pricing.costUsd('claude-sonnet-5-5', u) / 2, 9);
    expect(pricing.costUsd('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }, { batch: true })).toBeCloseTo(12, 9);   // $2 + $10 (batch table)
    expect(pricing.costUsd('claude-haiku-5-5', { input_tokens: 50_000 }, { batch: true })).toBeCloseTo(50_000 * 0.05 / 1e6, 9);   // $0.05 / MTok ≤ 100k
    expect(pricing.costUsd('claude-haiku-5-5', { input_tokens: 200_000 }, { batch: true })).toBeCloseTo(200_000 * 0.25 / 1e6, 9); // long-context tier, halved
    const r = batch.itemRequest(sc.recheckItem(ROW));
    const w0 = batch.worstCaseUsd(r.params);
    expect(batch.worstCaseUsd(r.params, 40_000)).toBeCloseTo(w0 + 40_000 * 1 / 1e6, 6);   // Sonnet 5.5 batch input $1 / MTok
  });

  test('itemRequest: custom_id rules; a batch request never streams and never carries fallbacks', () => {
    expect(() => batch.itemRequest({ customId: 'has space', task: 'chat', messages: [{ role: 'user', content: 'x' }] })).toThrow(/custom_id/);
    expect(() => batch.itemRequest({ customId: 'x'.repeat(65), task: 'chat', messages: [{ role: 'user', content: 'x' }] })).toThrow(/custom_id/);
    const r = batch.itemRequest({ customId: 'ok_1', task: 'chat', messages: [{ role: 'user', content: 'x' }] });
    expect(r.params).not.toHaveProperty('fallbacks');     // chat would use server-side fallback interactively
    expect(() => gw.buildRequest({ task: 'chat', messages: [], batch: true, stream: true })).toThrow();
  });

  test('readResult: succeeded (schema-checked) / errored (nested) / expired / pause_turn / invalid / refusal', () => {
    const it = { params: batch.itemRequest(sc.recheckItem(ROW)).params };
    const m = (content, extra = {}) => ({ type: 'succeeded', message: { model: 'claude-sonnet-5-5', content, stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, ...extra } });
    const good = batch.readResult(it, m([{ type: 'text', text: 'Let me look.' }, page(ROW.source_url, QUOTE), { type: 'text', text: JSON.stringify({ verdict: 'still_matches', quote: QUOTE, stored_claim: CLAIM, what_changed: null, fetched_url: ROW.source_url }) }]));
    expect(good).toMatchObject({ status: 'succeeded', json: { verdict: 'still_matches' } });
    expect(good.cost).toBeCloseTo((1000 * 1 + 100 * 5) / 1e6, 9);
    expect(batch.readResult(it, m([{ type: 'text', text: '{"verdict":"maybe"}' }])).status).toBe('invalid');
    expect(batch.readResult(it, m([], { stop_reason: 'pause_turn' }))).toMatchObject({ status: 'errored', errorType: 'pause_turn' });
    expect(batch.readResult(it, m([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, usage: { input_tokens: 1000, output_tokens: 0 } }))).toMatchObject({ status: 'refused', cost: 0 });   // refusal billing rule
    expect(batch.readResult(it, { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'busy' }, request_id: 'r' } }))
      .toMatchObject({ status: 'errored', errorType: 'overloaded_error', cost: 0 });
    expect(batch.readResult(it, { type: 'expired' })).toMatchObject({ status: 'expired' });
    expect(batch.readResult(it, { type: 'canceled' })).toMatchObject({ status: 'canceled' });
    expect(batch.RETRYABLE_ERRORS.has('overloaded_error')).toBe(true);
    expect(batch.RETRYABLE_ERRORS.has('invalid_request_error')).toBe(false);
  });

  test('JSONL parsing tolerates blank / broken lines; the mock store returns results in any order', () => {
    expect(batch.parseJsonl('{"custom_id":"a","result":{}}\n\nnot json\n{"custom_id":"b","result":{}}\n')).toEqual({ lines: [{ custom_id: 'a', result: {} }, { custom_id: 'b', result: {} }], bad: 1 });
    const store = createBatchStore();
    const st = freshState({ batchErrors: { b: { type: 'overloaded_error', times: 1 } } });
    const params = { model: 'claude-haiku-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] };
    expect(batchRoute(store, 'POST', '/v1/messages/batches', { requests: [{ custom_id: 'a', params }, { custom_id: 'a', params }] }, {}, st, '').status).toBe(400);
    const c = batchRoute(store, 'POST', '/v1/messages/batches', { requests: [{ custom_id: 'a', params }, { custom_id: 'b', params }, { custom_id: 'c', params: { ...params, fallbacks: 'default' } }] }, {}, st, 'http://m');
    expect(c.json).toMatchObject({ type: 'message_batch', processing_status: 'in_progress', results_url: null });
    const g = batchRoute(store, 'GET', `/v1/messages/batches/${c.json.id}`, null, {}, st, '');
    expect(g.json).toMatchObject({ processing_status: 'ended', request_counts: { succeeded: 1, errored: 2 } });
    const lines = batch.parseJsonl(batchRoute(store, 'GET', `/v1/messages/batches/${c.json.id}/results`, null, {}, st, '').text).lines;
    expect(lines.map((l) => l.custom_id)).toEqual(['c', 'b', 'a']);
    expect(lines[0].result.error.error.type).toBe('invalid_request_error');      // fallbacks: not allowed in a batch
    expect(lines[1].result).toMatchObject({ type: 'errored', error: { type: 'error', error: { type: 'overloaded_error' } } });
  });
});

describe('translation drafts (the parity tests\' rules)', () => {
  test('checkDraft', () => {
    expect(tr.checkDraft('Hello {name}, you owe {amount}.', 'es', 'k', 'Hola {name}, usted debe {amount}.')).toEqual([]);
    expect(tr.checkDraft('Hello {name}, you owe {amount}.', 'es', 'k', 'Hola, usted debe {amount}.')).toContain('placeholders_differ');
    expect(tr.checkDraft('Reply STOP to opt out of these text messages.', 'es', 'bd.sms_optout', 'Responda ALTO para no recibir más mensajes de texto.')).toContain('lost_STOP');
    expect(tr.checkDraft('This is a long English sentence about court dates.', 'vi', 'k', 'Ngắn.')).toContain('too_short');
    expect(tr.checkDraft('Court dates and reminders', 'es', 'k', 'Court dates and reminders')).toContain('identical_to_english');
    expect(tr.checkDraft('Hi 👋', 'es', 'k', 'Hola')).toContain('emoji_differ');
    expect(tr.checkDraft('x', 'es', 'k', '  ')).toEqual(['empty']);
  });
  test('inserting server lines keeps comments and English order', () => {
    const src = '/** x */\nexport default {\n  // section\n  "a": "A",\n  "c": "C",\n};\n';
    expect(tr.insertBackendLines(src, ['a', 'b', 'c', 'd'], { a: 1, c: 1 }, { b: 'B', d: 'D' }))
      .toBe('/** x */\nexport default {\n  // section\n  "a": "A",\n  "b": "B",\n  "c": "C",\n  "d": "D",\n};\n');
  });
});
