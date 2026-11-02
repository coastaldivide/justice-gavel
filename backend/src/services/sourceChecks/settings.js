/**
 * sourceChecks/settings.js — the re-check job's settings (env, read on every call) — kept apart
 * so the job-health monitor can read them without loading the datasets.
 *   SOURCE_CHECK_ENABLED            off = no weekly run (admin "run now" still works with a key)
 *   SOURCE_CHECK_MAX_ROWS           rows per run (default 100)
 *   SOURCE_CHECK_SKIP_DAYS          skip rows attempted in the last N days (default 30)
 *   SOURCE_CHECK_MAX_FETCHES        web fetches per re-check (max_uses, default 2)
 *   SOURCE_CHECK_PROPOSAL_FETCHES   web fetches per proposal (default 4)
 *   SOURCE_CHECK_MAX_CONTENT_TOKENS max_content_tokens per fetched page (default 20,000)
 */
import { batchesEnabled } from '../aiBatch.js';

const str = (v) => String(v ?? '').trim();
const num = (v, d) => { const n = Number(str(v)); return str(v) !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : d; };

export function sourceCheckSettings() {
  return {
    enabled: str(process.env.SOURCE_CHECK_ENABLED).toLowerCase() !== 'off',
    maxRows: num(process.env.SOURCE_CHECK_MAX_ROWS, 100),
    skipDays: num(process.env.SOURCE_CHECK_SKIP_DAYS, 30),
    maxFetches: num(process.env.SOURCE_CHECK_MAX_FETCHES, 2),
    proposalFetches: num(process.env.SOURCE_CHECK_PROPOSAL_FETCHES, 4),
    maxContentTokens: num(process.env.SOURCE_CHECK_MAX_CONTENT_TOKENS, 20000),
  };
}
/** The weekly job runs only with an API key, batches on and SOURCE_CHECK_ENABLED not off. */
export const sourceChecksEnabled = () => batchesEnabled() && sourceCheckSettings().enabled;
