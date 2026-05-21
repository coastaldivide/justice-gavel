-- Migration 025: refund_requests table
-- Stores all refund requests for FTC compliance and dispute resolution audit trail.

CREATE TABLE IF NOT EXISTS refund_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  subscription_id   INTEGER,
  stripe_sub_id     TEXT,
  stripe_refund_id  TEXT,
  reason            TEXT NOT NULL,          -- billing_error | unsatisfied | accidental | duplicate | other
  additional_info   TEXT,
  days_since_charge REAL,
  auto_approve      INTEGER DEFAULT 0,       -- 1 = eligible for automatic processing
  status            TEXT DEFAULT 'pending_review',
                                             -- pending_review | pending_stripe | refunded | denied
  admin_notes       TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  resolved_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_user_id ON refund_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status  ON refund_requests(status);
