/**
 * core_path_units.test.js — the pure parts of the "Just arrested?" core path
 * (no database): rights content rules, provider hours / ranking, the .ics
 * builder, SMS configuration fallback, court-day guidance.
 */
import { readFileSync } from 'fs';
import http from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  GENERAL_SECTIONS, SCRIPT, STATE_RIGHTS, STATE_NAMES, getRightsCard, buildLegacyRightsCard,
  rightsPromptBlock, rightsRefsFor, normalizeState, isReviewedStateSection, unreviewedStateNotes, reviewPendingNotice,
} from '../services/rightsContent.js';
import { parseHours, isOpenNow, is24x7, completeness, rankProviders } from '../services/providerHours.js';
import { buildCourtDateIcs, foldLine, escapeIcsText, vtimezoneLines } from '../services/ics.js';
import { sendSms, smsLive, toE164 } from '../services/sms.js';
import { courtDayGuidance, CALL_LAWYER_OR_CLERK } from '../services/courtDayGuidance.js';
import { SUPPORTED_LANGS } from '../i18n/index.js';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

describe('rights content', () => {
  const en = JSON.parse(readFileSync(resolve(REPO, 'frontend/src/i18n/en.json'), 'utf8'));

  it('the server card is word-for-word the app\'s bundled English card (no drift)', () => {
    expect(GENERAL_SECTIONS).toHaveLength(8);
    GENERAL_SECTIONS.forEach((s, i) => {
      expect(s.key).toBe(`rc_${i + 1}`);
      expect(s.heading).toBe(en[`rc_h${i + 1}`]);
      expect(s.body).toBe(en[`rc_b${i + 1}`]);
    });
  });

  it('every section carries a source and the recorded review date; none claims a lawyer review', () => {
    for (const s of GENERAL_SECTIONS) {
      expect(s.source).toEqual(expect.any(String));
      expect(s.last_reviewed).toBe('2026-04');
      expect(s.lawyer_reviewed).toBe(false);
    }
    expect(SCRIPT.source).toEqual(expect.any(String));
  });

  it('no unsourced bail-fee estimate anywhere in the card or its translations', () => {
    for (const lang of SUPPORTED_LANGS) {
      const j = JSON.parse(readFileSync(resolve(REPO, `frontend/src/i18n/${lang}.json`), 'utf8'));
      for (let i = 1; i <= 8; i++) expect(j[`rc_b${i}`]).not.toMatch(/10\s?%/);
    }
    expect(JSON.stringify(GENERAL_SECTIONS)).not.toMatch(/10\s?%/);
    expect(JSON.stringify(buildLegacyRightsCard('TN'))).not.toMatch(/10\s?%/);
  });

  it('every script line is lifted from the card (or the Just Arrested jail-call guidance)', () => {
    const cardText = GENERAL_SECTIONS.map(s => s.body).join(' ');
    for (const l of SCRIPT.say) expect(cardText).toContain(l.text.replace(/\.$/, ''));
    for (const l of [...SCRIPT.say, ...SCRIPT.dont]) expect(['rc_1', 'rc_2', 'rc_3', 'rc_4', 'rc_5', 'rc_6', 'just_arrested']).toContain(l.from);
  });

  it('the app\'s bundled script and guidance are the same text as the server\'s (no drift)', () => {
    for (const l of [...SCRIPT.say, ...SCRIPT.dont]) expect(en[l.key]).toBe(l.text);
    // The bundled copies live in the app's i18n files (all four languages are
    // checked in i18n_server_content.test.js).
    const g = courtDayGuidance();
    expect([...g.checklist.bring, ...g.checklist.wear, ...g.missed.steps].map(s => s.text))
      .toEqual([en.cg_bring_1, en.cg_bring_2, en.cg_bring_3, en.cg_wear_1, en.cg_missed_1, en.cg_missed_2, en.cg_missed_3, en.cg_missed_4]);
    expect(en.rc_script_source).toBe(SCRIPT.source);
  });

  it('every state code has a name; the built-in state notes are kept but never shown (no citation, no reviewer)', async () => {
    expect(Object.keys(STATE_RIGHTS)).toHaveLength(51);      // draft data stays in the repo
    for (const code of Object.keys(STATE_RIGHTS)) {
      expect(STATE_NAMES[code]).toEqual(expect.any(String));
      for (const s of unreviewedStateNotes(code)) expect(isReviewedStateSection(s)).toBe(false);
      const card = await getRightsCard(null, code);
      expect(card.state_specific).toEqual([]);
      expect(card.state_specific_available).toBe(false);
      expect(card.state_notice).toBe(reviewPendingNotice(STATE_NAMES[code]));
      expect(JSON.stringify(card)).not.toContain(STATE_RIGHTS[code].stopRule);
      expect(JSON.stringify(card)).not.toContain(STATE_RIGHTS[code].bailNote);
    }
    const tn = await getRightsCard(null, 'tn');
    expect(tn.state_notice).toBe("State-specific details for Tennessee haven't been reviewed yet — ask a local lawyer or public defender.");
    const gu = await getRightsCard(null, 'gu');
    expect(gu.state_notice).toBe(reviewPendingNotice('Guam'));
    expect(gu.general).toHaveLength(8);
    const none = await getRightsCard(null, '');
    expect(none.state).toBe('US');
    expect(none.state_notice).toMatch(/Choose your state/);
    expect(normalizeState(' ca ')).toBe('CA');
    expect(normalizeState('XX')).toBeNull();
  });

  it('only a cited (URL / statute cite) or reviewed state section qualifies', () => {
    const generic = 'Published state statutes and case law (Justice Gavel state summary, as recorded April 2026; no specific citation recorded)';
    expect(isReviewedStateSection({ source: generic })).toBe(false);
    expect(isReviewedStateSection({ source: generic, source_url: 'https://law.example/tca' })).toBe(true);
    expect(isReviewedStateSection({ source: generic, reviewed_by: 'A. Lawyer, Esq.' })).toBe(true);
    expect(isReviewedStateSection({ source: 'Tenn. Code Ann. § 40-7-123' })).toBe(true);
    expect(isReviewedStateSection({ source: 'Tex. Penal Code 38.02' })).toBe(true);
    expect(isReviewedStateSection({ source: 'Justice Gavel rights card — April 2026' })).toBe(false);
  });

  it('a database row that is cited shows; an uncited one does not; a DB failure falls back to general only', async () => {
    const rows = [
      { topic: 'stop_identify', title: 'IF STOPPED — TEXAS', content: 'cited text', state: 'TX', source: 'Tex. Penal Code § 38.02', source_url: null, content_verified_at: '2026-09-01', reviewed_by: null },
      { topic: 'state_bail', title: 'BAIL — TEXAS', content: 'uncited text', state: 'TX', source: 'Published state statutes and case law', source_url: null, content_verified_at: null, reviewed_by: null },
    ];
    const c = await getRightsCard({ all: async () => rows }, 'TX');
    expect(c.state_specific.map(s => s.body)).toEqual(['cited text']);
    expect(c.state_notice).toBeNull();
    const broken = { all: async () => { throw new Error('db down'); } };
    const b = await getRightsCard(broken, 'TX');
    expect(b.general).toHaveLength(8);
    expect(b.state_specific).toEqual([]);
    expect(b.state_notice).toBe(reviewPendingNotice('Texas'));
  });

  it('AI grounding: general card only — never the unreviewed state notes; "say you are not sure" rule; refs link back', () => {
    const p = rightsPromptBlock('CA');
    expect(p).toContain('(rc_1) 1. RIGHT TO REMAIN SILENT');
    for (const code of Object.keys(STATE_RIGHTS)) {
      const q = rightsPromptBlock(code);
      expect(q).not.toContain(STATE_RIGHTS[code].stopRule);
      expect(q).not.toContain(STATE_RIGHTS[code].bailNote);
    }
    expect(p).toMatch(/No reviewed state-specific rights content exists yet for California/);
    expect(p).toMatch(/talk to a lawyer or public defender — do not guess/);
    const legacy = buildLegacyRightsCard('TX');
    expect(JSON.stringify(legacy)).not.toContain(STATE_RIGHTS.TX.stopRule);
    expect(legacy.mustID).toBeNull();
    expect(legacy.state_notice).toBe(reviewPendingNotice('Texas'));
    const refs = rightsRefsFor('Can the police search my car?', 'No (see your rights card: rc_3).');
    expect(refs.map(r => r.key)).toContain('rc_3');
    expect(refs[0]).toEqual(expect.objectContaining({ heading: expect.any(String), source: expect.any(String), last_reviewed: '2026-04' }));
    expect(rightsRefsFor('what is the weather')).toEqual([]);
  });
});

describe('provider hours and ranking', () => {
  const WEEKDAY = 'Monday: 8:00 AM – 12:00 PM, 1:00 – 5:00 PM | Tuesday: 8:00 AM – 12:00 PM, 1:00 – 5:00 PM | Wednesday: 8:00 AM – 12:00 PM, 1:00 – 5:00 PM | Thursday: 8:00 AM – 12:00 PM, 1:00 – 5:00 PM | Friday: 8:00 AM – 12:00 PM, 1:00 – 5:00 PM | Saturday: Closed | Sunday: Closed';
  const ALL24 = 'Monday: Open 24 hours | Tuesday: Open 24 hours | Wednesday: Open 24 hours | Thursday: Open 24 hours | Friday: Open 24 hours | Saturday: Open 24 hours | Sunday: Open 24 hours';
  const LATE = 'Monday: 6:00 PM – 2:00 AM | Tuesday: Closed | Wednesday: Closed | Thursday: Closed | Friday: Closed | Saturday: Closed | Sunday: Closed';

  it('parses Google weekday text, incl. the omitted start meridiem ("1:00 – 5:00 PM")', () => {
    const p = parseHours(WEEKDAY);
    expect(p.days.monday).toEqual([[480, 720], [780, 1020]]);
    expect(p.days.saturday).toBe('closed');
    expect(p.all24).toBe(false);
    expect(is24x7(ALL24)).toBe(true);
    expect(is24x7(WEEKDAY)).toBe(false);
  });

  it('unknown or partial hours are "unknown", never "open"', () => {
    expect(parseHours('')).toBeNull();
    expect(parseHours('Mon-Fri 9-5')).toBeNull();
    expect(parseHours('Monday: 9:00 AM – 5:00 PM')).toBeNull();     // only one day listed
    expect(isOpenNow(null, 'TN', new Date())).toBeNull();
  });

  it('open now is evaluated in the provider\'s state zone (Nashville = Central)', () => {
    // Monday 2026-10-19 10:00 CDT = 15:00Z → open; 12:30 CDT lunch → closed; Saturday → closed
    expect(isOpenNow(WEEKDAY, 'TN', new Date('2026-10-19T15:00:00Z'))).toBe(true);
    expect(isOpenNow(WEEKDAY, 'TN', new Date('2026-10-19T17:30:00Z'))).toBe(false);
    expect(isOpenNow(WEEKDAY, 'TN', new Date('2026-10-24T15:00:00Z'))).toBe(false);
    // 10:00 UTC Monday = 05:00 Central (closed) but 06:00 Eastern — still closed; 13:30Z = 09:30 Eastern open in NY
    expect(isOpenNow(WEEKDAY, 'NY', new Date('2026-10-19T13:30:00Z'))).toBe(true);
    expect(isOpenNow(WEEKDAY, 'TN', new Date('2026-10-19T13:30:00Z'))).toBe(true);   // 08:30 Central
    expect(isOpenNow(WEEKDAY, 'CA', new Date('2026-10-19T13:30:00Z'))).toBe(false);  // 06:30 Pacific
    expect(isOpenNow(ALL24, 'TN', new Date('2026-10-25T08:00:00Z'))).toBe(true);
  });

  it('a range past midnight counts on the next morning', () => {
    // Tuesday 2026-10-20 01:30 Central = 06:30Z → still Monday's 6 PM – 2 AM shift
    expect(isOpenNow(LATE, 'TN', new Date('2026-10-20T06:30:00Z'))).toBe(true);
    expect(isOpenNow(LATE, 'TN', new Date('2026-10-20T08:30:00Z'))).toBe(false);
  });

  it('completeness counts a real phone (not a 555 number), hours, website and address', () => {
    expect(completeness({ phone: '(615) 254-1010', hours: WEEKDAY, website: 'https://x.test', address: '1 Main St, Nashville' })).toBe(4);
    expect(completeness({ phone: '615-555-0100', hours: 'n/a', website: 'x.test', address: '' })).toBe(0);
  });

  it('ranking = distance bucket, then completeness — paid / promoted flags are ignored', () => {
    const list = [
      { id: 1, distance_km: 1.0, completeness: 1, golden_gavel: 1, sort_priority: 999, subscription_tier: 'enterprise' },
      { id: 2, distance_km: 3.9, completeness: 4 },
      { id: 3, distance_km: 12, completeness: 4, golden_gavel: 1 },
      { id: 4, distance_km: null, completeness: 4 },
    ];
    expect(rankProviders(list).map(p => p.id)).toEqual([2, 1, 3, 4]);
    const flipped = list.map(p => ({ ...p, golden_gavel: p.golden_gavel ? 0 : 1, sort_priority: 0 }));
    expect(rankProviders(flipped).map(p => p.id)).toEqual([2, 1, 3, 4]);
  });
});

describe('.ics court date', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('all-day event when no time is stored (the day never shifts)', () => {
    const t = buildCourtDateIcs({ uid: 'u1', courtDate: '2026-12-31', summary: 'Court: A', now });
    expect(t).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    expect(t).not.toContain('TZID');
    expect(t).toContain('DTSTAMP:20261018T120000Z');
    expect(t.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('timed event uses the zone with a VTIMEZONE that has the real DST rules', () => {
    const t = buildCourtDateIcs({ uid: 'u2', courtDate: '2026-11-05', courtTime: '09:30', tz: 'America/New_York', summary: 'Court', now });
    expect(t).toContain('DTSTART;TZID=America/New_York:20261105T093000');
    expect(t).toContain('BEGIN:STANDARD\r\nDTSTART:20261101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500');
    expect(t).toContain('BEGIN:DAYLIGHT\r\nDTSTART:20260308T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400');
    expect(t).toContain('TRIGGER:-PT2H');
    expect(vtimezoneLines('America/Phoenix', 2026)).toEqual(['BEGIN:VTIMEZONE', 'TZID:America/Phoenix', 'BEGIN:STANDARD',
      'DTSTART:19700101T000000', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0700', 'END:STANDARD', 'END:VTIMEZONE']);
  });

  it('a late-evening hearing ends on the next day; text is escaped and lines folded', () => {
    const t = buildCourtDateIcs({ uid: 'u3', courtDate: '2026-03-01', courtTime: '23:30', tz: 'America/Chicago', summary: 'A; B, C\nD', location: 'x'.repeat(200), now });
    expect(t).toContain('DTEND;TZID=America/Chicago:20260302T003000');
    expect(t).toContain('SUMMARY:A\\; B\\, C\\nD');
    expect(t.split('\r\n').every(l => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(escapeIcsText('a\\b')).toBe('a\\\\b');
    expect(foldLine('é'.repeat(60)).split('\r\n').every(l => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(() => buildCourtDateIcs({ uid: 'x', courtDate: '2026-02-30' })).toThrow();
  });
});

describe('SMS (Telnyx) — optional', () => {
  const keys = ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_MESSAGING_PROFILE_ID', 'TELNYX_API_BASE'];
  afterEach(() => keys.forEach(k => delete process.env[k]));

  it('not configured → skipped cleanly (no throw, no request)', async () => {
    keys.forEach(k => delete process.env[k]);
    expect(smsLive()).toBe(false);
    await expect(sendSms({ to: '6155550100', body: 'x' })).resolves.toEqual({ skipped: true, reason: 'sms_not_configured' });
  });

  it('numbers are normalised to E.164', () => {
    expect(toE164('(615) 555-0142')).toBe('+16155550142');
    expect(toE164('1-615-555-0142')).toBe('+16155550142');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('12345')).toBeNull();
  });

  it('configured → one POST /messages with Bearer key and JSON body; a refusal is reported, not thrown', async () => {
    const got = [];
    let status = 200;
    const srv = http.createServer((req, res) => {
      let d = ''; req.on('data', c => { d += c; });
      req.on('end', () => {
        got.push({ url: req.url, method: req.method, auth: req.headers.authorization, type: req.headers['content-type'], json: JSON.parse(d || '{}') });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status === 200 ? { data: { id: 'msg-1' } } : { errors: [{ code: '40310', title: 'Invalid to number' }] }));
      });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    Object.assign(process.env, { TELNYX_API_KEY: 'KEY1', TELNYX_FROM_NUMBER: '(615) 555-0000', TELNYX_MESSAGING_PROFILE_ID: 'mp-1', TELNYX_API_BASE: `http://127.0.0.1:${srv.address().port}` });
    try {
      expect(smsLive()).toBe(true);
      await expect(sendSms({ to: '615 555 0142', body: 'Court tomorrow' })).resolves.toEqual({ ok: true, id: 'msg-1' });
      expect(got[0]).toMatchObject({ url: '/messages', method: 'POST', auth: 'Bearer KEY1', type: 'application/json' });
      expect(got[0].json).toEqual({ from: '+16155550000', to: '+16155550142', text: 'Court tomorrow', messaging_profile_id: 'mp-1' });
      status = 422;
      await expect(sendSms({ to: '615 555 0142', body: 'x' })).resolves.toEqual({ ok: false, error: 'telnyx_422_40310' });
      await expect(sendSms({ to: 'nope', body: 'x' })).resolves.toEqual({ skipped: true, reason: 'no_valid_number' });
    } finally { await new Promise(r => srv.close(r)); }
  });
});

describe('court-day guidance', () => {
  it('missed-date guidance is generic, sourced, and always ends with "call your lawyer or the court clerk"', () => {
    const g = courtDayGuidance();
    expect(g.missed.steps.at(-1).text).toBe(CALL_LAWYER_OR_CLERK);
    expect(CALL_LAWYER_OR_CLERK).toBe('Call your lawyer or the court clerk.');
    for (const s of [...g.missed.steps, ...g.checklist.bring, ...g.checklist.wear]) expect(s.source).toMatch(/^Justice Gavel/);
    expect(JSON.stringify(g)).not.toMatch(/\b\d+\s*(days?|hours?)\b/);   // no invented deadlines
    expect(g.missed.lawyer_reviewed).toBe(false);
  });
});
