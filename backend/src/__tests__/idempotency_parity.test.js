/**
 * idempotency_parity.test.js — the app (frontend/src/constants/idempotency.ts)
 * sends Idempotency-Key and retries exactly on the paths the server
 * de-duplicates (middleware/idempotency.js). A path only on the app side would
 * be retried WITHOUT server protection (duplicates); one only on the server
 * side would never get a key.
 */
import fs from 'fs';
import { IDEMPOTENT_POST_PATHS, isIdempotentPost } from '../middleware/idempotency.js';

const REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname);

test('frontend and backend idempotent path lists are identical', () => {
  const src = fs.readFileSync(`${REPO}/frontend/src/constants/idempotency.ts`, 'utf8');
  const block = src.slice(src.indexOf('IDEMPOTENT_POST_PATHS = ['), src.indexOf('] as const'));
  const fe = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  expect(fe).toEqual(IDEMPOTENT_POST_PATHS);
});

test('server path matcher: create routes yes, everything else no', () => {
  expect(isIdempotentPost('POST', '/api/cases')).toBe(true);
  expect(isIdempotentPost('POST', '/api/cases/12/events')).toBe(true);
  expect(isIdempotentPost('POST', '/api/messages/7')).toBe(true);
  expect(isIdempotentPost('GET', '/api/cases')).toBe(false);
  expect(isIdempotentPost('POST', '/api/auth/login')).toBe(false);     // responses carry tokens
  expect(isIdempotentPost('POST', '/api/cases/12/share')).toBe(false); // response carries a share token
  expect(isIdempotentPost('POST', '/api/billing/subscribe')).toBe(false);
});
