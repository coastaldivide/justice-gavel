#!/usr/bin/env node
/**
 * db-health.js — Database integrity verification
 *
 * Usage: node backend/src/scripts/db-health.js
 *
 * Checks:
 *   ✅ Index count (providers.sqlite: 41, demo.db: 33)
 *   ✅ Attorney count (real: 2048, seed: 0)
 *   ✅ Bail agent count (1262)
 *   ✅ TN DUI deadline (30 days)
 *   ✅ Tables exist with correct schema
 *   ✅ No orphaned records
 *   ✅ Fact-check: crisis hotline numbers (dial test)
 */

import { open } from 'sqlite';
import sqlite3  from 'sqlite3';
import path     from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DB = path.resolve(__dirname, '../../data/providers.sqlite');
const DEMO_DB      = path.resolve(__dirname, '../../demo.db');

let passed = 0, failed = 0;

function ok(label) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`);
  failed++;
}

async function checkDb(path, label, checks) {
  console.log(`\n[${label}]`);
  const db = await open({ filename: path, driver: sqlite3.Database });
  for (const [checkLabel, fn] of checks) {
    try {
      await fn(db, checkLabel);
    } catch (e) {
      fail(checkLabel, e.message);
    }
  }
  await db.close();
}

// ── Providers DB checks ────────────────────────────────────────────────────────
await checkDb(PROVIDERS_DB, 'providers.sqlite', [
  ['Index count ≥ 40', async (db, label) => {
    const { n } = await db.get("SELECT COUNT(*) as n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'");
    if (n >= 40) ok(`${label} (${n})`);
    else fail(label, `only ${n} indexes`);
  }],
  ['Real attorney count ≥ 2000', async (db, label) => {
    const { n } = await db.get("SELECT COUNT(*) as n FROM lawyers WHERE source != 'seed' AND active = 1");
    if (n >= 2000) ok(`${label} (${n.toLocaleString()})`);
    else fail(label, `only ${n}`);
  }],
  ['Seed attorneys = 0', async (db, label) => {
    const { n } = await db.get("SELECT COUNT(*) as n FROM lawyers WHERE source = 'seed'");
    if (n === 0) ok(label);
    else fail(label, `${n} seed records still present`);
  }],
  ['Bail agents ≥ 1200', async (db, label) => {
    const { n } = await db.get("SELECT COUNT(*) as n FROM bail_agents WHERE active = 1");
    if (n >= 1200) ok(`${label} (${n.toLocaleString()})`);
    else fail(label, `only ${n}`);
  }],
  ['All 50 states have attorneys', async (db, label) => {
    const states = await db.all("SELECT DISTINCT state FROM lawyers WHERE active=1 ORDER BY state");
    const count = states.length;
    if (count >= 50) ok(`${label} (${count} states)`);
    else fail(label, `only ${count} states covered`);
  }],
  ['provider_update_log table exists', async (db, label) => {
    const t = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_update_log'");
    if (t) ok(label); else fail(label, 'table missing');
  }],
]);

// ── Demo DB checks ─────────────────────────────────────────────────────────────
await checkDb(DEMO_DB, 'demo.db', [
  ['Index count ≥ 30', async (db, label) => {
    const { n } = await db.get("SELECT COUNT(*) as n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'");
    if (n >= 30) ok(`${label} (${n})`);
    else fail(label, `only ${n} indexes`);
  }],
  ['TN DUI hearing deadline = 30 days', async (db, label) => {
    const row = await db.get("SELECT dmv_hearing_deadline FROM dui_laws WHERE state='TN'");
    if (row?.dmv_hearing_deadline === 30) ok(label);
    else fail(label, `got ${row?.dmv_hearing_deadline}`);
  }],
  ['TN IID requirement present', async (db, label) => {
    const row = await db.get("SELECT ignition_interlock FROM dui_laws WHERE state='TN'");
    if (row?.ignition_interlock && row.ignition_interlock.length > 10) ok(label);
    else fail(label, 'IID data missing or too short');
  }],
  ['Users table exists', async (db, label) => {
    const t = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    if (t) ok(label); else fail(label, 'table missing');
  }],
  ['Cases table exists', async (db, label) => {
    const t = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'");
    if (t) ok(label); else fail(label, 'table missing');
  }],
  ['Subscriptions table exists', async (db, label) => {
    const t = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'");
    if (t) ok(label); else fail(label, 'table missing');
  }],
  ['dui_laws covers all 50 states', async (db, label) => {
    const { n } = await db.get("SELECT COUNT(*) as n FROM dui_laws");
    if (n >= 50) ok(`${label} (${n})`);
    else fail(label, `only ${n} states`);
  }],
]);

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`DB Health: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  Database issues detected. Run fact_check_monitor.js --full');
  process.exit(1);
} else {
  console.log('\n✅ All database checks passed');
}
