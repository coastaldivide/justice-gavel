/**
 * idempotency.ts — the create endpoints the server de-duplicates with an
 * `Idempotency-Key` header (backend/src/middleware/idempotency.js
 * IDEMPOTENT_POST_PATHS — the backend test idempotency_parity.test.js keeps the
 * two lists identical).
 *
 * services/api.ts sends a fresh key with every POST to one of these paths and,
 * when the connection drops or times out before an answer arrives, retries
 * with the SAME key: the server then replays the first response instead of
 * creating a second case / message / reminder / SOS alert.
 */
export const IDEMPOTENT_POST_PATHS = [
  '/api/cases',
  '/api/cases/:id/events',
  '/api/cases/:id/reminders',
  '/api/cases/:id/counsel',
  '/api/cases/:id/invite',
  '/api/messages/:caseId',
  '/api/push/reminders',
  '/api/saved/lawyers',
  '/api/reviews',
  '/api/feedback',
  '/api/feedback/ui',
  '/api/alerts',
  '/api/family/contacts',
  '/api/alerts/family-contacts',
  '/api/arrests/monitors',
  '/api/consultations/book',
  '/api/consultations/callback-request',
  '/api/court-dates',
  '/api/cases/:id/followers',
  '/api/following/accept',
  '/api/help/reports',
  '/api/help/claims',
] as const;

const PATH_RES = IDEMPOTENT_POST_PATHS.map(p =>
  new RegExp(`^${p.replace(/^\/api/, '').replace(/:[A-Za-z]+/g, '[^/?#]+')}/?(\\?.*)?$`));

/** True when a POST to this API path (relative to the API base, e.g. '/cases') is de-duplicated. */
export function isIdempotentPost(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');
  return PATH_RES.some(re => re.test(path));
}

/** A new random key (RFC 4122 v4 where available). */
export function newIdempotencyKey(): string {
  const c: { randomUUID?: () => string } | undefined = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
