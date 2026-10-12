/**
 * Scheduler wiring (step 12): with LIVE_REFRESH=true, startScheduler() registers
 * the nightly cron job, and that job's data-refresh step runs the in-process
 * Postgres path (services/dataRefresh) — a new provider lands in lawyers, the
 * run is logged in scrape_runs with trigger 'scheduler'. Without
 * GOOGLE_PLACES_KEY / YELP_API_KEY the step is skipped with a log line and a
 * 'skipped' run row. Nothing spawns the old SQLite scripts.
 *
 * node-cron is replaced by a recorder (no real timers); the unrelated nightly
 * services (alerts, outbound bot, golden gavel, retention, health scan,
 * reminder dispatcher) are stubbed so the test only touches its own fixture
 * rows. Google Places is mocked through globalThis.fetch.
 * PG-gated (TEST_DATABASE_URL).
 */
import { jest } from '@jest/globals';
import { placesMock } from './_places_mock.js';

const PG_URL = process.env.TEST_DATABASE_URL || '';
const describePg = PG_URL ? describe : describe.skip;

const scheduled = [];
const fakeTask = () => ({ destroy: jest.fn(), stop: jest.fn(), start: jest.fn(), getNextRun: () => new Date(Date.now() + 3_600_000) });
jest.unstable_mockModule('node-cron', () => {
  const api = {
    validate: () => true,
    schedule: jest.fn((expr, fn, opts) => { scheduled.push({ expr, fn, opts }); return fakeTask(); }),
  };
  return { default: api, ...api };
});
const stub = (names) => Object.fromEntries(names.map(n => [n, jest.fn(async () => ({}))]));
jest.unstable_mockModule('../../services/arrest_alerts.js', () => ({
  sendArrestAlerts: jest.fn(async () => ({ alerts_sent: 0, arrests_processed: 0 })),
}));
jest.unstable_mockModule('../../services/outbound_bot.js', () => ({
  runOutboundBot: jest.fn(async () => ({ skipped: true, reason: 'test' })),
  expireOldPaymentLinks: jest.fn(async () => ({ expired: 0 })),
}));
jest.unstable_mockModule('../../routes/golden_gavel.js', () => ({ default: {}, processGoldenGavelAward: jest.fn(async () => null) }));
jest.unstable_mockModule('../../services/retention.js', () => ({
  archiveCompletedDocketEntries: jest.fn(async () => ({ archived: 0 })),
  checkAccountInactivity: jest.fn(async () => ({ alerted: 0 })),
}));
jest.unstable_mockModule('../../services/healthScan.js', () => ({ ...stub(['runHealthScan']), startHealthScanScheduler: jest.fn(), stopHealthScanScheduler: jest.fn(), default: {} }));
jest.unstable_mockModule('../../services/reminderDispatcher.js', () => ({ startReminderDispatcher: jest.fn(), stopReminderDispatcher: jest.fn() }));

describePg('scheduler (LIVE_REFRESH=true) → Postgres data refresh', () => {
  const tag = `JGTEST_sched_${Date.now().toString(36)}`;
  const g = placesMock();
  const saved = {};
  let scheduler; let db; let realFetch; let since;

  beforeAll(async () => {
    for (const k of ['LIVE_REFRESH', 'DATABASE_URL', 'GOOGLE_PLACES_KEY', 'YELP_API_KEY', 'GOOGLE_PLACES_MIN_INTERVAL_MS', 'ARREST_FEED_URLS']) saved[k] = process.env[k];
    process.env.LIVE_REFRESH = 'true';
    process.env.DATABASE_URL = PG_URL;
    process.env.GOOGLE_PLACES_KEY = 'test-places-key';
    process.env.GOOGLE_PLACES_MIN_INTERVAL_MS = '0';
    delete process.env.YELP_API_KEY;
    delete process.env.ARREST_FEED_URLS;
    realFetch = globalThis.fetch;
    globalThis.fetch = g.fetch;
    // Wednesday: the Sunday-only steps (bar listings over every city) stay out of this test
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(3);

    g.add({ place_id: `${tag}_a`, name: `Jgtest Nightly Law ${tag}`, formatted_address: '9 Broad St, Nashville, TN 37203, USA',
      formatted_phone_number: '(615) 555-7301', rating: 4.4, user_ratings_total: 9 },
    ['criminal defense lawyer nashville tn']);

    const dbMod = await import('../../db/index.js');
    db = await dbMod.getDb();
    since = (await db.get('SELECT COALESCE(MAX(id), 0)::bigint AS m FROM scrape_runs')).m;
    scheduler = await import('../../services/scheduler.js');
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    scheduler?.stopScheduler();
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
    const runs = (await db.all(`SELECT id FROM scrape_runs WHERE id > ? AND trigger = 'scheduler'`, [since])).map(r => Number(r.id));
    await db.run(`DELETE FROM provider_update_proposals WHERE run_id = ANY(?::bigint[])`, [runs]);
    await db.run(`DELETE FROM lawyers WHERE source_id LIKE ?`, [`%${tag}%`]);
    await db.run(`DELETE FROM scrape_runs WHERE id = ANY(?::bigint[])`, [runs]);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    const { closeDb } = await import('../../db/index.js');
    await closeDb();
  });

  it('startScheduler registers the nightly job on REFRESH_CRON', () => {
    scheduler.startScheduler();
    const nightly = scheduled.find(s => s.expr === (process.env.REFRESH_CRON || '0 3 * * *'));
    expect(nightly).toBeTruthy();
    expect(nightly.fn).toBe(scheduler.runNightlyJob);
  });

  it('the nightly job writes the main Postgres database (new provider + scrape_runs row)', async () => {
    const nightly = scheduled.find(s => s.fn === scheduler.runNightlyJob);
    await nightly.fn();
    const row = await db.get('SELECT * FROM lawyers WHERE source_id = ?', [`google_${tag}_a`]);
    expect(row).toMatchObject({ name: `Jgtest Nightly Law ${tag}`, city: 'Nashville', state: 'TN', phone: '+16155557301', source: 'google', active: 1, verified: 0 });
    const runs = await db.all(`SELECT job, status, inserted, trigger, message FROM scrape_runs WHERE id > ? AND trigger = 'scheduler' ORDER BY id`, [since]);
    expect(runs.find(r => r.job === 'providers')).toMatchObject({ status: 'ok', inserted: 1 });
    expect(runs.find(r => r.job === 'arrest_feeds')).toMatchObject({ status: 'skipped' });
    expect(g.calls.some(c => c.includes('/textsearch/json'))).toBe(true);
  }, 60_000);

  it('with no Places / Yelp key the provider step is skipped with a logged run (no request made)', async () => {
    delete process.env.GOOGLE_PLACES_KEY;
    const calls = g.calls.length;
    const out = await scheduler.runScheduledDataRefresh({ isSunday: false });
    expect(out.providers.status).toBe('skipped');
    expect(g.calls.length).toBe(calls);
    const r = await db.get('SELECT status, message FROM scrape_runs WHERE id = ?', [out.providers.runId]);
    expect(r.status).toBe('skipped');
    expect(r.message).toMatch(/GOOGLE_PLACES_KEY/);
    process.env.GOOGLE_PLACES_KEY = 'test-places-key';
  });
});
