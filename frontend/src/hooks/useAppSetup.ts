/**
 * useAppSetup.ts — App-level lifecycle hooks
 * Extracted from App.tsx to keep the root file focused on navigation.
 *
 * Exports:
 *   registerForPushNotificationsAsync() — registers and syncs push token
 *   useOTAUpdates()    — checks for JS bundle updates on mount
 *   usePushTokenRefresh() — re-registers push token when app comes to foreground
 */
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import * as Sentry from '@sentry/react-native';
// ── Sentry error monitoring ────────────────────────────────────────────────────

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30000,
    // Ignore common non-errors
    ignoreErrors: [
      'Network request failed',
      'TypeError: Network request failed',
      'AbortError',
    ],
  });
}

export async function registerForPushNotificationsAsync(): Promise<string | null | undefined> {
  try {
    const Notifications = await import('expo-notifications');
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    if (!token) return;

    // Store locally for comparison
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    const lastToken = await AsyncStorage.getItem('last_push_token');

    // Only POST if token has changed (avoids redundant API calls)
    if (token !== lastToken) {
      const { api } = await import('../services/api');
      const { Platform } = await import('react-native');
      await api.post('/push/token', { expoPushToken: token, platform: Platform.OS }).catch(() => {});
      await AsyncStorage.setItem('last_push_token', token);
    }
  } catch { /* push registration is non-fatal */ }
}

// Re-register when app returns to foreground (handles token rotation)
export function usePushTokenRefresh() {
  useEffect(() => {
    const { AppState } = require('react-native');
    const sub = AppState.addEventListener('change', (nextState: string) => {
      if (nextState === 'active') {
        registerForPushNotificationsAsync();
      }
    });
    return () => sub?.remove?.();
  }, []);
}


// Check for OTA JS bundle updates on app mount
export function useOTAUpdates() {
  useEffect(() => {
    if (__DEV__) return; // skip in dev — Metro handles updates
    (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch { /* OTA is non-fatal — app still works on current bundle */ }
    })();
  }, []);
}


