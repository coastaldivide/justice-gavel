-- Compound indexes for top query patterns
-- Pattern 1: messages by conversation (most recent first)
CREATE INDEX IF NOT EXISTS idx_messages_user_created
  ON messages (user_id, created_at DESC);

-- Pattern 2: cases by user + status (dashboard query)
CREATE INDEX IF NOT EXISTS idx_cases_user_status
  ON cases (user_id, status)
  WHERE status != 'closed';

-- Pattern 3: subscriptions by user + active status
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions (user_id, status)
  WHERE status IN ('active', 'trialing', 'past_due');

-- Pattern 4: lawyers by state + specialty (search query)
CREATE INDEX IF NOT EXISTS idx_lawyers_state_specialty
  ON lawyers (state, specialty)
  WHERE verified = true;

-- Pattern 5: checkins by enrollment + date (compliance)
CREATE INDEX IF NOT EXISTS idx_checkins_enrollment_date
  ON checkins (enrollment_id, created_at DESC);

-- Pattern 6: chat messages by session (conversation view)
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages (session_id, created_at ASC);
