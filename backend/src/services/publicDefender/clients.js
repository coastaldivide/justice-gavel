/**
 * services/publicDefender/clients.js — an office's client list and their court dates (A11 step 2;
 * docs/PUBLIC_DEFENDER.md "Client list").
 *
 * CSV upload (≤ 5,000 rows, ≤ 2 MB): columns name, phone, language (en / es / pt / vi, or the
 * language's name), case_number, court_dates (one or more, separated by ";", each YYYY-MM-DD or
 * M/D/YYYY, optionally followed by a 24-hour time "HH:MM"), optional email and court.
 *   1. preview: every row is checked and shown with its own errors, and whether it adds a new
 *      client or updates one already on the list (same phone + case number); nothing is written;
 *   2. import: the same checks; one bad row → nothing is imported; otherwise everything is written
 *      in ONE transaction. A client already on the list (phone + case number) is updated — name,
 *      language, e-mail — and their court dates are brought in line with the file: dates in the
 *      file are added, upcoming scheduled dates no longer in the file are removed (past dates and
 *      their answers are kept).
 * Their texts are planned by the 'pd-court-reminders' job (plan_needed), started right after.
 * Clients can also be added, changed and removed one at a time.
 */
import { parse } from 'csv-parse/sync';
import { toE164 } from '../sms.js';
import { decrypt } from '../encryption.js';
import { todayInZone, addDays } from '../../utils/timezone.js';
import { dateOnly, timeOnly } from '../courtReminders.js';
import logger from '../../utils/logger.js';
import { PdError, LANGS, COURT_STATUSES, officeTimeZone, isEmail } from './common.js';
import { cleanText } from './offices.js';
import { planPdCourtDate, planClient, planPending } from './texts.js';

export const MAX_ROWS = 5000;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_DATES_PER_CLIENT = 20;
const PAST_DAYS = 365;          // court dates further back than this are refused
const FUTURE_DAYS = 3 * 366;    // and further ahead than this

export const COLUMNS = Object.freeze(['name', 'phone', 'language', 'case_number', 'court_dates', 'email', 'court']);
const REQUIRED = ['name', 'phone', 'case_number', 'court_dates'];
const ALIASES = {
  client: 'name', client_name: 'name', full_name: 'name', mobile: 'phone', phone_number: 'phone', cell: 'phone',
  lang: 'language', preferred_language: 'language', case: 'case_number', case_no: 'case_number', docket: 'case_number',
  court_date: 'court_dates', dates: 'court_dates', hearing_dates: 'court_dates', e_mail: 'email', court_name: 'court',
};
const LANG_NAMES = {
  en: 'en', english: 'en', ingles: 'en', inglés: 'en',
  es: 'es', spanish: 'es', espanol: 'es', español: 'es',
  pt: 'pt', portuguese: 'pt', portugues: 'pt', português: 'pt',
  vi: 'vi', vietnamese: 'vi', 'tieng viet': 'vi', 'tiếng việt': 'vi',
};

export const templateCsv = () => `${COLUMNS.join(',')}\r\n`;

const headerKey = (h) => {
  const k = String(h || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
  return COLUMNS.includes(k) ? k : ALIASES[k] || null;
};

/** 'YYYY-MM-DD' / 'M/D/YYYY' → 'YYYY-MM-DD', else null. */
export function parseDay(raw) {
  const s = String(raw ?? '').trim();
  let iso = s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) iso = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** 'HH:MM' (24 h) → 'HH:MM', else null. */
export function parseTime(raw) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(raw ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** "2026-11-03 09:00; 12/1/2026" → [{ date, time }] or { error } */
export function parseCourtDates(raw, today) {
  const parts = String(raw ?? '').split(/[;|]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { error: 'required' };
  if (parts.length > MAX_DATES_PER_CLIENT) return { error: 'too_many_dates' };
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const [d, t, ...rest] = p.split(/\s+/);
    const date = parseDay(d);
    const time = t == null ? null : parseTime(t);
    if (!date || (t != null && !time) || rest.length) return { error: 'bad_date' };
    if (date < addDays(today, -PAST_DAYS) || date > addDays(today, FUTURE_DAYS)) return { error: 'date_out_of_range' };
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ date, time });
  }
  return { value: out };
}

export function parseLang(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'en';
  return LANG_NAMES[s] || null;
}

function checkRow(rec, header, today) {
  const v = {};
  const errors = [];
  header.forEach((k, i) => { if (k) v[k] = String(rec[i] ?? '').normalize('NFC').replace(/\p{Cc}/gu, '').trim(); });
  const values = {};
  if (!v.name) errors.push({ field: 'name', code: 'required' });
  else if (v.name.length > 160) errors.push({ field: 'name', code: 'too_long' });
  else values.name = v.name;
  if (!v.phone) errors.push({ field: 'phone', code: 'required' });
  else if (!toE164(v.phone)) errors.push({ field: 'phone', code: 'bad_phone' });
  else values.phone = toE164(v.phone);
  const lang = parseLang(v.language);
  if (!lang) errors.push({ field: 'language', code: 'bad_language' }); else values.language = lang;
  if (!v.case_number) errors.push({ field: 'case_number', code: 'required' });
  else if (v.case_number.length > 80) errors.push({ field: 'case_number', code: 'too_long' });
  else values.case_number = v.case_number;
  const dates = parseCourtDates(v.court_dates, today);
  if (dates.error) errors.push({ field: 'court_dates', code: dates.error }); else values.court_dates = dates.value;
  if (v.email) { if (isEmail(v.email)) values.email = v.email.toLowerCase(); else errors.push({ field: 'email', code: 'bad_email' }); }
  if (v.court) { if (v.court.length > 160) errors.push({ field: 'court', code: 'too_long' }); else values.court = v.court; }
  return { values, errors };
}

/**
 * Check a CSV file. → { rows: [{ line, values, errors, action: 'add'|'update'|null }], total, valid,
 *   invalid, adds, updates, file_errors, unknown_columns }
 * `existing`: Set of `${phone}|${case_number}` already on the office's list.
 */
export function checkCsv(buffer, { today, existing = new Set() }) {
  const out = { rows: [], total: 0, valid: 0, invalid: 0, adds: 0, updates: 0, file_errors: [], unknown_columns: [] };
  let records;
  try {
    records = parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch (e) {
    out.file_errors.push({ code: 'bad_csv', line: e?.lines || null });
    return out;
  }
  if (!records.length) { out.file_errors.push({ code: 'no_rows' }); return out; }
  const header = records[0].map(headerKey);
  records[0].forEach((h, i) => { if (!header[i] && String(h || '').trim()) out.unknown_columns.push(String(h).trim().slice(0, 60)); });
  for (const name of REQUIRED) if (!header.includes(name)) out.file_errors.push({ code: 'missing_column', column: name });
  const dup = header.filter((h, i) => h && header.indexOf(h) !== i);
  if (dup.length) out.file_errors.push({ code: 'duplicate_column', column: dup[0] });
  const body = records.slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
  out.total = body.length;
  if (!body.length) out.file_errors.push({ code: 'no_rows' });
  if (body.length > MAX_ROWS) { out.file_errors.push({ code: 'too_many_rows', max: MAX_ROWS }); return out; }
  if (out.file_errors.length) return out;
  const inFile = new Map();
  body.forEach((rec, i) => {
    const line = i + 2;
    const { values, errors } = checkRow(rec, header, today);
    let action = null;
    if (!errors.length) {
      const key = `${values.phone}|${values.case_number.toLowerCase()}`;
      if (inFile.has(key)) errors.push({ field: 'case_number', code: 'duplicate_row', line: inFile.get(key) });
      else { inFile.set(key, line); action = existing.has(key) ? 'update' : 'add'; }
    }
    out.rows.push({ line, values, errors, action: errors.length ? null : action });
    if (errors.length) out.invalid += 1; else { out.valid += 1; if (action === 'add') out.adds += 1; else out.updates += 1; }
  });
  return out;
}

export async function existingKeys(db, officeId) {
  const rows = await db.all('SELECT phone, lower(case_number) AS cn FROM pd_clients WHERE office_id = ? LIMIT 200000', [officeId]);
  return new Set(rows.map((r) => `${r.phone}|${r.cn}`));
}

export async function officeToday(db, officeId) {
  const o = await db.get('SELECT state, county FROM pd_offices WHERE id = ?', [officeId]);
  return todayInZone(officeTimeZone(o || {}));
}

/** Bring a client's court dates in line with `dates` (add missing; drop upcoming scheduled ones not listed). */
async function syncDates(tx, { officeId, clientId, dates, court, today }) {
  const cur = await tx.all(`SELECT id, court_date, status FROM pd_court_dates WHERE pd_client_id = ? AND deleted_at IS NULL LIMIT 500`, [clientId]);
  const have = new Map(cur.map((r) => [dateOnly(r.court_date), r]));
  const want = new Set(dates.map((d) => d.date));
  let added = 0; let removed = 0;
  for (const d of dates) {
    const row = have.get(d.date);
    if (row) {
      await tx.run(`UPDATE pd_court_dates SET court_time = COALESCE(?, court_time), court_name = COALESCE(?, court_name), plan_needed = TRUE, updated_at = NOW() WHERE id = ?`, [d.time, court || null, row.id]);
    } else {
      await tx.run('INSERT INTO pd_court_dates (pd_client_id, office_id, court_date, court_time, court_name) VALUES (?, ?, ?, ?, ?)', [clientId, officeId, d.date, d.time, court || null]);
      added += 1;
    }
  }
  for (const [day, row] of have) {
    if (!want.has(day) && day >= today && row.status === 'scheduled') {
      await tx.run('UPDATE pd_court_dates SET deleted_at = NOW(), plan_needed = TRUE, updated_at = NOW() WHERE id = ?', [row.id]);
      removed += 1;
    }
  }
  return { added, removed };
}

/** POST /api/pd/clients/import → { imported, added, updated, court_dates_added, court_dates_removed } or 400 with the check. */
export async function importCsv(db, { officeId, userId, buffer, today }) {
  const check = checkCsv(buffer, { today, existing: await existingKeys(db, officeId) });
  if (check.file_errors.length || check.invalid > 0 || !check.valid) throw new PdError(400, 'import_has_errors', { check });
  const totals = { imported: 0, added: 0, updated: 0, court_dates_added: 0, court_dates_removed: 0 };
  await db.transaction(async (tx) => {
    for (const r of check.rows) {
      const v = r.values;
      const row = await tx.get(
        `INSERT INTO pd_clients (office_id, name, phone, lang, case_number, email, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (office_id, phone, lower(case_number)) DO UPDATE SET name = EXCLUDED.name, lang = EXCLUDED.lang,
           email = COALESCE(EXCLUDED.email, pd_clients.email), updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [officeId, v.name, v.phone, v.language, v.case_number, v.email || null, userId]);
      const id = Number(row.id);
      const inserted = row.inserted === true || row.inserted === 't';
      const s = await syncDates(tx, { officeId, clientId: id, dates: v.court_dates, court: v.court, today });
      totals.imported += 1;
      if (inserted) totals.added += 1; else totals.updated += 1;
      totals.court_dates_added += s.added;
      totals.court_dates_removed += s.removed;
    }
  });
  // plan the texts in the background (the job also picks up anything left)
  planPending(db).catch((e) => logger.warn({ err: e?.message }, '[pd] planning after import failed — the job retries'));
  return totals;
}

// ── One client at a time ──────────────────────────────────────────────────────

function courtDateInput(b, today, { partial = false } = {}) {
  const out = {};
  if (!partial || 'court_date' in b) {
    const d = parseDay(b.court_date);
    if (!d) throw new PdError(400, 'bad_date', { field: 'court_date' });
    if (d < addDays(today, -PAST_DAYS) || d > addDays(today, FUTURE_DAYS)) throw new PdError(400, 'date_out_of_range', { field: 'court_date' });
    out.court_date = d;
  }
  if (!partial || 'court_time' in b) {
    if (b.court_time == null || b.court_time === '') out.court_time = null;
    else { const t = parseTime(b.court_time); if (!t) throw new PdError(400, 'bad_time', { field: 'court_time' }); out.court_time = t; }
  }
  if (!partial || 'court_name' in b) out.court_name = cleanText(b.court_name, 160, 'court_name');
  if (!partial || 'room' in b) out.room = cleanText(b.room, 40, 'room');
  return out;
}

function clientInput(b, { partial = false } = {}) {
  const out = {};
  if (!partial || 'name' in b) out.name = cleanText(b.name, 160, 'name', { required: true });
  if (!partial || 'phone' in b) {
    const p = toE164(cleanText(b.phone, 40, 'phone', { required: true }));
    if (!p) throw new PdError(400, 'bad_phone', { field: 'phone' });
    out.phone = p;
  }
  if (!partial || 'lang' in b) {
    const l = b.lang == null || b.lang === '' ? 'en' : b.lang;
    if (!LANGS.includes(l)) throw new PdError(400, 'invalid', { field: 'lang' });
    out.lang = l;
  }
  if (!partial || 'case_number' in b) out.case_number = cleanText(b.case_number, 80, 'case_number', { required: true });
  if (!partial || 'email' in b) {
    const e = cleanText(b.email, 254, 'email');
    if (e && !isEmail(e)) throw new PdError(400, 'bad_email', { field: 'email' });
    out.email = e ? e.toLowerCase() : null;
  }
  if (partial && 'reminders_on' in b) {
    if (typeof b.reminders_on !== 'boolean') throw new PdError(400, 'invalid', { field: 'reminders_on' });
    out.reminders_on = b.reminders_on;
  }
  return out;
}

/** POST /api/pd/clients { name, phone, lang, case_number, email?, court_dates?: [{ court_date, court_time?, court_name?, room? }] } */
export async function addClient(db, { officeId, userId, body }) {
  const v = clientInput(body);
  const today = await officeToday(db, officeId);
  const dates = Array.isArray(body.court_dates) ? body.court_dates : [];
  if (dates.length > MAX_DATES_PER_CLIENT) throw new PdError(400, 'too_many_dates', { field: 'court_dates', max: MAX_DATES_PER_CLIENT });
  const parsed = dates.map((d) => courtDateInput(d && typeof d === 'object' ? d : {}, today));
  const id = await db.transaction(async (tx) => {
    const dup = await tx.get('SELECT id FROM pd_clients WHERE office_id = ? AND phone = ? AND lower(case_number) = lower(?)', [officeId, v.phone, v.case_number]);
    if (dup) throw new PdError(409, 'duplicate_client', { client_id: Number(dup.id) });
    const row = await tx.get(`INSERT INTO pd_clients (office_id, name, phone, lang, case_number, email, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [officeId, v.name, v.phone, v.lang, v.case_number, v.email, userId]);
    const seen = new Set();
    for (const d of parsed) {
      if (seen.has(d.court_date)) continue;
      seen.add(d.court_date);
      await tx.run('INSERT INTO pd_court_dates (pd_client_id, office_id, court_date, court_time, court_name, room) VALUES (?, ?, ?, ?, ?, ?)',
        [row.id, officeId, d.court_date, d.court_time, d.court_name, d.room]);
    }
    return Number(row.id);
  });
  await planClient(db, id);
  return clientDetail(db, officeId, id);
}

async function ownClient(db, officeId, clientId) {
  const c = await db.get('SELECT * FROM pd_clients WHERE id = ? AND office_id = ?', [clientId, officeId]);
  if (!c) throw new PdError(404, 'not_found');
  return c;
}

/** PATCH /api/pd/clients/:id */
export async function updateClient(db, { officeId, clientId, body }) {
  const c = await ownClient(db, officeId, clientId);
  const v = clientInput(body, { partial: true });
  const keys = Object.keys(v);
  if (keys.length) {
    const phone = v.phone ?? c.phone; const cn = v.case_number ?? c.case_number;
    const dup = await db.get('SELECT id FROM pd_clients WHERE office_id = ? AND phone = ? AND lower(case_number) = lower(?) AND id <> ?', [officeId, phone, cn, c.id]);
    if (dup) throw new PdError(409, 'duplicate_client', { client_id: Number(dup.id) });
    await db.run(`UPDATE pd_clients SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = NOW() WHERE id = ?`, [...keys.map((k) => v[k]), c.id]);
    await planClient(db, c.id);
  }
  return clientDetail(db, officeId, c.id);
}

/** DELETE /api/pd/clients/:id — the client, their court dates, planned texts and messages. */
export async function deleteClient(db, { officeId, clientId }) {
  const r = await db.run('DELETE FROM pd_clients WHERE id = ? AND office_id = ?', [clientId, officeId]);
  if (!r.changes) throw new PdError(404, 'not_found');
}

export async function addCourtDate(db, { officeId, clientId, body }) {
  const c = await ownClient(db, officeId, clientId);
  const today = await officeToday(db, officeId);
  const d = courtDateInput(body, today);
  const n = await db.get('SELECT COUNT(*)::int AS n FROM pd_court_dates WHERE pd_client_id = ? AND deleted_at IS NULL', [c.id]);
  if (n.n >= MAX_DATES_PER_CLIENT * 5) throw new PdError(409, 'too_many_dates', { max: MAX_DATES_PER_CLIENT * 5 });
  const dup = await db.get('SELECT id FROM pd_court_dates WHERE pd_client_id = ? AND court_date = ? AND deleted_at IS NULL', [c.id, d.court_date]);
  if (dup) throw new PdError(409, 'duplicate_court_date');
  const row = await db.get('INSERT INTO pd_court_dates (pd_client_id, office_id, court_date, court_time, court_name, room) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [c.id, officeId, d.court_date, d.court_time, d.court_name, d.room]);
  await planPdCourtDate(db, Number(row.id));
  return clientDetail(db, officeId, c.id);
}

/** PATCH /api/pd/court-dates/:id { court_date?, court_time?, court_name?, room?, status? } */
export async function updateCourtDate(db, { officeId, courtDateId, body }) {
  const cd = await db.get('SELECT id, pd_client_id, court_date FROM pd_court_dates WHERE id = ? AND office_id = ? AND deleted_at IS NULL', [courtDateId, officeId]);
  if (!cd) throw new PdError(404, 'not_found');
  const today = await officeToday(db, officeId);
  const v = courtDateInput(body, today, { partial: true });
  if ('status' in body) {
    if (!COURT_STATUSES.includes(body.status)) throw new PdError(400, 'invalid', { field: 'status' });
    v.status = body.status;
  }
  if (v.court_date && v.court_date !== dateOnly(cd.court_date)) {
    const dup = await db.get('SELECT id FROM pd_court_dates WHERE pd_client_id = ? AND court_date = ? AND deleted_at IS NULL AND id <> ?', [cd.pd_client_id, v.court_date, cd.id]);
    if (dup) throw new PdError(409, 'duplicate_court_date');
  }
  const keys = Object.keys(v);
  if (keys.length) {
    const extra = 'status' in v ? `, status_source = 'office', status_at = NOW()` : '';
    await db.run(`UPDATE pd_court_dates SET ${keys.map((k) => `${k} = ?`).join(', ')}${extra}, updated_at = NOW() WHERE id = ?`, [...keys.map((k) => v[k]), cd.id]);
    await planPdCourtDate(db, cd.id);
    if (v.status === 'missed') {
      const { runPdCourtReminders } = await import('./texts.js');
      await runPdCourtReminders(db, { courtDateId: cd.id });
    }
  }
  return clientDetail(db, officeId, Number(cd.pd_client_id));
}

export async function deleteCourtDate(db, { officeId, courtDateId }) {
  const cd = await db.get('SELECT id, pd_client_id FROM pd_court_dates WHERE id = ? AND office_id = ? AND deleted_at IS NULL', [courtDateId, officeId]);
  if (!cd) throw new PdError(404, 'not_found');
  await db.run('UPDATE pd_court_dates SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [cd.id]);
  await planPdCourtDate(db, cd.id);
  return clientDetail(db, officeId, Number(cd.pd_client_id));
}

// ── Reading ───────────────────────────────────────────────────────────────────

const shapeClient = (c) => ({
  id: Number(c.id), name: c.name, phone: c.phone, lang: c.lang, case_number: c.case_number, email: c.email,
  reminders_on: c.reminders_on === true || c.reminders_on === 't', opted_out: !!c.opted_out, created_at: c.created_at,
  last_message_at: c.last_message_at, next_court_date: c.next_court_date ? dateOnly(c.next_court_date) : null,
  unread: Number(c.unread || 0),
});

/** GET /api/pd/clients?q=&page=&page_size= → { clients, page, page_size, total } (newest first) */
export async function listClients(db, officeId, { q = '', page = 1, pageSize = 50 } = {}) {
  const p = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), 1000);
  const size = Math.min(Math.max(1, Number.parseInt(pageSize, 10) || 50), 100);
  const args = [officeId];
  let where = 'c.office_id = ?';
  const term = String(q || '').trim().slice(0, 80);
  if (term) {
    where += ` AND (c.name ILIKE ? OR c.case_number ILIKE ? OR c.phone LIKE ?)`;
    const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = term.replace(/\D/g, '');
    args.push(like, like, digits.length >= 3 ? `%${digits}%` : like);
  }
  const total = await db.get(`SELECT COUNT(*)::int AS n FROM pd_clients c WHERE ${where}`, args);
  const rows = await db.all(
    `SELECT c.*, EXISTS (SELECT 1 FROM sms_opt_outs x WHERE x.phone = c.phone) AS opted_out,
            (SELECT MIN(cd.court_date) FROM pd_court_dates cd WHERE cd.pd_client_id = c.id AND cd.deleted_at IS NULL AND cd.status = 'scheduled' AND cd.court_date >= CURRENT_DATE - 1) AS next_court_date,
            (SELECT COUNT(*)::int FROM pd_messages m WHERE m.pd_client_id = c.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread
       FROM pd_clients c WHERE ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`, [...args, size, (p - 1) * size]);
  return { clients: rows.map(shapeClient), page: p, page_size: size, total: total.n };
}

/** GET /api/pd/clients/:id → { client, court_dates: [... with reminders] } */
export async function clientDetail(db, officeId, clientId) {
  const c = await db.get(
    `SELECT c.*, EXISTS (SELECT 1 FROM sms_opt_outs x WHERE x.phone = c.phone) AS opted_out,
            (SELECT COUNT(*)::int FROM pd_messages m WHERE m.pd_client_id = c.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread
       FROM pd_clients c WHERE c.id = ? AND c.office_id = ?`, [clientId, officeId]);
  if (!c) throw new PdError(404, 'not_found');
  const dates = await db.all(
    `SELECT id, court_date, court_time, court_name, room, status, status_source, status_at, asked_at FROM pd_court_dates
      WHERE pd_client_id = ? AND deleted_at IS NULL ORDER BY court_date DESC LIMIT 200`, [c.id]);
  const rems = dates.length ? await db.all(
    `SELECT r.court_date_id, r.step, r.send_at, r.status, r.reason, r.sent_at, d.status AS delivery
       FROM pd_reminders r LEFT JOIN pd_messages m ON m.id = r.message_id LEFT JOIN sms_delivery d ON d.provider_id = m.provider_id
      WHERE r.pd_client_id = ? AND r.status <> 'cancelled' ORDER BY r.send_at LIMIT 1000`, [c.id]) : [];
  const byDate = new Map();
  for (const r of rems) {
    const k = Number(r.court_date_id);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push({ step: r.step, send_at: r.send_at, status: r.status, reason: r.reason, sent_at: r.sent_at, delivery: r.delivery || null });
  }
  return {
    client: shapeClient(c),
    court_dates: dates.map((d) => ({
      id: Number(d.id), court_date: dateOnly(d.court_date), court_time: timeOnly(d.court_time), court_name: d.court_name, room: d.room,
      status: d.status, status_source: d.status_source, status_at: d.status_at, asked_at: d.asked_at, texts: byDate.get(Number(d.id)) || [],
    })),
  };
}

/** Decrypted message body (rows written by texts.js). */
export const bodyOf = (m) => decrypt(m.body);
