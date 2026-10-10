/**
 * api.ts — Centralized API client for Justice Gavel
 *
 * Features:
 *  - Automatic retry on network failure (3 attempts, exponential backoff)
 *  - AbortController support — cancels in-flight requests on unmount
 *  - Response cache (60s dynamic, 5min static data)
 *  - Auth token injection on every request
 *  - Clear error messages for offline / server errors
 */

import axios, { AxiosRequestConfig } from 'axios';
import { getToken, clearAuth, setToken as storeToken } from '../utils/secureStorage';
import { setAppAuth } from './auth';

// EXPO_PUBLIC_API_BASE must be set in frontend/.env for staging/production.
// Falls back to the production API when the variable is not set.
// Example: EXPO_PUBLIC_API_BASE=https://api.justicegavel.app/api
const BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE ||
  'https://api.justicegavel.app/api';  // always use production as fallback

/** Resolved API base URL (for the few callers that must use fetch directly, e.g. SSE). */
export const API_BASE_URL = BASE_URL;

if (!process.env.EXPO_PUBLIC_API_BASE && !__DEV__) {
  if (__DEV__) console.error('[api] CRITICAL: EXPO_PUBLIC_API_BASE is not set. Add it to your EAS secrets.');
  // In prod without BASE_URL every request will fail — surface this clearly
}

// ── Cache ─────────────────────────────────────────────────────────────────────
type CacheEntry = { data: unknown; ts: number };
const _cache = new Map<string, CacheEntry>();
const TTL_STATIC  = 300_000;  // 5min — laws, resources, courthouses

// ── Axios instance ────────────────────────────────────────────────────────────
const instance = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Inject auth token + language header on every request
instance.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Accept-Language from stored preference
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const lang = await AsyncStorage.getItem('lang').catch(() => null);
    if (lang) config.headers['Accept-Language'] = lang;
  } catch { /* non-fatal */ }
  return config;
});




// ── Proactive token refresh ─────────────────────────────────────────────
// Refresh JWT if it was issued more than 25 days ago (30d expiry)
// Prevents users from being logged out mid-session
const REFRESH_THRESHOLD_MS = 25 * 24 * 60 * 60 * 1000; // 25 days
let _refreshing = false;
instance.interceptors.request.use(async (config) => {
  // Skip refresh for auth endpoints
  if (config.url?.includes('/auth/')) return config;
  try {
    const token = await getToken();
    if (token) {
      // Decode JWT payload (base64) to check iat
      // Decode payload only for iat (issued-at) check — signature verified server-side
      let ageMs = 0;
      try { const payload = JSON.parse(atob(token.split('.')[1])); ageMs = Date.now() - (payload.iat ?? 0) * 1000; } catch { /* malformed token — skip iat check */ }
      if (ageMs > REFRESH_THRESHOLD_MS && !_refreshing) {
        _refreshing = true;
        const { data } = await instance.post('/auth/refresh', {}, {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (data?.token) await storeToken(data.token)  // storeToken from secureStorage;
        _refreshing = false;
      }
    }
  } catch { _refreshing = false; }
  return config;
});

// Friendly copy for well-known backend error codes (503 feature flags etc.)
export const FRIENDLY_ERRORS: Record<string, string> = {
  payments_unavailable: 'Payments aren’t available yet. No charge was made — free features keep working.',
  ai_unavailable:       'AI features are temporarily unavailable. Please try again later.',
};

/** True when the backend reports billing is not configured (503 payments_unavailable). */
export function isPaymentsUnavailable(e: any): boolean {
  return e?.response?.data?.error === 'payments_unavailable' || e?.code === 'payments_unavailable';
}

/** True when the backend reports AI is not configured (503 ai_unavailable). */
export function isAiUnavailable(e: any): boolean {
  return e?.response?.data?.error === 'ai_unavailable' || e?.code === 'ai_unavailable';
}

/** Best human-readable message for an API error. */
export function apiErrorMessage(e: any, fallback = 'Something went wrong. Please try again.'): string {
  const code = e?.response?.data?.error;
  return FRIENDLY_ERRORS[code] || e?.response?.data?.message || (typeof e?.message === 'string' && e.message) || fallback;
}

// Auto-logout on 401 — JWT expired or revoked
// Clears secure token storage and returns user to guest/login screen.
instance.interceptors.response.use(
  (response) => response,
  async (error) => {
    // ── Normalise API error messages ────────────────────────────────────
    // Extract the server's error string from the response body so screens
    // can do `catch (e: any) { setError(e.message) }` and get a real message.
    // API returns { error: '...' } or occasionally { message: '...' }.
    // Backend contract: errors are JSON { error: <code>, message: <human text> }.
    const errCode: string | undefined = error?.response?.data?.error;
    const serverMsg: string | undefined =
      FRIENDLY_ERRORS[errCode as string] ??
      error?.response?.data?.message ??
      errCode ??
      undefined;
    if (errCode && typeof errCode === 'string') error.code = errCode;
    if (serverMsg && typeof serverMsg === 'string') {
      // Override the generic axios message with the server's actual message
      error.message = serverMsg;
    } else if (!error?.response && error?.code === 'ECONNABORTED') {
      error.message = 'Request timed out. Please check your connection.';
    } else if (!error?.response) {
      error.message = 'Network error. Please check your connection.';
    } else if (error?.response?.status === 429) {
      error.message = 'Too many requests. Please wait a moment and try again.';
    } else if (error?.response?.status >= 500) {
      error.message = 'Server error. Please try again in a few moments.';
    }

    // Only auto-logout when we actually sent a token (an expired/revoked
    // session). Guests browsing without a token, or a failed login attempt,
    // must not be bounced out of the app.
    const sentAuth = !!(error?.config?.headers?.Authorization);
    if (error?.response?.status === 401 && sentAuth && !String(error?.config?.url || '').includes('/auth/login')) {
      // Token expired or invalid — clear credentials and force re-login
      await clearAuth().catch(() => {});
      setAppAuth('guest');
    }
    return Promise.reject(error);
  }
);

// ── Retry helper ──────────────────────────────────────────────────────────────
const RETRY_CODES = new Set([408, 429, 500, 502, 503, 504]);

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 600,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as any)?.response?.status;
      // Don't retry auth errors or bad requests
      if (status && !RETRY_CODES.has(status)) throw err;
      if (i < attempts - 1) await sleep(delayMs * 2 ** i);
    }
  }
  throw lastErr;
}

const sleep = (ms: number) => new Promise<void>(r => { setTimeout(r, ms); });

// ── In-flight request deduplication ─────────────────────────────────────────
// If two callers request the same GET URL simultaneously, they share one promise.
// This eliminates duplicate network requests during component mount races.
const _inFlight = new Map<string, Promise<any>>();

export function deduplicatedGet(url: string, config?: Parameters<typeof instance.get>[1]): Promise<any> {
  const key = url + (config?.params ? JSON.stringify(config.params) : '');
  const pending = _inFlight.get(key);
  if (pending) return pending;
  const promise = instance.get(url, config).finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

// ── Core request with retry ────────────────────────────────────────────────────
async function request<T = any>(
  config: AxiosRequestConfig,
  signal?: AbortSignal,
): Promise<{ data: T }> {
  const method = (config.method || 'GET').toUpperCase();
  const send = () => instance.request<T>({ ...config, signal });
  // Only idempotent reads are retried automatically. Retrying a POST (login,
  // payment, booking) after a timeout could submit it twice.
  return method === 'GET' || method === 'HEAD' ? withRetry(send) : send();
}

// ── Cached GET (for static / rarely-changing data) ────────────────────────────
export async function cachedGet<T = any>(
  url: string,
  ttl = TTL_STATIC,
  config?: AxiosRequestConfig,
): Promise<{ data: T }> {
  const cached = _cache.get(url);
  if (cached && Date.now() - cached.ts < ttl) {
    return { data: cached.data as T };
  }
  const res = await request<T>({ method: 'GET', url, ...config });
  _cache.set(url, { data: res.data, ts: Date.now() });
  return res;
}

// ── Public API ─────────────────────────────────────────────────────────────────
export const api = {
  get:    <T = any>(url: string, config?: AxiosRequestConfig) =>
            request<T>({ method: 'GET',    url, ...config }),
  post:   <T = any>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            request<T>({ method: 'POST',   url, data, ...config }),
  put:    <T = any>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            request<T>({ method: 'PUT',    url, data, ...config }),
  patch:  <T = any>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            request<T>({ method: 'PATCH',  url, data, ...config }),
  delete: <T = any>(url: string, config?: AxiosRequestConfig) =>
            request<T>({ method: 'DELETE', url, ...config }),

  // Static data — uses longer cache
  cachedGet,

  // Create an AbortController tied to a React cleanup function
  // Usage: const { signal, abort } = api.abortable();
  //        useEffect(() => () => abort(), []);
  abortable: () => {
    const ctrl = new AbortController();
    return { signal: ctrl.signal, abort: () => ctrl.abort() };
  },

  // Clear cache (call after logout or major data change)
  clearCache: () => _cache.clear(),
};

export default api;
