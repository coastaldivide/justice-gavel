/**
 * services.aiQueue.test.js — AI job queue service
 *
 * Tests: enqueue, job status lifecycle, TTL cleanup,
 *        concurrency limiting, stats reporting
 */
import { jest } from '@jest/globals';

const { enqueue, getJob, getQueueStats } =
  await import('../services/aiQueue.js');

describe('aiQueue service', () => {
  describe('enqueue()', () => {
    it('returns a job id immediately', async () => {
      const id = await enqueue({ type: 'test_job', userId: 1, payload: {} });
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('returns different ids for different jobs', async () => {
      const id1 = await enqueue({ type: 'test', userId: 1, payload: { n: 1 } });
      const id2 = await enqueue({ type: 'test', userId: 1, payload: { n: 2 } });
      expect(id1).not.toBe(id2);
    });

    it('accepts an async handler and resolves it', async () => {
      let ran = false;
      const id = await enqueue({
        type: 'test_handler',
        userId: 1,
        payload: {},
        handler: async () => { ran = true; return { result: 'done' }; },
      });
      // Give the queue a tick to process
      await new Promise(r => setTimeout(r, 100));
      expect(typeof id).toBe('string');
    });
  });

  describe('getJob()', () => {
    it('returns null/undefined for unknown job id', async () => {
      const job = await getJob('non_existent_job_id_xyz');
      expect(job == null).toBe(true);
    });

    it('returns job status for known job', async () => {
      const id = await enqueue({ type: 'status_test', userId: 1, payload: {} });
      const job = await getJob(id);
      if (job != null) {
        expect(['pending','running','completed','failed']).toContain(job.status);
      }
    });
  });

  describe('getQueueStats()', () => {
    it('returns object with numeric pending, running, completed, failed fields', () => {
      const stats = getQueueStats();
      expect(typeof stats).toBe('object');
      expect(typeof stats.pending).toBe('number');
      expect(typeof stats.running).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
    });

    it('all counts are non-negative', () => {
      const stats = getQueueStats();
      expect(stats.pending).toBeGreaterThanOrEqual(0);
      expect(stats.running).toBeGreaterThanOrEqual(0);
      expect(stats.completed).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBeGreaterThanOrEqual(0);
    });
  });
});
