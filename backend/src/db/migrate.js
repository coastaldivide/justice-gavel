/**
 * migrate.js — Run pending DB migrations at server startup.
 * Called via `prestart` npm script.
 * Safe to run multiple times (idempotent).
 */
import { getDb } from './index.js';
import logger from '../utils/logger.js';

async function migrate() {
  const db = await getDb();

  const migrations = [
    // Audit log — immutable record of all sensitive operations
    `CREATE TABLE IF NOT EXISTS audit_log (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id     INTEGER,
       action      TEXT    NOT NULL,
       entity_type TEXT,
       entity_id   TEXT,
       ip_address  TEXT,
       user_agent  TEXT,
       metadata    TEXT,
       created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,

    // Disclaimer version tracking — force re-acceptance when legal text changes
    `CREATE TABLE IF NOT EXISTS disclaimer_versions (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       version     TEXT    NOT NULL UNIQUE,
       title       TEXT    NOT NULL,
       effective_at TEXT   NOT NULL,
       content_hash TEXT   NOT NULL,
       created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS user_disclaimer_acceptance (
       user_id    INTEGER NOT NULL,
       version    TEXT    NOT NULL,
       accepted_at TEXT   NOT NULL DEFAULT (datetime('now')),
       ip_address  TEXT,
       PRIMARY KEY (user_id, version)
     )`,

    // Refresh tokens table (single-use rotation, replay detection)
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id    INTEGER NOT NULL,
       token_hash TEXT    NOT NULL,
       expires_at TEXT    NOT NULL,
       used       INTEGER NOT NULL DEFAULT 0,
       created_at TEXT    NOT NULL DEFAULT (datetime('now')),
       UNIQUE(user_id, token_hash)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rt_hash ON refresh_tokens(token_hash)`,
    // Ensure password_resets table exists
    `CREATE TABLE IF NOT EXISTS password_resets (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id    INTEGER NOT NULL,
       token      TEXT NOT NULL UNIQUE,
       expires_at TEXT NOT NULL,
       used       INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    // Ensure callback_requests table exists
    `CREATE TABLE IF NOT EXISTS callback_requests (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id      INTEGER NOT NULL,
       lawyer_id    INTEGER,
       lawyer_name  TEXT NOT NULL DEFAULT '',
       phone        TEXT,
       requested_at TEXT,
       notes        TEXT,
       status       TEXT NOT NULL DEFAULT 'pending',
       created_at   TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    // Ensure payment_history table exists
    `CREATE TABLE IF NOT EXISTS payment_history (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id       INTEGER NOT NULL,
       amount_cents  INTEGER NOT NULL DEFAULT 0,
       description   TEXT,
       stripe_pi_id  TEXT,
       status        TEXT NOT NULL DEFAULT 'succeeded',
       created_at    TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ];

  let ran = 0;
  for (const sql of migrations) {
    try {
      await db.run(sql);
      ran++;
    } catch (e) {
      // Table may already exist or DB adapter may not support this — non-fatal
    }
  }

  if (ran > 0) logger.info(`[migrate] ${ran} migration(s) applied`);
}

migrate().catch(e => {
  // Non-fatal — server starts even if migrations fail
  console.warn('[migrate] Migration error (non-fatal):', e.message);
  process.exit(0);
});
