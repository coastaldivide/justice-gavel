-- 008_outbound_bot.sql
-- Outbound bot: messages sent, replies, opt-outs, payment links, revenue log

-- Every outbound message sent (SMS or email)
CREATE TABLE IF NOT EXISTS outbound_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type    TEXT NOT NULL,          -- 'bondsman' | 'attorney'
  recipient_id      INTEGER,               -- lawyers.id or bail_agents.id
  recipient_phone   TEXT,
  recipient_email   TEXT,
  channel           TEXT NOT NULL,          -- 'sms' | 'email'
  arrest_id         INTEGER,
  message_type      TEXT NOT NULL,          -- 'lead_offer' | 'payment_link' | 'lead_delivery' | 'opt_out_confirm' | 'weekly_intel'
  body              TEXT,
  status            TEXT DEFAULT 'sent',    -- 'sent' | 'delivered' | 'failed' | 'bounced'
  twilio_sid        TEXT,
  sendgrid_id       TEXT,
  idempotency_key   TEXT UNIQUE,           -- prevents duplicate sends
  sent_at           TEXT DEFAULT (datetime('now')),
  error_msg         TEXT
);
CREATE INDEX IF NOT EXISTS idx_om_recipient  ON outbound_messages(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_om_arrest     ON outbound_messages(arrest_id);
CREATE INDEX IF NOT EXISTS idx_om_idem       ON outbound_messages(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_om_sent       ON outbound_messages(sent_at);

-- Inbound replies parsed from Twilio webhooks
CREATE TABLE IF NOT EXISTS inbound_replies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  from_phone        TEXT NOT NULL,
  body              TEXT,
  intent            TEXT,                  -- 'yes' | 'no' | 'stop' | 'unknown'
  original_message_id INTEGER,            -- outbound_messages.id
  arrest_id         INTEGER,
  payment_link_url  TEXT,
  payment_link_id   TEXT,                 -- Stripe payment link id
  payment_link_sent INTEGER DEFAULT 0,
  processed         INTEGER DEFAULT 0,
  received_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ir_phone ON inbound_replies(from_phone);
CREATE INDEX IF NOT EXISTS idx_ir_proc  ON inbound_replies(processed);

-- TCPA opt-out registry — check before every send
CREATE TABLE IF NOT EXISTS opt_outs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  phone        TEXT UNIQUE,
  email        TEXT,
  reason       TEXT DEFAULT 'STOP',       -- 'STOP' | 'manual' | 'bounce' | 'complaint'
  opted_out_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oo_phone ON opt_outs(phone);
CREATE INDEX IF NOT EXISTS idx_oo_email ON opt_outs(email);

-- Stripe payment links issued (one per lead offer reply)
CREATE TABLE IF NOT EXISTS payment_links (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_link_id    TEXT UNIQUE,
  stripe_link_url   TEXT,
  arrest_id         INTEGER,
  recipient_phone   TEXT,
  recipient_type    TEXT,
  recipient_id      INTEGER,
  amount_cents      INTEGER,
  status            TEXT DEFAULT 'pending', -- 'pending' | 'paid' | 'expired' | 'cancelled'
  expires_at        TEXT,
  paid_at           TEXT,
  stripe_pi_id      TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pl_stripe   ON payment_links(stripe_link_id);
CREATE INDEX IF NOT EXISTS idx_pl_arrest   ON payment_links(arrest_id);
CREATE INDEX IF NOT EXISTS idx_pl_phone    ON payment_links(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_pl_status   ON payment_links(status);

-- Full revenue audit log
CREATE TABLE IF NOT EXISTS revenue_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,           -- 'lead_sale' | 'subscription' | 'family_connect' | 'intel_report'
  recipient_type  TEXT,
  recipient_id    INTEGER,
  arrest_id       INTEGER,
  gross_cents     INTEGER,
  stripe_fee_cents INTEGER,
  net_cents       INTEGER,
  stripe_pi_id    TEXT,
  stripe_link_id  TEXT,
  recorded_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rl_source  ON revenue_log(source);
CREATE INDEX IF NOT EXISTS idx_rl_date    ON revenue_log(recorded_at);

-- Bot run log — every execution recorded
CREATE TABLE IF NOT EXISTS bot_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type        TEXT,                    -- 'nightly' | 'manual' | 'reply_handler'
  arrests_found   INTEGER DEFAULT 0,
  messages_sent   INTEGER DEFAULT 0,
  replies_yes     INTEGER DEFAULT 0,
  replies_no      INTEGER DEFAULT 0,
  opt_outs        INTEGER DEFAULT 0,
  leads_sold      INTEGER DEFAULT 0,
  revenue_cents   INTEGER DEFAULT 0,
  errors          TEXT DEFAULT '[]',
  started_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT,
  duration_ms     INTEGER
);
