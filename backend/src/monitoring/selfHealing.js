/**
 * monitoring/selfHealing.js — Automatic failure recovery
 *
 * Monitors the application and attempts self-repair before escalating.
 * Think of this as the immune system — it handles the common illnesses
 * so the on-call engineer only gets woken up for the serious ones.
 *
 * SELF-HEALING BEHAVIORS:
 *
 *   1. Database reconnection
 *      Problem: DB connection drops (network blip, Supabase restart)
 *      Action:  Exponential backoff reconnect, up to 5 attempts
 *      If fails: notifyCritical('Database unreachable after 5 attempts')
 *
 *   2. Memory leak guard
 *      Problem: Heap exceeds 512MB (leak or traffic spike)
 *      Action:  Force garbage collection, clear in-memory caches
 *      If fails: Graceful restart (the host — Render, PM2, Docker — restarts the container)
 *
 *   4. Stale lock cleanup
 *      Problem: Scheduled job lock not released (crash during job)
 *      Action:  Auto-clear locks older than 10 minutes
 *
 *   5. Health check watchdog
 *      Problem: /health returns non-200 (DB or dependency down)
 *      Action:  Log, notify, attempt specific dependency restart
 */

import logger         from '../utils/logger.js';
import { notifyCritical, notifyError, notifyWarn, notifyRecovery } from './errorNotifier.js';

// ── 1. Database reconnection with exponential backoff ─────────────────────────
let dbReconnectAttempts = 0;
const MAX_RECONNECT     = 5;
const DB_WAS_DOWN       = new Set();

export async function healDatabase() {
  try {
    const { getDb } = await import('../db/index.js');
    const db = await getDb();
    await db.get('SELECT 1');

    if (DB_WAS_DOWN.has('db')) {
      DB_WAS_DOWN.delete('db');
      dbReconnectAttempts = 0;
      notifyRecovery('database', 'Database connection restored');
    }
    return true;
  } catch (e) {
    dbReconnectAttempts++;
    DB_WAS_DOWN.add('db');
    const delay = Math.min(1000 * Math.pow(2, dbReconnectAttempts), 30_000);

    logger.error(`[self-heal] DB connection failed (attempt ${dbReconnectAttempts}/${MAX_RECONNECT}):`, e.message);

    if (dbReconnectAttempts >= MAX_RECONNECT) {
      await notifyCritical('Database unreachable after 5 reconnect attempts', {
        code:    'db_unreachable',
        error:   e.message,
        attempts: dbReconnectAttempts,
      });
      return false;
    }

    logger.info(`[self-heal] Retrying DB in ${delay}ms...`);
    await new Promise(r => { setTimeout(r, delay); });
    return healDatabase();
  }
}

// ── 2. Memory leak guard ───────────────────────────────────────────────────────
// Thresholds are derived from the container's memory limit (MEMORY_LIMIT_MB,
// default 512 — the Render Starter instance in render.yaml) and watch RSS, because the
// container OOM-killer enforces RSS, not V8 heap. On a 512MB container:
//   warn      72% → 368 MB   (notifyWarn once per episode)
//   critical  85% → 435 MB   (force GC if exposed, then notifyError)
//   restart   93% → 476 MB   (graceful exit before the OOM-killer SIGKILLs us,
//                             so the host restarts a cleanly-shut-down process)
// The old thresholds (heap 512 MB warn → restart at heap 600 MB) could never
// fire on a 512 MB container — RSS exceeds heap, so the kernel killed the
// process long before heap reached 512 MB.
const MEMORY_LIMIT_MB   = Math.max(128, parseInt(process.env.MEMORY_LIMIT_MB || '512', 10) || 512);
const MEMORY_WARN_MB    = Math.round(MEMORY_LIMIT_MB * 0.72);
const MEMORY_CRIT_MB    = Math.round(MEMORY_LIMIT_MB * 0.85);
const MEMORY_RESTART_MB = Math.round(MEMORY_LIMIT_MB * 0.93);
let memoryWarned        = false;

export function startMemoryWatchdog() {
  const timer = setInterval(async () => {
    const { heapUsed, rss } = process.memoryUsage();
    const heapMB = Math.round(heapUsed / 1024 / 1024);
    const rssMB  = Math.round(rss / 1024 / 1024);

    if (rssMB > MEMORY_CRIT_MB) {
      logger.error(`[self-heal] CRITICAL memory: rss=${rssMB}MB heap=${heapMB}MB (limit ${MEMORY_LIMIT_MB}MB)`);

      // Attempt 1: Force GC if available (--expose-gc)
      if (global.gc) {
        global.gc();
        const after = Math.round(process.memoryUsage().rss / 1024 / 1024);
        logger.info(`[self-heal] GC ran: rss ${rssMB}MB → ${after}MB`);
        if (after < MEMORY_WARN_MB) return;  // GC fixed it
      }

      // (A former "attempt 2" imported invalidateUserCache but never called it and
      // still logged "User cache cleared"; the auth cache is bounded and self-evicting.)

      await notifyError(`Memory usage critical — rss over ${MEMORY_CRIT_MB}MB`, {
        code:   'memory_critical',
        heapMB,
        rssMB,
        limitMB: MEMORY_LIMIT_MB,
      });

      // Attempt 3: Graceful restart (the host restarts the container on exit),
      // before the kernel OOM-killer SIGKILLs us mid-request.
      if (rssMB > MEMORY_RESTART_MB) {
        logger.error(`[self-heal] rss over ${MEMORY_RESTART_MB}MB — initiating graceful restart`);
        await notifyCritical('Memory exhaustion — forcing restart', { rssMB, heapMB, code: 'oom_restart' });
        process.exit(1);  // Render / PM2 / Docker restart policy brings it back
      }

    } else if (rssMB > MEMORY_WARN_MB && !memoryWarned) {
      memoryWarned = true;
      notifyWarn(`Memory usage elevated: rss=${rssMB}MB of ${MEMORY_LIMIT_MB}MB`, { code: 'memory_elevated', rssMB, heapMB });
    } else if (rssMB < MEMORY_WARN_MB) {
      memoryWarned = false;
    }
  }, 30_000);  // Check every 30 seconds
  timer.unref();
  _intervals.push(timer);   // so stopAllWatchdogs() clears it (it never was before)
  return timer;
}


// ── 4. Stale job lock cleanup ─────────────────────────────────────────────────
export async function cleanStaleLocks() {
  try {
    const { JOB_LAST_RUN } = await import('../services/scheduler.js').catch(() => ({ JOB_LAST_RUN: new Map() }));
    const now     = Date.now();
    const STALE   = 10 * 60 * 1000;  // 10 minutes
    let cleaned   = 0;

    for (const [key, ts] of JOB_LAST_RUN.entries()) {
      if (now - ts > STALE * 3) {  // 3x staleness = definitely stuck
        JOB_LAST_RUN.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) logger.info(`[self-heal] Cleared ${cleaned} stale job locks`);
  } catch { /* best-effort housekeeping: never let the watchdog throw */ }
}

// ── 5. Health check watchdog (internal) ───────────────────────────────────────
export async function runHealthCheck() {
  const results = {};
  let healthy   = true;

  // DB check
  try {
    const { getDb } = await import('../db/index.js');
    const db = await getDb();
    await db.get('SELECT 1');
    results.database = 'ok';
  } catch {
    results.database = 'error';
    healthy = false;
    await healDatabase();  // Attempt auto-heal
  }

  // Env check (JWT secret not dev default in production)
  if (process.env.NODE_ENV === 'production' &&
      process.env.JWT_SECRET === 'dev_secret_change_me') {
    results.jwt_secret = 'insecure_default';   // label only — never echo secret material
    healthy = false;
    await notifyCritical('JWT_SECRET is still the development default in production', {
      code: 'insecure_jwt_secret',
    });
  }

  // Memory check (rss — the number the container limit enforces)
  const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  results.memory_mb = rssMB;
  if (rssMB > MEMORY_CRIT_MB) healthy = false;

  return { healthy, results, timestamp: new Date().toISOString() };
}

// ── Start all watchdogs ────────────────────────────────────────────────────────



// ── Interval registry ─────────────────────────────────────────────────────────
let _watchdogsStarted = false;
const _intervals       = [];

export function startAllWatchdogs() {
  if (_watchdogsStarted) {
    // Already running — clear existing before restarting to prevent duplicates
    _intervals.forEach(clearInterval);
    _intervals.length = 0;
  }
  _watchdogsStarted = true;
  if (process.env.NODE_ENV === 'test') return;  // Don't run in tests

  startMemoryWatchdog();
  // Run DB health check every 60 seconds
  const dbTimer = setInterval(async () => {
    try {
      const { results } = await runHealthCheck();
      if (results.database === 'error') {
        logger.error('[watchdog] DB unhealthy — healing attempt triggered');
      }
    } catch (e) { logger.warn('[watchdog] health check failed:', e.message); }
  }, 60_000);
  dbTimer.unref();
  _intervals.push(dbTimer);

  // Clean stale locks every 15 minutes
  const lockTimer = setInterval(() => cleanStaleLocks().catch(() => {}), 15 * 60 * 1000);
  lockTimer.unref();
  _intervals.push(lockTimer);

  logger.info('[watchdog] All watchdogs started: memory, DB, stale locks');
}
export function stopAllWatchdogs() {
  _intervals.forEach(clearInterval);
  _intervals.length = 0;
  _watchdogsStarted = false;
}
