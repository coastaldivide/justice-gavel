/**
 * services/contentStaleness.js — Legal content freshness tracking
 *
 * PROBLEM:
 *   Legal information decays. A bail schedule accurate in 2023 may be wrong in 2025.
 *   An expungement rule that was clear last year may have changed with new legislation.
 *   We have no way to know which of our static legal content is stale.
 *
 * SOLUTION:
 *   Every piece of legal content that gets served to users has a review record.
 *   Content not reviewed by a licensed attorney in REVIEW_THRESHOLD_DAYS gets:
 *     1. A staleness flag on every response that uses it
 *     2. An increased disclaimer prominence in the UI
 *     3. An alert to the admin dashboard
 *     4. Automatic suppression after SUPPRESS_THRESHOLD_DAYS (optional)
 *
 * CONTENT TYPES:
 *   rag_static       — constitutional-law reference texts (legal_content_versions rows)
 *   rag_db_bail      — bail_schedules table rows
 *   rag_db_dui       — dui_laws table rows
 *   rag_db_drug      — drug_penalties table rows
 *   rag_db_sol       — statute_of_limitations table rows
 *   expungement_rule — STATE_RULES entries in expungement/rules.js
 *   bar_prep_q       — bar_prep_questions table rows
 *   rights_card      — static KYR (know your rights) content
 *   eval_question    — eval question bank (data/eval/questions.json)
 */


// ── Staleness thresholds ──────────────────────────────────────────────────────
export const REVIEW_THRESHOLD_DAYS   = 180;  // Flag for review after 6 months
export const SUPPRESS_THRESHOLD_DAYS = 365;  // Suppress or prominent-warn after 1 year

/**
 * Returns a staleness score (0.0–1.0) based on days since last attorney review.
 *   0.0  = reviewed today — fully trusted
 *   0.5  = at the 180-day threshold — flag for review
 *   1.0  = at or past the 365-day suppress threshold
 */
export function stalenessScore(lastReviewedAt) {
  if (!lastReviewedAt) return 1.0; // Never reviewed = maximum staleness
  const daysSince = (Date.now() - new Date(lastReviewedAt).getTime()) / 86_400_000;
  return Math.min(1.0, daysSince / SUPPRESS_THRESHOLD_DAYS);
}



