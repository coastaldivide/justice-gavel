/**
 * jobPoller.ts — polls GET /api/jobs/:id until the AI job is done or failed.
 *
 *   const job = await pollJob(jobId, { signal, timeoutMs, onProgress });
 *
 * Rejects with JobError:
 *   code  ai_unavailable | ai_busy | ai_timeout | ai_failed — from the server
 *         (its `error` text is already in the app language);
 *         'timeout' — no answer within timeoutMs; 'lost' — the connection kept
 *         failing; 'expired' — the job is gone (server restarted / 15 min TTL);
 *         'aborted' — the caller's signal fired (Stop / left the screen).
 *   message  always a sentence in the app language.
 */
import { api } from './api';
import { t } from '../i18n';

interface PollOptions {
  intervalMs?: number;
  timeoutMs?:  number;
  signal?:     AbortSignal;
  onProgress?: (info: { status: string; elapsed: number }) => void;
}

export interface JobResult {
  id:          string;
  type:        string;
  status:      'pending' | 'processing' | 'done' | 'failed';
  result?:     unknown;
  code?:       string | null;
  error?:      string | null;
  queuedAt?:   string;
  startedAt?:  string | null;
  completedAt?:string | null;
}

export class JobError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function jobErrorText(code: string): string {
  switch (code) {
    case 'ai_unavailable': return t('x_api_ai_features_temporarily_unavailable');
    case 'ai_busy':        return t('chat_err_busy');
    case 'timeout':
    case 'ai_timeout':     return t('chat_err_timeout');
    case 'lost':           return t('chat_err_connection_lost');
    case 'expired':        return t('job_err_expired');
    default:               return t('x_error_state_something_went_wrong_please');
  }
}

export function pollJob(jobId: string, options: PollOptions = {}): Promise<JobResult> {
  const { intervalMs = 1_000, timeoutMs = 120_000, signal, onProgress } = options;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let pollCount = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => { if (timer) clearTimeout(timer); reject(new JobError('aborted', '')); };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (fn: () => void) => { signal?.removeEventListener('abort', onAbort); fn(); };

    // Progressive backoff: 1s → 1.5s → 2s → … → 4s (cap)
    const nextInterval = () => intervalMs + Math.min(pollCount * 500, 3_000);

    const tick = async () => {
      if (signal?.aborted) return;
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) return finish(() => reject(new JobError('timeout', jobErrorText('timeout'))));
      try {
        const res = await api.get<JobResult>(`/jobs/${jobId}`, { signal });
        if (signal?.aborted) return;
        const job = res.data;
        pollCount++;
        failures = 0;
        onProgress?.({ status: job.status, elapsed });
        if (job.status === 'done') return finish(() => resolve(job));
        if (job.status === 'failed') {
          const code = job.code || 'ai_failed';
          return finish(() => reject(new JobError(code, job.error || jobErrorText(code))));
        }
        timer = setTimeout(tick, nextInterval());
      } catch (e) {
        if (signal?.aborted) return;
        if ((e as { response?: { status?: number } })?.response?.status === 404) {
          return finish(() => reject(new JobError('expired', jobErrorText('expired'))));
        }
        failures++;
        if (failures >= 5 || elapsed > timeoutMs - 5_000) return finish(() => reject(new JobError('lost', jobErrorText('lost'))));
        timer = setTimeout(tick, nextInterval() * 1.5);
      }
    };
    tick();
  });
}
