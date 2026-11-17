/**
 * ConfirmEmailScreen — the page the "confirm your new e-mail address" message links to:
 *   https://justicegavel.app/confirm-email?token=…  (web + universal link)
 *
 * A new e-mail address is used only after this link is opened (sandbox review 2026-11-17,
 * finding 2; backend POST /auth/confirm-email). Registered in the root stack (App.tsx) so the
 * link opens signed out, browsing or signed in. The server signs the account out everywhere
 * when the address changes, so this device's session is cleared too and the next step is
 * "Sign in" with the new address.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { signOut } from '../services/session';
import { getToken } from '../utils/secureStorage';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';

type Phase = 'working' | 'done' | 'failed';
const TOKEN_RE = /^[0-9a-f]{64}$/;

function ConfirmEmailScreen({ navigation, route }: ScreenProps<'ConfirmEmail'>): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const raw = (route.params as { token?: unknown } | undefined)?.token;
  const token = typeof raw === 'string' ? raw.trim() : '';
  const [phase, setPhase] = useState<Phase>(TOKEN_RE.test(token) ? 'working' : 'failed');
  const [message, setMessage] = useState(TOKEN_RE.test(token) ? '' : t('ce_no_token'));
  const started = useRef(false);

  const goToSignIn = useCallback(() => {
    const names = navigation.getState()?.routeNames || [];
    if (names.includes('GuestNav')) navigation.navigate('GuestNav', { screen: 'Login' });
    else navigation.navigate('MainTabs', { screen: 'MoreTab', params: { screen: 'Login' } });
  }, [navigation]);

  useEffect(() => {
    if (started.current || !TOKEN_RE.test(token)) return;
    started.current = true;
    (async () => {
      try {
        const r = await api.post<{ message?: string }>('/auth/confirm-email', { token });
        // Every session of the account just ended on the server: end this one too.
        if (await getToken().catch(() => null)) await signOut({ serverDone: true }).catch(() => undefined);
        setMessage(r.data?.message || t('ce_done_body'));
        setPhase('done');
      } catch (e) {
        setMessage(apiErrorMessage(e, t('ce_failed')));
        setPhase('failed');
      }
    })();
  }, [token]);

  return (
    <View testID="confirm-email-screen" style={[styles.screen, styles.center]}>
      <View style={styles.card}>
        <Text maxFontSizeMultiplier={1.4} style={styles.title} accessibilityRole="header">
          {phase === 'done' ? t('ce_done_title') : t('ce_title')}
        </Text>
        {phase === 'working' ? (
          <ActivityIndicator testID="confirm-email-working" size="large" color={colors.textBrand} style={{ marginVertical: 16 }} />
        ) : (
          <Text testID={phase === 'done' ? 'confirm-email-done' : 'confirm-email-failed'} accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={1.4} style={phase === 'done' ? styles.body : [styles.body, { color: colors.danger }]}>
            {message}
          </Text>
        )}
        {phase !== 'working' && (
          <TouchableOpacity accessibilityRole="button" testID="confirm-email-sign-in" style={styles.primaryBtn} onPress={goToSignIn}>
            <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>{t('rp_sign_in')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: typeof COLORS) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 440, backgroundColor: colors.bgCard, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: colors.border, padding: 24 },
  title: { fontSize: 22, ...FONTS.black, color: colors.textPrimary, marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 21, color: colors.textMuted, marginBottom: 8 },
  primaryBtn: { backgroundColor: colors.navy, borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginTop: 16, minHeight: 48, justifyContent: 'center' },
  primaryBtnText: { color: colors.textOnNavy, fontSize: 16, ...FONTS.bold },
});

export default React.memo(ConfirmEmailScreen);
