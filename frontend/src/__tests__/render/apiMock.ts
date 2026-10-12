/**
 * apiMock.ts — configurable stand-in for src/services/api in render tests.
 *
 * Usage (per test file — jest.mock factories are hoisted, so the singleton
 * is shared between the factory and the test body):
 *
 *   jest.mock('../../services/api', () => require('./apiMock').apiMock().module);
 *   const { on, api, reject, reset } = require('./apiMock').apiMock();
 *
 *   beforeEach(() => reset());
 *   on('get', '/cases', [{ id: 1, title: 'My case' }]);          // resolve
 *   on('post', '/auth/login', () => Promise.reject(reject(401, { error: 'Invalid credentials' })));
 *
 * Unmatched requests reject like an unreachable server, so a screen under
 * test must handle them (same philosophy as setup.ts, but per-route control).
 */

type Impl = (url: string, payload: { data?: unknown; config?: unknown }) => Promise<unknown>;
interface Handler { method: string; match: string | RegExp; impl: Impl }

export interface ApiMock {
  module: Record<string, unknown>;
  api: Record<string, jest.Mock>;
  on: (method: string, match: string | RegExp, result: unknown) => void;
  reject: (status: number, body?: Record<string, unknown>) => Error;
  calls: { method: string; url: string; data?: unknown }[];
  reset: () => void;
}

function build(): ApiMock {
  const handlers: Handler[] = [];
  const calls: ApiMock['calls'] = [];

  const find = (method: string, url: string) =>
    handlers.find(h => h.method === method &&
      (typeof h.match === 'string' ? (url === h.match || url.startsWith(h.match)) : h.match.test(url)));

  const run = (method: string, url: string, data?: unknown, config?: unknown): Promise<unknown> => {
    calls.push({ method, url, data });
    const h = find(method, url);
    if (!h) {
      return Promise.reject(Object.assign(
        new Error(`Network error. Please check your connection. (no mock for ${method.toUpperCase()} ${url})`),
        { code: 'ERR_NETWORK' }));
    }
    return h.impl(url, { data, config });
  };

  const on: ApiMock['on'] = (method, match, result) => {
    const impl: Impl = typeof result === 'function'
      ? (result as Impl)
      : () => Promise.resolve({ data: result });
    handlers.unshift({ method: method.toLowerCase(), match, impl });
  };

  const reject: ApiMock['reject'] = (status, body = {}) => {
    const friendly: Record<string, string> = {
      payments_unavailable: 'Payments aren’t available yet. No charge was made — free features keep working.',
      ai_unavailable:       'AI features are temporarily unavailable. Please try again later.',
    };
    const code = body.error as string | undefined;
    const message = (code && friendly[code]) || (body.message as string) || code || `Request failed with status code ${status}`;
    return Object.assign(new Error(message), { code, response: { status, data: body } });
  };

  const api: ApiMock['api'] = {
    get:    jest.fn((url: string, config?: unknown) => run('get', url, undefined, config)),
    post:   jest.fn((url: string, data?: unknown, config?: unknown) => run('post', url, data, config)),
    put:    jest.fn((url: string, data?: unknown, config?: unknown) => run('put', url, data, config)),
    patch:  jest.fn((url: string, data?: unknown, config?: unknown) => run('patch', url, data, config)),
    delete: jest.fn((url: string, config?: unknown) => run('delete', url, undefined, config)),
    cachedGet: jest.fn((url: string) => run('get', url)),
    abortable: jest.fn(() => ({ signal: undefined, abort: () => {} })),
    clearCache: jest.fn(),
  };

  const apiErrorMessage = (e: unknown, fallback = 'Something went wrong. Please try again.'): string => {
    const err = e as { response?: { data?: { error?: string; message?: string } }; message?: string };
    return err?.response?.data?.message || err?.message || fallback;
  };

  const module = {
    __esModule: true,
    api,
    default: api,
    cachedGet: api.cachedGet,
    deduplicatedGet: api.get,
    API_BASE_URL: 'http://api.mock.test/api',
    FRIENDLY_ERRORS: {
      payments_unavailable: 'Payments aren’t available yet. No charge was made — free features keep working.',
      ai_unavailable:       'AI features are temporarily unavailable. Please try again later.',
    },
    isPaymentsUnavailable: (e: any) => e?.response?.data?.error === 'payments_unavailable' || e?.code === 'payments_unavailable',
    isAiUnavailable:       (e: any) => e?.response?.data?.error === 'ai_unavailable' || e?.code === 'ai_unavailable',
    apiErrorMessage,
  };

  const reset = () => {
    handlers.length = 0;
    calls.length = 0;
    for (const fn of Object.values(api)) (fn as jest.Mock).mockClear?.();
  };

  return { module, api, on, reject, calls, reset };
}

let singleton: ApiMock | null = null;
/** One shared instance per test file (jest module registry is per-file). */
export function apiMock(): ApiMock {
  if (!singleton) singleton = build();
  return singleton;
}

/** A navigation prop double that satisfies every screen under test. */
export function makeNavigation(): any {
  return {
    navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => false),
    setOptions: jest.fn(), replace: jest.fn(), reset: jest.fn(),
    getParent: jest.fn(() => undefined), addListener: jest.fn(() => jest.fn()),
    setParams: jest.fn(), dispatch: jest.fn(), isFocused: jest.fn(() => true),
  };
}
