import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// On web expo-secure-store is unavailable; use the sessionStorage-backed store.
const nativeStore = isWeb ? webStore : {
  getItemAsync: (key: string) => SecureStore.getItemAsync(key),
  setItemAsync: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key),
};

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

const SECURE_KEYS = new Set(['token', 'refresh_token', 'user']);

/**
 * Write a value. Uses SecureStore for sensitive keys, AsyncStorage for the rest.
 */
export async function setItem(key: string, value: string): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    try {
      await nativeStore.setItemAsync(key, value);
    } catch { await AsyncStorage.setItem(key, value); }
  } else { await AsyncStorage.setItem(key, value); }
}

/**
 * Read a value. Checks SecureStore first for sensitive keys.
 */
export async function getItem(key: string): Promise<string | null> {
  if (SECURE_KEYS.has(key)) {
    try {
      const v = await nativeStore.getItemAsync(key);
      if (v != null) return v;
    } catch { /* fall through to AsyncStorage */ }
  }
  return await AsyncStorage.getItem(key);
}

/**
 * Delete a value from the appropriate store.
 */
export async function removeItem(key: string): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    await nativeStore.deleteItemAsync(key).catch(() => {});
    await AsyncStorage.removeItem(key).catch(() => {}); // fallback location
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
  // Remove from every place a token may have been written: the platform
  // secure store (Keychain/Keystore, or sessionStorage on web), the web
  // fallback store, and AsyncStorage (legacy location + setItem fallback).
  const keys = Array.from(SECURE_KEYS);
  await Promise.all(keys.flatMap(k => [
    nativeStore.deleteItemAsync(k).catch(() => {}),
    webStore.deleteItemAsync(k).catch(() => {}),
    AsyncStorage.removeItem(k).catch(() => {}),
  ]));
}

// ── Cross-platform wrappers ───────────────────────────────────────────────────
export async function setSecure(key: string, value: string): Promise<void> {
  return nativeStore.setItemAsync(key, value);
}

export async function getSecure(key: string): Promise<string | null> {
  return nativeStore.getItemAsync(key);
}

export async function deleteSecure(key: string): Promise<void> {
  return nativeStore.deleteItemAsync(key);
}
