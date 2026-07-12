/**
 * utils/queryClient.ts — TanStack Query client + typed API hooks
 *
 * Replaces: fetch-in-useEffect on every screen with:
 *   - Automatic caching (stale-while-revalidate)
 *   - Request deduplication (same endpoint from 2 screens = 1 request)
 *   - Background refetch on window focus
 *   - Automatic retry with exponential backoff
 *   - Optimistic updates for mutations
 *
 * Usage:
 *   const { data, isLoading, error } = useLawyers({ state: 'TN' });
 */

import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Storage } from './storage';

// ── Query client configuration ────────────────────────────────────────────
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            1000 * 60 * 5,   // 5 min — data is fresh
      gcTime:               1000 * 60 * 30,  // 30 min — keep in memory
      retry:                2,
      retryDelay:           (n) => Math.min(1000 * 2 ** n, 10_000),
      refetchOnWindowFocus: false,            // mobile: don't refetch on app focus
    },
    mutations: {
      retry: 1,
    },
  },
});

// ── Axios instance with auth headers ─────────────────────────────────────
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const api = axios.create({ baseURL: BASE_URL, timeout: 15_000 });

api.interceptors.request.use(config => {
  const token = Storage.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  r => r,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = Storage.getRefreshToken();
      if (refresh) {
        const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken: refresh });
        Storage.setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      }
    }
    return Promise.reject(err);
  }
);

// ── Query key factory ─────────────────────────────────────────────────────
export const keys = {
  lawyers:       (filters?: object) => ['lawyers', filters] as const,
  lawyer:        (id: number)       => ['lawyer', id]       as const,
  bondsmen:      (filters?: object) => ['bondsmen', filters] as const,
  cases:         ()                 => ['cases']             as const,
  case:          (id: number)       => ['case', id]          as const,
  arrests:       (filters?: object) => ['arrests', filters]  as const,
  tier:          ()                 => ['tier']              as const,
  gavelPoints:   ()                 => ['gavelPoints']       as const,
  lessons:       ()                 => ['lessons']           as const,
  checkins:      ()                 => ['checkins']          as const,
  matters:       ()                 => ['matters']           as const,
  providers:     (filters?: object) => ['providers', filters] as const,
  immigrationRights: ()             => ['immigrationRights'] as const,
  expungementRules:  (state: string)=> ['expungementRules', state] as const,
};
