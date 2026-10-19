/**
 * idempotency.js — `Idempotency-Key` support for create endpoints.
 *
 * A POST carrying `Idempotency-Key: <8–128 chars [A-Za-z0-9_.:-]>`:
 *   - first time: the key is reserved (status 'pending') and the request runs;
 *     a 2xx JSON response is stored with the key (status 'done'); any other
 *     outcome releases the key so a retry runs again;
 *   - same key again, same request: the stored status + body is replayed with
 *     `Idempotent-Replayed: true` — nothing is created twice;
 *   - same key while the first is still running: 409 idempotency_in_progress
 *     (Retry-After: 1);
 *   - same key, different body or path: 422 idempotency_key_reused.
 * Without the header nothing changes.
 *
 * Keys are scoped to the caller: a hash of the Authorization header, or of
 * the client IP for anonymous calls (feedback, SOS from a guest), so nobody
 * can replay someone else's response. Rows live 24 h (table
 * idempotency_keys, migration 19). Mounted in app.js on the create routes the
 * app calls (IDEMPOTENT_POST_PATHS) — none of which returns credentials.
 *
 * Storage failure fails OPEN (the request runs as if no key was sent) and is
 * logged: duplicate protection must never take a create endpoint down.
 */
import { createHash } from 'node:crypto';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';

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
];

const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const TTL_HOURS = 24;
const sha = (s) => createHash('sha256').update(s).digest('hex');

function scopeOf(req) {
  const auth = req.headers.authorization;
  return auth ? `a:${sha(String(auth)).slice(0, 40)}` : `ip:${sha(String(req.ip || '')).slice(0, 40)}`;
}

let _inserted = 0;
async function purgeExpired(db) {
  await db.run(`DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '${TTL_HOURS} hours'`);
}
export { purgeExpired as purgeExpiredIdempotencyKeys };

export function idempotency() {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.headers['idempotency-key'];
    if (key === undefined || req.method !== 'POST') return next();
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      return res.status(400).json({ error: 'invalid_idempotency_key', message: 'Idempotency-Key must be 8–128 characters (letters, digits, _ . : -).' });
    }
    const scope = scopeOf(req);
    const fingerprint = sha(`${req.method} ${String(req.originalUrl || req.url).split('?')[0]} ${JSON.stringify(req.body ?? null)}`);
    let db;
    try {
      db = await getDb();
      const ins = await db.run(
        `INSERT INTO idempotency_keys (scope, key, fingerprint) VALUES (?, ?, ?) ON CONFLICT (scope, key) DO NOTHING`,
        [scope, key, fingerprint]
      );
      if (!ins?.changes) {
        const row = await db.get('SELECT fingerprint, status, response_status, response_body, created_at FROM idempotency_keys WHERE scope = ? AND key = ?', [scope, key]);
        if (row && Date.now() - new Date(row.created_at).getTime() > TTL_HOURS * 3600_000) {
          // Expired key: start over.
          await db.run('DELETE FROM idempotency_keys WHERE scope = ? AND key = ?', [scope, key]);
          return idempotencyMiddleware(req, res, next);
        }
        if (!row) return next();
        if (row.fingerprint !== fingerprint) {
          return res.status(422).json({ error: 'idempotency_key_reused', message: 'This Idempotency-Key was already used for a different request.' });
        }
        if (row.status !== 'done') {
          res.setHeader('Retry-After', '1');
          return res.status(409).json({ error: 'idempotency_in_progress', message: 'The same request is still being processed.' });
        }
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(Number(row.response_status) || 200);
        return res.type('application/json').send(row.response_body ?? 'null');
      }
      if (++_inserted % 500 === 0) purgeExpired(db).catch(e => logger.warn({ err: e.message }, '[idempotency] purge failed'));
    } catch (e) {
      logger.warn({ err: e.message }, '[idempotency] key storage unavailable — request runs without duplicate protection');
      return next();
    }

    // Capture the response the route sends.
    let captured = null;
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (captured === null) captured = body === undefined ? null : JSON.stringify(body);
      return origJson(body);
    };
    res.on('finish', () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300 && captured !== null;
      const done = ok
        ? db.run(`UPDATE idempotency_keys SET status = 'done', response_status = ?, response_body = ?, completed_at = NOW() WHERE scope = ? AND key = ?`,
          [res.statusCode, captured, scope, key])
        : db.run('DELETE FROM idempotency_keys WHERE scope = ? AND key = ?', [scope, key]);
      done.catch(e => logger.warn({ err: e.message }, '[idempotency] could not finalise key'));
    });
    res.on('close', () => {
      if (!res.writableFinished) {
        db.run('DELETE FROM idempotency_keys WHERE scope = ? AND key = ? AND status = ?', [scope, key, 'pending'])
          .catch(e => logger.warn({ err: e.message }, '[idempotency] could not release key'));
      }
    });
    return next();
  };
}
