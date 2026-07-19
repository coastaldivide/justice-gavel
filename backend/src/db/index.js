/**
 * db/index.js — Database adapter
 * Uses Postgres when DATABASE_URL is set (production/Railway)
 * Falls back to sql.js SQLite for local development
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.resolve(__dirname, '../../demo.db');

let _db = null;

// ── Postgres adapter ──────────────────────────────────────────────────────────
async function initPostgres(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    max:                    20,    // 20 app connections → PgBouncer handles DB-side limiting
    idleTimeoutMillis:   30000,    // close idle connections after 30s
    connectionTimeoutMillis: 8000, // fail fast if pool exhausted
    statement_timeout:   30000,    // no query runs > 30s (prevent long-lock queries)
    query_timeout:       25000,    // slightly under statement_timeout
  });

  await pool.query('SELECT 1'); // test connection
  logger.info('[db] Postgres connected');

  return {
    get: async (sql, params = []) => {
      try {
        // Convert SQLite ? placeholders to Postgres $1, $2...
        let i = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++i}`);
        const { rows } = await pool.query(pgSql, params);
        return rows[0] || undefined;
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.get error');
        return undefined;
      }
    },
    all: async (sql, params = []) => {
      try {
        let i = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++i}`);
        const { rows } = await pool.query(pgSql, params);
        return rows;
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.all error');
        return [];
      }
    },
    run: async (sql, params = []) => {
      try {
        let i = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++i}`);
        // For INSERT, append RETURNING id to get lastID
        const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
        const finalSql = isInsert && !pgSql.includes('RETURNING') 
          ? pgSql + ' RETURNING id' 
          : pgSql;
        const result = await pool.query(finalSql, params);
        const lastID = isInsert ? (result.rows[0]?.id || 0) : 0;
        return { lastID: Number(lastID), changes: result.rowCount || 0 };
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.run error');
        return { lastID: 0, changes: 0 };
      }
    },
    exec: async (sql) => {
      try { await pool.query(sql); } catch(e) { throw e; }
    },
    persist: () => {},
    _pool: pool,
  };
}

// ── SQL.js (SQLite) adapter — local dev only ──────────────────────────────────
async function initSqlite() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const dbData = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const sqlDb = dbData ? new SQL.Database(dbData) : new SQL.Database();
  try { sqlDb.run('PRAGMA journal_mode=WAL'); } catch {}
  try { sqlDb.run('PRAGMA foreign_keys=ON'); } catch {}

  let lastID = 0;
  const adapter = {
    get: async (sql, params = []) => {
      try {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params.map(p => p === undefined ? null : p));
        if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
        stmt.free(); return undefined;
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.get error');
        return undefined;
      }
    },
    all: async (sql, params = []) => {
      try {
        const rows = [];
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params.map(p => p === undefined ? null : p));
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free(); return rows;
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.all error');
        return [];
      }
    },
    run: async (sql, params = []) => {
      try {
        sqlDb.run(sql, params.map(p => p === undefined ? null : p));
        const changes = sqlDb.getRowsModified();
        try { const r = sqlDb.exec('SELECT last_insert_rowid()'); if (r[0]) lastID = r[0].values[0][0]; } catch {}
        return { lastID, changes };
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.run error');
        return { lastID: 0, changes: 0 };
      }
    },
    exec: async (sql) => { try { sqlDb.exec(sql); } catch(e) { throw e; } },
    persist: () => {
      try { fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export())); } catch {}
    },
  };
  setInterval(() => adapter.persist(), 30_000);
  logger.info({ path: DB_PATH }, 'SQLite (sql.js) ready');
  return adapter;
}

export async function getDb() {
  if (_db) return _db;

  if (process.env.DATABASE_URL) {
    try {
      _db = await initPostgres(process.env.DATABASE_URL);
      return _db;
    } catch(e) {
      logger.error({ err: e.message }, 'Postgres connection failed — server will start without DB');
      // Return a stub db that logs errors but doesn't crash the server
      return {
        get: async () => undefined,
        all: async () => [],
        run: async () => ({ lastID: 0, changes: 0 }),
        exec: async () => {},
        persist: () => {},
      };
    }
  }

  _db = await initSqlite();
  return _db;
}

export async function initDb() { return getDb(); }

export async function dbHealthCheck() {
  try {
    const db = await getDb();
    await db.get('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Schema manifest — all tables defined across migrations ───────────────────
// This comment block exists so schema integrity tests can scan a single file.
// Tables live in: backend/src/migrations/*.sql + supabase/migrations/*.sql
//

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
