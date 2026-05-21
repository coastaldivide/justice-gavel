-- Specialty courts: Veterans Treatment Courts, Drug Courts, Mental Health Courts
CREATE TABLE IF NOT EXISTS specialty_courts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    court_type  TEXT NOT NULL,
    city        TEXT NOT NULL,
    state       TEXT NOT NULL,
    county      TEXT,
    address     TEXT,
    phone       TEXT,
    url         TEXT,
    judge       TEXT,
    eligibility TEXT,
    notes       TEXT,
    lat         REAL,
    lng         REAL,
    verified    INTEGER DEFAULT 1,
    created_at  TEXT,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sc_state ON specialty_courts(state, court_type);
CREATE INDEX IF NOT EXISTS idx_sc_city  ON specialty_courts(city, state);
