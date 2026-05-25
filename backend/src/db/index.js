/**
 * db/index.js — Database adapter
 * Uses Postgres (via pg) when DATABASE_URL is set, sql.js SQLite otherwise
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.resolve(__dirname, '../../demo.db');

let _db = null;

// ── Postgres adapter ──────────────────────────────────────────────────────────
async function initPostgres() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
  });

  // Test connection
  try {
    await pool.query('SELECT 1');
    logger.info('[db] Postgres connected');
  } catch(e) {
    logger.error({ err: e.message }, 'Postgres connection failed — falling back to SQLite');
    return null;
  }

  const rowToObj = (row) => row || undefined;

  return {
    get: async (sql, params = []) => {
      try {
        const { rows } = await pool.query(sql, params);
        return rows[0] || undefined;
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.get error');
        return undefined;
      }
    },
    all: async (sql, params = []) => {
      try {
        const { rows } = await pool.query(sql, params);
        return rows;
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.all error');
        return [];
      }
    },
    run: async (sql, params = []) => {
      try {
        const result = await pool.query(sql, params);
        // Get lastID for INSERT
        let lastID = 0;
        if (sql.trim().toUpperCase().startsWith('INSERT')) {
          try {
            const r2 = await pool.query('SELECT lastval()');
            lastID = r2.rows[0]?.lastval || 0;
          } catch {}
        }
        return { lastID: Number(lastID), changes: result.rowCount || 0 };
      } catch(e) {
        logger.error({ err: e.message, sql: sql.slice(0,80) }, 'db.run error');
        return { lastID: 0, changes: 0 };
      }
    },
    exec: async (sql) => {
      try { await pool.query(sql); } catch(e) {
        // Throw so migrations can catch
        throw e;
      }
    },
    runAsync: async (sql, params = []) => {
      const pg_sql = sql;
      return _db.run(pg_sql, params);
    },
    persist: () => {}, // no-op for Postgres
    _pool: pool,
  };
}

// ── SQL.js (SQLite) adapter ───────────────────────────────────────────────────
function wrapSqlJs(sqlDb) {
  let lastID = 0;
  return {
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
    runAsync: async (sql, params) => wrapSqlJs(sqlDb).run(sql, params),
    persist: () => {
      try { fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export())); } catch {}
    },
    _raw: sqlDb,
  };
}

export async function getDb() {
  if (_db) return _db;

  // Try Postgres first
  if (process.env.DATABASE_URL) {
    const pg = await initPostgres();
    if (pg) { _db = pg; return _db; }
  }

  // Fall back to sql.js SQLite
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const dbData = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const sqlDb = dbData ? new SQL.Database(dbData) : new SQL.Database();
  try { sqlDb.run('PRAGMA journal_mode=WAL'); } catch {}
  try { sqlDb.run('PRAGMA foreign_keys=ON'); } catch {}
  _db = wrapSqlJs(sqlDb);
  setInterval(() => _db.persist(), 30_000);
  logger.info({ path: DB_PATH }, 'SQLite (sql.js) ready');
  return _db;
}

// initDb — alias used by app.js startup
export async function initDb() { return getDb(); }
