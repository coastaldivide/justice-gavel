/**
 * services/aiBatch.js — the gateway's batch layer: Message Batches API (~50 % of the price) for
 * bulk work that does not need an answer right away (docs/AI_PLATFORM.md §10).
 *
 * Request shapes — https://platform.claude.com/docs/en/build-with-claude/batch-processing and the
 * API reference (platform.claude.com/docs/en/api/cli/messages/batches.md), read 2026-11-02:
 *   POST   /v1/messages/batches                { requests: [{ custom_id, params }] }   (1–100,000 requests, ≤ 256 MB)
 *   GET    /v1/messages/batches/{id}            { id, type: 'message_batch', processing_status: in_progress | canceling | ended,
 *                                                request_counts: { processing, succeeded, errored, canceled, expired },
 *                                                ended_at, created_at, expires_at, cancel_initiated_at, archived_at, results_url }
 *   GET    /v1/messages/batches/{id}/results    .jsonl, one { custom_id, result } per line, in ANY order:
 *            result.type succeeded { message } | errored { error: { type: 'error', error: { type, message }, request_id } }
 *            | canceled | expired          (only succeeded is billed)
 *   POST   /v1/messages/batches/{id}/cancel
 *   custom_id: ^[a-zA-Z0-9_-]{1,64}$, unique within the batch. params = a normal Messages request;
 *   not allowed in a batch: stream, `fallbacks` (server-side fallback), speed, max_tokens 0.
 *   Supported: structured outputs, prompt caching (identical cache_control blocks; the docs
 *   recommend the 1-hour TTL), thinking, server tools incl. web fetch (a `pause_turn` result is
 *   continued with a follow-up request). Most batches end within 1 hour, at most 24 h (then the
 *   rest expires); results stay downloadable for 29 days from created_at. No beta header.
 *   Price: 50 % of standard for every token category (ai/pricing.js BATCH_DISCOUNT).
 *
 * Lifecycle (all state in ai_batches / ai_batch_items, migration 46):
 *   createBatch()  idempotent by idempotency_key; worst case (every input token uncached, the
 *                  extra input a tool may fetch, max_tokens of output, at the batch price) is
 *                  capped by AI_BATCH_MAX_USD and by what is left of today's AI budget; nothing is
 *                  sent if a cap would be passed (code ai_too_large). Items stored first, then the
 *                  batch is created upstream.
 *   pollBatches()  the 'ai-batches' job (every 10 minutes) and the admin "check now": retrieve,
 *                  and once `ended`, read the results once (an atomic status claim — one
 *                  instance processes a batch), map them back by custom_id, meter each succeeded
 *                  result in ai_usage_log at the batch price (batch_id set), validate structured
 *                  output (an answer that fails its schema is never used), then:
 *   retries        errored items whose error is transient (overloaded / api / rate limit /
 *                  timeout), `pause_turn` results and expired items are sent again in a new batch
 *                  (attempt + 1, up to AI_BATCH_MAX_ATTEMPTS, default 3); others are final.
 *                  A retry batch passes the same caps as a first send (AI_BATCH_MAX_USD and the
 *                  remaining daily budget, with the stored web-fetch worst case per item); when it
 *                  would pass a cap its items are marked failed and nothing is sent.
 *   handlers       the kind's module gets every final item not applied yet (source checks, eval,
 *                  translation drafts). The results are downloaded again on every pass, so a
 *                  handler that fails part-way (or a restart) loses nothing: the next pass hands it
 *                  the items still unapplied. Per-item handlers use ctx.each() (one item's error
 *                  does not stop the others; after AI_BATCH_HANDLER_ATTEMPTS it is recorded as
 *                  failed); a batch is `processed` only when every final item is applied.
 * Privacy: only non-personal content is batched (legal rows, eval questions, app strings); the
 * stored params never hold a person's data. Prompts are not logged.
 */
import { anthropicApi, buildRequest, estimateInputTokens, finalText, responseFacts, AiError } from './aiClient.js';
import { recordAiUsage, budgetStatus } from './aiBudget.js';
import { batchRatesFor, responseCostUsd } from '../ai/pricing.js';
import { validate } from '../ai/schemas/index.js';
import { aiConfigured, ANTHROPIC_BASE_URL } from '../utils/ai.js';
import { taskDef } from '../ai/tasks.js';
import logger from '../utils/logger.js';
import { logIgnored } from '../utils/ignored.js';

export const BATCH_PATH = '/v1/messages/batches';
export const CUSTOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_REQUESTS = 100_000;
/** Errors worth sending again (the request was fine; the service was not). */
export const RETRYABLE_ERRORS = new Set(['overloaded_error', 'api_error', 'rate_limit_error', 'timeout_error', 'gateway_timeout_error', 'pause_turn', 'missing_result']);
export const OPEN_STATUSES = ['in_progress', 'canceling', 'ended'];

const str = (v) => String(v ?? '').trim();
const num = (v, d) => { const n = Number(str(v)); return str(v) !== '' && Number.isFinite(n) && n > 0 ? n : d; };

/** AI_BATCHES=off switches the layer off (default on whenever an API key is set). */
export function batchesEnabled() {
  return aiConfigured() && str(process.env.AI_BATCHES).toLowerCase() !== 'off';
}

export function batchLimits() {
  return {
    maxUsd: num(process.env.AI_BATCH_MAX_USD, 10),
    maxAttempts: Math.max(1, Math.round(num(process.env.AI_BATCH_MAX_ATTEMPTS, 3))),
  };
}

/** Kinds and the module that handles their results (dynamic import: no cycles). */
const KIND_MODULES = {
  source_check: './sourceChecks/index.js',
  eval_answer: './evalBatch.js',
  eval_grade: './evalBatch.js',
  translate_keys: './translationDrafts.js',
};
export const BATCH_KINDS = Object.freeze(Object.keys(KIND_MODULES));
const extraHandlers = new Map();
/** Tests / future kinds: register a handler without a module entry. */
export function registerBatchHandler(kind, fn) { extraHandlers.set(kind, fn); }
async function handlerFor(kind) {
  if (extraHandlers.has(kind)) return extraHandlers.get(kind);
  const p = KIND_MODULES[kind];
  if (!p) return null;
  const m = await import(p);
  return typeof m.onBatchProcessed === 'function' ? m.onBatchProcessed : null;
}

/**
 * One item → its batch request params (built by the gateway, `batch: true`: never streams,
 * never sends `fallbacks`). spec: { customId, logicalKey?, ref?, task, system, messages,
 * maxTokens?, schema?, tools?, extraInputTokens? (worst case a tool may add, e.g. fetched pages) }
 */
export function itemRequest(spec) {
  const id = String(spec.customId || '');
  if (!CUSTOM_ID_RE.test(id)) throw new AiError('ai_failed', `bad custom_id: ${id.slice(0, 80)}`);
  const req = buildRequest({ task: spec.task, system: spec.system, messages: spec.messages, maxTokens: spec.maxTokens,
    schema: spec.schema, tools: spec.tools, model: spec.model || null, batch: true });
  return { customId: id, logicalKey: String(spec.logicalKey || id), ref: spec.ref ?? null, task: req.task, cls: req.cls,
    schemaName: req.schemaName, params: req.body, extraInputTokens: Math.max(0, Math.round(Number(spec.extraInputTokens) || 0)) };
}

/** Worst case of one request at the batch price (all input uncached + tool input + max_tokens out). */
export function worstCaseUsd(params, extraInputTokens = 0) {
  const input = estimateInputTokens(params).tokens + (extraInputTokens || 0);
  const r = batchRatesFor(params.model, input);
  return (input * r.input + (params.max_tokens || 0) * r.output) / 1_000_000;
}

const batchRow = (r) => r && ({
  ...r, id: Number(r.id), item_count: Number(r.item_count), cost_usd: Number(r.cost_usd || 0),
  worst_case_usd: r.worst_case_usd == null ? null : Number(r.worst_case_usd),
  parent_id: r.parent_id == null ? null : Number(r.parent_id), root_id: r.root_id == null ? null : Number(r.root_id),
});

async function apiJson(res) {
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, data, text };
}

/**
 * The caps every batch — first sends and retries alike — must pass before anything is sent:
 * its worst case under AI_BATCH_MAX_USD, and under what is left of today's AI budget after the
 * worst case of the batches still open (sent, not yet metered) is set aside. Throws ai_too_large.
 */
export async function checkCaps(db, { kind, items, worst }) {
  const lim = batchLimits();
  if (worst > lim.maxUsd) {
    logger.warn({ kind, items, worst, cap: lim.maxUsd }, '[ai-batch] not sent — over the per-batch cost cap');
    throw new AiError('ai_too_large', 'batch over AI_BATCH_MAX_USD', { worstUsd: worst, reason: 'max_batch_usd' });
  }
  const b = await budgetStatus();
  let reserved = 0;
  if (b.remaining_usd != null) {
    const open = await db.get(`SELECT COALESCE(SUM(GREATEST(COALESCE(worst_case_usd, 0) - cost_usd, 0)), 0)::float AS usd FROM ai_batches
                                WHERE status IN ('creating', 'in_progress', 'canceling', 'ended') AND created_at > NOW() - INTERVAL '1 day'`);
    reserved = Number(open?.usd || 0);
  }
  if (b.exhausted || (b.remaining_usd != null && worst > b.remaining_usd - reserved)) {
    logger.warn({ kind, worst, remaining: b.remaining_usd, reserved }, '[ai-batch] not sent — larger than what is left of today\'s AI budget');
    throw new AiError('ai_too_large', 'batch over the remaining daily budget', { worstUsd: worst, reason: 'daily_budget_remaining' });
  }
}

/**
 * Create (or find) a batch. → { batch, created }
 *   { kind, items: [spec…], idempotencyKey?, createdBy?, meta?, parentId?, rootId?, fetchImpl? }
 * Throws AiError ai_too_large (caps), ai_unavailable (no key / switched off), or the upstream code.
 */
export async function createBatch(db, { kind, items, idempotencyKey = null, createdBy = null, meta = null, parentId = null, rootId = null, fetchImpl } = {}) {
  if (!BATCH_KINDS.includes(kind) && !extraHandlers.has(kind)) throw new AiError('ai_failed', `unknown batch kind ${kind}`);
  if (idempotencyKey) {
    const existing = await db.get('SELECT * FROM ai_batches WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing) return { batch: batchRow(existing), created: false };
  }
  if (!batchesEnabled()) throw new AiError('ai_unavailable', 'batches are off or no API key');
  const reqs = (items || []).map(itemRequest);
  if (!reqs.length) throw new AiError('ai_failed', 'a batch needs at least one request');
  if (reqs.length > MAX_REQUESTS) throw new AiError('ai_too_large', 'too many requests for one batch');
  const ids = new Set();
  for (const r of reqs) { if (ids.has(r.customId)) throw new AiError('ai_failed', `duplicate custom_id ${r.customId}`); ids.add(r.customId); }
  const worst = reqs.reduce((s, r) => s + worstCaseUsd(r.params, r.extraInputTokens), 0);
  await checkCaps(db, { kind, items: reqs.length, worst });

  const row = await db.get(
    `INSERT INTO ai_batches (kind, status, idempotency_key, parent_id, root_id, item_count, worst_case_usd, meta, created_by)
     VALUES (?, 'creating', ?, ?, ?, ?, ?, ?::jsonb, ?)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING *`,
    [kind, idempotencyKey, parentId, rootId, reqs.length, worst, JSON.stringify(meta || {}), createdBy]);
  if (!row) {   // a concurrent create with the same key won
    const existing = await db.get('SELECT * FROM ai_batches WHERE idempotency_key = ?', [idempotencyKey]);
    return { batch: batchRow(existing), created: false };
  }
  const batchId = Number(row.id);
  for (const r of reqs) {
    const prev = await db.get('SELECT MAX(attempt)::int AS a FROM ai_batch_items WHERE logical_key = ?', [r.logicalKey]);
    await db.run(
      `INSERT INTO ai_batch_items (batch_id, custom_id, logical_key, attempt, task, ref, params, extra_input_tokens)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)`,
      [batchId, r.customId, r.logicalKey, parentId ? (prev?.a || 0) + 1 : 1, r.task, JSON.stringify(r.ref), JSON.stringify(r.params), r.extraInputTokens || 0]);
  }
  // One attempt for the create (plus one retry of a 429 / 5xx, which means nothing was created):
  // a network failure after sending is "unconfirmed" — recorded, never silently re-sent.
  let res;
  try {
    res = await anthropicApi('POST', BATCH_PATH, { body: { requests: reqs.map((r) => ({ custom_id: r.customId, params: r.params })) }, retries: 1, timeoutMs: 120_000, fetchImpl });
  } catch (e) {
    await db.run(`UPDATE ai_batches SET status = 'failed', error = ?, updated_at = NOW() WHERE id = ?`, ['create_unconfirmed', batchId]);
    logger.error({ kind, batchId, err: e.message }, '[ai-batch] create failed (no answer from the API)');
    throw new AiError('ai_busy', 'batch create failed', { batchId });
  }
  const out = await apiJson(res);
  if (!out.ok || !out.data?.id) {
    const code = out.status === 413 ? 'ai_too_large' : out.status === 401 || out.status === 403 ? 'ai_unavailable' : out.status === 429 || out.status >= 500 ? 'ai_busy' : 'ai_failed';
    logger.warn({ kind, batchId, status: out.status, body: out.text.slice(0, 300) }, '[ai-batch] create refused upstream');
    await db.run(`UPDATE ai_batches SET status = 'failed', error = ?, updated_at = NOW() WHERE id = ?`, [`http_${out.status}`, batchId]);
    throw new AiError(code, `batch create failed (${out.status})`, { batchId });
  }
  const d = out.data;
  const updated = await db.get(
    `UPDATE ai_batches SET anthropic_batch_id = ?, status = ?, request_counts = ?::jsonb, submitted_at = NOW(),
            expires_at = ?, updated_at = NOW() WHERE id = ? RETURNING *`,
    [d.id, d.processing_status === 'ended' ? 'ended' : 'in_progress', JSON.stringify(d.request_counts || null), d.expires_at || null, batchId]);
  logger.info({ kind, batchId, anthropicId: d.id, items: reqs.length, worstUsd: Number(worst.toFixed(4)) }, '[ai-batch] created');
  return { batch: batchRow(updated), created: true };
}

/** The results URL, only ever on the API host (the API key is sent with it). */
function resultsPath(batch, data) {
  const u = data?.results_url;
  if (u) {
    try {
      const a = new URL(u); const b = new URL(ANTHROPIC_BASE_URL);
      if (a.host === b.host && a.protocol === b.protocol) return u;
    } catch { /* fall through */ }
    logger.warn({ batchId: batch.id }, '[ai-batch] results_url not on the API host — using the documented path');
  }
  return `${BATCH_PATH}/${encodeURIComponent(batch.anthropic_batch_id)}/results`;
}

/** Parse a .jsonl body into [{ custom_id, result }] (bad lines skipped and counted). */
export function parseJsonl(text) {
  const out = []; let bad = 0;
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { const o = JSON.parse(t); if (o && typeof o.custom_id === 'string') out.push(o); else bad += 1; } catch { bad += 1; }
  }
  return { lines: out, bad };
}

/**
 * Read one result into an item outcome (pure). The message's usage is priced at the batch rate.
 * → { status, json, message, errorType, error, stopReason, model, usage, cost, refused, category }
 */
export function readResult(item, result) {
  const r = result || {};
  if (r.type === 'succeeded' && r.message) {
    const m = r.message;
    const f = responseFacts(m, item.params?.model);
    const cost = responseCostUsd({ model: f.model, usage: m.usage, stopReason: f.stopReason, refusalCategory: f.category, triggerCategory: f.triggerCategory, batch: true });
    const base = { message: m, stopReason: f.stopReason, model: f.model, usage: m.usage || null, cost, refused: f.refused, category: f.category };
    if (f.refused) return { ...base, status: 'refused' };
    if (f.stopReason === 'pause_turn') return { ...base, status: 'errored', errorType: 'pause_turn', error: 'server tool loop paused' };
    const text = finalText(m.content);
    const schema = item.params?.output_config?.format?.schema;
    if (schema) {
      // Validated against the exact schema that was sent (an answer that fails it is never used).
      if (f.stopReason === 'max_tokens') return { ...base, status: 'invalid', error: 'max_tokens' };
      let parsed;
      try { parsed = validate(schema, JSON.parse(text)); } catch { parsed = { ok: false, errors: ['$: not JSON'] }; }
      if (!parsed.ok) return { ...base, status: 'invalid', error: parsed.errors.slice(0, 3).join('; ') };
      return { ...base, status: 'succeeded', json: parsed.value };
    }
    if (!text.trim()) return { ...base, status: 'invalid', error: 'empty' };
    return { ...base, status: 'succeeded', json: null, text };
  }
  if (r.type === 'errored') {
    const inner = r.error?.error || r.error || {};
    return { status: 'errored', errorType: String(inner.type || 'api_error'), error: String(inner.message || '').slice(0, 300), cost: 0 };
  }
  if (r.type === 'canceled') return { status: 'canceled', cost: 0 };
  if (r.type === 'expired') return { status: 'expired', errorType: 'expired', cost: 0 };
  return { status: 'errored', errorType: 'unknown_result', error: 'unrecognised result', cost: 0 };
}

/**
 * Poll one batch; process it when it has ended. → { status, processed, retried?, counts }
 * Safe to call from several instances: only the one that claims the batch processes it.
 */
export async function pollBatch(db, batchIn, { fetchImpl } = {}) {
  const batch = batchRow(batchIn);
  if (!batch?.anthropic_batch_id) return { status: batch?.status, processed: false };
  let data = null;
  if (batch.status !== 'ended') {
    const out = await apiJson(await anthropicApi('GET', `${BATCH_PATH}/${encodeURIComponent(batch.anthropic_batch_id)}`, { retries: 2, fetchImpl }));
    if (!out.ok) {
      logger.warn({ batchId: batch.id, status: out.status }, '[ai-batch] retrieve failed');
      await db.run('UPDATE ai_batches SET polled_at = NOW(), updated_at = NOW() WHERE id = ?', [batch.id]);
      return { status: batch.status, processed: false, error: `http_${out.status}` };
    }
    data = out.data;
    const st = data.processing_status === 'ended' ? 'ended' : data.processing_status === 'canceling' ? 'canceling' : 'in_progress';
    await db.run(`UPDATE ai_batches SET status = ?, request_counts = ?::jsonb, ended_at = COALESCE(?, ended_at), polled_at = NOW(), updated_at = NOW()
                   WHERE id = ? AND status IN ('in_progress', 'canceling', 'ended')`,
      [st, JSON.stringify(data.request_counts || null), data.ended_at || null, batch.id]);
    if (st !== 'ended') return { status: st, processed: false, counts: data.request_counts || null };
  }
  return processBatch(db, batch, data, { fetchImpl });
}

/** A stored item row in the shape handlers get (numbers, parsed params). */
const normItem = (row) => ({ ...row, id: Number(row.id), attempt: Number(row.attempt), params: withSchema(row).params, ref: row.ref });

/** How many times a handler may fail on one item (or as a whole) before it is recorded as failed. */
export function handlerAttempts() {
  return Math.max(1, Math.round(num(process.env.AI_BATCH_HANDLER_ATTEMPTS, 3)));
}

async function processBatch(db, batch, data, { fetchImpl }) {
  // Claim: ended → processing (or a stale processing claim after 30 minutes).
  const claimed = await db.get(
    `UPDATE ai_batches SET status = 'processing', updated_at = NOW()
      WHERE id = ? AND (status = 'ended' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes')) RETURNING id`, [batch.id]);
  if (!claimed) return { status: 'processing', processed: false };
  try {
    // The results are downloaded again on every pass (they stay available for 29 days), so the
    // handler's input can always be re-derived: items still pending are finished from their line;
    // items finished on an earlier pass whose handler did not complete are rebuilt from theirs.
    const res = await anthropicApi('GET', resultsPath(batch, data), { retries: 2, timeoutMs: 120_000, fetchImpl });
    const out = await apiJson(res);
    if (!out.ok) throw new Error(`results http_${out.status}`);
    const { lines, bad } = parseJsonl(out.text);
    if (bad) logger.warn({ batchId: batch.id, bad }, '[ai-batch] unreadable result lines skipped');
    const lineById = new Map();
    for (const line of lines) if (!lineById.has(line.custom_id)) lineById.set(line.custom_id, line);   // a duplicate line is ignored
    const pending = await db.all(`SELECT * FROM ai_batch_items WHERE batch_id = ? AND status = 'pending' ORDER BY id LIMIT ${MAX_REQUESTS}`, [batch.id]);
    const fresh = new Map();
    let cost = 0;
    for (const item of pending) {
      const line = lineById.get(item.custom_id);
      const r = line ? readResult(withSchema(item), line.result) : { status: 'errored', errorType: 'missing_result', error: 'no result line for this custom_id', cost: 0 };
      const h = await finishItem(db, batch, item, r);
      if (h) { fresh.set(h.item.id, h); cost += h.cost || 0; }
    }
    if (cost) await db.run('UPDATE ai_batches SET cost_usd = cost_usd + ?, updated_at = NOW() WHERE id = ?', [cost, batch.id]);
    // Retries: every item of this batch marked for a retry (idempotent per batch). A retry that
    // cannot be sent (caps, budget, API) marks its items failed, and they go to the handler below.
    const toRetry = (await db.all(`SELECT * FROM ai_batch_items WHERE batch_id = ? AND status = 'retried' ORDER BY id LIMIT ${MAX_REQUESTS}`, [batch.id])).map(normItem);
    const retried = await retryItems(db, batch, toRetry, { fetchImpl });
    // The handler's input: every final item not applied yet.
    const todo = await db.all(`SELECT * FROM ai_batch_items WHERE batch_id = ? AND status NOT IN ('pending', 'retried') AND applied_at IS NULL ORDER BY id LIMIT ${MAX_REQUESTS}`, [batch.id]);
    const handled = todo.map((row) => {
      const item = normItem(row);
      const f = fresh.get(item.id);
      if (f) return { ...f, item, willRetry: false };
      const line = lineById.get(item.custom_id);
      const r = line ? readResult(item, line.result) : { status: 'errored', errorType: item.error_type || 'missing_result', error: item.error || null, cost: 0 };
      return { item, outcome: r, message: r.message || null, willRetry: false, cost: 0 };
    });
    const fn = await handlerFor(batch.kind);
    const ctx = handlerContext(db, batch);
    let output = null;
    if (fn && (handled.length || batch.output == null)) output = await fn(db, { ...batch, retried_batch_id: retried?.batch?.id ?? null }, handled, ctx);
    if (!ctx.perItem && handled.length) {
      // A handler that works on the whole list (eval, translation drafts) finished: all applied.
      await db.run(`UPDATE ai_batch_items SET applied_at = NOW() WHERE batch_id = ? AND status NOT IN ('pending', 'retried') AND applied_at IS NULL`, [batch.id]);
    }
    const left = await db.get(`SELECT COUNT(*)::int AS n FROM ai_batch_items WHERE batch_id = ? AND status NOT IN ('pending', 'retried') AND applied_at IS NULL`, [batch.id]);
    const withOutput = output !== undefined && output !== null;
    const counts = handled.reduce((a, h) => { a[h.item.status] = (a[h.item.status] || 0) + 1; return a; }, {});
    if (left.n > 0) {
      // Some items hit a handler error and will be tried again: stay claimed; the claim goes stale
      // in ~5 minutes and the next poll hands the handler those items only.
      await db.run(`UPDATE ai_batches SET error = ?, updated_at = NOW() - INTERVAL '25 minutes'${withOutput ? ', output = ?::jsonb' : ''} WHERE id = ?`,
        withOutput ? [`handler_partial: ${left.n} item(s) to retry`, JSON.stringify(output), batch.id] : [`handler_partial: ${left.n} item(s) to retry`, batch.id]);
      logger.warn({ batchId: batch.id, kind: batch.kind, left: left.n }, '[ai-batch] handler failed on some items — will retry them');
      return { status: 'processing', processed: false, counts, retried: retried?.batch?.id ?? null, left: left.n };
    }
    await db.run(`UPDATE ai_batches SET status = 'processed', processed_at = NOW(), error = NULL, updated_at = NOW()${withOutput ? ', output = ?::jsonb' : ''} WHERE id = ?`,
      withOutput ? [JSON.stringify(output), batch.id] : [batch.id]);
    logger.info({ batchId: batch.id, kind: batch.kind, counts, costUsd: Number(cost.toFixed(6)), retryBatch: retried?.batch?.id ?? null }, '[ai-batch] processed');
    return { status: 'processed', processed: true, counts, retried: retried?.batch?.id ?? null };
  } catch (e) {
    // Leave it claimed; the claim goes stale and the next poll tries again (the unapplied items
    // are re-derived then). After AI_BATCH_HANDLER_ATTEMPTS whole-pass failures the batch is
    // marked failed so it is visible to an admin (its items keep their results).
    const row = await db.get(`UPDATE ai_batches SET handler_attempts = handler_attempts + 1, error = ?, updated_at = NOW() - INTERVAL '25 minutes'
                                WHERE id = ? RETURNING handler_attempts`, [String(e.message).slice(0, 200), batch.id]).catch((err) => { logIgnored('services/aiBatch')(err); return null; });
    if (row && Number(row.handler_attempts) >= handlerAttempts()) {
      await db.run(`UPDATE ai_batches SET status = 'failed', error = ?, updated_at = NOW() WHERE id = ?`, [`processing_failed: ${String(e.message).slice(0, 180)}`, batch.id]).catch(logIgnored('services/aiBatch'));
      logger.error({ batchId: batch.id, err: e.message }, '[ai-batch] processing failed too many times — batch marked failed');
      return { status: 'failed', processed: false, error: e.message };
    }
    logger.error({ batchId: batch.id, err: e.message }, '[ai-batch] processing failed — will retry');
    return { status: 'processing', processed: false, error: e.message };
  }
}

/**
 * What a handler gets as its 4th argument. `each(list, fn)` runs fn per item with its own error
 * isolation: an item whose fn succeeds is marked applied; one that throws gets its error recorded
 * (handler_attempts + 1) and is handed over again on the next pass, until AI_BATCH_HANDLER_ATTEMPTS,
 * when it is recorded as failed (applied_at set, handler_error kept). → { ok, failed, gaveUp }
 */
function handlerContext(db, batch) {
  const ctx = {
    perItem: false,
    async each(list, fn) {
      ctx.perItem = true;
      const res = { ok: 0, failed: 0, gaveUp: 0 };
      for (const h of list) {
        try {
          await fn(h);
          await db.run('UPDATE ai_batch_items SET applied_at = NOW(), handler_error = NULL WHERE id = ?', [h.item.id]);
          res.ok += 1;
        } catch (e) {
          res.failed += 1;
          const r = await db.get(
            `UPDATE ai_batch_items SET handler_attempts = handler_attempts + 1, handler_error = ?,
                    applied_at = CASE WHEN handler_attempts + 1 >= ? THEN NOW() ELSE NULL END
              WHERE id = ? RETURNING applied_at`, [String(e.message || e).slice(0, 300), handlerAttempts(), h.item.id]);
          if (r?.applied_at) res.gaveUp += 1;
          logger.error({ batchId: batch.id, itemId: h.item.id, err: String(e.message || e).slice(0, 200), gaveUp: !!r?.applied_at }, '[ai-batch] handler failed on one item');
        }
      }
      return res;
    },
  };
  return ctx;
}

const classOf = (task) => { try { return taskDef(task).cls; } catch { return null; } };
const withSchema = (item) => ({ ...item, params: typeof item.params === 'string' ? JSON.parse(item.params) : item.params });

async function finishItem(db, batch, item, r) {
  const lim = batchLimits();
  const willRetry = ((r.status === 'errored' && RETRYABLE_ERRORS.has(r.errorType)) || r.status === 'expired') && Number(item.attempt) < lim.maxAttempts;
  const status = willRetry ? 'retried' : r.status === 'errored' ? 'failed' : r.status;
  const row = await db.get(
    `UPDATE ai_batch_items SET status = ?, result = ?::jsonb, error_type = ?, error = ?, stop_reason = ?, model = ?, usage = ?::jsonb,
            cost_usd = ?, updated_at = NOW() WHERE id = ? AND status = 'pending' RETURNING *`,
    [status, JSON.stringify(r.json ?? (r.text != null ? { text: r.text } : null)), r.errorType || null, r.error || null, r.stopReason || null,
     r.model || null, JSON.stringify(r.usage || null), r.cost || 0, item.id]);
  if (!row) return null;   // another worker finished it
  if (r.message) {
    const p = withSchema(item).params;
    await recordAiUsage({
      route: `batch:${batch.kind}`, task: item.task, taskClass: classOf(item.task), model: r.model || p.model, requestedModel: p.model,
      usage: r.usage, costUsd: r.cost, status: r.status === 'succeeded' ? 'completed' : r.status === 'refused' ? 'refused' : 'invalid',
      stopReason: r.stopReason, refusal: !!r.refused, refusalCategory: r.category || null,
      errorCode: r.status === 'invalid' ? 'ai_invalid_output' : null, batchId: batch.id,
    });
  }
  return { item: { ...row, id: Number(row.id), attempt: Number(row.attempt), params: withSchema(row).params, ref: row.ref }, outcome: r, message: r.message || null, willRetry, cost: r.cost || 0 };
}

/** Send the retryable items of a processed batch again (one new batch, attempt + 1). */
export async function retryItems(db, batch, items, { fetchImpl } = {}) {
  const again = items.filter((it) => it && it.status === 'retried');
  if (!again.length) return null;
  try {
    const out = await createBatchFromParams(db, batch, again, { fetchImpl });
    return out;
  } catch (e) {
    logger.error({ batchId: batch.id, items: again.length, err: e.message }, '[ai-batch] retry batch could not be created — items marked failed');
    for (const it of again) await db.run(`UPDATE ai_batch_items SET status = 'failed', error = COALESCE(error, '') || ' (retry not sent: ' || ? || ')' WHERE id = ? AND status = 'retried'`, [e.code || 'error', it.id]);
    return null;
  }
}

/** A retry batch from stored params (same custom_id — unique per batch — same logical key). */
async function createBatchFromParams(db, batch, items, { fetchImpl }) {
  if (!batchesEnabled()) throw new AiError('ai_unavailable', 'batches are off');
  const idem = `retry:${batch.id}`;
  const existing = await db.get('SELECT * FROM ai_batches WHERE idempotency_key = ?', [idem]);
  if (existing) {
    // A retry batch that was never sent (create refused / interrupted): its items are failed now.
    if (existing.status === 'failed' && !existing.anthropic_batch_id) throw new AiError('ai_busy', 'retry batch was not sent');
    return { batch: batchRow(existing), created: false };
  }
  // The same caps as a first send, with the same worst case (incl. the web fetch content).
  const worst = items.reduce((s, it) => s + worstCaseUsd(it.params, Number(it.extra_input_tokens) || 0), 0);
  await checkCaps(db, { kind: batch.kind, items: items.length, worst });
  const row = await db.get(
    `INSERT INTO ai_batches (kind, status, idempotency_key, parent_id, root_id, item_count, worst_case_usd, meta, created_by)
     VALUES (?, 'creating', ?, ?, ?, ?, ?, ?::jsonb, NULL)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING *`,
    [batch.kind, idem, batch.id, batch.root_id || batch.id, items.length, worst, JSON.stringify({ ...(typeof batch.meta === 'object' ? batch.meta : {}), retry_of: batch.id })]);
  if (!row) return { batch: batchRow(await db.get('SELECT * FROM ai_batches WHERE idempotency_key = ?', [idem])), created: false };
  for (const it of items) {
    await db.run(`INSERT INTO ai_batch_items (batch_id, custom_id, logical_key, attempt, task, ref, params, extra_input_tokens) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)`,
      [row.id, it.custom_id, it.logical_key, Number(it.attempt) + 1, it.task, JSON.stringify(it.ref ?? null), JSON.stringify(it.params), Number(it.extra_input_tokens) || 0]);
  }
  let res;
  try {
    res = await anthropicApi('POST', BATCH_PATH, { body: { requests: items.map((it) => ({ custom_id: it.custom_id, params: it.params })) }, retries: 1, timeoutMs: 120_000, fetchImpl });
  } catch (e) {
    await db.run(`UPDATE ai_batches SET status = 'failed', error = ? WHERE id = ?`, ['create_unconfirmed', row.id]);
    throw new AiError('ai_busy', 'retry batch create failed (no answer from the API)');
  }
  const out = await apiJson(res);
  if (!out.ok || !out.data?.id) {
    await db.run(`UPDATE ai_batches SET status = 'failed', error = ? WHERE id = ?`, [`http_${out.status}`, row.id]);
    throw new AiError('ai_busy', `retry batch create failed (${out.status})`);
  }
  const updated = await db.get(`UPDATE ai_batches SET anthropic_batch_id = ?, status = ?, request_counts = ?::jsonb, submitted_at = NOW(), expires_at = ?, updated_at = NOW() WHERE id = ? RETURNING *`,
    [out.data.id, out.data.processing_status === 'ended' ? 'ended' : 'in_progress', JSON.stringify(out.data.request_counts || null), out.data.expires_at || null, row.id]);
  logger.info({ batchId: Number(row.id), retryOf: batch.id, items: items.length }, '[ai-batch] retry batch created');
  return { batch: batchRow(updated), created: true };
}

/**
 * The 'ai-batches' job: poll every open batch (oldest first, at most 25 per run) and process the
 * ended ones. Batches stuck in 'creating' for an hour (the process died before the create call
 * finished) are marked failed so they are visible.
 */
export async function pollBatches(db, { fetchImpl, limit = 25 } = {}) {
  if (!batchesEnabled()) return { skipped: 'off' };
  await db.run(`UPDATE ai_batches SET status = 'failed', error = COALESCE(error, 'create_interrupted'), updated_at = NOW()
                 WHERE status = 'creating' AND created_at < NOW() - INTERVAL '1 hour'`);
  const open = await db.all(
    `SELECT * FROM ai_batches WHERE anthropic_batch_id IS NOT NULL
        AND (status IN ('in_progress', 'canceling', 'ended') OR (status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes'))
      ORDER BY created_at ASC LIMIT ${Math.max(1, Math.min(100, limit))}`);
  const out = { polled: 0, processed: 0, retried: 0 };
  for (const b of open) {
    try {
      const r = await pollBatch(db, b, { fetchImpl });
      out.polled += 1;
      if (r.processed) out.processed += 1;
      if (r.retried) out.retried += 1;
    } catch (e) {
      logger.warn({ batchId: Number(b.id), err: e.message }, '[ai-batch] poll failed');
    }
  }
  return out;
}

/** Ask the API to cancel a batch (admin). Results that already finished are still processed. */
export async function cancelBatch(db, id, { fetchImpl } = {}) {
  const b = await db.get('SELECT * FROM ai_batches WHERE id = ?', [id]);
  if (!b) return null;
  if (!b.anthropic_batch_id || !['in_progress'].includes(b.status)) return batchRow(b);
  const out = await apiJson(await anthropicApi('POST', `${BATCH_PATH}/${encodeURIComponent(b.anthropic_batch_id)}/cancel`, { retries: 1, fetchImpl }));
  if (out.ok) await db.run(`UPDATE ai_batches SET status = 'canceling', updated_at = NOW() WHERE id = ? AND status = 'in_progress'`, [id]);
  return batchRow(await db.get('SELECT * FROM ai_batches WHERE id = ?', [id]));
}

/** Admin listing (newest first, bounded). */
export async function listBatches(db, { kind = null, limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = kind
    ? await db.all(`SELECT id, kind, status, anthropic_batch_id, parent_id, root_id, item_count, request_counts, worst_case_usd, cost_usd, error, created_at, submitted_at, ended_at, processed_at, (output->'eval'->>'overallMean')::float AS eval_mean, (output->'eval'->>'questions')::int AS eval_questions FROM ai_batches WHERE kind = ? ORDER BY id DESC LIMIT ${lim}`, [kind])
    : await db.all(`SELECT id, kind, status, anthropic_batch_id, parent_id, root_id, item_count, request_counts, worst_case_usd, cost_usd, error, created_at, submitted_at, ended_at, processed_at, (output->'eval'->>'overallMean')::float AS eval_mean, (output->'eval'->>'questions')::int AS eval_questions FROM ai_batches ORDER BY id DESC LIMIT ${lim}`);
  return rows.map(batchRow);
}

/** One batch with its item status counts and output. */
export async function getBatch(db, id) {
  const b = await db.get('SELECT * FROM ai_batches WHERE id = ?', [id]);
  if (!b) return null;
  const counts = await db.all('SELECT status, COUNT(*)::int AS n FROM ai_batch_items WHERE batch_id = ? GROUP BY status', [id]);
  return { ...batchRow(b), items: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}
