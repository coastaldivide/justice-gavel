/**
 * dataRefresh/runLog.js — scrape_runs bookkeeping + one-run-at-a-time locks.
 *
 * Every scraper / importer / scheduler step records one scrape_runs row:
 * started as 'running', finished as ok | partial | failed | skipped with its
 * counts. A dry run is recorded too (dry_run = true) so an operator can see
 * what a run WOULD have done.
 *
 * withJobLock() takes a Postgres session advisory lock on a dedicated pooled
 * connection for the length of the job, so two API instances firing the same
 * nightly cron (or a manual run overlapping the scheduled one) cannot process
 * the same provider twice at the same time.
 */
import logger from '../../utils/logger.js';

export const RUN_COUNTERS = ['fetched', 'inserted', 'proposed', 'unchanged', 'updated', 'skipped', 'errors'];
const TRIGGERS = new Set(['manual', 'scheduler', 'admin', 'test']);

export function newCounts() {
  return Object.fromEntries(RUN_COUNTERS.map(k => [k, 0]));
}

/** Refuse anything but the real Postgres database (no silent demo.db writes). */
export function assertPostgres(db) {
  if (!db || db.engine !== 'postgres') {
    throw new Error('Data refresh writes the main Postgres database only — set DATABASE_URL '
      + '(the local sql.js dev fallback is not a refresh target).');
  }
}

export async function startRun(db, { job, trigger = 'manual', params = {}, dryRun = false }) {
  const t = TRIGGERS.has(trigger) ? trigger : 'manual';
  const row = await db.get(
    `INSERT INTO scrape_runs (job, trigger, params, dry_run, status)
     VALUES (?, ?, ?::jsonb, ?, 'running') RETURNING id`,
    [String(job).slice(0, 60), t, JSON.stringify(params ?? {}), !!dryRun],
  );
  return Number(row.id);
}

/**
 * Close a run. status defaults to ok / partial (some errors) / failed (only
 * errors). error_sample keeps the first few distinct error messages.
 */
export async function finishRun(db, runId, counts = {}, { status, message = null, errorSamples = [] } = {}) {
  const c = { ...newCounts(), ...counts };
  const finalStatus = status
    || (c.errors === 0 ? 'ok'
      : (c.inserted + c.proposed + c.unchanged + c.updated) > 0 ? 'partial' : 'failed');
  const sample = [...new Set(errorSamples.map(e => String(e).slice(0, 300)))].slice(0, 5).join('\n') || null;
  await db.run(
    `UPDATE scrape_runs SET status = ?, finished_at = NOW(),
            fetched = ?, inserted = ?, proposed = ?, unchanged = ?, updated = ?, skipped = ?, errors = ?,
            message = ?, error_sample = ?
      WHERE id = ?`,
    [finalStatus, c.fetched, c.inserted, c.proposed, c.unchanged, c.updated, c.skipped, c.errors,
      message ? String(message).slice(0, 2000) : null, sample, runId],
  );
  return finalStatus;
}

/** Record a run that did not start (missing key, lock held, ...). */
export async function recordSkippedRun(db, { job, trigger = 'manual', params = {}, message }) {
  const id = await startRun(db, { job, trigger, params });
  await finishRun(db, id, {}, { status: 'skipped', message });
  return id;
}

/**
 * Run fn() while holding a Postgres advisory lock for `job`.
 * Returns { locked: false } without running fn when another run holds it.
 */
export async function withJobLock(db, job, fn) {
  assertPostgres(db);
  const pool = db._pool;
  if (!pool) return { locked: true, result: await fn() };
  const client = await pool.connect();
  const key = `jg_data_refresh:${job}`;
  let got = false;
  try {
    const r = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key]);
    got = !!r.rows[0]?.ok;
    if (!got) return { locked: false };
    return { locked: true, result: await fn() };
  } finally {
    if (got) {
      try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]); }
      catch (e) { logger.warn('[dataRefresh] advisory unlock failed:', e.message); }
    }
    client.release();
  }
}
