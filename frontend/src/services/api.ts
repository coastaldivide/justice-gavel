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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken, clearAuth } from '../utils/secureStorage';
import { setAppAuth } from './auth';

// EXPO_PUBLIC_API_BASE must be set in frontend/.env for staging/production.
// Fallback to localhost:4000 is intentional for local development only.
// Example: EXPO_PUBLIC_API_BASE=https://api.justicegavel.app/api
const BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE ||
  (__DEV__ ? 'http://localhost:4000/api' : '');  // empty string will surface API errors fast in prod

if (!process.env.EXPO_PUBLIC_API_BASE && !__DEV__) {
  console.error('[api] CRITICAL: EXPO_PUBLIC_API_BASE is not set. Add it to your EAS secrets.');
  // In prod without BASE_URL every request will fail — surface this clearly
}

// ── Cache ─────────────────────────────────────────────────────────────────────
type CacheEntry = { data: unknown; ts: number };
const _cache = new Map<string, CacheEntry>();
const TTL_DYNAMIC = 60_000;   // 60s  — search results, leads
const TTL_STATIC  = 300_000;  // 5min — laws, resources, courthouses

// ── Axios instance ────────────────────────────────────────────────────────────
const instance = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Inject auth token on every request
instance.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});


// ── Circuit breaker ────────────────────────────────────────────────────────────
let _cbFailures = 0;
let _cbOpenUntil = 0;
const CB_THRESHOLD = 5;
const CB_RESET_MS  = 30_000;

function checkCircuit(): void {
  if (_cbFailures >= CB_THRESHOLD && Date.now() < _cbOpenUntil) {
    throw Object.assign(new Error('Server temporarily unavailable — try again in 30 seconds'), {
      status: 503, circuit: true,
    });
  }
}
function circuitSuccess(): void { _cbFailures = 0; }
function circuitFailure(): void {
  _cbFailures++;
  if (_cbFailures >= CB_THRESHOLD) _cbOpenUntil = Date.now() + CB_RESET_MS;
}


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
      const payload = JSON.parse(atob(token.split('.')[1]));
      const ageMs = Date.now() - payload.iat * 1000;
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

  // Auto-logout on 401 — JWT expired or revoked
// Clears secure token storage and returns user to guest/login screen.
instance.interceptors.response.use(
  (response) => {
    circuitSuccess();
    return response;
  },
  async (error) => {
    circuitFailure();

    // ── Normalise API error messages ────────────────────────────────────
    // Extract the server's error string from the response body so screens
    // can do `catch (e: any) { setError(e.message) }` and get a real message.
    // API returns { error: '...' } or occasionally { message: '...' }.
    const serverMsg: string | undefined =
      error?.response?.data?.error ??
      error?.response?.data?.message ??
      undefined;
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

    if (error?.response?.status === 401) {
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
// eslint-disable-next-line no-promise-executor-return

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── In-flight request deduplication ─────────────────────────────────────────
// If two callers request the same GET URL simultaneously, they share one promise.
// This eliminates duplicate network requests during component mount races.
const _inFlight = new Map<string, Promise<any>>();

export function deduplicatedGet(url: string, config?: Parameters<typeof instance.get>[1]): Promise<any> {
  const key = url + (config?.params ? JSON.stringify(config.params) : '');
  if (_inFlight.has(key)) return _inFlight.get(key)!;
  const promise = instance.get(url, config).finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

// ── Core request with retry ────────────────────────────────────────────────────
async function request<T = any>(
  config: AxiosRequestConfig,
  signal?: AbortSignal,
): Promise<{ data: T }> {
  return withRetry(() =>
    instance.request<T>({ ...config, signal })
  );
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
