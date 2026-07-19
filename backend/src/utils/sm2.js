/**
 * utils/sm2.js — SM-2 Spaced Repetition Algorithm
 * [I-02]
 *
 * Based on Piotr Woźniak's SuperMemo SM-2 (1987).
 * Calculates when a user should next see a question based on their
 * answer quality (0–5) and the card's current easiness factor.
 *
 * Quality scale (used internally — we convert from correct/incorrect):
 *   5 = perfect recall, immediate
 *   4 = correct with slight hesitation
 *   3 = correct with difficulty (bar exam standard: we don't distinguish 3-5)
 *   2 = incorrect but the answer was easy once revealed
 *   1 = incorrect with difficulty
 *   0 = total blackout
 *
 * For bar prep we use a simplified 2-quality system:
 *   correct   → quality 4
 *   incorrect → quality 1
 * This keeps the UX clean (no "how hard was this" slider).
 */

const MIN_EF       = 1.3;   // minimum easiness factor
const INITIAL_EF   = 2.5;   // starting easiness factor
const MAX_INTERVAL = 365;   // cap review interval at 1 year

/**
 * Calculate the next SM-2 state after an answer.
 *
 * @param {object} state - current SR state for this (user, question) pair
 *   { easiness, interval_days, repetitions, times_seen, times_correct }
 * @param {boolean} isCorrect - did the user answer correctly?
 * @returns {object} - new state to persist
 */
export function sm2Next(state, isCorrect) {
  const quality  = isCorrect ? 4 : 1;
  // Guard: null / undefined state means brand-new card — use defaults
  const s = state ?? {};
  let { easiness = INITIAL_EF, interval_days = 1, repetitions = 0 } = s;

  // Update easiness factor
  const newEF = Math.max(
    MIN_EF,
    easiness + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  );

  let newInterval;
  let newRepetitions;

  if (quality < 3) {
    // Incorrect — reset to beginning (show again soon)
    newRepetitions = 0;
    newInterval    = 1;
  } else {
    // Correct
    newRepetitions = repetitions + 1;
    if (repetitions === 0)      newInterval = 1;
    else if (repetitions === 1) newInterval = 6;
    else                        newInterval = Math.min(Math.round(interval_days * newEF), MAX_INTERVAL);
  }

  const nextReviewAt = new Date(Date.now() + newInterval * 24 * 60 * 60 * 1000);

  return {
    easiness:       Math.round(newEF * 100) / 100,
    interval_days:  newInterval,
    repetitions:    newRepetitions,
    last_quality:   quality,
    next_review_at: nextReviewAt.toISOString(),
    times_seen:     (s.times_seen ?? 0) + 1,
    times_correct:  (s.times_correct ?? 0) + (isCorrect ? 1 : 0),
    last_seen_at:   new Date().toISOString(),
  };
}

/**
 * Calculate the quality of a practice session for progress scoring.
 * Returns predicted days until next review for a given accuracy rate.
 */
export function predictRetention(accuracyPct) {
  // Rough heuristic: 80%+ accuracy → shows mastery
  if (accuracyPct >= 90) return 'strong';
  if (accuracyPct >= 75) return 'developing';
  if (accuracyPct >= 60) return 'needs_work';
  return 'weak';
}

/**
 * Given a user's overall accuracy and exam date, calculate daily question goal.
 * More questions per day if exam is close or accuracy is low.
 */
export function calcDailyGoal(accuracyPct, daysUntilExam) {
  if (!daysUntilExam || daysUntilExam <= 0) return 20;  // default

  const urgency = daysUntilExam <= 14 ? 3 :
                  daysUntilExam <= 30 ? 2 :
                  daysUntilExam <= 60 ? 1.5 : 1;

  const weaknessMult = accuracyPct < 60 ? 1.5 :
                       accuracyPct < 75 ? 1.25 : 1;

  return Math.min(50, Math.round(20 * urgency * weaknessMult));
}

/**
 * Shuffle array with a deterministic seed (prevents pattern memorisation
 * while making sessions reproducible for debugging).
 */
export function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
