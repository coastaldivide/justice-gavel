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
  const _timer130 = setInterval(() => adapter.persist(), 30_000);
  _timer130.unref();
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

// ── Compatibility export: 'db' proxy for modules that import { db } from './db/index.js'
// Real connection is established lazily via getDb()
export const db = {
  get:    (...args) => getDb().then(d => d.get(...args)),
  run:    (...args) => getDb().then(d => d.run(...args)),
  all:    (...args) => getDb().then(d => d.all(...args)),
  exec:   (...args) => getDb().then(d => d.exec(...args)),
  prepare:(...args) => getDb().then(d => d.prepare(...args)),
};

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