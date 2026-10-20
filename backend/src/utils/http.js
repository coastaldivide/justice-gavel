/**
 * http.js — the one way the server calls another service over HTTP.
 *
 *   fetchWithTimeout(url, init, opts) → Response
 *
 * Every outbound call (AI, transcription, e-mail webhooks, push, video, firm
 * integrations, scrapers) goes through here so that none can hang a request
 * or a background job forever:
 *
 *   - timeoutMs (default 15 s): the whole call — connect, headers and body —
 *     is aborted after this long. A caller's own `init.signal` still works
 *     (client disconnected → abort). Timeouts throw an Error with
 *     code 'ETIMEDOUT' / name 'TimeoutError'.
 *   - retries (default 0): extra attempts for transient failures only —
 *     network errors, timeouts, HTTP 408/425/429/500/502/503/504/529. Never
 *     after the caller aborted. Waits with exponential backoff + jitter and
 *     honours Retry-After (capped at maxRetryDelayMs). Only pass retries > 0
 *     for calls that are safe to repeat (reads, idempotent provider APIs,
 *     AI completions that write nothing).
 *
 * For streamed bodies, pass `bodyTimeout: false`: the timeout then covers
 * only the wait for response headers and the caller bounds the stream itself.
 */

export const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

function timeoutError(url, ms) {
  let host = 'remote service';
  try { host = new URL(url).host; } catch { /* keep generic */ }
  return Object.assign(new Error(`Request to ${host} timed out after ${ms} ms`), { name: 'TimeoutError', code: 'ETIMEDOUT' });
}

function retryDelay(attempt, res, base, max) {
  const ra = res?.headers?.get?.('retry-after');
  if (ra) {
    const secs = Number(ra);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(ra) - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, max);
  }
  const exp = base * 2 ** attempt;
  return Math.min(max, exp + Math.floor(Math.random() * base));
}

export async function fetchWithTimeout(url, init = {}, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 0,
  retryDelayMs = 500,
  maxRetryDelayMs = 10_000,
  bodyTimeout = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const callerSignal = init.signal || null;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    timer.unref?.();
    const onCallerAbort = () => ctrl.abort(callerSignal.reason);
    if (callerSignal) {
      if (callerSignal.aborted) { clearTimeout(timer); throw callerSignal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }); }
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      if (!bodyTimeout) clearTimeout(timer);
    } catch (e) {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
      if (callerSignal?.aborted) throw e;
      const err = timedOut ? timeoutError(url, timeoutMs) : e;
      if (attempt < retries) { await sleep(retryDelay(attempt, null, retryDelayMs, maxRetryDelayMs)); continue; }
      throw err;
    }
    if (RETRY_STATUSES.has(res.status) && attempt < retries) {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
      try { await res.body?.cancel?.(); } catch { /* body already consumed or closed */ }
      await sleep(retryDelay(attempt, res, retryDelayMs, maxRetryDelayMs));
      continue;
    }
    if (bodyTimeout) {
      // Keep the timer armed while the caller reads the body; clear it once
      // the body has been fully read (or fails), so it never fires late.
      const clear = () => { clearTimeout(timer); callerSignal?.removeEventListener('abort', onCallerAbort); };
      return wrapBodyReaders(res, clear, () => timedOut, url, timeoutMs);
    }
    // Streamed body (bodyTimeout: false): the caller's signal stays connected
    // ({ once: true } listener), so a caller abort — the person pressed Stop,
    // left, or the caller's own stream timer fired — still cancels the body.
    return res;
  }
}

// Response body readers that clear the timeout when done and turn an abort
// caused by the timeout into a TimeoutError.
function wrapBodyReaders(res, clear, wasTimeout, url, ms) {
  for (const m of ['json', 'text', 'arrayBuffer', 'blob', 'formData']) {
    if (typeof res[m] !== 'function') continue;
    const orig = res[m].bind(res);
    res[m] = async () => {
      try { return await orig(); }
      catch (e) { throw wasTimeout() ? timeoutError(url, ms) : e; }
      finally { clear(); }
    };
  }
  // Callers that never read the body (status-only checks) must not keep the
  // timer alive: it is unref'd, and it is cleared on the first read anyway.
  return res;
}
