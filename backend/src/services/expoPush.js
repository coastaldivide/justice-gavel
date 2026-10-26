/**
 * services/expoPush.js — the one Expo push client (every push in the app goes
 * through sendExpoPush), with an injectable endpoint.
 *
 * expo-server-sdk hard-codes https://exp.host, which makes the delivery path
 * impossible to exercise end-to-end in tests or staging. This client speaks the
 * same documented API (POST <base>/push/send, JSON array of messages, one ticket
 * per message; POST <base>/push/getReceipts { ids }) and reads the base URL from
 * EXPO_PUSH_API_URL (default https://exp.host/--/api/v2). EXPO_ACCESS_TOKEN is
 * sent as a bearer token when set (required only if "enhanced push security"
 * is on in Expo).
 *
 * Dead devices: a ticket with DeviceNotRegistered removes that token at once;
 * every accepted ticket is recorded (push_tickets) so checkPushReceipts() can
 * fetch its receipt later — Expo reports most dead devices only there — and
 * remove those tokens too.
 */
import logger from '../utils/logger.js';

const DEFAULT_BASE = 'https://exp.host/--/api/v2';
const CHUNK = 100;               // Expo's per-request message limit
const RECEIPT_CHUNK = 300;       // Expo's per-request receipt id limit
const TIMEOUT_MS = 15_000;

export function expoPushBaseUrl() {
  return String(process.env.EXPO_PUSH_API_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** Same rule as Expo.isExpoPushToken in expo-server-sdk. */
export function isExpoPushToken(token) {
  return typeof token === 'string' && token.length <= 200 && (
    ((token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) && token.endsWith(']'))
    || /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(token)
  );
}

async function expoPost(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    const res = await fetch(`${expoPushBaseUrl()}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function dbOrNull() {
  try { const { getDb } = await import('../db/index.js'); return await getDb(); } catch { return null; }
}

/** Remove a token Expo says belongs to no device any more. */
export async function forgetPushToken(db, token) {
  if (!db || !token) return;
  await db.run('DELETE FROM push_tokens WHERE token = ?', [token]).catch(e => logger.warn({ err: e.message }, '[expoPush] token cleanup failed'));
  await db.run('UPDATE users SET push_token = NULL WHERE push_token = ?', [token]).catch(e => logger.warn({ err: e.message }, '[expoPush] token cleanup failed'));
}

async function afterSend(messages, tickets) {
  const db = await dbOrNull();
  if (!db) return;
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i]; const to = messages[i]?.to;
    if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
      await forgetPushToken(db, to);
      logger.info('[expoPush] removed a token Expo no longer knows (ticket)');
    } else if (t?.status === 'ok' && t.id && db.engine === 'postgres') {
      await db.run(
        `INSERT INTO push_tickets (ticket_id, token, user_id)
         VALUES (?, ?, (SELECT user_id FROM push_tokens WHERE token = ? ORDER BY id DESC LIMIT 1))
         ON CONFLICT (ticket_id) DO NOTHING`, [t.id, to, to]).catch(e => logger.warn({ err: e.message }, '[expoPush] ticket not recorded'));
    }
  }
}

/**
 * Send messages; resolves to one ticket per message, in order:
 *   { status: 'ok', id } | { status: 'error', message, details }
 * A transport failure (network, non-2xx, malformed reply) yields an error ticket
 * for every message of the affected chunk instead of throwing.
 */
export async function sendExpoPush(messages) {
  const all = Array.isArray(messages) ? messages : [];
  const out = all.map(m => (isExpoPushToken(m?.to) ? null : { status: 'error', message: 'invalid_token' }));
  const sendable = all.map((m, i) => ({ m, i })).filter(x => out[x.i] === null);
  for (let k = 0; k < sendable.length; k += CHUNK) {
    const chunk = sendable.slice(k, k + CHUNK);
    let tickets;
    try {
      const r = await expoPost('/push/send', chunk.map(x => x.m));
      const data = Array.isArray(r.json?.data) ? r.json.data : null;
      if (!r.ok || !data || data.length !== chunk.length) {
        const why = !r.ok ? `HTTP ${r.status}` : 'unexpected response';
        logger.warn({ status: r.status }, `[expoPush] send failed: ${why}`);
        tickets = chunk.map(() => ({ status: 'error', message: why }));
      } else {
        tickets = data;
      }
    } catch (e) {
      logger.warn(`[expoPush] send failed: ${e.message}`);
      tickets = chunk.map(() => ({ status: 'error', message: e.name === 'AbortError' ? 'timeout' : e.message }));
    }
    chunk.forEach((x, j) => { out[x.i] = tickets[j]; });
  }
  await afterSend(all, out).catch(e => logger.warn({ err: e.message }, '[expoPush] ticket bookkeeping failed'));
  return out;
}

/**
 * Fetch receipts for tickets older than `minAgeMinutes` (Expo needs a few
 * minutes) and not checked yet; DeviceNotRegistered → token removed. Old rows
 * are purged. Returns { checked, removed }.
 */
export async function checkPushReceipts({ db: dbArg, minAgeMinutes = 15, limit = 1000 } = {}) {
  const db = dbArg || await dbOrNull();
  if (!db || db.engine !== 'postgres') return { checked: 0, removed: 0 };
  const rows = await db.all(
    `SELECT ticket_id, token FROM push_tickets
      WHERE checked_at IS NULL AND created_at < NOW() - (? * INTERVAL '1 minute')
      ORDER BY created_at ASC LIMIT ?`, [minAgeMinutes, limit]);
  let checked = 0; let removed = 0;
  const failedTickets = [];
  for (let i = 0; i < rows.length; i += RECEIPT_CHUNK) {
    const chunk = rows.slice(i, i + RECEIPT_CHUNK);
    let receipts;
    try {
      const r = await expoPost('/push/getReceipts', { ids: chunk.map(x => x.ticket_id) });
      if (!r.ok || !r.json?.data || typeof r.json.data !== 'object') { logger.warn({ status: r.status }, '[expoPush] receipts not available'); break; }
      receipts = r.json.data;
    } catch (e) { logger.warn(`[expoPush] receipts failed: ${e.message}`); break; }
    for (const row of chunk) {
      const rc = receipts[row.ticket_id];
      if (!rc) continue;   // not ready yet — asked again next run
      const dead = rc.status === 'error' && rc.details?.error === 'DeviceNotRegistered';
      if (dead) { await forgetPushToken(db, row.token); removed++; }
      await db.run('UPDATE push_tickets SET checked_at = NOW(), receipt_status = ?, receipt_error = ? WHERE ticket_id = ?',
        [rc.status || null, rc.details?.error || null, row.ticket_id]);
      if (rc.status === 'error') failedTickets.push({ ticket_id: row.ticket_id, error: rc.details?.error || rc.message || 'push_receipt_error' });
      checked++;
    }
  }
  // A reminder counted as 'sent' on an accepted ticket whose receipt then failed
  // (APNs/FCM credentials missing, device gone, rate limit) never reached the
  // person: hand it back to the dispatcher for the next channel (e-mail).
  if (failedTickets.length) {
    const { requeueAfterPushReceiptFailure } = await import('./reminderDispatcher.js');
    await requeueAfterPushReceiptFailure(db, failedTickets).catch(e => logger.warn({ err: e.message }, '[expoPush] reminder requeue failed'));
  }
  await db.run(`DELETE FROM push_tickets WHERE created_at < NOW() - INTERVAL '2 days'`).catch(e => logger.warn({ err: e.message }, '[expoPush] ticket purge failed'));
  if (checked || removed) logger.info({ checked, removed }, '[expoPush] receipts checked');
  return { checked, removed };
}
