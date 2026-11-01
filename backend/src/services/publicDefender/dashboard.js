/**
 * services/publicDefender/dashboard.js — the office dashboard and its export (A11 step 5;
 * docs/PUBLIC_DEFENDER.md "Dashboard"; pilot measures in docs/PUBLIC_DEFENDER_PILOT.md).
 *
 * Appearance, per month of the court date, for this office's clients' hearings on or before today
 * (removed and cancelled hearings left out):
 *   hearings, asked ("Did you make it?" went out), attended, rescheduled, missed,
 *   no_answer (the date passed and the hearing is still just "scheduled": nobody answered or set it)
 *   appearance_rate = attended ÷ (attended + missed), null when both are 0. Rescheduled and
 *   no-answer hearings are shown, never counted as appeared or missed.
 * The office's own baseline (what the office supplied for its 90 days before the pilot) is shown
 * next to the same rate measured since the pilot start, with both definitions stated. These are
 * counts, not a claim about cause.
 */
import { decrypt } from '../encryption.js';
import { dateOnly, timeOnly } from '../courtReminders.js';
import { toCsv } from '../../routes/bondDesk/reports.js';
import { ZipWriter } from '../bondDesk/zip.js';
import { shapeOffice, getOffice } from './offices.js';
import { officeToday } from './clients.js';

const rate = (attended, missed) => (attended + missed > 0 ? Math.round((attended / (attended + missed)) * 1000) / 10 : null);

const COUNTS = `
  COUNT(*)::int AS hearings,
  COUNT(*) FILTER (WHERE cd.asked_at IS NOT NULL)::int AS asked,
  COUNT(*) FILTER (WHERE cd.status = 'attended')::int AS attended,
  COUNT(*) FILTER (WHERE cd.status = 'rescheduled')::int AS rescheduled,
  COUNT(*) FILTER (WHERE cd.status = 'missed')::int AS missed,
  COUNT(*) FILTER (WHERE cd.status = 'scheduled')::int AS no_answer`;

const shapeCounts = (r) => ({
  hearings: r.hearings, asked: r.asked, attended: r.attended, rescheduled: r.rescheduled, missed: r.missed, no_answer: r.no_answer,
  appearance_rate: rate(r.attended, r.missed),
});

/** Appearance per month (newest first, at most 60 months). */
export async function appearanceByMonth(db, officeId, today) {
  const rows = await db.all(
    `SELECT to_char(cd.court_date, 'YYYY-MM') AS month, ${COUNTS}
       FROM pd_court_dates cd
      WHERE cd.office_id = ? AND cd.deleted_at IS NULL AND cd.status <> 'cancelled' AND cd.court_date <= CAST(? AS date)
      GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, [officeId, today]);
  return rows.map((r) => ({ month: r.month, ...shapeCounts(r) }));
}

async function appearanceSince(db, officeId, from, today) {
  const r = await db.get(
    `SELECT ${COUNTS} FROM pd_court_dates cd
      WHERE cd.office_id = ? AND cd.deleted_at IS NULL AND cd.status <> 'cancelled' AND cd.court_date <= CAST(? AS date)
        ${from ? 'AND cd.court_date >= CAST(? AS date)' : ''}`, from ? [officeId, today, from] : [officeId, today]);
  return shapeCounts(r);
}

/** Messages per month (newest first, at most 60 months). */
function messagesByMonth(db, officeId) {
  return db.all(
    `SELECT to_char(created_at, 'YYYY-MM') AS month,
            COUNT(*) FILTER (WHERE direction = 'out' AND status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE direction = 'out' AND status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE direction = 'out' AND status = 'sent' AND kind = 'staff')::int AS staff_replies,
            COUNT(*) FILTER (WHERE direction = 'in')::int AS received
       FROM pd_messages WHERE office_id = ? GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, [officeId]);
}

function optOuts(db, officeId, limit = 5000) {
  return db.all(
    `SELECT c.id, c.name, c.case_number, c.phone, x.opted_out_at FROM pd_clients c JOIN sms_opt_outs x ON x.phone = c.phone
      WHERE c.office_id = ? ORDER BY x.opted_out_at DESC, c.id LIMIT ?`, [officeId, limit]);
}

/** GET /api/pd/dashboard */
export async function dashboard(db, officeId) {
  const office = await getOffice(db, officeId);
  const today = await officeToday(db, officeId);
  const clients = await db.get('SELECT COUNT(*)::int AS n FROM pd_clients WHERE office_id = ?', [officeId]);
  const upcomingCount = await db.get(
    `SELECT COUNT(*)::int AS n FROM pd_court_dates WHERE office_id = ? AND deleted_at IS NULL AND status = 'scheduled'
        AND court_date BETWEEN CAST(? AS date) AND CAST(? AS date) + 30`, [officeId, today, today]);
  const upcoming = await db.all(
    `SELECT cd.id, cd.court_date, cd.court_time, cd.court_name, c.id AS client_id, c.name, c.case_number
       FROM pd_court_dates cd JOIN pd_clients c ON c.id = cd.pd_client_id
      WHERE cd.office_id = ? AND cd.deleted_at IS NULL AND cd.status = 'scheduled' AND cd.court_date >= CAST(? AS date)
      ORDER BY cd.court_date, cd.court_time NULLS FIRST, cd.id LIMIT 20`, [officeId, today]);
  const outs = await db.get('SELECT COUNT(*)::int AS n FROM pd_clients c JOIN sms_opt_outs x ON x.phone = c.phone WHERE c.office_id = ?', [officeId]);
  const unread = await db.get(`SELECT COUNT(*)::int AS n FROM pd_messages WHERE office_id = ? AND direction = 'in' AND read_at IS NULL`, [officeId]);
  const shaped = shapeOffice(office);
  const b = shaped.baseline;
  return {
    office: shaped,
    today,
    clients: clients.n,
    upcoming_30_days: upcomingCount.n,
    upcoming: upcoming.map((u) => ({ court_date_id: Number(u.id), court_date: dateOnly(u.court_date), court_time: timeOnly(u.court_time), court_name: u.court_name, client_id: Number(u.client_id), name: u.name, case_number: u.case_number })),
    appearance: await appearanceByMonth(db, officeId, today),
    pilot: shaped.pilot_start ? { since: shaped.pilot_start, ...(await appearanceSince(db, officeId, shaped.pilot_start, today)) } : null,
    baseline: b ? { ...b, appearance_rate: rate(Number(b.appeared), Number(b.missed)) } : null,
    messages: await messagesByMonth(db, officeId),
    unread: unread.n,
    opt_outs: outs.n,
    rate_definition: 'attended / (attended + missed)',
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export const EXPORT_PARTS = Object.freeze(['clients', 'court_dates', 'appearance', 'messages', 'opt_outs', 'baseline']);

/** One part of the export as [header, rows] (every row of the office; messages decrypted). */
export async function exportPart(db, officeId, part) {
  if (part === 'clients') {
    const rows = await db.all(
      `SELECT c.id, c.name, c.phone, c.lang, c.case_number, c.email, c.reminders_on, c.created_at,
              EXISTS (SELECT 1 FROM sms_opt_outs x WHERE x.phone = c.phone) AS opted_out
         FROM pd_clients c WHERE c.office_id = ? ORDER BY c.id LIMIT 200000`, [officeId]);
    return [['client_id', 'name', 'phone', 'language', 'case_number', 'email', 'reminders_on', 'opted_out', 'added_at'],
      rows.map((r) => [r.id, r.name, r.phone, r.lang, r.case_number, r.email, r.reminders_on ? 'yes' : 'no', r.opted_out ? 'yes' : 'no', new Date(r.created_at).toISOString()])];
  }
  if (part === 'court_dates') {
    const rows = await db.all(
      `SELECT cd.id, cd.pd_client_id, c.name, c.case_number, cd.court_date, cd.court_time, cd.court_name, cd.room, cd.status, cd.status_source, cd.asked_at
         FROM pd_court_dates cd JOIN pd_clients c ON c.id = cd.pd_client_id
        WHERE cd.office_id = ? AND cd.deleted_at IS NULL ORDER BY cd.court_date, cd.id LIMIT 500000`, [officeId]);
    return [['court_date_id', 'client_id', 'name', 'case_number', 'court_date', 'court_time', 'court', 'room', 'status', 'status_set_by', 'asked_at'],
      rows.map((r) => [r.id, r.pd_client_id, r.name, r.case_number, dateOnly(r.court_date), timeOnly(r.court_time), r.court_name, r.room, r.status, r.status_source, r.asked_at ? new Date(r.asked_at).toISOString() : ''])];
  }
  if (part === 'appearance') {
    const rows = await appearanceByMonth(db, officeId, await officeToday(db, officeId));
    return [['month', 'hearings', 'asked', 'attended', 'rescheduled', 'missed', 'no_answer', 'appearance_rate_percent'],
      rows.map((r) => [r.month, r.hearings, r.asked, r.attended, r.rescheduled, r.missed, r.no_answer, r.appearance_rate ?? ''])];
  }
  if (part === 'messages') {
    const rows = await db.all(
      `SELECT m.id, m.pd_client_id, c.name, c.case_number, m.direction, m.kind, m.status, m.body, m.created_at, d.status AS delivery,
              COALESCE(u.display_name, u.name) AS sent_by
         FROM pd_messages m JOIN pd_clients c ON c.id = m.pd_client_id LEFT JOIN sms_delivery d ON d.provider_id = m.provider_id
         LEFT JOIN users u ON u.id = m.sent_by
        WHERE m.office_id = ? ORDER BY m.id LIMIT 500000`, [officeId]);
    return [['message_id', 'client_id', 'name', 'case_number', 'direction', 'kind', 'status', 'delivery', 'sent_by', 'at', 'text'],
      rows.map((r) => [r.id, r.pd_client_id, r.name, r.case_number, r.direction, r.kind, r.status, r.delivery || '', r.sent_by || '', new Date(r.created_at).toISOString(), decrypt(r.body)])];
  }
  if (part === 'opt_outs') {
    const rows = await optOuts(db, officeId, 200000);
    return [['client_id', 'name', 'case_number', 'phone', 'opted_out_at'], rows.map((r) => [r.id, r.name, r.case_number, r.phone, new Date(r.opted_out_at).toISOString()])];
  }
  if (part === 'baseline') {
    const d = await dashboard(db, officeId);
    const b = d.baseline;
    const p = d.pilot;
    return [['measure', 'period_from', 'period_to', 'hearings', 'appeared_or_attended', 'missed', 'rescheduled', 'no_answer', 'appearance_rate_percent', 'source'], [
      ['office baseline (supplied by the office)', b?.from || '', b?.to || '', b?.hearings ?? '', b?.appeared ?? '', b?.missed ?? '', '', '', b?.appearance_rate ?? '', b?.source || ''],
      ['measured since pilot start', p?.since || '', d.today, p?.hearings ?? '', p?.attended ?? '', p?.missed ?? '', p?.rescheduled ?? '', p?.no_answer ?? '', p?.appearance_rate ?? '', 'Justice Gavel texts and replies; staff updates'],
    ]];
  }
  return null;
}

export const partCsv = async (db, officeId, part) => {
  const out = await exportPart(db, officeId, part);
  return out ? Buffer.from(toCsv(out[0], out[1]), 'utf8') : null;
};

/** GET /api/pd/export.zip — every part as its own CSV. */
export async function writeOfficeExport(db, { officeId, write, now = new Date() }) {
  const zip = new ZipWriter(write, { now });
  for (const part of EXPORT_PARTS) await zip.addEntry(`${part}.csv`, await partCsv(db, officeId, part));
  await zip.addEntry('README.txt', [
    'Justice Gavel public defender channel - export of everything stored for this office.',
    'clients.csv, court_dates.csv, appearance.csv (per month), messages.csv (every text, decrypted), opt_outs.csv, baseline.csv.',
    'appearance_rate_percent = attended / (attended + missed); rescheduled and no-answer hearings are not counted in it.',
    `Exported ${now.toISOString()}.`,
  ].join('\r\n'));
  await zip.finish();
  return { files: EXPORT_PARTS.length + 1 };
}
