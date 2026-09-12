import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// ── Web fallback ──────────────────────────────────────────────────────────────
// expo-secure-store is native-only. On web we use sessionStorage (cleared on
// tab close) rather than localStorage to minimize token exposure time.
// For production web builds, consider a httpOnly cookie instead.

const webStore = {
  getItemAsync: async (key: string): Promise<string | null> => {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(`jg_${key}`);
  },
  setItemAsync: async (key: string, value: string): Promise<void> => {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(`jg_${key}`, value);
  },
  deleteItemAsync: async (key: string): Promise<void> => {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(`jg_${key}`);
  },
};

async function getNativeStore() {
  const m = await import('expo-secure-store').catch(() => null);
  return m;
}

/**
 *
 * WHY THIS MATTERS:
 *   AsyncStorage on Android stores data as plain text in the app's
 *   data directory. Any process with file system access (including
 *   malware that obtained root) can read it.
 *
 *     iOS  — Keychain Services (hardware-backed on devices with Secure Enclave)
 *     Android — Android Keystore System (hardware-backed on API 23+)
 *
 * USAGE:
 *   Old pattern: AsyncStorage.setItem('token', jwt)
 *   With:    await setSecure('token', jwt)
 *
 *   Replace: await AsyncStorage.getItem('token')
 *   With:    await getSecure('token')
 *
 * KEYS THAT MUST USE SECURE STORAGE:
 *   - 'token'     — JWT access token
 *   - 'user'      — user profile (contains email/phone)
 *
 * KEYS THAT MAY USE ASYNCSTORAGE (non-sensitive):
 *   - 'jg_user_state', 'jg_theme_mode', 'lang', 'notifs',
 *     'onboarding_done', 'chat_session_id', etc.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SECURE_KEYS = new Set(['token', 'refresh_token', 'user']);

/**
 * Write a value. Uses SecureStore for sensitive keys, AsyncStorage for the rest.
 */
export async function setItem(key: string, value: string): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    try {
      await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    } catch { await AsyncStorage.setItem(key, value); }
  } else { await AsyncStorage.setItem(key, value); }
}

/**
 * Read a value. Checks SecureStore first for sensitive keys.
 */
export async function getItem(key: string): Promise<string | null> {
  if (SECURE_KEYS.has(key)) {
    try { return await SecureStore.getItemAsync(key); } catch { /* fall through to AsyncStorage */ }
  }
  return await AsyncStorage.getItem(key);
}

/**
 * Delete a value from the appropriate store.
 */
export async function removeItem(key: string): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    await SecureStore.deleteItemAsync(key).catch(() => {});
  } else {
    await AsyncStorage.removeItem(key);
  }
}

/**
 * Convenience: read the JWT token.
 * Use this everywhere instead of AsyncStorage.getItem('token').
 */
export async function getToken(): Promise<string | null> {
  return getItem('token');
}

/**
 * Convenience: write the JWT token after login.
 */
export async function setToken(token: string): Promise<void> {
  return setItem('token', token);
}

/**
 * Clear all auth data on logout.
 */
export async function clearAuth(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync('token').catch(() => {}),
    SecureStore.deleteItemAsync('refresh_token').catch(() => {}),
    SecureStore.deleteItemAsync('user').catch(() => {}),
    AsyncStorage.removeItem('token').catch(() => {}),  // clear legacy location
    AsyncStorage.removeItem('user').catch(() => {}),
  ]);
}

// ── Cross-platform wrappers ───────────────────────────────────────────────────
export async function setSecure(key: string, value: string): Promise<void> {
  if (isWeb) return webStore.setItemAsync(key, value);
  const store = await getNativeStore();
  if (!store) return webStore.setItemAsync(key, value);
  return store.setItemAsync(key, value);
}

export async function getSecure(key: string): Promise<string | null> {
  if (isWeb) return webStore.getItemAsync(key);
  const store = await getNativeStore();
  if (!store) return webStore.getItemAsync(key);
  return store.getItemAsync(key);
}

export async function deleteSecure(key: string): Promise<void> {
  if (isWeb) return webStore.deleteItemAsync(key);
  const store = await getNativeStore();
  if (!store) return webStore.deleteItemAsync(key);
  return store.deleteItemAsync(key);
}
