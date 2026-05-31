/**
 * dunning.js — Payment failure handling
 *
 * Triggered by Stripe webhook: invoice.payment_failed
 * Flow:
 *   1. Mark subscription as past_due
 *   2. Send failure notification to user
 *   3. On 3rd failure → cancel subscription
 */
import { getDb }    from '../db/index.js';
import { sendEmail } from './sendgrid.js';
import logger        from '../utils/logger.js';

export async function handlePaymentFailed({ invoice, subscription }) {
  const db = await getDb();
  try {
    // Update subscription status
    await db.run(
      `UPDATE subscriptions SET status='past_due', updated_at=datetime('now')
       WHERE stripe_sub_id=?`,
      [subscription.id]
    );

    // Get user email
    const sub = await db.get(
      'SELECT u.email, u.display_name, s.stripe_sub_id FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.stripe_sub_id=?',
      [subscription.id]
    ).catch(() => null);

    if (!sub) return;

    // Send dunning email
    await sendEmail({
      to:      sub.email,
      subject: 'Action required: Payment failed for Justice Gavel',
      html:    `<p>Hi ${sub.display_name || 'there'},</p>
<p>We were unable to process your Justice Gavel subscription payment.</p>
<p>Your account is in a grace period. Please update your payment method to continue full access.</p>
<p>You can update your payment method at: <a href="https://app.justicegavel.app/settings">app.justicegavel.app/settings</a></p>
<p>If payment is not received within 3 days, your account will be downgraded to the free tier.</p>`,
    }).catch(e => logger.warn('[dunning] email failed:', e?.message));

    logger.info('[dunning] payment_failed handled for', sub.email);
  } catch (err) {
    logger.error('[dunning] handler error:', err?.message);
  }
}
