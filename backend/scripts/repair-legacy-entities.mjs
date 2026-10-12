#!/usr/bin/env node
/**
 * repair-legacy-entities.mjs — one-off repair for audit11 M1.
 *
 * Before step 11 two input "sanitisers" HTML-encoded user text on the way INTO
 * the database (utils/sanitize.sanitizeStr: < > " ' ` ; routes/feedback.js also
 * & and /). React Native renders text literally, so stored values showed up as
 * `I don&#x27;t know what &quot;bail&quot; means`. Text is now stored raw and
 * escaped only where HTML is generated; this script restores rows written by
 * the old code.
 *
 * Only USER-AUTHORED columns that went through those sanitisers are touched:
 *   case_messages.body / content   (encrypted at rest — decrypted, repaired, re-encrypted)
 *   messages.content               (encrypted — bulk attorney messages)
 *   feedback.comment / issue / screen / contact / device_info   (also decodes &amp;)
 * Never lawyers / bail_agents or any directory table.
 *
 * DRY RUN by default (prints counts and a few before/after samples, writes
 * nothing). Pass --apply to write. Idempotent: a repaired value contains no
 * legacy entities, so a second run changes nothing.
 *
 *   DATABASE_URL=postgres://… ENCRYPTION_KEY=… node scripts/repair-legacy-entities.mjs [--apply]
 *
 * ENCRYPTION_KEY must be the production key, or encrypted rows cannot be read
 * (they are then skipped and counted as "unreadable", never overwritten).
 */
import pg from 'pg';
import { decodeLegacyEntities } from '../src/utils/sanitize.js';

const APPLY = process.argv.includes('--apply');
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!process.env.ENCRYPTION_KEY) { console.error('ENCRYPTION_KEY is required (encrypted message bodies)'); process.exit(2); }
const { encrypt, decrypt, isEncrypted } = await import('../src/services/encryption.js');

const TARGETS = [
  { table: 'case_messages', cols: ['body', 'content'], encrypted: true,  decodeAmp: false },
  { table: 'messages',      cols: ['content'],         encrypted: true,  decodeAmp: false },
  { table: 'feedback',      cols: ['comment', 'issue', 'screen', 'contact', 'device_info'], encrypted: false, decodeAmp: true },
];
const LEGACY = /&(?:lt|gt|quot|amp|#x27|#39|#x60|#96|#x2F|#47);/;

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
const report = [];
try {
  if (APPLY) await client.query('BEGIN');
  for (const t of TARGETS) {
    const exists = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t.table]);
    const have = new Set(exists.rows.map(r => r.column_name));
    for (const col of t.cols) {
      if (!have.has(col)) continue;
      const stats = { table: t.table, column: col, scanned: 0, changed: 0, unreadable: 0, samples: [] };
      const rows = await client.query(`SELECT id, ${col} AS v FROM ${t.table} WHERE ${col} IS NOT NULL AND ${col} <> ''`);
      for (const { id, v } of rows.rows) {
        stats.scanned++;
        let plain = v;
        if (t.encrypted && isEncrypted(v)) {
          plain = decrypt(v);
          if (plain === v) { stats.unreadable++; continue; }   // wrong key / corrupt — never overwrite
        }
        if (typeof plain !== 'string' || !LEGACY.test(plain)) continue;
        const fixed = decodeLegacyEntities(plain, { decodeAmp: t.decodeAmp });
        if (fixed === plain) continue;
        stats.changed++;
        if (stats.samples.length < 3) stats.samples.push({ id: Number(id), before: plain.slice(0, 80), after: fixed.slice(0, 80) });
        if (APPLY) {
          const out = t.encrypted && isEncrypted(v) ? encrypt(fixed) : fixed;
          await client.query(`UPDATE ${t.table} SET ${col} = $1 WHERE id = $2`, [out, id]);
        }
      }
      report.push(stats);
    }
  }
  if (APPLY) await client.query('COMMIT');
} catch (e) {
  if (APPLY) await client.query('ROLLBACK').catch(() => {});
  console.error('repair failed, nothing written:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
for (const s of report) {
  console.log(`${s.table}.${s.column}: scanned ${s.scanned}, ${APPLY ? 'repaired' : 'would repair'} ${s.changed}${s.unreadable ? `, unreadable (skipped) ${s.unreadable}` : ''}`);
  for (const x of s.samples) console.log(`   #${x.id}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`);
}
if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply to repair.');
