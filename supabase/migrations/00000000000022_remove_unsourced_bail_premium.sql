-- 00000000000022_remove_unsourced_bail_premium.sql — no invented bail-agent fee
--
-- Owner rule: never present unsourced or possibly-wrong legal content as fact.
-- The seeded lesson "How Bail Works" (migration 01, lesson 9) stated that a
-- bondsman charges 10% of the bail. There is no sourced per-state premium data
-- (fees differ by agent and state, and some states regulate them), so those
-- lines are reworded to "a fee the agent sets — ask before you sign". Only the
-- three fee sentences change; the rest of the lesson is untouched.
--
-- Idempotent: replace() of text that is already gone is a no-op.
UPDATE lessons
   SET content = replace(replace(replace(content,
         '• Bail Bond: Pay bondsman 10% (non-refundable) — they guarantee the rest',
         '• Bail Bond: Pay a bondsman a fee they set (ask what it is, and whether any of it is refundable) — they guarantee the rest'),
         '1. Pay 10% to bondsman (you never get this back)',
         '1. Pay the bondsman their fee (ask what it is before you sign)'),
         '4. Even if found not guilty, bondsman keeps the 10%',
         '4. Ask whether any of the fee is refundable — get the answer in writing')
 WHERE id = 9 AND title = 'How Bail Works';
