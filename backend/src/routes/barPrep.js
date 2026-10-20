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
import { safeInt, sanitizeStr }     from '../utils/routeHelpers.js';
import { msg, resolveLang }         from '../i18n/index.js';
import { isValidTimeZone, todayInZone, parseDateOnly, DEFAULT_TIME_ZONE } from '../utils/timezone.js';
import logger                       from '../utils/logger.js';
import { hasFeature }               from '../services/entitlements.js';
import { FEATURES }                 from './billing/plans.js';

const err400 = (res, key, req) => res.status(400).json({ error: key, code: key, message: msg(resolveLang(req), `barprep.err.${key}`) });
const err404 = (res, key, req) => res.status(404).json({ error: key, code: key, message: msg(resolveLang(req), `barprep.err.${key}`) });
const err500 = (res, req) => res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(resolveLang(req), 'barprep.err.server') });

/** The person's calendar day (X-Timezone, else the default zone): streaks, goals and the schedule use it. */
export function localDay(req) {
  const raw = req.get?.('X-Timezone');
  const tz = isValidTimeZone(raw) ? raw : DEFAULT_TIME_ZONE;
  return { tz, today: todayInZone(tz) };
}


/** BAR_PREP_DISCLAIMER — included in all bar prep API responses
 * This is a study supplement, NOT a bar exam course, NOT Barbri/Themis/Adaptibar.
 * Questions are for practice only and may not reflect current law in all jurisdictions.
 */

const router = Router();
router.use(authRequired);

// ── FIX #2: module-scope constants (one allocation, not one per request) ──────
const BAR_SAMPLE_LIMIT = 10;
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
// Paid = a plan that includes bar prep (routes/billing/plans.js, services/entitlements.js).
const hasPaidPlan = (db, userId) => hasFeature(db, userId, FEATURES.BAR_PREP);

async function checkSampleLimit(req, res, next) {
  try {
    const db  = await getDb();
    if (await hasPaidPlan(db, req.user.id)) return next();
    const row = await db.get(
      `SELECT COALESCE(total_questions, 0) AS total
       FROM study_streaks WHERE user_id = ?`,
      [req.user.id]
    );
    if ((row?.total ?? 0) >= BAR_SAMPLE_LIMIT) {
      return res.status(402).json({
        error:       'paywall',
        code:        'paywall',
        message:     msg(resolveLang(req), 'barprep.err.paywall', { n: BAR_SAMPLE_LIMIT }),
        upgrade_url: '/plans',
        limit:       BAR_SAMPLE_LIMIT,
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
    err500(res, req);
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
    err500(res, req);
  }
});

// ── 3. POST /sessions ─────────────────────────────────────────────────────────
router.post('/sessions', sessionLimiter, checkSampleLimit, async (req, res) => {
  try {
    const { subject_id, category, mode = 'practice', question_count = 10, question_ids } = req.body || {};
    if (!['practice', 'timed'].includes(mode)) return err400(res, 'bad_mode', req);
    // A review session: exactly these questions (e.g. "Retry the ones I missed").
    const reviewIds = Array.isArray(question_ids) ? [...new Set(question_ids.map(String).filter(id => UUID_RE.test(id)))].slice(0, 100) : null;
    if (Array.isArray(question_ids) && !reviewIds.length) return err400(res, 'answers_required', req);
    if (!reviewIds && (!subject_id || typeof subject_id !== 'string')) return err400(res, 'subject_required', req);

    const count = Math.min(100, Math.max(1, safeInt(String(question_count))));
    const db    = await getDb();
    if (!reviewIds) {
      const subject = await db.get('SELECT id FROM bar_subjects WHERE id = ?', [subject_id]);
      if (!subject) return err404(res, 'subject_not_found', req);
    }

    const { lastID } = await db.run(
      `INSERT INTO quiz_sessions
         (user_id, subject_id, category, mode, question_count, started_at,
          session_type, total_questions, time_limit_secs, status)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'active')`,
      [req.user.id, reviewIds ? null : subject_id, category || null, mode, count,
       mode, count, mode === 'timed' ? count * 90 : null]
    );

    const questions = reviewIds
      ? await db.all(
        `SELECT id, subject_id, category, difficulty, stem, option_a, option_b, option_c, option_d
           FROM quiz_questions WHERE is_active AND id IN (${reviewIds.map(() => '?').join(',')}) LIMIT 100`, reviewIds)
      : await fetchQuestionsForSession({
        userId: req.user.id, subjectId: subject_id,
        category: category || null, limit: count, mode,
      });
    if (!questions.length) {
      await db.run('DELETE FROM quiz_sessions WHERE id = ?', [lastID]);
      return err404(res, 'no_questions', req);
    }

    // The session is exactly these questions: total, time limit and scoring use them.
    await db.run(
      `UPDATE quiz_sessions SET question_ids = ?, total_questions = ?, question_count = ?, time_limit_secs = ? WHERE id = ?`,
      [questions.map(q => q.id), questions.length, questions.length, mode === 'timed' ? questions.length * 90 : null, lastID]
    );

    res.status(201).json({
      session_id:         lastID,
      mode,
      questions:          questions.map(toSafeQuestion),
      time_limit_seconds: mode === 'timed' ? questions.length * 90 : null, // 1.5 min / Q
    });
  } catch (e) {
    logger.error('POST /bar-prep/sessions error', e);
    err500(res, req);
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 4. POST /sessions/:id/answers ─────────────────────────────────────────────
// Body: { answers: [{ question_id, selected_answer: 'A'..'D', time_spent_ms }], complete? }
// Practice mode sends one answer at a time; timed mode sends them all with
// complete: true. Only the session's own questions count, each once (a repeat
// returns the first result). The session completes when every question is
// answered or `complete` is sent; the score is correct / all questions of the
// session (an unanswered question counts as wrong).
router.post('/sessions/:id/answers', quizLimiter, async (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();   // quiz_sessions.id is a UUID
    if (!UUID_RE.test(sessionId)) return err400(res, 'bad_session', req);
    const { answers, complete = false } = req.body || {};
    if (!Array.isArray(answers) || answers.length > 200) return err400(res, 'answers_required', req);
    if (!answers.length && !complete) return err400(res, 'answers_required', req);

    const db  = await getDb();
    const ses = await db.get(
      `SELECT id, completed_at, question_ids, total_questions FROM quiz_sessions WHERE id = ? AND user_id = ?`,
      [sessionId, req.user.id]
    );
    if (!ses)             return err404(res, 'session_not_found', req);
    if (ses.completed_at) return err400(res, 'already_submitted', req);

    const inSession = new Set((ses.question_ids || []).map(String));
    const seen = new Set();
    const valid = [];
    for (const a of answers) {
      const qid = String(a?.question_id || '');
      const letter = String(a?.selected_answer || '').trim().toUpperCase();
      if (!inSession.has(qid) || seen.has(qid)) continue;
      if (!['A', 'B', 'C', 'D'].includes(letter)) return err400(res, 'bad_answer', req);
      seen.add(qid);
      valid.push({ question_id: qid, letter, time_spent_ms: Math.max(0, Math.min(3_600_000, safeInt(a?.time_spent_ms) || 0)) });
    }

    const qIds = valid.map(a => a.question_id);
    const dbQs = qIds.length ? await db.all(
      `SELECT id, subject_id, correct_answer, explanation, rule_tested, case_citation
         FROM quiz_questions WHERE id IN (${qIds.map(() => '?').join(',')}) LIMIT 200`, qIds) : [];
    const qMap = Object.fromEntries(dbQs.map(q => [String(q.id), q]));

    const results = [];
    let newAnswered = 0, newCorrect = 0, newTimeMs = 0;
    const newSubjects = new Set();
    for (const ans of valid) {
      const q = qMap[ans.question_id];
      if (!q) continue;
      const isRight = ans.letter === String(q.correct_answer || '').trim().toUpperCase();
      const ins = await db.run(
        `INSERT INTO quiz_answers
           (session_id, question_id, user_id, selected_answer, chosen_answer, is_correct, time_spent_ms, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW()) ON CONFLICT (session_id, question_id) DO NOTHING`,
        [sessionId, ans.question_id, req.user.id, ans.letter, ans.letter, isRight, ans.time_spent_ms || null]
      );
      let stored = { selected: ans.letter, is_correct: isRight };
      if (ins.changes) {
        newAnswered++; if (isRight) newCorrect++; newTimeMs += ans.time_spent_ms; if (q.subject_id) newSubjects.add(q.subject_id);
        const srRow = await db.get(
          `SELECT easiness, interval_days, repetitions, times_seen, times_correct
             FROM spaced_repetition_state WHERE user_id = ? AND question_id = ?`,
          [req.user.id, ans.question_id]);
        const next = sm2Next(srRow ?? {}, isRight);
        await db.run(
          `INSERT INTO spaced_repetition_state
             (user_id, question_id, easiness, interval_days, repetitions,
              last_quality, next_review_at, times_seen, times_correct, last_seen_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
           ON CONFLICT(user_id, question_id) DO UPDATE SET
             easiness = excluded.easiness, interval_days = excluded.interval_days,
             repetitions = excluded.repetitions, last_quality = excluded.last_quality,
             next_review_at = excluded.next_review_at, times_seen = excluded.times_seen,
             times_correct = excluded.times_correct, last_seen_at = excluded.last_seen_at, updated_at = NOW()`,
          [req.user.id, ans.question_id, next.easiness, next.interval_days, next.repetitions,
           next.last_quality, next.next_review_at, next.times_seen, next.times_correct]);
        stored = { ...stored, next_review: next.next_review_at };
      } else {
        // Already answered in this session: the first answer stands.
        const prev = await db.get('SELECT selected_answer, is_correct FROM quiz_answers WHERE session_id = ? AND question_id = ?', [sessionId, ans.question_id]);
        stored = { selected: prev?.selected_answer ?? ans.letter, is_correct: !!prev?.is_correct, already_answered: true };
      }
      results.push({
        question_id:    ans.question_id,
        correct_answer: q.correct_answer,
        explanation:    q.explanation,
        rule_tested:    q.rule_tested,
        case_citation:  q.case_citation,
        ...stored,
      });
    }

    // Running totals for the whole session, from the stored answers.
    const tot = await db.get(
      `SELECT COUNT(*)::int AS answered, COALESCE(SUM(is_correct::int), 0)::int AS correct FROM quiz_answers WHERE session_id = ?`, [sessionId]);
    const totalQuestions = Number(ses.total_questions) || inSession.size;
    const finished = !!complete || tot.answered >= totalQuestions;
    const pct = totalQuestions > 0 ? Math.round((tot.correct / totalQuestions) * 100) : 0;
    await db.run(
      `UPDATE quiz_sessions SET correct_count = ?, total_answered = ?, current_index = ?${finished ? ", completed_at = NOW(), status = 'completed', score_pct = ?" : ''}
        WHERE id = ?`,
      finished ? [tot.correct, tot.answered, tot.answered, pct, sessionId] : [tot.correct, tot.answered, tot.answered, sessionId]);

    let gavel = { points_awarded: 0, new_badges: [] };
    if (newAnswered) {
      const { today } = localDay(req);
      const progressResult = await updateDailyProgress(req.user.id, newAnswered, newCorrect, Math.round(newTimeMs / 1000), [...newSubjects], today);
      await invalidateUserCache(req.user.id);
      const progressRow = await db.get(
        `SELECT total_questions AS questions_answered_total, current_streak AS streak_days FROM study_streaks WHERE user_id = ?`, [req.user.id]);
      gavel = await awardBarPrepPoints({
        userId:            req.user.id,
        questionsAnswered: newAnswered,
        correctCount:      newCorrect,
        totalEverAnswered: progressRow?.questions_answered_total ?? newAnswered,
        streakDays:        progressRow?.streak_days ?? 0,
        dailyGoalJustMet:  progressResult?.dailyGoalJustMet ?? false,
      });
    }

    res.json({
      session_id:   sessionId,
      completed:    finished,
      correct:      tot.correct,
      answered:     tot.answered,
      total:        totalQuestions,
      score_pct:    pct,
      passed:       finished ? pct >= 66 : null,
      results,
      gavel_points: gavel.points_awarded,
      new_badges:   gavel.new_badges,
    });
  } catch (e) {
    logger.error('POST /bar-prep/sessions/:id/answers error', e);
    err500(res, req);
  }
});

// ── 5. GET /progress ──────────────────────────────────────────────────────────
router.get('/progress', quizLimiter, async (req, res) => {
  try {
    const dashboard = await getUserDashboard(req.user.id);
    res.json(dashboard);
  } catch (e) {
    logger.error('GET /bar-prep/progress error', e);
    err500(res, req);
  }
});

// ── 5b. PUT /progress — exam_date + notification preferences ──────────────────
router.put('/progress', quizLimiter, async (req, res) => {
  try {
    const { exam_date, enable_notifications } = req.body || {};
    // A real calendar day ('2027-02-30' is refused); null / '' clears it.
    if (exam_date !== undefined && exam_date !== null && exam_date !== '' && !parseDateOnly(String(exam_date))) {
      return err400(res, 'bad_exam_date', req);
    }
    if (exam_date === undefined && enable_notifications === undefined) return res.json({ updated: false });

    const db = await getDb();
    if (enable_notifications !== undefined) {
      await db.run('UPDATE bar_prep_progress SET notifications_enabled = ?, updated_at = NOW() WHERE user_id = ?',
        [enable_notifications ? 1 : 0, req.user.id]);
    }

    if (exam_date !== undefined) {
      await db.run(
        `INSERT INTO study_streaks (user_id, exam_date, updated_at) VALUES (?, ?, NOW())
         ON CONFLICT(user_id) DO UPDATE SET exam_date = excluded.exam_date, updated_at = NOW()`,
        [req.user.id, exam_date || null]
      );
      await invalidateUserCache(req.user.id);
      try {
        const { schedulePrepNotifications } = await import('../services/barPrepNotifications.js');
        await schedulePrepNotifications();
      } catch { /* non-fatal */ }
    }

    res.json({ updated: true });
  } catch (e) {
    logger.error('PUT /bar-prep/progress error', e);
    err500(res, req);
  }
});

// ── 6. GET /schedule ──────────────────────────────────────────────────────────
router.get('/schedule', quizLimiter, async (req, res) => {
  try {
    const { tz, today } = localDay(req);
    res.json(await getStudySchedule(req.user.id, { today, tz }));
  } catch (e) {
    logger.error('GET /bar-prep/schedule error', e);
    err500(res, req);
  }
});

// ── 7. POST /questions/:id/flag ───────────────────────────────────────────────
router.post('/questions/:id/flag', quizLimiter, async (req, res) => {
  try {
    // quiz_questions.id is a UUID
    const questionId = String(req.params.id || '').trim();
    if (!UUID_RE.test(questionId)) return err404(res, 'question_not_found', req);
    const reason     = sanitizeStr(req.body?.reason || 'other', 60);
    const note       = sanitizeStr(req.body?.note   || '',      500);

    if (!VALID_REASONS.has(reason)) return err400(res, 'bad_reason', req);

    const db = await getDb();
    const q  = await db.get(`SELECT id FROM quiz_questions WHERE id = ?`, [questionId]);
    if (!q) return err404(res, 'question_not_found', req);

    await db.run(
      `INSERT INTO quiz_question_flags (question_id, user_id, reason, note, status, created_at)
       VALUES (?, ?, ?, ?, 'open', NOW())
       ON CONFLICT(question_id, user_id) DO UPDATE
         SET reason = excluded.reason, note = excluded.note, status = 'open'`,
      [questionId, req.user.id, reason, note]
    );

    res.json({ flagged: true, question_id: questionId, reason });
  } catch (e) {
    logger.error('POST /bar-prep/questions/:id/flag error', e);
    err500(res, req);
  }
});

// ── 8. GET /explain/:questionId ───────────────────────────────────────────────
router.get('/explain/:questionId', explainLimiter, async (req, res) => {
  try {
    const questionId = String(req.params.questionId || '').trim();   // UUID
    if (!UUID_RE.test(questionId)) return err404(res, 'question_not_found', req);
    const db = await getDb();
    const q  = await db.get(
      `SELECT id, subject_id, category, difficulty, stem,
              option_a, option_b, option_c, option_d,
              correct_answer, explanation, rule_tested, case_citation, ai_explanation
       FROM quiz_questions WHERE id = ?`,
      [questionId]
    );
    if (!q) return err404(res, 'question_not_found', req);

    const result = await getExplanation(questionId, req.user?.id ?? null);
    // The question it explains, with the right answer and the rule it tests.
    res.json({
      question_id: questionId, explanation: result.explanation, status: result.status,
      ai_explanation: result.status === 'cached' ? result.explanation : null,
      question: {
        explanation: q.explanation,
        stem: q.stem, options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
        correct_answer: q.correct_answer, rule_tested: q.rule_tested, case_citation: q.case_citation,
        category: q.category, difficulty: q.difficulty,
      },
    });
  } catch (e) {
    logger.error('GET /bar-prep/explain/:questionId error', e);
    err500(res, req);
  }
});

// ── 9. GET /leaderboard ───────────────────────────────────────────────────────
router.get('/leaderboard', quizLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    // FIX #5: subject_id parsed but was never wired into SQL — now it is
    const subject = sanitizeStr(req.query.subject_id || '', 60) || null;
    const period  = req.query.period === 'week' ? 'week' : 'all';

    // Lifetime totals live in study_streaks (one row per person); a subject
    // board counts that subject's answers.
    let sql, args;
    if (subject) {
      sql = `SELECT qa.user_id = ? AS is_me, COUNT(*)::int AS questions_answered_total,
                    SUM(qa.is_correct::int)::int AS correct_total,
                    ROUND(SUM(qa.is_correct::int) * 100.0 / NULLIF(COUNT(*), 0), 1) AS accuracy_pct,
                    MAX(ss.current_streak) AS streak_days
               FROM quiz_answers qa JOIN quiz_questions qq ON qq.id = qa.question_id
               LEFT JOIN study_streaks ss ON ss.user_id = qa.user_id
              WHERE qq.subject_id = ?${period === 'week' ? " AND qa.answered_at >= NOW() - INTERVAL '7 days'" : ''}
              GROUP BY qa.user_id HAVING COUNT(*) >= 5
              ORDER BY accuracy_pct DESC LIMIT 20`;
      args = [req.user.id, subject];
    } else {
      sql = `SELECT user_id = ? AS is_me, total_questions AS questions_answered_total, total_correct AS correct_total,
                    ROUND(total_correct * 100.0 / NULLIF(total_questions, 0), 1) AS accuracy_pct,
                    current_streak AS streak_days
               FROM study_streaks
              WHERE total_questions >= 5${period === 'week' ? " AND last_study_date >= CURRENT_DATE - 7" : ''}
              ORDER BY accuracy_pct DESC LIMIT 20`;
      args = [req.user.id];
    }

    const rows = await db.all(sql, args);

    const myIdx  = rows.findIndex(r => r.is_me);
    const myRank = myIdx >= 0 ? myIdx + 1 : null;

    const board = rows.map((r, i) => ({
      rank:         i + 1,
      label:        r.is_me ? msg(resolveLang(req), 'barprep.board.you') : msg(resolveLang(req), 'barprep.board.peer', { n: i + 1 }),
      is_me:        !!r.is_me,
      accuracy_pct: r.accuracy_pct,
      questions:    r.questions_answered_total,
      streak_days:  r.streak_days,
    }));

    res.json({ leaderboard: board, my_rank: myRank, period });
  } catch (e) {
    logger.error('GET /bar-prep/leaderboard error', e);
    err500(res, req);
  }
});

export default router;

// Bar prep API disclaimer: all content is for educational/exam prep purposes only.
