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
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { openNotification } from '../services/notificationRoute';
// Sentry is initialised once in App.tsx (no-op when EXPO_PUBLIC_SENTRY_DSN is empty).

/** EAS project id, or null while the owner has not run `eas init` yet. */
function easProjectId(): string | null {
  const id = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  return typeof id === 'string' && id && !id.startsWith('PENDING') ? id : null;
}

export async function registerForPushNotificationsAsync(): Promise<string | null | undefined> {
  try {
    const Notifications = await import('expo-notifications');
    // Android: create the 'court_reminders' / 'default' channels the server's
    // pushes name — without them Android drops court reminders silently.
    const { ensureNotificationChannels } = await import('../services/push');
    await ensureNotificationChannels();
    // Never prompt here (app start / foreground): permission is asked in
    // context with a reason (services/permissions.ts). Only sync the token
    // when the user has already allowed notifications.
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

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
    const sub = AppState.addEventListener('change', (nextState) => {
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



/** Opens the screen a tapped push notification points to (services/notificationRoute.ts). */
export function usePushNotificationTap(navigationRef: { isReady: () => boolean; navigate: (...a: any[]) => void }) {
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    import('expo-notifications').then(Notifications => {
      sub = Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        if (navigationRef.isReady()) openNotification(navigationRef, data);
      });
    }).catch(() => {});
    return () => { sub?.remove(); };
  }, [navigationRef]);
}
