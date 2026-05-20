/**
 * secureStorage.ts — Secure token storage using expo-secure-store
 *
 * WHY THIS MATTERS:
 *   AsyncStorage on Android stores data as plain text in the app's
 *   data directory. Any process with file system access (including
 *   malware that obtained root) can read it.
 *
 *   expo-secure-store uses:
 *     iOS  — Keychain Services (hardware-backed on devices with Secure Enclave)
 *     Android — Android Keystore System (hardware-backed on API 23+)
 *
 * USAGE:
 *   Replace: await AsyncStorage.setItem('token', jwt)
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

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SECURE_KEYS = new Set(['token', 'refresh_token', 'user']);

/**
 * Write a value. Uses SecureStore for sensitive keys, AsyncStorage for the rest.
 */
export async function setItem(key: string, value: string): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await AsyncStorage.setItem(key, value);
  }
}

/**
 * Read a value. Checks SecureStore first for sensitive keys.
 */
export async function getItem(key: string): Promise<string | null> {
  if (SECURE_KEYS.has(key)) {
    return await SecureStore.getItemAsync(key);
  }
  return await AsyncStorage.getItem(key);
}

/**
 * Delete a value from the appropriate store.
 */
export async function removeItem(key: string): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    await SecureStore.deleteItemAsync(key);
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
