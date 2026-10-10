/**
 * useAppSetup.ts — App-level lifecycle hooks
 * Extracted from App.tsx to keep the root file focused on navigation.
 *
 * Exports:
 *   registerForPushNotificationsAsync() — registers and syncs push token
 *   useOTAUpdates()    — checks for JS bundle updates on mount
 *   usePushTokenRefresh() — re-registers push token when app comes to foreground
 */
import React, { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
// Sentry is initialised once in App.tsx (no-op when EXPO_PUBLIC_SENTRY_DSN is empty).

/** EAS project id, or null while the owner has not run `eas init` yet. */
function easProjectId(): string | null {
  const id = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  return typeof id === 'string' && id && !id.startsWith('PENDING') ? id : null;
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

    // Expo push tokens are scoped to the EAS project; skip until it exists.
    const projectId = easProjectId();
    if (!projectId) return;
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
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
    if (!Updates.isEnabled) return; // updates disabled (no EAS project yet / web)
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



/** Hook that navigates to relevant screen when user taps a push notification */
export function usePushNotificationTap(navigationRef: React.RefObject<any>) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    import('expo-notifications').then(Notifications => {
      sub = Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data as Record<string, string>;
        if (!navigationRef.current) return;
        const nav = navigationRef.current;

        // Route to relevant screen based on notification type
        if (data?.type === 'checkin_reminder') {
          nav.navigate('MoreTab', { screen: 'CheckIn' });
        } else if (data?.type === 'arrest_alert' && data?.watchId) {
          nav.navigate('MoreTab', { screen: 'ArrestMonitor' });
        } else if (data?.type === 'court_reminder' && data?.caseId) {
          nav.navigate('MoreTab', { screen: 'Cases', params: { caseId: data.caseId } });
        } else if (data?.type === 'message' && data?.threadId) {
          nav.navigate('ChatTab');
        } else if (data?.type === 'expungement_eligible') {
          nav.navigate('MoreTab', { screen: 'Expungement' });
        } else if (data?.type === 'cle_reminder') {
          nav.navigate('MoreTab', { screen: 'AttorneyDashboard' });
        }
      });
    }).catch(() => {});
    return () => { sub?.remove(); };
  }, [navigationRef]);
}
