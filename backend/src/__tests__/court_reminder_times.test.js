/**
 * court_reminder_times.test.js — sandbox review 2026-11-17, finding 7: the court-day messages
 * follow the hearing's time when it is known.
 *   "Court date TODAY"          06:30 local, or 2 hours before a hearing that starts before 08:30
 *   "Did you make it to court?" 15:00 local, or 2 hours after a hearing that starts after 13:00
 * Before, a 07:00 hearing got its reminder 30 minutes before it, and a 16:30 hearing was asked
 * about at 15:00 — before it started. Same rules for app reminders, Bond Desk and public
 * defender texts (they share planSteps / attendanceAskAt) and the guest plan on the phone.
 */
import { planSteps, dayOfReminderAt, attendanceAskAt, DAY_OF_LEAD_MINUTES, ASK_AFTER_MINUTES } from '../services/courtReminders.js';
import { passwordProblem, MAX_PASSWORD_BYTES } from '../utils/passwordPolicy.js';

const local = (tz) => (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: tz, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(d);

describe('court-day reminder follows the hearing time', () => {
  test.each([['America/New_York'], ['America/Chicago'], ['America/Los_Angeles'], ['Pacific/Honolulu']])('%s', (tz) => {
    const at = local(tz);
    expect(at(dayOfReminderAt('2026-11-12', tz, null))).toBe('11-12, 06:30');        // no time known
    expect(at(dayOfReminderAt('2026-11-12', tz, '07:00'))).toBe('11-12, 05:00');     // 2 h before
    expect(at(dayOfReminderAt('2026-11-12', tz, '08:30'))).toBe('11-12, 06:30');     // exactly 2 h: same
    expect(at(dayOfReminderAt('2026-11-12', tz, '09:00'))).toBe('11-12, 06:30');     // later hearing: 06:30
    expect(at(dayOfReminderAt('2026-11-12', tz, '01:00'))).toBe('11-11, 23:00');     // just after midnight
    expect(at(dayOfReminderAt('2026-11-12', tz, '7:15:00'))).toBe('11-12, 05:15');   // TIME column form
    expect(at(dayOfReminderAt('2026-11-12', tz, 'not a time'))).toBe('11-12, 06:30');
  });

  test('planSteps uses it for the court-day step only', () => {
    const tz = 'America/Chicago';
    const steps = planSteps('2026-11-12', tz, new Date('2026-10-27T12:00:00Z'), { courtTime: '07:30' });
    expect(steps.map((s) => [s.days, local(tz)(s.at)])).toEqual([[7, '11-05, 09:00'], [3, '11-09, 09:00'], [1, '11-11, 18:00'], [0, '11-12, 05:30']]);
    // without a time: unchanged plan
    const plain = planSteps('2026-11-12', tz, new Date('2026-10-27T12:00:00Z'));
    expect(local(tz)(plain[3].at)).toBe('11-12, 06:30');
  });

  test('added late on the day: one message now — unless the hearing already started', () => {
    const tz = 'America/New_York';
    const at0700 = new Date('2026-11-12T12:00:00Z');                  // 07:00 in New York
    const before = planSteps('2026-11-12', tz, at0700, { courtTime: '09:30' });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ immediate: true, days: 0 });
    expect(planSteps('2026-11-12', tz, at0700, { courtTime: '06:45' })).toEqual([]);
    // no time known: still one message now (the person may still make it)
    expect(planSteps('2026-11-12', tz, at0700)).toHaveLength(1);
  });

  test('constants', () => {
    expect(DAY_OF_LEAD_MINUTES).toBe(120);
    expect(ASK_AFTER_MINUTES).toBe(120);
  });
});

describe('"Did you make it to court?" is asked after the hearing', () => {
  test.each([['America/New_York'], ['America/Denver'], ['Pacific/Honolulu']])('%s', (tz) => {
    const at = local(tz);
    expect(at(attendanceAskAt('2026-11-12', tz, null))).toBe('11-12, 15:00');
    expect(at(attendanceAskAt('2026-11-12', tz, '09:00'))).toBe('11-12, 15:00');     // morning hearing: 15:00
    expect(at(attendanceAskAt('2026-11-12', tz, '13:00'))).toBe('11-12, 15:00');
    expect(at(attendanceAskAt('2026-11-12', tz, '16:30'))).toBe('11-12, 18:30');     // 2 h after
    expect(at(attendanceAskAt('2026-11-12', tz, '23:30'))).toBe('11-13, 01:30');
    expect(at(attendanceAskAt('2026-11-12', tz, '23:59'))).toBe('11-13, 01:59');
  });

});

describe('password length is counted in bytes (bcrypt reads 72)', () => {
  test('ASCII: 72 is fine, 73 is too long', () => {
    expect(MAX_PASSWORD_BYTES).toBe(72);
    expect(passwordProblem('Aa1!' + 'x'.repeat(68))).toBeNull();
    expect(passwordProblem('Aa1!' + 'x'.repeat(69))).toBe('long');
  });
  test('multi-byte letters count as more than one', () => {
    expect(passwordProblem('éa'.repeat(24))).toBeNull();              // 48 characters, 72 bytes
    expect(passwordProblem('éa'.repeat(24) + 'é')).toBe('long');      // 49 characters, 74 bytes
    expect(passwordProblem('密'.repeat(25))).toBe('long');            // 75 bytes
  });
  test('the short and weak rules are unchanged', () => {
    expect(passwordProblem('short')).toBe('short');
    expect(passwordProblem('12341234')).toBe('weak');
  });
});
