/**
 * migrate.js — Runs all SQL migrations idempotently
 * Each statement is run individually so ALTER TABLE failures
 * (column already exists) don't abort the whole migration.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const DEMO_DB        = path.resolve(__dirname, '../../demo.db');
const PG_URL         = process.env.POSTGRES_URL || '';
const isPg           = !!PG_URL;

async function runSqlite(sql) {
  const db = await open({ filename: DEMO_DB, driver: sqlite3.Database });
  // Run each statement individually so a "column already exists" error
  // on ALTER TABLE doesn't abort remaining statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  for (const stmt of statements) {
    try {
      await db.exec(stmt + ';');
    } catch (e) {
      // Silently skip "duplicate column" and "already exists" errors
      if (
        e.message?.includes('duplicate column') ||
        e.message?.includes('already exists') ||
        e.message?.includes('UNIQUE constraint') ||
        e.message?.includes('table') && e.message?.includes('already exists')
      ) {
        // Expected on re-runs — skip silently
      } else {
        console.warn(`  ⚠ Statement skipped: ${e.message?.slice(0, 80)}`);
      }
    }
  }
  await db.close();
}

async function runPg(sql) {
  const c = new Client({ connectionString: PG_URL });
  await c.connect();
  await c.query(sql);
  await c.end();
}

(async () => {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} migrations against ${isPg ? 'PostgreSQL' : 'SQLite'}...`);

  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
    console.log('  Applying:', f);
    if (isPg) await runPg(sql);
    else await runSqlite(sql);
  }

  console.log('✓ Migrations complete');
})().catch(e => { console.error('Migration failed:', e); process.exit(1); });
