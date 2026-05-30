import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Platform from 'react-native';
import api from './api';

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

  const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
  if (!tokenData) return null;

  const token = tokenData.data;

  // Register token with backend so server can send push notifications
  try {
    await api.post('/push/token', {
      token,
      platform: typeof Platform.Platform !== 'undefined'
        ? Platform.Platform.OS
        : 'unknown',
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
    const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
    if (tokenData?.data) {
      await api.delete(`/push/token/${encodeURIComponent(tokenData.data)}`).catch(() => {});
    }
  } catch (_e) { /* silent — logout should always succeed */ }
}
