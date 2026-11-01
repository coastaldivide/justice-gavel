/**
 * guestCourtDates.test.js — court reminders with no account (services/guestCourtDates.ts).
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  const api = {
    getItem: jest.fn(async (k) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k, v) => { store[k] = v; }),
    removeItem: jest.fn(async (k) => { delete store[k]; }),
    clear: jest.fn(async () => { Object.keys(store).forEach(k => delete store[k]); }),
  };
  return { __esModule: true, default: api };
});
const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const g = require('../services/guestCourtDates');

const text = (kind, d) => ({ title: 'Court', body: `${kind} ${d.court_date}` });
function fakeScheduler() {
  const s = { scheduled: [], cancelled: [], n: 0 };
  s.schedule = jest.fn(async (at) => { s.n += 1; s.scheduled.push(at); return `n${s.n}`; });
  s.cancel = jest.fn(async (id) => { s.cancelled.push(id); });
  return s;
}
const NOW = new Date(2026, 9, 26, 12, 0, 0); // Oct 26 2026, noon local

beforeEach(async () => { await AsyncStorage.clear(); });

describe('planGuestReminders', () => {
  it('plans 7 days, 3 days, the evening before and the morning of, in local time', () => {
    const p = g.planGuestReminders('2026-11-20', null, NOW);
    expect(p.map(x => x.kind)).toEqual(['week', 'three_days', 'evening', 'morning']);
    expect(p[0].at).toEqual(new Date(2026, 10, 13, 9, 0));
    expect(p[1].at).toEqual(new Date(2026, 10, 17, 9, 0));
    expect(p[2].at).toEqual(new Date(2026, 10, 19, 18, 0));
    expect(p[3].at).toEqual(new Date(2026, 10, 20, 6, 30));   // the server's 06:30 (courtReminders.js)
  });
  it('moves the morning reminder to 1 hour before an early hearing', () => {
    const p = g.planGuestReminders('2026-11-20', '07:00', NOW);
    expect(p[p.length - 1].at).toEqual(new Date(2026, 10, 20, 6, 0));
  });
  it('keeps 06:30 for a later hearing', () => {
    const p = g.planGuestReminders('2026-11-20', '13:00', NOW);
    expect(p[p.length - 1].at).toEqual(new Date(2026, 10, 20, 6, 30));
  });
  it('skips reminders that already passed', () => {
    const p = g.planGuestReminders('2026-10-28', null, NOW);
    expect(p.map(x => x.kind)).toEqual(['evening', 'morning']);
  });
  it('returns nothing for a bad date', () => {
    expect(g.planGuestReminders('nope', null, NOW)).toEqual([]);
  });
});

describe('isValidCourtDate', () => {
  it('accepts real days only', () => {
    expect(g.isValidCourtDate('2026-11-20')).toBe(true);
    expect(g.isValidCourtDate('2026-02-31')).toBe(false);
    expect(g.isValidCourtDate('11/20/2026')).toBe(false);
  });
});

describe('addGuestCourtDate / removeGuestCourtDate', () => {
  it('saves the date on the phone with one notification per reminder', async () => {
    const s = fakeScheduler();
    const out = await g.addGuestCourtDate({ court_date: '2026-11-20', court_time: '09:00', place: 'Room 4B' }, text, s, NOW);
    expect(out.reminders).toBe(4);
    const rows = await g.listGuestCourtDates();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ court_date: '2026-11-20', court_time: '09:00', place: 'Room 4B', notification_ids: ['n1', 'n2', 'n3', 'n4'] });
  });
  it('still saves the date when notifications are refused', async () => {
    const s = { schedule: jest.fn(async () => { throw new Error('denied'); }), cancel: jest.fn() };
    const out = await g.addGuestCourtDate({ court_date: '2026-11-20' }, text, s, NOW);
    expect(out.reminders).toBe(0);
    expect(await g.listGuestCourtDates()).toHaveLength(1);
  });
  it('rejects bad, past and duplicate dates with a code', async () => {
    const s = fakeScheduler();
    await expect(g.addGuestCourtDate({ court_date: '2026-13-01' }, text, s, NOW)).rejects.toMatchObject({ code: 'bad_date' });
    await expect(g.addGuestCourtDate({ court_date: '2026-11-20', court_time: '25:00' }, text, s, NOW)).rejects.toMatchObject({ code: 'bad_time' });
    await expect(g.addGuestCourtDate({ court_date: '2026-10-01' }, text, s, NOW)).rejects.toMatchObject({ code: 'past' });
    await g.addGuestCourtDate({ court_date: '2026-11-20' }, text, s, NOW);
    await expect(g.addGuestCourtDate({ court_date: '2026-11-20' }, text, s, NOW)).rejects.toMatchObject({ code: 'duplicate' });
  });
  it('accepts a court date later today', async () => {
    const s = fakeScheduler();
    await expect(g.addGuestCourtDate({ court_date: '2026-10-26', court_time: '15:00' }, text, s, NOW)).resolves.toMatchObject({ reminders: 0 });
  });
  it('removing a date cancels its notifications', async () => {
    const s = fakeScheduler();
    const { row } = await g.addGuestCourtDate({ court_date: '2026-11-20' }, text, s, NOW);
    await g.removeGuestCourtDate(row.id, s);
    expect(s.cancelled).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(await g.listGuestCourtDates()).toHaveLength(0);
  });
});

describe('migrateGuestCourtDates', () => {
  it('moves every date to the account and cancels the local reminders', async () => {
    const s = fakeScheduler();
    await g.addGuestCourtDate({ court_date: '2026-11-20', court_time: '09:00', place: 'Room 4B' }, text, s, NOW);
    await g.addGuestCourtDate({ court_date: '2026-12-04' }, text, s, NOW);
    const posts = [];
    const out = await g.migrateGuestCourtDates(async (b) => { posts.push(b); }, 'My court date', s);
    expect(out).toEqual({ moved: 2, kept: 0 });
    expect(posts[0]).toEqual({ case_title: 'My court date', court_date: '2026-11-20', court_time: '09:00', location: 'Room 4B' });
    expect(s.cancelled).toHaveLength(8);
    expect(await g.listGuestCourtDates()).toHaveLength(0);
  });
  it('counts a date the server already has (409) as moved', async () => {
    const s = fakeScheduler();
    await g.addGuestCourtDate({ court_date: '2026-11-20' }, text, s, NOW);
    const out = await g.migrateGuestCourtDates(async () => { const e = new Error('dup'); e.response = { status: 409 }; throw e; }, 'x', s);
    expect(out).toEqual({ moved: 1, kept: 0 });
  });
  it('keeps a date on the phone, reminders intact, when the upload fails', async () => {
    const s = fakeScheduler();
    await g.addGuestCourtDate({ court_date: '2026-11-20' }, text, s, NOW);
    const out = await g.migrateGuestCourtDates(async () => { throw new Error('offline'); }, 'x', s);
    expect(out).toEqual({ moved: 0, kept: 1 });
    expect(s.cancelled).toHaveLength(0);
    expect((await g.listGuestCourtDates())[0].notification_ids).toHaveLength(4);
  });
});

describe('deviceScheduler (debug scan Oct 30, issue 8)', () => {
  it('schedules on the court_reminders channel, and a tap opens Court dates', async () => {
    const calls = [];
    jest.resetModules();
    jest.doMock('expo-notifications', () => ({
      __esModule: true,
      SchedulableTriggerInputTypes: { DATE: 'date' },
      scheduleNotificationAsync: jest.fn(async (req) => { calls.push(req); return 'id-1'; }),
      cancelScheduledNotificationAsync: jest.fn(async () => {}),
    }));
    const fresh = require('../services/guestCourtDates');
    const when = new Date(2026, 10, 19, 18, 0);
    expect(await fresh.deviceScheduler.schedule(when, 'Court', 'Tomorrow')).toBe('id-1');
    expect(calls[0].trigger).toEqual({ type: 'date', date: when, channelId: 'court_reminders' });
    expect(calls[0].content.data).toEqual({ kind: 'guest_court_reminder', screen: 'CourtDates' });
    const { notificationTarget } = require('../services/notificationRoute');
    expect(notificationTarget(calls[0].content.data)).toEqual({ screen: 'CourtDates' });
  });
});
