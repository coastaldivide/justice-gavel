-- 037 · Bond Desk: card payments for agencies (Stripe Connect Express), automatic payment-plan
-- collection (A5, ⚖ counsel 3.2), the "Pay {agency}" link (B2), forms set up for the agency,
-- CSV import of open bonds, export (A12), staff seats (B8). October 27 2026. Idempotent.
-- docs/BOND_DESK.md ("Card payments", "Automatic payments", "Pay link", "Staff", "Import / export").
--
--   bd_connect_accounts     the agency's Stripe Express account (one per agent). Payers pay the
--                           agency directly (direct charges on the connected account); the flags
--                           are copied from Stripe's account.updated webhook.
--   bd_autopay              a payer's saved card for a bond's payment plan: Stripe customer + payment
--                           method ids on the agency's account (never card numbers; brand + last 4
--                           for display) and the consent snapshot (text, version, language, IP,
--                           browser, time). The personal link is stored as SHA-256 only.
--   bd_autopay_attempts     every automatic charge: one row per installment and attempt (1, then a
--                           retry 3 days later); idempotency key bd-inst-<installment>-<attempt>
--   bd_pay_requests         money paid on the agency's public pay page before a bond exists; the
--                           agent attaches it to a bond, which posts it to bd_payments once
--   bd_payments.stripe_pi_id  a card payment is posted at most once (webhook replays, job + webhook)
--   bd_payments.source      'manual' | 'autopay' | 'pay_link'
--   bd_charges.source       'import' for the opening balance of an imported bond
--   bd_bonds.imported_*     the premium stated in an imported CSV (the ledger carries only the balance)
--   bd_setup_requests       "set up my forms for me": the agency uploads its surety PDFs, staff map
--                           them with the forms tool, then hand them over (forms hidden until ready)
--   bd_staff / bd_staff_invites  people who work in an agency's Bond Desk (seats per plan)

BEGIN;

CREATE TABLE IF NOT EXISTS bd_connect_accounts (
  agent_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id  TEXT NOT NULL UNIQUE,
  charges_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  details_submitted  BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_reason    TEXT,
  fees_ack_at        TIMESTAMPTZ NOT NULL,              -- the agency read "Stripe's fee is yours, plus 99¢ per automatic payment"
  pay_slug           TEXT UNIQUE CHECK (pay_slug IS NULL OR pay_slug ~ '^[a-z0-9]{10,32}$'),
  pay_link_on        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bd_autopay (
  id                        BIGSERIAL PRIMARY KEY,
  bond_id                   BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  agent_id                  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                    TEXT NOT NULL DEFAULT 'link_sent' CHECK (status IN ('link_sent','active','stopped')),
  payer_role                TEXT NOT NULL CHECK (payer_role IN ('defendant','indemnitor')),
  indemnitor_id             BIGINT REFERENCES bd_indemnitors(id) ON DELETE SET NULL,
  payer_name                TEXT NOT NULL CHECK (length(payer_name) BETWEEN 1 AND 160),
  payer_phone               TEXT,
  payer_email               TEXT,
  sms_consent_at            TIMESTAMPTZ,                -- the agent confirmed the number is for texts about this bond
  lang                      TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','es','pt','vi')),
  token_hash                TEXT NOT NULL UNIQUE,
  link_expires_at           TIMESTAMPTZ NOT NULL,       -- for saving a card; an active link keeps working to stop / confirm
  stripe_account_id         TEXT NOT NULL,
  stripe_customer_id        TEXT,
  stripe_payment_method_id  TEXT,
  card_brand                TEXT,
  card_last4                TEXT CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  setup_session_id          TEXT,
  consent_text              TEXT,
  consent_version           TEXT,
  consent_lang              TEXT,
  consent_ip                TEXT,
  consent_user_agent        TEXT,
  consent_at                TIMESTAMPTZ,
  consent_schedule          JSONB,                      -- [{ due_on, amount_cents }] the payer agreed to; only these are charged
  activated_at              TIMESTAMPTZ,
  stopped_at                TIMESTAMPTZ,
  stopped_by                TEXT CHECK (stopped_by IS NULL OR stopped_by IN ('payer','agent','system')),
  stop_reason               TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'active' OR (stripe_customer_id IS NOT NULL AND stripe_payment_method_id IS NOT NULL AND consent_at IS NOT NULL))
);
ALTER TABLE bd_autopay ADD COLUMN IF NOT EXISTS consent_schedule JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bd_autopay_open ON bd_autopay (bond_id) WHERE status IN ('link_sent','active');
CREATE INDEX IF NOT EXISTS idx_bd_autopay_agent ON bd_autopay (agent_id, status);

CREATE TABLE IF NOT EXISTS bd_autopay_attempts (
  id                BIGSERIAL PRIMARY KEY,
  autopay_id        BIGINT NOT NULL REFERENCES bd_autopay(id) ON DELETE CASCADE,
  bond_id           BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  installment_id    BIGINT NOT NULL,                    -- bd_installments.id when charged (a replaced plan deletes the row)
  due_on            DATE NOT NULL,
  attempt           SMALLINT NOT NULL CHECK (attempt IN (1, 2)),
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents         INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  idempotency_key   TEXT NOT NULL UNIQUE,
  stripe_pi_id      TEXT UNIQUE,
  action_session_id TEXT UNIQUE,                        -- Checkout session the payer used to confirm with their bank
  status            TEXT NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing','succeeded','failed','action_needed','cancelled')),
  failure_code      TEXT,
  failure_message   TEXT,
  retry_on          DATE,
  payment_id        BIGINT REFERENCES bd_payments(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installment_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_bd_autopay_attempts_bond ON bd_autopay_attempts (bond_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bd_autopay_attempts_retry ON bd_autopay_attempts (retry_on) WHERE status = 'failed' AND attempt = 1;

CREATE TABLE IF NOT EXISTS bd_pay_requests (
  id                   BIGSERIAL PRIMARY KEY,
  agent_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','paid','attached','expired')),
  amount_cents         BIGINT NOT NULL CHECK (amount_cents BETWEEN 100 AND 5000000),
  payer_name           TEXT NOT NULL CHECK (length(payer_name) BETWEEN 1 AND 160),
  payer_phone          TEXT,
  payer_email          TEXT,
  defendant_name       TEXT NOT NULL CHECK (length(defendant_name) BETWEEN 1 AND 160),
  receipt_sms_ok       BOOLEAN NOT NULL DEFAULT FALSE,
  lang                 TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','es','pt','vi')),
  stripe_account_id    TEXT NOT NULL,
  checkout_session_id  TEXT UNIQUE,
  stripe_pi_id         TEXT UNIQUE,
  ip                   TEXT,
  paid_at              TIMESTAMPTZ,
  bond_id              BIGINT REFERENCES bd_bonds(id) ON DELETE SET NULL,
  payment_id           BIGINT REFERENCES bd_payments(id) ON DELETE SET NULL,
  attached_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (payer_phone IS NOT NULL OR payer_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_bd_pay_requests_agent ON bd_pay_requests (agent_id, status, created_at DESC);

ALTER TABLE bd_payments ADD COLUMN IF NOT EXISTS stripe_pi_id TEXT;
ALTER TABLE bd_payments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE bd_payments DROP CONSTRAINT IF EXISTS bd_payments_source_check;
ALTER TABLE bd_payments ADD CONSTRAINT bd_payments_source_check CHECK (source IN ('manual','autopay','pay_link'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_bd_payments_stripe_pi ON bd_payments (stripe_pi_id) WHERE stripe_pi_id IS NOT NULL;

ALTER TABLE bd_charges ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE bd_bonds ADD COLUMN IF NOT EXISTS imported_premium_cents BIGINT;
ALTER TABLE bd_bonds DROP CONSTRAINT IF EXISTS bd_bonds_imported_premium_check;
ALTER TABLE bd_bonds ADD CONSTRAINT bd_bonds_imported_premium_check CHECK (imported_premium_cents IS NULL OR imported_premium_cents >= 0);
ALTER TABLE bd_bonds ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

-- ── Forms set up for the agency ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bd_setup_requests (
  id            BIGSERIAL PRIMARY KEY,
  agent_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_progress','ready','cancelled')),
  note          TEXT CHECK (note IS NULL OR length(note) <= 1000),
  staff_note    TEXT CHECK (staff_note IS NULL OR length(staff_note) <= 1000),
  handled_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ,
  ready_at      TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_setup_requests_status ON bd_setup_requests (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bd_setup_requests_open ON bd_setup_requests (agent_id) WHERE status IN ('requested','in_progress');

ALTER TABLE bd_forms ADD COLUMN IF NOT EXISTS setup_request_id BIGINT REFERENCES bd_setup_requests(id) ON DELETE SET NULL;
ALTER TABLE bd_forms ADD COLUMN IF NOT EXISTS setup_pending BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Staff (seats per plan) ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bd_staff (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff')),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id <> owner_id)
);
CREATE INDEX IF NOT EXISTS idx_bd_staff_owner ON bd_staff (owner_id);

CREATE TABLE IF NOT EXISTS bd_staff_invites (
  id                BIGSERIAL PRIMARY KEY,
  owner_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email             TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  token_hash        TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  expires_at        TIMESTAMPTZ NOT NULL,
  accepted_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bd_staff_invites_pending ON bd_staff_invites (owner_id, lower(email)) WHERE status = 'pending';

-- bd_texts.purpose: add the payment texts to whatever the constraint allows now (other
-- migrations may have added purposes of their own — keep them all).
DO $$
DECLARE
  def  TEXT;
  vals TEXT[];
  v    TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.bd_texts'::regclass AND conname = 'bd_texts_purpose_check';
  vals := ARRAY[]::TEXT[];
  IF def IS NOT NULL THEN
    SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(def, '([a-z][a-z_]*)', 'g') AS m
     WHERE m[1] NOT IN ('purpose', 'text');
  END IF;
  FOREACH v IN ARRAY ARRAY['signing_link', 'payment_reminder', 'autopay_link', 'autopay_failed', 'autopay_action', 'payment_receipt'] LOOP
    IF NOT (v = ANY (COALESCE(vals, ARRAY[]::TEXT[]))) THEN vals := array_append(vals, v); END IF;
  END LOOP;
  ALTER TABLE bd_texts DROP CONSTRAINT IF EXISTS bd_texts_purpose_check;
  EXECUTE format('ALTER TABLE bd_texts ADD CONSTRAINT bd_texts_purpose_check CHECK (purpose = ANY (%L::text[]))', vals);
END $$;

COMMIT;
