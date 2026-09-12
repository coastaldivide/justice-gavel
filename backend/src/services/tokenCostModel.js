/**
 * services/tokenCostModel.js — Claude API cost tracking per user
 *
 * WHY THIS EXISTS:
 * The free tier gives 15 AI conversations with no cost ceiling per user.
 * Claude Sonnet 4 pricing: ~$3/M input tokens, $15/M output tokens.
 * Average legal Q&A: 500 tokens in + 800 tokens out = ~$0.0135/message.
 * 15 free messages = ~$0.20 per free user in API costs.
 * At 1,000 free users with 0% conversion: $200/mo burned before first dollar.
 *
 * This module tracks actual token usage so we can:
 *   1. Verify the $0.20 estimate against reality
 *   2. Set a hard dollar ceiling per free user per month
 *   3. Report unit economics to investors accurately
 *   4. Upgrade tiers that are unprofitable at current usage patterns
 */

import logger from '../utils/logger.js';

// ── Pricing constants (Claude claude-sonnet-4-6 as of 2026) ─────────────────────────
const CLAUDE_INPUT_COST_PER_TOKEN  = 3.00  / 1_000_000;  // $3/M input tokens
const CLAUDE_OUTPUT_COST_PER_TOKEN = 15.00 / 1_000_000;  // $15/M output tokens

// ── Per-tier cost ceilings ────────────────────────────────────────────────────────────
export const TIER_COST_CEILINGS = {
  free:       0.25,   // $0.25/mo — ~18 messages; hard cut after
  legal_radar: 2.00,  // $2.00/mo — comfortable margin at $19.99/mo
  advisor:     4.00,  // $4.00/mo — comfortable margin at $24.99/mo
  legal_pro:   8.00,  // $8.00/mo — comfortable margin at $34.99/mo
  esquire:    15.00,  // $15.00/mo — ~80% margin at $49.00/mo
};

/**
 * Calculate the dollar cost of a Claude API call.
 * Call this after every AI response and log it.
 */
export function calcTokenCost({ inputTokens = 0, outputTokens = 0 }) {
  const cost =
    (inputTokens  * CLAUDE_INPUT_COST_PER_TOKEN) +
    (outputTokens * CLAUDE_OUTPUT_COST_PER_TOKEN);
  return parseFloat(cost.toFixed(6));
}

/**
 * Check if a user has exceeded their monthly cost ceiling.
 * Returns true if they should be rate-limited.
 */
export async function isOverCostCeiling(db, userId, tier = 'free') {
  try {
    const ceiling = TIER_COST_CEILINGS[tier] ?? TIER_COST_CEILINGS.free;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const usage = await db.get(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
         FROM ai_token_usage
        WHERE user_id = ?
          AND created_at >= ?`,
      [userId, monthStart.toISOString()]
    ).catch(() => ({ total_cost: 0 }));

    const totalCost = parseFloat(usage?.total_cost ?? 0);
    const overCeiling = totalCost >= ceiling;

    if (overCeiling) {
      logger.info({
        msg: '[tokenCost] user over ceiling',
        userId, tier, totalCost, ceiling,
      });
    }

    return overCeiling;
  } catch {
    return false; // Fail open — don't break AI if tracking fails
  }
}

/**
 * Log token usage after an AI call.
 * Non-fatal — never breaks the AI response flow.
 */
export async function logTokenUsage(db, {
  userId, tier, model, inputTokens, outputTokens, cost, endpoint,
}) {
  try {
    await db.run(
      `INSERT INTO ai_token_usage
         (user_id, tier, model, input_tokens, output_tokens, cost_usd, endpoint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [userId, tier, model, inputTokens, outputTokens, cost, endpoint]
    );
  } catch (e) {
    logger.warn('[tokenCost] failed to log usage:', e?.message);
  }
}
