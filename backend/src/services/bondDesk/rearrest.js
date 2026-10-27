/**
 * services/bondDesk/rearrest.js — re-arrest alerts for an agent's own defendants (A4, ⚖ counsel
 * question 1.2, BOND_REARREST_ALERTS_ENABLED — off in production unless set). docs/BOND_DESK.md.
 *
 * After each roster import (services/arrest_ingest.js) the NEW bookings are compared with the
 * defendants of bonds that are active or forfeited:
 *   strong   normalized first name + last name + date of birth. The date of birth on the bond
 *            (bd_bonds.defendant_dob) or the defendant's answer in a Bond Desk questionnaire
 *            (bd_signers.answers.dob). A booking whose date of birth differs from every one on
 *            file is not the defendant and is not matched at all.
 *   possible first + last name when the booking or the bond has no date of birth (and the
 *            state, when both have one, is the same). The agent confirms or dismisses it.
 * bd_rearrests is unique on (bond, arrest): an agent is never alerted twice for one booking.
 * Never matched: sample / seed rows, records taken down (suppressed) and rows whose roster status
 * says sealed or expunged (utils/arrestVisibility.js realArrestSql + the status check below).
 *
 * The agent who wrote the bond is alerted by push and e-mail, and by text when they turned that
 * on (strong matches only; 5¢ through bd_texts). The match is added to the bond timeline
 * (bd_bond_events) and the Bond Desk dashboard. Coverage is shown honestly: only the rosters we
 * import (ARREST_FEED_URLS), never "nationwide".
 *
 * Pricing: included on every bail-agent plan for now (no extra charge); the agent needs a plan.
 */
import logger from '../../utils/logger.js';
import { realArrestSql } from '../../utils/arrestVisibility.js';
import { msg, userLang, formatDay } from '../../i18n/index.js';
import { parseArrestFeeds } from '../arrest_ingest.js';
import { agentAccess, agencyFor, sendAgentEmail, sendAgentTextRecord } from './core.js';
import { pushStatus } from '../custodyAlerts.js';
import { fitSms } from '../smsText.js';

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
const APP_URL = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
const SEALED_SQL = `COALESCE(LOWER(a.status), '') NOT IN ('sealed', 'expunged')`;

const token = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * 'SMITH, JOHN A' / 'John A. Smith Jr.' / 'Juan de la Cruz' → { first, lasts:Set } (null when the
 * name has fewer than two parts). `lasts` holds every way the last name can be written (with or
 * without its particles), so "Juan de la Cruz" and "DE LA CRUZ, JUAN" meet.
 */
export function nameKeys(full) {
  const s = String(full || '').normalize('NFKC').trim();
  if (!s) return null;
  const words = (part) => part.split(/[\s.]+/).map(token).filter(Boolean);
  let first; let lastWords;
  if (s.includes(',')) {
    const [lastPart, ...rest] = s.split(',');
    lastWords = words(lastPart).filter((w) => !SUFFIXES.has(w));
    const given = words(rest.join(' ')).filter((w) => !SUFFIXES.has(w));
    first = given[0];
  } else {
    const all = words(s);
    while (all.length > 2 && SUFFIXES.has(all[all.length - 1])) all.pop();
    if (all.length < 2) return null;
    first = all[0];
    lastWords = all.slice(1);
  }
  if (!first || !lastWords?.length) return null;
  const lasts = new Set();
  for (let k = 0; k < lastWords.length; k++) lasts.add(lastWords.slice(k).join(''));
  lasts.add(lastWords.join(''));
  return { first, lasts };
}

/** 'strong' | 'possible' | null for one bond defendant and one booking. */
export function classifyMatch({ bondName, bondDobs, bondState }, { name, dob, state }) {
  const a = nameKeys(bondName); const b = nameKeys(name);
  if (!a || !b || a.first !== b.first) return null;
  if (![...a.lasts].some((l) => b.lasts.has(l))) return null;
  const dobs = new Set([...(bondDobs || [])].filter(Boolean));
  if (dob && dobs.size) return dobs.has(dob) ? 'strong' : null;   // a different date of birth: not them
  if (bondState && state && String(bondState).toUpperCase() !== String(state).toUpperCase()) return null;
  return 'possible';
}

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

/** Counties whose rosters we import: [{ county, state }] (feed config, else what the feed sent lately). */
export async function coverage(db) {
  const { feeds } = parseArrestFeeds();
  const out = [];
  const seen = new Set();
  const add = (county, state) => {
    const c = String(county || '').trim(); if (!c) return;
    const k = `${c.toLowerCase()}|${String(state || '').toUpperCase()}`;
    if (seen.has(k)) return; seen.add(k);
    out.push({ county: c.replace(/\s+county$/i, ''), state: state ? String(state).toUpperCase() : null });
  };
  for (const f of feeds) {
    if (f.county) { add(f.county, f.state); continue; }
    const rows = await db.all(
      `SELECT DISTINCT county, state FROM arrest_records WHERE source = ? AND created_at > NOW() - INTERVAL '30 days' AND COALESCE(county, '') <> '' LIMIT 50`,
      [f.source]).catch(() => []);
    for (const r of rows) add(r.county, r.state || f.state);
  }
  return { feeds_configured: feeds.length > 0, counties: out };
}

/** Bond ids → Map(bondId → [dob, …]) from the bond and the defendant's questionnaire answers. */
async function dobsFor(db, bonds) {
  const m = new Map(bonds.map((b) => [Number(b.id), b.defendant_dob ? [day(b.defendant_dob)] : []]));
  if (!bonds.length) return m;
  const rows = await db.all(
    `SELECT k.bond_id, s.answers->>'dob' AS dob FROM bd_signers s JOIN bd_packets k ON k.id = s.packet_id
      WHERE s.role = 'defendant' AND s.answers->>'dob' IS NOT NULL AND k.bond_id = ANY(?::bigint[])`, [`{${bonds.map((b) => Number(b.id)).join(',')}}`]);
  for (const r of rows) if (/^\d{4}-\d{2}-\d{2}$/.test(String(r.dob || ''))) m.get(Number(r.bond_id))?.push(r.dob);
  return m;
}

/**
 * Compare new bookings with every active / forfeited bond. → { checked, strong, possible }
 * Safe to run twice: (bond, arrest) is claimed once.
 */
export async function matchNewArrests(db, arrestIds) {
  const ids = [...new Set(arrestIds.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const stats = { checked: 0, strong: 0, possible: 0 };
  if (!ids.length) return stats;
  const arrests = await db.all(
    `SELECT a.id, a.name, a.dob, a.county, a.state, a.booking_date, a.jail_location FROM arrest_records a
      WHERE a.id = ANY(?::bigint[]) AND ${realArrestSql('a')} AND ${SEALED_SQL}`, [`{${ids.join(',')}}`]);
  stats.checked = arrests.length;
  if (!arrests.length) return stats;
  const byFirst = new Map();
  for (const a of arrests) {
    const k = nameKeys(a.name); if (!k) continue;
    if (!byFirst.has(k.first)) byFirst.set(k.first, []);
    byFirst.get(k.first).push(a);
  }
  const bonds = await db.all(`SELECT id, agent_id, defendant_name, defendant_dob, state FROM bd_bonds WHERE status IN ('active', 'forfeited')`);
  const candidates = bonds.filter((b) => byFirst.has(nameKeys(b.defendant_name)?.first));
  const dobs = await dobsFor(db, candidates);
  const allowed = new Map();
  for (const b of candidates) {
    for (const a of byFirst.get(nameKeys(b.defendant_name).first)) {
      const match = classifyMatch({ bondName: b.defendant_name, bondDobs: dobs.get(Number(b.id)), bondState: b.state },
        { name: a.name, dob: a.dob ? day(a.dob) : null, state: a.state });
      if (!match) continue;
      const agentId = Number(b.agent_id);
      if (!allowed.has(agentId)) {
        const u = await db.get('SELECT id, role FROM users WHERE id = ?', [agentId]);
        allowed.set(agentId, !!u && (await agentAccess(db, u).catch(() => ({ allowed: false }))).allowed);
      }
      if (!allowed.get(agentId)) continue;   // alerts are part of a bail-agent plan
      const row = await db.get(
        `INSERT INTO bd_rearrests (bond_id, arrest_id, agent_id, match, status) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (bond_id, arrest_id) DO NOTHING RETURNING id`,
        [b.id, a.id, agentId, match, match === 'strong' ? 'alerted' : 'pending']);
      if (!row) continue;
      stats[match]++;
      await addEvent(db, Number(b.id), match === 'strong' ? 'rearrest_strong' : 'rearrest_possible',
        { rearrest_id: Number(row.id), arrest_id: Number(a.id), county: a.county || null, state: a.state || null, booking_date: day(a.booking_date) });
      await alertAgent(db, { rearrestId: Number(row.id), bond: b, arrest: a, match }).catch((e) => logger.warn({ err: e?.message }, '[rearrest] alert failed'));
    }
  }
  if (stats.strong || stats.possible) logger.info(`[rearrest] ${stats.strong} strong, ${stats.possible} possible matches`);
  return stats;
}

export async function addEvent(db, bondId, kind, detail = {}) {
  await db.run('INSERT INTO bd_bond_events (bond_id, kind, detail) VALUES (?, ?, ?::jsonb)', [bondId, kind, JSON.stringify(detail)]);
}

/** The alert wording: { title, body, sms, subject, email }. */
export function rearrestMessage(lang, { match, defendant, county, state, bookingDate, facility, agency, link }) {
  const c = String(county || '').trim().replace(/\s+county$/i, '');
  const roster = c ? msg(lang, 'rearrest.roster_county', { county: c, state_part: state ? `, ${state}` : '' }) : msg(lang, 'rearrest.roster_generic');
  const p = { name: defendant, roster, day: bookingDate ? formatDay(bookingDate, lang, { year: true }) : '', facility: facility ? `, ${facility}` : '' };
  const title = msg(lang, match === 'strong' ? 'rearrest.title_strong' : 'rearrest.title_possible', { name: defendant });
  const body = msg(lang, match === 'strong' ? 'rearrest.body_strong' : 'rearrest.body_possible', p);
  return {
    title, body, subject: title,
    sms: fitSms((f) => msg(lang, 'rearrest.sms', { agency: f.agency, name: f.name, roster, link }),
      { agency, name: defendant }, [['agency', 10], ['name', 12]]),
    email: `${body}\n\n${msg(lang, 'rearrest.email_open', { link })}\n\n${msg(lang, 'rearrest.email_note')}`,
  };
}

async function alertAgent(db, { rearrestId, bond, arrest, match }) {
  const agentId = Number(bond.agent_id);
  const lang = await userLang(db, agentId);
  const a = await agencyFor(db, agentId);
  const link = `${APP_URL()}/bond-desk/bond/${Number(bond.id)}`;
  const m = rearrestMessage(lang, { match, defendant: bond.defendant_name, county: arrest.county, state: arrest.state,
    bookingDate: day(arrest.booking_date), facility: arrest.jail_location, agency: a.agency || 'Bond Desk', link });
  const push = await pushStatus(agentId, { title: m.title, body: m.body, data: { screen: 'BondDetail', bondId: Number(bond.id), tab: 'alerts' }, channelId: 'case_updates' });
  const email = await sendAgentEmail({ to: a.email, subject: m.subject, text: m.email });
  let text = null; let bdTextId = null;
  if (match === 'strong') {
    const s = await db.get('SELECT rearrest_text, alert_phone FROM bd_alert_settings WHERE agent_id = ?', [agentId]);
    const to = s?.alert_phone || a.phone;
    if (s?.rearrest_text && to) {
      const r = await sendAgentTextRecord(db, { agentId, bondId: Number(bond.id), purpose: 'rearrest_alert', to, body: m.sms });
      text = r.status; bdTextId = r.bdTextId;
    }
  }
  await db.run('UPDATE bd_rearrests SET push_status = ?, email_status = ?, text_status = ?, bd_text_id = ? WHERE id = ?',
    [push, email, text, bdTextId, rearrestId]);
}

const pub = (r) => ({
  id: Number(r.id), bond_id: Number(r.bond_id), arrest_id: Number(r.arrest_id), match: r.match, status: r.status,
  created_at: r.created_at, decided_at: r.decided_at || null,
  booking: { name: r.name, booking_date: r.booking_date ? day(r.booking_date) : null, county: r.county || null, state: r.state || null,
    facility: r.jail_location || null, charges: r.charges || null, dob_on_roster: !!r.dob },
  alerts: { push: r.push_status || null, email: r.email_status || null, text: r.text_status || null },
});

/** One bond's matches (records taken down since are left out). */
export async function bondRearrests(db, bondId) {
  const rows = await db.all(
    `SELECT r.*, a.name, a.booking_date, a.county, a.state, a.jail_location, a.charges, a.dob
       FROM bd_rearrests r JOIN arrest_records a ON a.id = r.arrest_id
      WHERE r.bond_id = ? AND ${realArrestSql('a')} ORDER BY r.created_at DESC, r.id DESC LIMIT 50`, [bondId]);
  return rows.map(pub);
}

/** The agent's recent matches for the dashboard (30 days; dismissed ones left out). */
export async function agentRearrests(db, agentId) {
  const rows = await db.all(
    `SELECT r.*, a.name, a.booking_date, a.county, a.state, a.jail_location, a.charges, a.dob, b.defendant_name
       FROM bd_rearrests r JOIN arrest_records a ON a.id = r.arrest_id JOIN bd_bonds b ON b.id = r.bond_id
      WHERE r.agent_id = ? AND r.status <> 'dismissed' AND r.created_at > NOW() - INTERVAL '30 days' AND ${realArrestSql('a')}
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 50`, [agentId]);
  return rows.map((r) => ({ ...pub(r), defendant_name: r.defendant_name }));
}

/** confirm / dismiss a possible match. → the updated row */
export async function decide(db, agentId, rearrestId, decision) {
  const r = await db.get(
    `UPDATE bd_rearrests SET status = ?, decided_at = NOW() WHERE id = ? AND agent_id = ? AND status = 'pending' RETURNING id, bond_id, arrest_id`,
    [decision === 'confirm' ? 'confirmed' : 'dismissed', rearrestId, agentId]);
  if (!r) return null;
  await addEvent(db, Number(r.bond_id), decision === 'confirm' ? 'rearrest_confirmed' : 'rearrest_dismissed',
    { rearrest_id: Number(r.id), arrest_id: Number(r.arrest_id) });
  return Number(r.id);
}
