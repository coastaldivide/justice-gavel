/**
 * helpers/schema.js — the database schema as text, for source-level schema tests.
 *
 * The schema used to be a SQLite bootstrap inside src/db/index.js. It now lives in
 * supabase/migrations/*.sql (PostgreSQL) and db/index.js is only the adapter, so
 * schema assertions read the migrations instead.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const MIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');

let _cache = null;
export function schemaSql() {
  if (_cache === null) {
    _cache = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()
      .map(f => readFileSync(path.join(MIG_DIR, f), 'utf8')).join('\n');
  }
  return _cache;
}
export default schemaSql;

/** Column names of a table: its CREATE TABLE body plus every ALTER TABLE … ADD COLUMN. */
export function tableColumns(table) {
  const sql = schemaSql();
  const cols = new Set();
  const t = `(?:public\\.)?"?${table}"?`;
  const create = new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\s*\\(([\\s\\S]*?)\\n\\);`, 'g');
  let m;
  while ((m = create.exec(sql))) {
    for (const line of m[1].split('\n')) {
      const c = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[A-Za-z]/i);
      if (c && !/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)$/i.test(c[1])) cols.add(c[1].toLowerCase());
    }
    // single-line CREATE TABLE … ( a TYPE, b TYPE )
    for (const part of m[1].split(',')) {
      const c = part.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[A-Za-z]/i);
      if (c && !/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)$/i.test(c[1])) cols.add(c[1].toLowerCase());
    }
  }
  const alter = new RegExp(`ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${t}\\s+([\\s\\S]*?);`, 'g');
  while ((m = alter.exec(sql))) {
    for (const a of m[1].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?"?([a-z_][a-z0-9_]*)"?/gi)) cols.add(a[1].toLowerCase());
  }
  return cols;
}

/** True when the schema declares uniqueness over exactly these columns of the table. */
export function hasUnique(table, columns) {
  const sql = schemaSql().replace(/\s+/g, ' ');
  const list = columns.join('\\s*,\\s*');
  return new RegExp(`UNIQUE (?:INDEX [^;]*? ON (?:public\\.)?"?${table}"? (?:USING \\w+ )?)?\\(\\s*${list}\\s*\\)`, 'i').test(sql)
      && new RegExp(`(?:public\\.)?"?${table}"?[^;]*UNIQUE[^;]*\\(\\s*${list}\\s*\\)|UNIQUE INDEX[^;]* ON (?:public\\.)?"?${table}"?[^;]*\\(\\s*${list}\\s*\\)`, 'i').test(sql);
}

/**
 * Rows of `INSERT INTO "<table>" (cols…) VALUES (…), (…);` seed statements in the
 * migrations, as objects keyed by column name (read-only parse; values are strings,
 * NULL → null).
 */
export function seedRows(table) {
  const sql = schemaSql();
  const rows = [];
  const re = new RegExp(`INSERT INTO (?:public\\.)?"?${table}"?\\s*\\(([^)]*)\\)\\s*VALUES`, 'g');
  let m;
  while ((m = re.exec(sql))) {
    const cols = m[1].split(',').map(c => c.trim().replace(/"/g, ''));
    let i = re.lastIndex, depth = 0, inStr = false, tok = '', tuple = null, quoted = false;
    for (; i < sql.length; i++) {
      const ch = sql[i];
      if (inStr) {
        if (ch === "'" && sql[i + 1] === "'") { tok += "'"; i++; }
        else if (ch === "'") inStr = false;
        else tok += ch;
        continue;
      }
      if (ch === "'") { inStr = true; quoted = true; continue; }
      if (ch === ';' && depth === 0) break;
      if (ch === '(') { depth++; if (depth === 1) { tuple = []; tok = ''; quoted = false; continue; } }
      if (ch === ')' && depth === 1) {
        depth = 0;
        tuple.push(quoted ? tok : (tok.trim().toUpperCase() === 'NULL' ? null : tok.trim()));
        rows.push(Object.fromEntries(cols.map((c, k) => [c, tuple[k]])));
        tok = ''; continue;
      }
      if (ch === ')') depth--;
      if (ch === ',' && depth === 1) { tuple.push(quoted ? tok : (tok.trim().toUpperCase() === 'NULL' ? null : tok.trim())); tok = ''; quoted = false; continue; }
      if (depth >= 1) tok += ch;
    }
  }
  return rows;
}
