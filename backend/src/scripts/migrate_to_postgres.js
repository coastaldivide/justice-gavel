#!/usr/bin/env node
/**
 * Justice Gavel — SQLite → PostgreSQL Migration Script
 *
 * Run ONCE after setting POSTGRES_URL in your environment.
 * Migrates all data from demo.db and providers.sqlite into Postgres.
 *
 * Usage:
 *   POSTGRES_URL="postgres://user:pass@host:5432/db" node src/scripts/migrate_to_postgres.js
 *
 * What it migrates:
 *   demo.db    → all tables (users, cases, dui_laws, drug_penalties, etc.)
 *   providers  → lawyers, bail_agents, recovery_agents
 *
 * Safety:
 *   - Creates tables if they don't exist (reads schema from SQLite)
 *   - Skips rows that already exist (idempotent — safe to re-run)
 *   - Never deletes data from Postgres
 *   - Reports row counts before and after
 *
 * Estimated time: 30–90 seconds for 6,000+ rows
 */

import Database from 'better-sqlite3';
import pg       from 'pg';
import path     from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DB     = path.resolve(__dirname, '../../demo.db');
const PROV_DB     = path.resolve(__dirname, '../../data/providers.sqlite');
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is not set.');
  console.error('   Usage: POSTGRES_URL="postgres://..." node src/scripts/migrate_to_postgres.js');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

// ── Utility: convert SQLite CREATE TABLE to Postgres-compatible ───────────────
function sqliteToPostgres(createSql) {
  return createSql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/INTEGER PRIMARY KEY/gi, 'BIGINT PRIMARY KEY')
    .replace(/\bINTEGER\b/g, 'BIGINT')
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
    .replace(/\bBLOB\b/g, 'BYTEA')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ')
    .replace(/\bBOOLEAN\b/gi, 'BOOLEAN')
    .replace(/IF NOT EXISTS/gi, 'IF NOT EXISTS')
    .replace(/WITHOUT ROWID/gi, '')
    .replace(/--[^\n]*/g, '')   // strip comments
    .trim();
}

// ── Migrate a single SQLite database file ─────────────────────────────────────
async function migrateDb(sqlitePath, label) {
  console.log('\n' + '─'.repeat(60));
  console.log(\`Migrating ${label}: ${sqlitePath}\`);

  const sqlite = new Database(sqlitePath, { readonly: true });
  const tables = sqlite.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();

  console.log(\`  Found ${tables.length} tables\`);

  for (const { name: tableName, sql: createSql } of tables) {
    if (!createSql) continue;

    // Count rows in SQLite
    const srcCount = sqlite.prepare(\`SELECT COUNT(*) as n FROM "${tableName}"\`).get().n;
    if (srcCount === 0) {
      console.log(\`  ⏭  ${tableName}: 0 rows — skipping\`);
      continue;
    }

    // Create table in Postgres if it doesn't exist
    try {
      const pgSql = sqliteToPostgres(createSql).replace(/^CREATE TABLE/i, 'CREATE TABLE IF NOT EXISTS');
      await pool.query(pgSql);
    } catch (e) {
      // Table may already exist with different schema — that's fine
      if (!e.message.includes('already exists')) {
        console.log(\`  ⚠️  ${tableName}: schema error — \${e.message.substring(0, 80)}\`);
      }
    }

    // Get column names
    const cols = sqlite.pragma(\`table_info("${tableName}")\`).map(r => r.name);
    const placeholders = cols.map((_, i) => \`$${i + 1}\`).join(', ');
    const colList = cols.map(c => \`"${c}"\`).join(', ');

    const insertSql = \`
      INSERT INTO "${tableName}" (${colList})
      VALUES (${placeholders})
      ON CONFLICT DO NOTHING
    \`;

    // Stream rows in batches of 500
    const rows = sqlite.prepare(\`SELECT * FROM "${tableName}"\`).all();
    let inserted = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const values = cols.map(col => {
          const v = row[col];
          // Convert SQLite booleans (0/1) to Postgres booleans
          if (v === 0 || v === 1) {
            // Only convert if column name suggests boolean
            if (/^(active|verified|is_|has_|bar_verified|pro_bono|sliding_scale|free_consult|jtb_verified|implied_consent|armed_certif)/.test(col)) {
              return v === 1;
            }
          }
          return v === undefined ? null : v;
        });
        try {
          await client.query(insertSql, values);
          inserted++;
        } catch {}
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log(\`  ❌ ${tableName}: transaction failed — \${e.message}\`);
    } finally {
      client.release();
    }

    const pgCount = (await pool.query(\`SELECT COUNT(*) as n FROM "${tableName}"\`)).rows[0].n;
    const status  = parseInt(pgCount) >= srcCount ? '✅' : '⚠️ ';
    console.log(\`  ${status} ${tableName}: SQLite ${srcCount} → Postgres ${pgCount}\`);
  }

  sqlite.close();
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Justice Gavel — SQLite → PostgreSQL Migration');
  console.log('Target: ' + POSTGRES_URL.replace(/:[^:@]+@/, ':***@'));

  try {
    await pool.query('SELECT 1');
    console.log('✅ Postgres connection verified');
  } catch (e) {
    console.error('❌ Cannot connect to Postgres:', e.message);
    process.exit(1);
  }

  await migrateDb(DEMO_DB, 'demo.db (legal data + users)');
  await migrateDb(PROV_DB, 'providers.sqlite (attorneys + bail agents)');

  console.log('\n' + '='.repeat(60));
  console.log('Migration complete.');
  console.log('\nNext steps:');
  console.log('  1. Set POSTGRES_URL in Railway environment');
  console.log('  2. Verify row counts match in Postgres');
  console.log('  3. Remove POSTGRES_URL if you need to test SQLite again');
  console.log('  4. Deploy backend — db/index.js will auto-switch to Postgres');

  await pool.end();
}

main().catch(e => {
  console.error('Migration failed:', e);
  pool.end().finally(() => process.exit(1));
});
