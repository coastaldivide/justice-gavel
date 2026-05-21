-- Create courthouses table for all 404 cities in the provider database
CREATE TABLE IF NOT EXISTS courthouses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    city        TEXT NOT NULL,
    state       TEXT NOT NULL,
    name        TEXT NOT NULL,
    address     TEXT NOT NULL,
    phone       TEXT,
    hours       TEXT DEFAULT 'Mon-Fri 8:30am-4:30pm',
    lat         REAL,
    lng         REAL,
    court_type  TEXT DEFAULT 'Criminal',
    county      TEXT,
    url         TEXT,
    notes       TEXT,
    verified    INTEGER DEFAULT 1,
    created_at  TEXT,
    updated_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_courthouse_city  ON courthouses(city, state);
CREATE INDEX IF NOT EXISTS idx_courthouse_state ON courthouses(state);
