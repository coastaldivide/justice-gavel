-- 043 · "Your case, step by step" (Nov 1 2026). docs/COURT_GUIDE.md. Idempotent.
--
--   case_steps     one row per case: the stage the person says their case is in (they set it —
--                  the app never guesses it), the checklist items they ticked (JSON
--                  { "<item id>": true }), and whether family members who already follow the case
--                  (case_family_access, given with the owner's consent) may see the stage name.
--                  Only the stage is ever shown to a follower — never the checklist.
--                  Owner only (user_id = the case owner). Deleted with the case and with the
--                  account (services/accountDeletion.js USER_REFS / CASE_CHILDREN) and exported.
--   The "Going to court" guide and each court's posted rules are content in the app and
--   backend/src/data/court_rules.js — nothing is stored for them. The court-day plan's new
--   "Clothes ready" item lives in the existing court_dates.plan JSON (migration 40).

BEGIN;

CREATE TABLE IF NOT EXISTS case_steps (
  case_id      BIGINT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage        TEXT CHECK (stage IS NULL OR stage IN
                 ('arrest', 'release', 'first', 'lawyer', 'pretrial', 'plea', 'sentence', 'probation', 'record')),
  checked      JSONB NOT NULL DEFAULT '{}'::jsonb,
  share_stage  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_steps_user ON case_steps (user_id);
ALTER TABLE case_steps ENABLE ROW LEVEL SECURITY;

COMMIT;
