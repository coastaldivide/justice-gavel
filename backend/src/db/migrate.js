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
