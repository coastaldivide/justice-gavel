/**
 * rearrest_custody_units.test.js — the pure parts of re-arrest matching (A4), custody alert
 * wording (A9), recovery-agent sharing rules (B4), the Tennessee quarterly report (B5), the
 * roster-ingest identity of a booking and the ⚖ settings.
 */
import { nameKeys, classifyMatch, rearrestMessage } from '../services/bondDesk/rearrest.js';
import { eventMessage, whenText } from '../services/custodyAlerts.js';
import { stateRule, hashShareToken, SHARE_TOKEN_RE, shareLink } from '../services/bondDesk/recoveryShares.js';
import { quarterRange, previousQuarter, tnCsvRows, TN_REPORT } from '../services/bondDesk/tnReport.js';
import { normalizeRecord, sourceKeyFor, parseDob, cleanPhone, parseArrestFeeds } from '../services/arrest_ingest.js';
import { counselFlagOn, COUNSEL_FLAGS } from '../utils/counselFlags.js';
import { smsSegments } from '../services/smsText.js';
import { envReport } from '../../scripts/lib/envReport.mjs';
import { CATALOGS, SUPPORTED_LANGS } from '../i18n/index.js';

const LANGS = SUPPORTED_LANGS;

describe('re-arrest matching (A4)', () => {
  test('names are normalized: case, accents, commas, initials, suffixes, particles', () => {
    expect(nameKeys('SMITH, JOHN A')).toEqual({ first: 'john', lasts: new Set(['smith']) });
    const k = nameKeys('José  de la Cruz Jr.');
    expect(k.first).toBe('jose');
    expect([...k.lasts]).toEqual(expect.arrayContaining(['delacruz', 'cruz']));
    expect(nameKeys('Madonna')).toBeNull();
    expect(nameKeys('')).toBeNull();
  });
  test('strong = first + last + date of birth; a different date of birth is not them', () => {
    const bond = { bondName: 'Rhea Quill', bondDobs: ['1990-04-05'], bondState: 'TN' };
    expect(classifyMatch(bond, { name: 'QUILL, RHEA', dob: '1990-04-05', state: 'GA' })).toBe('strong');   // DOB: any state
    expect(classifyMatch(bond, { name: 'Rhea Quill', dob: '1985-01-01', state: 'TN' })).toBeNull();
    expect(classifyMatch({ ...bond, bondDobs: ['1970-01-01', '1990-04-05'] }, { name: 'Rhea Quill', dob: '1990-04-05' })).toBe('strong');
  });
  test('possible = name only (no date of birth on one side), same state when both have one', () => {
    expect(classifyMatch({ bondName: 'Owen Marsh', bondDobs: [], bondState: 'TN' }, { name: 'MARSH, OWEN', dob: null, state: 'TN' })).toBe('possible');
    expect(classifyMatch({ bondName: 'Owen Marsh', bondDobs: ['1990-01-01'], bondState: 'TN' }, { name: 'Owen Marsh', dob: null, state: 'TN' })).toBe('possible');
    expect(classifyMatch({ bondName: 'Owen Marsh', bondDobs: [], bondState: 'TN' }, { name: 'Owen Marsh', dob: '1990-01-01', state: 'KY' })).toBeNull();
    expect(classifyMatch({ bondName: 'Owen Marsh', bondDobs: [], bondState: 'TN' }, { name: 'Owen Marshall', dob: null, state: 'TN' })).toBeNull();
    expect(classifyMatch({ bondName: 'Owen Marsh', bondDobs: [], bondState: 'TN' }, { name: 'Olivia Marsh', dob: null, state: 'TN' })).toBeNull();
  });
  test('the alert names the roster we import and never claims nationwide coverage; English text ≤ 2 segments', () => {
    for (const lang of LANGS) {
      const m = rearrestMessage(lang, { match: 'strong', defendant: 'Christopher Alexander Montgomery-Wellington', county: 'Davidson County', state: 'TN',
        bookingDate: '2026-10-27', facility: 'Davidson County Downtown Detention Center', agency: 'Volunteer State Bail Bonds of Middle Tennessee LLC',
        link: 'https://justicegavel.app/bond-desk/bond/123456' });
      expect(m.body).toContain('Davidson');
      expect(m.sms).toContain('STOP');
      expect(`${m.body} ${m.email}`.toLowerCase()).not.toMatch(/nationwide|all jails|every jail in/);
      if (lang === 'en') expect(smsSegments(m.sms).segments).toBeLessThanOrEqual(2);
    }
    const possible = rearrestMessage('en', { match: 'possible', defendant: 'Owen Marsh', county: null, bookingDate: '2026-10-27', agency: 'A', link: 'x' });
    expect(possible.title).toBe('Possible re-arrest: Owen Marsh');
    expect(possible.body).toContain('a jail roster we import');
    expect(possible.body).toContain('confirm or dismiss');
  });
});

describe('custody alert wording (A9)', () => {
  const at = '2026-10-27T21:05:00Z';
  const arrest = { name: 'Rhea Quill', county: 'Davidson', jail_phone: '(615) 555-0199' };
  test('"no longer listed" names the roster, the time and the jail phone — never "released"', () => {
    const m = eventMessage('en', { kind: 'not_listed', observed_at: at }, arrest, 'America/Chicago');
    expect(m.body).toBe(`Rhea Quill is no longer listed on the Davidson County roster as of ${whenText(at, 'en', 'America/Chicago')}. Call (615) 555-0199 to confirm.`);
    expect(m.body).toContain('4:05');
    const noPhone = eventMessage('en', { kind: 'not_listed', observed_at: at }, { ...arrest, jail_phone: null, county: '' }, 'America/Chicago');
    expect(noPhone.body).toContain('the jail roster');
    expect(noPhone.body).toContain('Call the jail to confirm.');
    for (const lang of LANGS) {
      for (const kind of ['not_listed', 'listed_again', 'facility_changed']) {
        const t = eventMessage(lang, { kind, observed_at: at, old_value: 'Jail A', new_value: 'Jail B' }, arrest, 'America/Chicago');
        expect(`${t.body} ${t.sms} ${t.email_body}`.toLowerCase()).not.toMatch(/released|liberad|solt[oa]|thả/);
      }
    }
  });
  test('a status change quotes what the roster says, before and now', () => {
    const m = eventMessage('en', { kind: 'status_changed', observed_at: at, old_value: 'In custody', new_value: 'Released' }, arrest, 'America/Chicago');
    expect(m.body).toContain('status as "Released" (before: "In custody")');
    expect(m.body).toContain('This is what the roster says.');
  });
  test('texts end with STOP and English stays within 2 segments even with long values', () => {
    for (const lang of LANGS) {
      const m = eventMessage(lang, { kind: 'facility_changed', observed_at: at, old_value: 'Davidson County Downtown Detention Center Building B', new_value: 'Riverbend Maximum Security Institution Unit 4' },
        { name: 'Christopher Alexander Montgomery-Wellington', county: 'Davidson', jail_phone: '(615) 555-0199' }, 'America/Chicago');
      expect(m.sms).toMatch(/STOP/);
      if (lang === 'en') expect(smsSegments(m.sms).segments).toBeLessThanOrEqual(2);
    }
  });
});

describe('recovery-agent sharing (B4)', () => {
  test('the state rule comes from routes/recovery_agents.js with how it was checked', () => {
    expect(stateRule('tn')).toMatchObject({ state: 'TN', allowed: true, checked: 'secondary' });
    expect(stateRule('IL')).toMatchObject({ allowed: false });
    expect(stateRule('AL')).toMatchObject({ allowed: null, checked: 'unverified' });
    expect(stateRule('ZZ')).toBeNull();
    expect(stateRule(null)).toBeNull();
  });
  test('invite links carry a long random token; only its SHA-256 is stored', () => {
    const link = shareLink('A'.repeat(43));
    expect(link).toMatch(/\/recovery\/A{43}$/);
    expect(SHARE_TOKEN_RE.test('A'.repeat(43))).toBe(true);
    expect(SHARE_TOKEN_RE.test('short')).toBe(false);
    expect(hashShareToken('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Tennessee quarterly report (B5)', () => {
  test('quarters, their dates and the due date (25th of the month after)', () => {
    expect(quarterRange('2026-Q1')).toEqual({ quarter: '2026-Q1', from: '2026-01-01', to: '2026-03-31', due: '2026-04-25' });
    expect(quarterRange('2026-Q3')).toEqual({ quarter: '2026-Q3', from: '2026-07-01', to: '2026-09-30', due: '2026-10-25' });
    expect(quarterRange('2026-Q4')).toEqual({ quarter: '2026-Q4', from: '2026-10-01', to: '2026-12-31', due: '2027-01-25' });
    expect(quarterRange('2024-Q4')).toBeNull();   // the report starts with 2025 (Pub. Ch. 396 effective July 1, 2025)
    expect(quarterRange('2026-Q5')).toBeNull();
    expect(previousQuarter('2026-10-27')).toBe('2026-Q3');
    expect(previousQuarter('2027-02-01')).toBe('2026-Q4');
  });
  test('the CSV header cites the law, the date it was checked and the sources', () => {
    const rows = tnCsvRows({ quarter: '2026-Q3', period_from: '2026-07-01', period_to: '2026-09-30', due_on: '2026-10-25',
      totals: { bonds_issued: 1, liability_issued_cents: 100000, open_bonds_at_end: 1, liability_open_at_end_cents: 100000 },
      counties: [{ county: 'Davidson', bonds_issued: 1, liability_issued_cents: 100000, open_bonds_at_end: 1, liability_open_at_end_cents: 100000 }],
      needs_county: [] }, { agency: 'Sigma', agent_name: 'Sam', license: 'TN-1' });
    const flat = rows.map((r) => r.join('|')).join('\n');
    expect(flat).toContain(TN_REPORT.citation);
    expect(flat).toContain('Law checked on|2026-10-27');
    expect(flat).toContain('https://www.tn.gov/content/dam/tn/revenue/documents/notices/bailbond/bailbondsmen2025.pdf');
    expect(flat).toContain('Davidson|1|1000.00|1|1000.00');
  });
});

describe('roster ingest: the identity of a booking', () => {
  const feed = { id: 'f', source: 'feed_f', state: 'TN', county: 'Davidson', jail_phone: '615-862-8170' };
  test('the jail booking number, else a hash of name + booking date', () => {
    expect(sourceKeyFor({ booking_id: ' 26-0001 ' }, 'A B', '2026-10-01')).toBe('b:26-0001');
    expect(sourceKeyFor({ booking_number: 7 }, 'A B', '2026-10-01')).toBe('b:7');
    const k = sourceKeyFor({}, 'A B', '2026-10-01');
    expect(k).toMatch(/^n:[0-9a-f]{40}$/);
    expect(sourceKeyFor({}, 'a b', '2026-10-01')).toBe(k);
    expect(sourceKeyFor({}, 'A B', '2026-10-02')).not.toBe(k);
  });
  test('date of birth, status and the jail phone are read when the feed has them', () => {
    const n = normalizeRecord({ name: 'A B', booking_date: '2026-10-01', dob: '1990-04-05', status: ' In  custody ', jail_phone: 'call us' }, feed);
    expect(n).toMatchObject({ dob: '1990-04-05', status: 'In custody', jail_phone: '615-862-8170' });
    expect(parseDob('2999-01-01')).toBeNull();
    expect(parseDob('1990-02-31')).toBeNull();
    expect(parseDob('04/05/1990')).toBeNull();
    expect(cleanPhone('(615) 862-8170')).toBe('(615) 862-8170');
    expect(cleanPhone('<script>')).toBeNull();
    expect(parseArrestFeeds(JSON.stringify([{ id: 'x', url: 'https://a.gov/x.json', jail_phone: '615-862-8170' }])).feeds[0].jail_phone).toBe('615-862-8170');
  });
});

describe('⚖ settings', () => {
  test('explicit true/false wins; unset is off in production and on elsewhere', () => {
    for (const k of Object.keys(COUNSEL_FLAGS)) {
      expect(counselFlagOn(k, { NODE_ENV: 'production' })).toBe(false);
      expect(counselFlagOn(k, { APP_ENV: 'production' })).toBe(false);
      expect(counselFlagOn(k, { NODE_ENV: 'test' })).toBe(true);
      expect(counselFlagOn(k, { NODE_ENV: 'production', [k]: 'true' })).toBe(true);
      expect(counselFlagOn(k, { NODE_ENV: 'test', [k]: 'false' })).toBe(false);
    }
  });
  test('check-env warns when one is on in production', () => {
    const base = { NODE_ENV: 'production', APP_ENV: 'production', JWT_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40),
      ENCRYPTION_KEY: 'a'.repeat(64), DATABASE_URL: 'postgres://db', APP_URL: 'https://justicegavel.app' };
    for (const k of Object.keys(COUNSEL_FLAGS)) {
      expect(envReport({ ...base, [k]: 'true' }).warnings.some((w) => w.startsWith(k))).toBe(true);
      expect(envReport({ ...base, [k]: 'false' }).warnings.some((w) => w.startsWith(k))).toBe(false);
    }
  });
  test('every new server text exists in every language', () => {
    const keys = Object.keys(CATALOGS.en).filter((k) => /^(custody\.|rearrest\.|recovery\.|bd\.err\.share_)/.test(k));
    expect(keys.length).toBeGreaterThan(30);
    for (const l of LANGS.filter((x) => x !== 'en')) for (const k of keys) expect(typeof CATALOGS[l][k]).toBe('string');
  });
});
