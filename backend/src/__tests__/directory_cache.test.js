/**
 * directoryCache: one DB query per TTL window, single flight on concurrent misses,
 * independent copies per caller (the search annotates rows), invalidation, errors
 * not cached, and TTL 0 = pass-through.
 */
import { jest } from '@jest/globals';
import { directoryRows, invalidateDirectory } from '../services/directoryCache.js';

const SQL = 'SELECT id, name FROM lawyers l WHERE COALESCE(l.active, 1) = 1';
function fakeDb(rows = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]) {
  return { all: jest.fn(async () => { await new Promise(r => setTimeout(r, 5)); return rows.map(r => ({ ...r })); }) };
}

beforeEach(() => { invalidateDirectory(); process.env.DIRECTORY_CACHE_TTL_MS = '60000'; });
afterAll(() => { delete process.env.DIRECTORY_CACHE_TTL_MS; });

test('repeat reads within the TTL hit the database once', async () => {
  const db = fakeDb();
  await directoryRows(db, SQL); await directoryRows(db, SQL); await directoryRows(db, SQL);
  expect(db.all).toHaveBeenCalledTimes(1);
});

test('concurrent misses share one query', async () => {
  const db = fakeDb();
  const out = await Promise.all(Array.from({ length: 10 }, () => directoryRows(db, SQL)));
  expect(db.all).toHaveBeenCalledTimes(1);
  expect(out.every(r => r.length === 2)).toBe(true);
});

test('each caller gets its own row objects (search annotations do not leak)', async () => {
  const db = fakeDb();
  const a = await directoryRows(db, SQL);
  a[0]._dist = 12.5;
  const b = await directoryRows(db, SQL);
  expect(b[0]._dist).toBeUndefined();
  expect(b[0]).not.toBe(a[0]);
});

test('invalidateDirectory forces a fresh read', async () => {
  const db = fakeDb();
  await directoryRows(db, SQL);
  invalidateDirectory();
  await directoryRows(db, SQL);
  expect(db.all).toHaveBeenCalledTimes(2);
});

test('a failed query is not cached', async () => {
  const db = { all: jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue([{ id: 1 }]) };
  await expect(directoryRows(db, SQL)).rejects.toThrow('db down');
  await expect(directoryRows(db, SQL)).resolves.toEqual([{ id: 1 }]);
  expect(db.all).toHaveBeenCalledTimes(2);
});

test('TTL 0 passes every read through', async () => {
  process.env.DIRECTORY_CACHE_TTL_MS = '0';
  const db = fakeDb();
  await directoryRows(db, SQL); await directoryRows(db, SQL);
  expect(db.all).toHaveBeenCalledTimes(2);
});

test('different queries are cached separately', async () => {
  const db = fakeDb();
  await directoryRows(db, SQL); await directoryRows(db, SQL + " AND phone <> ''");
  expect(db.all).toHaveBeenCalledTimes(2);
});
