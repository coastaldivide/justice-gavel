/**
 * review_fixes_units.test.js — regression tests for findings of the independent review that need no
 * database (the others live in the integration suites, named RF<n>):
 *
 *   RF6   every path that carries a secret link token is redacted in request logs and Sentry
 *   RF10  Mountain-time counties of South Dakota and Nebraska (verified against each county's
 *         official time zone; split counties keep the state's zone)
 *   RF15  automatic-payment and receipt texts end with the opt-out sentence in all eight languages,
 *         English within 2 segments; the e-mails built from the same words do not carry it
 */
import { redactSecretPath } from '../utils/redact.js';
import { scrubSentryEvent } from '../instrument.js';
import { countyTimeZone } from '../utils/timezone.js';
import { msg, SUPPORTED_LANGS } from '../i18n/index.js';
import { fitSms, smsSegments } from '../services/smsText.js';
import { withoutOptOut } from '../services/bondDesk/core.js';

const TOKEN = 'Zx9_kQ-3vLmN0pRsTuVwXyZ12345678abcdefGHIJK';

describe('RF6 secret link tokens never reach a log line or an error report', () => {
  const paths = [
    `/api/pd/invite/${TOKEN}`,
    `/api/sign/${TOKEN}`, `/api/sign/${TOKEN}/answers`, `/api/sign/${TOKEN}/documents/3.pdf`,
    `/api/checkins/link/${TOKEN}`,
    `/api/bd-pay/autopay/${TOKEN}`, `/api/bd-pay/autopay/${TOKEN}/confirm`,
    `/api/bond-desk/staff/invite/${TOKEN}`,
    `/api/cases/shared/${TOKEN}`,
    `/api/push/token/${TOKEN}`,
    // the app's own pages (web build behind the same host, Sentry URLs)
    `/c/${TOKEN}`, `/sign/${TOKEN}`, `/autopay/${TOKEN}`, `/pd/join/${TOKEN}`, `/bond-desk/join/${TOKEN}`, `/recovery/${TOKEN}`,
  ];
  test.each(paths)('%s', (p) => {
    const out = redactSecretPath(p);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('[link]');
    expect(redactSecretPath(`https://justicegavel.app${p}`)).not.toContain(TOKEN);
  });
  test('paths without a token are left alone', () => {
    for (const p of ['/api/pd/invite/accept', '/api/bd-pay/agency/delta-bail', '/api/cases/12', '/pay/delta-bail', '/health']) expect(redactSecretPath(p)).toBe(p);
  });
  test('Sentry: the request URL loses the token as well as the query string', () => {
    const ev = scrubSentryEvent({ request: { url: `https://api.justicegavel.app/api/pd/invite/${TOKEN}?x=1` } });
    expect(ev.request.url).toBe('https://api.justicegavel.app/api/pd/invite/[link]');
  });
});

describe('RF10 Mountain-time counties', () => {
  test.each([
    ['SD', 'Oglala Lakota'], ['SD', 'Oglala Lakota County'], ['SD', 'Shannon'], ['SD', 'Jackson'], ['SD', 'Bennett'], ['SD', 'Haakon'],
    ['SD', 'Ziebach'], ['SD', 'Dewey'], ['SD', 'Corson'], ['SD', 'Pennington'],
    ['NE', 'Grant'], ['NE', 'Arthur'], ['NE', 'Hooker County'], ['NE', 'Keith'],
  ])('%s %s → America/Denver', (st, county) => {
    expect(countyTimeZone(st, county)).toBe('America/Denver');
  });
  test('Central-time and split counties keep the state zone', () => {
    for (const [st, county] of [['SD', 'Stanley'], ['SD', 'Jones'], ['SD', 'Mellette'], ['SD', 'Todd'], ['SD', 'Minnehaha'], ['NE', 'Cherry'], ['NE', 'Thomas'], ['NE', 'McPherson'], ['NE', 'Lincoln']]) {
      expect([st, county, countyTimeZone(st, county)]).toEqual([st, county, null]);
    }
  });
});

describe('RF15 the opt-out sentence on automatic-payment and receipt texts', () => {
  const p = { agency: 'Delta Bail Bonds of Middle Tennessee', defendant: 'Riley Alexander Stone-Whitfield', amount: '$1,250.00',
    retry: '11/03/2026', phone: '615-555-0188', link: `https://justicegavel.app/autopay/${TOKEN}`, date: '10/27/2026', receipt: 'R-000123', payer: 'Pat Payer' };
  const keys = ['bd.sms.autopay_failed_retry', 'bd.sms.autopay_failed_final', 'bd.sms.autopay_action', 'bd.sms.receipt'];
  test.each(SUPPORTED_LANGS)('%s', (lang) => {
    const stop = msg(lang, 'sms.opt_out');
    expect(stop).toContain('STOP');
    for (const key of keys) {
      const text = fitSms((f) => msg(lang, key, f), p, [['defendant', 6], ['agency', 12]], { lang });
      expect([key, text.endsWith(stop)]).toEqual([key, true]);
      if (lang === 'en') expect([key, smsSegments(text).segments <= 2]).toEqual([key, true]);
      const email = withoutOptOut(lang, msg(lang, key, p));
      expect([key, email.includes('STOP')]).toEqual([key, false]);
      expect(email.length).toBeGreaterThan(20);
    }
  });
});
