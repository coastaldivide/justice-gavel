/**
 * cronGuard.js — safe wrapper around node-cron's schedule().
 *
 * Why this exists
 * ───────────────
 * node-cron computes the next fire time and hands the delay to setTimeout.
 * If that delay exceeds 2^31-1 ms (~24.8 days) Node clamps it to 1 ms, the
 * runner fires immediately, recomputes the same far-future date, and clamps
 * again — a permanent hot loop. Measured cost on this codebase: ~67% of a CPU
 * core and ~440 log lines per second, forever, while the job itself never runs.
 *
 * node-cron 4.0.0 hit exactly this. Its day-of-week search advanced the *year*
 * instead of the day, so '0 7 * * 0' (Sunday 7am) resolved to 2031. Fixed
 * upstream in 4.6.0, which is now pinned in package.json.
 *
 * This wrapper is the seatbelt, not the fix. It rejects any schedule whose next
 * run is implausibly far out, so a future parser regression degrades to
 * "this job is off" — visible in the logs — instead of pegging the server.
 */

import cron   from 'node-cron';
import logger from './logger.js';

// ── Job monitoring ───────────────────────────────────────────────────────────
// Every scheduled job runs through guardJob(): one run at a time per process
// (an overrunning job is skipped, not stacked), and each run's outcome is kept
// for /metrics (`jobs`). A failing run is logged AND alerted (SEV-2, deduped
// per job by the notifier), so a broken nightly job cannot fail silently.
const JOB_STATS = new Map();   // label → { runs, failures, skipped, running, last_started_at, last_ok_at, last_error, last_ms }

export function getJobStats() {
  return Object.fromEntries([...JOB_STATS].map(([k, v]) => [k, { ...v }]));
}

export function guardJob(label, handler) {
  const st = () => {
    if (!JOB_STATS.has(label)) JOB_STATS.set(label, { runs: 0, failures: 0, skipped: 0, running: false, last_started_at: null, last_ok_at: null, last_error: null, last_ms: null });
    return JOB_STATS.get(label);
  };
  st();
  return async function guardedJob(...args) {
    const s = st();
    if (s.running) {
      s.skipped++;
      logger.warn({ job: label }, '[cron] previous run still in progress — skipped this tick');
      return;
    }
    s.running = true;
    s.runs++;
    s.last_started_at = new Date().toISOString();
    const t0 = Date.now();
    try {
      await handler(...args);
      s.last_ok_at = new Date().toISOString();
      s.last_error = null;
    } catch (e) {
      s.failures++;
      s.last_error = String(e?.message || e).slice(0, 300);
      logger.error({ job: label, err: s.last_error }, '[cron] scheduled job failed');
      try {
        const { notifyError } = await import('../monitoring/errorNotifier.js');
        await notifyError(`Scheduled job failed: ${label}`, { code: `job:${label}`, error: s.last_error });
      } catch { /* alerting must never crash the scheduler */ }
    } finally {
      s.last_ms = Date.now() - t0;
      s.running = false;
    }
  };
}

// No job in this app legitimately schedules more than ~20 days ahead.
// (The longest real interval is weekly.) Anything beyond this is a parser bug.
export const MAX_PLAUSIBLE_DELAY_MS = 20 * 24 * 60 * 60 * 1000;

/**
 * Schedule a cron job, verifying the computed next-run is sane.
 *
 * @param {string}   expr     cron expression
 * @param {string}   label    short name for logging
 * @param {Function} handler  job body
 * @param {object}   options  passed through to cron.schedule (e.g. { timezone })
 * @returns {object|null}     the task, or null if it was refused
 */
export function scheduleGuarded(expr, label, handler, options = {}) {
  if (!cron.validate(expr)) {
    logger.error(`[cron] Invalid expression for ${label}: "${expr}" — job disabled.`);
    return null;
  }

  const task = cron.schedule(expr, guardJob(label, handler), options);

  try {
    const next = typeof task.getNextRun === 'function' ? task.getNextRun() : null;
    if (next) {
      const nextMs = new Date(next).getTime();
      const delay  = nextMs - Date.now();

      if (delay > MAX_PLAUSIBLE_DELAY_MS) {
        logger.error({
          msg:  `[cron] ${label}: next run is implausibly far out — job disabled`,
          expr,
          next: new Date(nextMs).toISOString(),
          days: Math.round(delay / 86_400_000),
          hint: 'Cron parser bug — check the node-cron version (4.6.0+ required).',
        });
        task.destroy();
        return null;
      }

      logger.info(`[cron] ${label}: ${expr} — next run ${new Date(nextMs).toISOString()}`);
    }
  } catch (e) {
    // getNextRun is advisory. If it throws, let the job run rather than killing it.
    logger.warn(`[cron] ${label}: could not verify next run — ${e?.message}`);
  }

  return task;
}

export default { scheduleGuarded, guardJob, getJobStats, MAX_PLAUSIBLE_DELAY_MS };
