/**
 * jobPoller.ts — polls /api/jobs/:id until done or failed
 *
 * Usage:
 *   const result = await pollJob(jobId, { onProgress });
 *
 * Options:
 *   intervalMs   — polling interval (default 1500ms)
 *   timeoutMs    — max wait before giving up (default 120s)
 *   onProgress   — called each poll with { status, elapsed }
 */

import { api } from './api';

interface PollOptions {
  intervalMs?: number;
  timeoutMs?:  number;
  onProgress?: (info: { status: string; elapsed: number }) => void;
}

export interface JobResult {
  id:          string;
  type:        string;
  status:      'pending' | 'processing' | 'done' | 'failed';
  result?: unknown;
  error?:      string;
  queuedAt?:   number;
  startedAt?:  number;
  completedAt?:number;
}

export async function pollJob(
  jobId: string,
  options: PollOptions = {}
): Promise<JobResult> {
  const {
    intervalMs = 1_000,   // base interval — grows progressively
    timeoutMs  = 120_000,
    onProgress,
  } = options;

  const start = Date.now();

  return new Promise((resolve, reject) => {
    let pollCount = 0;

    // Progressive backoff: 1s → 1.5s → 2s → 2.5s → 3s → 4s (cap)
    // Fast jobs resolve in 1–2 polls; slow jobs don't hammer the server
    function nextInterval(): number {
      const step = Math.min(pollCount * 500, 3_000);
      return intervalMs + step;
    }

    const tick = async () => {
      const elapsed = Date.now() - start;

      if (elapsed > timeoutMs) {
        reject(new Error('AI request timed out. Please try again.'));
        return;
      }

      try {
        const res  = await api.get(`/jobs/${jobId}`);
        const job: JobResult = res.data;

        pollCount++;
        onProgress?.({ status: job.status, elapsed });

        if (job.status === 'done') {
          resolve(job);
        } else if (job.status === 'failed') {
          reject(new Error(job.error || 'AI request failed. Please try again.'));
        } else {
          // Still pending/processing — back off progressively
          setTimeout(tick, nextInterval());
        }
      } catch (e: unknown) {
        // Network error — use next progressive interval before retrying
        if (elapsed < timeoutMs - 5_000) {
          setTimeout(tick, nextInterval() * 1.5);
        } else {
          reject(new Error('Lost connection while waiting for AI response.'));
        }
      }
    };

    // Start immediately
    tick();
  });
}

/**
 * useJobPoller — React hook for polling a job with loading state.
 *
 * const { loading, result, error, startJob } = useJobPoller();
 *
 * startJob(jobId)   — begins polling, sets loading=true
 * result            — the job.result when done
 * error             — string if failed
 */
import { useState, useCallback, useRef } from 'react';

export function useJobPoller<T = any>() {
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<T | null>(null);
  const [error,    setError]    = useState('');
  const [phase,    setPhase]    = useState('');
  const abortRef = useRef(false);

  const startJob = useCallback(async (jobId: string, opts: PollOptions = {}) => {
    setLoading(true);
    setError('');
    setResult(null);
    abortRef.current = false;

    try {
      const job = await pollJob(jobId, {
        ...opts,
        onProgress: ({ status, elapsed }) => {
          if (abortRef.current) return;
          const sec = Math.round(elapsed / 1000);
          if (status === 'processing') {
            setPhase(sec < 10 ? 'Thinking…' : sec < 30 ? 'Analyzing…' : 'Almost there…');
          } else {
            setPhase('Waiting in queue…');
          }
          opts.onProgress?.({ status, elapsed });
        },
      });
      if (!abortRef.current) {
        setResult(job.result as T);
        setPhase('');
      }
    } catch (e: unknown) {
      if (!abortRef.current) {
        setError(e.message || 'Something went wrong.');
        setPhase('');
      }
    } finally {
      if (!abortRef.current) setLoading(false);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current = true;
    setLoading(false);
    setPhase('');
  }, []);

  return { loading, result, error, phase, startJob, cancel };
}
