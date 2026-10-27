/**
 * monitoring/jobHealth.js — are the scheduled jobs running?
 *
 * Every scheduled job claims each run in job_runs (utils/jobLock.js) and records
 * ok / failed. A job can also go quiet without failing (the timer never fired, the
 * instance kept crashing, the scheduler was switched off). This compares each
 * job's last successful run with how often it should run and reports:
 *
 *   failing  the newest run failed
 *   stale    no successful run within its expected interval (+ grace)
 *   ok
 *
 * GET /api/admin/diagnostics/jobs shows the report; server.js checks it hourly and
 * sends one alert per problem (notifyError, 5-minute dedup per code).
 *
 * Jobs that only run when a feature is on (LIVE_REFRESH, reminders) are checked
 * only when that feature is on, so a switched-off job never raises a false alarm.
 */
import { CONFIG, stripeConfigured } from '../config.js';
import { remindersEnabled as remindersOn } from '../services/reminderDispatcher.js';
import { autopayEnabled } from '../services/bondDesk/autopay.js';

const H = 3600_000;
/** job → { everyMs, when() } — `when` false = the job is not expected to run now. */
export const EXPECTED = Object.freeze({
  'refresh-token-cleanup': { everyMs: 24 * H, when: () => true },
  'bd-text-billing': { everyMs: 24 * H, when: () => true },
  'push-receipts': { everyMs: 0.5 * H, when: () => remindersOn() },
  'consultation-reminders': { everyMs: 1 * H, when: () => remindersOn() },
  'bd-court-reminders': { everyMs: H / 12, when: () => remindersOn() },
  'checkin-texts': { everyMs: 0.25 * H, when: () => remindersOn() },
  'checkin-missed': { everyMs: 1 * H, when: () => remindersOn() },
  'bd-autopay': { everyMs: 1 * H, when: () => autopayEnabled() && stripeConfigured() },
  nightly: { everyMs: 24 * H, when: () => !!CONFIG.LIVE_REFRESH },
  'payment-link-expiry': { everyMs: 2 * H, when: () => !!CONFIG.LIVE_REFRESH },
});
const GRACE = 0.5;   // an interval and a half before "stale"


/** → [{ job, status: 'ok'|'failing'|'stale'|'not_expected', last_ok, last_run, last_error }] */
export async function jobHealth(db, now = new Date()) {
  if (db?.engine !== 'postgres') return [];
  const rows = await db.all(
    `SELECT job,
            MAX(finished_at) FILTER (WHERE status = 'ok') AS last_ok,
            MAX(started_at) AS last_run
       FROM job_runs WHERE job = ANY(?::text[]) GROUP BY job`, [`{${Object.keys(EXPECTED).join(',')}}`]);
  const latest = await db.all(
    `SELECT DISTINCT ON (job) job, status, error, started_at FROM job_runs
      WHERE job = ANY(?::text[]) ORDER BY job, started_at DESC`, [`{${Object.keys(EXPECTED).join(',')}}`]);
  const by = new Map(rows.map((r) => [r.job, r]));
  const last = new Map(latest.map((r) => [r.job, r]));
  const bootedAt = Date.now() - process.uptime() * 1000;   // the real boot time (not relative to `now`)
  return Object.entries(EXPECTED).map(([job, e]) => {
    const r = by.get(job) || {};
    const l = last.get(job);
    const out = { job, last_ok: r.last_ok ? new Date(r.last_ok).toISOString() : null, last_run: r.last_run ? new Date(r.last_run).toISOString() : null,
      last_error: l?.status === 'failed' ? l.error : null };
    if (!e.when()) return { ...out, status: 'not_expected' };
    if (l?.status === 'failed') return { ...out, status: 'failing' };
    const limit = e.everyMs * (1 + GRACE);
    // A fresh server has not had time to run the job yet: measure from boot.
    const since = Math.max(r.last_ok ? new Date(r.last_ok).getTime() : 0, bootedAt);
    return { ...out, status: now.getTime() - since > limit ? 'stale' : 'ok' };
  });
}
