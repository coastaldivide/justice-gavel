import AsyncStorage from '@react-native-async-storage/async-storage';

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

export async function setUserName(n: string): Promise<void> {
  try {
    await AsyncStorage.setItem('userName', n);
  } catch { /* storage unavailable */ }
}

export async function getUserName(): Promise<string> {
  try {
    // Prefer display name from user token
    const userData = await AsyncStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      if (user.displayName || user.name) return user.displayName || user.name;
    }
    return (await AsyncStorage.getItem('userName')) || 'User';
  } catch {
    return 'User';
  }
}
