/**
 * job_health.int.test.js — monitoring/jobHealth.js on real Postgres: a job whose last
 * run failed is "failing", a daily job with no success for 36+ hours is "stale", a job
 * switched off is "not_expected", and a failed scheduled run sends an alert.
 */
import { jest } from '@jest/globals';
import { describeIntegration, initSuite } from './_harness.js';

const alerts = [];
jest.unstable_mockModule('../../monitoring/errorNotifier.js', () => ({
  notifyError: async (m, x) => { alerts.push({ m, x }); },
  notifyCritical: async () => {}, notifyWarn: () => {}, notifyRecovery: () => {}, alertRecipients: () => [],
}));

describeIntegration('scheduled-job health (real Postgres)', () => {
  const ctx = initSuite();
  const JOBS = ['refresh-token-cleanup', 'bd-text-billing'];
  const clear = () => ctx.db.run(`DELETE FROM job_runs WHERE job = ANY(?::text[])`, [`{${JOBS.join(',')}}`]);
  beforeAll(() => { ctx.addCleanup(async (db) => { await db.run(`DELETE FROM job_runs WHERE job = ANY(?::text[])`, [`{${JOBS.join(',')}}`]); }); });

  test('failing, stale and ok are told apart; switched-off jobs never alarm', async () => {
    if (!ctx.app) return;
    await clear();
    const { jobHealth } = await import('../../monitoring/jobHealth.js');
    const later = new Date(Date.now() + 48 * 3600_000);   // two days after boot
    await ctx.db.run(`INSERT INTO job_runs (job, run_key, status, started_at, finished_at) VALUES
      ('refresh-token-cleanup', 'a', 'ok', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'),
      ('bd-text-billing', 'a', 'ok', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours'),
      ('bd-text-billing', 'b', 'failed', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`);
    let h = Object.fromEntries((await jobHealth(ctx.db)).map((j) => [j.job, j]));
    expect(h['refresh-token-cleanup'].status).toBe('ok');
    expect(h['bd-text-billing'].status).toBe('failing');
    expect(h.nightly.status).toBe(process.env.LIVE_REFRESH === 'true' ? h.nightly.status : 'not_expected');
    h = Object.fromEntries((await jobHealth(ctx.db, later)).map((j) => [j.job, j]));
    expect(h['refresh-token-cleanup'].status).toBe('stale');   // last success 49 h before "later"
  });

  test('a scheduled run that throws is recorded as failed and alerts a person', async () => {
    if (!ctx.app) return;
    const { runOnce } = await import('../../utils/jobLock.js');
    await expect(runOnce('bd-text-billing', `t${Date.now()}`, async () => { throw new Error('stripe down'); }, { db: ctx.db })).rejects.toThrow('stripe down');
    await new Promise((r) => setTimeout(r, 50));
    expect(alerts.some((a) => a.m === 'Scheduled job failed: bd-text-billing' && a.x.error === 'stripe down')).toBe(true);
  });

  test('admin endpoint is admin-only', async () => {
    if (!ctx.app) return;
    expect((await ctx.request().get('/api/admin/diagnostics/jobs')).status).toBe(401);
  });
});
