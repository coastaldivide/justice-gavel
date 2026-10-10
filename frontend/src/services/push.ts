import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import api from './api';

/** EAS project id, or null while the owner has not run `eas init` yet. */
function easProjectId(): string | null {
  const id = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  return typeof id === 'string' && id && !id.startsWith('PENDING') ? id : null;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * registerForPush — requests permission, gets Expo push token,
 * and POSTs it to /api/push/token so the backend can send notifications.
 * Returns the token string or null.
 */
export async function registerForPush(): Promise<string | null> {
  // Expo push tokens: native devices only, and only once an EAS project exists.
  if (Platform.OS === 'web') return null;
  const projectId = easProjectId();
  if (!projectId) return null;
  if (!Device.isDevice) {
    if (__DEV__) console.warn('[push] Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId }).catch(() => null);
  if (!tokenData) return null;

  const token = tokenData.data;

  // Register token with backend so server can send push notifications
  try {
    await api.post('/push/token', {
      token,
      platform: Platform.OS,
    });
  } catch (e) {
    // Non-fatal — token registration failure should not break the app
    if (__DEV__) console.warn('[push] Failed to register token with backend:', e);
  }

  return token;
}

/** Unregister the current device token (call on logout) */
export async function unregisterPush(): Promise<void> {
  try {
    const projectId = easProjectId();
    if (Platform.OS === 'web' || !projectId) return;
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId }).catch(() => null);
    if (tokenData?.data) {
      await api.delete(`/push/token/${encodeURIComponent(tokenData.data)}`).catch(() => {});
    }
  } catch { /* silent — logout should always succeed */ }
}
