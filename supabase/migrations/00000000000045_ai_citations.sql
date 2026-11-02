-- 045 · Verified citations in legal research and chat (Nov 2 2026; ai/citations.js,
-- services/sourcedAnswers.js, docs/AI_PLATFORM.md §8). Idempotent.
--
-- A saved answer keeps its citations so history renders exactly as it was first shown:
--   ai_answer (assistant rows)  { grounded, nothing_found, segments: [{ text, cites: [n] } | { withheld: true }],
--                                 sources: [{ n, id, kind, title, jurisdiction, year, url, publisher,
--                                 checked, app_link, also, passage }], withheld, dropped }
--                               `content` keeps the visible words only (no markers), as before.
--   ai_sent   (user rows)       { text, sources: [...] } — the exact question text and the sourced
--                               passages sent with it (search_result blocks), so a follow-up resends
--                               the same conversation (prompt-cache prefix) and later citations to
--                               earlier passages can still be verified.
-- Both are personal data of the account: deleted with the account (chat_sessions rows by user_id;
-- research_messages through the user's research_sessions — services/accountDeletion.js) and
-- included in the data export.

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS ai_answer JSONB;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS ai_sent JSONB;
ALTER TABLE research_messages ADD COLUMN IF NOT EXISTS ai_answer JSONB;
ALTER TABLE research_messages ADD COLUMN IF NOT EXISTS ai_sent JSONB;

CREATE INDEX IF NOT EXISTS idx_research_messages_session ON research_messages (session_id, created_at);
