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
 *   rag_static       — VERIFIED_LEGAL_CONTEXT in ragRetrieval.js (constitutional law)
 *   rag_db_bail      — bail_schedules table rows
 *   rag_db_dui       — dui_laws table rows
 *   rag_db_drug      — drug_penalties table rows
 *   rag_db_sol       — statute_of_limitations table rows
 *   expungement_rule — STATE_RULES entries in expungement/rules.js
 *   bar_prep_q       — bar_prep_questions table rows
 *   rights_card      — static KYR (know your rights) content
 *   eval_question    — eval question bank (data/eval/questions.json)
 */

import logger from '../utils/logger.js';

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

/**
 * Returns the appropriate disclaimer text based on content staleness.
 */
export function stalenessDisclaimer(score, contentType = 'legal information') {
  if (score < 0.5) {
    return 'This information has been reviewed by a licensed attorney. Laws change — verify with your attorney before relying on this.';
  }
  if (score < 1.0) {
    return `⚠️ This ${contentType} is scheduled for attorney review. Laws may have changed. Verify with a licensed attorney in your state before acting on this information.`;
  }
  return `⚠️ IMPORTANT: This ${contentType} has not been reviewed by an attorney recently. Laws change frequently. Do not act on this information without consulting a licensed attorney. Use this for general orientation only.`;
}

/**
 * Check all content sources for staleness and return a report.
 * Called by the weekly freshness scan and the admin dashboard.
 */
export async function scanAllContent(db) {
  const report = { scanned_at: new Date().toISOString(), stale: [], needs_review: [], ok: [] };

  try {
    // ── RAG static context — hardcoded in ragRetrieval.js ─────────────────────
    // These are constitutional authorities that rarely change, but case law can be overruled
    const ragVersions = await db.all(
      `SELECT content_key, last_reviewed_at, reviewed_by, content_type
         FROM legal_content_versions
        WHERE content_type = 'rag_static'`
    ).catch(() => []);

    const RAG_KEYS = ['miranda','fourth_amendment','fifth_amendment','sixth_amendment','bail','gideon'];
    for (const key of RAG_KEYS) {
      const rec = ragVersions.find(r => r.content_key === key);
      const score = stalenessScore(rec?.last_reviewed_at);
      const entry = { key, type: 'rag_static', score, last_reviewed_at: rec?.last_reviewed_at, reviewed_by: rec?.reviewed_by };
      if (score >= 1.0) report.stale.push(entry);
      else if (score >= 0.5) report.needs_review.push(entry);
      else report.ok.push(entry);
    }

    // ── Database legal tables — scan for stale rows ───────────────────────────
    for (const [table, keyCol] of [
      ['bail_schedules',           'id'],
      ['dui_laws',                 'id'],
      ['drug_penalties',           'id'],
      ['statute_of_limitations',   'id'],
    ]) {
      const staleRows = await db.all(
        `SELECT ${keyCol} AS id, state,
                COALESCE(last_reviewed_at, '2020-01-01') AS last_reviewed_at
           FROM ${table}
          WHERE last_reviewed_at IS NULL
             OR last_reviewed_at < datetime('now', '-${REVIEW_THRESHOLD_DAYS} days')
          LIMIT 20`
      ).catch(() => []);
      if (staleRows.length) {
        report.needs_review.push({ type: table, count: staleRows.length, sample: staleRows.slice(0,3) });
      }
    }

    // ── Expungement rules — check by state ────────────────────────────────────
    const expVersions = await db.all(
      `SELECT content_key, last_reviewed_at, reviewed_by
         FROM legal_content_versions
        WHERE content_type = 'expungement_rule'`
    ).catch(() => []);

    const STATES_WITH_RULES = ['TN','TX','FL','CA','NY','GA','NC','OH','MI','IL'];
    for (const state of STATES_WITH_RULES) {
      const rec   = expVersions.find(r => r.content_key === state);
      const score = stalenessScore(rec?.last_reviewed_at);
      if (score >= 0.5) {
        (score >= 1.0 ? report.stale : report.needs_review).push({
          key: state, type: 'expungement_rule', score,
          last_reviewed_at: rec?.last_reviewed_at
        });
      }
    }

    // ── Bar prep questions — check oldest unreviewed ───────────────────────────
    const oldestBP = await db.get(
      `SELECT MIN(source_date) AS oldest, COUNT(*) AS unreviewed
         FROM bar_prep_questions
        WHERE reviewed_by IS NULL OR source_date < datetime('now', '-${REVIEW_THRESHOLD_DAYS} days')`
    ).catch(() => null);
    if (oldestBP?.unreviewed > 0) {
      report.needs_review.push({ type: 'bar_prep_questions', unreviewed: oldestBP.unreviewed, oldest: oldestBP.oldest });
    }

  } catch (e) {
    logger.warn('[contentStaleness] scan error:', e?.message);
  }

  report.summary = {
    stale_count:       report.stale.length,
    needs_review_count:report.needs_review.length,
    ok_count:          report.ok.length,
    action_required:   report.stale.length + report.needs_review.length > 0,
  };

  return report;
}

/**
 * Record that an attorney has reviewed a piece of content.
 * Called via the admin panel when an attorney signs off.
 */
export async function recordAttorneyReview(db, { contentType, contentKey, attorneyName, barNumber, notes }) {
  await db.run(
    `INSERT INTO legal_content_versions
       (content_type, content_key, last_reviewed_at, reviewed_by, bar_number, notes)
     VALUES (?, ?, NOW(), ?, ?, ?)
     ON CONFLICT(content_type, content_key) DO UPDATE SET
       last_reviewed_at = NOW(),
       reviewed_by      = excluded.reviewed_by,
       bar_number       = excluded.bar_number,
       notes            = excluded.notes,
       review_count     = review_count + 1`,
    [contentType, contentKey, attorneyName, barNumber, notes || null]
  );
  logger.info({ msg: '[contentStaleness] attorney review recorded', contentType, contentKey, attorneyName });
}
