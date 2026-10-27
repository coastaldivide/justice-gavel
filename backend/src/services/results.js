/**
 * services/results.js — published results (build plan B11, migration 40).
 *
 * An admin previews the numbers for a period and publishes a snapshot; the public /results page
 * shows the latest published snapshot and nothing else. Nothing is ever published automatically.
 * A snapshot is stored once and never changed (a database trigger refuses UPDATE and DELETE).
 * Publishing needs at least MIN_ANSWERED court dates with an answer to "Did you make it to
 * court?" (attended, rescheduled or missed) in the period.
 *
 * Numbers (app users and Bond Desk together, court dates on or before today in the period):
 *   court_dates     hearings in the period (not deleted)
 *   asked           hearings whose person was asked "Did you make it to court?"
 *   attended / rescheduled / missed   the hearing's recorded status (self-reported, or set by the
 *                   person or their bail agent)
 *   no_answer       asked and still only "scheduled" — counted separately, never as attended or missed
 *   appearance_rate attended ÷ (attended + missed); rescheduled hearings are left out of the rate
 *   reminders_sent  court reminders delivered (app: push, browser push, e-mail or text; Bond Desk:
 *                   the reminder texts), sent in the period
 *   texted_numbers  phone numbers that got a court text from us in the period
 *   opted_out       of those, numbers that replied STOP in the period and have not texted START since
 *   opt_out_rate    opted_out ÷ texted_numbers
 */
export const MIN_ANSWERED = 100;
export const METHODS_VERSION = 1;
export const METHODS_TEXT = 'Appearance figures come from self-reported answers to "Did you make it to court?" '
  + '(by text reply or in the app), or a status set by the person or their bail agent. Hearings with no answer are '
  + 'counted separately and are not counted as attended or missed. Rescheduled hearings are left out of the appearance '
  + 'rate. App users and Bond Desk defendants are counted together. This is not a controlled study: people who use '
  + 'reminders may differ from people who do not, and the numbers do not show what caused any change.';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ResultsError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params; }
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const validDay = (s) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && isoDay(new Date(`${s}T00:00:00Z`)) === s;

/** { from, to } 'YYYY-MM-DD' (default: the last 90 days up to yesterday). */
export function periodFrom(q = {}, now = new Date()) {
  const yesterday = isoDay(new Date(now.getTime() - 86_400_000));
  const to = q.to ? String(q.to) : yesterday;
  const from = q.from ? String(q.from) : isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000));
  if (!validDay(from) || !validDay(to) || to < from) throw new ResultsError(400, 'bad_period');
  if (to > yesterday) throw new ResultsError(400, 'period_not_over');
  return { from, to };
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** The numbers for a period (see the header). */
export async function computeResults(db, { from, to }) {
  const a = await db.get(
    `WITH h AS (
       SELECT x.status, x.asked_at FROM court_dates x JOIN cases c ON c.id = x.case_id
        WHERE x.deleted_at IS NULL AND c.deleted_at IS NULL AND x.court_date BETWEEN CAST(? AS date) AND CAST(? AS date)
       UNION ALL
       SELECT y.status, y.asked_at FROM bd_court_dates y
        WHERE y.deleted_at IS NULL AND y.court_date BETWEEN CAST(? AS date) AND CAST(? AS date))
     SELECT COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS court_dates,
            COUNT(*) FILTER (WHERE asked_at IS NOT NULL)::int AS asked,
            COUNT(*) FILTER (WHERE status = 'attended')::int AS attended,
            COUNT(*) FILTER (WHERE status = 'rescheduled')::int AS rescheduled,
            COUNT(*) FILTER (WHERE status = 'missed')::int AS missed,
            COUNT(*) FILTER (WHERE asked_at IS NOT NULL AND status = 'scheduled')::int AS no_answer
       FROM h`, [from, to, from, to]);
  const end = `${to}T23:59:59.999Z`; const start = `${from}T00:00:00Z`;
  const r = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM scheduled_pushes WHERE notification_type = 'court_reminder' AND status = 'sent'
          AND sent_at BETWEEN CAST(? AS timestamptz) AND CAST(? AS timestamptz))::int AS app,
       (SELECT COUNT(*) FROM bd_reminders WHERE status = 'sent' AND step IN ('d7', 'd3', 'd1', 'd0', 'now')
          AND sent_at BETWEEN CAST(? AS timestamptz) AND CAST(? AS timestamptz))::int AS bd`, [start, end, start, end]);
  const t = await db.get(
    `WITH n AS (
       SELECT phone FROM bd_reminders WHERE status = 'sent' AND sent_at BETWEEN CAST(? AS timestamptz) AND CAST(? AS timestamptz)
       UNION SELECT asked_phone FROM court_dates WHERE asked_phone IS NOT NULL AND asked_at BETWEEN CAST(? AS timestamptz) AND CAST(? AS timestamptz)
       UNION SELECT u.phone FROM scheduled_pushes sp JOIN users u ON u.id = sp.user_id
              WHERE sp.status = 'sent' AND sp.channel LIKE '%sms%' AND u.phone IS NOT NULL
                AND sp.notification_type IN ('court_reminder', 'court_checkin', 'court_missed_followup')
                AND sp.sent_at BETWEEN CAST(? AS timestamptz) AND CAST(? AS timestamptz))
     SELECT COUNT(DISTINCT n.phone)::int AS texted,
            COUNT(DISTINCT o.phone)::int AS opted_out
       FROM n LEFT JOIN sms_opt_outs o ON o.phone = n.phone AND o.opted_out_at BETWEEN CAST(? AS timestamptz) AND CAST(? AS timestamptz)
      WHERE n.phone IS NOT NULL`, [start, end, start, end, start, end, start, end]);
  const answered = a.attended + a.rescheduled + a.missed;
  return {
    period: { from, to },
    court_dates: a.court_dates, asked: a.asked, answered,
    attended: a.attended, rescheduled: a.rescheduled, missed: a.missed, no_answer: a.no_answer,
    appearance_rate: pct(a.attended, a.attended + a.missed),
    reminders_sent: r.app + r.bd,
    texted_numbers: t.texted, opted_out: t.opted_out, opt_out_rate: pct(t.opted_out, t.texted),
    min_answered: MIN_ANSWERED, can_publish: answered >= MIN_ANSWERED,
    methods_version: METHODS_VERSION,
  };
}

const snapshotView = (s) => ({
  id: Number(s.id), published_at: s.published_at,
  period: { from: String(s.period_from instanceof Date ? isoDay(s.period_from) : s.period_from).slice(0, 10),
    to: String(s.period_to instanceof Date ? isoDay(s.period_to) : s.period_to).slice(0, 10) },
  ...s.data, methods: s.methods,
});

/** Publish a snapshot (admin). Refused under MIN_ANSWERED answered court dates. */
export async function publishResults(db, { adminId, from, to }) {
  const data = await computeResults(db, { from, to });
  if (!data.can_publish) throw new ResultsError(409, 'sample_too_small', { answered: data.answered, min: MIN_ANSWERED });
  const { can_publish: _c, min_answered: _m, period: _p, ...stored } = data;
  const row = await db.get(
    `INSERT INTO results_snapshots (published_by, period_from, period_to, data, methods)
     VALUES (?, CAST(? AS date), CAST(? AS date), CAST(? AS jsonb), ?) RETURNING *`,
    [adminId, from, to, JSON.stringify(stored), METHODS_TEXT]);
  return snapshotView(row);
}

export async function listSnapshots(db) {
  const rows = await db.all('SELECT * FROM results_snapshots ORDER BY published_at DESC, id DESC LIMIT 50');
  return rows.map(snapshotView);
}

export async function latestSnapshot(db) {
  const row = await db.get('SELECT * FROM results_snapshots ORDER BY published_at DESC, id DESC LIMIT 1');
  return row ? snapshotView(row) : null;
}
