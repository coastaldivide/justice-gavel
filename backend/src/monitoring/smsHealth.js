/**
 * monitoring/smsHealth.js — are texts arriving?
 *
 * Reads the final delivery statuses Telnyx reports (sms_delivery, migration 33) for the
 * last hour. When at least MIN_TEXTS finished and more than MAX_FAIL_SHARE of them did
 * not arrive (delivery_failed / sending_failed), something is wrong — an unregistered
 * 10DLC campaign, a blocked number, carrier filtering — and a person is alerted.
 * Court reminders and Bond Desk texts both depend on this.
 */
export const MIN_TEXTS = 10;
export const MAX_FAIL_SHARE = 0.2;
const FAILED = ['delivery_failed', 'sending_failed'];

/** → { total, failed, share, alarm } for the window ending `now`. */
export async function smsHealth(db, { minutes = 60 } = {}) {
  if (db?.engine !== 'postgres') return { total: 0, failed: 0, share: 0, alarm: false };
  const r = await db.get(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = ANY(?::text[]))::int AS failed
       FROM sms_delivery WHERE finalized_at >= NOW() - make_interval(mins => ?)`, [`{${FAILED.join(',')}}`, minutes]);
  const share = r.total ? r.failed / r.total : 0;
  return { total: r.total, failed: r.failed, share, alarm: r.total >= MIN_TEXTS && share > MAX_FAIL_SHARE };
}
