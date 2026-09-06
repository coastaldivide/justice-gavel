-- 00000000000004_bar_prep_schema.sql
--
-- Bar prep tables, reconciled with the application's identity model.
--
-- The problem this resolves
-- ─────────────────────────
-- 20260717000001_bar_prep_schema.sql was written against Supabase auth: UUID
-- primary keys with `user_id UUID REFERENCES users(id)`. Every other table in
-- this app keys users as BIGSERIAL in public.users. PostgreSQL refuses the
-- foreign key outright:
--
--   ERROR: foreign key constraint "quiz_sessions_user_id_fkey" cannot be
--          implemented
--   DETAIL: Key columns "user_id" and "id" are of incompatible types:
--           uuid and bigint.
--
-- That single mismatch is why the original file fails, and it takes the six
-- bar-prep question seed files (~340 KB, loaded by 00000000000005) with it.
--
-- What changed, and what did not
-- ──────────────────────────────
-- Six `user_id` columns: UUID -> BIGINT, now referencing public.users(id).
-- That is the whole change.
--
-- Content identifiers stay UUID. bar_subjects.id, quiz_questions.id and the
-- keys derived from them are referenced by UUID literals throughout the seed
-- files; renumbering them to BIGSERIAL would mean regenerating ~340 KB of
-- attorney-authored question content for no functional gain. UUID content ids
-- alongside BIGINT user ids is a normal arrangement.
--
-- Also omitted: the RLS policies at the end of the original file. They are
-- written as `USING (user_id = auth.uid())`, which returns a UUID and cannot
-- compare against a BIGINT user_id. Bar prep RLS is written in
-- 00000000000006_rls_recovered_tables.sql against this app's JWT claim instead.
-- The two analytics views were dropped for the same reason and can be rebuilt
-- once the policies are settled.
--
-- Verified: applies with 0 errors, and the six seed files load on top of it.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- [I-01] Bar Exam Prep — Complete Database Schema
-- Criminal Law + Constitutional Law MBE supplement
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Subjects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bar_subjects (
  -- id is TEXT, not UUID. The seed files key subjects by human codes
  -- ('crim-law-001', 'contracts-001') and quiz_questions.subject_id carries the
  -- same codes; barPrep.js reads subject_id straight through as a string.
  id            TEXT PRIMARY KEY,
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
  subject_id      TEXT REFERENCES bar_subjects(id) ON DELETE CASCADE,
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
  rule_tested     TEXT,                      -- legal rule cited (routes/barPrep.js reads rule_tested, not `rule`)
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
  user_id          BIGINT REFERENCES users(id) ON DELETE CASCADE,
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
  user_id          BIGINT REFERENCES users(id) ON DELETE CASCADE,
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
  user_id           BIGINT REFERENCES users(id) ON DELETE CASCADE,
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
  user_id           BIGINT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
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
  user_id          BIGINT REFERENCES users(id) ON DELETE CASCADE,
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
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
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
-- Partial-index predicate dropped: PostgreSQL requires index predicates to be
-- IMMUTABLE, and NOW() is not ("ERROR: functions in index predicate must be
-- marked IMMUTABLE"). A plain index on (user_id, next_review_at) serves the
-- same due-card query; the date filter moves to the WHERE clause, which is
-- where it belonged.
CREATE INDEX IF NOT EXISTS idx_sr_state_user_due
  ON spaced_repetition_state (user_id, next_review_at ASC);

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
-- ── RLS ───────────────────────────────────────────────────────────────────────

-- ── Row-level security: deliberately NOT enabled ─────────────────────────────
-- The original file ran `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on all seven
-- tables and then declared policies as `USING (user_id = auth.uid())`.
--
-- Two reasons those statements are gone:
--
--   1. auth.uid() returns a UUID and user_id is now BIGINT. The policies cannot
--      compile.
--   2. Enabling RLS without policies is deny-all. Because the app connects as
--      the table owner it would appear to work in testing and then block every
--      read the moment anyone connects as a non-owner role -- a latent trap.
--
-- Nothing else in this database uses RLS: the baseline schema contains zero
-- ENABLE ROW LEVEL SECURITY statements and zero policies. Tenant isolation is
-- enforced in application code (firm_members lookups in middleware/rbac.js,
-- user_id predicates in the routes), which is what the 16/16 tenant-isolation
-- tests exercise.
--
-- Adding RLS as defence in depth is a worthwhile project across the whole
-- schema. Doing it for these seven tables alone would be inconsistent and would
-- give a false sense of coverage.

-- Questions: all authenticated users can read

-- ── Subject rows ─────────────────────────────────────────────────────────────
-- The seven MBE subjects the question bank (00000000000005) references by id.
-- The original file seeded only two, keyed on `code` with a generated UUID id,
-- while the question seeds reference ids like 'crim-law-001' -- so every
-- question insert failed the foreign key. Ids come from the question seeds
-- themselves; titles, colours and descriptions from 20260717000001 and
-- 20260720000007_bar_prep_subjects_update.
INSERT INTO bar_subjects (id, code, title, description, mbe_weight, color, sort_order)
VALUES
  ('crim-law-001',  'criminal_law',       'Criminal Law & Procedure',
   'Homicide, theft, defenses, 4th/5th/6th Amendment procedure, arrest, search & seizure',
   12.5, '#C9A84C', 1),
  ('con-law-001',   'constitutional_law', 'Constitutional Law',
   'Due process, equal protection, First Amendment, 14th Amendment, incorporation doctrine',
   12.5, '#1B2A6B', 2),
  ('contracts-001', 'contracts',          'Contracts & UCC',
   'Formation, consideration, performance, breach, remedies, defenses, and UCC Article 2.',
   12.5, '#2563EB', 3),
  ('civ-pro-001',   'civil_procedure',    'Civil Procedure',
   'Federal jurisdiction, pleading, discovery, summary judgment, trial, preclusion, venue, and class actions.',
   12.5, '#7C3AED', 4),
  ('evidence-001',  'evidence',           'Evidence',
   'FRE relevance, character, hearsay, exceptions, privileges, expert witnesses, and authentication.',
   12.5, '#059669', 5),
  ('real-prop-001', 'real_property',      'Real Property',
   'Estates, future interests, concurrent ownership, landlord-tenant, easements, mortgages, and recording acts.',
   12.5, '#D97706', 6),
  ('torts-001',     'torts',              'Torts',
   'Intentional torts, negligence, strict liability, products liability, defamation, and damages.',
   12.5, '#DC2626', 7)
ON CONFLICT (id) DO NOTHING;

COMMIT;
