/**
 * aiBudget.js — global daily AI spend cap + usage accounting.
 *
 * Every paid model call is metered (services/aiClient.js → recordAiUsage):
 * tokens × price → one ai_usage_log row (route, user, model, tokens, cost,
 * duration, status). The running total for the current UTC day is kept in
 * memory and re-synced from ai_usage_log at most once a minute, so several
 * instances converge on the same figure.
 *
 *   AI_DAILY_BUDGET_USD   default 50. Once today's metered spend reaches it,
 *                         new AI calls are refused (503 ai_unavailable,
 *                         reason daily_budget_reached) until 00:00 UTC.
 *                         'off' disables the cap (not recommended).
 *   AI_BUDGET_ALERT_PCT   default 80. Crossing this share of the budget sends
 *                         one SEV-2 alert per day; reaching 100 % sends one
 *                         SEV-1 alert per day (monitoring/errorNotifier.js:
 *                         ONCALL_EMAIL / ALERT_WEBHOOK_URL / Sentry).
 *   AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK
 *                         override the per-million-token input / output prices
 *                         of every model (the table, with cache rates and the
 *                         doc URL + date, is ai/pricing.js).
 *
 * Per-user limits live in middleware/sharedAiLimiter.js (60 AI calls / user /
 * hour across all AI routes) and the free-tier daily chat cap; this module is
 * the backstop for the whole platform.
 */
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { CLAUDE_MODEL } from '../utils/ai.js';
import { ratesFor, costUsd, tokensOf } from '../ai/pricing.js';

const SYNC_MS = 60_000;

export function dailyBudgetUsd() {
  const raw = String(process.env.AI_DAILY_BUDGET_USD ?? '').trim().toLowerCase();
  if (raw === 'off') return null;
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : 50;
}

export function alertPct() {
  const n = Number(process.env.AI_BUDGET_ALERT_PCT);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 80;
}

/**
 * USD per million tokens (input / output) for a model id — ai/pricing.js holds the one table
 * (with cache rates and the doc URL + date it was read).
 */
export function modelPrice(model = CLAUDE_MODEL) {
  const r = ratesFor(model);
  return { input: r.input, output: r.output };
}

/** Cost of plain (uncached) input + output tokens. Cached calls: ai/pricing.js costUsd(). */
export function estimateCostUsd(model, inputTokens = 0, outputTokens = 0) {
  return costUsd(model, { input_tokens: inputTokens, output_tokens: outputTokens });
}

const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const state = { day: utcDay(), spent: 0, syncedAt: 0, alerted: { warn: false, crit: false }, syncing: null };

function rollDay() {
  const d = utcDay();
  if (d !== state.day) {
    state.day = d; state.spent = 0; state.syncedAt = 0;
    state.alerted = { warn: false, crit: false };
  }
}

function syncFromDb(force = false) {
  rollDay();
  if (!force && Date.now() - state.syncedAt < SYNC_MS) return Promise.resolve();
  if (state.syncing) return state.syncing;
  state.syncing = (async () => {
    try {
      const db = await getDb();
      const row = await db.get(
        'SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM ai_usage_log WHERE queued_at >= ?',
        [`${state.day}T00:00:00.000Z`]
      );
      const dbSpent = Number(row?.spent) || 0;
      // Local figure may include rows whose insert failed; never go below it.
      state.spent = Math.max(state.spent, dbSpent);
    } catch (e) {
      logger.warn({ err: e.message }, '[ai_budget] could not read today\'s spend — using the in-process total');
    } finally {
      state.syncedAt = Date.now();
      state.syncing = null;
    }
  })();
  return state.syncing;
}

/** Today's metered spend (USD, UTC day) and the cap. */
export async function budgetStatus() {
  await syncFromDb();
  const budget = dailyBudgetUsd();
  return {
    day: state.day,
    spent_usd: Number(state.spent.toFixed(6)),
    budget_usd: budget,
    remaining_usd: budget == null ? null : Math.max(0, Number((budget - state.spent).toFixed(6))),
    exhausted: budget != null && state.spent >= budget,
    alert_pct: alertPct(),
  };
}

export class AiBudgetExceededError extends Error {
  constructor(status) {
    super('Daily AI budget reached');
    this.name = 'AiBudgetExceededError';
    this.code = 'ai_budget_exceeded';
    this.status = 503;
    this.budget = status;
  }
}

/** The JSON body sent to clients when the cap is reached. */
export const AI_BUDGET_BODY = Object.freeze({
  error: 'ai_unavailable',
  reason: 'daily_budget_reached',
  message: 'AI features are paused for the rest of today. Everything else in the app keeps working — please try again tomorrow.',
});

/** Throws AiBudgetExceededError when today's spend has reached the cap. */
export async function assertAiBudget() {
  const s = await budgetStatus();
  if (s.exhausted) {
    await maybeAlert();
    throw new AiBudgetExceededError(s);
  }
}

async function maybeAlert() {
  const budget = dailyBudgetUsd();
  if (budget == null) return;
  const pct = (state.spent / budget) * 100;
  const details = { day: state.day, spent_usd: Number(state.spent.toFixed(2)), budget_usd: budget, code: 'ai_daily_budget' };
  try {
    const { notifyCritical, notifyError } = await import('../monitoring/errorNotifier.js');
    if (pct >= 100 && !state.alerted.crit) {
      state.alerted.crit = true; state.alerted.warn = true;
      await notifyCritical(`AI daily budget reached ($${details.spent_usd} of $${budget}) — AI features paused until 00:00 UTC`, details);
    } else if (pct >= alertPct() && !state.alerted.warn) {
      state.alerted.warn = true;
      await notifyError(`AI spend at ${Math.floor(pct)}% of the daily budget ($${details.spent_usd} of $${budget})`, details);
    }
  } catch (e) {
    logger.error({ err: e.message }, '[ai_budget] alert failed');
  }
}

/**
 * Meter one model call (one attempt). Never throws (accounting must not break a reply).
 *   { route, userId, model, status,
 *     usage | inputTokens/outputTokens,      raw API usage (cache fields included) or flat counts
 *     costUsd,                               precomputed (refusal / fallback rules); else priced here
 *     durationMs, task, taskClass, requestedModel, stopReason, refusal, refusalCategory,
 *     fallbackModel, errorCode, requestId, traceId, inputTokensEstimated, preflightMethod }
 * status: completed | failed | refused (final refusal) | declined (refused, retried on the
 * fallback model) | invalid (answer failed its schema — not shown).
 * Returns the cost in USD.
 */
export async function recordAiUsage({
  route = 'unknown', userId = null, model = CLAUDE_MODEL, inputTokens = 0, outputTokens = 0, usage = null,
  costUsd: preCost = null, durationMs = null, status = 'completed', task = null, taskClass = null,
  requestedModel = null, stopReason = null, refusal = false, refusalCategory = null, fallbackModel = null,
  errorCode = null, requestId = null, traceId = null, inputTokensEstimated = null, preflightMethod = null,
} = {}) {
  rollDay();
  const t = tokensOf(usage || { input_tokens: inputTokens, output_tokens: outputTokens });
  const cost = Number.isFinite(Number(preCost)) && preCost != null ? Number(preCost) : costUsd(model, usage || { input_tokens: inputTokens, output_tokens: outputTokens });
  state.spent += cost;
  const s80 = (v) => (v == null ? null : String(v).slice(0, 80));
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO ai_usage_log (user_id, route, endpoint, model, input_tokens, output_tokens, cost_usd, duration_ms, status, completed_at,
         task, task_class, requested_model, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, stop_reason,
         refusal, refusal_category, fallback_model, error_code, request_id, trace_id, input_tokens_estimated, preflight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number.isFinite(Number(userId)) && userId != null ? Number(userId) : null, String(route).slice(0, 80), String(route).slice(0, 80),
       String(model || '').slice(0, 80), t.input, t.output, cost, durationMs == null ? null : Math.round(durationMs), status,
       s80(task), s80(taskClass), s80(requestedModel), t.cacheRead, t.cacheWrite5m, t.cacheWrite1h, s80(stopReason),
       !!refusal, s80(refusalCategory), s80(fallbackModel), s80(errorCode), s80(requestId), s80(traceId),
       inputTokensEstimated == null ? null : Math.round(inputTokensEstimated), s80(preflightMethod)]
    );
  } catch (e) {
    logger.warn({ err: e.message, route }, '[ai_budget] usage log insert failed');
  }
  await maybeAlert();
  return cost;
}

/** Test hook: forget the in-process state. */
export function _resetAiBudgetForTests() {
  state.day = utcDay(); state.spent = 0; state.syncedAt = 0; state.syncing = null;
  state.alerted = { warn: false, crit: false };
}
