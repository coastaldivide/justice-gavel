/**
 * setup.js — Test infrastructure
 *
 * Provides:
 *   - In-memory SQLite DB (isolated per test suite)
 *   - JWT token helpers for auth
 *   - Express app factory with real routes
 *   - afterEach cleanup
 */
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';

const TEST_SECRET = 'test_jwt_secret_for_testing_only';
process.env.JWT_SECRET = TEST_SECRET;
process.env.NODE_ENV   = 'test';
process.env.ANTHROPIC_API_KEY = 'test_key_not_real';
process.env.STRIPE_SECRET     = 'sk_test_fake_for_tests';

// ── In-memory SQLite DB ───────────────────────────────────────────────────────
let _testDb = null;

export async function getTestDb() {
  if (_testDb) return _testDb;

  const db = new sqlite3.Database(':memory:');

  // Promisify the sqlite3 raw API to match our getDb() interface
  const wrap = (rawDb) => ({
    get: (sql, params = []) => new Promise((res, rej) =>
      rawDb.get(sql, params, (err, row) => err ? rej(err) : res(row))),
    all: (sql, params = []) => new Promise((res, rej) =>
      rawDb.all(sql, params, (err, rows) => err ? rej(err) : res(rows))),
    run: (sql, params = []) => new Promise((res, rej) =>
      rawDb.run(sql, params, function(err) { err ? rej(err) : res({ lastID: this.lastID, changes: this.changes }); })),
    exec: (sql) => new Promise((res, rej) =>
      rawDb.exec(sql, err => err ? rej(err) : res())),
  });

  const wrapped = wrap(db);

  // Create core tables needed for tests
  await wrapped.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      role TEXT DEFAULT 'user',
      subscription TEXT DEFAULT 'starter',
      referral_code TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT,
      charge TEXT,
      status TEXT DEFAULT 'Open',
      notes TEXT,
      court_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER,
      recipient_id INTEGER,
      case_id INTEGER,
      body TEXT,
      encrypted INTEGER DEFAULT 0,
      read_at TEXT,
      attachment_url TEXT,
      attachment_name TEXT,
      attachment_size INTEGER,
      attachment_mime TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS push_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      token TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saved_lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      provider_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      provider_id INTEGER,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS motions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      motion_type TEXT,
      draft TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      rating INTEGER,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT,
      lat REAL,
      lng REAL,
      phone TEXT,
      email TEXT,
      bar_number TEXT,
      jtb_verified INTEGER DEFAULT 0,
      bar_verified INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS expungement_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT,
      offense_type TEXT,
      eligible INTEGER,
      wait_years INTEGER,
      last_updated TEXT DEFAULT (datetime('now')),
      needs_review INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rights_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jurisdiction TEXT,
      category TEXT,
      content TEXT,
      last_updated TEXT DEFAULT (datetime('now')),
      needs_review INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS crisis_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      active INTEGER DEFAULT 1,
      last_verified TEXT
    );
    CREATE TABLE IF NOT EXISTS account_deletion_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted_at TEXT,
      region TEXT
    );
  `);

  _testDb = wrapped;
  return wrapped;
}

export function resetTestDb() {
  _testDb = null;
}

// ── Token helpers ─────────────────────────────────────────────────────────────
export function makeToken(userId = 1, role = 'user', extra = {}) {
  return jwt.sign(
    { id: userId, role, email: `user${userId}@test.com`, ...extra },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

export function makeAttorneyToken(userId = 10) {
  return makeToken(userId, 'attorney', { subscription: 'basic' });
}

export function makeAdminToken(userId = 99) {
  return makeToken(userId, 'admin');
}

// ── Auth headers helper ───────────────────────────────────────────────────────
export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}
