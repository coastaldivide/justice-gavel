-- 047 · Court papers read by AI, surety-form field suggestions, Files API registry
-- (AI step 4, Nov 2 2026; docs/AI_PLATFORM.md §11). Idempotent.
--
-- ai_files — every file this server uploaded to the Anthropic Files API (services/aiFiles.js):
--   the remote file_id, what local document it is a copy of (subject_type + subject_id), whose it
--   is, its hash, and when it expires. The remote copy is deleted when the local document or the
--   account is deleted, and by the daily `ai-files-cleanup` job (expired, orphaned, or a delete
--   that failed earlier). file_ids are never accepted from a client.
-- ai_document_reads — one row per AI read of a document (court paper, surety form): for the
--   per-person hourly / daily limits and the admin counts. No content, no file name: kind, how it
--   arrived, MIME type, size, pages, outcome.
-- court_dates — the extra lines a court paper carries (courtroom, case number, judge, what to
--   bring) and where the row came from ('paper' = read from a paper and confirmed by the person).
-- bd_form_map_suggestions — AI suggestions for which case-file value fills each fillable field of
--   an agency's surety PDF (staff set-up). Nothing is applied until a staff member accepts a field.

CREATE TABLE IF NOT EXISTS ai_files (
  id                  BIGSERIAL PRIMARY KEY,
  file_id             TEXT NOT NULL,
  subject_type        TEXT NOT NULL,           -- message_attachment | bd_form
  subject_id          BIGINT NOT NULL,
  user_id             BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- the owner (case owner / agency)
  sha256              TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL,
  expires_at          TIMESTAMPTZ,
  uses                INTEGER NOT NULL DEFAULT 0,
  last_used_at        TIMESTAMPTZ,
  delete_requested_at TIMESTAMPTZ,
  delete_reason       TEXT,
  deleted_at          TIMESTAMPTZ,
  delete_error        TEXT,
  delete_attempts     INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_files_file_id ON ai_files (file_id);
CREATE INDEX IF NOT EXISTS idx_ai_files_subject ON ai_files (subject_type, subject_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_files_live ON ai_files (expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_files_user ON ai_files (user_id);
ALTER TABLE ai_files ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ai_document_reads (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                  -- court_paper | form_mapping
  source       TEXT NOT NULL,                  -- upload | attachment | form
  mime_type    TEXT,
  size_bytes   BIGINT,
  page_count   INTEGER,
  via_file_id  BOOLEAN NOT NULL DEFAULT FALSE,
  outcome      TEXT NOT NULL DEFAULT 'started', -- started | read | not_court_paper | unreadable | failed
  error_code   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_document_reads_user ON ai_document_reads (user_id, kind, created_at DESC);
ALTER TABLE ai_document_reads ENABLE ROW LEVEL SECURITY;

ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS courtroom   TEXT;
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS case_number TEXT;
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS judge       TEXT;
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS bring       TEXT;
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS bd_form_map_suggestions (
  id           BIGSERIAL PRIMARY KEY,
  form_id      BIGINT NOT NULL REFERENCES bd_forms(id) ON DELETE CASCADE,
  agent_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'open',     -- open | done
  no_fields    BOOLEAN NOT NULL DEFAULT FALSE,
  suggestions  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ field, data_key, confidence, reason, page }]
  decisions    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { [field]: { action, data_key, by, at } }
  model        TEXT,
  via_file_id  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_form_map_suggestions_form ON bd_form_map_suggestions (form_id, created_at DESC);
ALTER TABLE bd_form_map_suggestions ENABLE ROW LEVEL SECURITY;
