-- 039 · Public defender channel and two-way messages (A11, ⚖ counsel questions 3.2 and 6.1,
-- PUBLIC_DEFENDER_CHANNEL_ENABLED) (Oct 27 2026). docs/PUBLIC_DEFENDER.md, docs/PUBLIC_DEFENDER_PILOT.md.
-- Idempotent.
--
-- New tables, not the firm tables: firms.owner_id is required and every firm is a law-firm
-- subscription (plan, trial, public listing, matters); a public defender office is created by
-- Justice Gavel staff before anyone in the office has an account, is billed by annual invoice
-- and texts people who are not app users. Clients are not users, so the in-app `messages`
-- table (sender_id / recipient_id = users) does not fit either; bodies are encrypted the same
-- way (services/encryption.js).
--
--   pd_offices        organisation type public_defender: name, county / state, office phone,
--                     seat count (set by a Justice Gavel admin), billing e-mail, the consent-basis
--                     statement (who ticked it and when), the office's own 90-day baseline
--   pd_staff          one row per person in an office: role admin | staff (one office per person)
--   pd_invites        e-mail invitations (hashed token, 14 days)
--   pd_clients        the office's clients: name, phone, language, case number, optional e-mail;
--                     unique per office on (phone, case number); inbox state per client
--   pd_court_dates    one or more hearings per client (status as in bd_court_dates); plan_needed =
--                     its texts must be (re)planned by the 'pd-court-reminders' job (bulk uploads)
--   pd_reminders      the texts planned per hearing (unique per hearing + number + step + day)
--   pd_messages       every text to or from a client (encrypted body), for the shared inbox
--   pd_invoices       the annual Stripe invoice per office and year (unique: idempotent)

BEGIN;

CREATE TABLE IF NOT EXISTS pd_offices (
  id                   BIGSERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  county               TEXT,
  state                TEXT NOT NULL,
  phone                TEXT,
  seat_limit           INTEGER NOT NULL DEFAULT 5 CHECK (seat_limit BETWEEN 1 AND 500),
  billing_email        TEXT,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  consent_basis_at     TIMESTAMPTZ,
  consent_basis_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  consent_basis_text   TEXT,
  pilot_start          DATE,
  baseline_from        DATE,
  baseline_to          DATE,
  baseline_hearings    INTEGER CHECK (baseline_hearings IS NULL OR baseline_hearings >= 0),
  baseline_appeared    INTEGER CHECK (baseline_appeared IS NULL OR baseline_appeared >= 0),
  baseline_missed      INTEGER CHECK (baseline_missed IS NULL OR baseline_missed >= 0),
  baseline_source      TEXT,
  baseline_set_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  baseline_set_at      TIMESTAMPTZ,
  stripe_customer_id   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE pd_offices ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_staff (
  id          BIGSERIAL PRIMARY KEY,
  office_id   BIGINT NOT NULL REFERENCES pd_offices(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  added_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_pd_staff_office ON pd_staff (office_id);
ALTER TABLE pd_staff ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_invites (
  id                BIGSERIAL PRIMARY KEY,
  office_id         BIGINT NOT NULL REFERENCES pd_offices(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  token_hash        TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  accepted_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_invites_office ON pd_invites (office_id, status);
ALTER TABLE pd_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_clients (
  id               BIGSERIAL PRIMARY KEY,
  office_id        BIGINT NOT NULL REFERENCES pd_offices(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  lang             TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'es', 'pt', 'vi')),
  case_number      TEXT NOT NULL,
  email            TEXT,
  reminders_on     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  last_texted_at   TIMESTAMPTZ,
  last_inbound_at  TIMESTAMPTZ,
  last_message_at  TIMESTAMPTZ,
  handled_at       TIMESTAMPTZ,
  handled_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- one client per office, phone and case number (case numbers compared without regard to case)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_clients_office_phone_case ON pd_clients (office_id, phone, lower(case_number));
CREATE INDEX IF NOT EXISTS idx_pd_clients_phone ON pd_clients (phone);
CREATE INDEX IF NOT EXISTS idx_pd_clients_inbox ON pd_clients (office_id, last_message_at DESC NULLS LAST);
ALTER TABLE pd_clients ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_court_dates (
  id             BIGSERIAL PRIMARY KEY,
  pd_client_id   BIGINT NOT NULL REFERENCES pd_clients(id) ON DELETE CASCADE,
  office_id      BIGINT NOT NULL REFERENCES pd_offices(id) ON DELETE CASCADE,
  court_date     DATE NOT NULL,
  court_time     TIME,
  court_name     TEXT,
  room           TEXT,
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'attended', 'missed', 'rescheduled', 'cancelled')),
  status_source  TEXT CHECK (status_source IS NULL OR status_source IN ('reply', 'office')),
  status_at      TIMESTAMPTZ,
  asked_at       TIMESTAMPTZ,
  plan_needed    BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_court_dates_client_day ON pd_court_dates (pd_client_id, court_date) WHERE deleted_at IS NULL;
ALTER TABLE pd_court_dates ADD COLUMN IF NOT EXISTS plan_needed BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_pd_court_dates_office ON pd_court_dates (office_id, court_date);
CREATE INDEX IF NOT EXISTS idx_pd_court_dates_plan ON pd_court_dates (id) WHERE plan_needed;
ALTER TABLE pd_court_dates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_messages (
  id             BIGSERIAL PRIMARY KEY,
  office_id      BIGINT NOT NULL REFERENCES pd_offices(id) ON DELETE CASCADE,
  pd_client_id   BIGINT NOT NULL REFERENCES pd_clients(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  kind           TEXT NOT NULL CHECK (kind IN ('reminder', 'ask', 'missed', 'reply_confirm', 'staff', 'inbound')),
  body           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('received', 'sent', 'failed', 'opted_out', 'skipped')),
  provider_id    TEXT,
  sent_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_messages_client ON pd_messages (pd_client_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pd_messages_unread ON pd_messages (office_id, pd_client_id) WHERE direction = 'in' AND read_at IS NULL;
ALTER TABLE pd_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_reminders (
  id             BIGSERIAL PRIMARY KEY,
  court_date_id  BIGINT NOT NULL REFERENCES pd_court_dates(id) ON DELETE CASCADE,
  pd_client_id   BIGINT NOT NULL REFERENCES pd_clients(id) ON DELETE CASCADE,
  office_id      BIGINT NOT NULL REFERENCES pd_offices(id) ON DELETE CASCADE,
  phone          TEXT NOT NULL,
  step           TEXT NOT NULL CHECK (step IN ('d7', 'd3', 'd1', 'd0', 'now', 'ask', 'missed')),
  court_day      DATE NOT NULL,
  send_at        TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'cancelled', 'failed')),
  reason         TEXT,
  claimed_at     TIMESTAMPTZ,
  sent_at        TIMESTAMPTZ,
  message_id     BIGINT REFERENCES pd_messages(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (court_date_id, phone, step, court_day)
);
CREATE INDEX IF NOT EXISTS idx_pd_reminders_due ON pd_reminders (send_at) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS idx_pd_reminders_ask ON pd_reminders (phone, sent_at DESC) WHERE step = 'ask' AND status = 'sent';
ALTER TABLE pd_reminders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_invoices (
  id                 BIGSERIAL PRIMARY KEY,
  office_id          BIGINT NOT NULL REFERENCES pd_offices(id) ON DELETE CASCADE,
  year               INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  active_clients     INTEGER NOT NULL CHECK (active_clients >= 0),
  setup_cents        BIGINT NOT NULL CHECK (setup_cents >= 0),
  per_client_cents   BIGINT NOT NULL CHECK (per_client_cents >= 0),
  amount_cents       BIGINT NOT NULL CHECK (amount_cents >= 0),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  stripe_invoice_id  TEXT,
  hosted_invoice_url TEXT,
  last_error         TEXT,
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at            TIMESTAMPTZ,
  UNIQUE (office_id, year)
);
ALTER TABLE pd_invoices ENABLE ROW LEVEL SECURITY;

COMMIT;
