/**
 * services/bondDesk/tnReport.js — the Tennessee bail bondsman quarterly report (B5).
 *
 * What the law requires (checked October 27, 2026):
 *   Public Chapter 396 (2025) (HB 785 / SB 1237, effective July 1, 2025), cited by the Tennessee
 *   Department of Revenue as T.C.A. § 40-11-314, requires every professional bondsman licensed in
 *   Tennessee to file a QUARTERLY report with the Department of Revenue stating:
 *     1. the total number of bonds the bondsman issued in the preceding quarter;
 *     2. the number of bonds issued in each county in which the bondsman operated;
 *     3. the total amount of the bondsman's liability in each county.
 *   Due January 25, April 25, July 25 and October 25 (first report October 25, 2025). The
 *   Department collects it as a new schedule of the Bail Bond Tax Return (Form PRV413).
 *   Sources: Tennessee Department of Revenue Important Notice #25-08 (May 2025)
 *   https://www.tn.gov/content/dam/tn/revenue/documents/notices/bailbond/bailbondsmen2025.pdf
 *   and the bill history https://fastdemocracy.com/bill/tn/114/bills/TNB00055355 ("Comp. became
 *   Pub. Ch. 396").
 *
 * The notice does not define "liability in each county" further, so the report gives both
 * readings, labelled: the face amount of the bonds issued in the quarter, and the face amount of
 * all bonds still open at the end of the quarter. The agent copies the figures onto the
 * Department's schedule (filed through TNTAP); this report is not itself a filing.
 *
 * Counted: the agent's bonds with state TN whose posted_on falls in the quarter (prospect and
 * cancelled bonds were never issued). Open at quarter end: posted on or before the last day and
 * not discharged by then. Bonds posted in the quarter with no state or county are listed so the
 * agent can fix them — they cannot be placed in a county.
 */
import { kit, row } from './pdf.js';
import { money, usDate } from './money.js';

export const TN_REPORT = Object.freeze({
  citation: 'Tenn. Pub. Ch. 396 (2025), T.C.A. § 40-11-314 (as cited by the Tennessee Department of Revenue, Important Notice #25-08)',
  checked_on: '2026-10-27',
  form: 'Bail Bond Tax Return (Form PRV413), quarterly bail bondsman report schedule',
  sources: [
    'https://www.tn.gov/content/dam/tn/revenue/documents/notices/bailbond/bailbondsmen2025.pdf',
    'https://www.tn.gov/revenue/news/2025/5/8/-important-notice--bail-bondsmen-court-clerk-quarterly-reports.html',
    'https://fastdemocracy.com/bill/tn/114/bills/TNB00055355',
  ],
});

/** '2026-Q3' → { quarter, from: '2026-07-01', to: '2026-09-30', due: '2026-10-25' } (null when malformed). */
export function quarterRange(q) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(q || ''));
  if (!m) return null;
  const y = Number(m[1]); const n = Number(m[2]);
  if (y < 2025 || y > 2100) return null;
  const startMonth = (n - 1) * 3 + 1;
  const pad = (v) => String(v).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, startMonth + 2, 0)).getUTCDate();
  const due = n === 4 ? `${y + 1}-01-25` : `${y}-${pad(startMonth + 3)}-25`;
  return { quarter: `${y}-Q${n}`, from: `${y}-${pad(startMonth)}-01`, to: `${y}-${pad(startMonth + 2)}-${pad(lastDay)}`, due };
}

/** The quarter before the one `today` (YYYY-MM-DD) falls in — the one due next. */
export function previousQuarter(today) {
  const y = Number(today.slice(0, 4)); const mo = Number(today.slice(5, 7));
  const n = Math.floor((mo - 1) / 3) + 1;
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
}

const countyLabel = (c) => String(c || '').trim().replace(/\s+county$/i, '');

/** The report data for one agent and quarter. */
export async function tnQuarterlyReport(db, agentId, range) {
  const issued = await db.all(
    `SELECT INITCAP(LOWER(REGEXP_REPLACE(TRIM(county), '\\s+[Cc][Oo][Uu][Nn][Tt][Yy]$', ''))) AS county,
            COUNT(*)::int AS bonds, COALESCE(SUM(bond_amount_cents), 0)::bigint AS amount
       FROM bd_bonds
      WHERE agent_id = ? AND state = 'TN' AND COALESCE(TRIM(county), '') <> '' AND status NOT IN ('prospect', 'cancelled')
        AND posted_on BETWEEN ?::date AND ?::date
      GROUP BY 1 ORDER BY 1`, [agentId, range.from, range.to]);
  const open = await db.all(
    `SELECT INITCAP(LOWER(REGEXP_REPLACE(TRIM(county), '\\s+[Cc][Oo][Uu][Nn][Tt][Yy]$', ''))) AS county,
            COUNT(*)::int AS bonds, COALESCE(SUM(bond_amount_cents), 0)::bigint AS amount
       FROM bd_bonds
      WHERE agent_id = ? AND state = 'TN' AND COALESCE(TRIM(county), '') <> '' AND status NOT IN ('prospect', 'cancelled')
        AND posted_on <= ?::date AND (discharged_on IS NULL OR discharged_on > ?::date)
      GROUP BY 1 ORDER BY 1`, [agentId, range.to, range.to]);
  const missing = await db.all(
    `SELECT id, defendant_name, posted_on, state, county FROM bd_bonds
      WHERE agent_id = ? AND status NOT IN ('prospect', 'cancelled') AND posted_on BETWEEN ?::date AND ?::date
        AND (state IS NULL OR (state = 'TN' AND COALESCE(TRIM(county), '') = ''))
      ORDER BY posted_on, id LIMIT 500`, [agentId, range.from, range.to]);
  const counties = new Map();
  const get = (c) => { if (!counties.has(c)) counties.set(c, { county: c, bonds_issued: 0, liability_issued_cents: 0, open_bonds_at_end: 0, liability_open_at_end_cents: 0 }); return counties.get(c); };
  for (const r of issued) { const x = get(countyLabel(r.county)); x.bonds_issued += r.bonds; x.liability_issued_cents += Number(r.amount); }
  for (const r of open) { const x = get(countyLabel(r.county)); x.open_bonds_at_end += r.bonds; x.liability_open_at_end_cents += Number(r.amount); }
  const rows = [...counties.values()].sort((a, b) => a.county.localeCompare(b.county));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  return {
    quarter: range.quarter, period_from: range.from, period_to: range.to, due_on: range.due,
    citation: TN_REPORT.citation, checked_on: TN_REPORT.checked_on, form: TN_REPORT.form,
    totals: { bonds_issued: sum('bonds_issued'), liability_issued_cents: sum('liability_issued_cents'),
      open_bonds_at_end: sum('open_bonds_at_end'), liability_open_at_end_cents: sum('liability_open_at_end_cents') },
    counties: rows,
    needs_county: missing.map((m) => ({ bond_id: Number(m.id), defendant_name: m.defendant_name, posted_on: m.posted_on, state: m.state || null })),
  };
}

const dollars = (c) => (Number(c) / 100).toFixed(2);

/** CSV rows (header first): the header lines cite the law and the date it was checked. */
export function tnCsvRows(r, agency) {
  return [
    ['Tennessee bail bondsman quarterly report'],
    ['Required by', TN_REPORT.citation],
    ['Law checked on', TN_REPORT.checked_on],
    ['File with', `Tennessee Department of Revenue — ${TN_REPORT.form}`],
    ['Sources', TN_REPORT.sources.join(' ; ')],
    ['Bondsman / agency', [agency.agency, agency.agent_name, agency.license ? `License ${agency.license}` : ''].filter(Boolean).join(' — ')],
    ['Quarter', `${r.quarter} (${r.period_from} to ${r.period_to})`],
    ['Due', r.due_on],
    ['Total bonds issued in the quarter', String(r.totals.bonds_issued)],
    [],
    ['County', 'Bonds issued in the quarter', 'Liability: bonds issued in the quarter ($)', 'Bonds open at quarter end', 'Liability: bonds open at quarter end ($)'],
    ...r.counties.map((c) => [c.county, c.bonds_issued, dollars(c.liability_issued_cents), c.open_bonds_at_end, dollars(c.liability_open_at_end_cents)]),
    ['Total', r.totals.bonds_issued, dollars(r.totals.liability_issued_cents), r.totals.open_bonds_at_end, dollars(r.totals.liability_open_at_end_cents)],
    ...(r.needs_county.length ? [[], ['Bonds posted in the quarter without a state or Tennessee county (not counted above — add them on the bond)'],
      ...r.needs_county.map((b) => [b.defendant_name, b.posted_on, b.state || 'no state'])] : []),
    [],
    ['The notice does not say whether "liability in each county" means bonds written in the quarter or all open bonds; both are shown. Confirm with the Department which one the schedule asks for.'],
  ];
}

/** The same report as a PDF. */
export async function tnReportPdf(r, agency) {
  const { doc, done } = kit('Tennessee bail bondsman quarterly report');
  doc.font('B').fontSize(15).text('Tennessee bail bondsman quarterly report');
  doc.font('R').fontSize(9).fillColor('#444')
    .text(`Required by ${TN_REPORT.citation}. Law checked on ${usDate(TN_REPORT.checked_on)}. File with the Tennessee Department of Revenue: ${TN_REPORT.form}.`, { paragraphGap: 4 })
    .text(`Sources: ${TN_REPORT.sources.join('  ')}`, { paragraphGap: 8 });
  doc.fillColor('#000');
  row(doc, 'Bondsman / agency', [agency.agency, agency.agent_name, agency.license ? `License ${agency.license}` : ''].filter(Boolean).join(' — ') || '—');
  row(doc, 'Quarter', `${r.quarter}: ${usDate(r.period_from)} to ${usDate(r.period_to)}`);
  row(doc, 'Due', usDate(r.due_on));
  row(doc, 'Total bonds issued in the quarter', String(r.totals.bonds_issued));
  doc.font('B').fontSize(10).text('By county');
  doc.font('R').fontSize(9.5);
  if (!r.counties.length) doc.text('No Tennessee bonds issued in the quarter or open at its end.');
  for (const c of r.counties) {
    doc.font('B').text(c.county).font('R')
      .text(`Bonds issued in the quarter: ${c.bonds_issued} — liability ${money(c.liability_issued_cents)}`)
      .text(`Bonds open at quarter end: ${c.open_bonds_at_end} — liability ${money(c.liability_open_at_end_cents)}`, { paragraphGap: 4 });
  }
  doc.font('B').text(`Total: ${r.totals.bonds_issued} issued (${money(r.totals.liability_issued_cents)}); ${r.totals.open_bonds_at_end} open at quarter end (${money(r.totals.liability_open_at_end_cents)})`, { paragraphGap: 8 });
  if (r.needs_county.length) {
    doc.font('B').fillColor('#b00020').text(`${r.needs_county.length} bond(s) posted in the quarter have no state or Tennessee county and are not counted above:`);
    doc.font('R').fillColor('#000');
    for (const b of r.needs_county) doc.text(`• ${b.defendant_name} — posted ${usDate(b.posted_on)}${b.state ? '' : ' — no state'}`);
    doc.moveDown(0.5);
  }
  doc.font('R').fontSize(8.5).fillColor('#444').text('The Department\'s notice does not say whether "liability in each county" means bonds written in the quarter or all bonds open at the end of the quarter; both are shown. Confirm with the Department which figure its schedule asks for. This report is prepared from the bonds entered in Bond Desk; it is not a filing.');
  doc.end();
  return await done;
}
