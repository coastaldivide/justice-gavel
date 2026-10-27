/**
 * services/phoneLine.js — the toll-free court-date phone line (build plan A10, phone line only).
 *
 * Telnyx Call Control (Voice API v2): Telnyx posts signed JSON webhooks for each call event to
 * POST /api/webhooks/telnyx-voice (routes/webhooks/telnyxVoice.js) and we answer each with a
 * command (POST {TELNYX_API_BASE}/calls/{call_control_id}/actions/{answer|gather_using_speak|
 * speak|hangup}). The call's place in the menu travels in `client_state` (base64 JSON), which
 * Telnyx sends back with the next event (signed, like every webhook).
 *
 *   incoming call → answer → "press 1 for English, para español oprima 2"
 *   menu: 1 hear your next court date · 2 get it by text · 3 what to do if you missed court
 *   The caller is matched by caller ID to a phone number on file: an account's VERIFIED phone
 *   (services/phoneVerification.js), a Bond Desk defendant's phone, or a check-in enrollment's
 *   phone. Otherwise the caller is asked to enter the number on file on the keypad (3 tries per
 *   call, 10 per caller a day). The next court date is read: day, time, court name, room —
 *   nothing else (no case details, no balances). Option 2 texts it to the number on file (never
 *   to a number that replied STOP; one text an hour per number). Option 3 reads the existing
 *   missed-court guidance (services/courtDayGuidance.js).
 *
 * Settings: TELNYX_VOICE_ENABLED (default off), TELNYX_VOICE_NUMBER (the line's number; calls to
 * other numbers are ignored), TELNYX_API_KEY, TELNYX_PUBLIC_KEY (signature), optional
 * TELNYX_VOICE_EN / TELNYX_VOICE_ES (text-to-speech voices, default Polly.Joanna / Polly.Lupe),
 * PHONE_LINE_TIME_ZONE (what "today" is when looking for the next court date, default
 * America/Chicago).
 * Limits: 6 calls an hour and 20 a day per caller. Calls are logged in voice_calls without
 * recordings and without full numbers (an HMAC of the number and its last 4 digits).
 */
import crypto from 'node:crypto';
import { fetchWithTimeout } from '../utils/http.js';
import { sendSms, smsLive, toE164 } from './sms.js';
import { todayInZone } from '../utils/timezone.js';
import { dateOnly } from './courtReminders.js';
import { fitSms } from './smsText.js';
import {
  say, voiceLang, languagePrompt, spokenCourtDate, smsCourtDate, spokenMissedGuidance,
} from './phoneLineText.js';
import logger from '../utils/logger.js';

export const CALLS_PER_HOUR = 6;
export const CALLS_PER_DAY = 20;
export const KEYPAD_TRIES_PER_CALL = 3;
export const KEYPAD_TRIES_PER_DAY = 10;
const OPEN_BONDS = ['prospect', 'active', 'forfeited'];

export function phoneLineEnabled(env) {
  const raw = env ? env.TELNYX_VOICE_ENABLED : process.env.TELNYX_VOICE_ENABLED;
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}
/** The number shown in the app (E.164) when the line is on, else null. */
export function phoneLineNumber(env) {
  return phoneLineEnabled(env) ? toE164(env ? env.TELNYX_VOICE_NUMBER : process.env.TELNYX_VOICE_NUMBER) : null;
}

const hmac = (v) => crypto.createHmac('sha256', process.env.PHONE_CODE_SECRET || process.env.JWT_SECRET || '').update(String(v)).digest('hex');
const d10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);

export function encodeState(s) { return Buffer.from(JSON.stringify(s)).toString('base64'); }
export function decodeState(b64) {
  try {
    const s = JSON.parse(Buffer.from(String(b64 || ''), 'base64').toString('utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch { return {}; }
}

/** One Call Control command. Never throws; → true when Telnyx accepted it. */
export async function callCommand(callControlId, action, body = {}) {
  const base = String(process.env.TELNYX_API_BASE || 'https://api.telnyx.com/v2').replace(/\/+$/, '');
  try {
    const res = await fetchWithTimeout(`${base}/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY || ''}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }, { timeoutMs: 10_000 });
    if (!res.ok) logger.warn({ action, status: res.status }, '[phone-line] Telnyx refused a command');
    return res.ok;
  } catch (e) {
    logger.warn({ action, err: e.code || e.name }, '[phone-line] command failed');
    return false;
  }
}

const voice = (lang) => (voiceLang(lang) === 'es' ? process.env.TELNYX_VOICE_ES || 'Polly.Lupe' : process.env.TELNYX_VOICE_EN || 'Polly.Joanna');
const language = (lang) => (voiceLang(lang) === 'es' ? 'es-US' : 'en-US');

function gather(id, payload, state, { digits = '123', min = 1, max = 1, ssml = false } = {}) {
  return callCommand(id, 'gather_using_speak', {
    payload, payload_type: ssml ? 'ssml' : 'text', voice: voice(state.l), language: language(state.l),
    minimum_digits: min, maximum_digits: max, valid_digits: digits, terminating_digit: '#',
    timeout_millis: 8000, inter_digit_timeout_millis: 5000, maximum_tries: 2,
    invalid_payload: say(state.l, 'invalid'), client_state: encodeState(state),
  });
}
function speakThenHangUp(id, payload, state) {
  return callCommand(id, 'speak', { payload, payload_type: 'text', voice: voice(state.l), language: language(state.l), client_state: encodeState({ ...state, s: 'bye' }) });
}

/**
 * The soonest upcoming court date for a phone number on file, from (a) accounts that VERIFIED
 * the number, (b) open Bond Desk bonds of the defendant with that number, (c) active check-in
 * enrollments with that number. → { date, time, court_name, room } or null. Nothing else.
 */
export async function nextCourtDateForPhone(db, phone, today) {
  const e164 = toE164(phone); const ten = d10(phone);
  if (!e164 || ten.length !== 10) return null;
  const found = [];
  const app = await db.get(
    `SELECT cd.court_date, cd.court_time, ch.name AS court_name, cd.location AS room
       FROM users u
       JOIN court_dates cd ON cd.user_id = u.id AND cd.deleted_at IS NULL AND cd.status = 'scheduled'
       JOIN cases c ON c.id = cd.case_id AND c.deleted_at IS NULL AND c.user_id = u.id
       LEFT JOIN courthouses ch ON ch.id = cd.courthouse_id
      WHERE u.phone_verified_at IS NOT NULL AND u.phone_verified_phone = ? AND u.phone = ?
        AND cd.court_date >= CAST(? AS date)
      ORDER BY cd.court_date, cd.court_time NULLS FIRST LIMIT 1`, [e164, e164, today]);
  if (app) found.push(app);
  const bond = await db.get(
    `SELECT cd.court_date, cd.court_time, COALESCE(cd.court_name, b.court_name) AS court_name, cd.room
       FROM bd_bonds b JOIN bd_court_dates cd ON cd.bond_id = b.id AND cd.deleted_at IS NULL AND cd.status = 'scheduled'
      WHERE RIGHT(regexp_replace(COALESCE(b.defendant_phone, ''), '[^0-9]', '', 'g'), 10) = ?
        AND b.status IN (${OPEN_BONDS.map(() => '?').join(',')}) AND cd.court_date >= CAST(? AS date)
      ORDER BY cd.court_date, cd.court_time NULLS FIRST LIMIT 1`, [ten, ...OPEN_BONDS, today]);
  if (bond) found.push(bond);
  const enr = await db.get(
    `SELECT LEFT(court_date::text, 10) AS court_date, NULL AS court_time, NULL AS court_name, NULL AS room FROM checkin_enrollments
      WHERE active = 1 AND court_date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND LEFT(court_date::text, 10) >= ?
        AND RIGHT(regexp_replace(COALESCE(defendant_phone, ''), '[^0-9]', '', 'g'), 10) = ?
      ORDER BY 1 LIMIT 1`, [today, ten]);
  if (enr) found.push(enr);
  if (!found.length) return null;
  const rows = found.map((r) => ({
    date: dateOnly(r.court_date), time: r.court_time ? String(r.court_time).slice(0, 5) : null,
    court_name: r.court_name ? String(r.court_name).slice(0, 120) : null, room: r.room ? String(r.room).slice(0, 60) : null,
  }));
  rows.sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
  return rows[0];
}

/** Is this number on file at all (a verified account, a Bond Desk defendant, an enrollment)? */
export async function phoneOnFile(db, phone) {
  const e164 = toE164(phone); const ten = d10(phone);
  if (!e164 || ten.length !== 10) return false;
  const r = await db.get(
    `SELECT EXISTS (SELECT 1 FROM users WHERE phone_verified_at IS NOT NULL AND phone_verified_phone = ? AND phone = ?)
         OR EXISTS (SELECT 1 FROM bd_bonds WHERE RIGHT(regexp_replace(COALESCE(defendant_phone, ''), '[^0-9]', '', 'g'), 10) = ?
                     AND status IN (${OPEN_BONDS.map(() => '?').join(',')}))
         OR EXISTS (SELECT 1 FROM checkin_enrollments WHERE active = 1
                     AND RIGHT(regexp_replace(COALESCE(defendant_phone, ''), '[^0-9]', '', 'g'), 10) = ?) AS hit`,
    [e164, e164, ten, ...OPEN_BONDS, ten]);
  return r?.hit === true || Number(r?.hit) === 1;
}

const lineToday = () => todayInZone(process.env.PHONE_LINE_TIME_ZONE || 'America/Chicago');

/** Record what happened to a text on this call (a 'sent' already recorded is never overwritten). */
async function logText(db, callId, what) {
  await db.run(`UPDATE voice_calls SET texted = ? WHERE call_control_id = ? AND texted IS DISTINCT FROM 'sent'`, [what, callId]).catch(() => null);
}
async function logUpdate(db, callId, sets, vals) {
  await db.run(`UPDATE voice_calls SET ${sets} WHERE call_control_id = ?`, [...vals, callId]).catch(() => null);
}

/** Option 2: text the next court date to the number on file. → spoken result key. */
async function textCourtDate(db, callId, phone, cd, lang) {
  if (!smsLive()) { await logText(db, callId, 'skipped:sms_not_configured'); return 'text_unavailable'; }
  const to = toE164(phone);
  if (await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [to])) {
    await logText(db, callId, 'skipped:opted_out'); return 'text_blocked';
  }
  const h = hmac(to);
  const recent = await db.get(
    `SELECT 1 FROM voice_calls WHERE text_to_hash = ? AND texted = 'sent' AND started_at > NOW() - INTERVAL '1 hour' LIMIT 1`, [h]);
  if (recent) { await logText(db, callId, 'skipped:recent'); return 'text_wait'; }
  const body = fitSms(() => smsCourtDate(cd, lang), {}, [], { lang });
  const r = await sendSms({ to, body });
  if (!r?.ok) { await logText(db, callId, 'failed'); return 'text_failed'; }
  await logUpdate(db, callId, 'texted = ?, text_provider_id = ?, text_to_hash = ?', ['sent', r.id ? String(r.id).slice(0, 80) : null, h]);
  return 'texted';
}

/** Carry out menu choice `a` ('1' | '2') for the matched number. → the text to speak. */
async function doAction(db, callId, state, a) {
  const today = lineToday();
  const cd = await nextCourtDateForPhone(db, state.p, today);
  if (!cd) return say(state.l, state.m === 'keypad' ? 'not_found' : 'none');
  if (a === '1') { await logUpdate(db, callId, 'heard_date = TRUE', []); return spokenCourtDate(cd, state.l); }
  return say(state.l, await textCourtDate(db, callId, state.p, cd, state.l));
}

/**
 * Handle one verified Call Control event. → { handled, action } (for logs and tests).
 * `event` is the parsed webhook body ({ data: { event_type, payload } }).
 */
export async function handleVoiceEvent(db, event) {
  const type = event?.data?.event_type;
  const p = event?.data?.payload || {};
  const id = p.call_control_id;
  if (!type || !id) return { handled: false };
  const state = decodeState(p.client_state);
  state.l = voiceLang(state.l);

  if (type === 'call.initiated') {
    if (p.direction && p.direction !== 'incoming') return { handled: false };
    const line = toE164(process.env.TELNYX_VOICE_NUMBER);
    if (line && toE164(p.to) !== line) return { handled: false, action: 'other_number' };
    const caller = toE164(p.from);
    const h = caller ? hmac(caller) : null;
    const counts = h ? await db.get(
      `SELECT COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '1 hour')::int AS hour, COUNT(*)::int AS day
         FROM voice_calls WHERE caller_hash = ? AND started_at > NOW() - INTERVAL '1 day'`, [h]) : { hour: 0, day: 0 };
    const limited = counts.hour >= CALLS_PER_HOUR || counts.day >= CALLS_PER_DAY;
    await db.run(
      `INSERT INTO voice_calls (call_control_id, caller_hash, caller_last4, refused) VALUES (?, ?, ?, ?)
       ON CONFLICT (call_control_id) DO NOTHING`,
      [String(id).slice(0, 200), h, caller ? caller.slice(-4) : null, limited ? 'rate_limited' : null]);
    await callCommand(id, 'answer', { client_state: encodeState({ s: limited ? 'limited' : 'start', l: 'en' }) });
    return { handled: true, action: limited ? 'answer_limited' : 'answer' };
  }

  if (type === 'call.answered') {
    if (state.s === 'limited') { await speakThenHangUp(id, say('en', 'limited'), state); return { handled: true, action: 'limited' }; }
    await gather(id, languagePrompt(), { s: 'lang', l: 'en' }, { digits: '12', ssml: true });
    return { handled: true, action: 'language_menu' };
  }

  if (type === 'call.gather.ended') {
    const digits = String(p.digits || '').replace(/[^0-9]/g, '');
    const ok = p.status === 'valid';
    if (p.status === 'call_hangup') return { handled: true, action: 'caller_hung_up' };
    if (state.s === 'lang') {
      const l = ok && digits === '2' ? 'es' : 'en';   // no choice → English
      await logUpdate(db, id, 'lang = ?', [l]);
      const caller = toE164(p.from);
      const matched = !!caller && await phoneOnFile(db, caller);
      const next = { s: 'menu', l, p: matched ? caller : null, m: matched ? 'caller_id' : null, k: 0 };
      if (matched) await logUpdate(db, id, 'matched = ?', ['caller_id']);
      await gather(id, `${say(l, 'welcome')} ${say(l, 'menu')}`, next);
      return { handled: true, action: 'menu', matched: !!matched };
    }
    if (state.s === 'menu') {
      if (!ok) { await speakThenHangUp(id, say(state.l, 'goodbye'), state); return { handled: true, action: 'goodbye' }; }
      if (digits === '3') {
        await logUpdate(db, id, 'heard_missed = TRUE', []);
        await gather(id, `${spokenMissedGuidance(state.l)} ${say(state.l, 'menu')}`, state);
        return { handled: true, action: 'missed_guidance' };
      }
      if (digits === '1' || digits === '2') {
        if (!state.p) {
          await gather(id, say(state.l, 'enter_phone'), { ...state, s: 'phone', a: digits }, { digits: '0123456789', min: 10, max: 11 });
          return { handled: true, action: 'ask_phone' };
        }
        const said = await doAction(db, id, state, digits);
        await gather(id, `${said} ${say(state.l, 'menu')}`, state);
        return { handled: true, action: digits === '1' ? 'read_date' : 'text_date' };
      }
      await gather(id, `${say(state.l, 'invalid')} ${say(state.l, 'menu')}`, state);
      return { handled: true, action: 'invalid' };
    }
    if (state.s === 'phone') {
      const tries = Number(state.k || 0) + 1;
      const row = await db.get(
        `UPDATE voice_calls SET keypad_tries = keypad_tries + 1 WHERE call_control_id = ? RETURNING caller_hash`, [id]);
      const day = row?.caller_hash ? await db.get(
        `SELECT COALESCE(SUM(keypad_tries), 0)::int AS n FROM voice_calls WHERE caller_hash = ? AND started_at > NOW() - INTERVAL '1 day'`,
        [row.caller_hash]) : { n: tries };
      if (tries > KEYPAD_TRIES_PER_CALL || Number(day?.n || 0) > KEYPAD_TRIES_PER_DAY) {
        await speakThenHangUp(id, say(state.l, 'too_many_tries'), state);
        return { handled: true, action: 'keypad_limited' };
      }
      const entered = ok ? toE164(digits) : null;
      const next = { s: 'menu', l: state.l, p: null, m: null, k: tries };
      if (!entered || d10(entered).length !== 10) {
        await gather(id, `${say(state.l, 'not_found')} ${say(state.l, 'menu')}`, next);
        return { handled: true, action: 'keypad_not_found' };
      }
      const matched = await phoneOnFile(db, entered);
      if (!matched) {
        await gather(id, `${say(state.l, 'not_found')} ${say(state.l, 'menu')}`, next);
        return { handled: true, action: 'keypad_not_found' };
      }
      const found = { ...next, p: entered, m: 'keypad' };
      await logUpdate(db, id, 'matched = ?', ['keypad']);
      const said = await doAction(db, id, found, state.a === '2' ? '2' : '1');
      await gather(id, `${said} ${say(state.l, 'menu')}`, found);
      return { handled: true, action: state.a === '2' ? 'text_date' : 'read_date' };
    }
    return { handled: false };
  }

  if (type === 'call.speak.ended' && state.s === 'bye') {
    await callCommand(id, 'hangup', {});
    return { handled: true, action: 'hangup' };
  }

  if (type === 'call.hangup') {
    await logUpdate(db, id, 'ended_at = NOW(), matched = COALESCE(matched, ?)', ['none']);
    return { handled: true, action: 'logged' };
  }
  return { handled: false };
}
