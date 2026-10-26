/**
 * services/casePass.js — the one-time Case Pass ($29 for 90 days, $19 to add 90 more days;
 * plans.js CASE_PASS). No renewal, no subscription: each paid PaymentIntent adds one 90-day
 * period, starting when the current pass ends (or now). Recording is idempotent per
 * PaymentIntent (case_passes.stripe_pi_id is unique), so the confirm route and the Stripe
 * webhook can both run, in any order, any number of times.
 */
import { CASE_PASS } from '../routes/billing/plans.js';

/** The caller's pass that is valid now: { ends_at } of the latest period, or null. */
export async function activeCasePass(db, userId) {
  if (!userId) return null;
  const row = await db.get(
    'SELECT MAX(ends_at) AS ends_at FROM case_passes WHERE user_id = ?', [userId]);
  if (!row?.ends_at) return null;
  return new Date(row.ends_at) > new Date() ? { ends_at: new Date(row.ends_at).toISOString() } : null;
}

/** The amount a purchase costs right now: the extension price only while a pass is active. */
export async function casePassQuote(db, userId) {
  const active = await activeCasePass(db, userId);
  return { kind: active ? 'extend' : 'new', cents: active ? CASE_PASS.extend_cents : CASE_PASS.cents, active };
}

/**
 * Record a succeeded PaymentIntent (already verified as this user's 'case_pass' payment).
 * → { pass: { starts_at, ends_at }, created }
 */
export async function recordCasePass(db, { userId, pi }) {
  const kind = pi?.metadata?.kind === 'extend' ? 'extend' : 'new';
  return await db.transaction(async (tx) => {
    // Serialise passes per person (row lock) so two payments never compute the same start.
    await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const done = await tx.get('SELECT starts_at, ends_at FROM case_passes WHERE stripe_pi_id = ?', [pi.id]);
    if (done) return { pass: iso(done), created: false };
    const row = await tx.get(
      `INSERT INTO case_passes (user_id, stripe_pi_id, kind, amount_cents, starts_at, ends_at)
       SELECT ?, ?, ?, ?, s.start, s.start + make_interval(days => ?)
         FROM (SELECT GREATEST(NOW(), COALESCE((SELECT MAX(ends_at) FROM case_passes WHERE user_id = ?), NOW())) AS start) s
       RETURNING starts_at, ends_at`,
      [userId, pi.id, kind, Number(pi.amount), CASE_PASS.days, userId]);
    return { pass: iso(row), created: true };
  });
}

const iso = (r) => ({ starts_at: new Date(r.starts_at).toISOString(), ends_at: new Date(r.ends_at).toISOString() });
