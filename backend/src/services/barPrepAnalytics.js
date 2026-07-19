/**
 * services/barPrepAnalytics.js — Performance analytics backbone
 * [I-05]
 */

import { db }    from '../db/index.js';
import { cache } from '../utils/redis.js';
import { predictRetention, calcDailyGoal } from '../utils/sm2.js';

const ANALYTICS_TTL = 300; // 5 min cache on analytics

/**
 * Full performance dashboard for a user.
 */
export async function getUserDashboard(userId) {
  return cache(`bar:dashboard:${userId}`, ANALYTICS_TTL, async () => {
    const [subjectPerf, weakAreas, streak, recentSessions, peerPct] = await Promise.all([
      // Per-subject accuracy
      db.all(`SELECT * FROM user_bar_performance WHERE user_id = ?`, [userId]),

      // Weak categories (< 60% accuracy, min 3 attempts)
      db.all(`SELECT * FROM subject_accuracy_breakdown
              WHERE user_id = ? AND mastery_level = 'weak'
              ORDER BY accuracy_pct ASC LIMIT 5`, [userId]),

      // Streak info
      db.get(`SELECT * FROM study_streaks WHERE user_id = ?`, [userId]),

      // Recent session scores
      db.all(`SELECT score_pct, session_type, total_questions, correct_count,
                     time_spent_secs, completed_at
              FROM quiz_sessions
              WHERE user_id = ? AND status = 'completed'
              ORDER BY completed_at DESC LIMIT 7`, [userId]),

      // Percentile ranking (anonymous)
      db.get(`
        WITH user_score AS (
          SELECT SUM(is_correct::int)::float / NULLIF(COUNT(*), 0) * 100 AS pct
          FROM quiz_answers WHERE user_id = ?
        ),
        all_scores AS (
          SELECT user_id,
                 SUM(is_correct::int)::float / NULLIF(COUNT(*), 0) * 100 AS pct
          FROM quiz_answers
          WHERE answered_at > NOW() - INTERVAL '30 days'
          GROUP BY user_id
          HAVING COUNT(*) >= 20
        )
        SELECT ROUND(
          100.0 * (SELECT COUNT(*) FROM all_scores WHERE pct < (SELECT pct FROM user_score)) /
          NULLIF((SELECT COUNT(*) FROM all_scores), 0)
        ) AS percentile
      `, [userId]),
    ]);

    // Predicted pass probability (simple logistic heuristic)
    const overallAcc = subjectPerf.length
      ? subjectPerf.reduce((s, r) => s + (r.accuracy_pct ?? 0), 0) / subjectPerf.length
      : 0;
    const totalQs = subjectPerf.reduce((s, r) => s + (r.total_answered ?? 0), 0);
    const passProbability = calcPassProbability(overallAcc, totalQs);

    return {
      subjects:         subjectPerf,
      weak_areas:       weakAreas,
      streak:           streak ?? { current_streak: 0, longest_streak: 0 },
      recent_sessions:  recentSessions,
      peer_percentile:  peerPct?.percentile ?? null,
      overall_accuracy: Math.round(overallAcc * 10) / 10,
      total_answered:   totalQs,
      pass_probability: passProbability,
      retention_level:  predictRetention(overallAcc),
    };
  });
}

/**
 * Simple logistic heuristic for pass probability.
 * Based on: MBE pass score ≈ 131/200 = 65.5%. Scaled by questions done.
 */
function calcPassProbability(accuracyPct, questionsAnswered) {
  if (questionsAnswered < 20) return null; // not enough data
  // Volume bonus: more practice = better calibration
  const volumeBonus = Math.min(10, Math.floor(questionsAnswered / 20));
  const base = accuracyPct + volumeBonus;
  // Map to 0-100% probability
  const prob = Math.max(0, Math.min(100, Math.round((base - 45) * 2.2)));
  return prob;
}

/**
 * Today's study schedule — how many questions left, which subjects.
 */
export async function getStudySchedule(userId) {
  const [streak, todayProgress] = await Promise.all([
    db.get(`SELECT * FROM study_streaks WHERE user_id = ?`, [userId]),
    db.get(`SELECT * FROM bar_prep_progress WHERE user_id = ? AND study_date = CURRENT_DATE`, [userId]),
  ]);

  const examDate  = streak?.exam_date ? new Date(streak.exam_date) : null;
  const daysLeft  = examDate ? Math.ceil((examDate - Date.now()) / 86400000) : null;
  const dailyGoal = streak?.daily_goal ?? 20;

  const done    = todayProgress?.questions_done ?? 0;
  const correct = todayProgress?.questions_correct ?? 0;
  const remaining = Math.max(0, dailyGoal - done);

  // Which subjects need most work?
  const weakSubjects = await db.all(`
    SELECT subject_code, accuracy_pct FROM subject_accuracy_breakdown
    WHERE user_id = ? ORDER BY accuracy_pct ASC LIMIT 2
  `, [userId]);

  return {
    daily_goal:    dailyGoal,
    done_today:    done,
    correct_today: correct,
    remaining:     remaining,
    goal_met:      done >= dailyGoal,
    days_until_exam:    daysLeft,
    priority_subjects:  weakSubjects.map(s => s.subject_code),
    exam_date:          streak?.exam_date ?? null,
    suggested_session:  remaining > 0 ? {
      type:     'practice',
      count:    Math.min(remaining, 20),
      subjects: weakSubjects.length ? weakSubjects.map(s => s.subject_code) : null,
    } : null,
  };
}

/**
 * Update daily progress after answering questions.
 * Called after each quiz_answers batch insert.
 */
export async function updateDailyProgress(userId, questionsAnswered, questionsCorrect, timeSpentSecs, subjects) {
  const pts = (questionsAnswered * 10);

  await db.run(`
    INSERT INTO bar_prep_progress
      (user_id, study_date, questions_done, questions_correct, time_spent_secs, subjects_covered, golden_gavel_pts)
    VALUES (?, CURRENT_DATE, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, study_date) DO UPDATE SET
      questions_done    = bar_prep_progress.questions_done    + EXCLUDED.questions_done,
      questions_correct = bar_prep_progress.questions_correct + EXCLUDED.questions_correct,
      time_spent_secs   = bar_prep_progress.time_spent_secs   + EXCLUDED.time_spent_secs,
      golden_gavel_pts  = bar_prep_progress.golden_gavel_pts  + EXCLUDED.golden_gavel_pts
  `, [userId, questionsAnswered, questionsCorrect, timeSpentSecs, subjects, pts]);

  // Update streak
  await db.run(`
    INSERT INTO study_streaks (user_id, current_streak, longest_streak, last_study_date, total_questions, total_correct)
    VALUES (?, 1, 1, CURRENT_DATE, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak  = CASE
        WHEN study_streaks.last_study_date = CURRENT_DATE - 1 THEN study_streaks.current_streak + 1
        WHEN study_streaks.last_study_date = CURRENT_DATE      THEN study_streaks.current_streak
        ELSE 1
      END,
      longest_streak  = GREATEST(study_streaks.longest_streak,
        CASE WHEN study_streaks.last_study_date = CURRENT_DATE - 1
             THEN study_streaks.current_streak + 1
             ELSE study_streaks.current_streak END),
      last_study_date = CURRENT_DATE,
      total_questions = study_streaks.total_questions + EXCLUDED.total_questions,
      total_correct   = study_streaks.total_correct   + EXCLUDED.total_correct,
      updated_at      = NOW()
  `, [userId, questionsAnswered, questionsCorrect]);
}
