/**
 * offlineSync.web.ts — web implementation of the offline write queue.
 *
 * expo-sqlite has no native module on web (it needs the experimental WASM
 * build), so the web bundle keeps the same queue in AsyncStorage
 * (localStorage). Same exports and behaviour as offlineSync.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { api } from './api';
import { isRetryableSyncError } from './syncErrors';

const CASES_KEY = 'jg_offline_cases';
const QUEUE_KEY = 'jg_sync_queue';

interface QueueItem {
  temp_id: string;
  endpoint: string;
  method: string;
  body: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}
interface OfflineCase { id: string; data: Record<string, unknown>; synced: boolean }

async function read<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
async function write<T>(key: string, value: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

let _offlineSeq = 0;

/** Save a case locally when offline. Returns a temp ID string. */
export async function saveCaseOffline(caseData: Record<string, unknown>): Promise<string> {
  const tempId = `offline_${Date.now()}_${++_offlineSeq}`;
  const full = { ...caseData, id: tempId, _offline: true, created_at: new Date().toISOString() };
  const cases = await read<OfflineCase>(CASES_KEY);
  cases.unshift({ id: tempId, data: full, synced: false });
  await write(CASES_KEY, cases);
  const queue = await read<QueueItem>(QUEUE_KEY);
  queue.push({ temp_id: tempId, endpoint: '/cases', method: 'POST', body: JSON.stringify(caseData), status: 'pending' });
  await write(QUEUE_KEY, queue);
  return tempId;
}

/** Get all pending offline cases. */
export async function getOfflineCases(): Promise<unknown[]> {
  const cases = await read<OfflineCase>(CASES_KEY);
  return cases.filter(c => !c.synced).map(c => c.data);
}

let _inFlight: Promise<{ synced: number; failed: number }> | null = null;

/** Same contract as offlineSync.ts: one run at a time; retryable failures stay queued. */
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
  const queue = (await read<QueueItem>(QUEUE_KEY)).map(i => (i.status === 'syncing' ? { ...i, status: 'pending' as const } : i));
  for (const item of queue) {
    if (item.status !== 'pending') continue;
    try {
      item.status = 'syncing';
      const res = await api.post(item.endpoint, JSON.parse(item.body));
      item.status = 'synced';
      const cases = await read<OfflineCase>(CASES_KEY);
      await write(CASES_KEY, cases.map(c => (c.id === item.temp_id ? { ...c, synced: true } : c)));
      if (item.endpoint === '/cases' && res.data?.id && onCaseSynced) onCaseSynced(item.temp_id, res.data.id);
      synced++;
    } catch (e) {
      failed++;
      const retry = isRetryableSyncError(e);
      item.status = retry ? 'pending' : 'failed';
      item.error = String((e as Error)?.message || e);
      if (retry) break;
    }
  }
  await write(QUEUE_KEY, queue.filter(i => i.status !== 'synced'));
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
