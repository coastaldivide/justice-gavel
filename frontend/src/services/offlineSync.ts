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
export async function saveCaseOffline(caseData: Record<string, unknown>): Promise<string> {
  const d = await getDb();
  const tempId = `offline_${Date.now()}`;
  const full = { ...caseData, id: tempId, _offline: true, created_at: new Date().toISOString() };
  await d.runAsync('INSERT INTO offline_cases (id, data) VALUES (?, ?)',
    [tempId, JSON.stringify(full)]);
  await d.runAsync(
    'INSERT INTO sync_queue (temp_id, endpoint, method, body) VALUES (?,?,?,?)',
    [tempId, '/cases', 'POST', JSON.stringify(caseData)]
  );
  return tempId;
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

/** Process the sync queue — call when connectivity is restored. */
export async function processSyncQueue(
  onCaseSynced?: (tempId: string, serverId: number) => void
): Promise<{ synced: number; failed: number }> {
  let synced = 0, failed = 0;
  try {
    const d = await getDb();
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
      } catch (e: any) {
        failed++;
        const d2 = await getDb();
        await d2.runAsync('UPDATE sync_queue SET status=?,error=? WHERE id=?',
          ['failed', String(e), item.id]);
      }
    }
  } catch {}
  return { synced, failed };
}

/** Start NetInfo listener — auto-syncs queue on reconnect. */
export function startSyncListener(
  onCaseSynced?: (tempId: string, serverId: number) => void
): () => void {
  let wasOffline = false;
  return NetInfo.addEventListener(state => {
    const nowOnline = state.isConnected === true;
    if (wasOffline && nowOnline) {
      processSyncQueue(onCaseSynced).catch(() => {});
    }
    wasOffline = !nowOnline;
  });
}
