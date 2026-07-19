/**
 * services/barPrepGavel.js — GoldenGavel Integration for Bar Prep
 *
 * Awards gavel_points and badges when users hit bar prep milestones.
 *
 * Point Schedule:
 *   +10   per question answered
 *   +50   daily goal met (first time today)
 *   +200  perfect session (100% accuracy, ≥10 Q)
 *   +500  7-day study streak (and every 7 days thereafter)
 *
 * Badges (written to user_badges when threshold first crossed):
 *   mbe_first_session — first bar prep session completed
 *   mbe_50            — 50 questions answered
 *   mbe_scholar       — 250 questions answered
 *   mbe_perfect       — first perfect session (100%)
 *   mbe_streak_7      — 7-day streak achieved
 */

import { getDb }  from '../db/index.js';
import logger     from '../utils/logger.js';

// FIX #8: evaluateGavelLevel belongs in a service, not imported from a route.
// Import dynamically to avoid the service→route circular dependency.
async function safeEvaluateGavelLevel(userId) {
  try {
    const { evaluateGavelLevel } = await import('../routes/golden_gavel.js');
    await evaluateGavelLevel(userId);
  } catch (e) {
    logger.warn('awardBarPrepPoints: evaluateGavelLevel failed', e);
  }
}

const POINTS = {
  per_question:    10,
  daily_goal:      50,
  perfect_session: 200,
  streak_7:        500,
};

const BADGES = {
  first_session: { key: 'mbe_first_session', label: 'First Session',  emoji: '🎓' },
  q50:           { key: 'mbe_50',            label: '50 Questions',   emoji: '📚' },
  q250:          { key: 'mbe_scholar',       label: 'MBE Scholar',   emoji: '⚖️'  },
  perfect:       { key: 'mbe_perfect',       label: 'Perfect Score',  emoji: '💯' },
  streak7:       { key: 'mbe_streak_7',      label: '7-Day Streak',  emoji: '🔥' },
};

// Consistent return shape — always returned, never undefined.
const EMPTY_RESULT = { points_awarded: 0, new_badges: [] };

/**
 * Award bar prep GoldenGavel points & badges after a session is submitted.
 *
 * @param {object} params
 * @param {string}  params.userId
 * @param {number}  params.questionsAnswered  — Qs in this session
 * @param {number}  params.correctCount       — correct answers in this session
 * @param {number}  params.totalEverAnswered  — lifetime total after this session
 * @param {number}  params.streakDays         — current streak after updating
 * @param {boolean} params.dailyGoalJustMet   — true if goal was met for the first time today
 * @returns {{ points_awarded: number, new_badges: object[] }}
 */
export async function awardBarPrepPoints({
  userId,
  questionsAnswered,
  correctCount,
  totalEverAnswered,
  streakDays,
  dailyGoalJustMet,
}) {
  // FIX #6: return consistent shape instead of undefined
  if (!userId) return EMPTY_RESULT;

  try {
    const db = await getDb();

    // ── Point calculation ────────────────────────────────────────────────────
    let totalPoints = questionsAnswered * POINTS.per_question;

    if (dailyGoalJustMet) totalPoints += POINTS.daily_goal;

    const isPerfect = questionsAnswered >= 10 && correctCount === questionsAnswered;
    if (isPerfect) totalPoints += POINTS.perfect_session;

    // FIX #7: streakDays=0 previously triggered via 0%7===0; guard with > 0
    if (streakDays > 0 && streakDays % 7 === 0) totalPoints += POINTS.streak_7;

    if (totalPoints > 0) {
      await db.run(
        `UPDATE users SET gavel_points = COALESCE(gavel_points, 0) + ? WHERE id = ?`,
        [totalPoints, userId]
      );
    }

    // ── Badge awarding ───────────────────────────────────────────────────────
    const existing = await db.all(
      `SELECT badge_key FROM user_badges WHERE user_id = ?`, [userId]
    ).catch(() => []);
    const hasBadge = new Set(existing.map(b => b.badge_key));

    const toAward = [
      !hasBadge.has(BADGES.first_session.key)                                 && BADGES.first_session,
      !hasBadge.has(BADGES.q50.key)    && totalEverAnswered >= 50             && BADGES.q50,
      !hasBadge.has(BADGES.q250.key)   && totalEverAnswered >= 250            && BADGES.q250,
      !hasBadge.has(BADGES.perfect.key) && isPerfect                          && BADGES.perfect,
      !hasBadge.has(BADGES.streak7.key) && streakDays >= 7                   && BADGES.streak7,
    ].filter(Boolean);

    const newBadges = [];
    for (const badge of toAward) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO user_badges (user_id, badge_key, label, emoji, awarded_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [userId, badge.key, badge.label, badge.emoji]
        );
        newBadges.push(badge);
      } catch (e) {
        logger.warn(`awardBarPrepPoints: badge insert failed for ${badge.key}`, e);
      }
    }

    if (totalPoints > 0) await safeEvaluateGavelLevel(userId);

    logger.info(`awardBarPrepPoints: user=${userId} points=${totalPoints} badges=[${newBadges.map(b => b.key)}]`);
    return { points_awarded: totalPoints, new_badges: newBadges };

  } catch (e) {
    logger.error('awardBarPrepPoints error', e);
    return EMPTY_RESULT;
  }
}
