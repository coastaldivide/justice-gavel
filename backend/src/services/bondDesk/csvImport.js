/**
 * services/bondDesk/csvImport.js — move an agency's open bonds into Bond Desk from a CSV file
 * (A12 step 3). docs/BOND_DESK.md "Import open bonds".
 *
 * 1. preview: every row is checked and shown with its own errors; nothing is written.
 * 2. import: the same checks again; one bad row → nothing is imported. Otherwise every row is
 *    written in ONE database transaction (all or nothing): the bond (status active), its first
 *    hearing, its executed power, the first indemnitor and — when a balance is owed — one charge
 *    "imported balance" (the ledger carries only what is still owed; the premium the file states
 *    is kept on the bond for forms and the surety report).
 *
 * Money is parsed from text to whole cents exactly ("1,234.5" → 123450; never through floating
 * point). Power numbers must be unique in the file and not already in the agency's inventory.
 */
import { parse } from 'csv-parse/sync';
import { toE164 } from '../sms.js';
import { isDate } from './money.js';
import { mirrorBondFormCourtDate, syncBondCourtDate } from './courtDates.js';
import { LedgerError } from './payments.js';

export const MAX_ROWS = 2000;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_CENTS = 100_000_000_00;

/** column → { required, kind } (the template's header, in this order) */
export const COLUMNS = Object.freeze([
  ['defendant_name', true, 'text160'],
  ['defendant_phone', false, 'phone'],
  ['defendant_email', false, 'email'],
  ['defendant_dob', false, 'dob'],
  ['bond_amount', true, 'money_pos'],
  ['surety', false, 'text120'],
  ['power_number', false, 'power'],
  ['posted_on', false, 'date'],
  ['court_date', false, 'date'],
  ['case_number', false, 'text80'],
  ['court_name', false, 'text160'],
  ['county', false, 'text80'],
  ['state', false, 'state'],
  ['premium', false, 'money'],
  ['balance', false, 'money'],
  ['indemnitor_name', false, 'text160'],
  ['indemnitor_phone', false, 'phone'],
]);
const NAMES = COLUMNS.map(([n]) => n);
const ALIASES = { defendant: 'defendant_name', name: 'defendant_name', phone: 'defendant_phone', email: 'defendant_email', dob: 'defendant_dob',
  date_of_birth: 'defendant_dob', bond: 'bond_amount', amount: 'bond_amount', surety_name: 'surety', power: 'power_number',
  balance_owed: 'balance', premium_charged: 'premium', indemnitor: 'indemnitor_name', cosigner_name: 'indemnitor_name',
  cosigner_phone: 'indemnitor_phone', case: 'case_number', court: 'court_name' };

export const templateCsv = () => `${NAMES.join(',')}\r\n`;

/** "$1,234.56" → 123456; '' → null; anything else → NaN. */
export function parseMoney(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return NaN;
  const whole = Number(m[1].replace(/,/g, ''));
  const c = whole * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0);
  return Number.isSafeInteger(c) && c <= MAX_CENTS ? c : NaN;
}

/** 'YYYY-MM-DD' or 'M/D/YYYY' → 'YYYY-MM-DD'; '' → null; else NaN. */
export function parseDay(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let iso = s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) iso = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return isDate(iso) ? iso : NaN;
}

const key = (h) => {
  const k = String(h || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
  return NAMES.includes(k) ? k : ALIASES[k] || null;
};

function cell(kind, raw, today) {
  const s = String(raw ?? '').normalize('NFC').replace(/\p{Cc}/gu, '').trim();
  if (!s) return { value: null };
  const len = { text160: 160, text120: 120, text80: 80 }[kind];
  if (len) return s.length > len ? { error: 'too_long' } : { value: s };
  switch (kind) {
    case 'phone': { const e = toE164(s); return e ? { value: e } : { error: 'bad_phone' }; }
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? { value: s.toLowerCase() } : { error: 'bad_email' };
    case 'dob': { const d = parseDay(s); return Number.isNaN(d) || d >= today ? { error: 'bad_date' } : { value: d }; }
    case 'date': { const d = parseDay(s); return Number.isNaN(d) ? { error: 'bad_date' } : { value: d }; }
    case 'money': { const c = parseMoney(s); return Number.isNaN(c) ? { error: 'bad_amount' } : { value: c }; }
    case 'money_pos': { const c = parseMoney(s); return Number.isNaN(c) || c <= 0 ? { error: 'bad_amount' } : { value: c }; }
    case 'state': return /^[A-Za-z]{2}$/.test(s) ? { value: s.toUpperCase() } : { error: 'bad_state' };
    case 'power': return s.length <= 40 && /^[A-Za-z0-9-]+$/.test(s) ? { value: s } : { error: 'bad_power' };
    default: return { value: s };
  }
}

/**
 * Check a CSV file. → { rows: [{ line, values, errors: [{ field, code }] }], total, valid, invalid,
 *   file_errors: [{ code, ... }], unknown_columns }
 * `existingPowers`: Set of power numbers (lower case) already in the agency's inventory.
 */
export function checkCsv(buffer, { today, existingPowers = new Set() }) {
  const out = { rows: [], total: 0, valid: 0, invalid: 0, file_errors: [], unknown_columns: [] };
  let records;
  try {
    records = parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch (e) {
    out.file_errors.push({ code: 'bad_csv', line: e?.lines || null });
    return out;
  }
  if (!records.length) { out.file_errors.push({ code: 'no_rows' }); return out; }
  const header = records[0].map(key);
  records[0].forEach((h, i) => { if (!header[i] && String(h || '').trim()) out.unknown_columns.push(String(h).trim().slice(0, 60)); });
  for (const [name, required] of COLUMNS) if (required && !header.includes(name)) out.file_errors.push({ code: 'missing_column', column: name });
  const dupCol = header.filter((h, i) => h && header.indexOf(h) !== i);
  if (dupCol.length) out.file_errors.push({ code: 'duplicate_column', column: dupCol[0] });
  const body = records.slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
  out.total = body.length;
  if (!body.length) out.file_errors.push({ code: 'no_rows' });
  if (body.length > MAX_ROWS) { out.file_errors.push({ code: 'too_many_rows', max: MAX_ROWS }); return out; }
  if (out.file_errors.length) return out;
  const seenPowers = new Map();
  body.forEach((r, i) => {
    const values = {}; const errors = [];
    for (const [name, required, kind] of COLUMNS) {
      const col = header.indexOf(name);
      const c = cell(kind, col >= 0 ? r[col] : '', today);
      if (c.error) errors.push({ field: name, code: c.error });
      else if (c.value == null && required) errors.push({ field: name, code: 'required' });
      values[name] = c.value ?? null;
    }
    if (values.power_number) {
      const p = values.power_number.toLowerCase();
      if (!values.surety) errors.push({ field: 'surety', code: 'power_needs_surety' });
      if (existingPowers.has(p)) errors.push({ field: 'power_number', code: 'power_taken' });
      if (seenPowers.has(p)) errors.push({ field: 'power_number', code: 'power_duplicate', line: seenPowers.get(p) });
      else seenPowers.set(p, i + 2);
    }
    if (values.posted_on && values.posted_on > today) errors.push({ field: 'posted_on', code: 'future_date' });
    if (values.indemnitor_phone && !values.indemnitor_name) errors.push({ field: 'indemnitor_name', code: 'required' });
    out.rows.push({ line: i + 2, values, errors });
    if (errors.length) out.invalid += 1; else out.valid += 1;
  });
  return out;
}

export async function existingPowerNumbers(db, agentId) {
  const rows = await db.all('SELECT lower(number) AS n FROM bd_powers WHERE agent_id = ? LIMIT 100000', [agentId]);
  return new Set(rows.map((r) => r.n));
}

/** Import every row in one transaction, or nothing (409 import_has_errors). → { imported, bond_ids } */
export async function importCsv(db, { agentId, userId, buffer, today }) {
  const check = checkCsv(buffer, { today, existingPowers: await existingPowerNumbers(db, agentId) });
  if (check.file_errors.length || check.invalid) {
    throw new LedgerError(409, 'import_has_errors', { invalid: check.invalid, file_errors: check.file_errors.map((e) => e.code) });
  }
  const ids = await db.transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', [agentId]);   // one import at a time per agency
    const again = await existingPowerNumbers(tx, agentId);
    const out = [];
    for (const { values: v } of check.rows) {
      if (v.power_number && again.has(v.power_number.toLowerCase())) throw new LedgerError(409, 'import_has_errors', { invalid: 1, file_errors: [] });
      const b = await tx.get(
        `INSERT INTO bd_bonds (agent_id, status, defendant_name, defendant_phone, defendant_email, defendant_dob, bond_amount_cents, surety_name,
                               posted_on, court_date, case_number, court_name, county, state, imported_premium_cents, imported_at)
         VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()) RETURNING id`,
        [agentId, v.defendant_name, v.defendant_phone, v.defendant_email, v.defendant_dob, v.bond_amount, v.surety, v.posted_on, v.court_date,
          v.case_number, v.court_name, v.county, v.state, v.premium]);
      const bondId = Number(b.id);
      if (v.power_number) {
        const on = v.posted_on || today;
        await tx.run(
          `INSERT INTO bd_powers (agent_id, surety_name, number, limit_cents, received_on, status, bond_id, executed_on)
           VALUES (?, ?, ?, ?, ?, 'executed', ?, ?)`, [agentId, v.surety, v.power_number, v.bond_amount, on, bondId, on]);
      }
      if (v.balance > 0) {
        await tx.run(`INSERT INTO bd_charges (bond_id, kind, amount_cents, description, created_by, source) VALUES (?, 'premium', ?, 'imported balance', ?, 'import')`,
          [bondId, v.balance, userId]);
      }
      if (v.indemnitor_name) {
        await tx.run('INSERT INTO bd_indemnitors (bond_id, full_name, phone) VALUES (?, ?, ?)', [bondId, v.indemnitor_name, v.indemnitor_phone]);
      }
      if (v.court_date) {
        await mirrorBondFormCourtDate(tx, { bondId, oldDate: null, newDate: v.court_date, courtName: v.court_name });
        await syncBondCourtDate(tx, bondId);
      }
      out.push(bondId);
    }
    return out;
  });
  return { imported: ids.length, bond_ids: ids };
}
