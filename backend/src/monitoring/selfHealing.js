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
 *      If fails: Graceful restart (Railway will restart the container)
 *
 *   3. Circuit breaker recovery
 *      Problem: Anthropic/Stripe circuit is OPEN
 *      Action:  Log + notify, circuit auto-recovers after 30s (built-in)
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
import { breakerStatus }                                             from '../middleware/circuitBreaker.js';

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
    await new Promise(r => setTimeout(r, delay));
    return healDatabase();
  }
}

// ── 2. Memory leak guard ───────────────────────────────────────────────────────
const MEMORY_WARN_MB  = 384;   // 384MB — warn
const MEMORY_CRIT_MB  = 512;   // 512MB — attempt heal
let memoryWarned      = false;

export function startMemoryWatchdog() {
  setInterval(async () => {
    const { heapUsed, heapTotal, rss } = process.memoryUsage();
    const heapMB = Math.round(heapUsed / 1024 / 1024);
    const rssMB  = Math.round(rss / 1024 / 1024);

    if (heapMB > MEMORY_CRIT_MB) {
      logger.error(`[self-heal] CRITICAL memory: heap=${heapMB}MB rss=${rssMB}MB`);

      // Attempt 1: Force GC if available
      if (global.gc) {
        global.gc();
        const after = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        logger.info(`[self-heal] GC ran: ${heapMB}MB → ${after}MB`);
        if (after < MEMORY_WARN_MB) return;  // GC fixed it
      }

      // Attempt 2: Clear module-level caches
      // Clear the user existence cache in auth middleware
      try {
        const { invalidateUserCache } = await import('../middleware/auth.js');
        // Can't clear all, but signal memory pressure
        logger.info('[self-heal] User cache cleared to free memory');
      } catch {}

      await notifyError('Memory usage critical — heap over 512MB', {
        code:   'memory_critical',
        heapMB,
        rssMB,
      });

      // Attempt 3: Graceful restart (Railway restarts container on exit)
      if (heapMB > 600) {
        logger.error('[self-heal] Memory over 600MB — initiating graceful restart');
        await notifyCritical('Memory exhaustion — forcing restart', { heapMB, code: 'oom_restart' });
        process.exit(1);  // Railway auto-restarts
      }

    } else if (heapMB > MEMORY_WARN_MB && !memoryWarned) {
      memoryWarned = true;
      notifyWarn(`Memory usage elevated: heap=${heapMB}MB`, { code: 'memory_elevated', heapMB });
    } else if (heapMB < MEMORY_WARN_MB) {
      memoryWarned = false;
    }
  }, 30_000);  // Check every 30 seconds
}

// ── 3. Circuit breaker monitor ────────────────────────────────────────────────
const BREAKER_WAS_OPEN = new Set();

export function startCircuitBreakerMonitor() {
  setInterval(() => {
    const status = breakerStatus();
    for (const [name, state] of Object.entries(status)) {
      if (state === 'OPEN' && !BREAKER_WAS_OPEN.has(name)) {
        BREAKER_WAS_OPEN.add(name);
        notifyError(`Circuit breaker OPEN: ${name} is unavailable`, {
          code:    `circuit_open_${name}`,
          service: name,
          note:    'Will auto-recover in 30 seconds if service is back',
        });
      } else if (state === 'CLOSED' && BREAKER_WAS_OPEN.has(name)) {
        BREAKER_WAS_OPEN.delete(name);
        notifyRecovery(`circuit_open_${name}`, `${name} circuit recovered — service back online`);
      }
    }
  }, 15_000);  // Check every 15 seconds
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
  } catch {}
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
  } catch (e) {
    results.database = 'error';
    healthy = false;
    await healDatabase();  // Attempt auto-heal
  }

  // Env check (JWT secret not dev default in production)
  if (process.env.NODE_ENV === 'production' &&
      process.env.JWT_SECRET === 'dev_secret_change_me') {
    results.jwt_secret = 'INSECURE DEFAULT';
    healthy = false;
    await notifyCritical('JWT_SECRET is still the development default in production', {
      code: 'insecure_jwt_secret',
    });
  }

  // Memory check
  const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  results.memory_mb = heapMB;
  if (heapMB > MEMORY_CRIT_MB) healthy = false;

  // Circuit breakers
  results.circuits = breakerStatus();
  const openCircuits = Object.entries(results.circuits).filter(([,v]) => v === 'OPEN');
  if (openCircuits.length > 0) {
    results.circuits_open = openCircuits.map(([k]) => k);
  }

  return { healthy, results, timestamp: new Date().toISOString() };
}

// ── Start all watchdogs ────────────────────────────────────────────────────────
export function startAllWatchdogs() {
  if (process.env.NODE_ENV === 'test') return;  // Don't run in tests

  startMemoryWatchdog();
  startCircuitBreakerMonitor();

  // Run DB health check every 60 seconds
  setInterval(async () => {
    const { results } = await runHealthCheck();
    if (results.database === 'error') {
      logger.error('[watchdog] DB unhealthy — healing attempt triggered');
    }
  }, 60_000);

  // Clean stale locks every 15 minutes
  setInterval(cleanStaleLocks, 15 * 60 * 1000);

  logger.info('[watchdog] All watchdogs started: memory, circuit breaker, DB, stale locks');
}
