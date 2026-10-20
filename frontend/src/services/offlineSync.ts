/**
 * offlineSync.ts — Offline-first write queue for case creation
 *
 * When a user creates a case without internet, it is written to
 * expo-sqlite locally, shown immediately in the UI, and synced
 * to the backend when connectivity returns.
 */
import * as SQLite from 'expo-sqlite';
import NetInfo from '@react-native-community/netinfo';
import { api } from './api';
import { isRetryableSyncError } from './syncErrors';

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('jg_offline_queue.db');
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_id     TEXT    NOT NULL,
      endpoint    TEXT    NOT NULL,
      method      TEXT    NOT NULL DEFAULT 'POST',
      body        TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      synced_at   TEXT,
      error       TEXT
    );
    CREATE TABLE IF NOT EXISTS offline_cases (
      id          TEXT    PRIMARY KEY,
      data        TEXT    NOT NULL,
      synced      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return _db;
}

/** Save a case locally when offline. Returns a temp ID string. */
let _offlineSeq = 0;
export async function saveCaseOffline(caseData: Record<string, unknown>): Promise<string> {
  const d = await getDb();
  const tempId = `offline_${Date.now()}_${++_offlineSeq}`;
  const full = { ...caseData, id: tempId, _offline: true, created_at: new Date().toISOString() };
  await d.runAsync('INSERT INTO offline_cases (id, data) VALUES (?, ?)',
    [tempId, JSON.stringify(full)]);
  await d.runAsync(
    'INSERT INTO sync_queue (temp_id, endpoint, method, body) VALUES (?,?,?,?)',
    [tempId, '/cases', 'POST', JSON.stringify(caseData)]
  );
  return tempId;
}

/** Remove every queued / offline case (sign-out: the next person must not see or send them). */
export async function clearOfflineData(): Promise<void> {
  const d = await getDb();
  await d.execAsync('DELETE FROM sync_queue; DELETE FROM offline_cases;');
}

/** Get all pending offline cases. */
export async function getOfflineCases(): Promise<unknown[]> {
  try {
    const d = await getDb();
    const rows = await d.getAllAsync<{ data: string }>(
      'SELECT data FROM offline_cases WHERE synced=0 ORDER BY created_at DESC'
    );
    return rows.map(r => JSON.parse(r.data));
  } catch { return []; }
}

async function markSynced(tempId: string): Promise<void> {
  const d = await getDb();
  await d.runAsync('UPDATE offline_cases SET synced=1 WHERE id=?', [tempId]);
  await d.runAsync('UPDATE sync_queue SET status=?,synced_at=? WHERE temp_id=?',
    ['synced', new Date().toISOString(), tempId]);
}

let _inFlight: Promise<{ synced: number; failed: number }> | null = null;

/**
 * Process the sync queue — on reconnect and on app start. One run at a time
 * (App.tsx and CaseScreen both listen for reconnects): a second caller gets
 * the run already in progress instead of posting the same case twice.
 */
export function processSyncQueue(
  onCaseSynced?: (tempId: string, serverId: number) => void
): Promise<{ synced: number; failed: number }> {
  if (_inFlight) return _inFlight;
  _inFlight = runSyncQueue(onCaseSynced).finally(() => { _inFlight = null; });
  return _inFlight;
}

async function runSyncQueue(
  onCaseSynced?: (tempId: string, serverId: number) => void
): Promise<{ synced: number; failed: number }> {
  let synced = 0, failed = 0;
  try {
    const d = await getDb();
    // A run cut short (app killed mid-request) left rows in 'syncing'.
    await d.runAsync('UPDATE sync_queue SET status=? WHERE status=?', ['pending', 'syncing']);
    const pending = await d.getAllAsync<{
      id: number; temp_id: string; endpoint: string; method: string; body: string;
    }>('SELECT * FROM sync_queue WHERE status=? ORDER BY id ASC', ['pending']);
    for (const item of pending) {
      try {
        await d.runAsync('UPDATE sync_queue SET status=? WHERE id=?', ['syncing', item.id]);
        const body = JSON.parse(item.body);
        const res = await api.post(item.endpoint, body);
        await markSynced(item.temp_id);
        if (item.endpoint === '/cases' && res.data?.id && onCaseSynced) {
          onCaseSynced(item.temp_id, res.data.id);
        }
        synced++;
      } catch (e: unknown) {
        failed++;
        const retry = isRetryableSyncError(e);
        await d.runAsync('UPDATE sync_queue SET status=?,error=? WHERE id=?',
          [retry ? 'pending' : 'failed', String((e as Error)?.message || e), item.id]);
        if (retry) break;   // still offline / server down: try the rest on the next reconnect
      }
    }
  } catch { /* the local database is unavailable — nothing queued can be read */ }
  return { synced, failed };
}

/** Start NetInfo listener — syncs the queue when the app is (or comes back) online. */
export function startSyncListener(
  onCaseSynced?: (tempId: string, serverId: number) => void
): () => void {
  let wasOnline: boolean | null = null;
  return NetInfo.addEventListener(state => {
    const nowOnline = state.isConnected === true;
    if (nowOnline && wasOnline !== true) processSyncQueue(onCaseSynced).catch(() => {});
    wasOnline = nowOnline;
  });
}
