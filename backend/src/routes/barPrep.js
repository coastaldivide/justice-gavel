/**
 * routes/barPrep.js — Bar Exam Prep MBE Drilling
 *
 * Criminal Law + Constitutional Law supplement targeting law students.
 * Gate: legal_radar+ for full access; free = 10-question sample only.
 *
 * GET    /api/bar-prep/subjects                 — subjects + user progress
 * GET    /api/bar-prep/questions                — fetch questions for a session
 * POST   /api/bar-prep/sessions                 — create a new quiz session
 * POST   /api/bar-prep/sessions/:id/answers     — submit batch answers
 * GET    /api/bar-prep/progress                 — user dashboard + analytics
 * PUT    /api/bar-prep/progress                 — update exam_date / notifications
 * GET    /api/bar-prep/schedule                 — personalized study schedule
 * POST   /api/bar-prep/questions/:id/flag       — flag a question for review
 * GET    /api/bar-prep/explain/:questionId      — AI explanation (cached)
 * GET    /api/bar-prep/leaderboard              — anonymous peer percentile
 */


// FIX #3: sm2 is now a static import instead of per-answer dynamic import
import { Router }                   from 'express';
import { getDb }                    from '../db/index.js';
import { authRequired }             from '../middleware/auth.js';
import { quizLimiter, explainLimiter,
         sessionLimiter }           from '../utils/rateLimiters.js';
import { sm2Next }                  from '../utils/sm2.js';
import { fetchQuestionsForSession,
         getSubjectsWithProgress,
         invalidateUserCache }      from '../services/questionBank.js';
import { getExplanation }           from '../services/questionExplainer.js';
import { getUserDashboard,
         updateDailyProgress,
         getStudySchedule }         from '../services/barPrepAnalytics.js';
import { awardBarPrepPoints }       from '../services/barPrepGavel.js';
import { err400, err404,
         safeInt, sanitizeStr }     from '../utils/routeHelpers.js';
import logger                       from '../utils/logger.js';

const router = Router();
router.use(authRequired);

// ── FIX #2: module-scope constants (one allocation, not one per request) ──────
const BAR_SAMPLE_LIMIT = 10;
const PAID_TIERS       = new Set(['legal_radar', 'advisor', 'legal_pro', 'esquire']);
const VALID_REASONS    = new Set(['incorrect', 'confusing', 'outdated', 'typo', 'other']);

// ── Safe question projection — never leak correct_answer before submit ────────
function toSafeQuestion(q) {
  return {
    id:         q.id,
    subject_id: q.subject_id,
    category:   q.category,
    difficulty: q.difficulty,
    stem:       q.stem,
    option_a:   q.option_a,
    option_b:   q.option_b,
    option_c:   q.option_c,
    option_d:   q.option_d,
  };
}

// ── FREE-TIER SAMPLE GATE ─────────────────────────────────────────────────────
async function checkSampleLimit(req, res, next) {
  const tier = req.user?.subscription_tier || 'free';
  if (PAID_TIERS.has(tier)) return next();

  try {
    const db  = await getDb();
    const row = await db.get(
      `SELECT COALESCE(total_questions, 0) AS total
       FROM study_streaks WHERE user_id = ?`,
      [req.user.id]
    );
    if ((row?.total ?? 0) >= BAR_SAMPLE_LIMIT) {
      return res.status(402).json({
        error:       'paywall',
        message:     `Free plan includes ${BAR_SAMPLE_LIMIT} sample questions. Upgrade to Legal Radar+ for full access.`,
        upgrade_url: '/settings/upgrade',
      });
    }
    next();
  } catch (e) {
    logger.error('checkSampleLimit error', e);
    next(); // fail open — don't block on gate error
  }
}

// ── 1. GET /subjects ──────────────────────────────────────────────────────────
router.get('/subjects', quizLimiter, async (req, res) => {
  try {
    const subjects = await getSubjectsWithProgress(req.user.id);
    res.json({ subjects });
  } catch (e) {
    logger.error('GET /bar-prep/subjects error', e);
    res.status(500).json({ error: 'Failed to load subjects' });
  }
});

// ── 2. GET /questions ─────────────────────────────────────────────────────────
router.get('/questions', quizLimiter, checkSampleLimit, async (req, res) => {
  try {
    const subjectId = sanitizeStr(req.query.subject_id || '', 60) || null;
    const category  = sanitizeStr(req.query.category   || '', 60) || null;
    const limit     = Math.min(100, Math.max(1, safeInt(req.query.limit || '10')));
    const mode      = req.query.mode === 'timed' ? 'timed' : 'practice';

    const questions = await fetchQuestionsForSession({ userId: req.user.id, subjectId, category, limit, mode });
    res.json({ questions: questions.map(toSafeQuestion), mode, count: questions.length });
  } catch (e) {
    logger.error('GET /bar-prep/questions error', e);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// ── 3. POST /sessions ─────────────────────────────────────────────────────────
router.post('/sessions', sessionLimiter, checkSampleLimit, async (req, res) => {
  try {
    const { subject_id, category, mode = 'practice', question_count = 10 } = req.body;
    if (!subject_id) return err400(res, 'subject_id required');

    const count = Math.min(100, Math.max(1, safeInt(String(question_count))));
    const db    = await getDb();

    const { lastID } = await db.run(
      `INSERT INTO quiz_sessions
         (user_id, subject_id, category, mode, question_count, started_at,
          session_type, total_questions, time_limit_secs, status)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 'active')`,
      [req.user.id, subject_id, category || null, mode, count,
       mode, count, mode === 'timed' ? count * 90 : null]
    );

    const questions = await fetchQuestionsForSession({
      userId: req.user.id, subjectId: subject_id,
      category: category || null, limit: count, mode,
    });

    await db.run(
      `UPDATE quiz_sessions SET question_ids = ? WHERE id = ?`,
      [JSON.stringify(questions.map(q => q.id)), lastID]
    );

    res.status(201).json({
      session_id:         lastID,
      mode,
      questions:          questions.map(toSafeQuestion),
      time_limit_seconds: mode === 'timed' ? count * 90 : null, // 1.5 min / Q
    });
  } catch (e) {
    logger.error('POST /bar-prep/sessions error', e);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ── 4. POST /sessions/:id/answers ─────────────────────────────────────────────
router.post('/sessions/:id/answers', quizLimiter, async (req, res) => {
  try {
    const sessionId = safeInt(req.params.id);
    const { answers } = req.body; // [{ question_id, selected_answer, time_spent_ms }]

    if (!Array.isArray(answers) || answers.length === 0)
      return err400(res, 'answers array required');

    const db  = await getDb();
    const ses = await db.get(
      `SELECT id, completed_at FROM quiz_sessions WHERE id = ? AND user_id = ?`,
      [sessionId, req.user.id]
    );
    if (!ses)           return err404(res, 'Session not found');
    if (ses.completed_at) return err400(res, 'Session already submitted');

    // Fetch authoritative correct answers for all submitted question IDs
    const qIds = answers.map(a => a.question_id);
    const dbQs = await db.all(
      `SELECT id, correct_answer, explanation, rule_tested, case_citation
       FROM quiz_questions WHERE id IN (${qIds.map(() => '?').join(',')})`,
      qIds
    );
    const qMap = Object.fromEntries(dbQs.map(q => [q.id, q]));

    let correct = 0;
    const results = [];

    for (const ans of answers) {
      const q = qMap[ans.question_id];
      if (!q) continue;

      const isRight = (ans.selected_answer || '').toUpperCase() === q.correct_answer;
      if (isRight) correct++;

      await db.run(
        `INSERT OR IGNORE INTO quiz_answers
           (session_id, question_id, user_id, selected_answer, is_correct, time_spent_ms, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [sessionId, ans.question_id, req.user.id,
         ans.selected_answer, isRight ? 1 : 0, ans.time_spent_ms || null]
      );

      // FIX #3: sm2Next is now a static import (no longer dynamic inside the loop)
      const srRow = await db.get(
        `SELECT easiness, interval_days, repetitions, times_seen, times_correct
         FROM spaced_repetition_state WHERE user_id = ? AND question_id = ?`,
        [req.user.id, ans.question_id]
      );
      const next = sm2Next(srRow ?? {}, isRight);

      // FIX #4: use correct sm2Next field names throughout
      await db.run(
        `INSERT INTO spaced_repetition_state
           (user_id, question_id, easiness, interval_days, repetitions,
            last_quality, next_review_at, times_seen, times_correct, last_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, question_id) DO UPDATE SET
           easiness       = excluded.easiness,
           interval_days  = excluded.interval_days,
           repetitions    = excluded.repetitions,
           last_quality   = excluded.last_quality,
           next_review_at = excluded.next_review_at,
           times_seen     = excluded.times_seen,
           times_correct  = excluded.times_correct,
           last_seen_at   = excluded.last_seen_at,
           updated_at     = datetime('now')`,
        [req.user.id, ans.question_id,
         next.easiness, next.interval_days, next.repetitions,
         next.last_quality, next.next_review_at,
         next.times_seen, next.times_correct]
      );

      results.push({
        question_id:    ans.question_id,
        selected:       ans.selected_answer,
        correct_answer: q.correct_answer,
        is_correct:     isRight,
        explanation:    q.explanation,
        rule_tested:    q.rule_tested,
        case_citation:  q.case_citation,
        next_review:    next.next_review_at, 
      });
    }

    const total = results.length;
    const pct   = total > 0 ? Math.round((correct / total) * 100) : 0;

    await db.run(
      `UPDATE quiz_sessions
       SET completed_at = datetime('now'), correct_count = ?, total_answered = ?, score_pct = ?
       WHERE id = ?`,
      [correct, total, pct, sessionId]
    );

    // Estimate time spent: sum of per-answer time_spent_ms from submitted answers
    const totalTimeMs = answers.reduce((acc, a) => acc + (a.time_spent_ms || 0), 0);
    const subjectSet  = [...new Set(answers.map(a => qMap[a.question_id]?.subject_id).filter(Boolean))];
    const progressResult = await updateDailyProgress(
      req.user.id, total, correct,
      Math.round(totalTimeMs / 1000),   // timeSpentSecs
      subjectSet                         // subjects array
    );
    await invalidateUserCache(req.user.id);

    const progressRow = await db.get(
      `SELECT total_questions AS questions_answered_total,
              current_streak  AS streak_days
       FROM study_streaks WHERE user_id = ?`,
      [req.user.id]
    );
    const gavelResult = await awardBarPrepPoints({
      userId:            req.user.id,
      questionsAnswered: total,
      correctCount:      correct,
      totalEverAnswered: progressRow?.questions_answered_total ?? total,
      streakDays:        progressRow?.streak_days ?? 0,
      dailyGoalJustMet:  progressResult?.dailyGoalJustMet ?? false,
    });

    res.json({
      session_id:   sessionId,
      correct,
      total,
      score_pct:    pct,
      passed:       pct >= 66,
      results,
      gavel_points: gavelResult.points_awarded,
      new_badges:   gavelResult.new_badges,
    });
  } catch (e) {
    logger.error('POST /bar-prep/sessions/:id/answers error', e);
    res.status(500).json({ error: 'Failed to submit answers' });
  }
});

// ── 5. GET /progress ──────────────────────────────────────────────────────────
router.get('/progress', quizLimiter, async (req, res) => {
  try {
    const dashboard = await getUserDashboard(req.user.id);
    res.json(dashboard);
  } catch (e) {
    logger.error('GET /bar-prep/progress error', e);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// ── 5b. PUT /progress — exam_date + notification preferences ──────────────────
router.put('/progress', quizLimiter, async (req, res) => {
  try {
    const { exam_date, enable_notifications } = req.body;

    const updates = [];
    const args    = [];

    if (exam_date !== undefined) {
      if (exam_date && !/^\d{4}-\d{2}-\d{2}$/.test(exam_date))
        return err400(res, 'exam_date must be YYYY-MM-DD');
      // exam_date stored in study_streaks (see below), not bar_prep_progress
    }

    if (enable_notifications !== undefined) {
      updates.push('notifications_enabled = ?');
      args.push(enable_notifications ? 1 : 0);
    }

    if (updates.length === 0)
      return res.json({ updated: false, message: 'No fields to update' });

    const db = await getDb();
    args.push(req.user.id);
    await db.run(
      `UPDATE bar_prep_progress SET ${updates.join(', ')}, updated_at = datetime('now') WHERE user_id = ?`,
      args
    );

    if (exam_date !== undefined) {
      await db.run(
        `INSERT INTO study_streaks (user_id, exam_date, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET exam_date = excluded.exam_date, updated_at = datetime('now')`,
        [req.user.id, exam_date || null]
      );
      try {
        const { schedulePrepNotifications } = await import('../services/barPrepNotifications.js');
        await schedulePrepNotifications();
      } catch { /* non-fatal */ }
    }

    res.json({ updated: true });
  } catch (e) {
    logger.error('PUT /bar-prep/progress error', e);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ── 6. GET /schedule ──────────────────────────────────────────────────────────
router.get('/schedule', quizLimiter, async (req, res) => {
  try {
    const schedule = await getStudySchedule(req.user.id, req.query.exam_date || null);
    res.json(schedule);
  } catch (e) {
    logger.error('GET /bar-prep/schedule error', e);
    res.status(500).json({ error: 'Failed to build schedule' });
  }
});

// ── 7. POST /questions/:id/flag ───────────────────────────────────────────────
router.post('/questions/:id/flag', quizLimiter, async (req, res) => {
  try {
    const questionId = safeInt(req.params.id);
    const reason     = sanitizeStr(req.body.reason || 'other', 60);
    const note       = sanitizeStr(req.body.note   || '',      500);

    if (!VALID_REASONS.has(reason)) return err400(res, 'Invalid reason');

    const db = await getDb();
    const q  = await db.get(`SELECT id FROM quiz_questions WHERE id = ?`, [questionId]);
    if (!q) return err404(res, 'Question not found');

    await db.run(
      `INSERT INTO quiz_question_flags (question_id, user_id, reason, note, status, created_at)
       VALUES (?, ?, ?, ?, 'open', datetime('now'))
       ON CONFLICT(question_id, user_id) DO UPDATE
         SET reason = excluded.reason, note = excluded.note, status = 'open'`,
      [questionId, req.user.id, reason, note]
    );

    res.json({ flagged: true, question_id: questionId, reason });
  } catch (e) {
    logger.error('POST /bar-prep/questions/:id/flag error', e);
    res.status(500).json({ error: 'Failed to flag question' });
  }
});

// ── 8. GET /explain/:questionId ───────────────────────────────────────────────
router.get('/explain/:questionId', explainLimiter, async (req, res) => {
  try {
    const questionId = safeInt(req.params.questionId);
    const db = await getDb();
    const q  = await db.get(
      `SELECT id, subject_id, category, difficulty, stem,
              option_a, option_b, option_c, option_d,
              correct_answer, explanation, rule_tested, case_citation, ai_explanation
       FROM quiz_questions WHERE id = ?`,
      [questionId]
    );
    if (!q) return err404(res, 'Question not found');

    const explanation = await getExplanation(q);
    res.json({ question_id: questionId, explanation });
  } catch (e) {
    logger.error('GET /bar-prep/explain/:questionId error', e);
    res.status(500).json({ error: 'Failed to generate explanation' });
  }
});

// ── 9. GET /leaderboard ───────────────────────────────────────────────────────
router.get('/leaderboard', quizLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    // FIX #5: subject_id parsed but was never wired into SQL — now it is
    const subject = sanitizeStr(req.query.subject_id || '', 60) || null;
    const period  = req.query.period === 'week' ? 'week' : 'all';

    let sql = `
      SELECT
        user_id = ?            AS is_me,
        questions_answered_total,
        correct_total,
        ROUND(correct_total * 100.0 / NULLIF(questions_answered_total, 0), 1) AS accuracy_pct,
        streak_days
      FROM bar_prep_progress
      WHERE questions_answered_total >= 5
    `;
    const args = [req.user.id];

    if (subject) {
      sql += ` AND subject_id = ?`;
      args.push(subject);
    }
    if (period === 'week') {
      sql += ` AND date(updated_at) >= date('now', '-7 days')`;
    }
    sql += ` ORDER BY accuracy_pct DESC LIMIT 20`;

    const rows = await db.all(sql, args);

    const myIdx  = rows.findIndex(r => r.is_me);
    const myRank = myIdx >= 0 ? myIdx + 1 : null;

    const board = rows.map((r, i) => ({
      rank:         i + 1,
      label:        r.is_me ? 'You 🎓' : `Peer ${i + 1}`,
      is_me:        !!r.is_me,
      accuracy_pct: r.accuracy_pct,
      questions:    r.questions_answered_total,
      streak_days:  r.streak_days,
    }));

    res.json({ leaderboard: board, my_rank: myRank, period });
  } catch (e) {
    logger.error('GET /bar-prep/leaderboard error', e);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

export default router;

// Bar prep API disclaimer: all content is for educational/exam prep purposes only.
