/**
 * scripts/_db.js — Unified database adapter for scrape/seed scripts
 *
 * In production (DATABASE_URL set): uses Supabase PostgreSQL via pg
 * In local dev (no DATABASE_URL):   uses SQLite via better-sqlite3
 *
 * All scripts import { getDb, upsertProvider, upsertBailAgent } from './_db.js'
 */

import pg        from 'pg';
import Database  from 'better-sqlite3';
import path      from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_PG    = !!process.env.DATABASE_URL;

let _pgPool = null;
let _sqlite  = null;

// ── Connection ─────────────────────────────────────────────────────────────────
export async function getDb() {
  if (USE_PG) {
    if (!_pgPool) {
      _pgPool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
      });
      console.log('[db] Connected to Supabase PostgreSQL');
    }
    return {
      type: 'pg',
      pool: _pgPool,
      async run(sql, params = []) {
        const result = await _pgPool.query(sql, params);
        return result;
      },
      async get(sql, params = []) {
        const result = await _pgPool.query(sql, params);
        return result.rows[0] || null;
      },
      async all(sql, params = []) {
        const result = await _pgPool.query(sql, params);
        return result.rows;
      },
    };
  } else {
    if (!_sqlite) {
      const dbPath = path.join(__dirname, '../../data/providers.sqlite');
      _sqlite = new Database(dbPath);
      _sqlite.pragma('journal_mode = WAL');
      console.log('[db] Connected to local SQLite:', dbPath);
    }
    return {
      type: 'sqlite',
      db:   _sqlite,
      run:  (sql, params = []) => _sqlite.prepare(sql).run(...params),
      get:  (sql, params = []) => _sqlite.prepare(sql).get(...params),
      all:  (sql, params = []) => _sqlite.prepare(sql).all(...params),
    };
  }
}

// ── Upsert helpers (work on both PG and SQLite) ────────────────────────────────
export async function upsertProvider(db, record) {
  if (db.type === 'pg') {
    await db.run(`
      INSERT INTO attorneys (
        name, firm, phone, email, address, city, state, lat, lng,
        specialties, bar_number, bar_verified, website, rating,
        review_count, source, source_id, verified, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
      ON CONFLICT (source_id) DO UPDATE SET
        name=EXCLUDED.name, phone=EXCLUDED.phone, address=EXCLUDED.address,
        rating=EXCLUDED.rating, review_count=EXCLUDED.review_count,
        website=EXCLUDED.website, updated_at=NOW()
    `, [
      record.name, record.firm, record.phone, record.email,
      record.address, record.city, record.state,
      record.lat, record.lng,
      JSON.stringify(record.specialties || []),
      record.bar_number, record.bar_verified ? 1 : 0,
      record.website, record.rating, record.review_count,
      record.source, record.source_id, record.verified ? 1 : 0,
    ]);
  } else {
    db.run(`
      INSERT OR REPLACE INTO attorneys
        (name,firm,phone,email,address,city,state,lat,lng,specialties,
         bar_number,bar_verified,website,rating,review_count,source,source_id,verified,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `, [
      record.name, record.firm, record.phone, record.email,
      record.address, record.city, record.state, record.lat, record.lng,
      JSON.stringify(record.specialties || []),
      record.bar_number, record.bar_verified ? 1 : 0,
      record.website, record.rating, record.review_count,
      record.source, record.source_id, record.verified ? 1 : 0,
    ]);
  }
}

export async function upsertBailAgent(db, record) {
  if (db.type === 'pg') {
    await db.run(`
      INSERT INTO bail_agents (
        name, company, phone, address, city, state, lat, lng,
        license, verified, source, source_id, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (source_id) DO UPDATE SET
        name=EXCLUDED.name, phone=EXCLUDED.phone, address=EXCLUDED.address,
        updated_at=NOW()
    `, [
      record.name, record.company, record.phone, record.address,
      record.city, record.state, record.lat, record.lng,
      record.license, record.verified ? 1 : 0,
      record.source, record.source_id,
    ]);
  } else {
    db.run(`
      INSERT OR REPLACE INTO bail_agents
        (name,company,phone,address,city,state,lat,lng,license,verified,source,source_id,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `, [
      record.name, record.company, record.phone, record.address,
      record.city, record.state, record.lat, record.lng,
      record.license, record.verified ? 1 : 0,
      record.source, record.source_id,
    ]);
  }
}

export async function closeDb() {
  if (_pgPool) await _pgPool.end();
  if (_sqlite)  _sqlite.close();
}
