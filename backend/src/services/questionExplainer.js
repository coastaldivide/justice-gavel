import { CLAUDE_MODEL, aiConfigured } from '../utils/ai.js';
import { sdkMessagesCreate } from './aiClient.js';
/**
 * services/questionExplainer.js — AI explanation pipeline via BullMQ
 * [I-04]
 *
 * Generates a deep-dive explanation for each MBE question using Claude.
 * Key design decisions:
 *  - Explanations are generated ONCE, cached in DB forever (ai_explanation col)
 *  - First user to request an explanation triggers the BullMQ job
 *  - Subsequent users get the cached result instantly (zero Claude cost)
 *  - All generations logged to ai_usage_log for cost tracking
 */

import { Queue, Worker } from 'bullmq';
import Redis        from 'ioredis';
import { db }       from '../db/index.js';
import logger       from '../utils/logger.js';

const CLAUDE = CLAUDE_MODEL;
// BullMQ needs its own ioredis connection with maxRetriesPerRequest: null
const connection = (process.env.REDIS_URL && process.env.NODE_ENV !== 'test')
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false })
  : null;
connection?.on('error', (e) => logger.error({ msg: '[explainer] redis error', error: e.message }));

// ── Queue ─────────────────────────────────────────────────────────────────────
export const explainerQueue = connection
  ? new Queue('bar-explain', { connection })
  : null;

/**
 * Get an explanation for a question.
 * Returns cached result immediately if available, otherwise queues generation.
 *
 * @returns { explanation, status: 'cached'|'generating'|'queued' }
 */
export async function getExplanation(questionId, userId) {
  // Check DB cache first (permanent)
  const q = await db.get(
    'SELECT ai_explanation, explanation, stem, option_a, option_b, option_c, option_d, correct_answer, rule, case_citation FROM quiz_questions WHERE id = ?',
    [questionId]
  );
  if (!q) return { explanation: null, status: 'not_found' };

  // Already generated — return immediately
  if (q.ai_explanation) {
    return { explanation: q.ai_explanation, status: 'cached' };
  }

  // No AI provider: serve the curated explanation that ships with the question
  if (!aiConfigured()) {
    return { explanation: q.explanation ?? null, status: q.explanation ? 'static' : 'unavailable' };
  }

  // Queue generation if we have a queue, otherwise generate synchronously
  if (explainerQueue) {
    await explainerQueue.add('explain', { questionId, userId }, {
      attempts:         2,
      backoff:          { type: 'fixed', delay: 3000 },
      removeOnComplete: { count: 20 },
    });
    return { explanation: q.explanation ?? null, status: 'generating' };
  } else {
    // Synchronous fallback (no Redis)
    try {
      const result = await generateExplanation(q, questionId, userId);
      return { explanation: result, status: 'cached' };
    } catch (e) {
      // AI busy / down / over budget: the curated explanation that ships with the question still helps.
      logger.warn({ err: e.message, questionId }, '[explainer] AI unavailable — serving the static explanation');
      return { explanation: q.explanation ?? null, status: q.explanation ? 'static' : 'unavailable' };
    }
  }
}

/**
 * Generate and store explanation via Claude.
 * Called by the BullMQ worker.
 */
export async function generateExplanation(q, questionId, userId) {
  const { stem, option_a, option_b, option_c, option_d, correct_answer, rule, case_citation } = q;

  const prompt = `You are an expert bar exam tutor. Explain this MBE question thoroughly.

QUESTION:
${stem}

OPTIONS:
A) ${option_a}
B) ${option_b}
C) ${option_c}
D) ${option_d}

CORRECT ANSWER: ${correct_answer}
RULE: ${rule ?? 'Not specified'}
CASE: ${case_citation ?? 'Not specified'}

Provide:
1. WHY ${correct_answer} IS CORRECT: (2-3 sentences explaining the legal rule applied)
2. WHY A IS WRONG: (1 sentence)${correct_answer === 'A' ? ' (this IS the correct answer — skip)' : ''}
3. WHY B IS WRONG: (1 sentence)${correct_answer === 'B' ? ' (this IS the correct answer — skip)' : ''}
4. WHY C IS WRONG: (1 sentence)${correct_answer === 'C' ? ' (this IS the correct answer — skip)' : ''}
5. WHY D IS WRONG: (1 sentence)${correct_answer === 'D' ? ' (this IS the correct answer — skip)' : ''}
6. MEMORY HOOK: One memorable phrase to remember this rule.

Be concise and bar-exam focused. Cite the specific rule, statute, or case.`;

  // Budget check, timeout/retries and metering (ai_usage_log): aiClient.
  const res = await sdkMessagesCreate({
    model:      CLAUDE,
    max_tokens: 600,
    system:     'You are a bar exam expert. Give precise, cited explanations. No fluff.',
    messages:   [{ role: 'user', content: prompt }],
  }, { route: 'bar_explain', userId });

  const explanation = res.content[0]?.text ?? '';
  const costUsd     = res._cost_usd ?? 0;

  // Store permanently in DB
  await db.run(
    `UPDATE quiz_questions
     SET ai_explanation = ?, ai_generated_at = NOW()
     WHERE id = ?`,
    [explanation, questionId]
  );

  logger.info({ msg: '[explainer] generated', questionId, cost_usd: costUsd.toFixed(6) });
  return explanation;
}

/**
 * Start the BullMQ explainer worker.
 * Called from app.js startup.
 */
export function startExplainerWorker() {
  if (!connection) {
    logger.warn('[explainer] No Redis — explanations generated synchronously');
    return;
  }
  const worker = new Worker('bar-explain', async (job) => {
    const { questionId, userId } = job.data;
    const q = await db.get('SELECT * FROM quiz_questions WHERE id = ?', [questionId]);
    if (!q || q.ai_explanation) return; // already generated
    await generateExplanation(q, questionId, userId);
  }, { connection, concurrency: 2 });

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[explainer] job failed', id: job?.id, err: err.message });
  });
  logger.info('[explainer] worker started (concurrency: 2)');
}
