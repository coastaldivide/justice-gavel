import AsyncStorage from '@react-native-async-storage/async-storage';
import { getItem as getSecureItem } from '../utils/secureStorage';

export async function setContacts(c: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem('contacts', JSON.stringify(c));
  } catch { /* storage unavailable — contacts not persisted */ }
}

export async function getContacts(): Promise<string[]> {
  try {
    const v = await AsyncStorage.getItem('contacts');
    const stored: string[] = v ? JSON.parse(v) : [];
    // Always return exactly 3 slots, padding with empty strings
    return [stored[0] || '', stored[1] || '', stored[2] || ''];
  } catch {
    return ['', '', ''];
  }
}

/** The name the person typed for their alerts (Emergency contacts screen). */
export async function setUserName(n: string): Promise<void> {
  try {
    await AsyncStorage.setItem('userName', n.trim());
  } catch { /* storage unavailable */ }
}

/** Name shown in alerts: the account's name, else the one typed on the contacts screen, else ''. */
export async function getUserName(): Promise<string> {
  try {
    const userData = await getSecureItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      const n = user?.displayName || user?.display_name || user?.name;
      if (n) return String(n);
    }
  } catch { /* corrupt stored user: fall back to the typed name */ }
  try { return (await AsyncStorage.getItem('userName')) || ''; } catch { return ''; }
}
