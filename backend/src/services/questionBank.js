/**
 * services/questionBank.js — Question bank API layer with caching
 * [I-03]
 *
 * Handles all question delivery with:
 *  - Redis caching (60min TTL for subject lists, 10min for user-specific)
 *  - Due-card prioritisation (spaced repetition cards served first)
 *  - Shuffle with per-session seed (no pattern memorisation)
 *  - Exclusion of recently seen cards (unless in review mode)
 */

import { cache, getRedis } from '../utils/redis.js';
import { seededShuffle }   from '../utils/sm2.js';
import { db }              from '../db/index.js';
import logger              from '../utils/logger.js';

const Q_CACHE_TTL     = 3600;  // 1 hour — questions don't change often
const USER_CACHE_TTL  = 600;   // 10 min — user-specific due cards

/**
 * Fetch questions for a session.
 * Priority order:
 *  1. Overdue spaced-repetition cards (next_review_at <= now)
 *  2. New questions (never seen by this user)
 *  3. Review cards (seen, not yet due)
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string[]} opts.subjects   - subject codes, null = all
 * @param {string}   opts.difficulty - 'easy'|'medium'|'hard'|null = all
 * @param {number}   opts.limit      - max questions to return (default 20)
 * @param {string}   opts.mode       - 'practice'|'timed'|'review'|'daily'
 * @param {number}   opts.seed       - shuffle seed (session ID hash)
 */
export async function fetchQuestionsForSession(opts) {
  const {
    userId, subjects = null, difficulty = null,
    limit = 20, mode = 'practice', seed = Date.now(),
  } = opts;

  // Get subject IDs from codes
  const subjectRows = await db.all(
    subjects?.length
      ? `SELECT id FROM bar_subjects WHERE code = ANY(?) AND is_active = true`
      : `SELECT id FROM bar_subjects WHERE is_active = true`,
    subjects?.length ? [subjects] : []
  );
  const subjectIds = subjectRows.map(r => r.id);
  if (!subjectIds.length) return [];

  // ── Step 1: Overdue SR cards (highest priority) ────────────────────────────
  const dueCards = await db.all(`
    SELECT qq.*, srs.next_review_at, srs.easiness, srs.repetitions,
           'due' AS priority
    FROM spaced_repetition_state srs
    JOIN quiz_questions qq ON qq.id = srs.question_id
    WHERE srs.user_id    = ?
      AND qq.subject_id  = ANY(?)
      AND qq.is_active   = true
      AND srs.next_review_at <= NOW()
      ${difficulty ? `AND qq.difficulty = '${difficulty}'` : ''}
    ORDER BY srs.next_review_at ASC
    LIMIT ?
  `, [userId, subjectIds, Math.ceil(limit * 0.4)]);

  const seenIds = new Set(dueCards.map(q => q.id));

  // ── Step 2: New questions (never seen) ────────────────────────────────────
  const newNeeded = limit - dueCards.length;
  const newCards  = newNeeded > 0 ? await db.all(`
    SELECT qq.*, 'new' AS priority
    FROM quiz_questions qq
    WHERE qq.subject_id = ANY(?)
      AND qq.is_active  = true
      AND qq.id NOT IN (
        SELECT question_id FROM spaced_repetition_state WHERE user_id = ?
      )
      ${difficulty ? `AND qq.difficulty = '${difficulty}'` : ''}
    ORDER BY qq.created_at ASC
    LIMIT ?
  `, [subjectIds, userId, newNeeded]) : [];

  newCards.forEach(q => seenIds.add(q.id));

  // ── Step 3: Backfill with review cards if still under limit ───────────────
  const fillNeeded = limit - dueCards.length - newCards.length;
  const fillCards  = fillNeeded > 0 ? await db.all(`
    SELECT qq.*, srs.next_review_at, 'review' AS priority
    FROM spaced_repetition_state srs
    JOIN quiz_questions qq ON qq.id = srs.question_id
    WHERE srs.user_id   = ?
      AND qq.subject_id = ANY(?)
      AND qq.is_active  = true
      AND qq.id NOT IN (${[...seenIds].map(() => '?').join(',') || "''"})
      AND srs.next_review_at > NOW()
      ${difficulty ? `AND qq.difficulty = '${difficulty}'` : ''}
    ORDER BY srs.next_review_at ASC
    LIMIT ?
  `, [userId, subjectIds, ...[...seenIds], fillNeeded]) : [];

  const all = [...dueCards, ...newCards, ...fillCards];

  // Shuffle new/fill (but keep due cards at front for review mode)
  if (mode === 'review') return all;
  const duePart   = all.filter(q => q.priority === 'due');
  const restPart  = seededShuffle(all.filter(q => q.priority !== 'due'), seed);
  return [...duePart, ...restPart].slice(0, limit);
}

/**
 * Get all subjects with user's progress stats.
 * Cached per user for 10 minutes.
 */
export async function getSubjectsWithProgress(userId) {
  const key = `bar:subjects:${userId}`;
  return cache(key, USER_CACHE_TTL, async () => {
    const subjects = await db.all(`
      SELECT bs.*,
             ubp.total_answered,
             ubp.total_correct,
             ubp.accuracy_pct,
             ubp.last_answered,
             -- Due card count
             (SELECT COUNT(*) FROM spaced_repetition_state srs
              JOIN quiz_questions qq ON qq.id = srs.question_id
              WHERE srs.user_id = ? AND qq.subject_id = bs.id
                AND srs.next_review_at <= NOW()) AS due_count
      FROM bar_subjects bs
      LEFT JOIN user_bar_performance ubp
             ON ubp.subject_id = bs.id AND ubp.user_id = ?
      WHERE bs.is_active = true
      ORDER BY bs.sort_order
    `, [userId, userId]);
    return subjects;
  });
}

/**
 * Invalidate a user's cached progress after they answer questions.
 */
export async function invalidateUserCache(userId) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(`bar:subjects:${userId}`);
  } catch { /* non-critical */ }
}
