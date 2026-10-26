-- 034 · State-by-state lead rules (services/leadRules.js, docs/LEAD_FEE_RULES.md) and
-- consumer products (Oct 26 2026). Idempotent.
--
--   attorney_lead_credits  a ledger: +credits for a paid pack (one row per PaymentIntent),
--                          -credits for each request the attorney chooses to answer.
--                          The balance is SUM(delta); a claim is refused if it would go below 0.
--   pi_leads.credit_entry_id / paid_with
--                          a lead claimed with credits points at its ledger row (no PaymentIntent).
--   case_passes.family     a Family Case Pass also unlocks the pass for the people who follow the case.

CREATE TABLE IF NOT EXISTS attorney_lead_credits (
  id            BIGSERIAL PRIMARY KEY,
  attorney_id   BIGINT NOT NULL,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('purchase', 'claim', 'adjustment')),
  pack          TEXT,
  amount_cents  BIGINT,
  stripe_pi_id  TEXT,
  lead_id       BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attorney_lead_credits_pi ON attorney_lead_credits (stripe_pi_id) WHERE stripe_pi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attorney_lead_credits_claim ON attorney_lead_credits (lead_id) WHERE reason = 'claim';
CREATE INDEX IF NOT EXISTS idx_attorney_lead_credits_attorney ON attorney_lead_credits (attorney_id, created_at DESC);
ALTER TABLE attorney_lead_credits ENABLE ROW LEVEL SECURITY;

ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS credit_entry_id BIGINT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS paid_with TEXT;
ALTER TABLE pi_leads DROP CONSTRAINT IF EXISTS pi_leads_paid_with_check;
ALTER TABLE pi_leads ADD CONSTRAINT pi_leads_paid_with_check CHECK (paid_with IS NULL OR paid_with IN ('card', 'credits'));

ALTER TABLE case_passes ADD COLUMN IF NOT EXISTS family BOOLEAN NOT NULL DEFAULT FALSE;
