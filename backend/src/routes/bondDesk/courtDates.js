/**
 * routes/bondDesk/courtDates.js — a bond's hearings and the texts about them
 * (docs/BOND_DESK.md "Court dates and reminders"; services/bondDesk/courtDates.js).
 * Mounted at /api/bond-desk; every bond is the calling agent's own (404 otherwise).
 *
 *   GET    /bonds/:id/court-dates              hearings, the switch, the numbers and their confirmation
 *   POST   /bonds/:id/court-dates              add a hearing { court_date, court_time?, court_name?, room? }
 *   PATCH  /bonds/:id/court-dates/:cdId        change it / mark attended | missed | rescheduled | cancelled | scheduled
 *   DELETE /bonds/:id/court-dates/:cdId        remove it (its pending texts are cancelled)
 *   GET    /bonds/:id/reminders                every planned / sent text with its delivery status
 *   PUT    /bonds/:id/reminders                { on: bool, lang?: en|es|pt|vi } the per-bond switch and text language
 *   PUT    /bonds/:id/text-consent             { to: defendant|indemnitor, indemnitor_id?, consent_confirmed: bool }
 *                                              "the person gave me this number for texts about this bond"
 */
import { Router } from 'express';
import { BdError, handle, id, text, date, oneOf, body } from './_common.js';
import { loadBond } from './bonds.js';
import {
  COURT_STATUSES, bondTimeZone, planBondCourtDate, planBond, syncBondCourtDate, runBondCourtReminders,
} from '../../services/bondDesk/courtDates.js';
import { maskPhone } from '../../services/bondDesk/core.js';
import { dateOnly, timeOnly } from '../../services/courtReminders.js';
import { smsLive, toE164 } from '../../services/sms.js';
import { todayInZone } from '../../utils/timezone.js';
import logger from '../../utils/logger.js';

const router = Router();
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_HEARINGS = 50;
const LANGS = ['en', 'es', 'pt', 'vi'];

function time(v, field) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !TIME_RE.test(v)) throw new BdError(400, 'bad_time', { field });
  return v;
}

function fields(b, { partial }) {
  const f = {};
  const want = (k) => !partial || Object.prototype.hasOwnProperty.call(b, k);
  if (want('court_date')) f.court_date = date(b.court_date, 'court_date', { required: true });
  if (want('court_time')) f.court_time = time(b.court_time, 'court_time');
  if (want('court_name')) f.court_name = text(b.court_name, 160, 'court_name');
  if (want('room')) f.room = text(b.room, 60, 'room');
  if (partial && Object.prototype.hasOwnProperty.call(b, 'status')) f.status = oneOf(b.status, COURT_STATUSES, 'status');
  return f;
}

const pubCd = (r, today) => ({
  id: Number(r.id), court_date: dateOnly(r.court_date), court_time: timeOnly(r.court_time), court_name: r.court_name || null, room: r.room || null,
  status: r.status, status_source: r.status_source || null, status_at: r.status_at || null, asked_at: r.asked_at || null,
  is_past: !!(today && dateOnly(r.court_date) < today),
});

async function loadCd(db, bondId, cdId) {
  const r = await db.get('SELECT * FROM bd_court_dates WHERE id = ? AND bond_id = ? AND deleted_at IS NULL', [cdId, bondId]);
  if (!r) throw new BdError(404, 'not_found');
  return r;
}

async function bondZone(db, bond) {
  const u = await db.get('SELECT timezone FROM users WHERE id = (SELECT agent_id FROM bd_bonds WHERE id = ?)', [bond.id]);
  const tz = bondTimeZone(bond, u?.timezone);
  return { tz, today: todayInZone(tz) };
}

/** Re-plan one hearing, keep bd_bonds.court_date in step, and send anything due right now. */
async function afterChange(db, bondId, cdId) {
  if (cdId) await planBondCourtDate(db, cdId);
  await syncBondCourtDate(db, bondId);
  if (cdId) await runBondCourtReminders(db, { courtDateId: cdId }).catch((e) => logger.warn({ err: e.message }, '[bd-court] immediate send failed'));
}

async function listing(db, bond) {
  const { tz, today } = await bondZone(db, bond);
  const [rows, raw, inds, outs] = await Promise.all([
    db.all(`SELECT * FROM bd_court_dates WHERE bond_id = ? AND deleted_at IS NULL ORDER BY court_date, court_time NULLS FIRST LIMIT ${MAX_HEARINGS * 2}`, [bond.id]),
    db.get('SELECT court_reminders, text_lang, defendant_text_consent_at, defendant_text_consent_phone FROM bd_bonds WHERE id = ?', [bond.id]),
    db.all('SELECT id, full_name, phone, text_consent_at, text_consent_phone FROM bd_indemnitors WHERE bond_id = ? ORDER BY id LIMIT 20', [bond.id]),
    db.all(`SELECT phone FROM sms_opt_outs WHERE phone IN (SELECT phone FROM bd_indemnitors WHERE bond_id = ? UNION SELECT defendant_phone FROM bd_bonds WHERE id = ?) LIMIT 25`, [bond.id, bond.id]),
  ]);
  const stopped = new Set(outs.map((o) => o.phone));
  const person = (to, indemnitorId, name, phone, consentPhone, consentAt) => {
    const p = toE164(phone);
    return { to, indemnitor_id: indemnitorId, name, phone: p, phone_masked: p ? maskPhone(p) : null,
      consent: !!p && consentPhone === p, consent_at: p && consentPhone === p ? consentAt : null, opted_out: !!p && stopped.has(p) };
  };
  return {
    court_dates: rows.map((r) => pubCd(r, today)),
    reminders_on: !!raw.court_reminders, text_lang: raw.text_lang, time_zone: tz, today, texts_live: smsLive(),
    bond_status: bond.status,
    recipients: [
      person('defendant', null, bond.defendant_name, bond.defendant_phone, raw.defendant_text_consent_phone, raw.defendant_text_consent_at),
      ...inds.map((i) => person('indemnitor', Number(i.id), i.full_name, i.phone, i.text_consent_phone, i.text_consent_at)),
    ],
  };
}

router.get('/bonds/:id/court-dates', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  res.json(await listing(db, bond));
}));

router.post('/bonds/:id/court-dates', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const f = fields(body(req), { partial: false });
  const n = await db.get('SELECT COUNT(*)::int AS n FROM bd_court_dates WHERE bond_id = ? AND deleted_at IS NULL', [bond.id]);
  if (n.n >= MAX_HEARINGS) throw new BdError(409, 'too_many');
  let row;
  try {
    row = await db.get(
      `INSERT INTO bd_court_dates (bond_id, court_date, court_time, court_name, room) VALUES (?, CAST(? AS date), CAST(? AS time), ?, ?) RETURNING id`,
      [bond.id, f.court_date, f.court_time, f.court_name ?? bond.court_name ?? null, f.room]);
  } catch (e) {
    if (e.code === '23505') throw new BdError(409, 'duplicate');
    throw e;
  }
  await afterChange(db, bond.id, Number(row.id));
  const out = await listing(db, bond);
  res.status(201).json({ court_date: out.court_dates.find((c) => c.id === Number(row.id)), ...out });
}));

router.patch('/bonds/:id/court-dates/:cdId', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const cd = await loadCd(db, bond.id, id(req.params.cdId));
  const f = fields(body(req), { partial: true });
  const cols = Object.keys(f);
  if (!cols.length) throw new BdError(400, 'required', { field: 'court_date' });
  const sets = []; const vals = [];
  for (const k of cols) {
    if (k === 'court_date') sets.push('court_date = CAST(? AS date)');
    else if (k === 'court_time') sets.push('court_time = CAST(? AS time)');
    else sets.push(`${k} = ?`);
    vals.push(f[k]);
  }
  if (f.status && f.status !== cd.status) {
    sets.push('status_source = ?', 'status_at = NOW()');
    vals.push(f.status === 'scheduled' ? null : 'agent');
    // the agent set it: no "not confirmed" alert to the agent the next morning
    if (f.status !== 'scheduled') sets.push('followup_at = COALESCE(followup_at, NOW())');
  }
  // a hearing moved to another day is asked about / followed up again
  if (f.court_date && f.court_date !== dateOnly(cd.court_date)) sets.push('asked_at = NULL', 'followup_at = NULL');
  try {
    await db.run(`UPDATE bd_court_dates SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, [...vals, cd.id]);
  } catch (e) {
    if (e.code === '23505') throw new BdError(409, 'duplicate');
    throw e;
  }
  await afterChange(db, bond.id, Number(cd.id));
  const out = await listing(db, bond);
  res.json({ court_date: out.court_dates.find((c) => c.id === Number(cd.id)), ...out });
}));

router.delete('/bonds/:id/court-dates/:cdId', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const cd = await loadCd(db, bond.id, id(req.params.cdId));
  await db.run('UPDATE bd_court_dates SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [cd.id]);
  await planBondCourtDate(db, Number(cd.id));   // cancels its pending texts
  await syncBondCourtDate(db, bond.id);
  res.json({ ok: true, ...(await listing(db, bond)) });
}));

router.get('/bonds/:id/reminders', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const rows = await db.all(
    `SELECT r.id, r.court_date_id, r.court_day, r.step, r.signer_type, r.indemnitor_id, r.phone, r.send_at, r.status, r.reason, r.sent_at,
            i.full_name AS indemnitor_name, d.status AS delivery_status, d.error_code
       FROM bd_reminders r
       LEFT JOIN bd_indemnitors i ON i.id = r.indemnitor_id
       LEFT JOIN bd_texts t ON t.id = r.text_id
       LEFT JOIN sms_delivery d ON d.provider_id = t.provider_id
      WHERE r.bond_id = ? ORDER BY r.send_at, r.id LIMIT 500`, [bond.id]);
  res.json({
    reminders: rows.map((r) => ({
      id: Number(r.id), court_date_id: Number(r.court_date_id), court_day: dateOnly(r.court_day), step: r.step, signer_type: r.signer_type,
      name: r.signer_type === 'defendant' ? bond.defendant_name : (r.indemnitor_name || null), to_masked: maskPhone(r.phone),
      send_at: r.send_at, status: r.status, reason: r.reason || null, sent_at: r.sent_at || null,
      // null until the carrier reports back (delivered / delivery_failed / sending_failed / delivery_unconfirmed)
      delivery_status: r.delivery_status || null, error_code: r.error_code || null,
    })),
  });
}));

router.put('/bonds/:id/reminders', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const b = body(req);
  if (typeof b.on !== 'boolean') throw new BdError(400, 'invalid', { field: 'on' });
  const lang = b.lang === undefined ? null : oneOf(b.lang, LANGS, 'lang');
  await db.run(`UPDATE bd_bonds SET court_reminders = ?, text_lang = COALESCE(?, text_lang), updated_at = NOW() WHERE id = ?`, [b.on, lang, bond.id]);
  await planBond(db, bond.id);
  res.json(await listing(db, bond));
}));

router.put('/bonds/:id/text-consent', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const b = body(req);
  const to = oneOf(b.to, ['defendant', 'indemnitor'], 'to');
  if (typeof b.consent_confirmed !== 'boolean') throw new BdError(400, 'consent_required');
  if (to === 'defendant') {
    const p = toE164(bond.defendant_phone);
    if (b.consent_confirmed && !p) throw new BdError(400, 'no_number');
    await db.run('UPDATE bd_bonds SET defendant_text_consent_phone = ?, defendant_text_consent_at = ? WHERE id = ?',
      b.consent_confirmed ? [p, new Date().toISOString(), bond.id] : [null, null, bond.id]);
  } else {
    const i = await db.get('SELECT id, phone FROM bd_indemnitors WHERE id = ? AND bond_id = ?', [id(b.indemnitor_id), bond.id]);
    if (!i) throw new BdError(404, 'not_found');
    const p = toE164(i.phone);
    if (b.consent_confirmed && !p) throw new BdError(400, 'no_number');
    await db.run('UPDATE bd_indemnitors SET text_consent_phone = ?, text_consent_at = ? WHERE id = ?',
      b.consent_confirmed ? [p, new Date().toISOString(), i.id] : [null, null, i.id]);
  }
  await planBond(db, bond.id);
  res.json(await listing(db, bond));
}));

export default router;
