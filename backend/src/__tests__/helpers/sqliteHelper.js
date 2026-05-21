/**
 * sqliteHelper.js — Pure-JS in-memory SQLite for tests
 * Uses sql.js (WebAssembly) — no native bindings required
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

let _SQL = null;
async function getSQL() {
  if (!_SQL) _SQL = await initSqlJs();
  return _SQL;
}

/**
 * Creates a fresh in-memory DB wrapped in the same interface as getDb()
 * { get, all, run, exec }
 */
export async function makeTestDb() {
  const SQL = await getSQL();
  const db  = new SQL.Database();

  return {
    exec: (sql) => {
      db.run(sql);
      return Promise.resolve();
    },
    run: (sql, params = []) => {
      try {
        const stmt = db.prepare(sql);
        stmt.run(params);
        stmt.free();
        // sql.js doesn't expose lastID/changes easily — approximate
        const lastId = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
        const changes = db.exec('SELECT changes()')[0]?.values[0][0] ?? 0;
        return Promise.resolve({ lastID: lastId, changes });
      } catch (e) {
        return Promise.reject(e);
      }
    },
    get: (sql, params = []) => {
      try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return Promise.resolve(row);
        }
        stmt.free();
        return Promise.resolve(undefined);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    all: (sql, params = []) => {
      try {
        const results = db.exec(sql, params);
        if (!results.length) return Promise.resolve([]);
        const { columns, values } = results[0];
        const rows = values.map(row => {
          const obj = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          return obj;
        });
        return Promise.resolve(rows);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    // Raw sql.js db for direct access in tests
    _raw: db,
  };
}

/**
 * Core schema — call this on each fresh test DB
 */
export async function createSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      subscription TEXT DEFAULT 'starter',
      referral_code TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      bar_verified INTEGER DEFAULT 0,
      pending_bar_verification INTEGER DEFAULT 0,
      bar_number TEXT,
      bar_state TEXT,
      bar_verified_at TEXT,
      bar_rejection_reason TEXT,
      bar_submitted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      charge TEXT DEFAULT '',
      status TEXT DEFAULT 'Open',
      notes TEXT DEFAULT '',
      court_date TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      bar_verified INTEGER DEFAULT 0,
      pending_bar_verification INTEGER DEFAULT 0,
      bar_number TEXT,
      bar_state TEXT,
      bar_verified_at TEXT,
      bar_rejection_reason TEXT,
      bar_submitted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER,
      case_id INTEGER,
      body TEXT DEFAULT '',
      encrypted INTEGER DEFAULT 0,
      read_at TEXT,
      attachment_url TEXT,
      attachment_name TEXT,
      attachment_size INTEGER,
      attachment_mime TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      bar_verified INTEGER DEFAULT 0,
      pending_bar_verification INTEGER DEFAULT 0,
      bar_number TEXT,
      bar_state TEXT,
      bar_verified_at TEXT,
      bar_rejection_reason TEXT,
      bar_submitted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS push_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      token TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS scheduled_pushes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      push_token TEXT,
      title TEXT,
      body TEXT,
      data TEXT,
      deliver_at TEXT,
      status TEXT DEFAULT 'pending',
      sent_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      plan TEXT,
      stripe_sub_id TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      current_period_start INTEGER
    );
    CREATE TABLE IF NOT EXISTS saved_lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      provider_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      provider_id INTEGER,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS motions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      motion_type TEXT,
      draft TEXT,
      status TEXT DEFAULT 'draft'
    );
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT
    );
    CREATE TABLE IF NOT EXISTS account_deletion_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted_at TEXT,
      region TEXT
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      rating INTEGER,
      comment TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS refund_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subscription_id INTEGER,
      reason TEXT NOT NULL,
      days_since_charge REAL,
      auto_approve INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending_review',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

}
