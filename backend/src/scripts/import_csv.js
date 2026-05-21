/**
 * import_csv.js — Import attorneys or bail agents from a CSV file
 *
 * This is the "no-code" way to add real attorneys to the database.
 * Download a CSV from a state bar, clean it in Excel/Google Sheets,
 * and import it here.
 *
 * Usage:
 *   node src/scripts/import_csv.js --file attorneys.csv --type lawyers
 *   node src/scripts/import_csv.js --file bail_agents.csv --type bail
 *   node src/scripts/import_csv.js --file attorneys.csv --dry-run
 *   node src/scripts/import_csv.js --file attorneys.csv --city "Nashville, TN"
 *
 * Required CSV columns (case-insensitive, order doesn't matter):
 *   name         — Attorney or business name (required)
 *   phone        — Phone number in any format
 *   address      — Full street address
 *   city         — City (or use --city flag to set for all rows)
 *   email        — Email address
 *   website      — Website URL
 *   bar_number   — State bar number (lawyers only)
 *   specialties  — Comma-separated: "DUI, Drug Offenses, Assault"
 *   languages    — Comma-separated: "English, Spanish"
 *   pro_bono     — yes/no/true/false/1/0
 *   sliding_scale — yes/no/true/false/1/0
 *   free_consultation — yes/no/true/false/1/0
 *   years_experience  — Number
 *   bio          — Short bio / description
 *   verified     — yes/no (set to yes only if you've verified the listing)
 *   lat          — Latitude (optional, will be null if omitted)
 *   lng          — Longitude (optional, will be null if omitted)
 *
 * Template CSV: run with --template to print a blank CSV header
 */

import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/providers.sqlite');

const argv = yargs(hideBin(process.argv))
  .option('file',     { type: 'string',  describe: 'Path to CSV file' })
  .option('type',     { type: 'string',  choices: ['lawyers', 'bail'], default: 'lawyers' })
  .option('city',     { type: 'string',  describe: 'Override/default city for all rows' })
  .option('dry-run',  { type: 'boolean', default: false })
  .option('template', { type: 'boolean', default: false, describe: 'Print blank CSV template and exit' })
  .argv;

// ── CSV template ──────────────────────────────────────────────────────────────
if (argv.template) {
  const lawyerCols = 'name,phone,address,city,email,website,bar_number,specialties,languages,pro_bono,sliding_scale,free_consultation,years_experience,bio,verified,lat,lng';
  const bailCols   = 'name,phone,address,city,email,website,hours,verified,lat,lng';
  const cols = argv.type === 'bail' ? bailCols : lawyerCols;
  console.log(cols);
  console.log(`# Paste your data below this line. Remove this comment row before importing.`);
  console.log(`# Example (lawyers):`);
  console.log(`Jane Smith Esq.,615-555-0100,"123 Main St, Nashville, TN","Nashville, TN",jane@smithlaw.com,https://smithlaw.com,TN012345,"DUI, Drug Offenses","English, Spanish",yes,yes,yes,12,Former public defender. Free consultations.,yes,36.1627,-86.7816`);
  process.exit(0);
}

if (!argv.file) {
  console.error('Error: --file is required. Run with --template to see the CSV format.');
  process.exit(1);
}

// ── CSV parser (no dependencies — pure Node.js) ───────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

async function readCSV(filePath) {
  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // skip blank + comment lines
    lines.push(parseCSVLine(trimmed));
  }

  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');

  const headers = lines[0].map(h => h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  const rows = lines.slice(1).map(values => {
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });

  return rows;
}

// ── Value normalizers ─────────────────────────────────────────────────────────
function normalizePhone(s) {
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return digits.length >= 7 ? s.trim() : null;
}

function normalizeBool(s) {
  if (!s) return 0;
  return /^(yes|true|1|y)$/i.test(String(s).trim()) ? 1 : 0;
}

function normalizeSpecialties(s) {
  if (!s) return JSON.stringify([]);
  return JSON.stringify(s.split(',').map(x => x.trim()).filter(Boolean));
}

function normalizeLanguages(s) {
  if (!s) return JSON.stringify(['English']);
  const langs = s.split(',').map(x => x.trim()).filter(Boolean);
  return JSON.stringify(langs.length ? langs : ['English']);
}

function normalizeUrl(s) {
  if (!s) return null;
  const u = s.trim();
  return u.startsWith('http') ? u : u ? 'https://' + u : null;
}

// ── DB upsert ─────────────────────────────────────────────────────────────────
async function upsertRow(db, row, type, defaultCity, dryRun) {
  const name = row.name?.trim();
  if (!name || name.length < 2) return 'skipped';

  const city = (row.city?.trim() || defaultCity || '').trim();
  if (!city) { console.warn(`  ⚠ Skipping "${name}" — no city. Use --city flag or add city column.`); return 'skipped'; }

  const phone   = normalizePhone(row.phone);
  const address = row.address?.trim() || city;
  const email   = row.email?.trim() || null;
  const website = normalizeUrl(row.website);
  const lat     = row.lat ? parseFloat(row.lat) || null : null;
  const lng     = row.lng ? parseFloat(row.lng) || null : null;
  const verified = normalizeBool(row.verified || row.verified_);
  const sourceId = `csv_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40)}_${city.replace(/\W/g, '').toLowerCase().substring(0, 10)}`;

  if (dryRun) {
    console.log(`    [DRY-RUN] ${type}: ${name} | ${city} | ${phone || 'no phone'} | ${email || 'no email'}`);
    return 'dry-run';
  }

  if (type === 'lawyers') {
    const existing = await db.get(
      'SELECT id FROM lawyers WHERE LOWER(name)=LOWER(?) AND city=?',
      [name, city]
    );
    if (existing) {
      await db.run(
        `UPDATE lawyers SET phone=COALESCE(phone,?), address=COALESCE(address,?),
         email=COALESCE(email,?), website=COALESCE(website,?),
         bar_number=COALESCE(bar_number,?), verified=MAX(verified,?),
         lat=COALESCE(lat,?), lng=COALESCE(lng,?), updated_at=datetime('now')
         WHERE id=?`,
        [phone, address, email, website, row.bar_number || null, verified, lat, lng, existing.id]
      );
      return 'updated';
    }
    await db.run(
      `INSERT INTO lawyers (city, name, phone, address, lat, lng, website, email,
       bar_number, verified, pro_bono, sliding_scale, free_consultation,
       years_experience, bio, specialties, languages, source, source_id, active, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`,
      [
        city, name, phone, address, lat, lng, website, email,
        row.bar_number || null,
        verified,
        normalizeBool(row.pro_bono),
        normalizeBool(row.sliding_scale),
        normalizeBool(row.free_consultation),
        row.years_experience ? parseInt(row.years_experience) || null : null,
        row.bio?.trim() || null,
        normalizeSpecialties(row.specialties),
        normalizeLanguages(row.languages),
        'csv', sourceId,
      ]
    );
    return 'inserted';
  } else {
    const existing = await db.get(
      'SELECT id FROM bail_agents WHERE LOWER(name)=LOWER(?) AND city=?',
      [name, city]
    );
    if (existing) {
      await db.run(
        `UPDATE bail_agents SET phone=COALESCE(phone,?), email=COALESCE(email,?),
         website=COALESCE(website,?), hours=COALESCE(hours,?),
         lat=COALESCE(lat,?), lng=COALESCE(lng,?), updated_at=datetime('now')
         WHERE id=?`,
        [phone, email, website, row.hours || null, lat, lng, existing.id]
      );
      return 'updated';
    }
    await db.run(
      `INSERT INTO bail_agents (city, name, phone, address, lat, lng, website, email,
       hours, verified, source, source_id, active, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`,
      [city, name, phone, address, lat, lng, website, email, row.hours || null, verified, 'csv', sourceId]
    );
    return 'inserted';
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(argv.file)) {
    console.error(`File not found: ${argv.file}`);
    process.exit(1);
  }

  console.log(`\n📂 Importing ${argv.type} from ${argv.file}`);
  if (argv['dry-run']) console.log('   DRY RUN — no changes will be made\n');

  const rows = await readCSV(argv.file);
  console.log(`   ${rows.length} rows found\n`);

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');

  let inserted = 0, updated = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    try {
      const result = await upsertRow(db, row, argv.type, argv.city, argv['dry-run']);
      if (result === 'inserted') { inserted++; process.stdout.write(`  ✓ Added:    ${row.name}\n`); }
      else if (result === 'updated') { updated++; process.stdout.write(`  ↻ Updated:  ${row.name}\n`); }
      else if (result === 'skipped') skipped++;
      else if (result === 'dry-run') {}
    } catch (e) {
      errors++;
      console.error(`  ✗ Error on "${row.name}": ${e.message}`);
    }
  }

  console.log(`\n✅ Import complete`);
  console.log(`   Inserted: ${inserted} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);

  if (!argv['dry-run']) {
    const lCount = await db.get('SELECT COUNT(*) as n FROM lawyers WHERE active=1');
    const bCount = await db.get('SELECT COUNT(*) as n FROM bail_agents WHERE active=1');
    console.log(`   DB totals: ${lCount.n} active lawyers, ${bCount.n} active bail agents`);
  }

  await db.close();
})().catch(e => { console.error('Import failed:', e); process.exit(1); });
