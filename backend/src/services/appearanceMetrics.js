/**
 * services/appearanceMetrics.js — "Did you make it to court?" counts (build plan A7).
 *
 * Per county (or state when the county is unknown) and month of the court date, for hearings
 * on or before today:
 *   asked        the question went out (push or text)
 *   attended / rescheduled / missed   the hearing's status (an answer, or set by the person / agent)
 *   no_answer    asked, and the hearing is still just "scheduled"
 * App users (court_dates; county from the chosen courthouse, else the case's state) and Bond
 * Desk (bd_court_dates; the bond's county and state) are counted separately. Counts only —
 * no rate is computed or claimed here.
 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ?from=YYYY-MM&to=YYYY-MM (both optional) → { from, to } or { error } */
export function monthRange(q = {}) {
  const from = q.from == null || q.from === '' ? null : String(q.from);
  const to = q.to == null || q.to === '' ? null : String(q.to);
  if ((from && !MONTH.test(from)) || (to && !MONTH.test(to))) return { error: 'bad_month' };
  if (from && to && to < from) return { error: 'bad_month' };
  return { from, to };
}

const COUNTS = `
  COUNT(*) FILTER (WHERE x.asked_at IS NOT NULL)::int AS asked,
  COUNT(*) FILTER (WHERE x.status = 'attended')::int AS attended,
  COUNT(*) FILTER (WHERE x.status = 'rescheduled')::int AS rescheduled,
  COUNT(*) FILTER (WHERE x.status = 'missed')::int AS missed,
  COUNT(*) FILTER (WHERE x.asked_at IS NOT NULL AND x.status = 'scheduled')::int AS no_answer`;

function shape(rows) {
  return rows.map((r) => ({
    region: r.county ? `${r.county}${r.state ? `, ${r.state}` : ''}` : (r.state || 'unknown'),
    county: r.county || null, state: r.state || null, month: r.month,
    asked: r.asked, attended: r.attended, rescheduled: r.rescheduled, missed: r.missed, no_answer: r.no_answer,
  }));
}

function monthWhere(col, { from, to }, args) {
  let w = '';
  if (from) { w += ` AND ${col} >= CAST(? AS date)`; args.push(`${from}-01`); }
  if (to) { w += ` AND ${col} < (CAST(? AS date) + INTERVAL '1 month')`; args.push(`${to}-01`); }
  return w;
}

/** Bond Desk rows; agentId limits them to one agent's bonds. */
export async function bondDeskAppearance(db, { from = null, to = null, agentId = null } = {}) {
  const args = [];
  let where = `x.deleted_at IS NULL AND x.court_date <= CURRENT_DATE`;
  if (agentId) { where += ' AND b.agent_id = ?'; args.push(agentId); }
  where += monthWhere('x.court_date', { from, to }, args);
  const rows = await db.all(
    `SELECT NULLIF(TRIM(b.county), '') AS county, b.state, to_char(x.court_date, 'YYYY-MM') AS month, ${COUNTS}
       FROM bd_court_dates x JOIN bd_bonds b ON b.id = x.bond_id
      WHERE ${where}
      GROUP BY 1, 2, 3 ORDER BY 3 DESC, 2 NULLS LAST, 1 NULLS LAST LIMIT 2000`, args);
  return shape(rows);
}

/** App users' rows. */
export async function appAppearance(db, { from = null, to = null } = {}) {
  const args = [];
  let where = `x.deleted_at IS NULL AND c.deleted_at IS NULL AND x.court_date <= CURRENT_DATE`;
  where += monthWhere('x.court_date', { from, to }, args);
  const rows = await db.all(
    `SELECT NULLIF(TRIM(ch.county), '') AS county, UPPER(COALESCE(NULLIF(ch.state, ''), NULLIF(c.state, ''))) AS state,
            to_char(x.court_date, 'YYYY-MM') AS month, ${COUNTS}
       FROM court_dates x JOIN cases c ON c.id = x.case_id LEFT JOIN courthouses ch ON ch.id = x.courthouse_id
      WHERE ${where}
      GROUP BY 1, 2, 3 ORDER BY 3 DESC, 2 NULLS LAST, 1 NULLS LAST LIMIT 2000`, args);
  return shape(rows);
}

export const APPEARANCE_COLUMNS = Object.freeze(['region', 'month', 'asked', 'attended', 'rescheduled', 'missed', 'no_answer']);
