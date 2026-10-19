/**
 * scheduled_jobs.test.js — checklist items 29 + 31: scheduled jobs don't
 * overlap, failures are alerted (not just lost in a log), and each job's
 * health is visible on /metrics.
 *
 * Before: scheduleGuarded() passed the handler straight to node-cron — an
 * overrunning job stacked a second copy every tick, and a job that threw
 * produced an unhandled rejection with no alert and no record.
 */
import { jest } from '@jest/globals';
import http from 'http';
import request from 'supertest';
import { guardJob, getJobStats } from '../utils/cronGuard.js';

test('a run still in progress makes the next tick skip (no overlap)', async () => {
  let release;
  const body = jest.fn()
    .mockImplementationOnce(() => new Promise(r => { release = r; }))
    .mockImplementation(() => Promise.resolve());
  const job = guardJob('test-overlap', body);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const first = job();
    await job();           // tick while the first is running
    await job();
    expect(body).toHaveBeenCalledTimes(1);
    release();
    await first;
    await job();           // after it finished, the next tick runs
    expect(body).toHaveBeenCalledTimes(2);
    expect(getJobStats()['test-overlap']).toMatchObject({ runs: 2, skipped: 2, failures: 0, running: false });
  } finally { warn.mockRestore(); }
});

test('a failing run is recorded and alerted (SEV-2 webhook), and the scheduler keeps going', async () => {
  const bodies = [];
  const srv = http.createServer((req, res) => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => { bodies.push(d); res.end('ok'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${srv.address().port}/hook`;
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const job = guardJob(`test-fail-${Date.now()}`, () => Promise.reject(new Error('nightly import exploded')));
    await expect(job()).resolves.toBeUndefined();     // never throws into node-cron
    const label = Object.keys(getJobStats()).find(k => k.startsWith('test-fail-'));
    expect(getJobStats()[label]).toMatchObject({ runs: 1, failures: 1, last_error: 'nightly import exploded', last_ok_at: null });
    expect(bodies.join()).toMatch(/SEV-2 Error.*Scheduled job failed: test-fail-/);
  } finally {
    err.mockRestore();
    delete process.env.ALERT_WEBHOOK_URL;
    await new Promise(r => srv.close(r));
  }
});

test('/metrics exposes per-job health', async () => {
  const { default: app } = await import('../app.js');
  const r = await request(app).get('/metrics');
  expect(r.status).toBe(200);
  expect(r.body.jobs['test-overlap']).toMatchObject({ runs: 2, skipped: 2 });
}, 60_000);
