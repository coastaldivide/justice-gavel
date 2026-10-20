/**
 * services/barPrepAnalytics.js — Performance analytics backbone
 * [I-05]
 */

import { logIgnored } from '../utils/ignored.js';
import { db }    from '../db/index.js';
import { cache } from '../utils/redis.js';
import { predictRetention } from '../utils/sm2.js';
import { addDays, daysBetween } from '../utils/timezone.js';

const ANALYTICS_TTL = 300; // 5 min cache on analytics

/**
 * Full performance dashboard for a user.
 */
export async function getUserDashboard(userId) {
  return await cache(`bar:dashboard:${userId}`, ANALYTICS_TTL, async () => {
    const [subjectPerf, weakAreas, streak, recentSessions, peerPct, due, categories, days] = await Promise.all([
      // Per-subject accuracy
      db.all(`SELECT * FROM user_bar_performance WHERE user_id = ?`, [userId]),

      // Weak categories (< 60% accuracy, min 3 attempts)
      db.all(`SELECT * FROM subject_accuracy_breakdown
              WHERE user_id = ? AND mastery_level = 'weak'
              ORDER BY accuracy_pct ASC LIMIT 5`, [userId]),

      // Streak info
      db.get(`SELECT * FROM study_streaks WHERE user_id = ?`, [userId]),

      // Recent session scores
      db.all(`SELECT id, COALESCE(mode, session_type) AS mode, started_at, completed_at,
                     total_questions, correct_count, total_answered, score_pct::float AS score_pct, time_spent_secs
              FROM quiz_sessions
              WHERE user_id = ? AND status = 'completed'
              ORDER BY completed_at DESC LIMIT 8`, [userId]),

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
      // Reviews due now (spaced repetition)
      db.get(`SELECT COUNT(*)::int AS n FROM spaced_repetition_state WHERE user_id = ? AND next_review_at <= NOW()`, [userId]),
      // Accuracy per category (all of them, weakest first)
      db.all(`SELECT category, correct, answered AS total, accuracy_pct FROM subject_accuracy_breakdown
              WHERE user_id = ? ORDER BY accuracy_pct ASC, category ASC`, [userId]),
      // Days with practice in the last 30 (the person's calendar days, see updateDailyProgress)
      db.all(`SELECT study_date::text AS day FROM bar_prep_progress
              WHERE user_id = ? AND questions_done > 0 AND study_date >= CURRENT_DATE - 31`, [userId]),
    ]);

    // Overall accuracy across subjects
    const overallAcc = subjectPerf.length
      ? subjectPerf.reduce((s, r) => s + (r.accuracy_pct ?? 0), 0) / subjectPerf.length
      : 0;
    const totalQs = subjectPerf.reduce((s, r) => s + (r.total_answered ?? 0), 0);

    return {
      subjects:         subjectPerf,
      weak_areas:       weakAreas,
      streak:           streak ?? { current_streak: 0, longest_streak: 0 },
      streak_days:      Number(streak?.current_streak ?? 0),
      correct_total:    Number(streak?.total_correct ?? 0),
      category_stats:   categories.map(c => ({ category: c.category, correct: Number(c.correct), total: Number(c.total), accuracy_pct: Number(c.accuracy_pct) })),
      streak_calendar:  days.map(d => d.day),
      questions_due:    Number(due?.n ?? 0),
      recent_sessions:  recentSessions,
      peer_percentile:  peerPct?.percentile ?? null,
      overall_accuracy: Math.round(overallAcc * 10) / 10,
      total_answered:   totalQs,
      retention_level:  predictRetention(overallAcc),
    };
  });
}

// No "pass probability": there is no validated model behind one, so none is shown.

/**
 * Study schedule for the person's calendar day (`today` = 'YYYY-MM-DD' in their
 * zone `tz`), in the shape BarPrepScheduleScreen reads:
 *   { exam_date, days_until_exam, daily_goal, completed_today, due_today,
 *     total_overdue, estimated_study_mins, recommended_categories, calendar[14] }
 * Reviews come from spaced_repetition_state.next_review_at, counted per local day.
 */
export async function getStudySchedule(userId, { today, tz }) {
  const [streak, todayProgress] = await Promise.all([
    db.get(`SELECT exam_date::text AS exam_date, daily_goal FROM study_streaks WHERE user_id = ?`, [userId]),
    db.get(`SELECT questions_done FROM bar_prep_progress WHERE user_id = ? AND study_date = ?::date`, [userId, today]),
  ]);
  const examDate  = streak?.exam_date ? String(streak.exam_date).slice(0, 10) : null;
  const dailyGoal = Number(streak?.daily_goal ?? 20);
  const done      = Number(todayProgress?.questions_done ?? 0);
  const last      = addDays(today, 13);

  const [dueRows, goalRows, weak] = await Promise.all([
    // Due reviews per local day (overdue ones are counted on today).
    db.all(`
      SELECT GREATEST((next_review_at AT TIME ZONE ?)::date, ?::date)::text AS day, COUNT(*)::int AS n
        FROM spaced_repetition_state
       WHERE user_id = ? AND (next_review_at AT TIME ZONE ?)::date <= ?::date
       GROUP BY 1`, [tz, today, userId, tz, last]),
    db.all(`SELECT study_date::text AS day, daily_goal_met FROM bar_prep_progress
             WHERE user_id = ? AND study_date BETWEEN ?::date AND ?::date`, [userId, today, last]),
    db.all(`SELECT category, accuracy_pct FROM subject_accuracy_breakdown
             WHERE user_id = ? AND answered >= 3 ORDER BY accuracy_pct ASC, category ASC LIMIT 3`, [userId]),
  ]);
  const overdue = await db.get(`
    SELECT COUNT(*)::int AS n FROM spaced_repetition_state
     WHERE user_id = ? AND (next_review_at AT TIME ZONE ?)::date < ?::date`, [userId, tz, today]);
  const due = Object.fromEntries(dueRows.map(r => [r.day, Number(r.n)]));
  const met = Object.fromEntries(goalRows.map(r => [r.day, !!r.daily_goal_met]));
  const remaining = Math.max(0, dailyGoal - done);
  return {
    exam_date:              examDate,
    days_until_exam:        examDate ? daysBetween(today, examDate) : null,
    daily_goal:             dailyGoal,
    completed_today:        done,
    due_today:              due[today] || 0,
    total_overdue:          Number(overdue?.n || 0),
    estimated_study_mins:   Math.ceil(remaining * 1.5),   // 90 s per question, as in timed mode
    recommended_categories: weak.map(w => w.category),
    calendar: Array.from({ length: 14 }, (_, i) => {
      const day = addDays(today, i);
      return { date: day, due_count: due[day] || 0, is_today: i === 0, goal_met: !!met[day] };
    }),
  };
}

/**
 * Update daily progress after answering questions.
 * Called after each quiz_answers batch insert.
 */
export async function updateDailyProgress(userId, questionsAnswered, questionsCorrect, timeSpentSecs, subjects, today) {
  // `today`: the person's calendar day ('YYYY-MM-DD'); the server's UTC day only as a fallback.
  const day = today || new Date().toISOString().slice(0, 10);
  const pts = (questionsAnswered * 10);

  await db.run(`
    INSERT INTO bar_prep_progress
      (user_id, study_date, questions_done, questions_correct, time_spent_secs, subjects_covered, golden_gavel_pts)
    VALUES (?, ?::date, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, study_date) DO UPDATE SET
      questions_done    = bar_prep_progress.questions_done    + EXCLUDED.questions_done,
      questions_correct = bar_prep_progress.questions_correct + EXCLUDED.questions_correct,
      time_spent_secs   = bar_prep_progress.time_spent_secs   + EXCLUDED.time_spent_secs,
      golden_gavel_pts  = bar_prep_progress.golden_gavel_pts  + EXCLUDED.golden_gavel_pts
  `, [userId, day, questionsAnswered, questionsCorrect, timeSpentSecs, subjects, pts]);

  // Update streak + lifetime totals
  await db.run(`
    INSERT INTO study_streaks (user_id, current_streak, longest_streak, last_study_date, total_questions, total_correct)
    VALUES (?, 1, 1, ?::date, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak  = CASE
        WHEN study_streaks.last_study_date = EXCLUDED.last_study_date - 1 THEN study_streaks.current_streak + 1
        WHEN study_streaks.last_study_date = EXCLUDED.last_study_date     THEN study_streaks.current_streak
        ELSE 1
      END,
      longest_streak  = GREATEST(study_streaks.longest_streak,
        CASE WHEN study_streaks.last_study_date = EXCLUDED.last_study_date - 1
             THEN study_streaks.current_streak + 1
             ELSE study_streaks.current_streak END, 1),
      last_study_date = EXCLUDED.last_study_date,
      total_questions = study_streaks.total_questions + EXCLUDED.total_questions,
      total_correct   = study_streaks.total_correct   + EXCLUDED.total_correct,
      updated_at      = NOW()
  `, [userId, day, questionsAnswered, questionsCorrect]);

  // Determine whether daily goal was just met for the first time today
  const daily_goal_row = await db.get(
    `SELECT ss.daily_goal, bp.daily_goal_met, bp.questions_done FROM study_streaks ss
     LEFT JOIN bar_prep_progress bp ON bp.user_id = ss.user_id
       AND bp.study_date = ?::date
     WHERE ss.user_id = ?`,
    [day, userId]
  ).catch(() => null);

  const dailyGoal      = daily_goal_row?.daily_goal ?? 20;
  const wasAlreadyMet  = !!daily_goal_row?.daily_goal_met;
  // questions_done already includes this batch (upserted above)
  const totalToday     = Number(daily_goal_row?.questions_done ?? questionsAnswered);
  const dailyGoalJustMet = !wasAlreadyMet && totalToday >= dailyGoal;

  if (dailyGoalJustMet) {
    await db.run(
      `UPDATE bar_prep_progress SET daily_goal_met = true
       WHERE user_id = ? AND study_date = ?::date`,
      [userId, day]
    ).catch(logIgnored('services/barPrepAnalytics'));
  }

  return { dailyGoalJustMet };
}
