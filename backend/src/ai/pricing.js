/**
 * ai/pricing.js — the ONE price table for Anthropic usage (USD per million tokens).
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing ("Model pricing" table)
 *         https://platform.claude.com/docs/en/build-with-claude/prompt-caching (cache multipliers)
 *         https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback (refusal billing)
 * Read:   2026-11-02. Update this file (and only this file) when the prices change.
 *
 * Every token category is priced separately:
 *   input        uncached input tokens (usage.input_tokens — tokens after the last cache breakpoint)
 *   write5m      tokens written to the 5-minute cache (usage.cache_creation.ephemeral_5m_input_tokens)
 *   write1h      tokens written to the 1-hour cache   (usage.cache_creation.ephemeral_1h_input_tokens)
 *   read         cache hits and refreshes              (usage.cache_read_input_tokens)
 *   output       output tokens, thinking included      (usage.output_tokens)
 * Total input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens (the
 * prompt-caching page: input_tokens does NOT include cached tokens).
 *
 * Haiku 5.5 has a long-context tier: a request whose prompt (all input tokens, cache reads and
 * writes included) is over 100,000 tokens pays the higher rates for the whole request.
 *
 * Models not in the table (older ids, a typo in CLAUDE_MODEL) fall back to conservative family
 * prices that err on the high side (Opus $15/$75, Sonnet $3/$15, Haiku $1/$5, standard cache
 * multipliers 1.25× / 2× / 0.1×), so an unknown model never under-counts the daily budget.
 *
 * AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK (env) override the input / output rate of
 * every model (kept from services/aiBudget.js; cache rates scale with the input override).
 */
export const PRICING_SOURCE = Object.freeze({
  url: 'https://platform.claude.com/docs/en/about-claude/pricing',
  read: '2026-11-02',
});

const row = (input, output, write5m, write1h, read) => Object.freeze({ input, output, write5m, write1h, read });

/** Longest id first so 'claude-sonnet-5-5' wins over 'claude-sonnet-5'. Dated ids match by prefix. */
export const PRICES = Object.freeze({
  'claude-opus-5-5':   row(4, 20, 5, 8, 0.20),
  'claude-sonnet-5-5': row(2, 10, 2.5, 4, 0.10),
  'claude-haiku-5-5':  Object.freeze({ ...row(0.10, 0.50, 0.125, 0.20, 0.01),
    longContext: Object.freeze({ overTokens: 100_000, ...row(0.50, 2.50, 0.625, 1, 0.05) }) }),
  'claude-sonnet-5':   row(2, 10, 2.5, 4, 0.20),
  'claude-opus-5':     row(5, 25, 6.25, 10, 0.50),
  'claude-haiku-4-5':  row(1, 5, 1.25, 2, 0.10),
});
const IDS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

const family = (input, output) => row(input, output, input * 1.25, input * 2, input * 0.1);
const FAMILY = Object.freeze({ opus: family(15, 75), sonnet: family(3, 15), haiku: family(1, 5) });

/** The price row for a model id (exact table entry, else the conservative family default). */
export function priceRow(model) {
  const m = String(model || '').toLowerCase();
  const id = IDS.find((k) => m === k || m.startsWith(`${k}-`) || m.startsWith(`${k}@`));
  if (id) return PRICES[id];
  if (m.includes('opus')) return FAMILY.opus;
  if (m.includes('haiku')) return FAMILY.haiku;
  return FAMILY.sonnet;
}

function envRate(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Rates for one request: the tier (Haiku long context) and the env overrides applied. */
export function ratesFor(model, promptTokens = 0) {
  let p = priceRow(model);
  if (p.longContext && promptTokens > p.longContext.overTokens) p = p.longContext;
  const inOv = envRate(process.env.AI_PRICE_INPUT_PER_MTOK);
  const outOv = envRate(process.env.AI_PRICE_OUTPUT_PER_MTOK);
  if (inOv == null && outOv == null) return p;
  const scale = inOv != null && p.input > 0 ? inOv / p.input : 1;
  return {
    input: inOv ?? p.input, output: outOv ?? p.output,
    write5m: p.write5m * scale, write1h: p.write1h * scale, read: p.read * scale,
  };
}

const n = (v) => Math.max(0, Math.round(Number(v) || 0));

/** Normalised token counts from an API `usage` object (or our own flat shape). */
export function tokensOf(usage = {}) {
  const u = usage || {};
  const input = n(u.input_tokens ?? u.inputTokens);
  const output = n(u.output_tokens ?? u.outputTokens);
  const read = n(u.cache_read_input_tokens ?? u.cacheReadTokens);
  const created = n(u.cache_creation_input_tokens ?? u.cacheWriteTokens);
  const w1h = n(u.cache_creation?.ephemeral_1h_input_tokens ?? u.cacheWrite1hTokens);
  let w5m = n(u.cache_creation?.ephemeral_5m_input_tokens ?? u.cacheWrite5mTokens);
  // No TTL breakdown: price the whole write at the 5-minute rate, the 1h part if known.
  if (created && w1h + w5m !== created) w5m = Math.max(0, created - w1h);
  return { input, output, cacheRead: read, cacheWrite5m: w5m, cacheWrite1h: w1h, cacheWrite: w5m + w1h };
}

/**
 * Message Batches (https://platform.claude.com/docs/en/build-with-claude/batch-processing, read
 * 2026-11-02): "All batch usage is charged at 50% of standard API prices" — input, output and
 * special tokens; the discount stacks with prompt caching (cache reads / writes are halved too).
 * The page's batch table matches: Opus 5.5 $2 / $10, Sonnet 5.5 $1 / $5, Haiku 5.5 $0.05 / $0.25
 * (≤ 100k-token prompts; $0.25 / $1.25 above). Web fetch adds no charge beyond the tokens of the
 * fetched content (web-fetch-tool page, "Pricing").
 */
export const BATCH_DISCOUNT = 0.5;

/** USD for one attempt's usage on one model ({ batch: true } = Message Batches price). */
export function costUsd(model, usage = {}, { batch = false } = {}) {
  const t = tokensOf(usage);
  const r = ratesFor(model, t.input + t.cacheRead + t.cacheWrite);
  const full = (t.input * r.input + t.output * r.output + t.cacheWrite5m * r.write5m
    + t.cacheWrite1h * r.write1h + t.cacheRead * r.read) / 1_000_000;
  return batch ? full * BATCH_DISCOUNT : full;
}

/** Rates for a batch request (every category at 50 %). */
export function batchRatesFor(model, promptTokens = 0) {
  const r = ratesFor(model, promptTokens);
  return { input: r.input * BATCH_DISCOUNT, output: r.output * BATCH_DISCOUNT, write5m: r.write5m * BATCH_DISCOUNT,
    write1h: r.write1h * BATCH_DISCOUNT, read: r.read * BATCH_DISCOUNT };
}

/**
 * Refusal billing (refusals-and-fallback page, "Billing"): a refusal that arrives before any
 * output is billed only for the categories bio / frontier_llm / reasoning_extraction; cyber,
 * general_harms and null are not billed. A mid-stream refusal (output already produced) bills
 * input and the streamed output at normal rates.
 */
export const BILLED_REFUSAL_CATEGORIES = Object.freeze(['bio', 'frontier_llm', 'reasoning_extraction']);
export function refusalBilled(category, outputTokens) {
  if (n(outputTokens) > 0) return true;
  return BILLED_REFUSAL_CATEGORIES.includes(String(category || '').toLowerCase());
}

/**
 * USD for a whole Messages response (non-streamed body, or the totals a stream meter built):
 *   - with server-side fallback, usage.iterations lists every attempt; the declined attempt
 *     ('message') is billed under the refusal rule, the serving one ('fallback_message') fully.
 *     (Top-level usage covers only the serving attempt; models are never summed.)
 *   - a refused response is billed under the refusal rule.
 */
export function responseCostUsd({ model, usage, stopReason, refusalCategory, triggerCategory, batch = false } = {}) {
  const o = { batch };
  const its = Array.isArray(usage?.iterations) ? usage.iterations : null;
  if (its && its.length) {
    return its.reduce((sum, it, i) => {
      const last = i === its.length - 1;
      const declined = it.type === 'message' && (!last || stopReason === 'refusal');
      if (declined) {
        const cat = last ? refusalCategory : triggerCategory ?? refusalCategory;
        return sum + (refusalBilled(cat, it.output_tokens) ? costUsd(it.model || model, it, o) : 0);
      }
      return sum + costUsd(it.model || model, it, o);
    }, 0);
  }
  if (stopReason === 'refusal' && !refusalBilled(refusalCategory, usage?.output_tokens ?? usage?.outputTokens)) return 0;
  return costUsd(model, usage, o);
}
