/**
 * court_reminder_wording.test.js — the court texts (build plan A1, A6, A7):
 *   - every text, in en / es / pt / vi, with realistic long values AND the longest values the
 *     forms accept, fits in 2 segments of its encoding (GSM-7: 306 characters; UCS-2: 134)
 *     and still ends with the opt-out line;
 *   - the wording says what can happen (a warrant can be issued; for bonds, the bond can be
 *     forfeited), what to expect (security, ID and papers) and asks for a plan — and states no
 *     statistic;
 *   - replies 1 / 2 / 3 are parsed strictly; zones follow the bond's county; the plan's times.
 */
import { smsSegments, toGsm, fitSms } from '../services/smsText.js';
import { bondCourtText, bondReplyText, parseCourtReply, bondTimeZone } from '../services/bondDesk/courtDates.js';
import { courtSmsText } from '../services/reminderDispatcher.js';
import { bodyFor, followerBodyFor, planSteps, missedCourtLink } from '../services/courtReminders.js';
import { countyTimeZone } from '../utils/timezone.js';
import { CATALOGS, msg } from '../i18n/index.js';

const LANGS = ['en', 'es', 'pt', 'vi'];
const STOP = { en: 'Reply STOP to opt out.', es: 'Responda STOP para cancelar.', pt: 'Responda STOP para cancelar.', vi: 'Tra loi STOP de ngung nhan tin.' };
const fits = (t) => {
  const s = smsSegments(t);
  expect(s.segments).toBeLessThanOrEqual(2);
  if (s.encoding === 'UCS-2') expect(s.units).toBeLessThanOrEqual(134);
  else expect(s.units).toBeLessThanOrEqual(306);
  return s;
};

describe('segments and the GSM-7 alphabet', () => {
  test('segment arithmetic', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM-7', units: 160, segments: 1 });
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
    expect(smsSegments('€'.repeat(10)).units).toBe(20);          // extension table: 2 septets each
    expect(smsSegments('á'.repeat(70))).toEqual({ encoding: 'UCS-2', units: 70, segments: 1 });
    expect(smsSegments('á'.repeat(71)).segments).toBe(2);
    expect(smsSegments('á'.repeat(134)).segments).toBe(2);
    expect(smsSegments('á'.repeat(135)).segments).toBe(3);
  });
  test('toGsm keeps GSM letters and writes the rest plainly', () => {
    expect(toGsm('José Peña — “Müller” ‘ok’ …')).toBe('José Peña - "Müller" \'ok\' ...');
    expect(toGsm('audiência amanhã às 9h, ação')).toBe('audiencia amanha às 9h, acao');
    expect(toGsm('Đã đến tòa, giấy tờ tùy thân')).toBe('Da den tòa, giay to tùy than');
    expect(smsSegments(toGsm('¿Llegó a la corte? Sí, mañana — día 30')).encoding).toBe('GSM-7');
  });
  test('fitSms shortens the named fields in order and never below their minimum', () => {
    const t = fitSms((f) => `${f.a} | ${f.b} | ${'x'.repeat(250)}`, { a: 'alpha '.repeat(20), b: 'beta '.repeat(20) }, [['a', 10], ['b', 12]]);
    expect(smsSegments(t).segments).toBeLessThanOrEqual(2);
    expect(t.startsWith('alpha')).toBe(true);
  });
});

// Realistic long values, and the longest each field accepts (bonds.js: name 160, court 160, room 60; agency 160).
const REAL = { agency: 'Second Chance Bail Bonds of Nashville', agencyPhone: '(615) 555-0199', defendant: 'Maximiliano Rodríguez-Hernández',
  courtName: 'Davidson County General Sessions Court, A. A. Birch Bldg', room: '6A', courtDate: '2026-09-30', courtTime: '10:30' };
const W = (n) => 'Bartholomew '.repeat(20).slice(0, n);
const MAX = { agency: W(160), agencyPhone: '+1 (615) 555-0199 ext. 12345', defendant: W(160), courtName: W(160), room: 'R'.repeat(60),
  courtDate: '2026-09-30', courtTime: '10:30' };

describe('Bond Desk texts fit in 2 segments in every language', () => {
  for (const lang of LANGS) {
    for (const [label, v] of [['realistic', REAL], ['longest', MAX]]) {
      test(`${lang} ${label}`, () => {
        for (const step of ['d7', 'd3', 'd1', 'd0', 'now', 'ask', 'missed']) {
          for (const signerType of ['defendant', 'indemnitor']) {
            const daysLeft = { d7: 7, d3: 3, d1: 1 }[step] ?? 0;
            const t = bondCourtText(step, { ...v, lang, signerType, daysLeft });
            fits(t);
            expect(t.endsWith(STOP[lang])).toBe(true);
          }
        }
        for (const a of ['attended', 'rescheduled', 'missed', 'noted']) fits(bondReplyText(a, { lang, agency: v.agency, defendant: v.defendant, courtDate: v.courtDate }));
      });
    }
  }
});

/** A fake db answering the dispatcher's lookups for one hearing. */
const fakeDb = (v) => ({
  get: async (sql) => {
    if (/FROM court_dates cd JOIN cases/.test(sql)) return { id: 1, court_date: v.courtDate, court_time: v.courtTime, courthouse_id: 7, location: null, title: v.caseTitle, user_id: 3 };
    if (/FROM courthouses/.test(sql)) return { name: v.courtName, address: v.address };
    if (/FROM users/.test(sql)) return { display_name: v.owner, name: v.owner };
    return null;
  },
});
const APP_REAL = { courtDate: '2026-09-30', courtTime: '10:30', caseTitle: 'DUI and reckless driving — Davidson County', courtName: 'Justice A. A. Birch Building',
  address: '408 2nd Ave N, Nashville, TN 37201', owner: 'Maximiliano Rodríguez' };
const APP_MAX = { ...APP_REAL, caseTitle: W(300), courtName: W(200), address: W(200), owner: W(120) };

describe('app users\' texts fit in 2 segments in every language', () => {
  for (const lang of LANGS) {
    for (const [label, v] of [['realistic', APP_REAL], ['longest', APP_MAX]]) {
      test(`${lang} ${label}`, async () => {
        const db = fakeDb(v);
        for (const type of ['court_reminder', 'follower_court_reminder']) {
          for (const days of [7, 3, 1, 0]) {
            const t = await courtSmsText(db, { notification_type: type, court_date_id: 1 }, { days_before: days }, lang);
            fits(t);
            expect(t.endsWith(STOP[lang])).toBe(true);
            expect(t.startsWith('Justice Gavel: ')).toBe(true);
          }
        }
        for (const type of ['court_checkin', 'court_missed_followup']) {
          const t = await courtSmsText(db, { notification_type: type, court_date_id: 1 }, {}, lang);
          fits(t);
          expect(t.endsWith(STOP[lang])).toBe(true);
        }
        for (const k of ['attended', 'rescheduled', 'missed', 'noted']) {
          fits(fitSms(() => msg(lang, `reminder.reply.${k}`, { day: 'Wednesday, September 30', link: missedCourtLink(lang) }), {}, []));
        }
      });
    }
  }
});

describe('what the texts say', () => {
  const WARRANT = { en: 'a warrant can be issued', es: 'pueden emitir una orden de arresto', pt: 'pode ser emitido um mandado de prisão', vi: 'tòa có thể ra lệnh bắt' };
  const FORFEIT = { en: 'can be forfeited', es: 'puede ser confiscada', pt: 'pode ser perdida', vi: 'có thể bị tịch thu' };
  const NEW_KEYS = (lang) => Object.entries(CATALOGS[lang]).filter(([k]) => /^(reminder\.(body|follower\.body|sms|ask|missed|reply)|bd\.sms\.(court|reply|when|at_court|room|agent_phone|your_agent)|bd\.alert\.)/.test(k));

  test.each(LANGS)('%s: reminders give the consequence, what to expect and a plan prompt', (lang) => {
    for (const days of [7, 1, 0]) {
      const b = bodyFor('Case', '2026-09-30', days, { time: '09:30', place: 'Court' }, lang);
      expect(b).toContain(WARRANT[lang]);
      expect(b).toMatch({ en: /security line.*ID.*court papers|ID.*court papers/s, es: /control de seguridad.*identificación/s, pt: /fila de segurança.*identidade/s, vi: /kiểm tra an ninh.*giấy tờ tùy thân/s }[lang]);
      expect(b).toMatch({ en: /How (will you get|are you getting) there\?/, es: /¿Cómo va a llegar\?/, pt: /Como você vai chegar\?/, vi: /bằng cách nào\?/ }[lang]);
      expect(followerBodyFor('Ana', '2026-09-30', days, {}, lang)).toContain(WARRANT[lang]);
    }
    for (const k of ['bd.sms.court_defendant', 'bd.sms.court_indemnitor']) {
      expect(msg(lang, k)).toContain(WARRANT[lang]);
      expect(msg(lang, k)).toContain(FORFEIT[lang]);
    }
    expect(msg(lang, 'reminder.missed.sms')).toContain('{link}');
    expect(msg(lang, 'bd.sms.court_missed')).toContain('{link}');
  });

  test('the indemnitor text says why they get it', () => {
    expect(msg('en', 'bd.sms.court_indemnitor')).toMatch(/^\{agency\}: You co-signed \{name\}'s bail bond\./);
    expect(msg('es', 'bd.sms.court_indemnitor')).toMatch(/fiador de la fianza de \{name\}/);
    expect(msg('pt', 'bd.sms.court_indemnitor')).toMatch(/fiador da fiança de \{name\}/);
    expect(msg('vi', 'bd.sms.court_indemnitor')).toMatch(/đồng ký bảo lãnh cho \{name\}/);
  });

  test.each(LANGS)('%s: no statistic and no legal claim beyond "a warrant can be issued" / "the bond can be forfeited"', (lang) => {
    for (const [k, v] of NEW_KEYS(lang)) {
      expect([k, /\d+\s*%|percent|por ciento|por cento|phần trăm/i.test(v)]).toEqual([k, false]);
      expect([k, /\b(will be arrested|will be forfeited|must pay|jail time|fine of)\b/i.test(v)]).toEqual([k, false]);
    }
  });

  test('the morning-after and "Did you make it?" texts in English', () => {
    expect(bondCourtText('ask', { ...REAL, lang: 'en' })).toBe('Second Chance Bail Bonds of Nashville: Maximiliano, did you make it to court today? Reply 1 = I went, 2 = it was rescheduled, 3 = I missed it. Reply STOP to opt out.');
    expect(bondCourtText('missed', { ...REAL, lang: 'en' })).toBe('Second Chance Bail Bonds of Nashville: Maximiliano, if you missed court on Wed, Sep 30, act today: call the court clerk, your lawyer, or your bail agent at (615) 555-0199. What to do: https://justicegavel.app/missed-court Reply STOP to opt out.');
  });
});

describe('replies, zones, plan', () => {
  test('only 1 / 2 / 3 count', () => {
    expect(['1', ' 2 ', '3.', '3!', '\n1\n'].map(parseCourtReply)).toEqual(['attended', 'rescheduled', 'missed', 'missed', 'attended']);
    for (const t of ['', '4', '12', '1 2', 'yes', 'STOP', 'one', '1st', null, undefined]) expect(parseCourtReply(t)).toBeNull();
  });
  test('the bond zone follows the county, then the state, then the agent', () => {
    expect(countyTimeZone('TN', 'Knox County')).toBe('America/New_York');
    expect(countyTimeZone('TN', 'Davidson')).toBeNull();
    expect(countyTimeZone('FL', 'escambia')).toBe('America/Chicago');
    expect(countyTimeZone('TX', 'El Paso County')).toBe('America/Denver');
    expect(bondTimeZone({ state: 'TN', county: 'Knox' })).toBe('America/New_York');
    expect(bondTimeZone({ state: 'TN', county: 'Davidson' })).toBe('America/Chicago');
    expect(bondTimeZone({ state: null, county: null }, 'America/Phoenix')).toBe('America/Phoenix');
    expect(bondTimeZone({}, 'Not/AZone')).toBe('America/Chicago');
  });
  test.each([['America/New_York'], ['America/Los_Angeles'], ['America/Denver'], ['Pacific/Honolulu']])('plan steps at local wall-clock times in %s', (tz) => {
    const local = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    const steps = planSteps('2026-11-12', tz, new Date('2026-10-27T12:00:00Z'));
    expect(steps.map((s) => [s.days, local(s.at)])).toEqual([[7, '11-05, 09:00'], [3, '11-09, 09:00'], [1, '11-11, 18:00'], [0, '11-12, 06:30']]);
    const late = planSteps('2026-11-12', tz, new Date('2026-11-13T00:00:00Z'));
    expect(late).toHaveLength(1);
    expect(late[0].immediate).toBe(true);
    expect(planSteps('2026-11-01', tz, new Date('2026-11-12T12:00:00Z'))).toEqual([]);
  });
});
