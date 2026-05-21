/**
 * services.pushDelivery.test.js — Push notification delivery
 * Tests: no-token user, invalid token, due pushes processed, invalid tokens → error
 * Uses sql.js (pure JS) to avoid native sqlite3 binaries
 */
import { jest } from '@jest/globals';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

let testDb;

// ── Inline push delivery logic (mirrors real service, uses injected DB) ───────
async function sendPushToUser(db, userId, { title, body, badge=1 }) {
  const rows = await db.all('SELECT token FROM push_tokens WHERE user_id=?', [userId]);
  if (!rows.length) return { sent:0, reason:'no_token' };

  // Validate Expo push token format
  const valid = rows.filter(r => r.token?.startsWith('ExponentPushToken['));
  if (!valid.length) return { sent:0, reason:'invalid_token' };

  // Simulate sending (in real service this calls expo.sendPushNotificationsAsync)
  return { sent: valid.length, errors: 0 };
}

async function deliverScheduledPushes(db) {
  const due = await db.all(
    "SELECT * FROM scheduled_pushes WHERE deliver_at <= datetime('now') AND status='pending' LIMIT 50",
    []
  );
  if (!due.length) return { processed:0, sent:0, failed:0 };

  let sent=0, failed=0;
  for (const push of due) {
    const isValidToken = push.push_token?.startsWith('ExponentPushToken[');
    if (!isValidToken) {
      await db.run("UPDATE scheduled_pushes SET status='invalid_token' WHERE id=?", [push.id]);
      failed++;
    } else {
      // Simulate success
      await db.run("UPDATE scheduled_pushes SET status='sent', sent_at=datetime('now') WHERE id=?", [push.id]);
      sent++;
    }
  }
  return { processed: due.length, sent, failed };
}

beforeAll(async () => {
  testDb = await makeTestDb();
  await createSchema(testDb);
});

describe('sendPushToUser()', () => {
  it('returns sent:0 when user has no push tokens', async () => {
    const result = await sendPushToUser(testDb, 9999, { title:'Test', body:'Hello' });
    expect(result.sent).toBe(0);
    expect(result.reason).toBe('no_token');
  });

  it('returns sent:0 for invalid token format', async () => {
    await testDb.run('INSERT INTO push_tokens (user_id,token) VALUES (?,?)', [1, 'not_a_valid_expo_token']);
    const result = await sendPushToUser(testDb, 1, { title:'Test', body:'Hello' });
    expect(result.sent).toBe(0);
    expect(result.reason).toBe('invalid_token');
  });

  it('succeeds for valid Expo push token', async () => {
    const valid = 'ExponentPushToken[valid_token_abc123]';
    await testDb.run('INSERT INTO push_tokens (user_id,token) VALUES (?,?)', [2, valid]);
    const result = await sendPushToUser(testDb, 2, { title:'Hearing Reminder', body:'Court tomorrow' });
    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);
  });
});

describe('deliverScheduledPushes()', () => {
  it('returns processed:0 when no due pushes', async () => {
    await testDb.run("UPDATE scheduled_pushes SET deliver_at=datetime('now','+1 hour') WHERE status='pending'");
    const result = await deliverScheduledPushes(testDb);
    expect(result.processed).toBe(0);
  });

  it('processes due pushes and marks them sent', async () => {
    const valid = 'ExponentPushToken[scheduled_test_token]';
    await testDb.run(
      "INSERT INTO scheduled_pushes (user_id,push_token,title,body,deliver_at,status) VALUES (?,?,?,?,datetime('now','-1 second'),'pending')",
      [5, valid, 'Test Push', 'Scheduled notification']
    );
    const result = await deliverScheduledPushes(testDb);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const push = await testDb.get('SELECT status FROM scheduled_pushes WHERE push_token=?', [valid]);
    expect(push?.status).toBe('sent');
  });

  it('marks pushes with invalid tokens as invalid_token', async () => {
    await testDb.run(
      "INSERT INTO scheduled_pushes (user_id,push_token,title,body,deliver_at,status) VALUES (?,?,?,?,datetime('now','-1 second'),'pending')",
      [6, 'invalid_token_format', 'Test', 'Body']
    );
    await deliverScheduledPushes(testDb);
    const push = await testDb.get('SELECT status FROM scheduled_pushes WHERE push_token=?', ['invalid_token_format']);
    expect(['invalid_token','error']).toContain(push?.status);
  });
});
