/**
 * services/courtDayHelp.js — "Plan your court day" (build plan A8, migration 40).
 *
 *   Plan: five items saved on the court date (court_dates.plan, owner only): ride, time off work,
 *         child care, documents, address and room. Each { done, note } (note ≤ 200 characters).
 *   Help links (no claims, only places to call or open):
 *     - 211 — call 211 or visit 211.org (every county)
 *     - the county's transit agency, ONLY when data/transit_agencies.js has a cited row for the
 *       court's county; the source and the date checked travel with it
 *     - map directions to the courthouse address (when the hearing has a courthouse)
 *     Public defender phone: not shown. The directory's public-defender rows (resources) carry no
 *     cited source, and the plan says to show only cited rows.
 *   Ride offers: a family follower who gets reminders for the case can offer a ride for one
 *     upcoming court date; the owner gets a push "{name} offered a ride to court on {day}" and can
 *     accept or decline; the follower is told the answer by push.
 */
import { transitAgencyFor } from '../data/transit_agencies.js';
import { msg, formatDay, userLang } from '../i18n/index.js';
import { sendPushToUser } from './pushDelivery.js';
import { dateOnly } from './courtReminders.js';
import logger from '../utils/logger.js';

export const PLAN_ITEMS = Object.freeze(['ride', 'time_off', 'child_care', 'documents', 'address_room']);
export const NOTE_MAX = 200;
export const LINK_211 = Object.freeze({ phone: '211', url: 'https://www.211.org' });

export class HelpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/** Body { items: { ride: { done, note }, ... } } → a clean plan, or throws HelpError(400). */
export function normalizePlan(body) {
  const items = body && typeof body === 'object' && body.items && typeof body.items === 'object' && !Array.isArray(body.items) ? body.items : null;
  if (!items) throw new HelpError(400, 'bad_plan');
  const out = {};
  for (const [k, v] of Object.entries(items)) {
    if (!PLAN_ITEMS.includes(k)) throw new HelpError(400, 'bad_plan');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HelpError(400, 'bad_plan');
    if (v.done !== undefined && typeof v.done !== 'boolean') throw new HelpError(400, 'bad_plan');
    if (v.note !== undefined && v.note !== null && typeof v.note !== 'string') throw new HelpError(400, 'bad_plan');
    const note = String(v.note ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
    if (note.length > NOTE_MAX) throw new HelpError(400, 'note_too_long');
    out[k] = { done: v.done === true, note: note || null };
  }
  return out;
}

/** The saved plan with every item present (unsaved items are not done, no note). */
export function planView(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  return PLAN_ITEMS.map((id) => ({ id, done: p[id]?.done === true, note: p[id]?.note || null }));
}

/** Help links for a hearing whose courthouse is `ch` ({ county, state, address, lat, lng } or null). */
export function helpLinks(ch) {
  const agency = ch ? transitAgencyFor(ch.county, ch.state) : null;
  const directions = !ch ? null
    : ch.lat != null && ch.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${ch.lat},${ch.lng}`
      : ch.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ch.address)}` : null;
  return {
    call_211: { phone: LINK_211.phone, url: LINK_211.url },
    transit: agency ? {
      agency: agency.agency, serves: agency.serves, url: agency.url, trip_planner: agency.trip_planner,
      source_url: agency.source_url, checked: agency.checked,
    } : null,
    directions_url: directions,
    public_defender: null,
  };
}

/**
 * Help links for a Bond Desk hearing (the defendant's check-in link page): no street address is
 * kept for Bond Desk courts, so directions search the court's name in its county and state.
 */
export function helpLinksForCourtName({ court_name: name, county, state } = {}) {
  const agency = transitAgencyFor(county, state);
  const q = [name, county ? `${String(county).replace(/\s+county$/i, '')} County` : null, state].filter(Boolean).join(', ');
  return {
    call_211: { phone: LINK_211.phone, url: LINK_211.url },
    transit: agency ? {
      agency: agency.agency, serves: agency.serves, url: agency.url, trip_planner: agency.trip_planner,
      source_url: agency.source_url, checked: agency.checked,
    } : null,
    directions_url: name ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null,
    public_defender: null,
  };
}

const firstName = (s) => { const n = String(s || '').trim(); return n ? n.split(/\s+/)[0].slice(0, 40) : null; };

/** The offers on one of the owner's court dates. */
export async function rideOffersForOwner(db, courtDateId) {
  const rows = await db.all(
    `SELECT r.id, r.status, r.created_at, r.decided_at, cfa.invite_name, u.display_name, u.name
       FROM ride_offers r
       JOIN users u ON u.id = r.follower_id
       LEFT JOIN case_family_access cfa ON cfa.case_id = r.case_id AND cfa.user_id = r.follower_id AND cfa.status = 'active'
      WHERE r.court_date_id = ? AND r.status <> 'withdrawn' ORDER BY r.created_at LIMIT 20`, [courtDateId]);
  return rows.map((r) => ({
    id: Number(r.id), status: r.status, name: r.invite_name || firstName(r.display_name || r.name),
    created_at: r.created_at, decided_at: r.decided_at,
  }));
}

/** The follower's active follow of the court date's case, with share_reminders. */
async function followFor(db, followerId, followId, courtDateId) {
  return db.get(
    `SELECT cfa.id, cfa.case_id, cfa.share_reminders, cfa.invite_name, c.user_id AS owner_id,
            cd.id AS court_date_id, cd.court_date, cd.status AS cd_status
       FROM case_family_access cfa
       JOIN cases c ON c.id = cfa.case_id AND c.deleted_at IS NULL
       JOIN court_dates cd ON cd.case_id = c.id AND cd.id = ? AND cd.deleted_at IS NULL
      WHERE cfa.id = ? AND cfa.user_id = ? AND cfa.status = 'active'`, [courtDateId, followId, followerId]);
}

async function push(userId, key, params, lang, data) {
  try {
    const r = await sendPushToUser(userId, {
      title: msg(lang, `${key}.title`, params), body: msg(lang, `${key}.body`, params), data, channelId: 'court_reminders',
    });
    return r?.sent > 0 ? 'sent' : `skipped:${r?.reason || 'none'}`;
  } catch (e) {
    logger.warn({ err: e.message }, '[ride-offers] push failed');
    return 'failed';
  }
}

/** Follower offers a ride (or offers again after withdrawing). → { offer_id, status } */
export async function offerRide(db, { followerId, followId, courtDateId, today }) {
  const f = await followFor(db, followerId, followId, courtDateId);
  if (!f) throw new HelpError(404, 'not_found');
  if (Number(f.share_reminders) !== 1) throw new HelpError(403, 'reminders_off');
  const day = dateOnly(f.court_date);
  if (f.cd_status !== 'scheduled' || (today && day < today)) throw new HelpError(409, 'not_upcoming');
  const row = await db.get(
    `INSERT INTO ride_offers (court_date_id, case_id, follower_id, owner_id, status)
     VALUES (?, ?, ?, ?, 'offered')
     ON CONFLICT (court_date_id, follower_id) DO UPDATE SET status = 'offered', decided_at = NULL, updated_at = NOW()
       WHERE ride_offers.status = 'withdrawn'
     RETURNING id, (xmax = 0) AS inserted`, [f.court_date_id, f.case_id, followerId, f.owner_id]);
  if (!row) {
    const cur = await db.get('SELECT id, status FROM ride_offers WHERE court_date_id = ? AND follower_id = ?', [f.court_date_id, followerId]);
    return { offer_id: Number(cur.id), status: cur.status, already: true };
  }
  const follower = await db.get('SELECT display_name, name FROM users WHERE id = ?', [followerId]);
  const lang = await userLang(db, Number(f.owner_id));
  const name = f.invite_name || firstName(follower?.display_name || follower?.name) || msg(lang, 'ride.someone');
  const st = await push(Number(f.owner_id), 'ride.offered', { name, day: formatDay(day, lang) }, lang,
    { type: 'ride_offer', screen: 'CourtDateDetail', id: Number(f.court_date_id) });
  await db.run('UPDATE ride_offers SET owner_push = ? WHERE id = ?', [st, row.id]);
  return { offer_id: Number(row.id), status: 'offered', owner_push: st };
}

/** Follower takes the offer back. */
export async function withdrawRide(db, { followerId, followId, courtDateId }) {
  const f = await followFor(db, followerId, followId, courtDateId);
  if (!f) throw new HelpError(404, 'not_found');
  const r = await db.get(
    `UPDATE ride_offers SET status = 'withdrawn', updated_at = NOW() WHERE court_date_id = ? AND follower_id = ? AND status <> 'withdrawn' RETURNING id`,
    [f.court_date_id, followerId]);
  if (!r) throw new HelpError(404, 'not_found');
  return { offer_id: Number(r.id), status: 'withdrawn' };
}

/** Owner accepts or declines; the follower is told. */
export async function decideRide(db, { ownerId, courtDateId, offerId, decision }) {
  if (!['accept', 'decline'].includes(decision)) throw new HelpError(400, 'bad_decision');
  const status = decision === 'accept' ? 'accepted' : 'declined';
  const r = await db.get(
    `UPDATE ride_offers SET status = ?, decided_at = NOW(), updated_at = NOW()
      WHERE id = ? AND court_date_id = ? AND owner_id = ? AND status IN ('offered', 'accepted', 'declined')
      RETURNING id, follower_id, court_date_id`, [status, offerId, courtDateId, ownerId]);
  if (!r) throw new HelpError(404, 'not_found');
  const cd = await db.get('SELECT court_date FROM court_dates WHERE id = ?', [r.court_date_id]);
  const owner = await db.get('SELECT display_name, name FROM users WHERE id = ?', [ownerId]);
  const lang = await userLang(db, Number(r.follower_id));
  const who = firstName(owner?.display_name || owner?.name) || msg(lang, 'ride.someone');
  const st = await push(Number(r.follower_id), `ride.${status}`, { name: who, day: formatDay(dateOnly(cd?.court_date), lang) }, lang,
    { type: 'ride_offer_answer', screen: 'Following' });
  await db.run('UPDATE ride_offers SET follower_push = ? WHERE id = ?', [st, r.id]);
  return { offer_id: Number(r.id), status, follower_push: st };
}

/** The follower's own offers for the court dates of their follows: { [court_date_id]: status }. */
export async function myRideOffers(db, followerId) {
  const rows = await db.all(
    `SELECT court_date_id, status FROM ride_offers WHERE follower_id = ? AND status <> 'withdrawn' ORDER BY id DESC LIMIT 200`, [followerId]);
  const out = {};
  for (const r of rows) out[Number(r.court_date_id)] = r.status;
  return out;
}
