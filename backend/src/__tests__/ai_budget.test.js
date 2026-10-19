/**
 * ai_budget.test.js — checklist item 50: a global daily AI spend cap with
 * alerts, on top of the per-user limits.
 *
 *   - every completion is metered (tokens × model price → cost);
 *   - once today's spend reaches AI_DAILY_BUDGET_USD, anthropicFetch refuses
 *     WITHOUT calling the provider (503 body, reason daily_budget_reached) and
 *     requireAi answers 503 ai_unavailable before a route does any work;
 *   - crossing AI_BUDGET_ALERT_PCT sends one SEV-2 alert; reaching 100 % one
 *     SEV-1 alert — once per day, not once per request;
 *   - the per-user limiter (60 AI calls / user / hour) still applies.
 *
 * Before: no global cap existed (ai_usage_log was written by 2 of 20 AI call
 * sites; nothing read it to stop spending).
 */
import { jest } from '@jest/globals';
import http from 'http';

let hook, hookBodies = [];
beforeAll(async () => {
  hook = http.createServer((req, res) => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => { hookBodies.push(d); res.end('ok'); }); });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${hook.address().port}/hook`;
});
afterAll(async () => {
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.AI_DAILY_BUDGET_USD;
  delete process.env.AI_BUDGET_ALERT_PCT;
  await new Promise(r => hook.close(r));
});

const okCompletion = (outputTokens) => () => Promise.resolve(new Response(JSON.stringify({
  model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 0, output_tokens: outputTokens },
}), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('pricing', () => {
  test('cost follows the model family (Sonnet $3/$15, Opus $15/$75, Haiku $1/$5 per MTok) and env overrides', async () => {
    const { estimateCostUsd } = await import('../services/aiBudget.js');
    expect(estimateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBeCloseTo(18);
    expect(estimateCostUsd('claude-opus-4-1', 1_000_000, 0)).toBeCloseTo(15);
    expect(estimateCostUsd('claude-haiku-4-5', 0, 1_000_000)).toBeCloseTo(5);
    process.env.AI_PRICE_OUTPUT_PER_MTOK = '30';
    expect(estimateCostUsd('claude-sonnet-4-6', 0, 1_000_000)).toBeCloseTo(30);
    delete process.env.AI_PRICE_OUTPUT_PER_MTOK;
  });
});

describe('daily cap', () => {
  test('meters calls, alerts at the threshold and at 100 %, then refuses without calling the provider', async () => {
    const { anthropicFetch } = await import('../services/aiClient.js');
    const { _resetAiBudgetForTests, budgetStatus } = await import('../services/aiBudget.js');
    const { requireAi } = await import('../utils/ai.js');
    _resetAiBudgetForTests();
    hookBodies = [];
    process.env.AI_DAILY_BUDGET_USD = '0.03';
    process.env.AI_BUDGET_ALERT_PCT = '50';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const provider = jest.fn(okCompletion(1000));            // 1000 output tokens = $0.015
      const body = { body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 10, messages: [] }) };

      let r = await anthropicFetch(body, { route: 't', fetchImpl: provider });
      expect(r.status).toBe(200);
      expect((await budgetStatus()).spent_usd).toBeCloseTo(0.015);
      expect(hookBodies.join()).toMatch(/SEV-2.*50% of the daily budget/);   // 50 % crossed → one SEV-2

      r = await anthropicFetch(body, { route: 't', fetchImpl: provider });  // → $0.030 = 100 %
      expect(r.status).toBe(200);
      const status = await budgetStatus();
      expect(status.exhausted).toBe(true);
      expect(hookBodies.join()).toMatch(/SEV-1.*AI daily budget reached/);

      // Refused: the provider is NOT called again
      const calls = provider.mock.calls.length;
      r = await anthropicFetch(body, { route: 't', fetchImpl: provider });
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ error: 'ai_unavailable', reason: 'daily_budget_reached' });
      expect(provider.mock.calls.length).toBe(calls);

      // Routes behind requireAi refuse up front
      const res = { status: jest.fn(function () { return this; }), json: jest.fn(function () { return this; }) };
      const next = jest.fn();
      await requireAi({}, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json.mock.calls[0][0]).toMatchObject({ error: 'ai_unavailable', reason: 'daily_budget_reached' });

      // One alert of each kind per day, not per request
      const sev1 = hookBodies.filter(b => /SEV-1/.test(b)).length;
      await anthropicFetch(body, { route: 't', fetchImpl: provider });
      expect(hookBodies.filter(b => /SEV-1/.test(b)).length).toBe(sev1);
      expect(hookBodies.filter(b => /SEV-2/.test(b)).length).toBe(1);

      // Raising the cap re-opens AI immediately
      process.env.AI_DAILY_BUDGET_USD = '100';
      const next2 = jest.fn();
      await requireAi({}, res, next2);
      expect(next2).toHaveBeenCalled();
    } finally {
      spy.mockRestore(); warn.mockRestore();
      _resetAiBudgetForTests();
      delete process.env.AI_DAILY_BUDGET_USD;
    }
  });

  test('the SDK path (queued jobs, bar-prep explanations) is capped too', async () => {
    const { sdkMessagesCreate } = await import('../services/aiClient.js');
    const { _resetAiBudgetForTests, recordAiUsage } = await import('../services/aiBudget.js');
    _resetAiBudgetForTests();
    process.env.AI_DAILY_BUDGET_USD = '0.01';
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await recordAiUsage({ route: 'x', model: 'claude-sonnet-4-6', outputTokens: 1000 });
      await expect(sdkMessagesCreate({ model: 'claude-sonnet-4-6', max_tokens: 5, messages: [] }, { route: 'x' }))
        .rejects.toMatchObject({ code: 'ai_budget_exceeded', status: 503 });
    } finally { warn.mockRestore(); _resetAiBudgetForTests(); delete process.env.AI_DAILY_BUDGET_USD; }
  });

  test('default cap is $50/day; "off" disables it; garbage falls back to the default', async () => {
    const { dailyBudgetUsd } = await import('../services/aiBudget.js');
    delete process.env.AI_DAILY_BUDGET_USD;
    expect(dailyBudgetUsd()).toBe(50);
    process.env.AI_DAILY_BUDGET_USD = 'off';
    expect(dailyBudgetUsd()).toBeNull();
    process.env.AI_DAILY_BUDGET_USD = '-3';
    expect(dailyBudgetUsd()).toBe(50);
    delete process.env.AI_DAILY_BUDGET_USD;
  });
});

describe('per-user limit (unchanged, still enforced)', () => {
  test('the 61st AI call in an hour from one user gets 429', async () => {
    const { perUserAiLimit } = await import('../middleware/sharedAiLimiter.js');
    const req = { user: { id: `budget-test-${Date.now()}` } };
    const mk = () => ({ status: jest.fn(function () { return this; }), json: jest.fn(function () { return this; }), setHeader: jest.fn() });
    let passed = 0;
    for (let i = 0; i < 61; i++) {
      const res = mk();
      perUserAiLimit(req, res, () => { passed++; });
      if (i === 60) expect(res.status).toHaveBeenCalledWith(429);
    }
    expect(passed).toBe(60);
  });
});
