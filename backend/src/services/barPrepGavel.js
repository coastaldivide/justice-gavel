/**
 * services/barPrepGavel.js — GoldenGavel Integration for Bar Prep
 *
 * Awards gavel_points and badges when users hit bar prep milestones.
 *
 * Point Schedule:
 *   +10   per question answered
 *   +50   daily goal met (first time today)
 *   +200  perfect session (100% accuracy, ≥10 Q)
 *   +500  7-day study streak achieved
 *
 * Badges (written to user_badges table when threshold first crossed):
 *   mbe_first_session   — complete first bar prep session
 *   mbe_50              — 50 questions answered
 *   mbe_scholar         — 250 questions answered
 *   mbe_perfect         — first perfect session (100%)
 *   mbe_streak_7        — 7-day streak
 */

import { getDb }    from '../db/index.js';
import logger       from '../utils/logger.js';
import { evaluateGavelLevel } from '../routes/golden_gavel.js';

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

/**
 * Award bar prep GoldenGavel points & badges after a session is submitted.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {number} params.questionsAnswered  — how many Qs in this session
 * @param {number} params.correctCount       — correct answers in this session
 * @param {number} params.totalEverAnswered  — lifetime total after this session
 * @param {number} params.streakDays         — current streak after updating
 * @param {boolean} params.dailyGoalJustMet  — true if goal was met for the first time today
 */
export async function awardBarPrepPoints({
  userId,
  questionsAnswered,
  correctCount,
  totalEverAnswered,
  streakDays,
  dailyGoalJustMet,
}) {
  if (!userId) return;

  let totalPoints = 0;
  const newBadges = [];

  try {
    const db = await getDb();

    // ── Base points: per question ────────────────────────────────────────────
    totalPoints += questionsAnswered * POINTS.per_question;

    // ── Daily goal bonus ─────────────────────────────────────────────────────
    if (dailyGoalJustMet) {
      totalPoints += POINTS.daily_goal;
    }

    // ── Perfect session bonus (100% + at least 10 Qs) ────────────────────────
    const isPerfect = questionsAnswered >= 10 && correctCount === questionsAnswered;
    if (isPerfect) {
      totalPoints += POINTS.perfect_session;
    }

    // ── 7-day streak bonus ───────────────────────────────────────────────────
    if (streakDays === 7 || streakDays % 7 === 0) {
      totalPoints += POINTS.streak_7;
    }

    // ── Apply points to users.gavel_points ───────────────────────────────────
    if (totalPoints > 0) {
      await db.run(
        `UPDATE users SET gavel_points = COALESCE(gavel_points, 0) + ? WHERE id = ?`,
        [totalPoints, userId]
      );
    }

    // ── Check & award badges ─────────────────────────────────────────────────
    const existingBadges = await db.all(
      `SELECT badge_key FROM user_badges WHERE user_id = ?`,
      [userId]
    ).catch(() => []);
    const hasBadge = new Set(existingBadges.map(b => b.badge_key));

    const toAward = [];

    // First session
    if (!hasBadge.has(BADGES.first_session.key)) {
      toAward.push(BADGES.first_session);
    }

    // 50 questions milestone
    if (!hasBadge.has(BADGES.q50.key) && totalEverAnswered >= 50) {
      toAward.push(BADGES.q50);
    }

    // 250 questions — MBE Scholar
    if (!hasBadge.has(BADGES.q250.key) && totalEverAnswered >= 250) {
      toAward.push(BADGES.q250);
    }

    // Perfect session
    if (!hasBadge.has(BADGES.perfect.key) && isPerfect) {
      toAward.push(BADGES.perfect);
    }

    // 7-day streak
    if (!hasBadge.has(BADGES.streak7.key) && streakDays >= 7) {
      toAward.push(BADGES.streak7);
    }

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

    // ── Re-evaluate GoldenGavel level after points change ────────────────────
    if (totalPoints > 0) {
      try {
        await evaluateGavelLevel(userId);
      } catch (e) {
        logger.warn('awardBarPrepPoints: evaluateGavelLevel failed', e);
      }
    }

    logger.info(`awardBarPrepPoints: user=${userId} points=${totalPoints} badges=${newBadges.map(b => b.key)}`);
    return { points_awarded: totalPoints, new_badges: newBadges };

  } catch (e) {
    logger.error('awardBarPrepPoints error', e);
    return { points_awarded: 0, new_badges: [] };
  }
}
