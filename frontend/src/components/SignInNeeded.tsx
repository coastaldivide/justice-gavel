/**
 * SignInNeeded — what a signed-out visitor sees on a screen that shows their own
 * records (cases, a case's timeline, a court date, case documents, messages):
 * what the screen is for and a Sign in button (the AuthGate sheet: sign in or
 * create an account). It replaces the server's "Authentication required." with a
 * "Try again" that could never work. `onSignedIn` runs when a session exists.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getToken } from '../utils/secureStorage';
import { useTheme } from '../constants/theme';
import { useAuthGate } from './AuthGate';
import { t, useLang } from '../i18n';

export function SignInNeeded({ navigation, title, body, onSignedIn, testID = 'sign-in-needed' }: {
  navigation: Parameters<typeof useAuthGate>[0]; title?: string; body: string; onSignedIn: () => void; testID?: string;
}): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  return (
    <View testID={testID} style={styles.box}>
      <Text maxFontSizeMultiplier={1.4} style={styles.icon}>🔒</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">{title || t('sin_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.body, { color: colors.textSecond }]}>{body}</Text>
      <TouchableOpacity accessibilityRole="button" testID={`${testID}-button`} style={[styles.btn, { backgroundColor: colors.navy }]} onPress={() => requireAuth(onSignedIn)}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.btnText, { color: colors.textOnNavy }]}>{t('sign_in')}</Text>
      </TouchableOpacity>
      <AuthGateModal />
    </View>
  );
}

/** Whether a session exists: null while checking; checked again whenever the screen gets focus (back from Sign in). */
export function useHasSession(): { hasSession: boolean | null; recheck: () => void } {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const recheck = useCallback(() => {
    getToken().then(tk => setHasSession(!!tk), () => setHasSession(false));
  }, []);
  useFocusEffect(recheck);
  return { hasSession, recheck };
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 40, gap: 10, width: '100%', maxWidth: 520, alignSelf: 'center' },
  icon: { fontSize: 36 },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  btn: { borderRadius: 12, minHeight: 48, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  btnText: { fontSize: 16, fontWeight: '800' },
});
