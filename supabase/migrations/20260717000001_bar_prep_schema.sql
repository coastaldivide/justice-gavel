-- ═══════════════════════════════════════════════════════════════════════════════
-- [I-01] Bar Exam Prep — Complete Database Schema
-- Criminal Law + Constitutional Law MBE supplement
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Subjects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bar_subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,        -- 'criminal_law', 'constitutional_law'
  title         TEXT NOT NULL,               -- 'Criminal Law & Procedure'
  description   TEXT,
  mbe_weight    NUMERIC(4,1),               -- % of MBE exam (12.5 each)
  color         TEXT DEFAULT '#1B2A6B',     -- hex for UI heat map
  icon          TEXT DEFAULT 'scale-outline',
  question_count INTEGER DEFAULT 0,         -- denorm count updated via trigger
  is_active     BOOLEAN DEFAULT true,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Questions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      UUID REFERENCES bar_subjects(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,             -- 'fourth_amendment', 'homicide', etc.
  difficulty      TEXT DEFAULT 'medium'
                  CHECK (difficulty IN ('easy','medium','hard')),
  stem            TEXT NOT NULL,             -- the question text
  option_a        TEXT NOT NULL,
  option_b        TEXT NOT NULL,
  option_c        TEXT NOT NULL,
  option_d        TEXT NOT NULL,
  correct_answer  CHAR(1) NOT NULL
                  CHECK (correct_answer IN ('A','B','C','D')),
  explanation     TEXT,                      -- why correct is correct
  rule            TEXT,                      -- legal rule cited
  case_citation   TEXT,                      -- e.g. "Terry v. Ohio (1968)"
  mbe_topic_code  TEXT,                      -- NCBE classification
  is_retired_mbe  BOOLEAN DEFAULT false,     -- from actual past bar exams
  ai_explanation  TEXT,                      -- Claude-generated deep dive
  ai_generated_at TIMESTAMPTZ,
  flag_count      INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Quiz Sessions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  session_type     TEXT DEFAULT 'practice'
                   CHECK (session_type IN ('practice','timed','review','daily')),
  subject_filter   TEXT[],                  -- NULL = all subjects
  question_ids     UUID[],                  -- ordered list for this session
  current_index    INTEGER DEFAULT 0,
  total_questions  INTEGER NOT NULL,
  correct_count    INTEGER DEFAULT 0,
  time_limit_secs  INTEGER,                 -- NULL = untimed
  time_spent_secs  INTEGER DEFAULT 0,
  paused_at        TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  status           TEXT DEFAULT 'active'
                   CHECK (status IN ('active','paused','completed','abandoned')),
  score_pct        NUMERIC(5,2),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Per-Answer Logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_answers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  question_id      UUID REFERENCES quiz_questions(id) ON DELETE CASCADE,
  chosen_answer    CHAR(1) CHECK (chosen_answer IN ('A','B','C','D')),
  is_correct       BOOLEAN NOT NULL,
  time_spent_secs  INTEGER,                 -- how long on this question
  answered_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Spaced Repetition State ───────────────────────────────────────────────────
-- SM-2 algorithm: https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-super-memo-method
CREATE TABLE IF NOT EXISTS spaced_repetition_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  question_id       UUID REFERENCES quiz_questions(id) ON DELETE CASCADE,
  -- SM-2 state
  easiness          NUMERIC(4,2) DEFAULT 2.5,  -- EF: 1.3 min, starts at 2.5
  interval_days     INTEGER DEFAULT 1,          -- days until next review
  repetitions       INTEGER DEFAULT 0,          -- consecutive correct answers
  last_quality      INTEGER,                    -- 0-5 response quality
  next_review_at    TIMESTAMPTZ DEFAULT NOW(),
  -- History
  times_seen        INTEGER DEFAULT 0,
  times_correct     INTEGER DEFAULT 0,
  first_seen_at     TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, question_id)
);

-- ── Study Streaks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_streaks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  current_streak    INTEGER DEFAULT 0,
  longest_streak    INTEGER DEFAULT 0,
  last_study_date   DATE,
  streak_frozen     BOOLEAN DEFAULT false,      -- "freeze" streak token
  exam_date         DATE,                       -- target bar exam date
  daily_goal        INTEGER DEFAULT 20,         -- questions per day
  total_questions   INTEGER DEFAULT 0,
  total_correct     INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Daily Progress ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bar_prep_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  study_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  questions_done   INTEGER DEFAULT 0,
  questions_correct INTEGER DEFAULT 0,
  time_spent_secs  INTEGER DEFAULT 0,
  subjects_covered TEXT[],
  daily_goal_met   BOOLEAN DEFAULT false,
  golden_gavel_pts INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, study_date)
);

-- ── Question Flags ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_question_flags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID REFERENCES quiz_questions(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  resolved     BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Question delivery (most common query: subject + difficulty + not seen recently)
CREATE INDEX IF NOT EXISTS idx_quiz_questions_subject
  ON quiz_questions (subject_id, difficulty, is_active);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_category
  ON quiz_questions (category, is_active);

-- Spaced repetition delivery (due cards for user)
CREATE INDEX IF NOT EXISTS idx_sr_state_user_due
  ON spaced_repetition_state (user_id, next_review_at ASC)
  WHERE next_review_at <= NOW() + INTERVAL '1 day';

-- Answer history (accuracy calculation)
CREATE INDEX IF NOT EXISTS idx_quiz_answers_user_question
  ON quiz_answers (user_id, question_id, answered_at DESC);

CREATE INDEX IF NOT EXISTS idx_quiz_answers_session
  ON quiz_answers (session_id, answered_at ASC);

-- Session lookup (resume active session)
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_active
  ON quiz_sessions (user_id, status, created_at DESC)
  WHERE status IN ('active', 'paused');

-- Daily progress lookup
CREATE INDEX IF NOT EXISTS idx_bar_prep_progress_user_date
  ON bar_prep_progress (user_id, study_date DESC);

-- Streak lookup
CREATE INDEX IF NOT EXISTS idx_study_streaks_user
  ON study_streaks (user_id);

-- ── Analytics Views ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW user_bar_performance AS
SELECT
  qa.user_id,
  qq.subject_id,
  bs.code                                          AS subject_code,
  bs.title                                         AS subject_title,
  COUNT(*)                                         AS total_answered,
  SUM(qa.is_correct::int)                          AS total_correct,
  ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1) AS accuracy_pct,
  AVG(qa.time_spent_secs)                          AS avg_time_secs,
  MAX(qa.answered_at)                              AS last_answered
FROM quiz_answers qa
JOIN quiz_questions qq ON qq.id = qa.question_id
JOIN bar_subjects   bs ON bs.id = qq.subject_id
GROUP BY qa.user_id, qq.subject_id, bs.code, bs.title;

CREATE OR REPLACE VIEW subject_accuracy_breakdown AS
SELECT
  qa.user_id,
  qq.category,
  qq.subject_id,
  COUNT(*)                                               AS answered,
  SUM(qa.is_correct::int)                               AS correct,
  ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1) AS accuracy_pct,
  CASE
    WHEN ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1) < 60 THEN 'weak'
    WHEN ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1) < 75 THEN 'developing'
    ELSE 'strong'
  END                                                    AS mastery_level
FROM quiz_answers qa
JOIN quiz_questions qq ON qq.id = qa.question_id
WHERE qa.answered_at > NOW() - INTERVAL '60 days'
GROUP BY qa.user_id, qq.category, qq.subject_id
HAVING COUNT(*) >= 3;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE quiz_questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaced_repetition_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_streaks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bar_prep_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_question_flags    ENABLE ROW LEVEL SECURITY;

-- Questions: all authenticated users can read
CREATE POLICY "quiz_questions_read" ON quiz_questions
  FOR SELECT USING (is_active = true);

-- Sessions/answers/progress: users own their data
CREATE POLICY "quiz_sessions_own" ON quiz_sessions
  USING (user_id = auth.uid());
CREATE POLICY "quiz_answers_own" ON quiz_answers
  USING (user_id = auth.uid());
CREATE POLICY "sr_state_own" ON spaced_repetition_state
  USING (user_id = auth.uid());
CREATE POLICY "streaks_own" ON study_streaks
  USING (user_id = auth.uid());
CREATE POLICY "bar_progress_own" ON bar_prep_progress
  USING (user_id = auth.uid());

-- ── Trigger: keep question_count denorm in bar_subjects current ───────────────
CREATE OR REPLACE FUNCTION update_subject_question_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE bar_subjects
  SET question_count = (
    SELECT COUNT(*) FROM quiz_questions
    WHERE subject_id = COALESCE(NEW.subject_id, OLD.subject_id)
      AND is_active = true
  )
  WHERE id = COALESCE(NEW.subject_id, OLD.subject_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_question_count ON quiz_questions;
CREATE TRIGGER trg_question_count
  AFTER INSERT OR UPDATE OR DELETE ON quiz_questions
  FOR EACH ROW EXECUTE FUNCTION update_subject_question_count();

-- ── Seed subjects ─────────────────────────────────────────────────────────────
INSERT INTO bar_subjects (code, title, description, mbe_weight, color, sort_order)
VALUES
  ('criminal_law', 'Criminal Law & Procedure',
   'Homicide, theft, defenses, 4th/5th/6th Amendment procedure, arrest, search & seizure',
   12.5, '#C9A84C', 1),
  ('constitutional_law', 'Constitutional Law',
   'Due process, equal protection, First Amendment, 14th Amendment, incorporation doctrine',
   12.5, '#1B2A6B', 2)
ON CONFLICT (code) DO NOTHING;
