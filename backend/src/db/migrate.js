/**
 * db/migrate.js — retired.
 *
 * The database schema is owned by supabase/migrations/*.sql (PostgreSQL) and is
 * applied with the Supabase CLI / psql. The backend never runs DDL at startup.
 * This file used to create SQLite-syntax tables on every boot (via an npm
 * `prestart` hook); it is kept only so old scripts that invoke it exit cleanly.
 */
console.log('[migrate] Schema is managed by supabase/migrations — nothing to do here.');
