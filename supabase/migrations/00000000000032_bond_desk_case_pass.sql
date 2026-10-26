-- 00000000000032_bond_desk_case_pass.sql — Bond Desk (docs/BOND_DESK.md), the one-time Case Pass,
-- and a phone-level text opt-out list. Idempotent; all money in integer cents.
BEGIN;

-- ── Case Pass: $29 one time for 90 days (routes/billing/casePass.js) ─────────────────────────
CREATE TABLE IF NOT EXISTS case_passes (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_pi_id  TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('new', 'extend')),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_passes_user ON case_passes (user_id, ends_at DESC);

-- ── Text opt-outs by phone number (STOP replies; routes/webhooks/telnyx.js) ─────────────────
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  phone       TEXT PRIMARY KEY,              -- E.164
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bond Desk ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bd_bonds (
  id                      BIGSERIAL PRIMARY KEY,
  agent_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'prospect'
                          CHECK (status IN ('prospect','active','forfeited','exonerated','surrendered','forfeiture_paid','cancelled')),
  defendant_name          TEXT NOT NULL CHECK (length(defendant_name) BETWEEN 1 AND 160),
  defendant_dob           DATE,
  defendant_phone         TEXT,
  defendant_email         TEXT,
  defendant_address       TEXT,
  case_number             TEXT,
  court_name              TEXT,
  county                  TEXT,
  state                   TEXT CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  court_date              DATE,
  charges                 TEXT,
  bond_amount_cents       BIGINT NOT NULL CHECK (bond_amount_cents > 0),
  surety_name             TEXT,
  posted_on               DATE,
  forfeited_on            DATE,
  forfeiture_deadline_on  DATE,
  discharged_on           DATE,
  forfeiture_paid_cents   BIGINT CHECK (forfeiture_paid_cents IS NULL OR forfeiture_paid_cents > 0),
  checkin_enrollment_id   BIGINT,
  notes                   TEXT,
  plan_charged_cents      BIGINT,            -- total charges when the payment plan was saved
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_bonds_agent ON bd_bonds (agent_id, status);

CREATE TABLE IF NOT EXISTS bd_indemnitors (
  id            BIGSERIAL PRIMARY KEY,
  bond_id       BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 160),
  relationship  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  dob           DATE,
  employer      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_indemnitors_bond ON bd_indemnitors (bond_id);

-- Per-agency counters for receipt numbers (R-… payments, C-… collateral). Never reused.
CREATE TABLE IF NOT EXISTS bd_counters (
  agent_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series     TEXT NOT NULL CHECK (series IN ('R', 'C')),
  last_no    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, series)
);

CREATE TABLE IF NOT EXISTS bd_charges (
  id           BIGSERIAL PRIMARY KEY,
  bond_id      BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('premium', 'fee')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  description  TEXT,
  created_by   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at    TIMESTAMPTZ,
  void_reason  TEXT,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_bd_charges_bond ON bd_charges (bond_id);

CREATE TABLE IF NOT EXISTS bd_payments (
  id           BIGSERIAL PRIMARY KEY,
  bond_id      BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  agent_id     BIGINT NOT NULL,
  receipt_no   BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','check','card','money_order','bank_transfer','other')),
  reference    TEXT,
  payer_name   TEXT NOT NULL,
  received_on  DATE NOT NULL,
  created_by   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at    TIMESTAMPTZ,
  void_reason  TEXT,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL)),
  UNIQUE (agent_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS idx_bd_payments_bond ON bd_payments (bond_id);

CREATE TABLE IF NOT EXISTS bd_installments (
  id           BIGSERIAL PRIMARY KEY,
  bond_id      BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  due_on       DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)
);
CREATE INDEX IF NOT EXISTS idx_bd_installments_bond ON bd_installments (bond_id, due_on);

CREATE TABLE IF NOT EXISTS bd_collateral (
  id            BIGSERIAL PRIMARY KEY,
  bond_id       BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  agent_id      BIGINT NOT NULL,
  receipt_no    BIGINT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('cash','real_estate','vehicle','jewelry','other')),
  description   TEXT NOT NULL,
  value_cents   BIGINT NOT NULL DEFAULT 0 CHECK (value_cents >= 0),
  received_from TEXT NOT NULL,
  received_on   DATE NOT NULL,
  returned_on   DATE,
  returned_to   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((returned_on IS NULL) = (returned_to IS NULL)),
  UNIQUE (agent_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS idx_bd_collateral_bond ON bd_collateral (bond_id);

CREATE TABLE IF NOT EXISTS bd_powers (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surety_name  TEXT NOT NULL,
  number       TEXT NOT NULL,
  limit_cents  BIGINT NOT NULL CHECK (limit_cents > 0),
  received_on  DATE NOT NULL,
  expires_on   DATE,
  status       TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','executed','void','returned')),
  bond_id      BIGINT REFERENCES bd_bonds(id) ON DELETE SET NULL,
  executed_on  DATE,
  void_reason  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, surety_name, number),
  CHECK ((status = 'executed') = (bond_id IS NOT NULL AND executed_on IS NOT NULL) OR status = 'void')
);
CREATE INDEX IF NOT EXISTS idx_bd_powers_agent ON bd_powers (agent_id, status);
-- One executed power per bond.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bd_powers_bond_executed ON bd_powers (bond_id) WHERE status = 'executed';

CREATE TABLE IF NOT EXISTS bd_forms (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  storage_key  TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  page_count   INTEGER NOT NULL,
  fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_map    JSONB NOT NULL DEFAULT '{}'::jsonb,
  roles        TEXT[] NOT NULL DEFAULT ARRAY['defendant','indemnitor'],
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_forms_agent ON bd_forms (agent_id, archived);

CREATE TABLE IF NOT EXISTS bd_packets (
  id               BIGSERIAL PRIMARY KEY,
  bond_id          BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  agent_id         BIGINT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','in_progress','completed','voided')),
  form_ids         BIGINT[] NOT NULL,
  questions        TEXT NOT NULL DEFAULT 'none' CHECK (questions IN ('none','basic','full')),
  custom_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  doc_requests     TEXT[] NOT NULL DEFAULT '{}',
  lang             TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','es','pt','vi')),   -- texts / e-mails to signers
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  voided_at        TIMESTAMPTZ,
  void_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_bd_packets_bond ON bd_packets (bond_id);
CREATE INDEX IF NOT EXISTS idx_bd_packets_agent ON bd_packets (agent_id, status);

CREATE TABLE IF NOT EXISTS bd_signers (
  id               BIGSERIAL PRIMARY KEY,
  packet_id        BIGINT NOT NULL REFERENCES bd_packets(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('defendant','indemnitor')),
  indemnitor_id    BIGINT REFERENCES bd_indemnitors(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  token_hash       TEXT NOT NULL UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','opened','in_progress','signed','declined')),
  answers          JSONB NOT NULL DEFAULT '{}'::jsonb,
  prepared_at      TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at        TIMESTAMPTZ,
  signed_at        TIMESTAMPTZ,
  typed_name       TEXT,
  sign_ip          TEXT,
  sign_user_agent  TEXT,
  consent_version  TEXT,
  declined_at      TIMESTAMPTZ,
  declined_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_bd_signers_packet ON bd_signers (packet_id);

CREATE TABLE IF NOT EXISTS bd_documents (
  id               BIGSERIAL PRIMARY KEY,
  packet_id        BIGINT NOT NULL REFERENCES bd_packets(id) ON DELETE CASCADE,
  signer_id        BIGINT NOT NULL REFERENCES bd_signers(id) ON DELETE CASCADE,
  form_id          BIGINT NOT NULL REFERENCES bd_forms(id),
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','signed')),
  prepared_key     TEXT NOT NULL,
  prepared_sha256  TEXT NOT NULL,
  viewed_at        TIMESTAMPTZ,
  signed_key       TEXT,
  signed_sha256    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signer_id, form_id)
);

CREATE TABLE IF NOT EXISTS bd_uploads (
  id            BIGSERIAL PRIMARY KEY,
  packet_id     BIGINT NOT NULL REFERENCES bd_packets(id) ON DELETE CASCADE,
  signer_id     BIGINT NOT NULL REFERENCES bd_signers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('id_front','id_back','selfie_with_id','proof_of_income','proof_of_address')),
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  sha256        TEXT NOT NULL,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_uploads_signer ON bd_uploads (signer_id);

CREATE TABLE IF NOT EXISTS bd_events (
  id          BIGSERIAL PRIMARY KEY,
  packet_id   BIGINT NOT NULL REFERENCES bd_packets(id) ON DELETE CASCADE,
  signer_id   BIGINT REFERENCES bd_signers(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_events_packet ON bd_events (packet_id, at);

-- Texts sent for an agent: 5¢ each (plans.js AGENT_TEXT_CENTS), billed on the agent's plan invoice.
CREATE TABLE IF NOT EXISTS bd_text_batches (
  id                     BIGSERIAL PRIMARY KEY,
  agent_id               BIGINT NOT NULL,
  stripe_sub_id          TEXT NOT NULL,
  texts                  INTEGER NOT NULL CHECK (texts > 0),
  amount_cents           BIGINT NOT NULL CHECK (amount_cents > 0),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','billed')),
  stripe_invoice_item_id TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billed_at              TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS bd_texts (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL,
  bond_id      BIGINT REFERENCES bd_bonds(id) ON DELETE SET NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('signing_link','payment_reminder')),
  to_masked    TEXT NOT NULL,
  provider_id  TEXT,
  cents        INTEGER NOT NULL CHECK (cents >= 0),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  batch_id     BIGINT REFERENCES bd_text_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_bd_texts_agent ON bd_texts (agent_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_bd_texts_unbilled ON bd_texts (agent_id) WHERE batch_id IS NULL;

COMMIT;
