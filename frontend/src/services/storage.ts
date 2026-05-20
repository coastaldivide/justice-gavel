import AsyncStorage from '@react-native-async-storage/async-storage';

export async function setContacts(c: string[]) {
  await AsyncStorage.setItem('contacts', JSON.stringify(c));
}

export async function getContacts(): Promise<string[]> {
  const v = await AsyncStorage.getItem('contacts');
  const stored: string[] = v ? JSON.parse(v) : [];
  // Always return exactly 3 slots, padding with empty strings
  return [stored[0] || '', stored[1] || '', stored[2] || ''];
}

export async function setUserName(n: string) {
  await AsyncStorage.setItem('userName', n);
}

export async function getUserName(): Promise<string> {
  // Prefer display name from user token
  const userData = await AsyncStorage.getItem('user');
  if (userData) {
    const user = JSON.parse(userData);
    if (user.displayName || user.name) return user.displayName || user.name;
  }
  return (await AsyncStorage.getItem('userName')) || 'User';
}
