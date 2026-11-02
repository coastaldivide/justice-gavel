-- 048 · Long chats keep working (a per-conversation recap) and Word / PDF downloads of drafts
-- (AI step 5, Nov 2 2026; docs/AI_PLATFORM.md §12). Idempotent.
--
-- ai_conversation_memory — "What the assistant remembers about this chat": when a conversation
--   grows past AI_MEMORY_THRESHOLD_TOKENS, its older turns are summarised (services/conversationMemory.js)
--   into a short recap of what the PERSON said (case stage, places, dates, what they asked) —
--   never legal claims (made from the person's own messages only; legal content still comes only
--   from cited sources). One row per conversation: kind 'chat' (consumer + defender chat,
--   conversation_key = the chat session id) or 'research' (conversation_key = research_sessions.id).
--   covered_until / covered_rows: the turns the recap replaces (they are no longer sent).
--   forgotten = the person deleted the recap: nothing is summarised again for that conversation.
--   Removed with the chat / research session and with the account.
-- draft_documents — a draft the person can download as Word / PDF (an expungement petition):
--   the checked draft text (unsourced legal references withheld), the person's own typed fields,
--   the sources it cites. Kept so the download is the draft that was shown; capped per person.

CREATE TABLE IF NOT EXISTS ai_conversation_memory (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('chat', 'research')),
  conversation_key TEXT NOT NULL,
  recap            JSONB,
  lang             TEXT,
  covered_until    TIMESTAMPTZ,
  covered_rows     INTEGER NOT NULL DEFAULT 0,
  tokens_before    INTEGER,
  forgotten        BOOLEAN NOT NULL DEFAULT FALSE,
  updates          INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_conversation_memory ON ai_conversation_memory (user_id, kind, conversation_key);
ALTER TABLE ai_conversation_memory ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS draft_documents (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('expungement_petition')),
  title       TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  state       TEXT,
  fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft       TEXT NOT NULL,
  sources     JSONB NOT NULL DEFAULT '[]'::jsonb,
  withheld    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_draft_documents_user ON draft_documents (user_id, created_at DESC);
ALTER TABLE draft_documents ENABLE ROW LEVEL SECURITY;
