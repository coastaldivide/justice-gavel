-- ─────────────────────────────────────────────────────────────────────────────
-- 00000000000013_reminders_reviews_feedback.sql — step 11 functional fixes
--
-- 1. Court-date reminders (audit11 H11)
--    · users.timezone: the IANA zone the app reports (X-Timezone / POST
--      /api/push/timezone). Reminders fire at local wall-clock times in it.
--    · scheduled_pushes.push_token becomes nullable: the device token is
--      resolved at SEND time from push_tokens (a user may register a device
--      after the reminder was planned, or have none and get email instead).
--      Every insert that passed a NULL token used to fail silently.
--    · channel / dedupe_key / claimed_at for the dispatcher
--      (services/reminderDispatcher.js): which channel delivered, an id for the
--      reminder slot, and the multi-process claim timestamp.
--    · Legacy pending rows: court reminders written by the old code (server-
--      local 08:00, paid tiers only) are superseded — the dispatcher's backfill
--      re-plans every open case with a future court date in the user's zone.
--      Old marketing / expungement nudges get their notification_type so the
--      dispatcher applies the right opt-in; anything more than a day overdue
--      is expired rather than delivered late (nothing ever delivered them).
--
-- 2. Reviews (audit11 M2): `verified` is recomputed from real relationships
--    (a consultation that took place, or a case assignment). The old code
--    stamped every review verified=1. One review per (user, entity_type,
--    entity_id) — the old unique key on (provider_id, user_id) wrongly made a
--    lawyer review and a bail-agent review with the same numeric id collide.
--    lawyers / bail_agents rows are NOT touched.
--
-- Idempotent: IF [NOT] EXISTS guards, and every UPDATE is a no-op on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Reminders ─────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;

ALTER TABLE scheduled_pushes ALTER COLUMN push_token DROP NOT NULL;
ALTER TABLE scheduled_pushes ADD COLUMN IF NOT EXISTS channel    TEXT;
ALTER TABLE scheduled_pushes ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE scheduled_pushes ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Dispatcher scan: due pending rows in deliver_at order.
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_due
  ON scheduled_pushes (deliver_at)
  WHERE status = 'pending';

-- Per-case court reminder lookups (reschedule / cancel / list / backfill).
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_case_type
  ON scheduled_pushes (case_id, notification_type, status);

-- Legacy court reminders (old cases.js: data {"screen":"CasesTab","case_id":N},
-- notification_type left at the 'reminder' default) → superseded.
UPDATE scheduled_pushes
   SET status = 'cancelled', error = 'superseded_v13'
 WHERE status = 'pending'
   AND COALESCE(notification_type, 'reminder') = 'reminder'
   AND dedupe_key IS NULL
   AND data LIKE '%"screen":"CasesTab"%'
   AND data LIKE '%"case_id"%';

-- Legacy expungement nudges (cases.js triggerExpungementPush).
UPDATE scheduled_pushes
   SET notification_type = 'expungement'
 WHERE COALESCE(notification_type, 'reminder') = 'reminder'
   AND dedupe_key IS NULL
   AND data LIKE '%"screen":"Expungement"%'
   AND data LIKE '%"case_id"%';

-- Legacy engagement nudges (push.js d7-reengage / retention/post-purchase).
UPDATE scheduled_pushes
   SET notification_type = 'engagement'
 WHERE COALESCE(notification_type, 'reminder') = 'reminder'
   AND dedupe_key IS NULL
   AND case_id IS NULL
   AND (data LIKE '%"screen":"Expungement"%'
     OR data LIKE '%"screen":"ConsumerSubscription"%'
     OR data LIKE '%"screen":"CasesTab"%');

-- Never-delivered rows that are more than a day overdue are expired, not sent late.
UPDATE scheduled_pushes
   SET status = 'expired', error = 'expired_v13'
 WHERE status = 'pending'
   AND deliver_at < NOW() - INTERVAL '1 day';

-- ── 2. Reviews ───────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS uq_reviews_provider_user;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS uq_reviews_provider_user;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_user_entity
  ON reviews (user_id, entity_type, entity_id);

-- verified = a real, app-recorded relationship (same rule as
-- routes/reviews.js hasVerifiedRelationship).
UPDATE reviews r
   SET verified = CASE WHEN (
         (r.entity_type = 'lawyer' AND (
              EXISTS (SELECT 1 FROM consultation_bookings cb
                       WHERE cb.user_id = r.user_id AND cb.lawyer_id = r.entity_id
                         AND (cb.status = 'completed'
                              OR (cb.status = 'confirmed' AND cb.date_slot < CURRENT_DATE)))
           OR EXISTS (SELECT 1 FROM consultations co
                       WHERE co.user_id = r.user_id AND co.lawyer_id = r.entity_id AND co.status = 'completed')
           OR EXISTS (SELECT 1 FROM case_assignments ca
                        JOIN cases c   ON c.id = ca.case_id
                        JOIN lawyers l ON l.id = r.entity_id
                        LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
                       WHERE c.user_id = r.user_id AND ca.status IN ('active','completed','closed')
                         AND ca.defender_id = COALESCE(l.user_id, ap.user_id))))
      OR (r.entity_type = 'attorney' AND (
              EXISTS (SELECT 1 FROM case_assignments ca JOIN cases c ON c.id = ca.case_id
                       WHERE c.user_id = r.user_id AND ca.defender_id = r.entity_id
                         AND ca.status IN ('active','completed','closed'))
           OR EXISTS (SELECT 1 FROM consultation_bookings cb
                        JOIN lawyers l ON l.id = cb.lawyer_id
                        LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
                       WHERE cb.user_id = r.user_id AND COALESCE(l.user_id, ap.user_id) = r.entity_id
                         AND (cb.status = 'completed'
                              OR (cb.status = 'confirmed' AND cb.date_slot < CURRENT_DATE)))))
       ) THEN 1 ELSE 0 END
 WHERE r.verified IS DISTINCT FROM (CASE WHEN (
         (r.entity_type = 'lawyer' AND (
              EXISTS (SELECT 1 FROM consultation_bookings cb
                       WHERE cb.user_id = r.user_id AND cb.lawyer_id = r.entity_id
                         AND (cb.status = 'completed'
                              OR (cb.status = 'confirmed' AND cb.date_slot < CURRENT_DATE)))
           OR EXISTS (SELECT 1 FROM consultations co
                       WHERE co.user_id = r.user_id AND co.lawyer_id = r.entity_id AND co.status = 'completed')
           OR EXISTS (SELECT 1 FROM case_assignments ca
                        JOIN cases c   ON c.id = ca.case_id
                        JOIN lawyers l ON l.id = r.entity_id
                        LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
                       WHERE c.user_id = r.user_id AND ca.status IN ('active','completed','closed')
                         AND ca.defender_id = COALESCE(l.user_id, ap.user_id))))
      OR (r.entity_type = 'attorney' AND (
              EXISTS (SELECT 1 FROM case_assignments ca JOIN cases c ON c.id = ca.case_id
                       WHERE c.user_id = r.user_id AND ca.defender_id = r.entity_id
                         AND ca.status IN ('active','completed','closed'))
           OR EXISTS (SELECT 1 FROM consultation_bookings cb
                        JOIN lawyers l ON l.id = cb.lawyer_id
                        LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
                       WHERE cb.user_id = r.user_id AND COALESCE(l.user_id, ap.user_id) = r.entity_id
                         AND (cb.status = 'completed'
                              OR (cb.status = 'confirmed' AND cb.date_slot < CURRENT_DATE)))))
       ) THEN 1 ELSE 0 END);
