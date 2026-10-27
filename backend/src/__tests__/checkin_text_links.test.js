/**
 * checkin_text_links.test.js — the pure parts of check-ins by text link (A2), the missed-check-in
 * alert (A3), location alerts (B1) and the "Your bail agent" card (B6).
 */
import {
  missedDays, distanceFromHome, locationAlertsEnabled, hashLinkToken, newLinkToken, checkinTextLink,
  LINK_TOKEN_RE, textReady, firstName,
} from '../services/checkinTexts.js';
import { nextDate } from '../routes/me.js';
import { todayInZone, addDays } from '../utils/timezone.js';
import { CATALOGS } from '../i18n/index.js';

describe('missedDays (A3)', () => {
  test('daily: every ended day after monitoring started without a check-in, at most the lookback', () => {
    expect(missedDays({ freq: 'daily', today: '2026-11-10', since: '2026-11-01', days: [] })).toEqual(['2026-11-08', '2026-11-09']);
    expect(missedDays({ freq: 'daily', today: '2026-11-10', since: '2026-11-01', days: ['2026-11-09'] })).toEqual(['2026-11-08']);
    expect(missedDays({ freq: 'daily', today: '2026-11-10', since: '2026-11-01', days: ['2026-11-08', '2026-11-09'] })).toEqual([]);
  });
  test('the day monitoring started (or restarted after a pause) is never missed; today is never missed', () => {
    expect(missedDays({ freq: 'daily', today: '2026-11-10', since: '2026-11-09', days: [] })).toEqual([]);
    expect(missedDays({ freq: 'daily', today: '2026-11-10', since: '2026-11-08', days: [] })).toEqual(['2026-11-09']);
    expect(missedDays({ freq: 'daily', today: '2026-11-10', since: '2026-11-10', days: [] })).toEqual([]);
  });
  test('weekly: the due day 7 days after the last check-in (or the start), once', () => {
    // last check-in Nov 2 → due through Nov 9; Nov 9 ended without one → missed Nov 9
    expect(missedDays({ freq: 'weekly', today: '2026-11-10', since: '2026-10-20', days: ['2026-11-02'] })).toEqual(['2026-11-09']);
    // checked in Nov 4 → the week is done
    expect(missedDays({ freq: 'weekly', today: '2026-11-10', since: '2026-10-20', days: ['2026-11-04'] })).toEqual([]);
    // no check-in since the start Nov 2 → Nov 9 missed; Nov 8 not (not a due boundary)
    expect(missedDays({ freq: 'weekly', today: '2026-11-10', since: '2026-11-02', days: [], lookback: 3 })).toEqual(['2026-11-09']);
    // two weeks overdue → the 14-day boundary is missed too
    expect(missedDays({ freq: 'weekly', today: '2026-11-17', since: '2026-11-02', days: [] })).toEqual(['2026-11-16']);
    // a check-in before a pause does not anchor the week after the restart
    expect(missedDays({ freq: 'weekly', today: '2026-11-16', since: '2026-11-08', days: ['2026-10-01'] })).toEqual(['2026-11-15']);
  });
  test('daylight saving: the local day in New York ends at local midnight on both sides of the change', () => {
    const tz = 'America/New_York';
    // Nov 1 2026 01:30 EDT and 01:30 EST (the hour repeats) are both still Nov 1
    expect(todayInZone(tz, new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
    expect(todayInZone(tz, new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01');
    // the day ends at 05:00 UTC (EST), not 04:00 UTC
    expect(todayInZone(tz, new Date('2026-11-02T04:30:00Z'))).toBe('2026-11-01');
    expect(todayInZone(tz, new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02');
    const today = todayInZone(tz, new Date('2026-11-02T05:00:00Z'));
    expect(missedDays({ freq: 'daily', today, since: '2026-10-25', days: ['2026-10-31'] })).toEqual(['2026-11-01']);
    // spring forward: Mar 8 2026 has 23 hours and still ends at local midnight
    expect(todayInZone(tz, new Date('2026-03-09T03:59:00Z'))).toBe('2026-03-08');
    expect(todayInZone(tz, new Date('2026-03-09T04:00:00Z'))).toBe('2026-03-09');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('distanceFromHome (B1)', () => {
  const home = { home_lat: 36.1627, home_lng: -86.7816, home_radius_miles: 5 };
  test('great-circle distance in miles; outside only past the radius', () => {
    const near = distanceFromHome(home, 36.17, -86.78);
    expect(near.outside).toBe(false);
    expect(near.distance_miles).toBeLessThan(1);
    // Nashville → Memphis is about 196 miles
    const far = distanceFromHome(home, 35.1495, -90.049);
    expect(far.outside).toBe(true);
    expect(far.distance_miles).toBeGreaterThan(190);
    expect(far.distance_miles).toBeLessThan(200);
  });
  test('no home point or no location → no answer (nothing is compared)', () => {
    expect(distanceFromHome({}, 36, -86)).toBeNull();
    expect(distanceFromHome(home, null, null)).toBeNull();
  });
});

describe('locationAlertsEnabled (⚖ counsel 2.4)', () => {
  test('explicit setting wins; unset is off in production and on elsewhere', () => {
    expect(locationAlertsEnabled({ flag: 'true', nodeEnv: 'production' })).toBe(true);
    expect(locationAlertsEnabled({ flag: 'false', nodeEnv: 'test' })).toBe(false);
    expect(locationAlertsEnabled({ flag: '', nodeEnv: 'production' })).toBe(false);
    expect(locationAlertsEnabled({ flag: undefined, appEnv: 'production', nodeEnv: 'test' })).toBe(false);
    expect(locationAlertsEnabled({ flag: undefined, nodeEnv: 'test' })).toBe(true);
  });
});

describe('link tokens (A2)', () => {
  test('32 random bytes, base64url; only a SHA-256 is stored; the link is /c/<token>', () => {
    const t = newLinkToken();
    expect(t).toMatch(LINK_TOKEN_RE);
    expect(newLinkToken()).not.toBe(t);
    expect(hashLinkToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(t)).not.toContain(t);
    expect(checkinTextLink(t)).toMatch(new RegExp(`/c/${t}$`));
  });
  test('the text channel needs consent for the exact number', () => {
    const e = { channel: 'sms', defendant_phone: '+16155550111', sms_consent_at: '2026-10-27', sms_consent_phone: '+16155550111' };
    expect(textReady(e)).toBe(true);
    expect(textReady({ ...e, sms_consent_phone: '+16155550112' })).toBe(false);
    expect(textReady({ ...e, sms_consent_at: null })).toBe(false);
    expect(textReady({ ...e, channel: 'app' })).toBe(false);
    expect(firstName('  Dee  Fendant ')).toBe('Dee');
  });
});

describe('nextDate (B6)', () => {
  test('the soonest date today or later', () => {
    expect(nextDate(['2026-12-01', '2026-11-15', null], '2026-11-01')).toBe('2026-11-15');
    expect(nextDate(['2026-10-01'], '2026-11-01')).toBeNull();
    expect(nextDate(['2026-11-01'], '2026-11-01')).toBe('2026-11-01');
  });
});

describe('texts and alerts in four languages', () => {
  const keys = ['checkin.sms.link', 'checkin.sms.reminder', 'checkin.sms.reminder_weekly', 'checkin.sms.missed', 'checkin.sms.agent_missed',
    'checkin.push.missed_title', 'checkin.email.missed_body', 'checkin.push.location_body', 'checkin.err.link_expired', 'checkin.err.plan_required'];
  test.each(['en', 'es', 'pt', 'vi'])('%s has every key; every text to a person names STOP', (lang) => {
    for (const k of keys) expect(typeof CATALOGS[lang][k]).toBe('string');
    for (const k of keys.filter((x) => x.startsWith('checkin.sms.'))) expect(CATALOGS[lang][k]).toContain('STOP');
    for (const k of ['checkin.sms.link', 'checkin.sms.reminder', 'checkin.sms.missed']) expect(CATALOGS[lang][k]).toContain('{link}');
  });
});
