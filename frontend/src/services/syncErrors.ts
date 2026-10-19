/**
 * syncErrors.ts — shared by offlineSync.ts (native) and offlineSync.web.ts.
 *
 * A failure worth retrying later: no answer (offline / timeout), signed out
 * (401), rate limited (429) or a server error (5xx). Anything else (400, 403,
 * 404, 409, 413, 422) will never succeed and is marked failed — the case
 * stays on this phone (getOfflineCases) so nothing the person typed is lost.
 */
export function isRetryableSyncError(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status == null || status === 401 || status === 408 || status === 429 || status >= 500;
}
