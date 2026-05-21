-- Reviews table for attorney and bail agent ratings
-- Lives in providers.sqlite (see reviews.js route)
CREATE TABLE IF NOT EXISTS reviews (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type  TEXT NOT NULL,
    entity_id    INTEGER NOT NULL,
    user_id      INTEGER,
    rating       INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    body         TEXT,
    verified     INTEGER DEFAULT 0,
    helpful      INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_entity ON reviews(entity_type, entity_id);
