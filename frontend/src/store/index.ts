import * as SecureStore from 'expo-secure-store';
/**
 * store/index.ts — Zustand global store
 *
 * Replaces: 42 useState calls in FirmVerticalScreen, prop drilling
 * across 85 screens for auth state, subscription tier, and gavel points.
 *
 * Usage:
 *   const { user, tier, gavelPoints, setTier } = useAppStore();
 */

import { create } from 'zustand';

export interface User {
  id:          number;
  name:        string;
  email:       string;
  phone?:      string;
  is_admin?:   boolean;
  created_at?: string;
}

export type SubscriptionTier =
  | 'free' | 'legal_radar' | 'advisor' | 'legal_pro' | 'esquire';

interface AppState {
  // ── Auth ─────────────────────────────────────────────────────────────
  user:            User | null;
  accessToken:     string | null;
  refreshToken:    string | null;
  isAuthenticated: boolean;

  // ── Subscription ──────────────────────────────────────────────────────
  tier:            SubscriptionTier;
  tierLoaded:      boolean;

  // ── Golden Gavel ──────────────────────────────────────────────────────
  gavelPoints:     number;
  gavelLevel:      number;

  // ── UI flags ─────────────────────────────────────────────────────────
  isOnboarded:     boolean;
  preferredLang:   'en' | 'es';
  networkOnline:   boolean;
  lastActiveRoute: string;

  // ── Actions ──────────────────────────────────────────────────────────
  setUser:         (user: User | null) => void;
  setTokens:       (access: string, refresh: string) => void;
  clearAuth:       () => void;
  setTier:         (tier: SubscriptionTier) => void;
  addGavelPoints:  (pts: number) => void;
  setOnboarded:    (v: boolean) => void;
  setLang:         (lang: 'en' | 'es') => void;
  setNetwork:      (online: boolean) => void;
  setActiveRoute:  (route: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user:            null,
  accessToken:     null,
  refreshToken:    null,
  isAuthenticated: false,
  tier:            'free',
  tierLoaded:      false,
  gavelPoints:     0,
  gavelLevel:      1,
  isOnboarded:     false,
  preferredLang:   'en',
  networkOnline:   true,
  lastActiveRoute: '',

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  setTokens: (accessToken, refreshToken) =>
    set({ accessToken, refreshToken, isAuthenticated: true }),

  clearAuth: () => set({
    user: null, accessToken: null, refreshToken: null,
    isAuthenticated: false, tier: 'free', tierLoaded: false,
    gavelPoints: 0, gavelLevel: 1,
  }),

  setTier: (tier) => set({ tier, tierLoaded: true }),

  addGavelPoints: (pts) => {
    const newPts = get().gavelPoints + pts;
    const level  = newPts >= 10000 ? 5 : newPts >= 3500 ? 4 :
                   newPts >= 1500  ? 3 : newPts >= 500  ? 2 : 1;
    set({ gavelPoints: newPts, gavelLevel: level });
  },

  setOnboarded:   (isOnboarded)  => set({ isOnboarded }),
  setLang:        (preferredLang)=> set({ preferredLang }),
  setNetwork:     (networkOnline)=> set({ networkOnline }),
  setActiveRoute: (route)        => set({ lastActiveRoute: route }),
}));

// ── Selector hooks (prevent unnecessary re-renders) ────────────────────
export const useUser     = () => useAppStore(s => s.user);
export const useTier     = () => useAppStore(s => s.tier);
export const useAuth     = () => useAppStore(s => ({
  user: s.user, isAuthenticated: s.isAuthenticated,
  accessToken: s.accessToken,
}));
export const useGavel    = () => useAppStore(s => ({
  points: s.gavelPoints, level: s.gavelLevel,
}));
export const useLang     = () => useAppStore(s => s.preferredLang);
export const useNetwork  = () => useAppStore(s => s.networkOnline);
