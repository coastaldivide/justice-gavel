/**
 * audit11 M4 — user-controlled values interpolated into transactional email
 * HTML must be escaped (stored-XSS / phishing in attorney alert emails), and
 * subjects must not carry CR/LF (header injection).
 *
 * Attack: a client registers with a display name / case title containing
 * markup (`<a href="https://evil">Pay bail here</a>`, `<img src=x onerror=…>`)
 * and books a consultation; the attorney alert email used to render it as live
 * HTML. These tests send the real templates through the real Resend client
 * with fetch intercepted and inspect the exact HTML that would be delivered.
 *
 * Runs in the normal (in-memory) jest run — no database needed.
 */
import { jest } from '@jest/globals';

const EVIL_NAME  = '<a href="https://evil.example/pay">Pay bail here</a><img src=x onerror=alert(1)>';
const EVIL_TITLE = '"><script>steal()</script>';
const EVIL_LINK  = 'javascript:alert(document.cookie)';

describe('M4 — transactional email templates escape user values', () => {
  let email, sent, realFetch;

  beforeAll(async () => {
    process.env.RESEND_API_KEY = 're_test_not_real_key_for_unit_tests';
    delete process.env.LIVE_EMAIL;
    realFetch = global.fetch;
    sent = [];
    global.fetch = jest.fn(async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    email = await import('../../services/email.js');
  });

  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  });

  const lastHtml = () => sent[sent.length - 1].body.html;
  const assertInert = (html) => {
    expect(html).not.toMatch(/<a href="https:\/\/evil/i);
    expect(html).not.toMatch(/<img src=x/i);
    expect(html).not.toMatch(/<script>/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('&lt;');
  };

  it('attorney booking alert: client name, email, phone, case title are escaped', async () => {
    await email.sendAttorneyBookingAlert({
      to: 'atty@example.test', attorneyName: 'Atty', clientName: EVIL_NAME,
      clientEmail: 'x@example.test"><b>', clientPhone: '<b>615</b>', caseTitle: EVIL_TITLE,
      dateLabel: 'Mon', timeSlot: '9:00 AM', durationMin: 30, meetingLink: EVIL_LINK,
    });
    expect(sent.length).toBeGreaterThan(0);
    assertInert(lastHtml());
    expect(sent[sent.length - 1].body.subject).not.toMatch(/[\r\n]/);
  });

  it('client booking confirmation: attorney name and meeting link are safe', async () => {
    await email.sendBookingConfirmation({
      to: 'client@example.test', clientName: EVIL_NAME, attorneyName: EVIL_NAME,
      dateLabel: 'Mon', timeSlot: '9:00 AM', durationMin: 30, feeDollars: '0', meetingLink: EVIL_LINK,
    });
    assertInert(lastHtml());
  });

  it('welcome email: display name is escaped; subject has no header injection', async () => {
    await email.sendWelcome('new@example.test', EVIL_NAME);
    assertInert(lastHtml());
    await email.sendEmail({ to: 'a@example.test', subject: 'Hi\r\nBcc: victim@example.test', text: '<b>x</b>' });
    const last = sent[sent.length - 1].body;
    expect(last.subject).not.toMatch(/[\r\n]/);
    expect(last.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('LEGIT: ordinary names and links still render', async () => {
    await email.sendBookingConfirmation({
      to: 'client@example.test', clientName: "Ana O'Neil", attorneyName: 'J. Smith',
      dateLabel: 'Mon, Oct 12', timeSlot: '9:00 AM', durationMin: 30, feeDollars: '0',
      meetingLink: 'https://meet.justicegavel.app/consult/ABC123',
    });
    const html = lastHtml();
    expect(html).toContain('Ana O&#39;Neil');
    expect(html).toContain('J. Smith');
    expect(html).toContain('href="https://meet.justicegavel.app/consult/ABC123"');
  });
});
