/**
 * utils/jobLock.js — run a scheduled job once per window across ALL instances.
 *
 * Every API instance runs the same timers (Render scaling, and during a
 * zero-downtime deploy the old and the new instance overlap). A job that sends
 * something — nightly pipeline, consultation reminders, bar re-verification
 * e-mail — must run once, not once per instance. Each run window has a key
 * (e.g. nightly:2026-10-20 in the job's time zone); the instance whose INSERT
 * into job_runs wins runs the job, every other instance skips it. A run that
 * crashed is not retried in the same window (the next window runs normally);
 * its row stays 'running' / 'failed' for the operator.
 *
 * Without Postgres (local sql.js dev) every call runs (one process anyway).
 */
import os from 'node:os';
import { getDb } from '../db/index.js';
import logger from './logger.js';
import { INSTANCE_ID } from './version.js';

const INSTANCE = INSTANCE_ID || `${os.hostname()}:${process.pid}`;

/** 'YYYY-MM-DD' of `now` in `tz`. */
export function dayKey(now = new Date(), tz = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A key for the `minutes`-long slot `now` falls in (UTC), e.g. '2026-10-20T14:00' for 60. */
export function slotKey(now = new Date(), minutes = 60) {
  const ms = minutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms).toISOString().slice(0, 16);
}

/** 'YYYY-Qn' of `now` (UTC). */
export function quarterKey(now = new Date()) {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

/** True when this instance won the run `job`/`runKey` (and must run it). */
export async function claimRun(job, runKey, { db: dbArg } = {}) {
  const db = dbArg || await getDb();
  if (db?.engine !== 'postgres') return true;
  const row = await db.get(
    `INSERT INTO job_runs (job, run_key, instance) VALUES (?, ?, ?)
     ON CONFLICT (job, run_key) DO NOTHING RETURNING job`,
    [job, runKey, INSTANCE]);
  return !!row;
}

async function finishRun(db, job, runKey, status, error = null) {
  if (db?.engine !== 'postgres') return;
  await db.run('UPDATE job_runs SET status = ?, finished_at = NOW(), error = ? WHERE job = ? AND run_key = ?',
    [status, error ? String(error).slice(0, 300) : null, job, runKey]).catch(e => logger.warn({ job, err: e.message }, '[jobLock] could not record the run'));
}

/**
 * Run `fn` unless another instance already ran (or is running) `job` for this
 * window. Returns { ran: true, result } or { ran: false }. Errors from `fn` are
 * recorded and re-thrown.
 */
export async function runOnce(job, runKey, fn, { db: dbArg } = {}) {
  const db = dbArg || await getDb();
  let won;
  try { won = await claimRun(job, runKey, { db }); }
  catch (e) { logger.error({ job, runKey, err: e.message }, '[jobLock] claim failed — job not run'); return { ran: false, error: e.message }; }
  if (!won) { logger.info({ job, runKey }, '[jobLock] another instance has this run — skipped'); return { ran: false }; }
  try {
    const result = await fn();
    await finishRun(db, job, runKey, 'ok');
    return { ran: true, result };
  } catch (e) {
    await finishRun(db, job, runKey, 'failed', e?.message);
    throw e;
  }
}

/**
 * For a node-cron handler: run `fn` on one instance per fire. node-cron passes
 * { date } = the scheduled time, identical on every instance, so it is the run
 * key (the outcome is recorded in job_runs). A call without a context (an admin
 * trigger, a test) always runs.
 */
export async function runScheduled(job, ctx, fn, opts = {}) {
  const at = ctx?.date instanceof Date ? ctx.date : null;
  if (!at) return { ran: true, result: await fn() };
  return runOnce(job, at.toISOString().slice(0, 16), fn, opts);
}

/** Remove run records older than `days` (called by the daily maintenance job). */
export async function purgeJobRuns(db, days = 30) {
  if (db?.engine !== 'postgres') return 0;
  const r = await db.run(`DELETE FROM job_runs WHERE started_at < NOW() - (? * INTERVAL '1 day')`, [days]);
  return r?.changes || 0;
}
