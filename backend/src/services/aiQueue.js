import { CLAUDE_MODEL, aiConfigured } from '../utils/ai.js';
/**
 * services/aiQueue.js — BullMQ job queue for AI (Claude) calls
 *
 * Problem: Claude API calls are synchronous and can take 3–15 seconds.
 * Under load, these calls timeout and block the event loop.
 *
 * Solution: Queue AI jobs with BullMQ. Client gets a job_id immediately,
 * polls /api/jobs/:id for the result, or receives it via WebSocket.
 *
 * Queues:
 *   ai-legal-chat:     Real-time chat (high priority, 30s timeout)
 *   ai-research:       Legal research jobs (medium priority, 60s timeout)
 *   ai-document:       Document analysis (low priority, 120s timeout)
 *   ai-motion-gen:     Motion generation (low priority, 90s timeout)
 *   bar-verification:  Nightly attorney verification sweep
 */

import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import { db } from '../db/index.js';

// ── Redis connection for BullMQ ─────────────────────────────────────────────
// BullMQ requires an ioredis instance with maxRetriesPerRequest: null (blocking
// commands). Without REDIS_URL (or in tests) no queues are created and AI jobs
// execute in-process (enqueueAIJob → executeAIJob).
function createBullConnection() {
  const url = process.env.REDIS_URL;
  if (!url || process.env.NODE_ENV === 'test') return null;
  try {
    const conn = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false });
    conn.on('error', (err) => logger.error({ msg: '[ai_queue] redis error', error: err.message }));
    return conn;
  } catch (e) {
    logger.error({ msg: '[ai_queue] could not create redis connection', error: e.message });
    return null;
  }
}
const connection = createBullConnection();

// ── Queue definitions ──────────────────────────────────────────────────────
export const aiChatQueue     = connection ? new Queue('ai-legal-chat',    { connection }) : null;
export const aiResearchQueue = connection ? new Queue('ai-research',      { connection }) : null;
export const aiDocumentQueue = connection ? new Queue('ai-document',      { connection }) : null;
export const aiMotionQueue   = connection ? new Queue('ai-motion-gen',    { connection }) : null;
export const barVerifyQueue  = connection ? new Queue('bar-verification', { connection }) : null;

// Anthropic client is created lazily — the SDK throws if constructed without a key.
let _anthropic = null;
function anthropicClient() {
  if (!aiConfigured()) {
    const e = new Error('AI provider not configured (ANTHROPIC_API_KEY missing)');
    e.status = 503; e.code = 'ai_unavailable';
    throw e;
  }
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ── In-process job store ────────────────────────────────────────────────────
// Routes enqueue closures: enqueueAIJob('chat', async () => {...}, userId).
// Closures cannot be serialised into Redis, so they always run in this process
// with bounded concurrency; clients poll GET /api/jobs/:id.
//   statuses: pending → processing → done | failed
//   TTL 15 min after completion; per-job timeout 45 s (JOB_TIMEOUT_MS env).
const JOB_TTL_MS      = 15 * 60 * 1000;
const JOB_TIMEOUT_MS  = parseInt(process.env.AI_JOB_TIMEOUT_MS || '45000', 10);
const MAX_CONCURRENCY = parseInt(process.env.AI_CONCURRENCY || '8', 10);
const _jobs    = new Map();   // id → job
const _pending = [];          // ids waiting for a slot
let   _running = 0;
let   _done    = 0;
let   _failed  = 0;

function _pump() {
  while (_running < MAX_CONCURRENCY && _pending.length) {
    const id  = _pending.shift();
    const job = _jobs.get(id);
    if (!job) continue;
    _running++;
    job.status    = 'processing';
    job.startedAt = new Date().toISOString();
    let timer;
    Promise.race([
      Promise.resolve().then(() => job._fn()),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Job timed out after ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS); timer.unref?.(); }),
    ])
      .then(result => { job.status = 'done'; job.result = result ?? null; _done++; })
      .catch(err => {
        job.status = 'failed';
        _failed++;
        job.error  = err?.code === 'ai_unavailable' || err?.status === 503
          ? 'AI features are not available right now.'
          : (err?.message || 'Job failed');
        logger.error({ msg: '[ai_queue] in-process job failed', id, type: job.type, error: err?.message });
      })
      .finally(() => {
        clearTimeout(timer);
        job.completedAt = new Date().toISOString();
        delete job._fn;
        _running--;
        const t = setTimeout(() => _jobs.delete(id), JOB_TTL_MS);
        t.unref?.();
        _pump();
      });
  }
}

function enqueueLocal(type, fn, userId) {
  const id = randomUUID();
  _jobs.set(id, { id, type, userId: userId ?? null, status: 'pending', queuedAt: new Date().toISOString(), _fn: fn });
  _pending.push(id);
  setImmediate(_pump);
  return id;
}

/**
 * enqueue — in-process job API.
 *   enqueue(type, async () => result, userId?) → job id
 *   enqueue({ type, userId, payload, handler }) → job id
 */
export async function enqueue(typeOrJob, fn, userId) {
  if (typeOrJob && typeof typeOrJob === 'object') {
    const { type = 'job', userId: uid = null, payload = null, handler } = typeOrJob;
    return await enqueueLocal(type, typeof handler === 'function' ? handler : () => Promise.resolve(payload), uid);
  }
  return await enqueueLocal(String(typeOrJob || 'job'), typeof fn === 'function' ? fn : () => Promise.resolve(fn ?? null), userId);
}

/**
 * Add an AI job.
 *   enqueueAIJob(type, async () => result, userId?) → job id (string); poll /api/jobs/:id
 *   enqueueAIJob(type, { prompt, systemPrompt, maxTokens }, userId)
 *       → with Redis: { job_id, status: 'queued' } (BullMQ)
 *       → without Redis: executes in-process and returns the result
 */
export async function enqueueAIJob(type, payload, userId) {
  const uid = (userId && typeof userId === 'object') ? userId.userId : userId;
  if (typeof payload === 'function') return enqueueLocal(type, payload, uid);

  const queue = {
    chat:     aiChatQueue,
    research: aiResearchQueue,
    document: aiDocumentQueue,
    motion:   aiMotionQueue,
  }[type];

  if (!queue) {
    return await executeAIJob(type, payload, uid);
  }

  const priority = { chat: 1, research: 3, document: 5, motion: 4 }[type] ?? 3;
  const job = await queue.add(`${type}-${uid}`, { ...payload, userId: uid }, {
    priority,
    attempts:   3,
    backoff:    { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 50 },
  });

  return { job_id: job.id, status: 'queued', estimated_wait_ms: priority * 2000 };
}

/**
 * Execute an AI job directly (worker body, or in-process when no Redis).
 */
export async function executeAIJob(type, payload, userId) {
  const { prompt, systemPrompt, maxTokens = 1000 } = payload;
  const t0 = Date.now();

  try {
    const response = await anthropicClient().messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt ?? 'You are a legal information assistant. Provide accurate legal information, not legal advice.',
      messages:   [{ role: 'user', content: prompt }],
    });

    const content     = response.content[0]?.text ?? '';
    const inputTokens = response.usage.input_tokens;
    const outputTokens= response.usage.output_tokens;
    const costUsd     = (inputTokens * 0.000003) + (outputTokens * 0.000015);
    const durationMs  = Date.now() - t0;

    await db.run(
      `INSERT INTO ai_usage_log (user_id, endpoint, model, input_tokens, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId ?? null, type, CLAUDE_MODEL, inputTokens, outputTokens, costUsd]
    ).catch(e => logger.warn('[ai_queue] usage log failed:', e.message));

    return { content, job_id: null, status: 'completed', cost_usd: costUsd, duration_ms: durationMs };

  } catch (err) {
    logger.error({ msg: '[ai_queue] executeAIJob failed', type, error: err.message });
    throw err;
  }
}

/**
 * Start BullMQ workers (called once by server.js at startup).
 */
const _workers = [];
export function startAIWorkers() {
  if (!connection) {
    logger.info('[ai_queue] REDIS_URL not set — AI jobs run in-process (no BullMQ workers)');
    return [];
  }
  if (_workers.length) return _workers;

  const workerOpts = { connection, concurrency: 5 };
  const specs = [
    ['ai-legal-chat', 'chat',     5],
    ['ai-research',   'research', 3],
    ['ai-document',   'document', 2],
    ['ai-motion-gen', 'motion',   2],
  ];
  for (const [queueName, type, concurrency] of specs) {
    const w = new Worker(queueName, async (job) => await executeAIJob(type, job.data, job.data.userId),
      { ...workerOpts, concurrency });
    w.on('failed', (job, err) => logger.error({ msg: '[ai_queue] job failed', id: job?.id, error: err.message }));
    w.on('error',  (err) => logger.error({ msg: '[ai_queue] worker error', error: err.message }));
    _workers.push(w);
  }
  logger.info('[ai_queue] BullMQ AI workers started (4 queues)');
  return _workers;
}

export async function stopAIWorkers() {
  await Promise.allSettled(_workers.map(w => w.close()));
  _workers.length = 0;
  await Promise.allSettled([aiChatQueue, aiResearchQueue, aiDocumentQueue, aiMotionQueue, barVerifyQueue]
    .filter(Boolean).map(q => q.close()));
  if (connection) { try { connection.disconnect(); } catch { /* ignore */ } }
}

// ── Queue inspection helpers (used by routes/jobs.js) ──────────────────────
/** getJob(id) — synchronous lookup in the in-process store (null if unknown/expired). */
export function getJob(jobId) {
  const local = _jobs.get(String(jobId));
  if (!local) return null;
  const { _fn, ...pub } = local;
  return pub;
}

/** getJobAsync(id) — in-process store first, then BullMQ queues (when Redis is configured). */
export async function getJobAsync(jobId) {
  const local = getJob(jobId);
  if (local) return local;
  const allQueues = [aiChatQueue, aiResearchQueue, aiDocumentQueue, aiMotionQueue];
  for (const q of allQueues) {
    if (!q) continue;
    try {
      const job = await q.getJob(jobId);
      if (job) {
        const state = await job.getState();
        const status = state === 'completed' ? 'done' : state === 'failed' ? 'failed'
          : state === 'active' ? 'processing' : 'pending';
        return {
          id: job.id, type: q.name, userId: job.data?.userId ?? null, status,
          result: job.returnvalue ?? null, error: job.failedReason ?? null,
          queuedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
          startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
          completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        };
      }
    } catch { /* try next queue */ }
  }
  return null;
}

/** getQueueStats() — synchronous in-process stats (used by /health and /metrics). */
export function getQueueStats() {
  return {
    mode:        connection ? 'bullmq+in-process' : 'in-process',
    concurrency: MAX_CONCURRENCY,
    total:       _jobs.size,
    pending:     _pending.length,
    processing:  _running,
    running:     _running,
    done:        _done,
    completed:   _done,
    failed:      _failed,
  };
}

/** queueStats() — async: in-process stats plus BullMQ queue counts when Redis is configured. */
export async function queueStats() {
  const local = getQueueStats();
  const out = { ...local, total_jobs: local.total };
  if (!connection) return out;
  const queues = { chat: aiChatQueue, research: aiResearchQueue, document: aiDocumentQueue, motion: aiMotionQueue };
  out.bullmq = {};
  for (const [name, q] of Object.entries(queues)) {
    try {
      out.bullmq[name] = {
        waiting:   await q.getWaitingCount(),
        active:    await q.getActiveCount(),
        completed: await q.getCompletedCount(),
        failed:    await q.getFailedCount(),
      };
    } catch { out.bullmq[name] = { error: true }; }
  }
  return out;
}

