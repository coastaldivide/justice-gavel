/**
 * db/index.js — Database adapter (sql.js — pure JS SQLite, no native build needed)
 *
 * Exposes:
 *   db.get(sql, params)   → single row or undefined
 *   db.all(sql, params)   → array of rows
 *   db.run(sql, params)   → { lastID, changes }
 *   db.exec(sql)          → void
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.resolve(__dirname, '../../demo.db');

let _db = null;
let _SQL = null;

function paramToValue(p) {
  if (p === null || p === undefined) return null;
  return p;
}

function rowToObj(stmt, row) {
  const cols = stmt.getColumnNames();
  const vals = row;
  const obj = {};
  cols.forEach((c, i) => { obj[c] = vals[i]; });
  return obj;
}

// Wrap sql.js Database in our interface
function wrapSqlJs(sqlDb) {
  let lastID = 0;
  let changes = 0;

  return {
    get: async (sql, params = []) => {
      try {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params.map(paramToValue));
        if (stmt.step()) {
          const result = stmt.getAsObject();
          stmt.free();
          return result;
        }
        stmt.free();
        return undefined;
      } catch (e) {
        logger.error({ err: e.message, sql: sql.slice(0, 80) }, 'db.get error');
        return undefined;
      }
    },
    all: async (sql, params = []) => {
      try {
        const rows = [];
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params.map(paramToValue));
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      } catch (e) {
        logger.error({ err: e.message, sql: sql.slice(0, 80) }, 'db.all error');
        return [];
      }
    },
    run: async (sql, params = []) => {
      try {
        sqlDb.run(sql, params.map(paramToValue));
        changes = sqlDb.getRowsModified();
        // Get last insert rowid
        try {
          const r = sqlDb.exec('SELECT last_insert_rowid()');
          if (r[0]) lastID = r[0].values[0][0];
        } catch {}
        return { lastID, changes };
      } catch (e) {
        logger.error({ err: e.message, sql: sql.slice(0, 80) }, 'db.run error');
        return { lastID: 0, changes: 0 };
      }
    },
    exec: async (sql) => {
      try { sqlDb.exec(sql); } catch (e) {
        logger.error({ err: e.message }, 'db.exec error');
      }
    },
    runAsync: async (sql, params = []) => {
      return await wrapSqlJs(sqlDb).run(sql, params);
    },
    _raw: sqlDb,
    // Persistence helper — save db to disk
    persist: () => {
      try {
        const data = sqlDb.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
      } catch (e) {
        logger.error({ err: e.message }, 'db persist error');
      }
    }
  };
}

export async function getDb() {
  if (_db) return _db;

  try {
    const initSqlJs = (await import('sql.js')).default;
    _SQL = await initSqlJs();

    let dbData = null;
    if (fs.existsSync(DB_PATH)) {
      dbData = fs.readFileSync(DB_PATH);
    }

    const sqlDb = dbData ? new _SQL.Database(dbData) : new _SQL.Database();

    // Enable WAL mode for better concurrent reads
    try { sqlDb.run('PRAGMA journal_mode=WAL'); } catch {}
    try { sqlDb.run('PRAGMA foreign_keys=ON'); } catch {}

    _db = wrapSqlJs(sqlDb);

    // Auto-persist every 30 seconds
    setInterval(() => { _db.persist(); }, 30_000);

    logger.info({ path: DB_PATH }, 'SQLite (sql.js) ready');
    return _db;
  } catch (e) {
    logger.error({ err: e.message }, 'Failed to initialise database');
    throw e;
  }
}

// initDb — alias used by app.js startup
export async function initDb() {
  return getDb();
}
