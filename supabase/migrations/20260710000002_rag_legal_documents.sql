-- ============================================================================
-- Migration: RAG Legal Documents Store
-- Enables pgvector for semantic search over federal statutes + case summaries
-- Replaces: raw Claude queries with retrieval-augmented generation
-- ============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Legal documents table (chunked for embedding) ──────────────────────────
CREATE TABLE IF NOT EXISTS legal_documents (
  id             BIGSERIAL PRIMARY KEY,
  doc_type       TEXT NOT NULL,   -- 'statute' | 'case_summary' | 'regulation' | 'definition'
  citation       TEXT NOT NULL,   -- '18 U.S.C. § 924(c)' | 'United States v. Jones, 565 U.S. 400'
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,   -- the actual text chunk (max 2,000 tokens)
  jurisdiction   TEXT,            -- 'federal' | 'CA' | 'NY' | 'TX' etc.
  practice_area  TEXT,            -- 'criminal' | 'immigration' | 'civil_rights' | 'bail'
  year           INTEGER,         -- year of case / statute last amended
  embedding      vector(1536),    -- OpenAI ada-002 OR Supabase gte-small (512-dim)
  token_count    INTEGER,
  source_url     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Search function: hybrid (semantic + keyword) ───────────────────────────
CREATE OR REPLACE FUNCTION search_legal_docs(
  query_embedding vector(1536),
  query_text      TEXT,
  practice_filter TEXT   DEFAULT NULL,
  juris_filter    TEXT   DEFAULT NULL,
  match_count     INTEGER DEFAULT 8
)
RETURNS TABLE (
  id            BIGINT,
  citation      TEXT,
  title         TEXT,
  content       TEXT,
  practice_area TEXT,
  jurisdiction  TEXT,
  year          INTEGER,
  source_url    TEXT,
  similarity    FLOAT,
  rank          FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    d.id,
    d.citation,
    d.title,
    d.content,
    d.practice_area,
    d.jurisdiction,
    d.year,
    d.source_url,
    1 - (d.embedding <=> query_embedding)                          AS similarity,
    ts_rank(to_tsvector('english', d.content || ' ' || d.title),
            plainto_tsquery('english', query_text))                AS rank
  FROM legal_documents d
  WHERE (practice_filter IS NULL OR d.practice_area = practice_filter)
    AND (juris_filter    IS NULL OR d.jurisdiction  = juris_filter  OR d.jurisdiction = 'federal')
  ORDER BY
    (1 - (d.embedding <=> query_embedding)) * 0.7 +
    ts_rank(to_tsvector('english', d.content || ' ' || d.title),
            plainto_tsquery('english', query_text))    * 0.3  DESC
  LIMIT match_count;
$$;

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_legal_docs_embedding
  ON legal_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_legal_docs_fts
  ON legal_documents USING gin(to_tsvector('english', content || ' ' || title));
CREATE INDEX IF NOT EXISTS idx_legal_docs_practice
  ON legal_documents(practice_area);
CREATE INDEX IF NOT EXISTS idx_legal_docs_jurisdiction
  ON legal_documents(jurisdiction);

-- ── Query log (track what users research, improve over time) ──────────────
CREATE TABLE IF NOT EXISTS research_queries (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  query_text     TEXT NOT NULL,
  practice_area  TEXT,
  docs_retrieved INTEGER,
  latency_ms     INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Supabase Storage: video_sessions table + docket_entries storage_path column
-- ============================================================================

-- Add storage_path to docket_entries if not present
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS storage_path   TEXT;
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS content_type   TEXT;

-- Video sessions table (for Daily.co sessions)
CREATE TABLE IF NOT EXISTS video_sessions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT REFERENCES users(id) ON DELETE CASCADE,
  matter_id        BIGINT REFERENCES matters(id) ON DELETE SET NULL,
  attorney_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  daily_room_name  TEXT NOT NULL UNIQUE,
  daily_room_url   TEXT NOT NULL,
  topic            TEXT,
  scheduled_for    TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE video_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_video_sessions_user   ON video_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_video_sessions_matter ON video_sessions(matter_id);
