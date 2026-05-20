/**
 * useBiometricGate.ts — Per-screen biometric authentication hook
 *
 * Used on screens containing sensitive data (case details, payments, documents).
 * Prompts once per app session per screen — not on every navigation.
 *
 * Usage:
 *   const { gated, unlocking, unlock } = useBiometricGate();
 *   if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;
 *
 * The hook only activates if:
 *   1. User has enabled biometric in Settings ('biometric_enabled' in AsyncStorage)
 *   2. Device has enrolled biometrics
 *   3. This specific screen has not already been unlocked this session
 *
 * Session tracking uses a module-level Set — cleared when app restarts.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Module-level session cache — screens unlocked this session don't re-prompt
// Cleared when app is backgrounded for >60 seconds (security: phone picked up by someone else)
const UNLOCKED_SCREENS = new Set<string>();
let backgroundTime: number | null = null;
const RELOCK_AFTER_MS = 60_000; // 60 seconds in background = re-lock all screens

import { AppState } from 'react-native';
AppState.addEventListener('change', (nextState) => {
  if (nextState === 'background' || nextState === 'inactive') {
    backgroundTime = Date.now();
  } else if (nextState === 'active') {
    if (backgroundTime !== null) {
      const elapsed = Date.now() - backgroundTime;
      if (elapsed > RELOCK_AFTER_MS) {
        UNLOCKED_SCREENS.clear(); // re-lock all screens after 60s in background
      }
      backgroundTime = null;
    }
  }
});

interface BiometricGateResult {
  /** True when screen is locked and content should be hidden */
  gated: boolean;
  /** True while authentication is in progress */
  unlocking: boolean;
  /** Call to prompt biometric authentication */
  unlock: () => Promise<void>;
}

export function useBiometricGate(screenKey: string): BiometricGateResult {
  const [gated, setGated]       = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Check if biometric is enabled and device supports it
    (async () => {
      try {
        // Already unlocked this session — no prompt needed
        if (UNLOCKED_SCREENS.has(screenKey)) return;

        const bioOn = await AsyncStorage.getItem('biometric_enabled');
        if (bioOn !== 'true') return;

        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!enrolled) return;

        // Screen should be gated — show lock
        if (mountedRef.current) setGated(true);
      } catch {
        // If anything fails, don't gate the screen — never block access
      }
    })();
  }, [screenKey]);

  const unlock = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock to view',
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });
      if (result.success && mountedRef.current) {
        UNLOCKED_SCREENS.add(screenKey);
        setGated(false);
      }
    } catch {
      // Authentication error — keep gated
    } finally {
      if (mountedRef.current) setUnlocking(false);
    }
  }, [screenKey, unlocking]);

  return { gated, unlocking, unlock };
}

/**
 * BiometricLockView — Renders the lock screen UI.
 * Import and use when useBiometricGate returns gated=true.
 */
export { BiometricLockView } from '../components/BiometricLockView';
