import logger from '../utils/logger.js';
/**
 * aiQueue.js — Async AI job queue for Justice Gavel
 *
 * Problem: every AI call (chat, motions, research, discovery, translate,
 * transcribe, match) blocks the Node.js event loop for 5–30 seconds.
 * At 50+ concurrent users this starts dropping requests.
 *
 * Solution: a two-layer architecture —
 *
 *   1. In-memory job queue (p-queue) with a concurrency ceiling.
 *      Default: 8 concurrent AI calls. Tune via AI_CONCURRENCY env var.
 *      Keeps the event loop free — other requests (auth, case loads,
 *      navigation) are never blocked by an AI call in progress.
 *
 *   2. Job store (in-memory Map, swappable for Redis).
 *      Each job gets a UUID. Client polls GET /api/jobs/:id.
 *      Job lifecycle: pending → processing → done | failed.
 *      Jobs expire after 15 minutes (prevents memory growth).
 *
 * Swap path: replace jobStore with a Redis adapter (ioredis + bull)
 * when you have a Redis instance. The queue API surface is identical.
 *
 * Usage in a route:
 *
 *   import { enqueue, getJob } from '../services/aiQueue.js';
 *
 *   // Submit
 *   router.post('/generate', authRequired, async (req, res) => {
 *     const jobId = await enqueue('motion', async () => generateMotion(...));
 *     res.json({ jobId, status: 'pending' });
 *   });
 *
 *   // Poll
 *   router.get('/jobs/:id', authRequired, async (req, res) => {
 *     const job = getJob(req.params.id);
 *     if (!job) return res.status(404).json({ error: 'Job not found or expired' });
 *     res.json(job);
 *   });
 */

import { randomUUID } from 'crypto';

// ── Queue configuration ───────────────────────────────────────────────────────
const CONCURRENCY  = parseInt(process.env.AI_CONCURRENCY || '8', 10);
const JOB_TTL_MS   = 15 * 60 * 1000; // 15 minutes
const POLL_WARN_MS = 45 * 1000;       // log warn if job sits > 45s

// ── In-memory job store ───────────────────────────────────────────────────────
// Replace with Redis adapter for multi-instance deployments:
//   const redis = new Redis(process.env.REDIS_URL);
//   async function setJob(id, job) { await redis.setex(`job:${id}`, 900, JSON.stringify(job)); }
//   async function getJobRaw(id)   { const v = await redis.get(`job:${id}`); return v ? JSON.parse(v) : null; }
const jobStore = new Map();

function setJob(id, job)  { jobStore.set(id, { ...job, updatedAt: Date.now() }); }
function getJobRaw(id)    { return jobStore.get(id) || null; }

// Prune expired jobs every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobStore.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) jobStore.delete(id);
  }
}, 5 * 60 * 1000).unref(); // .unref() so this timer doesn't prevent process exit

// ── p-queue import (ESM dynamic import for compatibility) ─────────────────────
let PQueue;
async function getQueue() {
  if (!PQueue) {
    try {
      const mod = await import('p-queue');
      PQueue = mod.default || mod.PQueue;
    } catch {
      // Fallback: simple promise-based queue if p-queue not installed
      PQueue = class SimpleQueue {
        constructor({ concurrency }) { this.concurrency = concurrency; this.running = 0; this.pending = []; }
        async add(fn) {
          if (this.running >= this.concurrency) {
            await new Promise(resolve => this.pending.push(resolve));
          }
          this.running++;
          try { return await fn(); }
          finally {
            this.running--;
            if (this.pending.length > 0) this.pending.shift()();
          }
        }
        get size() { return this.pending.length; }
      };
    }
  }
  if (!getQueue._instance) {
    getQueue._instance = new PQueue({ concurrency: CONCURRENCY });
  }
  return getQueue._instance;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * enqueue(type, fn) — add an AI job to the queue.
 *
 * @param {string}   type - label for logging ('chat'|'motion'|'research'|etc.)
 * @param {Function} fn   - async function that performs the AI call
 * @returns {string}      - jobId (UUID)
 */
// Job timeout wrapper — prevents hung AI calls blocking the queue
const JOB_TIMEOUT_MS = 45_000; // 45s — generous for AI but prevents indefinite hang
const MAX_RETRIES     = 2;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`AI job timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function enqueue(type, fn) {
  const id       = randomUUID();
  const queuedAt = Date.now();

  setJob(id, { id, type, status: 'pending', result: null, error: null, queuedAt });

  const queue = await getQueue();

  // Kick off in background — do NOT await here.
  // This is the key change: the caller gets the jobId immediately.
  queue.add(async () => {
    setJob(id, { ...getJobRaw(id), status: 'processing', startedAt: Date.now() });

    if (Date.now() - queuedAt > POLL_WARN_MS) {
      logger.warn(`[aiQueue] Job ${id} (${type}) waited ${Math.round((Date.now() - queuedAt) / 1000)}s in queue`);
    }

    try {
      const result = await fn();
      setJob(id, { ...getJobRaw(id), status: 'done', result, completedAt: Date.now() });
    } catch (err) {
      logger.error(`[aiQueue] Job ${id} (${type}) failed:`, err.message);
      setJob(id, { ...getJobRaw(id), status: 'failed', error: err.message, completedAt: Date.now() });
    }
  }).catch(err => {
    // Queue itself threw (shouldn't happen) — mark job failed
    setJob(id, { ...(getJobRaw(id) || { id, type }), status: 'failed', error: err.message });
  });

  return id;
}

/**
 * getJob(id) — retrieve job status and result.
 * Returns null if job not found or expired.
 */
export function getJob(id) {
  return getJobRaw(id);
}

/**
 * queueStats() — for monitoring/admin endpoints.
 */
export async function queueStats() {
  try {
  const queue = await getQueue();
  const jobs  = [...jobStore.values()];
  return {
    concurrency:  CONCURRENCY,
    queue_size:   queue.size,
    total_jobs:   jobs.length,
    pending:      jobs.filter(j => j.status === 'pending').length,
    processing:   jobs.filter(j => j.status === 'processing').length,
    done:         jobs.filter(j => j.status === 'done').length,
    failed:       jobs.filter(j => j.status === 'failed').length,
  };

  } catch (err) {
    logger.error('[aiQueue.js/queueStats]', err.message);
    throw err;
  }
}

// ── Queue stats (consumed by /health and /jobs/stats) ────────────────────────
export function getQueueStats() {
  const jobs = Array.from(jobStore.values());
  const pending   = jobs.filter(j => j.status === 'pending').length;
  const running   = jobs.filter(j => j.status === 'running').length;
  const completed = jobs.filter(j => j.status === 'done' || j.status === 'completed').length;
  const failed    = jobs.filter(j => j.status === 'failed').length;
  return {
    total:       jobs.length,
    pending,
    running,
    completed,
    failed,
    concurrency: typeof CONCURRENCY !== 'undefined' ? CONCURRENCY : 3,
  };
}
