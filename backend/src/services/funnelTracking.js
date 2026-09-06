/**
 * services/funnelTracking.js — Investor-grade funnel instrumentation
 *
 * Tracks the conversion funnel that every VC wants to see:
 *   Install → Registration → Activation → First AI Message →
 *   Lawyer View → Consultation Booked → Paid Subscription
 *
 * This data feeds the KPI dashboard and investor data room.
 * Events are stored in funnel_events table and queryable as weekly cohorts.
 *
 * Usage: import { trackFunnel } from '../services/funnelTracking.js';
 *        await trackFunnel(db, userId, 'first_ai_message', { caseType });
 */

import logger from '../utils/logger.js';

// ── Funnel stages in order ────────────────────────────────────────────────────
export const FUNNEL_STAGES = [
  'registered',            // User created an account
  'case_created',          // Created first case (activation event)
  'first_ai_message',      // Sent first AI chat message (the core value moment)
  'lawyer_viewed',         // Opened a lawyer profile
  'consultation_booked',   // Booked a paid consultation (first revenue signal)
  'subscription_started',  // Started a paid subscription
  'attorney_messaged',     // Exchanged a message with an attorney
];

// ── Stage weights for "activation score" ─────────────────────────────────────
// Used to show investors which step is the biggest drop-off
export const STAGE_WEIGHTS = {
  registered:           1,
  case_created:         2,
  first_ai_message:     3,  // ← This is the "aha moment"
  lawyer_viewed:        4,
  consultation_booked:  8,  // ← First revenue
  subscription_started: 10,
  attorney_messaged:    6,
};

/**
 * Track a funnel event for a user.
 * Safe to call multiple times — idempotent on (user_id, stage) per day.
 */
export async function trackFunnel(db, userId, stage, metadata = {}) {
  if (!userId || !stage) return;
  if (!FUNNEL_STAGES.includes(stage)) {
    logger.warn('[funnel] Unknown stage:', stage);
    return;
  }

  try {
    await db.run(
      `INSERT OR IGNORE INTO funnel_events
         (user_id, stage, metadata, occurred_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [userId, stage, JSON.stringify(metadata)]
    );
  } catch (e) {
    // Non-fatal — never interrupt user flow for analytics
    logger.warn('[funnel] failed to track:', stage, e?.message);
  }
}

/**
 * Get cohort conversion rates for investor reporting.
 * Returns weekly cohorts with conversion % at each stage.
 */
export async function getFunnelCohorts(db, weekCount = 8) {
  try {
    const cohorts = await db.all(
      `SELECT
         strftime('%Y-W%W', u.created_at) AS cohort_week,
         COUNT(DISTINCT u.id)             AS registered,
         COUNT(DISTINCT CASE WHEN fe_case.user_id IS NOT NULL THEN u.id END) AS activated,
         COUNT(DISTINCT CASE WHEN fe_ai.user_id   IS NOT NULL THEN u.id END) AS first_ai,
         COUNT(DISTINCT CASE WHEN fe_lv.user_id   IS NOT NULL THEN u.id END) AS lawyer_viewed,
         COUNT(DISTINCT CASE WHEN fe_cb.user_id   IS NOT NULL THEN u.id END) AS booked,
         COUNT(DISTINCT CASE WHEN fe_sub.user_id  IS NOT NULL THEN u.id END) AS subscribed
       FROM users u
       LEFT JOIN funnel_events fe_case ON fe_case.user_id = u.id AND fe_case.stage = 'case_created'
       LEFT JOIN funnel_events fe_ai   ON fe_ai.user_id   = u.id AND fe_ai.stage   = 'first_ai_message'
       LEFT JOIN funnel_events fe_lv   ON fe_lv.user_id   = u.id AND fe_lv.stage   = 'lawyer_viewed'
       LEFT JOIN funnel_events fe_cb   ON fe_cb.user_id   = u.id AND fe_cb.stage   = 'consultation_booked'
       LEFT JOIN funnel_events fe_sub  ON fe_sub.user_id  = u.id AND fe_sub.stage   = 'subscription_started'
       WHERE u.created_at >= datetime('now', '-' || ? || ' days')
         AND u.role = 'user'
       GROUP BY cohort_week
       ORDER BY cohort_week DESC`,
      [weekCount * 7]
    );

    return cohorts.map(c => ({
      ...c,
      activation_rate:   c.registered > 0 ? (c.activated   / c.registered * 100).toFixed(1) + '%' : '0%',
      ai_rate:           c.registered > 0 ? (c.first_ai    / c.registered * 100).toFixed(1) + '%' : '0%',
      booking_rate:      c.registered > 0 ? (c.booked      / c.registered * 100).toFixed(1) + '%' : '0%',
      conversion_rate:   c.registered > 0 ? (c.subscribed  / c.registered * 100).toFixed(1) + '%' : '0%',
    }));
  } catch (e) {
    logger.warn('[funnel] cohort query failed:', e?.message);
    return [];
  }
}
