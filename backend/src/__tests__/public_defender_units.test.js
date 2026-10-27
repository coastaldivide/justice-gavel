/**
 * public_defender_units.test.js — the pure parts of the public defender channel (A11): text wording
 * and length in every language, the CSV checks (per-row errors, de-duplication, 5,000-row limit),
 * court-date parsing, which inbound texts reach the inbox, prices from the settings, the ⚖ setting
 * and the consent-basis wording shared with the app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pdCourtText, pdReplyText, isInboxText } from '../services/publicDefender/texts.js';
import { checkCsv, parseCourtDates, parseLang, parseDay, parseTime, MAX_ROWS, templateCsv } from '../services/publicDefender/clients.js';
import { pdPrices, officeTimeZone, CONSENT_BASIS_TEXT } from '../services/publicDefender/common.js';
import { invoiceYear } from '../services/publicDefender/billing.js';
import { counselFlagOn, COUNSEL_FLAGS, publicDefenderEnabled } from '../utils/counselFlags.js';
import { smsSegments, MAX_UNICODE_SEGMENTS, MAX_GSM_SEGMENTS_OTHER } from '../services/smsText.js';
import { envReport } from '../../scripts/lib/envReport.mjs';
import { SUPPORTED_LANGS } from '../i18n/index.js';

const LANGS = SUPPORTED_LANGS;
const REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname);
const LONG = {
  office: 'Metropolitan Nashville and Davidson County Public Defender Community Law Office', officePhone: '+16155550190',
  client: 'Maria Guadalupe Hernandez-Villanueva', courtDate: '2026-11-03', courtTime: '09:30',
  courtName: 'Davidson County General Sessions Court Criminal Division Courtroom', room: '2A-North-Annex',
};

describe('client texts (A11 step 3)', () => {
  test.each(LANGS)('%s: every step names the office first, ends with STOP and stays within the segment limit', (lang) => {
    for (const [step, daysLeft] of [['d7', 7], ['d3', 3], ['d1', 1], ['d0', 0], ['now', 2], ['ask', 0], ['missed', -1]]) {
      const t = pdCourtText(step, { ...LONG, lang, daysLeft });
      const seg = smsSegments(t);
      expect(seg.segments).toBeLessThanOrEqual(seg.encoding === 'GSM-7' ? (lang === 'en' ? 2 : MAX_GSM_SEGMENTS_OTHER) : MAX_UNICODE_SEGMENTS);
      expect(t).toMatch(/STOP[^]{0,60}$/);   // the opt-out line is never cut off
      if (lang === 'en') expect(seg.encoding).toBe('GSM-7');
      expect(t).toMatch(/^Metropolitan/);
      expect(t).toMatch(/STOP/);
    }
  });
  test('the reminder warns about a warrant, prompts a plan and invites a reply; nothing about bail', () => {
    const t = pdCourtText('d1', { ...LONG, lang: 'en', office: 'Knox County PD', courtName: 'Sessions', daysLeft: 1 });
    expect(t).toBe('Knox County PD: Maria, court is tomorrow, Tue, Nov 3 at 9:30 AM at Sessions, room 2A-North-Ann. If you miss it, a warrant can be issued. Expect security; bring ID and court papers. How will you get there? Make a plan now. Questions? Reply here. Reply STOP to opt out.');
    expect(t).not.toMatch(/bond|bail/i);
  });
  test('the missed text links the missed-court guide in the client\'s language and gives the office phone', () => {
    expect(pdCourtText('missed', { ...LONG, lang: 'pt', office: 'PD' })).toMatch(/defensor público no \+16155550190 .*\/missed-court\/pt/);
    expect(pdReplyText('missed', { lang: 'en', office: 'PD', client: 'Al', courtDate: '2026-11-03', officePhone: '+16155550190' }))
      .toMatch(/^PD: Court on Tue, Nov 3 is marked as missed\. Act today: call your public defender at \+16155550190/);
    expect(pdReplyText('weird', { lang: 'vi', office: 'PD', client: 'Al', courtDate: '2026-11-03' })).toBe('PD: Cảm ơn Al. Chúng tôi đã nhận câu trả lời của bạn.');
  });
  test('without an office name the texts say "Your public defender"', () => {
    expect(pdCourtText('ask', { lang: 'es', client: 'Ana' })).toMatch(/^Su defensor público: Ana, ¿llegó a la corte hoy\?/);
  });
});

describe('inbound texts (A11 step 4)', () => {
  test('STOP / START / HELP / 1 / 2 / 3 never reach the inbox; anything else does', () => {
    for (const t of ['STOP', 'stop', ' Unsubscribe ', 'START', 'HELP', 'info', '1', ' 2.', '3)', '', '   ']) expect(isInboxText(t)).toBe(false);
    for (const t of ['Can I get a ride?', '1 more question', 'Stop by tomorrow?', '¿Dónde queda la corte?', '4']) expect(isInboxText(t)).toBe(true);
  });
});

describe('CSV client upload (A11 step 2)', () => {
  const today = '2026-10-27';
  const file = (rows, header = 'name,phone,language,case_number,court_dates,email') => Buffer.from([header, ...rows].join('\n'));
  test('the template has the columns in order', () => {
    expect(templateCsv()).toBe('name,phone,language,case_number,court_dates,email,court\r\n');
  });
  test('per-row errors; duplicates in the file; add vs update against the list', () => {
    const out = checkCsv(file([
      'Ana,615-555-0101,es,GS-1,2026-11-03 09:30; 12/1/2026,ana@x.test',
      'Ben,6155550102,English,GS-2,2026-11-03,',
      ',6155550103,en,GS-3,2026-11-03,',
      'Cy,123,en,GS-4,2026-11-03,',
      'Di,6155550105,fr,GS-5,2026-11-03,',
      'Ed,6155550106,en,,2026-11-03,',
      'Fa,6155550107,en,GS-7,2026-11-31,',
      'Gi,6155550108,en,GS-8,,',
      'Ho,6155550109,en,GS-9,2026-11-03,not-an-email',
      'Ana,+16155550101,es,gs-1,2026-11-04,',
      'Ivy,6155550110,en,GS-10,2030-01-01,',
      'Jo,6155550111,en,GS-11,2026-11-03 25:00,',
    ]), { today, existing: new Set(['+16155550102|gs-2']) });
    expect(out).toMatchObject({ total: 12, valid: 2, invalid: 10, adds: 1, updates: 1, file_errors: [] });
    expect(out.rows[0]).toMatchObject({ action: 'add', values: { name: 'Ana', phone: '+16155550101', language: 'es', case_number: 'GS-1', email: 'ana@x.test',
      court_dates: [{ date: '2026-11-03', time: '09:30' }, { date: '2026-12-01', time: null }] } });
    expect(out.rows[1]).toMatchObject({ action: 'update', values: { language: 'en' } });
    expect(out.rows.slice(2).map((r) => r.errors[0])).toEqual([
      { field: 'name', code: 'required' }, { field: 'phone', code: 'bad_phone' }, { field: 'language', code: 'bad_language' },
      { field: 'case_number', code: 'required' }, { field: 'court_dates', code: 'bad_date' }, { field: 'court_dates', code: 'required' },
      { field: 'email', code: 'bad_email' }, { field: 'case_number', code: 'duplicate_row', line: 2 },
      { field: 'court_dates', code: 'date_out_of_range' }, { field: 'court_dates', code: 'bad_date' }]);
  });
  test('file errors: missing columns, duplicate columns, no rows, too many rows, header aliases', () => {
    expect(checkCsv(Buffer.from('name,phone\nA,6155550100'), { today }).file_errors.map((e) => e.column))
      .toEqual(['case_number', 'court_dates']);
    expect(checkCsv(Buffer.from('name,name,phone,case_number,court_dates\n'), { today }).file_errors.map((e) => e.code)).toEqual(['duplicate_column', 'no_rows']);
    expect(checkCsv(Buffer.from(''), { today }).file_errors).toEqual([{ code: 'no_rows' }]);
    const many = file(Array.from({ length: MAX_ROWS + 1 }, (_, i) => `P${i},615555${String(i).padStart(4, '0')},en,C${i},2026-11-03,`));
    expect(checkCsv(many, { today }).file_errors).toEqual([{ code: 'too_many_rows', max: 5000 }]);
    const exact = file(Array.from({ length: MAX_ROWS }, (_, i) => `P${i},615555${String(i).padStart(4, '0')},en,C${i},2026-11-03,`));
    expect(checkCsv(exact, { today })).toMatchObject({ valid: 5000, invalid: 0 });
    const aliased = checkCsv(Buffer.from('Client Name,Mobile,Preferred Language,Case No,Court Date,Notes\nAl,6155550100,Español,X-1,2026-11-03,hi'), { today });
    expect(aliased).toMatchObject({ valid: 1, unknown_columns: ['Notes'] });
    expect(aliased.rows[0].values.language).toBe('es');
  });
  test('court dates: several, separated by ; or |, de-duplicated, at most 20, within range', () => {
    expect(parseCourtDates('2026-11-03|2026-11-03 10:00', '2026-10-27')).toEqual({ value: [{ date: '2026-11-03', time: null }] });
    expect(parseCourtDates(Array.from({ length: 21 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`).join(';'), '2026-10-27')).toEqual({ error: 'too_many_dates' });
    expect(parseCourtDates('2025-10-01', '2026-10-27')).toEqual({ error: 'date_out_of_range' });
    expect(parseDay('2/29/2028')).toBe('2028-02-29');
    expect(parseDay('2/29/2027')).toBeNull();
    expect(parseTime('9:05')).toBe('09:05');
    expect(parseTime('9:5')).toBeNull();
    expect(parseLang('')).toBe('en');
    expect(parseLang('Tiếng Việt')).toBe('vi');
    expect(parseLang('Kreyòl')).toBe('ht');
    expect(parseLang('Mandarin')).toBe('zh');
    expect(parseLang('العربية')).toBe('ar');
    expect(parseLang('Filipino')).toBe('tl');
    expect(parseLang('german')).toBeNull();
  });
});

describe('prices, zones, settings', () => {
  const keep = { ...process.env };
  afterEach(() => { for (const k of ['PD_SETUP_FEE_CENTS', 'PD_CLIENT_YEAR_CENTS', 'PUBLIC_DEFENDER_CHANNEL_ENABLED']) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } });
  test('prices default to $20,000 setup and $2.00 per client per year, in cents; the settings change them', () => {
    delete process.env.PD_SETUP_FEE_CENTS; delete process.env.PD_CLIENT_YEAR_CENTS;
    expect(pdPrices()).toEqual({ setup_cents: 2000000, per_client_cents: 200 });
    process.env.PD_SETUP_FEE_CENTS = '1500000'; process.env.PD_CLIENT_YEAR_CENTS = '350';
    expect(pdPrices()).toEqual({ setup_cents: 1500000, per_client_cents: 350 });
    process.env.PD_SETUP_FEE_CENTS = '12.50'; process.env.PD_CLIENT_YEAR_CENTS = '-1';
    expect(pdPrices()).toEqual({ setup_cents: 2000000, per_client_cents: 200 });   // never a fraction of a cent or negative
  });
  test('invoice year', () => {
    expect(invoiceYear('2026')).toBe(2026);
    expect(invoiceYear(undefined, new Date('2027-03-01T00:00:00Z'))).toBe(2027);
    expect(() => invoiceYear('26')).toThrow();
  });
  test('office time zone: county, then state, then the default', () => {
    expect(officeTimeZone({ state: 'TN', county: 'Knox' })).toBe('America/New_York');
    expect(officeTimeZone({ state: 'TN', county: 'Davidson' })).toBe('America/Chicago');
    expect(officeTimeZone({ state: 'ZZ' })).toBe('America/Chicago');
  });
  test('⚖ PUBLIC_DEFENDER_CHANNEL_ENABLED: off in production unless set, check-env warns', () => {
    expect(COUNSEL_FLAGS.PUBLIC_DEFENDER_CHANNEL_ENABLED).toMatch(/3\.2 and 6\.1/);
    expect(counselFlagOn('PUBLIC_DEFENDER_CHANNEL_ENABLED', { APP_ENV: 'production' })).toBe(false);
    expect(counselFlagOn('PUBLIC_DEFENDER_CHANNEL_ENABLED', { APP_ENV: 'production', PUBLIC_DEFENDER_CHANNEL_ENABLED: 'true' })).toBe(true);
    expect(counselFlagOn('PUBLIC_DEFENDER_CHANNEL_ENABLED', {})).toBe(true);
    expect(publicDefenderEnabled({ PUBLIC_DEFENDER_CHANNEL_ENABLED: 'false' })).toBe(false);
    const r = envReport({ APP_ENV: 'production', PUBLIC_DEFENDER_CHANNEL_ENABLED: 'true' });
    expect(r.warnings.some((w) => w.startsWith('PUBLIC_DEFENDER_CHANNEL_ENABLED is on'))).toBe(true);
  });
  test('the consent-basis statement is word for word the one the app shows (English)', () => {
    const en = JSON.parse(fs.readFileSync(path.join(REPO, 'frontend/src/i18n/en.json'), 'utf8'));
    expect(en.pd_consent_statement).toBe(CONSENT_BASIS_TEXT);
  });
});
