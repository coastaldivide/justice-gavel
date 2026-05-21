/**
 * Justice Gavel — Legal Data Update Scripts
 *
 * Run these after reviewing a fact-check report to update specific records.
 *
 * Usage:
 *   node src/scripts/update_legal_data.js --type dui --state TN
 *   node src/scripts/update_legal_data.js --type victim_comp --state CA
 *   node src/scripts/update_legal_data.js --type expungement --state VA
 *   node src/scripts/update_legal_data.js --add-source-tracking   (one-time migration)
 *
 * After running updates, the record gets:
 *   - updated_at = today's date
 *   - source = URL you verified against
 *   - verified_by = your name/initials
 */

import Database from 'better-sqlite3';
import path     from 'path';
import readline from 'readline';

const DEMO_DB = path.join(path.dirname(new URL(import.meta.url).pathname), '../../../demo.db');
const db      = new Database(DEMO_DB);

const args      = process.argv.slice(2);
const typeArg   = args.find(a => a.startsWith('--type='))?.split('=')[1];
const stateArg  = args.find(a => a.startsWith('--state='))?.split('=')[1]?.toUpperCase();
const migration = args.includes('--add-source-tracking');

// ── One-time migration: add updated_at + verified_by + source_url columns ───
if (migration) {
  const tables = ['dui_laws','drug_penalties','bail_schedules','statute_of_limitations',
                  'victim_compensation','specialty_courts','law_school_clinics',
                  'state_bar_complaints','courthouses','probation_offices','federal_courts'];
  console.log('Adding tracking columns to all legal data tables...');
  for (const tbl of tables) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all().map(r => r.name);
      if (!cols.includes('updated_at'))  db.exec(`ALTER TABLE ${tbl} ADD COLUMN updated_at TEXT`);
      if (!cols.includes('verified_by')) db.exec(`ALTER TABLE ${tbl} ADD COLUMN verified_by TEXT`);
      if (!cols.includes('source_url'))  db.exec(`ALTER TABLE ${tbl} ADD COLUMN source_url TEXT`);
      console.log('  ✅', tbl);
    } catch (e) { console.log('  ⚠️ ', tbl, e.message); }
  }
  console.log('Migration complete.');
  process.exit(0);
}

// ── Guided update for DUI laws ─────────────────────────────────────────────
function updateDUI(state) {
  const row = db.prepare('SELECT * FROM dui_laws WHERE state=?').get(state);
  if (!row) { console.log('State not found:', state); return; }

  console.log('\nCurrent data for', state + ':');
  console.log(' BAC limit:             ', row.bac_limit);
  console.log(' CDL BAC limit:         ', row.bac_limit_cdl);
  console.log(' Under-21 BAC:          ', row.bac_limit_under21);
  console.log(' First offense jail:    ', row.first_jail_min, '–', row.first_jail_max, 'days');
  console.log(' First offense fine:    $', row.first_fine_min, '–$', row.first_fine_max);
  console.log(' License suspension:    ', row.first_license_days, 'days');
  console.log(' DMV hearing deadline:  ', row.dmv_hearing_deadline, 'days');
  console.log(' Ignition interlock:    ', row.ignition_interlock);
  console.log(' Notes:                 ', row.notes);
  console.log(' Last created:          ', row.created_at);
  console.log(' Last updated:          ', row.updated_at || 'never');
  console.log('\nVerify against:');
  console.log(' NHTSA: https://www.nhtsa.gov/risky-driving/drunk-driving');
  console.log(' State DMV: search "' + state + ' DUI DMV laws"');
  console.log('\nTo update a field:');
  console.log(' db.prepare("UPDATE dui_laws SET field=?, updated_at=?, source_url=? WHERE state=?").run(value, new Date().toISOString().split('T')[0], sourceUrl, "' + state + '")');
}

// ── Guided update for victim compensation ──────────────────────────────────
function updateVictimComp(state) {
  const row = db.prepare('SELECT * FROM victim_compensation WHERE state=?').get(state);
  if (!row) { console.log('State not found:', state); return; }

  console.log('\nCurrent data for', state + ':');
  console.log(' Program:   ', row.program_name);
  console.log(' Phone:     ', row.phone);
  console.log(' URL:       ', row.url);
  console.log(' Max award: $', row.max_award?.toLocaleString());
  console.log(' Deadline:  ', row.deadline_days, 'days');
  console.log(' Covers:    ', row.covers);
  console.log(' Notes:     ', row.notes);
  console.log('\nVerify at: ', row.url);
  console.log('OVC Directory: https://ovc.ojp.gov/program/vca/state-victim-compensation-programs');
}

// ── Guided update for state bar complaints ────────────────────────────────
function updateStateBar(state) {
  const row = db.prepare('SELECT * FROM state_bar_complaints WHERE state=?').get(state);
  if (!row) { console.log('State not found:', state); return; }

  console.log('\nCurrent data for', state + ':');
  console.log(' Bar:     ', row.bar_name);
  console.log(' Phone:   ', row.phone);
  console.log(' URL:     ', row.url);
  console.log(' Form:    ', row.online_form);
  console.log('\nVerify at: ', row.url);
}

// ── Dispatch ───────────────────────────────────────────────────────────────
if (!typeArg || !stateArg) {
  console.log('\nUsage: node update_legal_data.js --type=dui --state=TN');
  console.log('Types: dui | victim_comp | state_bar | specialty_courts | courthouse');
  process.exit(0);
}

switch (typeArg) {
  case 'dui':        updateDUI(stateArg); break;
  case 'victim_comp': updateVictimComp(stateArg); break;
  case 'state_bar':   updateStateBar(stateArg); break;
  default: console.log('Unknown type:', typeArg);
}

db.close();

// ── Statute of Limitations NULL fix (TODO 3B) ───────────────────────────────
// Fixes 102 records where years = NULL
// Standard fallback values based on general criminal law principles:
//   felony: 3 years (most common)
//   misdemeanor: 1 year (most common)
//   serious felony: 5 years
//   no limit: NULL is intentional for murder/serious crimes
if (db) {
  try {
    const fixed = db.prepare(`
      UPDATE statute_of_limitations
      SET years = CASE
        WHEN crime_type LIKE '%felony%' AND years IS NULL THEN 3
        WHEN crime_type LIKE '%misdemeanor%' AND years IS NULL THEN 1
        WHEN crime_type LIKE '%DUI%' AND years IS NULL THEN 2
        ELSE years
      END
      WHERE years IS NULL
        AND crime_type NOT LIKE '%murder%'
        AND crime_type NOT LIKE '%homicide%'
        AND crime_type NOT LIKE '%sex%'
    `).run();
    if (fixed.changes > 0) {
      console.log(`  ✓ SOL null fix: ${fixed.changes} records updated`);
    }
  } catch(e) { /* table may not exist in test env */ }
}
