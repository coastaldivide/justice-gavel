/**
 * Unit tests for migration 40's logic: the court-day plan, the transit data file, the phone line's
 * words, results periods, phone-verification codes.
 */
import { normalizePlan, planView, helpLinks, helpLinksForCourtName, PLAN_ITEMS } from '../services/courtDayHelp.js';
import { TRANSIT_AGENCIES, transitAgencyFor } from '../data/transit_agencies.js';
import { spokenDay, spokenTime, spokenCourtDate, smsCourtDate, languagePrompt, spokenMissedGuidance } from '../services/phoneLineText.js';
import { encodeState, decodeState, phoneLineEnabled, phoneLineNumber } from '../services/phoneLine.js';
import { periodFrom, METHODS_TEXT, MIN_ANSWERED } from '../services/results.js';
import { hashCode, newCode, maskPhone } from '../services/phoneVerification.js';
import { smsSegments, fitSms } from '../services/smsText.js';

describe('court-day plan', () => {
  test('items are whitelisted, notes cleaned and bounded', () => {
    expect(normalizePlan({ items: { ride: { done: true, note: '  Bus <52>\n at 8 ' } } })).toEqual({ ride: { done: true, note: 'Bus 52 at 8' } });
    expect(() => normalizePlan({ items: { bus: {} } })).toThrow('bad_plan');
    expect(() => normalizePlan({ items: { ride: { done: 'yes' } } })).toThrow('bad_plan');
    expect(() => normalizePlan({ items: [] })).toThrow('bad_plan');
    expect(() => normalizePlan({ items: { ride: { note: 'x'.repeat(201) } } })).toThrow('note_too_long');
    expect(planView(null).map((i) => i.id)).toEqual(PLAN_ITEMS);
    expect(planView({ documents: { done: true, note: null } }).find((i) => i.id === 'documents').done).toBe(true);
  });
  test('help links: 211 always, transit only with a cited row, directions from the courthouse', () => {
    const h = helpLinks({ county: 'Shelby County', state: 'TN', lat: 35.1, lng: -90.0 });
    expect(h.call_211).toEqual({ phone: '211', url: 'https://www.211.org' });
    expect(h.transit.agency).toMatch(/MATA/);
    expect(h.directions_url).toBe('https://www.google.com/maps/dir/?api=1&destination=35.1,-90');
    expect(helpLinks(null)).toMatchObject({ transit: null, directions_url: null, public_defender: null });
    expect(helpLinks({ county: 'Davidson', state: 'GA', address: 'x' }).transit).toBeNull();
    expect(helpLinksForCourtName({ court_name: 'Knox County Criminal Court', county: 'Knox', state: 'TN' }).directions_url).toContain('Knox%20County%20Criminal%20Court');
    expect(helpLinksForCourtName({}).directions_url).toBeNull();
  });
  test('every transit row names its source and the date it was checked', () => {
    expect(TRANSIT_AGENCIES.length).toBeGreaterThan(0);
    for (const a of TRANSIT_AGENCIES) {
      expect(a.state).toMatch(/^[A-Z]{2}$/);
      expect(a.url).toMatch(/^https?:\/\//);
      expect(a.source_url).toMatch(/^https:\/\//);
      expect(a.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(transitAgencyFor(`${a.county} County`, a.state.toLowerCase())).toBe(a);
    }
  });
});

describe('phone line words', () => {
  test('day and time in English and Spanish', () => {
    expect(spokenDay('2026-11-03', 'en')).toBe('Tuesday, November 3');
    expect(spokenDay('2026-11-03', 'es')).toMatch(/martes, 3 de noviembre/);
    expect(spokenTime('14:05', 'en')).toBe('2:05 PM');
    expect(spokenTime('09:00', 'es')).toBe('9:00 de la mañana');
    expect(spokenTime(null, 'en')).toBeNull();
  });
  test('only day, time, court and room are read; markup in names is neutralised', () => {
    const s = spokenCourtDate({ date: '2026-11-03', time: '09:30', court_name: 'A <b>Court</b>', room: '4B' }, 'en');
    expect(s).toBe('Your next court date is Tuesday, November 3, at 9:30 AM. A b Court /b. Room 4B. Please check with the court clerk if anything changes.');
    expect(spokenCourtDate({ date: '2026-11-03' }, 'es')).toMatch(/^Su próxima fecha de corte es el martes, 3 de noviembre\. Consulte/);
  });
  test('the text fits in 2 segments (English) and ends with STOP', () => {
    const t = fitSms(() => smsCourtDate({ date: '2026-09-30', time: '10:30', court_name: 'A.A. Birch Criminal Justice Building', room: 'Courtroom 6C' }, 'en'), {}, []);
    expect(smsSegments(t).segments).toBeLessThanOrEqual(2);
    expect(t).toMatch(/Reply STOP to opt out\.$/);
  });
  test('menu prompt has the Spanish option; missed-court guidance is the existing text', () => {
    expect(languagePrompt()).toMatch(/<lang xml:lang="es-US">.*Para español, oprima 2\.<\/lang><\/speak>$/);
    expect(spokenMissedGuidance('en')).toMatch(/Call your lawyer or the court clerk\.$/);
  });
  test('state round-trips; garbage decodes to {}; off unless TELNYX_VOICE_ENABLED is true', () => {
    expect(decodeState(encodeState({ s: 'menu', l: 'es' }))).toEqual({ s: 'menu', l: 'es' });
    expect(decodeState('%%%')).toEqual({});
    expect(phoneLineEnabled({})).toBe(false);
    expect(phoneLineEnabled({ TELNYX_VOICE_ENABLED: 'true' })).toBe(true);
    expect(phoneLineNumber({ TELNYX_VOICE_ENABLED: '1', TELNYX_VOICE_NUMBER: '(800) 555-0199' })).toBe('+18005550199');
    expect(phoneLineNumber({ TELNYX_VOICE_NUMBER: '8005550199' })).toBeNull();
  });
});

describe('results and verification codes', () => {
  test('periods: default last 90 days to yesterday; must be over and well-formed', () => {
    const now = new Date('2026-10-27T15:00:00Z');
    expect(periodFrom({}, now)).toEqual({ from: '2026-07-29', to: '2026-10-26' });
    expect(() => periodFrom({ to: '2026-10-27' }, now)).toThrow('period_not_over');
    expect(() => periodFrom({ from: '2026-02-30', to: '2026-03-01' }, now)).toThrow('bad_period');
    expect(() => periodFrom({ from: '2026-05-02', to: '2026-05-01' }, now)).toThrow('bad_period');
    expect(MIN_ANSWERED).toBe(100);
    expect(METHODS_TEXT).toMatch(/self-reported/);
    expect(METHODS_TEXT).toMatch(/not a controlled study/);
  });
  test('codes are 6 digits; the stored hash depends on account, number and code', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-secret';
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
    const h = hashCode(1, '+16155550100', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode(2, '+16155550100', '123456')).not.toBe(h);
    expect(hashCode(1, '+16155550101', '123456')).not.toBe(h);
    expect(maskPhone('+16155550100')).toBe('•••-•••-0100');
  });
});
