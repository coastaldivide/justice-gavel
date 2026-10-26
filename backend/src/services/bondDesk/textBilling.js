/**
 * services/bondDesk/textBilling.js — bill the texts sent for bail agents (5¢ each,
 * plans.js AGENT_TEXT_CENTS) on the agent's bail-agent plan invoice, exactly once.
 *
 * Once a day (server.js, one instance via job_runs): for each agent with unbilled texts and
 * a paid bail-agent plan in Stripe:
 *   1. a bd_text_batches row is written and the texts are tied to it (one transaction);
 *   2. one Stripe invoice item for the batch is added to the plan's subscription (it is
 *      charged on the next invoice), with idempotency key `bd_texts_<batch id>`;
 *   3. the batch is marked billed.
 * A crash between 2 and 3 leaves the batch 'pending'; the next run finds the invoice item by
 * its metadata (or creates it with the same key) and finishes — never a second charge.
 * Agents without a paid plan keep their texts unbilled until they have one (they cannot send
 * texts without a plan: routes/bondDesk requires it).
 */
import { stripeClient } from '../../routes/billing/_shared.js';
import { stripeConfigured } from '../../config.js';
import { PAID_STATUSES } from '../entitlements.js';
import logger from '../../utils/logger.js';

const PAID_SQL = PAID_STATUSES.map((s) => `'${s}'`).join(',');

async function findItem(stripe, customer, batchId) {
  let starting_after;
  for (let page = 0; page < 10; page++) {
    const list = await stripe.invoiceItems.list({ customer, limit: 100, ...(starting_after ? { starting_after } : {}) });
    const hit = (list?.data || []).find((i) => i?.metadata?.bd_text_batch === String(batchId));
    if (hit) return hit;
    if (!list?.has_more || !list.data.length) return null;
    starting_after = list.data[list.data.length - 1].id;
  }
  return null;
}

async function billBatch(db, stripe, batch) {
  const sub = await stripe.subscriptions.retrieve(batch.stripe_sub_id);
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  let item = await findItem(stripe, customer, batch.id);
  if (!item) {
    item = await stripe.invoiceItems.create({
      customer, subscription: batch.stripe_sub_id, currency: 'usd', amount: Number(batch.amount_cents),
      description: `Texts sent for you: ${batch.texts} × 5¢`,
      metadata: { bd_text_batch: String(batch.id), agent_id: String(batch.agent_id) },
    }, { idempotencyKey: `bd_texts_${batch.id}` });
  }
  await db.run(`UPDATE bd_text_batches SET status = 'billed', stripe_invoice_item_id = ?, billed_at = NOW() WHERE id = ? AND status = 'pending'`, [item.id, batch.id]);
}

/** → { batches, billed, failed } */
export async function billAgentTexts(db) {
  if (!stripeConfigured()) return { batches: 0, billed: 0, failed: 0, skipped: 'payments_unavailable' };
  const stripe = stripeClient();
  // 1. new batches
  const agents = await db.all(
    `SELECT t.agent_id, COUNT(*)::int AS n, SUM(t.cents)::bigint AS cents,
            (SELECT s.stripe_sub_id FROM bondsman_subscriptions s WHERE s.user_id = t.agent_id AND s.status IN (${PAID_SQL}) AND s.stripe_sub_id IS NOT NULL ORDER BY s.id DESC LIMIT 1) AS sub
       FROM bd_texts t WHERE t.batch_id IS NULL AND t.cents > 0 GROUP BY t.agent_id`);
  let batches = 0;
  for (const a of agents) {
    if (!a.sub) continue;
    await db.transaction(async (tx) => {
      const rows = await tx.all('SELECT id, cents FROM bd_texts WHERE agent_id = ? AND batch_id IS NULL AND cents > 0 FOR UPDATE', [a.agent_id]);
      if (!rows.length) return;
      const amount = rows.reduce((s, r) => s + Number(r.cents), 0);
      const b = await tx.get(`INSERT INTO bd_text_batches (agent_id, stripe_sub_id, texts, amount_cents) VALUES (?, ?, ?, ?) RETURNING id`,
        [a.agent_id, a.sub, rows.length, amount]);
      await tx.run(`UPDATE bd_texts SET batch_id = ? WHERE id IN (${rows.map(() => '?').join(',')})`, [b.id, ...rows.map((r) => r.id)]);
      batches += 1;
    });
  }
  // 2–3. bill every pending batch (new ones and any left by a crash)
  let billed = 0; let failed = 0;
  for (const b of await db.all(`SELECT id, agent_id, stripe_sub_id, texts, amount_cents FROM bd_text_batches WHERE status = 'pending' ORDER BY id`)) {
    try { await billBatch(db, stripe, b); billed += 1; } catch (e) {
      failed += 1;
      logger.error({ err: e?.message, batch: b.id }, '[bond-desk] text billing failed — retried next run');
    }
  }
  if (failed) {
    const { notifyError } = await import('../../monitoring/errorNotifier.js');
    await notifyError(`Bond Desk text billing: ${failed} batch(es) not billed (retried tomorrow)`, { code: 'bd_text_billing_failed', failed });
  }
  return { batches, billed, failed };
}
