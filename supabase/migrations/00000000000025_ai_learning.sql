-- 00000000000025_ai_learning.sql — AI chat retries, quiz answers, lesson progress
--
-- 1. chat_sessions.client_msg_id / status
--    The app sends an id with every question. A retry after a dropped
--    connection carries the same id: when the answer was already finished the
--    server replays it instead of asking (and charging) again, and a partial
--    answer from the dropped attempt is replaced, so the history never holds
--    the same question twice. status: 'complete' | 'stopped' (the person
--    pressed Stop, or the connection closed mid-answer — the text they saw is
--    kept).
-- 2. quiz_answers: one answer per question per session. Practice mode sends
--    answers one at a time; the score is counted from these rows.
-- 3. lesson_progress: one row per person per lesson, so completing a lesson
--    twice never awards its points twice.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, duplicates removed before each
-- unique index (oldest row kept), CREATE UNIQUE INDEX IF NOT EXISTS.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS client_msg_id TEXT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS status TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_client_msg
  ON chat_sessions (user_id, session_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

DELETE FROM quiz_answers a
 USING quiz_answers b
 WHERE a.session_id = b.session_id
   AND a.question_id = b.question_id
   AND (COALESCE(a.answered_at, 'epoch'), a.id) > (COALESCE(b.answered_at, 'epoch'), b.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_answers_session_question
  ON quiz_answers (session_id, question_id);

DELETE FROM lesson_progress a
 USING lesson_progress b
 WHERE a.user_id = b.user_id
   AND a.lesson_id = b.lesson_id
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_progress_user_lesson
  ON lesson_progress (user_id, lesson_id);
