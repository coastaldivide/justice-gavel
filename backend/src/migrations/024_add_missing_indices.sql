-- Migration 024: Add missing FK indices for high-traffic columns
-- These columns appear in WHERE clauses and JOINs on high-volume tables

CREATE INDEX IF NOT EXISTS idx_messages_recipient_id   ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_provider_id ON consultations(provider_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_recipient ON messages(sender_id, recipient_id);
CREATE INDEX IF NOT EXISTS idx_cases_user_status        ON cases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_motions_user_created     ON motions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id      ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_status  ON scheduled_pushes(status, deliver_at);
