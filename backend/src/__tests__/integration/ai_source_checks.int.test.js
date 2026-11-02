/**
 * ai_source_checks.int.test.js — AI step 3 on real Postgres with the documented-API mock
 * (Message Batches + web fetch tool, scripts/anthropic-mock-lib.mjs):
 *
 *   batch lifecycle   create (idempotent), poll (in progress → ended), results in any order mapped
 *                     by custom_id, partial errors: transient → retried in a new batch (attempt 2),
 *                     expired → retried, invalid → final; max attempts; caps refuse before sending;
 *                     every succeeded result metered at the batch price (ai_usage_log.batch_id)
 *   source re-check   verified quote → only the date moves (DB last_reviewed_at / overlay); changed,
 *                     quote not on page, PDF → review queue, row unchanged; a withheld row → proposal;
 *                     a page from a non-allowed host is never accepted; allowed_domains official only
 *   admin queue       401 / 403 for others; approve / edit / withhold / restore, each audited;
 *                     approving a proposal publishes the withheld DB row; legaldata + public status follow
 *   eval              admin trigger → answer batch → grading batch → stored results
 *   translation       "translate new keys" → review file whose drafts pass the parity checks
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('AI step 3 — batches, source re-checks, admin queue (real Postgres)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let admin, user, ab, sc, reg, overlay, pricing, dom;
  const fixtures = {};
  const myBatches = new Set();
  const today = new Date().toISOString().slice(0, 10);
  const batchPosts = () => ctx.anthropic.requests.filter((r) => r.method === 'POST' && r.path === '/v1/messages/batches');

  beforeAll(async () => {
    if (!ctx.app) return;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
    ab = await import('../../services/aiBatch.js');
    sc = await import('../../services/sourceChecks/index.js');
    reg = await import('../../services/sourceChecks/registry.js');
    overlay = await import('../../ai/sourceOverlay.js');
    pricing = await import('../../ai/pricing.js');
    dom = await import('../../ai/sourceDomains.js');
    admin = await ctx.register({ displayName: 'Source Admin' });
    user = await ctx.register({ displayName: 'Plain User' });
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    (await import('../../middleware/auth.js')).invalidateUserCache(admin.user.id);
    // a run left open by an earlier, interrupted run of this suite must not block this one
    await ctx.db.run(`UPDATE ai_batches SET status = 'failed', error = 'test reset' WHERE kind IN ('source_check', 'it_echo', 'eval_answer', 'eval_grade', 'translate_keys') AND status NOT IN ('processed', 'failed')`);
    const ins = async (sql, params) => Number((await ctx.db.get(`${sql} RETURNING id`, params)).id);
    fixtures.sol = await ins(`INSERT INTO statute_of_limitations (state, crime_type, years, notes, source, source_url, verified_by, last_reviewed_at)
      VALUES ('TN', ?, -1, 'Murder can be charged at any time.', 'test', 'https://www.tncourts.gov/jgtest/sol', 'Source-checked 2026-10-26 (test fixture)', '2026-10-26')`, [`${ctx.tag}-murder`]);
    fixtures.sol2 = await ins(`INSERT INTO statute_of_limitations (state, crime_type, years, notes, source, source_url, verified_by, last_reviewed_at)
      VALUES ('TN', ?, 1, 'Misdemeanors must be charged within 12 months.', 'test', 'https://www.tncourts.gov/jgtest/sol2', 'Source-checked 2026-10-26 (test fixture)', '2026-10-26')`, [`${ctx.tag}-misd`]);
    fixtures.bail = await ins(`INSERT INTO bail_schedules (state, charge, charge_type, severity, bail_note, source)
      VALUES ('TN', ?, 'misdemeanor', 'low', 'Set by the judge.', 'test')`, [`${ctx.tag}-theft`]);
    ctx.addCleanup(async (db) => {
      const ids = [...myBatches];
      if (ids.length) await db.run(`DELETE FROM ai_usage_log WHERE batch_id IN (${ids.map(() => '?').join(',')})`, ids);
      await db.run(`DELETE FROM legal_source_reviews WHERE dataset IN ('statute_of_limitations', 'bail_schedules') AND row_key IN (?, ?, ?)`, [String(fixtures.sol), String(fixtures.sol2), String(fixtures.bail)]);
      await db.run(`DELETE FROM legal_source_checks WHERE dataset IN ('statute_of_limitations', 'bail_schedules') AND row_key IN (?, ?, ?)`, [String(fixtures.sol), String(fixtures.sol2), String(fixtures.bail)]);
      await db.run(`DELETE FROM legal_source_reviews WHERE batch_id IN (SELECT id FROM ai_batches WHERE created_by = ? OR kind = 'it_echo')`, [admin.user.id]);
      await db.run(`DELETE FROM legal_source_checks WHERE dataset IN ('court_rules', 'transit', 'guide', 'tn_report')`);
      await db.run('DELETE FROM statute_of_limitations WHERE id IN (?, ?)', [fixtures.sol, fixtures.sol2]);
      await db.run('DELETE FROM bail_schedules WHERE id = ?', [fixtures.bail]);
      await db.run(`DELETE FROM audit_log WHERE resource_type = 'legal_source' AND user_id = ?`, [admin.user.id]);
      if (ids.length) await db.run(`DELETE FROM ai_batches WHERE id IN (${ids.map(() => '?').join(',')}) OR root_id IN (${ids.map(() => '?').join(',')}) OR parent_id IN (${ids.map(() => '?').join(',')})`, [...ids, ...ids, ...ids]);
      overlay.setOverlay([]);
    });
  });
  afterEach(() => { ctx.anthropic.extra = {}; ctx.anthropic.mode = 'ok'; ctx.anthropic.json = null; delete process.env.AI_BATCH_MAX_USD; delete process.env.AI_BATCH_MAX_ATTEMPTS; });
  const track = (b) => { if (b?.id) myBatches.add(Number(b.id)); return b; };
  const drain = async () => { for (let i = 0; i < 6; i++) { const r = await ab.pollBatches(ctx.db); const open = await ctx.db.get(`SELECT COUNT(*)::int AS n FROM ai_batches WHERE status IN ('in_progress','ended','processing','canceling')`); if (!open.n) return r; } return null; };
  const allMine = async () => { const r = await ctx.db.all(`SELECT id FROM ai_batches WHERE created_by = ? OR root_id IN (SELECT id FROM ai_batches WHERE created_by = ?) OR kind = 'it_echo'`, [admin.user.id, admin.user.id]); r.forEach((x) => myBatches.add(Number(x.id))); };

  describe('batch lifecycle', () => {
    const handled = [];
    beforeAll(() => { if (ab) ab.registerBatchHandler('it_echo', async (db, batch, items) => { handled.push(...items.map((h) => `${h.item.custom_id}:${h.item.status}:${h.item.attempt}`)); return { n: items.length }; }); });
    const items = (tag) => [
      { customId: `a_${tag}`, task: 'translate', messages: [{ role: 'user', content: 'Translate: hello' }] },
      { customId: `b_${tag}`, task: 'note_structure', messages: [{ role: 'user', content: 'Note: call the lawyer on Monday.' }] },
      { customId: `c_${tag}`, task: 'translate', messages: [{ role: 'user', content: 'Translate: bye' }] },
      { customId: `d_${tag}`, task: 'translate', messages: [{ role: 'user', content: 'Translate: thanks' }] },
    ];

    it('create is idempotent; poll in progress → ended; results mapped by custom_id; partial errors retried once, others final; metered at batch price', async () => {
      const tag = ctx.tag.slice(-6);
      ctx.anthropic.extra = { batchPolls: 1, batchErrors: { [`b_${tag}`]: { type: 'overloaded_error', times: 1 }, [`c_${tag}`]: { type: 'invalid_request_error', times: 1 }, [`d_${tag}`]: { type: 'expired', times: 1 } } };
      const before = batchPosts().length;
      const one = await ab.createBatch(ctx.db, { kind: 'it_echo', items: items(tag), idempotencyKey: `it:${ctx.tag}` });
      track(one.batch);
      const two = await ab.createBatch(ctx.db, { kind: 'it_echo', items: items(tag), idempotencyKey: `it:${ctx.tag}` });
      expect(one.created).toBe(true); expect(two.created).toBe(false); expect(two.batch.id).toBe(one.batch.id);
      expect(batchPosts().length).toBe(before + 1);                               // sent once
      const sent = batchPosts().at(-1).body.requests;
      expect(sent.map((r) => r.custom_id)).toEqual([`a_${tag}`, `b_${tag}`, `c_${tag}`, `d_${tag}`]);
      for (const r of sent) { expect(r.params).not.toHaveProperty('fallbacks'); expect(r.params).not.toHaveProperty('stream'); }

      const p1 = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [one.batch.id]));
      expect(p1).toMatchObject({ status: 'in_progress', processed: false });
      const p2 = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [one.batch.id]));
      expect(p2.processed).toBe(true);
      expect(p2.retried).toBeTruthy();
      track({ id: p2.retried });
      const st = Object.fromEntries((await ctx.db.all('SELECT custom_id, status, attempt FROM ai_batch_items WHERE batch_id = ?', [one.batch.id])).map((r) => [r.custom_id, r.status]));
      expect(st).toEqual({ [`a_${tag}`]: 'succeeded', [`b_${tag}`]: 'retried', [`c_${tag}`]: 'failed', [`d_${tag}`]: 'retried' });
      expect(handled.sort()).toEqual([`a_${tag}:succeeded:1`, `c_${tag}:failed:1`].sort());   // retried ones wait for their retry

      // the retry batch: same custom_ids (unique per batch), attempt 2, parent = the first batch
      const retry = await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [p2.retried]);
      expect(Number(retry.parent_id)).toBe(one.batch.id);
      await ab.pollBatch(ctx.db, retry);                                          // still in progress (batchPolls 1)
      await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [retry.id]));
      const st2 = await ctx.db.all('SELECT custom_id, status, attempt FROM ai_batch_items WHERE batch_id = ? ORDER BY custom_id', [retry.id]);
      expect(st2.map((r) => [r.custom_id, r.status, r.attempt])).toEqual([[`b_${tag}`, 'succeeded', 2], [`d_${tag}`, 'succeeded', 2]]);

      // metering: one ai_usage_log row per succeeded result, at 50 % of the standard price
      const rows = await ctx.db.all('SELECT route, model, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cost_usd, status, batch_id FROM ai_usage_log WHERE batch_id IN (?, ?) ORDER BY id', [one.batch.id, retry.id]);
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.route).toBe('batch:it_echo'); expect(r.status).toBe('completed');
        const full = pricing.costUsd(r.model, { input_tokens: r.input_tokens, output_tokens: r.output_tokens, cache_read_input_tokens: r.cache_read_tokens,
          cache_creation: { ephemeral_5m_input_tokens: r.cache_write_5m_tokens, ephemeral_1h_input_tokens: r.cache_write_1h_tokens },
          cache_creation_input_tokens: Number(r.cache_write_5m_tokens) + Number(r.cache_write_1h_tokens) });
        expect(Number(r.cost_usd)).toBeCloseTo(full / 2, 8);
      }
      const b1 = await ctx.db.get('SELECT status, cost_usd, output FROM ai_batches WHERE id = ?', [one.batch.id]);
      expect(b1.status).toBe('processed');
      expect(Number(b1.cost_usd)).toBeGreaterThan(0);
      // polling a processed batch again does nothing (idempotent)
      const again = await ab.pollBatches(ctx.db);
      expect(again.processed).toBe(0);
    });

    it('caps refuse before anything is sent; with AI_BATCH_MAX_ATTEMPTS=1 a transient error is final', async () => {
      const before = batchPosts().length;
      process.env.AI_BATCH_MAX_USD = '0.0000001';
      await expect(ab.createBatch(ctx.db, { kind: 'it_echo', items: items('cap'), idempotencyKey: `it-cap:${ctx.tag}` })).rejects.toMatchObject({ code: 'ai_too_large' });
      expect(batchPosts().length).toBe(before);
      expect(await ctx.db.get('SELECT id FROM ai_batches WHERE idempotency_key = ?', [`it-cap:${ctx.tag}`])).toBeUndefined();
      delete process.env.AI_BATCH_MAX_USD;
      process.env.AI_BATCH_MAX_ATTEMPTS = '1';
      ctx.anthropic.extra = { batchErrors: { a_once: { type: 'overloaded_error', times: 1 } } };
      const b = track((await ab.createBatch(ctx.db, { kind: 'it_echo', items: [{ customId: 'a_once', task: 'translate', messages: [{ role: 'user', content: 'x' }] }], idempotencyKey: `it-once:${ctx.tag}` })).batch);
      const r = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [b.id]));
      expect(r.retried).toBeNull();
      expect((await ctx.db.get('SELECT status, error_type FROM ai_batch_items WHERE batch_id = ?', [b.id]))).toEqual({ status: 'failed', error_type: 'overloaded_error' });
    });

    // Review finding #5: a handler error never loses the rest of the results.
    const stale = (id) => ctx.db.run(`UPDATE ai_batches SET updated_at = NOW() - INTERVAL '31 minutes' WHERE id = ?`, [id]);
    it('a handler that throws once: the next pass gets ALL items again; processed only after it succeeds', async () => {
      const calls = [];
      let fail = true;
      ab.registerBatchHandler('it_throw', async (db, batch, list) => {
        calls.push(list.map((h) => h.item.custom_id).sort());
        if (fail) { fail = false; throw new Error('database went away'); }
        return { n: list.length };
      });
      const tag = `${ctx.tag.slice(-5)}t`;
      const b = track((await ab.createBatch(ctx.db, { kind: 'it_throw', items: items(tag).slice(0, 3), idempotencyKey: `it-throw:${ctx.tag}` })).batch);
      const r1 = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [b.id]));
      expect(r1.processed).toBe(false);
      expect((await ctx.db.get('SELECT status FROM ai_batches WHERE id = ?', [b.id])).status).toBe('processing');
      await stale(b.id);
      const r2 = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [b.id]));
      expect(r2.processed).toBe(true);
      expect(calls).toEqual([[`a_${tag}`, `b_${tag}`, `c_${tag}`], [`a_${tag}`, `b_${tag}`, `c_${tag}`]]);
      const row = await ctx.db.get('SELECT status, output FROM ai_batches WHERE id = ?', [b.id]);
      expect(row).toMatchObject({ status: 'processed', output: { n: 3 } });
      expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM ai_batch_items WHERE batch_id = ? AND applied_at IS NULL', [b.id])).n).toBe(0);
      // metered once, not again on the second pass
      expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM ai_usage_log WHERE batch_id = ?', [b.id])).n).toBe(3);
    });

    it('per-item handler errors are isolated: other items apply; the failed one is retried, then recorded as failed', async () => {
      process.env.AI_BATCH_HANDLER_ATTEMPTS = '2';
      const seen = [];
      ab.registerBatchHandler('it_each', async (db, batch, list, hctx) => {
        const r = await hctx.each(list, async (h) => { seen.push(h.item.custom_id); if (h.item.custom_id.startsWith('b_')) throw new Error('bad row'); });
        return { failed: r.failed, gaveUp: r.gaveUp };
      });
      const tag = `${ctx.tag.slice(-5)}e`;
      const b = track((await ab.createBatch(ctx.db, { kind: 'it_each', items: items(tag).slice(0, 3), idempotencyKey: `it-each:${ctx.tag}` })).batch);
      const r1 = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [b.id]));
      expect(r1).toMatchObject({ processed: false, left: 1 });
      const applied = await ctx.db.all('SELECT custom_id, applied_at IS NOT NULL AS done, handler_attempts, handler_error FROM ai_batch_items WHERE batch_id = ? ORDER BY custom_id', [b.id]);
      expect(applied.map((x) => [x.custom_id, x.done])).toEqual([[`a_${tag}`, true], [`b_${tag}`, false], [`c_${tag}`, true]]);
      expect(applied[1]).toMatchObject({ handler_attempts: 1, handler_error: 'bad row' });
      await stale(b.id);
      const r2 = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [b.id]));
      expect(r2.processed).toBe(true);                                   // b recorded as failed after 2 tries
      expect(seen).toEqual([`a_${tag}`, `b_${tag}`, `c_${tag}`, `b_${tag}`]);
      expect(await ctx.db.get('SELECT handler_attempts, handler_error, applied_at IS NOT NULL AS done FROM ai_batch_items WHERE batch_id = ? AND custom_id = ?', [b.id, `b_${tag}`]))
        .toEqual({ handler_attempts: 2, handler_error: 'bad row', done: true });
      delete process.env.AI_BATCH_HANDLER_ATTEMPTS;
    });

    // Review finding #6: retries pass the same caps (per-batch and daily budget, incl. web fetch).
    it('retry batches: no POST when the daily budget is exhausted or the per-batch cap would be passed; items failed', async () => {
      const tag = `${ctx.tag.slice(-5)}r`;
      ctx.anthropic.extra = { batchErrors: { [`a_${tag}`]: { type: 'overloaded_error', times: 1 } } };
      const b = track((await ab.createBatch(ctx.db, { kind: 'it_echo', items: items(tag).slice(0, 2), idempotencyKey: `it-budget:${ctx.tag}` })).batch);
      const before = batchPosts().length;
      const prev = process.env.AI_DAILY_BUDGET_USD;
      process.env.AI_DAILY_BUDGET_USD = '0.0000001';
      try {
        const r = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [b.id]));
        expect(r.processed).toBe(true);
        expect(r.retried).toBeNull();
      } finally { if (prev === undefined) delete process.env.AI_DAILY_BUDGET_USD; else process.env.AI_DAILY_BUDGET_USD = prev; }
      expect(batchPosts().length).toBe(before);                          // nothing sent
      expect(await ctx.db.get('SELECT status, error FROM ai_batch_items WHERE batch_id = ? AND custom_id = ?', [b.id, `a_${tag}`]))
        .toMatchObject({ status: 'failed', error: expect.stringContaining('retry not sent: ai_too_large') });

      // the per-batch cap counts the stored web fetch worst case (extra_input_tokens)
      const R0 = { dataset: 'court_rules', key: `it-wf-${tag}`, label: 'IT row', state: 'TN', jurisdiction: 'TN', source_url: 'https://www.tncourts.gov/jgtest/wf',
        text: 'A stored rule used only by this test.', checked: null, shown: true, storage: 'code' };
      const wf = sc.recheckItem(R0);
      const tag2 = `${ctx.tag.slice(-5)}w`;
      const item = { ...wf, customId: `w_${tag2}`, logicalKey: `w:${tag2}` };
      ctx.anthropic.extra = { batchErrors: { [`w_${tag2}`]: { type: 'overloaded_error', times: 1 } } };
      const b2 = track((await ab.createBatch(ctx.db, { kind: 'it_echo', items: [item], idempotencyKey: `it-wf:${ctx.tag}` })).batch);
      const stored = await ctx.db.get('SELECT extra_input_tokens, params FROM ai_batch_items WHERE batch_id = ?', [b2.id]);
      expect(stored.extra_input_tokens).toBe(wf.extraInputTokens);
      // a cap between the request without and with the fetched pages
      const p = typeof stored.params === 'string' ? JSON.parse(stored.params) : stored.params;
      process.env.AI_BATCH_MAX_USD = String((ab.worstCaseUsd(p, 0) + ab.worstCaseUsd(p, wf.extraInputTokens)) / 2);
      const before2 = batchPosts().length;
      const r2 = await ab.pollBatch(ctx.db, await ctx.db.get('SELECT * FROM ai_batches WHERE id = ?', [b2.id]));
      expect(r2.retried).toBeNull();
      expect(batchPosts().length).toBe(before2);
      expect((await ctx.db.get('SELECT status FROM ai_batch_items WHERE batch_id = ?', [b2.id])).status).toBe('failed');
    });
  });

  describe('source re-check run + admin queue', () => {
    let rows, R, batchId;
    const pick = (dataset, key) => rows.find((r) => r.dataset === dataset && r.key === String(key));
    beforeAll(async () => {
      if (!ctx.app) return;
      rows = await reg.allRows(ctx.db);
      R = {
        sol: pick('statute_of_limitations', fixtures.sol), sol2: pick('statute_of_limitations', fixtures.sol2), bail: pick('bail_schedules', fixtures.bail),
        dress: pick('court_rules', 'tn-davidson-general-sessions-dress'), knox: pick('transit', 'TN-Knox'),
        nyTips: pick('guide', 'ny_tips'), tnDhs: pick('guide', 'tn_dhs'),
      };
    });

    it('one batch: verified quote dates the row; everything else is queued; the withheld row gets a proposal; official domains only', async () => {
      expect(R.sol.shown).toBe(true); expect(R.bail.shown).toBe(false);
      const solQuote = 'Murder can be charged at any time under Tennessee law.';
      ctx.anthropic.extra = {
        pages: {
          [R.sol.source_url]: `Statutes of limitation. ${R.sol.text} ${solQuote} Other offenses have limits.`,
          [R.sol2.source_url]: 'Misdemeanor prosecutions must begin within twelve months of the offense.',
          // the mock answers like the model is asked to: the page sentence that states the stored text
          [R.dress.source_url]: 'Dress Code. The General Sessions Court of Metropolitan Nashville & Davidson County posts these dress code rules. Shorts, tank tops and hats are not allowed in the courtroom. Thank you.',
          [R.tnDhs.source_url]: { pdf: true },
        },
        batchJson: {
          [sc.customIdFor('r', R.sol)]: { verdict: 'still_matches', quote: solQuote, stored_claim: 'Murder can be charged at any time', what_changed: null, fetched_url: R.sol.source_url },
          [sc.customIdFor('r', R.sol2)]: { verdict: 'changed', quote: 'Misdemeanor prosecutions must begin within twelve months of the offense.', stored_claim: 'Misdemeanors must be charged within 12 months', what_changed: 'wording only', fetched_url: R.sol2.source_url },
          [sc.customIdFor('r', R.knox)]: { verdict: 'changed', quote: 'Official page at https://katbus.com/buses. This page states the rule exactly as the office published it today.', stored_claim: null, what_changed: 'The agency has a new website address.', fetched_url: R.knox.source_url },
          [sc.customIdFor('r', R.nyTips)]: { verdict: 'still_matches', quote: 'This sentence was never on the court page at all.', stored_claim: null, what_changed: null, fetched_url: R.nyTips.source_url },
          [sc.customIdFor('r', R.tnDhs)]: { verdict: 'still_matches', quote: 'Arrive early and bring your papers to court.', stored_claim: null, what_changed: null, fetched_url: R.tnDhs.source_url },
        },
      };
      const before = { notes: (await ctx.db.get('SELECT notes, verified_by FROM statute_of_limitations WHERE id = ?', [fixtures.sol])) };
      const out = await sc.startSourceCheckRun(ctx.db, { rows: Object.values(R), createdBy: admin.user.id });
      track(out.batch); batchId = out.batch.id;
      expect(out.counts).toMatchObject({ recheck: 6, propose: 1, sent: 7 });
      // the request: official domains only, never a wildcard, no fallbacks, the source URL in the user turn
      const reqs = batchPosts().at(-1).body.requests;
      expect(reqs).toHaveLength(7);
      for (const r of reqs) {
        const t = r.params.tools[0];
        expect(t.type).toBe('web_fetch_20250910');
        for (const d of t.allowed_domains) { expect(dom.isAllowedHost(d)).toBe(true); expect(d).not.toContain('*'); }
        expect(r.params).not.toHaveProperty('fallbacks');
        expect(r.params.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
      }
      expect(reqs.find((r) => r.custom_id === sc.customIdFor('r', R.dress)).params.tools[0].allowed_domains).toEqual(['gscourt.nashville.gov']);
      // a second run while this one is open is refused
      await expect(sc.startSourceCheckRun(ctx.db, { rows: [R.sol] })).rejects.toMatchObject({ code: 'run_in_progress' });

      await drain();
      const b = await ctx.db.get('SELECT status, output FROM ai_batches WHERE id = ?', [batchId]);
      expect(b.status).toBe('processed');
      expect(b.output.applied).toMatchObject({ verified: 2, queued: 4, proposed: 1 });

      // verified: only the date moved
      const sol = await ctx.db.get('SELECT notes, verified_by, last_reviewed_at FROM statute_of_limitations WHERE id = ?', [fixtures.sol]);
      expect(sol.notes).toBe(before.notes.notes); expect(sol.verified_by).toBe(before.notes.verified_by);
      expect(new Date(sol.last_reviewed_at).toISOString().slice(0, 10)).toBe(today);
      expect(await ctx.db.get(`SELECT checked_how, last_outcome FROM legal_source_checks WHERE dataset = 'statute_of_limitations' AND row_key = ?`, [String(fixtures.sol)]))
        .toEqual({ checked_how: 'auto_quote', last_outcome: 'verified' });
      const { courtRulesFor } = await import('../../data/court_rules.js');
      expect(courtRulesFor({ state: 'TN', county: 'Davidson' }).find((r) => r.id === R.dress.key).checked).toBe(today);
      // changed / quote not on the page / PDF → queued, rows unchanged
      const q = await ctx.db.all(`SELECT dataset, row_key, kind, verdict, reason, quote_verified, proposed_source_url FROM legal_source_reviews WHERE batch_id = ? ORDER BY id`, [batchId]);
      const by = Object.fromEntries(q.map((x) => [`${x.dataset}:${x.row_key}`, x]));
      expect(by[`statute_of_limitations:${fixtures.sol2}`]).toMatchObject({ verdict: 'changed', reason: 'changed' });
      expect(by['transit:TN-Knox']).toMatchObject({ verdict: 'changed' });
      expect(by['guide:ny_tips']).toMatchObject({ verdict: 'still_matches', reason: 'quote_not_on_page', quote_verified: false });
      expect(by['guide:tn_dhs']).toMatchObject({ reason: 'pdf_not_verifiable', quote_verified: false });
      expect(by[`bail_schedules:${fixtures.bail}`]).toMatchObject({ kind: 'proposal', verdict: 'source_found', quote_verified: true, proposed_source_url: 'https://www.tncourts.gov/' });
      expect(Number((await ctx.db.get('SELECT last_reviewed_at FROM statute_of_limitations WHERE id = ?', [fixtures.sol2])).last_reviewed_at && 1)).toBe(1);
      expect(new Date((await ctx.db.get('SELECT last_reviewed_at FROM statute_of_limitations WHERE id = ?', [fixtures.sol2])).last_reviewed_at).toISOString().slice(0, 10)).toBe('2026-10-26');
      // the withheld bail row is still withheld (nothing is published without a person)
      const bail = await ctx.request().get('/api/legaldata/bail?state=TN');
      expect(bail.body.data.some((r) => Number(r.id) === fixtures.bail)).toBe(false);
      // metered at the batch price
      const use = await ctx.db.all(`SELECT route, cost_usd FROM ai_usage_log WHERE batch_id = ?`, [batchId]);
      expect(use).toHaveLength(7);
      expect(use.every((u) => u.route === 'batch:source_check')).toBe(true);
    });

    it('a page from a non-allowed host is never accepted (the API returned it; the quote is on it)', async () => {
      const rogue = 'https://law.justia.com/codes/tennessee/x';
      const row = rows.find((r) => r.dataset === 'tn_report');
      ctx.anthropic.extra = { rogueFetch: rogue,
        batchJson: { [sc.customIdFor('r', row)]: { verdict: 'still_matches', quote: `Commercial copy of the rule at ${rogue}.`, stored_claim: null, what_changed: null, fetched_url: rogue } } };
      const out = await sc.startSourceCheckRun(ctx.db, { rows: [row], createdBy: admin.user.id });
      expect(out).toMatchObject({ created: true, counts: { sent: 1 } });
      track(out.batch);
      await drain();
      const c = await ctx.db.get(`SELECT checked_on, last_outcome FROM legal_source_checks WHERE dataset = 'tn_report' AND row_key = 'tn_quarterly'`);
      expect(c.checked_on).toBeNull(); expect(c.last_outcome).toBe('queued');
      const rv = await ctx.db.get(`SELECT reason, fetched_url, quote_verified FROM legal_source_reviews WHERE dataset = 'tn_report' AND status = 'pending'`);
      expect(rv.quote_verified).toBe(false);
      expect(rv.fetched_url === null || dom.isAllowedUrl(rv.fetched_url)).toBe(true);
      expect(['quote_not_on_page', 'fetched_page_not_allowed']).toContain(rv.reason);
      const { tnLawCheckedOn } = await import('../../services/bondDesk/tnReport.js');
      expect(tnLawCheckedOn()).toBe('2026-10-27');                               // unchanged
    });

    it('admin queue: 401 / 403 for others; approve / edit / withhold / restore — each audited', async () => {
      const base = '/api/admin/source-checks';
      expect((await ctx.request().get(`${base}/reviews`)).status).toBe(401);
      expect((await ctx.request().get(`${base}/reviews`).set(user.headers)).status).toBe(403);
      expect((await ctx.request().post(`${base}/run`).set(user.headers).send({})).status).toBe(403);
      const list = await ctx.request().get(`${base}/reviews?limit=200`).set(admin.headers);
      expect(list.status).toBe(200);
      const find = (ds, key) => list.body.rows.find((r) => r.dataset === ds && r.row_key === String(key));
      const decide = (id, body) => ctx.request().post(`${base}/reviews/${id}`).set(admin.headers).send(body);

      // approve the proposal → the withheld bail row is published with the official source
      const prop = find('bail_schedules', fixtures.bail);
      const a = await decide(prop.id, { action: 'approve', note: 'checked the page' });
      expect(a.status).toBe(200); expect(a.body).toMatchObject({ status: 'approved', published: true });
      const bailRow = await ctx.db.get('SELECT source_url, verified_by FROM bail_schedules WHERE id = ?', [fixtures.bail]);
      expect(bailRow.source_url).toBe('https://www.tncourts.gov/'); expect(bailRow.verified_by).toMatch(/^Source-checked \d{4}-\d{2}-\d{2} — source approved by an admin/);
      const shown = await ctx.request().get('/api/legaldata/bail?state=TN');
      expect(shown.body.data.some((r) => Number(r.id) === fixtures.bail)).toBe(true);
      expect((await decide(prop.id, { action: 'approve' })).status).toBe(409);           // not pending any more

      // edit a database row: only its text columns; an unofficial source is refused
      const ch = find('statute_of_limitations', fixtures.sol2);
      expect((await decide(ch.id, { action: 'edit', fields: { notes: 'x' }, source_url: 'https://law.justia.com/x' })).status).toBe(400);
      expect((await decide(ch.id, { action: 'edit', fields: { years: 9 } })).status).toBe(400);
      const e = await decide(ch.id, { action: 'edit', fields: { notes: 'Misdemeanor prosecutions must begin within 12 months.' } });
      expect(e.status).toBe(200);
      expect((await ctx.db.get('SELECT notes FROM statute_of_limitations WHERE id = ?', [fixtures.sol2])).notes).toBe('Misdemeanor prosecutions must begin within 12 months.');

      // edit a row that lives in code → correction recorded, row withheld until a developer applies it
      const kn = find('transit', 'TN-Knox');
      const c = await decide(kn.id, { action: 'edit', text: 'KAT moved to a new web address (see the page).' });
      expect(c.body).toMatchObject({ status: 'edited', needs_developer: true, withheld: true });
      const { transitAgencyFor } = await import('../../data/transit_agencies.js');
      expect(transitAgencyFor('Knox', 'TN')).toBeNull();
      const wl = await ctx.request().get(`${base}/withheld`).set(admin.headers);
      expect(wl.body.rows.find((r) => r.dataset === 'transit')).toMatchObject({ correction: 'KAT moved to a new web address (see the page).' });
      const rs = await ctx.request().post(`${base}/rows/restore`).set(admin.headers).send({ dataset: 'transit', key: 'TN-Knox' });
      expect(rs.status).toBe(200);
      expect(transitAgencyFor('Knox', 'TN')).not.toBeNull();

      // withhold a guide source → the public status says so
      const ny = find('guide', 'ny_tips');
      expect((await decide(ny.id, { action: 'withhold', note: 'quote not found — check by hand' })).body).toMatchObject({ status: 'withheld' });
      const pub = await ctx.request().get('/api/legal-sources/status?dataset=guide');
      expect(pub.status).toBe(200);
      expect(pub.body.datasets.guide.ny_tips).toMatchObject({ withheld: true });

      // approve a PDF re-check by hand → dated today
      const pdf = find('guide', 'tn_dhs');
      expect((await decide(pdf.id, { action: 'approve' })).body.status).toBe('approved');
      expect(overlay.checkedOn('guide', 'tn_dhs', '2026-11-01')).toBe(today);

      expect((await decide(pdf.id, { action: 'nonsense' })).status).toBe(400);
      const audit = await ctx.db.all(`SELECT action, resource_id FROM audit_log WHERE resource_type = 'legal_source' AND user_id = ? ORDER BY id`, [admin.user.id]);
      expect(audit.map((x) => x.action)).toEqual(['admin.source_check_approved', 'admin.source_check_edited', 'admin.source_check_edited', 'admin.source_check_restored', 'admin.source_check_withheld', 'admin.source_check_approved']);
      expect(audit[0].resource_id).toBe(`bail_schedules:${fixtures.bail}`);

      // overview
      const ov = await ctx.request().get(base).set(admin.headers);
      expect(ov.status).toBe(200);
      expect(ov.body.datasets.find((d) => d.dataset === 'expungement')).toMatchObject({ rows: 306 });
      expect(ov.body.runs.length).toBeGreaterThan(0);
    });

    // Review finding #4: a verdict is applied only to the text it was about.
    it('row changed between the batch and its results → no date change, row_changed, due again (DB row and code row)', async () => {
      const id = Number((await ctx.db.get(`INSERT INTO statute_of_limitations (state, crime_type, years, notes, source, source_url, verified_by, last_reviewed_at)
        VALUES ('TN', ?, 2, 'Felony theft must be charged within 2 years.', 'test', 'https://www.tncourts.gov/jgtest/sol3', 'Source-checked 2026-10-26 (test fixture)', '2026-10-26') RETURNING id`, [`${ctx.tag}-ftheft`])).id);
      ctx.addCleanup(async (db) => {
        await db.run(`DELETE FROM legal_source_reviews WHERE dataset = 'statute_of_limitations' AND row_key = ?`, [String(id)]);
        await db.run(`DELETE FROM legal_source_checks WHERE dataset = 'statute_of_limitations' AND row_key = ?`, [String(id)]);
        await db.run('DELETE FROM statute_of_limitations WHERE id = ?', [id]);
      });
      const row = (await reg.allRows(ctx.db)).find((r) => r.dataset === 'statute_of_limitations' && r.key === String(id));
      // a code row whose text in this deploy differs from the text the batch was built with
      const dressOld = { ...R.dress, text: 'The court page posts rules on: dress, phones and food.' };
      const quote = 'Felony theft must be charged within 2 years of the offense.';
      ctx.anthropic.extra = {
        pages: { [row.source_url]: `Statute of limitations. ${row.text} ${quote}`, [R.dress.source_url]: `Dress Code. ${R.dress.text} The court posts rules on: dress, phones and food today.` },
        batchJson: {
          [sc.customIdFor('r', row)]: { verdict: 'still_matches', quote, stored_claim: 'Felony theft must be charged within 2 years', what_changed: null, fetched_url: row.source_url },
          [sc.customIdFor('r', dressOld)]: { verdict: 'still_matches', quote: 'The court posts rules on: dress, phones and food today.', stored_claim: 'posts rules on: dress, phones and food', what_changed: null, fetched_url: R.dress.source_url },
        },
      };
      const overlayBefore = (await ctx.db.get(`SELECT checked_on FROM legal_source_checks WHERE dataset = 'court_rules' AND row_key = ?`, [R.dress.key]))?.checked_on ?? null;
      const out = await sc.startSourceCheckRun(ctx.db, { rows: [row, dressOld], createdBy: admin.user.id, skipDays: 0 });
      track(out.batch);
      expect(out.counts.sent).toBe(2);
      // an admin edits the DB row while the batch runs
      await ctx.db.run(`UPDATE statute_of_limitations SET years = 3, notes = 'Felony theft must be charged within 3 years.' WHERE id = ?`, [id]);
      await drain();
      const b = await ctx.db.get('SELECT status, output FROM ai_batches WHERE id = ?', [out.batch.id]);
      expect(b.status).toBe('processed');
      expect(b.output.applied).toMatchObject({ verified: 0, row_changed: 2 });
      expect(new Date((await ctx.db.get('SELECT last_reviewed_at FROM statute_of_limitations WHERE id = ?', [id])).last_reviewed_at).toISOString().slice(0, 10)).toBe('2026-10-26');
      const c = await ctx.db.get(`SELECT last_outcome, last_attempt_at, checked_on FROM legal_source_checks WHERE dataset = 'statute_of_limitations' AND row_key = ?`, [String(id)]);
      expect(c).toMatchObject({ last_outcome: 'row_changed', last_attempt_at: null, checked_on: null });
      expect((await ctx.db.get(`SELECT checked_on FROM legal_source_checks WHERE dataset = 'court_rules' AND row_key = ?`, [R.dress.key]))?.checked_on ?? null).toEqual(overlayBefore);
      // due again on the next run
      const due = await sc.dueRows(ctx.db, { rows: (await reg.allRows(ctx.db)).filter((r) => r.dataset === 'statute_of_limitations' && r.key === String(id)) });
      expect(due.counts.sent).toBe(1);
    });

    it('approving a review whose row changed since the check → 409 row_changed, review superseded, nothing dated', async () => {
      const id = Number((await ctx.db.get(`INSERT INTO statute_of_limitations (state, crime_type, years, notes, source, source_url, verified_by, last_reviewed_at)
        VALUES ('TN', ?, 4, 'Old note.', 'test', 'https://www.tncourts.gov/jgtest/sol4', 'Source-checked 2026-10-26 (test fixture)', '2026-10-26') RETURNING id`, [`${ctx.tag}-x4`])).id);
      ctx.addCleanup(async (db) => {
        await db.run(`DELETE FROM legal_source_reviews WHERE dataset = 'statute_of_limitations' AND row_key = ?`, [String(id)]);
        await db.run(`DELETE FROM legal_source_checks WHERE dataset = 'statute_of_limitations' AND row_key = ?`, [String(id)]);
        await db.run('DELETE FROM statute_of_limitations WHERE id = ?', [id]);
      });
      const row = (await reg.allRows(ctx.db)).find((r) => r.dataset === 'statute_of_limitations' && r.key === String(id));
      const rv = await ctx.db.get(`INSERT INTO legal_source_reviews (dataset, row_key, kind, label, state, source_url, old_text, verdict, quote, quote_verified, reason)
        VALUES ('statute_of_limitations', ?, 'recheck', ?, 'TN', ?, ?, 'cant_tell', NULL, FALSE, 'cant_tell') RETURNING id`, [String(id), row.label, row.source_url, row.text]);
      await ctx.db.run(`UPDATE statute_of_limitations SET notes = 'New note.' WHERE id = ?`, [id]);
      const r = await ctx.request().post(`/api/admin/source-checks/reviews/${rv.id}`).set(admin.headers).send({ action: 'approve' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('row_changed');
      expect((await ctx.db.get('SELECT status FROM legal_source_reviews WHERE id = ?', [rv.id])).status).toBe('superseded');
      expect(new Date((await ctx.db.get('SELECT last_reviewed_at FROM statute_of_limitations WHERE id = ?', [id])).last_reviewed_at).toISOString().slice(0, 10)).toBe('2026-10-26');
    });
  });

  describe('eval + translation drafts through batches (admin trigger, stored results)', () => {
    it('eval: answers → grading → stored results', async () => {
      expect((await ctx.request().post('/api/admin/ai-batches/eval').set(user.headers).send({ limit: 2 })).status).toBe(403);
      const r = await ctx.request().post('/api/admin/ai-batches/eval').set(admin.headers).send({ limit: 2 });
      expect(r.status).toBe(201);
      track(r.body.batch);
      await drain(); await allMine(); await drain(); await allMine();
      const res = await ctx.request().get(`/api/admin/ai-batches/${r.body.batch.id}/eval`).set(admin.headers);
      expect(res.status).toBe(200);
      expect(res.body.grading).toMatchObject({ status: 'processed' });
      expect(res.body.results).toMatchObject({ questions: 2 });
      expect(res.body.results.per_question).toHaveLength(2);
      expect(typeof res.body.results.overallMean).toBe('number');
      const grade = await ctx.db.get(`SELECT item_count FROM ai_batches WHERE kind = 'eval_grade' AND root_id = ?`, [r.body.batch.id]);
      expect(grade.item_count).toBe(10);                                          // 2 answers × 5 dimensions
    });

    it('translate new keys: only missing keys, drafts that pass the parity checks, a review file to download', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-tr-'));
      const fe = path.join(tmp, 'fe'); const be = path.join(tmp, 'be');
      fs.mkdirSync(fe); fs.mkdirSync(be);
      fs.writeFileSync(path.join(be, 'package.json'), '{"type":"module"}');    // the catalogs are ES modules, like backend/
      const tr = await import('../../services/translationDrafts.js');
      const en = { greet: 'Hello {name}, welcome back to the app.', bye: 'Goodbye and good luck with your court date.' };
      fs.writeFileSync(path.join(fe, 'en.json'), JSON.stringify(en));
      for (const l of tr.LANGS) fs.writeFileSync(path.join(fe, `${l}.json`), JSON.stringify(l === 'es' ? { greet: 'Hola {name}, bienvenido de nuevo.' } : { greet: `[${l}] {name}`, bye: `[${l}] bye bye bye bye bye bye bye bye` }));
      fs.writeFileSync(path.join(be, 'en.js'), 'export default {\n  "a.sms_optout": "Reply STOP to opt out of these text messages.",\n};\n');
      for (const l of tr.LANGS) fs.writeFileSync(path.join(be, `${l}.js`), l === 'es' ? 'export default {\n};\n' : 'export default {\n  "a.sms_optout": "STOP STOP STOP STOP STOP STOP STOP STOP STOP STOP",\n};\n');
      ctx.anthropic.extra = { batchJson: {
        t_fr_es_0: { translations: [{ key: 'bye', text: 'Adiós y buena suerte con su fecha de corte.' }, { key: 'extra', text: 'no' }] },
        t_ba_es_0: { translations: [{ key: 'a.sms_optout', text: 'Responda ALTO para dejar de recibir estos mensajes de texto.' }] },
      } };
      const out = await tr.startTranslationDraft(ctx.db, { dirs: { frontend: fe, backend: be }, createdBy: admin.user.id });
      expect(out.missing).toEqual({ frontend: 1, backend: 1 });
      track(out.batch);
      await drain();
      const dl = await ctx.request().get(`/api/admin/ai-batches/${out.batch.id}/translation-draft`).set(admin.headers);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-disposition']).toMatch(/attachment/);
      expect(dl.body.draft.frontend.es).toEqual({ bye: 'Adiós y buena suerte con su fecha de corte.' });
      expect(dl.body.draft.backend.es).toBeUndefined();                           // lost STOP → rejected, never in the draft
      expect(dl.body.rejected).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'a.sms_optout', problems: ['lost_STOP'] }), expect.objectContaining({ key: 'extra', problems: ['not_asked'] })]));
      for (const [lang, d] of Object.entries(dl.body.draft.frontend)) for (const [k, v] of Object.entries(d)) expect(tr.checkDraft(en[k], lang, k, v)).toEqual([]);
      // nothing was applied
      expect(JSON.parse(fs.readFileSync(path.join(fe, 'es.json'), 'utf8'))).toEqual({ greet: 'Hola {name}, bienvenido de nuevo.' });
      fs.rmSync(tmp, { recursive: true, force: true });
      const info = await ctx.request().get(`/api/admin/ai-batches/${out.batch.id}`).set(admin.headers);
      expect(info.body.output).toMatchObject({ kind: 'translation_draft', counts: { accepted: 1, rejected: 2 } });
      expect(info.body.meta.english).toBeUndefined();
    });
  });
});
