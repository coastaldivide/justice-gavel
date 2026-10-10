/**
 * utils/healthCheck.js — cached database probe for /health.
 *
 * /health is exempt from rate limiting (platform probes must never be
 * throttled), so the DB round-trip is cached: at most one `SELECT 1` per
 * `ttlMs` no matter how many requests arrive, and concurrent requests share the
 * in-flight probe. A failed probe is cached for the same window, so a DB outage
 * keeps answering 503 without piling up connection attempts.
 */
export function createDbHealthCheck(getDb, { ttlMs = 5000, timeoutMs = 5000, onError = () => {} } = {}) {
  let cache = null;        // { ok, checkedAt }
  let inFlight = null;     // Promise<{ ok, checkedAt }>

  async function probe() {
    let ok = false;
    let timer;
    try {
      const db = await getDb();
      const row = await Promise.race([
        db.get('SELECT 1 AS ok'),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('db timeout')), timeoutMs); }),
      ]);
      ok = !!row;
    } catch (e) {
      onError(e);
    } finally {
      clearTimeout(timer);
    }
    return { ok, checkedAt: Date.now() };
  }

  async function check() {
    if (cache && Date.now() - cache.checkedAt < ttlMs) return { ...cache, cached: true };
    if (!inFlight) {
      inFlight = probe()
        .then(r => { cache = r; return r; })
        .finally(() => { inFlight = null; });
    }
    return { ...(await inFlight), cached: false };
  }
  check.reset = () => { cache = null; };
  return check;
}
