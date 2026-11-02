-- 049 · AI platform review fixes (Nov 2 2026; docs/REVIEW_FIXES_AI_2026-11-02.md). Idempotent.
--
-- ai_batch_items.applied_at — when the kind's handler (source checks, eval, translation drafts)
--   finished with this item. A batch is marked processed only when every final item has it, so a
--   handler that fails part-way (or a restart) never loses the rest of the results: the next poll
--   hands the handler every item that is not applied yet.
-- ai_batch_items.handler_attempts / handler_error — a handler error on one item is recorded on
--   that item (the other items still go through); after AI_BATCH_HANDLER_ATTEMPTS tries the item
--   is recorded as failed (applied_at set, handler_error kept) so the batch can finish.
-- ai_batch_items.extra_input_tokens — the worst-case input a server tool may add to the request
--   (web fetch: max_uses × max_content_tokens), kept so a retry batch is checked against the
--   per-batch cap and the daily budget with the same worst case as the first batch.
-- ai_batches.handler_attempts — whole-handler failures (e.g. a database error before any item).

ALTER TABLE ai_batch_items ADD COLUMN IF NOT EXISTS applied_at         TIMESTAMPTZ;
ALTER TABLE ai_batch_items ADD COLUMN IF NOT EXISTS handler_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_batch_items ADD COLUMN IF NOT EXISTS handler_error      TEXT;
ALTER TABLE ai_batch_items ADD COLUMN IF NOT EXISTS extra_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_batches     ADD COLUMN IF NOT EXISTS handler_attempts   INTEGER NOT NULL DEFAULT 0;

-- Items that were already handled before this migration (their batch is processed) count as applied.
UPDATE ai_batch_items i SET applied_at = b.processed_at
  FROM ai_batches b
 WHERE b.id = i.batch_id AND b.status = 'processed' AND i.applied_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_batch_items_unapplied ON ai_batch_items (batch_id) WHERE applied_at IS NULL;
