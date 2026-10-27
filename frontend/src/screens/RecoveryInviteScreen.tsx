/**
 * RecoveryInviteScreen — the link in a bail agent's "shared a forfeited bond with you" e-mail
 * (https://justicegavel.app/recovery/<token>). A root-level route like the signing link, so it
 * opens signed out, browsing or signed in.
 *
 * Signed in: accepts the invitation (POST /api/recovery-shares/accept) — the account must use the
 * address the invitation was sent to — and opens the shared file. Signed out: explains to sign in
 * or create an account with that address and open the link again. Nothing about the bond is shown
 * before the invitation is accepted. ⚖ server setting BOND_RECOVERY_SHARING_ENABLED.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line } from '../components/bondDesk/ui';

export const SHARE_TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

function RecoveryInviteScreen({ navigation: nav, route }: ScreenProps) {
  // root-level screen: navigates into MainTabs / GuestNav, which the typed param list does not model
  const navigation = nav as unknown as { navigate: (name: string, params?: object) => void; getState?: () => { routeNames?: string[] } };
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const token = String((route?.params as { token?: string } | undefined)?.token || '');
  const [state, setState] = useState<'working' | 'signin' | 'error'>('working');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const open = (shareId: number) => {
    navigation.navigate('MainTabs', { screen: 'MoreTab', params: { screen: 'RecoveryShares', params: { shareId } } });
  };
  const accept = async () => {
    if (!SHARE_TOKEN.test(token)) { setState('error'); setError(t('rsh_invalid_link')); return; }
    setState('working');
    try {
      const r = await api.post<{ share_id: number }>('/recovery-shares/accept', { token });
      if (mounted.current) open(r.data.share_id);
    } catch (e) {
      const err = e as { response?: { status?: number } };
      if (!mounted.current) return;
      if (err?.response?.status === 401) { setState('signin'); return; }
      setState('error'); setError(apiErrorMessage(e, t('rsh_accept_failed')));
    }
  };
  useEffect(() => { accept(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const goAuth = (screen: 'Login' | 'Register') => {
    const names = navigation.getState?.()?.routeNames || [];
    if (names.includes('GuestNav')) navigation.navigate('GuestNav', { screen });
    else navigation.navigate('MainTabs', { screen: 'MoreTab', params: { screen } });
  };

  return (
    <ScrollView testID="recovery-invite-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('rsh_invite_title')}</Text>
      </View>
      <Card>
        {state === 'working' && <ActivityIndicator color={colors.textBrand} />}
        {state === 'signin' && (
          <>
            <Line testID="recovery-invite-signin">{t('rsh_invite_signin')}</Line>
            <Btn label={t('rsh_sign_in')} onPress={() => goAuth('Login')} testID="recovery-invite-login" />
            <Btn kind="ghost" label={t('rsh_create_account')} onPress={() => goAuth('Register')} testID="recovery-invite-register" />
          </>
        )}
        {state === 'error' && (
          <>
            <Line tone="danger" testID="recovery-invite-error">{error}</Line>
            <Btn kind="ghost" label={t('try_again')} onPress={accept} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
});

export default React.memo(RecoveryInviteScreen);
