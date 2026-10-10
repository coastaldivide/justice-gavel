/**
 * db/index.js — Database adapter
 *
 * PostgreSQL is the only production database. When DATABASE_URL is set the
 * adapter connects to Postgres and FAILS LOUDLY if the database is unreachable
 * (no silent stub). In production (NODE_ENV=production) DATABASE_URL is
 * required.
 *
 * For local development only — when DATABASE_URL is unset and NODE_ENV is not
 * production — a sql.js (in-memory SQLite, persisted to demo.db) fallback is
 * used and a loud warning is logged. Most features expect Postgres syntax, so
 * point DATABASE_URL at a local Postgres for real work.
 *
 * API (same for both engines):
 *   db.get(sql, params)   → first row | undefined
 *   db.all(sql, params)   → rows[]
 *   db.run(sql, params)   → { lastID, changes, rows }
 *   db.exec(sql)          → void (multi-statement allowed, no params)
 *   db.query(sql, params) → { rows, rowCount }  (pg-style)
 *   db.transaction(async tx => {...}) → runs fn on ONE connection inside BEGIN/COMMIT
 *   db.close()            → no-op (shared singleton; closeDb() ends the pool)
 *
 * Errors are THROWN (routes already wrap handlers in try/catch → 500).
 *
 * SQL written with SQLite-style `?` placeholders is rewritten to `$1..$n`.
 * The rewrite skips string literals, quoted identifiers, comments, dollar-quoted
 * bodies and the jsonb operators `?|` / `?&` / `? 'key'`. Use `??` to emit a
 * literal `?` operator.
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.resolve(__dirname, '../../demo.db');

// DB_LOG_ERRORS=true logs every failed query (code + SQL) — useful for debugging.
const LOG_ERRORS = process.env.DB_LOG_ERRORS === 'true';

let _db = null;
let _initPromise = null;

// ── `?` → `$n` placeholder rewrite ────────────────────────────────────────────
export function toPgPlaceholders(sql) {
  if (!sql.includes('?')) return sql;
  let out = '';
  let n = 0;
  const len = sql.length;
  for (let i = 0; i < len; i++) {
    const c = sql[i];
    // single-quoted string literal ('' escapes)
    if (c === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      out += sql.slice(i, j + 1); i = j; continue;
    }
    // double-quoted identifier
    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      const end = j === -1 ? len - 1 : j;
      out += sql.slice(i, end + 1); i = end; continue;
    }
    // line comment
    if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? len - 1 : j;
      out += sql.slice(i, end + 1); i = end; continue;
    }
    // block comment
    if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j === -1 ? len - 1 : j + 1;
      out += sql.slice(i, end + 1); i = end; continue;
    }
    // dollar-quoted string $tag$ ... $tag$
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const j = sql.indexOf(tag, i + tag.length);
        const end = j === -1 ? len - 1 : j + tag.length - 1;
        out += sql.slice(i, end + 1); i = end; continue;
      }
    }
    if (c === '?') {
      const next = sql[i + 1];
      if (next === '?') { out += '?'; i++; continue; }          // escaped literal ?
      if (next === '|' || next === '&') { out += c; continue; } // jsonb ?| ?&
      // jsonb `col ? 'key'` — a bind parameter is never followed by a literal
      const rest = sql.slice(i + 1).trimStart();
      if (rest.startsWith("'")) { out += c; continue; }
      out += '$' + (++n);
      continue;
    }
    out += c;
  }
  return out;
}

const TX_CONTROL_RE = /^\s*(BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION)(\s+(IMMEDIATE|EXCLUSIVE|DEFERRED|TRANSACTION|WORK))?\s*;?\s*$/i;
const PRAGMA_RE     = /^\s*PRAGMA\b/i;
const INSERT_RE     = /^\s*INSERT\s+INTO\s+("?[\w.]+"?)/i;

function normParams(params) {
  if (params === undefined || params === null) return [];
  if (!Array.isArray(params)) params = [params];
  // undefined → NULL; JS booleans → 1/0 (valid input for both INTEGER flag
  // columns and BOOLEAN columns in Postgres).
  return params.map(p => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

// ── Postgres adapter ──────────────────────────────────────────────────────────
async function initPostgres(url) {
  const { default: pg } = await import('pg');
  // BIGINT (int8) and NUMERIC come back as strings by default. Ids and counts in
  // this schema are bigint and always far below 2^53 — return JS numbers.
  pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));
  pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));
  // DATE (1082) is a calendar day with no time zone. node-pg's default turns it
  // into a JS Date at the *server's* local midnight, which JSON-serialises as
  // e.g. '2026-11-20T00:00:00.000Z' and is shown as Nov 19 on devices west of
  // UTC. Keep it as the plain 'YYYY-MM-DD' string the app sent.
  pg.types.setTypeParser(1082, v => v);

  const isLocal = /localhost|127\.0\.0\.1|::1|\.internal\b|\.railway\.internal/.test(url)
    || /sslmode=disable/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.PGSSL === 'false' || isLocal ? false : { rejectUnauthorized: false },
    max:                     parseInt(process.env.PG_POOL_MAX || '20', 10),
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 8000,
    statement_timeout:       30000,
    query_timeout:           25000,
  });
  pool.on('error', (e) => logger.error({ err: e.message }, '[db] idle client error'));

  await pool.query('SELECT 1'); // fail fast if unreachable

  // Cache which tables have an `id` column so INSERTs get `RETURNING id` only
  // where it is valid.
  const idTables = new Set();
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'id'`
    );
    rows.forEach(r => idTables.add(r.table_name.toLowerCase()));
  } catch (e) {
    logger.warn({ err: e.message }, '[db] could not load table metadata');
  }
  logger.info({ tables_with_id: idTables.size }, '[db] Postgres connected');

  function prepare(sql) {
    let pgSql = toPgPlaceholders(String(sql)).trim().replace(/;\s*$/, '');
    let wantsId = false;
    const m = INSERT_RE.exec(pgSql);
    if (m && !/\bRETURNING\b/i.test(pgSql)) {
      const table = m[1].replace(/"/g, '').split('.').pop().toLowerCase();
      if (idTables.has(table)) { pgSql += ' RETURNING id'; wantsId = true; }
    }
    return { pgSql, wantsId, isInsert: !!m };
  }

  function makeApi(executor, { inTx = false } = {}) {
    const q = async (sql, params) => {
      const { pgSql } = prepare(sql);
      try {
        return await executor.query(pgSql, normParams(params));
      } catch (e) {
        e.sql = pgSql.slice(0, 200);
        if (LOG_ERRORS) logger.warn({ err: e.message, code: e.code, sql: e.sql.replace(/\s+/g, ' ') }, '[db] query error');
        throw e;
      }
    };
    const api = {
      engine: 'postgres',
      get: async (sql, params = []) => (await q(sql, params)).rows[0],
      all: async (sql, params = []) => (await q(sql, params)).rows,
      query: async (sql, params = []) => await q(sql, params),
      run: async (sql, params = []) => {
        if (PRAGMA_RE.test(sql)) return { lastID: 0, changes: 0, rows: [] };
        if (TX_CONTROL_RE.test(sql)) {
          // Bare BEGIN/COMMIT on a pool would leave a random pooled connection
          // inside an open transaction. Use db.transaction() instead.
          if (inTx) { await executor.query(sql); }
          return { lastID: 0, changes: 0, rows: [] };
        }
        const { pgSql, isInsert } = prepare(sql);
        let result;
        try {
          result = await executor.query(pgSql, normParams(params));
        } catch (e) {
          e.sql = pgSql.slice(0, 200);
          if (LOG_ERRORS) logger.warn({ err: e.message, code: e.code, sql: e.sql.replace(/\s+/g, ' ') }, '[db] query error');
          throw e;
        }
        const raw = isInsert && result.rows?.[0] ? result.rows[0].id : undefined;
        const lastID = raw === undefined || raw === null ? 0
          : (typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw)) ? Number(raw) : raw));
        return { lastID, changes: result.rowCount || 0, rows: result.rows || [] };
      },
      exec: async (sql) => {
        if (PRAGMA_RE.test(sql)) return;
        if (TX_CONTROL_RE.test(sql) && !inTx) return;
        await executor.query(sql);
      },
      persist: () => {},
    };
    return api;
  }

  const api = makeApi(pool);
  api.transaction = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = makeApi(client, { inTx: true });
      tx.transaction = (inner) => inner(tx);
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  };
  // The adapter is a process-wide singleton: legacy code that calls db.close()
  // after a request must not tear down the shared pool. Only closeDb() (used by
  // the server shutdown path) ends the pool.
  api.close = async () => {};
  api._close = api.close;
  api._shutdown = async () => { await pool.end(); };
  api._pool = pool;
  return api;
}

// ── sql.js (SQLite) adapter — local dev fallback ONLY (no DATABASE_URL) ───────
async function initSqlite() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const dbData = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const sqlDb = dbData ? new SQL.Database(dbData) : new SQL.Database();
  try { sqlDb.run('PRAGMA foreign_keys=ON'); } catch { /* ignore */ }

  const bind = (params) => normParams(params).map(p =>
    typeof p === 'boolean' ? (p ? 1 : 0) : (p instanceof Date ? p.toISOString() : p));

  // sql.js is synchronous; expose the same Promise API as the pg adapter
  // (a throw becomes a rejection, exactly as an async function would).
  const asPromise = (fn) => (...args) => {
    try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); }
  };

  const adapter = {
    engine: 'sqlite',
    get: asPromise((sql, params = []) => {
      const stmt = sqlDb.prepare(sql);
      try {
        stmt.bind(bind(params));
        return stmt.step() ? stmt.getAsObject() : undefined;
      } finally { stmt.free(); }
    }),
    all: asPromise((sql, params = []) => {
      const rows = [];
      const stmt = sqlDb.prepare(sql);
      try {
        stmt.bind(bind(params));
        while (stmt.step()) rows.push(stmt.getAsObject());
      } finally { stmt.free(); }
      return rows;
    }),
    run: asPromise((sql, params = []) => {
      sqlDb.run(sql, bind(params));
      const changes = sqlDb.getRowsModified();
      let lastID = 0;
      try { const r = sqlDb.exec('SELECT last_insert_rowid()'); if (r[0]) lastID = r[0].values[0][0]; } catch { /* ignore */ }
      return { lastID, changes, rows: [] };
    }),
    query: async (sql, params = []) => {
      const rows = await adapter.all(sql, params);
      return { rows, rowCount: rows.length };
    },
    exec: asPromise((sql) => { sqlDb.exec(sql); }),
    transaction: async (fn) => {
      sqlDb.exec('BEGIN');
      try { const out = await fn(adapter); sqlDb.exec('COMMIT'); return out; }
      catch (e) { try { sqlDb.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
    persist: () => {
      try { fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export())); } catch { /* ignore */ }
    },
    close: async () => {},   // singleton — see closeDb()
  };
  adapter._close = adapter.close;
  adapter._shutdown = asPromise(() => { adapter.persist(); sqlDb.close(); });
  const t = setInterval(() => adapter.persist(), 30_000);
  t.unref();
  logger.warn({ path: DB_PATH },
    '[db] ⚠️  DATABASE_URL is not set — using LOCAL DEV sql.js SQLite fallback. ' +
    'Postgres-specific features will fail. Set DATABASE_URL for real use.');
  return adapter;
}

async function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) return await initPostgres(url);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required when NODE_ENV=production');
  }
  return await initSqlite();
}

export async function getDb() {
  if (_db) return _db;
  if (!_initPromise) {
    _initPromise = connect()
      .then(db => { _db = db; return db; })
      .catch(e => { _initPromise = null; throw e; });
  }
  return await _initPromise;
}

export async function initDb() { return await getDb(); }

export async function closeDb() {
  if (_db?._shutdown) { try { await _db._shutdown(); } catch { /* ignore */ } }
  _db = null; _initPromise = null;
}


// ── Compatibility export: `db` proxy for modules that import { db } ──────────
// Real connection is established lazily via getDb().
export const db = {
  get:         (...args) => getDb().then(d => d.get(...args)),
  run:         (...args) => getDb().then(d => d.run(...args)),
  all:         (...args) => getDb().then(d => d.all(...args)),
  exec:        (...args) => getDb().then(d => d.exec(...args)),
  query:       (...args) => getDb().then(d => d.query(...args)),
  transaction: (...args) => getDb().then(d => d.transaction(...args)),
};

// ── Schema manifest ──────────────────────────────────────────────────────────
// The schema is owned by supabase/migrations/*.sql (Postgres). This backend
// never creates tables at runtime. Key tables include:
// CREATE TABLE IF NOT EXISTS users                  -- core auth
// CREATE TABLE IF NOT EXISTS firms                  -- law firm accounts
// CREATE TABLE IF NOT EXISTS firm_members           -- firm membership
// CREATE TABLE IF NOT EXISTS matters                -- attorney matters
// CREATE TABLE IF NOT EXISTS cases                  -- consumer cases
// CREATE TABLE IF NOT EXISTS messages               -- secure messages
// CREATE TABLE IF NOT EXISTS invoices               -- billing invoices
// CREATE TABLE IF NOT EXISTS time_entries           -- billable time
// CREATE TABLE IF NOT EXISTS conflict_index         -- conflict of interest
// CREATE TABLE IF NOT EXISTS privilege_log          -- attorney-client privilege
// CREATE TABLE IF NOT EXISTS contracts              -- legal contracts
// CREATE TABLE IF NOT EXISTS audit_log              -- audit trail
// CREATE TABLE IF NOT EXISTS web_push_subscriptions  user_id, endpoint, p256dh, auth
// CREATE TABLE IF NOT EXISTS subscriptions          -- stripe subscriptions
// CREATE TABLE IF NOT EXISTS refresh_tokens         -- JWT refresh tokens
// CREATE TABLE IF NOT EXISTS aba_codes
// CREATE TABLE IF NOT EXISTS ability_to_pay
// CREATE TABLE IF NOT EXISTS account_deletion_log
// CREATE TABLE IF NOT EXISTS account_inactivity_log
// CREATE TABLE IF NOT EXISTS acquisition_leads
// CREATE TABLE IF NOT EXISTS ai_jobs
// CREATE TABLE IF NOT EXISTS ai_usage_log
// CREATE TABLE IF NOT EXISTS alert_log
// CREATE TABLE IF NOT EXISTS arrest_monitors
// CREATE TABLE IF NOT EXISTS arrest_records
// CREATE TABLE IF NOT EXISTS asylum_clocks
// CREATE TABLE IF NOT EXISTS attorney_alerts
// CREATE TABLE IF NOT EXISTS attorney_profiles
// CREATE TABLE IF NOT EXISTS audit_log
// CREATE TABLE IF NOT EXISTS bail_agents
// CREATE TABLE IF NOT EXISTS bail_schedules
// CREATE TABLE IF NOT EXISTS bar_prep_progress
// CREATE TABLE IF NOT EXISTS bar_subjects
// CREATE TABLE IF NOT EXISTS bar_verification_log
// CREATE TABLE IF NOT EXISTS bondsman_profiles
// CREATE TABLE IF NOT EXISTS bop_exhaustion
// CREATE TABLE IF NOT EXISTS bot_runs
// CREATE TABLE IF NOT EXISTS calendar_push_events
// CREATE TABLE IF NOT EXISTS callback_requests
// CREATE TABLE IF NOT EXISTS case_assignments
// CREATE TABLE IF NOT EXISTS case_events
// CREATE TABLE IF NOT EXISTS case_family_access
// CREATE TABLE IF NOT EXISTS case_messages
// CREATE TABLE IF NOT EXISTS case_status_history
// CREATE TABLE IF NOT EXISTS cases
// CREATE TABLE IF NOT EXISTS cases_fts
// CREATE TABLE IF NOT EXISTS chat_messages
// CREATE TABLE IF NOT EXISTS chat_sessions
// CREATE TABLE IF NOT EXISTS chat_usage
// CREATE TABLE IF NOT EXISTS checkin_enrollments
// CREATE TABLE IF NOT EXISTS checkin_records
// CREATE TABLE IF NOT EXISTS checkins
// CREATE TABLE IF NOT EXISTS civil_attorney_profiles
// CREATE TABLE IF NOT EXISTS civil_lead_purchases
// CREATE TABLE IF NOT EXISTS civil_leads
// CREATE TABLE IF NOT EXISTS cle_completions
//
// ── Index manifest — key indexes defined across migrations ───────────────────
// CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
// CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at);
// CREATE INDEX IF NOT EXISTS idx_cases_user ON cases (user_id);
// CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
// CREATE INDEX IF NOT EXISTS idx_audit_log_firm_time ON audit_log (firm_id, created_at);
// CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log (user_id, created_at);
// CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_id);
// CREATE INDEX IF NOT EXISTS idx_firm_members_firm ON firm_members (firm_id);
// CREATE INDEX IF NOT EXISTS idx_matters_firm ON matters (firm_id);
// CREATE INDEX IF NOT EXISTS idx_matters_docket ON matters (docket_number);
// CREATE INDEX IF NOT EXISTS idx_privilege_log_matter ON privilege_log (matter_id, doc_num);
// CREATE INDEX IF NOT EXISTS idx_privilege_log_reviewer ON privilege_log (reviewer_id);
// CREATE INDEX IF NOT EXISTS idx_contracts_type_user ON contracts (type, user_id);
// CREATE INDEX IF NOT EXISTS idx_contracts_expiry ON contracts (expiry_date);
// CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts (status);
// CREATE INDEX IF NOT EXISTS idx_webhooks_firm ON webhooks (firm_id, active);
// CREATE INDEX IF NOT EXISTS idx_webhooks_delivery ON webhooks (last_delivery, created_at);
// CREATE INDEX IF NOT EXISTS idx_calendar_docket ON calendar_events (docket_id, synced_at);
// CREATE INDEX IF NOT EXISTS idx_calendar_connection ON calendar_events (connection_id, synced_at);
// CREATE INDEX IF NOT EXISTS idx_mi_cache_matter ON matter_intelligence_cache (matter_id);
// CREATE INDEX IF NOT EXISTS idx_mi_cache_escalation ON matter_intelligence_cache (escalation_level);
// CREATE INDEX IF NOT EXISTS idx_mi_cache_expiry ON matter_intelligence_cache (expires_at);
// CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id);
// CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens (expires_at);
// CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, created_at);
// CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (user_id);
// CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);
// CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);
// CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
// CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);
// CREATE INDEX IF NOT EXISTS idx_firms_slug ON firms (slug);
// CREATE INDEX IF NOT EXISTS idx_matters_status ON matters (status);
// CREATE INDEX IF NOT EXISTS idx_invoices_matter ON invoices (matter_id);
// CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices (user_id);
// CREATE INDEX IF NOT EXISTS idx_time_entries_matter ON time_entries (matter_id);
// CREATE INDEX IF NOT EXISTS idx_conflict_index_firm ON conflict_index (firm_id);
// CREATE INDEX IF NOT EXISTS idx_bar_prep_questions_subject ON bar_prep_questions (subject_id);
// CREATE INDEX IF NOT EXISTS idx_bar_prep_progress_user ON bar_prep_progress (user_id);
// CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions (user_id);
// CREATE INDEX IF NOT EXISTS idx_study_streaks_user ON study_streaks (user_id);
// CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges (user_id);
// CREATE INDEX IF NOT EXISTS idx_providers_state ON providers (state);
// CREATE INDEX IF NOT EXISTS idx_providers_type ON providers (type);
// CREATE INDEX IF NOT EXISTS idx_providers_city ON providers (city);
// CREATE INDEX IF NOT EXISTS idx_arrest_records_user ON arrest_records (user_id);
// CREATE INDEX IF NOT EXISTS idx_arrest_monitors_user ON arrest_monitors (user_id);
// CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions (user_id);
// CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id);
// CREATE INDEX IF NOT EXISTS idx_cases_firm ON cases (firm_id);
// CREATE INDEX IF NOT EXISTS idx_bonds_user ON bondsman_profiles (user_id);
// CREATE INDEX IF NOT EXISTS idx_bonds_location ON bondsman_profiles (state, city);
// CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_log (user_id, created_at);
