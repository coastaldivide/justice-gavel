/**
 * services/directoryCache.js — short-lived in-memory copy of the active lawyer and
 * bail-agent directory.
 *
 * Every directory search (Lawyers, Bail, Help Now match, family contacts) needs all
 * active rows: matching and distance are computed in memory (see providerDirectory.js).
 * Fetching ~2,000 rows from Postgres took ~20 ms per request and capped one instance
 * at ~60 searches/s; the search itself takes <1 ms. The directory only changes through
 * the nightly data refresh and admin actions, so rows are cached per (table, columns,
 * filter) for DIRECTORY_CACHE_TTL_MS (default 60 s; 0 under NODE_ENV=test). Writers call invalidate(); other
 * instances pick up changes within the TTL.
 *
 * Callers get fresh shallow copies of the rows, because the search annotates rows
 * (_dist, _complete, _caseRank) and concurrent requests must not share those fields.
 * Concurrent misses share one query (single flight). Set DIRECTORY_CACHE_TTL_MS=0 to
 * disable.
 */
const entries = new Map(); // key -> { at, rows, pending }

function ttlMs() {
  const v = Number(process.env.DIRECTORY_CACHE_TTL_MS);
  if (Number.isFinite(v) && v >= 0 && process.env.DIRECTORY_CACHE_TTL_MS !== '') return v;
  return process.env.NODE_ENV === 'test' ? 0 : 60_000; // tests write rows directly and read them back at once
}

const copy = rows => rows.map(r => ({ ...r }));

/**
 * Rows for `sql` (a full-directory SELECT with no parameters), cached.
 * @param {{ all: (sql: string, params?: unknown[]) => Promise<object[]> }} db
 * @param {string} sql
 */
export async function directoryRows(db, sql) {
  const ttl = ttlMs();
  if (ttl === 0) return db.all(sql);
  const now = Date.now();
  const hit = entries.get(sql);
  if (hit?.rows && now - hit.at < ttl) return copy(hit.rows);
  if (hit?.pending) return copy(await hit.pending);
  const pending = db.all(sql).then(
    rows => { entries.set(sql, { at: Date.now(), rows }); return rows; },
    err => { entries.delete(sql); throw err; },
  );
  entries.set(sql, { ...(hit || {}), pending });
  return copy(await pending);
}

/** Drop every cached directory query (call after writing lawyers / bail_agents). */
export function invalidateDirectory() {
  entries.clear();
}
