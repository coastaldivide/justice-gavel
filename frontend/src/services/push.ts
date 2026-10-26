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
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * Android notification channels. The server sends court reminders with
 * channelId 'court_reminders' (services/reminderDispatcher.js) and everything
 * else on 'default'. On Android 8+ a push whose channel does not exist on the
 * device is not displayed, and nothing in the app created these channels before
 * the Oct 2026 reminder review — so court reminders could reach an Android phone
 * and never appear. Creating a channel that exists is a no-op, so this is safe on
 * every start.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('court_reminders', {
      name: 'Court date reminders',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  } catch (e) {
    if (__DEV__) console.warn('[push] could not create notification channels', e);
  }
}

/**
 * syncPushToken — when notifications are ALREADY allowed, gets the Expo push
 * token and POSTs it to /api/push/token. Never shows a permission prompt:
 * asking happens in context (services/permissions.ts
 * requestNotificationsInContext — when a court date is saved or reminders are
 * turned on). Returns the token string or null.
 */
export async function syncPushToken(): Promise<string | null> {
  // Expo push tokens: native devices only, and only once an EAS project exists.
  if (Platform.OS === 'web') return null;
  const projectId = easProjectId();
  if (!projectId) return null;
  if (!Device.isDevice) {
    if (__DEV__) console.warn('[push] Push notifications require a physical device');
    return null;
  }

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;

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

/** @deprecated name kept for callers — same as syncPushToken (no prompt). */
export const registerForPush = syncPushToken;

/** This device's Expo push token without asking for permission; null on web / not allowed / no EAS project. */
export async function currentPushToken(): Promise<string | null> {
  try {
    const projectId = easProjectId();
    if (Platform.OS === 'web' || !projectId || !Device.isDevice) return null;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId }).catch(() => null);
    return tokenData?.data || null;
  } catch { return null; }
}

/** Stop push notifications to this device (Settings › Push notifications off). Throws when the server could not be told. */
export async function unregisterPush(): Promise<void> {
  const token = await currentPushToken();
  if (token) await api.delete(`/push/token/${encodeURIComponent(token)}`);
}
