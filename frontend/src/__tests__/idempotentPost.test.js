/**
 * idempotentPost.test.js — checklist item 24 (app side): POSTs to create
 * endpoints carry an Idempotency-Key, and a request whose answer never
 * arrived (dropped connection / timeout) is retried with the SAME key, so the
 * server replays the first result instead of creating a duplicate. Other
 * POSTs (login, payments) are never retried.
 */
const mockRequest = jest.fn();
jest.mock('axios', () => {
  const inst = {
    request: (...a) => mockRequest(...a),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: () => inst }, create: () => inst };
});
jest.mock('../utils/secureStorage', () => ({ getToken: jest.fn(), clearAuth: jest.fn(), setToken: jest.fn() }));

const { api } = require('../services/api');
const { isIdempotentPost } = require('../constants/idempotency');

const netErr = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

beforeEach(() => { mockRequest.mockReset(); jest.useRealTimers(); });

test('create endpoints are recognised; auth/payments are not', () => {
  expect(isIdempotentPost('/cases')).toBe(true);
  expect(isIdempotentPost('/cases/42/events')).toBe(true);
  expect(isIdempotentPost('/messages/9')).toBe(true);
  expect(isIdempotentPost('/auth/login')).toBe(false);
  expect(isIdempotentPost('/billing/subscribe')).toBe(false);
});

test('a dropped POST /cases is retried with the same Idempotency-Key', async () => {
  mockRequest.mockRejectedValueOnce(netErr()).mockResolvedValueOnce({ data: { id: 7 } });
  const res = await api.post('/cases', { title: 'x' });
  expect(res.data.id).toBe(7);
  expect(mockRequest).toHaveBeenCalledTimes(2);
  const k1 = mockRequest.mock.calls[0][0].headers['Idempotency-Key'];
  const k2 = mockRequest.mock.calls[1][0].headers['Idempotency-Key'];
  expect(k1).toMatch(/^[0-9a-f-]{36}$/);
  expect(k2).toBe(k1);
}, 10_000);

test('each new submission gets a new key', async () => {
  mockRequest.mockResolvedValue({ data: {} });
  await api.post('/cases', { title: 'a' });
  await api.post('/cases', { title: 'b' });
  expect(mockRequest.mock.calls[0][0].headers['Idempotency-Key']).not.toBe(mockRequest.mock.calls[1][0].headers['Idempotency-Key']);
});

test('a 4xx answer is not retried; login is never retried or keyed', async () => {
  mockRequest.mockRejectedValueOnce(Object.assign(new Error('bad'), { response: { status: 400, data: {} } }));
  await expect(api.post('/cases', {})).rejects.toThrow('bad');
  expect(mockRequest).toHaveBeenCalledTimes(1);
  mockRequest.mockReset();
  mockRequest.mockRejectedValueOnce(netErr());
  await expect(api.post('/auth/login', {})).rejects.toThrow('Network Error');
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(mockRequest.mock.calls[0][0].headers?.['Idempotency-Key']).toBeUndefined();
});
