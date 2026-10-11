/**
 * arrest_monitors.test.js — the Pro "Arrest Monitor" feature actually runs.
 *
 * Before step 6, monitors were CRUD-only: no job ever matched them against
 * arrest_records, and the columns the app renders (last_checked, last_result)
 * did not exist. services/arrest_alerts.js now checks every active monitor
 * during the nightly alert run (migration 11 adds the columns):
 *   - matches push-notify the monitor's owner;
 *   - every monitor gets last_checked / last_result stamped, even on runs
 *     with zero new arrests, so the app's "Last checked" is honest.
 */
import { jest } from '@jest/globals';

describe('monitorMatches — pure matching rules', () => {
  let monitorMatches;
  beforeAll(async () => {
    ({ monitorMatches } = await import('../services/arrest_alerts.js'));
  });

  const arrest = { name: 'SMITH, JOHN A', county: 'Davidson', state: 'TN' };

  test('every word of the watched name must appear, any order/case', () => {
    expect(monitorMatches({ watch_name: 'John Smith' }, arrest)).toBe(true);
    expect(monitorMatches({ watch_name: 'smith' }, arrest)).toBe(true);
    expect(monitorMatches({ watch_name: 'John Doe' }, arrest)).toBe(false);
    expect(monitorMatches({ watch_name: '' }, arrest)).toBe(false);
    expect(monitorMatches({}, arrest)).toBe(false);
  });

  test('county filter: exact (case-insensitive), "All" or empty = any', () => {
    expect(monitorMatches({ watch_name: 'john', county: 'davidson' }, arrest)).toBe(true);
    expect(monitorMatches({ watch_name: 'john', county: 'All' }, arrest)).toBe(true);
    expect(monitorMatches({ watch_name: 'john', county: 'Shelby' }, arrest)).toBe(false);
  });

  test('state filter applies only when both sides have a state', () => {
    expect(monitorMatches({ watch_name: 'john', state: 'TN' }, arrest)).toBe(true);
    expect(monitorMatches({ watch_name: 'john', state: 'GA' }, arrest)).toBe(false);
    expect(monitorMatches({ watch_name: 'john', state: 'GA' }, { ...arrest, state: '' })).toBe(true);
  });
});

describe('sendArrestAlerts — monitors are checked and stamped (fake DB)', () => {
  const makeFakeDb = (state) => ({
    async all(sql) {
      if (/FROM arrest_records/.test(sql)) return state.newArrests;
      if (/FROM arrest_monitors/.test(sql)) return state.monitors;
      if (/FROM lawyers/.test(sql)) return [];
      if (/FROM bail_agents/.test(sql)) return [];
      throw new Error(`unexpected all: ${sql}`);
    },
    async run(sql, p = []) {
      if (/UPDATE arrest_monitors SET last_checked = NOW\(\), last_result = \?/.test(sql)) {
        const m = state.monitors.find(x => x.id === p[1]);
        m.last_result = p[0];
        m.last_checked = 'now';
        return { changes: 1 };
      }
      if (/UPDATE arrest_records SET alert_sent = 1/.test(sql)) return { changes: p.length };
      if (/INSERT INTO attorney_alerts/.test(sql)) return { changes: 1 };
      throw new Error(`unexpected run: ${sql}`);
    },
    async get() { return undefined; },
  });

  async function runWith(state) {
    jest.resetModules();
    const pushes = [];
    jest.unstable_mockModule('../db/index.js', () => ({
      getDb: async () => makeFakeDb(state),
      db: {},
    }));
    jest.unstable_mockModule('../services/pushDelivery.js', () => ({
      sendPushToUser: async (userId, payload) => { pushes.push({ userId, payload }); return true; },
    }));
    const { sendArrestAlerts } = await import('../services/arrest_alerts.js');
    const result = await sendArrestAlerts();
    return { result, pushes };
  }

  test('a matching monitor push-notifies its owner and records "found"', async () => {
    const state = {
      newArrests: [{ id: 1, name: 'SMITH, JOHN A', county: 'Davidson', state: 'TN', charges: 'theft', bail_amount: 0, has_attorney: 0 }],
      monitors: [
        { id: 7, user_id: 42, watch_name: 'John Smith', county: '', state: 'TN' },
        { id: 8, user_id: 43, watch_name: 'Jane Roe',  county: '', state: '' },
      ],
    };
    const { result, pushes } = await runWith(state);
    expect(result.monitors_checked).toBe(2);
    expect(result.monitor_matches).toBe(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].userId).toBe(42);
    expect(pushes[0].payload.data).toEqual({ screen: 'ArrestMonitor' });
    expect(state.monitors[0]).toMatchObject({ last_result: 'found', last_checked: 'now' });
    expect(state.monitors[1]).toMatchObject({ last_result: 'none',  last_checked: 'now' });
  });

  test('zero new arrests still stamps last_checked on every monitor', async () => {
    const state = {
      newArrests: [],
      monitors: [{ id: 9, user_id: 50, watch_name: 'Someone Watched', county: '', state: '' }],
    };
    const { result, pushes } = await runWith(state);
    expect(result).toMatchObject({ alerts_sent: 0, monitors_checked: 1, monitor_matches: 0 });
    expect(pushes).toHaveLength(0);
    expect(state.monitors[0]).toMatchObject({ last_result: 'none', last_checked: 'now' });
  });
});
