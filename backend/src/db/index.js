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
    max: 10,
    connectionTimeoutMillis: 10000,
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
      logger.error({ err: e.message }, 'Postgres connection failed');
      if (process.env.NODE_ENV === 'production') {
        // In production, Postgres is required — don't silently use SQLite
        throw new Error(`Database connection failed: ${e.message}`);
      }
      logger.warn('Falling back to SQLite for local development');
    }
  }

  _db = await initSqlite();
  return _db;
}

export async function initDb() { return getDb(); }
