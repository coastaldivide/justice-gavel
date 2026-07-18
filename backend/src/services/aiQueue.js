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

import { Queue, Worker, QueueEvents } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { getRedis } from '../utils/redis.js';
import logger from '../utils/logger.js';
import { db } from '../db/index.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const connection   = { client: getRedis() };

// ── Queue definitions ──────────────────────────────────────────────────────
export const aiChatQueue     = connection.client ? new Queue('ai-legal-chat', { connection }) : null;
export const aiResearchQueue = connection.client ? new Queue('ai-research',   { connection }) : null;
export const aiDocumentQueue = connection.client ? new Queue('ai-document',   { connection }) : null;
export const aiMotionQueue   = connection.client ? new Queue('ai-motion-gen', { connection }) : null;
export const barVerifyQueue  = connection.client ? new Queue('bar-verification', { connection }) : null;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Add an AI job to the appropriate queue.
 * Returns { job_id } immediately — client polls /api/jobs/:job_id
 */
export async function enqueueAIJob(type, payload, userId) {
  const queue = {
    chat:     aiChatQueue,
    research: aiResearchQueue,
    document: aiDocumentQueue,
    motion:   aiMotionQueue,
  }[type];

  if (!queue) {
    // No Redis — execute synchronously (graceful degradation)
    return await executeAIJob(type, payload, userId);
  }

  const priority = { chat: 1, research: 3, document: 5, motion: 4 }[type] ?? 3;
  const job = await queue.add(`${type}-${userId}`, { ...payload, userId }, {
    priority,
    attempts:   3,
    backoff:    { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 50 },
  });

  // Log AI cost estimate
  await db.run(
    `INSERT INTO ai_usage_log (job_id, user_id, route, status, queued_at)
     VALUES (?, ?, ?, 'queued', NOW())`,
    [job.id, userId, type]
  ).catch(() => {}); // non-critical

  return { job_id: job.id, status: 'queued', estimated_wait_ms: priority * 2000 };
}

/**
 * Execute an AI job directly (used when no Redis is available)
 */
export async function executeAIJob(type, payload, userId) {
  const { prompt, systemPrompt, maxTokens = 1000 } = payload;
  const t0 = Date.now();

  try {
    const response = await anthropic.messages.create({
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

    // Track costs
    await db.run(
      `INSERT INTO ai_usage_log
         (user_id, route, model, input_tokens, output_tokens, cost_usd, duration_ms, status, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', NOW())`,
      [userId, type, CLAUDE_MODEL, inputTokens, outputTokens, costUsd, durationMs]
    ).catch(() => {});

    return { content, job_id: null, status: 'completed', cost_usd: costUsd };

  } catch (err) {
    logger.error({ msg: '[ai_queue] executeAIJob failed', type, error: err.message });
    throw err;
  }
}

/**
 * Start BullMQ workers (call in app.js startup)
 */
export function startAIWorkers() {
  if (!connection.client) {
    logger.warn('[ai_queue] No Redis — workers not started, AI calls are synchronous');
    return;
  }

  const workerOpts = { connection, concurrency: 5 };

  const worker = new Worker('ai-legal-chat', async (job) => {
    return executeAIJob('chat', job.data, job.data.userId);
  }, workerOpts);

  const researchWorker = new Worker('ai-research', async (job) => {
    return executeAIJob('research', job.data, job.data.userId);
  }, { ...workerOpts, concurrency: 3 });

  const docWorker = new Worker('ai-document', async (job) => {
    return executeAIJob('document', job.data, job.data.userId);
  }, { ...workerOpts, concurrency: 2 });

  const motionWorker = new Worker('ai-motion-gen', async (job) => {
    return executeAIJob('motion', job.data, job.data.userId);
  }, { ...workerOpts, concurrency: 2 });

  [worker, researchWorker, docWorker, motionWorker].forEach(w => {
    w.on('failed', (job, err) => {
      logger.error({ msg: '[ai_queue] job failed', id: job?.id, error: err.message });
    });
    w.on('completed', (job) => {
      logger.debug({ msg: '[ai_queue] job completed', id: job.id });
    });
  });

  logger.info('[ai_queue] BullMQ AI workers started (4 queues, 12 concurrency)');
}
