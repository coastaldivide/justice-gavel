/**
 * utils/ai.js — single source of truth for Anthropic configuration.
 *
 *   CLAUDE_MODEL            env CLAUDE_MODEL, default 'claude-sonnet-4-6'
 *   ANTHROPIC_BASE_URL      env ANTHROPIC_BASE_URL, default https://api.anthropic.com
 *                           (also honoured by @anthropic-ai/sdk automatically)
 *   ANTHROPIC_MESSAGES_URL  `${ANTHROPIC_BASE_URL}/v1/messages`
 */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
export const ANTHROPIC_BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
export const ANTHROPIC_MESSAGES_URL = `${ANTHROPIC_BASE_URL}/v1/messages`;
export const ANTHROPIC_VERSION = '2023-06-01';

/** True when an Anthropic API key is configured. */
export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Standard 503 body for AI features when no key is configured. */
export const AI_UNAVAILABLE = Object.freeze({
  error:   'ai_unavailable',
  message: 'AI features are not available right now (AI provider not configured).',
});

/** Send the standard 503 response. Returns the response for `return` chaining. */
export function sendAiUnavailable(res) {
  return res.status(503).json({ ...AI_UNAVAILABLE });
}

/**
 * Express middleware: short-circuits with 503 ai_unavailable when no API key.
 * Mount AFTER auth/disclaimer so those still apply.
 */
export async function requireAi(req, res, next) {
  if (!aiConfigured()) return sendAiUnavailable(res);
  // Global daily spend cap (services/aiBudget.js): refuse before any work.
  try {
    const { budgetStatus, AI_BUDGET_BODY } = await import('../services/aiBudget.js');
    if ((await budgetStatus()).exhausted) return res.status(503).json({ ...AI_BUDGET_BODY });
  } catch { /* accounting unavailable — the per-call check in aiClient still applies */ }
  next();
}
