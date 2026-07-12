/**
 * hooks/useApi.ts — Typed data hooks using TanStack Query
 *
 * Every screen that currently does:
 *   const [lawyers, setLawyers] = useState([]);
 *   useEffect(() => { axios.get('/api/lawyers').then(r => setLawyers(r.data)); }, []);
 *
 * Should instead use:
 *   const { data: lawyers, isLoading } = useLawyers({ state: 'TN' });
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { api, keys, queryClient } from '../utils/queryClient';

// ── Read hooks ────────────────────────────────────────────────────────────
export const useLawyers = (filters?: { state?: string; lat?: number; lng?: number; specialty?: string }) =>
  useQuery({
    queryKey:  keys.lawyers(filters),
    queryFn:   () => api.get('/api/providers', { params: filters }).then(r => r.data),
    staleTime: 1000 * 60 * 5,
  });

export const useLawyer = (id: number) =>
  useQuery({
    queryKey: keys.lawyer(id),
    queryFn:  () => api.get(`/api/providers/${id}`).then(r => r.data),
    enabled:  !!id,
  });

export const useBondsmen = (filters?: { state?: string; county?: string }) =>
  useQuery({
    queryKey: keys.bondsmen(filters),
    queryFn:  () => api.get('/api/billing/leads', { params: filters }).then(r => r.data),
  });

export const useCases = () =>
  useQuery({
    queryKey: keys.cases(),
    queryFn:  () => api.get('/api/cases').then(r => r.data),
  });

export const useCase = (id: number) =>
  useQuery({
    queryKey: keys.case(id),
    queryFn:  () => api.get(`/api/cases/${id}`).then(r => r.data),
    enabled:  !!id,
  });

export const useArrests = (filters?: { county?: string; state?: string; hours?: number }) =>
  useQuery({
    queryKey:  keys.arrests(filters),
    queryFn:   () => api.get('/api/arrests/recent', { params: filters }).then(r => r.data),
    staleTime: 1000 * 60 * 2,   // arrests refresh every 2 min
    refetchInterval: 1000 * 60 * 5,  // background refresh every 5 min
  });

export const useSubscriptionTier = () =>
  useQuery({
    queryKey: keys.tier(),
    queryFn:  () => api.get('/api/billing/tier').then(r => r.data?.tier ?? 'free'),
    staleTime: 1000 * 60 * 30,  // tier rarely changes
  });

export const useImmigrationRights = () =>
  useQuery({
    queryKey: keys.immigrationRights(),
    queryFn:  () => api.get('/api/immigration/rights').then(r => r.data),
    staleTime: 1000 * 60 * 60 * 24,  // static content, cache 24h
  });

export const useExpungementRules = (state: string) =>
  useQuery({
    queryKey: keys.expungementRules(state),
    queryFn:  () => api.get('/api/expungement/rules', { params: { state } }).then(r => r.data),
    staleTime: 1000 * 60 * 60,  // cache 1 hour
    enabled:  !!state,
  });

export const useLessons = () =>
  useQuery({
    queryKey: keys.lessons(),
    queryFn:  () => api.get('/api/lessons').then(r => r.data),
  });

export const useCheckins = () =>
  useQuery({
    queryKey: keys.checkins(),
    queryFn:  () => api.get('/api/checkins').then(r => r.data),
  });

export const useMatters = () =>
  useQuery({
    queryKey: keys.matters(),
    queryFn:  () => api.get('/api/matters').then(r => r.data),
  });

// ── Write hooks ────────────────────────────────────────────────────────────
export const useCreateCase = () =>
  useMutation({
    mutationFn: (body: object) => api.post('/api/cases', body).then(r => r.data),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: keys.cases() }),
  });

export const useSubmitCheckin = () =>
  useMutation({
    mutationFn: (body: object) => api.post('/api/checkins/submit', body).then(r => r.data),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: keys.checkins() }),
  });

export const useUpgradeTier = () =>
  useMutation({
    mutationFn: (tier: string) => api.post('/api/billing/subscribe', { tier }).then(r => r.data),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: keys.tier() }),
  });
