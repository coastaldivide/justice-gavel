-- 027 · Section G (pro dashboards, payments, admin): payment ids are unique, so a
-- confirm call and a webhook replay can never record or credit a purchase twice;
-- bail-lead CRM fields; case-lead reservation while the attorney pays; new-arrest
-- alerts for bail-agent plans; attorney availability on the attorney's own profile
-- (directory rows stay read-only). Idempotent.

-- ── Bail leads ────────────────────────────────────────────────────────────────
ALTER TABLE lead_purchases ADD COLUMN IF NOT EXISTS crm_status   TEXT NOT NULL DEFAULT 'new';
ALTER TABLE lead_purchases ADD COLUMN IF NOT EXISTS crm_notes    TEXT;
ALTER TABLE lead_purchases ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
ALTER TABLE lead_purchases DROP CONSTRAINT IF EXISTS lead_purchases_crm_status_check;
ALTER TABLE lead_purchases ADD CONSTRAINT lead_purchases_crm_status_check
  CHECK (crm_status IN ('new', 'contacted', 'bonded', 'closed'));

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_purchases_pi ON lead_purchases (stripe_pi_id)
    WHERE stripe_pi_id IS NOT NULL AND stripe_pi_id <> '' AND stripe_pi_id NOT LIKE 'pi_mock%';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'uq_lead_purchases_pi not created: duplicate payment ids exist';
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_purchases_owner ON lead_purchases (bondsman_id, arrest_id)
    WHERE status = 'charged' AND stripe_pi_id IS NOT NULL AND stripe_pi_id NOT LIKE 'pi_mock%';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'uq_lead_purchases_owner not created: duplicate purchases exist';
END $$;

-- ── Case leads (PI / civil rights / employment / ICE) ─────────────────────────
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS stripe_pi_id   TEXT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_leads_pi ON pi_leads (stripe_pi_id) WHERE stripe_pi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pi_leads_status_state ON pi_leads (status, state, created_at DESC);

-- ── Subscriptions: one row per Stripe subscription ────────────────────────────
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_stripe_sub ON subscriptions (stripe_sub_id)
    WHERE stripe_sub_id IS NOT NULL AND stripe_sub_id NOT LIKE 'sub_mock%';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'uq_subscriptions_stripe_sub not created: duplicates exist';
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_bondsman_subscriptions_stripe_sub ON bondsman_subscriptions (stripe_sub_id)
    WHERE stripe_sub_id IS NOT NULL AND stripe_sub_id NOT LIKE 'sub_mock%';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'uq_bondsman_subscriptions_stripe_sub not created: duplicates exist';
END $$;
CREATE INDEX IF NOT EXISTS idx_bondsman_subscriptions_user ON bondsman_subscriptions (user_id, status);
-- A checkout starts as 'incomplete' and takes Stripe's status once it is paid for.
ALTER TABLE bondsman_subscriptions DROP CONSTRAINT IF EXISTS bondsman_subscriptions_status_check;
ALTER TABLE bondsman_subscriptions ADD CONSTRAINT bondsman_subscriptions_status_check
  CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'cancelled'));

-- ── New-arrest alerts for bail-agent plans (services/leadAlerts.js) ───────────
CREATE TABLE IF NOT EXISTS lead_alert_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  arrest_id  BIGINT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, arrest_id)
);
ALTER TABLE lead_alert_log ENABLE ROW LEVEL SECURITY;

-- ── Attorney availability lives on the attorney's own profile ─────────────────
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS availability_note TEXT;
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_attorney_profiles_user ON attorney_profiles (user_id) WHERE user_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'uq_attorney_profiles_user not created: duplicates exist';
END $$;

-- ── Conflict checks read a firm's whole index ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conflict_index_firm_id ON conflict_index (firm_id);
CREATE INDEX IF NOT EXISTS idx_matter_parties_firm_id ON matter_parties (firm_id);

-- ── Direct messages (bulk outreach to attorneys): read state for the inbox ────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_recipient_created ON messages (recipient_id, created_at DESC);
