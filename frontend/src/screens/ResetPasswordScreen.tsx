/**
 * ResetPasswordScreen — the page the password-reset e-mail links to:
 *   https://justicegavel.app/reset-password?token=…  (web + universal link)
 *
 * Registered in the root stack (App.tsx) so the link opens whether the person
 * is signed out, browsing or signed in. POST /auth/reset-password { token,
 * password }; the server signs the account out everywhere, so the next step is
 * always "Sign in".
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';

type Phase = 'form' | 'done';

function ResetPasswordScreen({ navigation, route }: ScreenProps<'ResetPassword'>): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const raw = (route.params as { token?: unknown } | undefined)?.token;
  const token = typeof raw === 'string' ? raw.trim() : '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const confirmRef = useRef<TextInput>(null);

  const goToSignIn = () => {
    const names = navigation.getState()?.routeNames || [];
    if (names.includes('GuestNav')) navigation.navigate('GuestNav', { screen: 'Login' });
    else navigation.navigate('MainTabs', { screen: 'MoreTab', params: { screen: 'Login' } });
  };

  const submit = async () => {
    if (busy) return;
    if (password.length < 8) { setError(t('x_rg_password_must_be_at')); return; }
    if (password !== confirm) { setError(t('rp_mismatch')); return; }
    setError(''); setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setPhase('done');
    } catch (e) {
      setError(apiErrorMessage(e, t('rp_failed')));
    } finally { setBusy(false); }
  };

  if (!token || phase === 'done') {
    const done = phase === 'done';
    return (
      <View testID="reset-password-screen" style={[styles.screen, styles.center]}>
        <View style={styles.card}>
          <Text maxFontSizeMultiplier={1.4} style={styles.title}>{done ? t('rp_done_title') : t('rp_title')}</Text>
          <Text testID={done ? 'reset-password-done' : 'reset-password-no-token'} maxFontSizeMultiplier={1.4} style={styles.body}>
            {done ? t('rp_done_body') : t('rp_no_token')}
          </Text>
          <TouchableOpacity accessibilityRole="button" testID="reset-password-sign-in" style={styles.primaryBtn} onPress={goToSignIn}>
            <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>{t('rp_sign_in')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView testID="reset-password-screen" style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, styles.center]} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text maxFontSizeMultiplier={1.4} style={styles.title} accessibilityRole="header">{t('rp_title')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('rp_sub')}</Text>

          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('rp_new')}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              testID="reset-password-input"
              secureTextEntry={!show}
              style={styles.input}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder={t('x_rg_at_least_8_characters')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('rp_new')}
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
              maxLength={200}
            />
            <TouchableOpacity accessibilityRole="button" onPress={() => setShow(v => !v)}
              accessibilityLabel={show ? t('x_lg_hide_password') : t('x_lg_show_password')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.showText}>{show ? t('x_lg_hide') : t('x_lg_show')}</Text>
            </TouchableOpacity>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('rp_confirm')}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              ref={confirmRef}
              testID="reset-password-confirm"
              secureTextEntry={!show}
              style={styles.input}
              value={confirm}
              onChangeText={v => { setConfirm(v); setError(''); }}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              accessibilityLabel={t('rp_confirm')}
              returnKeyType="done"
              onSubmitEditing={submit}
              maxLength={200}
            />
          </View>

          {!!error && (
            <Text testID="reset-password-error" accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.4} style={styles.error}>{error}</Text>
          )}

          <TouchableOpacity accessibilityRole="button" testID="reset-password-submit" disabled={busy}
            accessibilityState={{ disabled: busy, busy }} style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>{t('rp_submit')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.linkBtn} onPress={goToSignIn}>
            <Text maxFontSizeMultiplier={1.4} style={styles.linkText}>{t('rp_sign_in')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: typeof COLORS) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  scroll: { paddingVertical: 32 },
  card: { width: '100%', maxWidth: 440, backgroundColor: colors.bgCard, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: colors.border, padding: 24 },
  title: { fontSize: 22, ...FONTS.black, color: colors.textPrimary, marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 21, color: colors.textMuted, marginBottom: 16 },
  label: { fontSize: 12, ...FONTS.bold, color: colors.textMuted, marginTop: 12, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: RADIUS.md, paddingHorizontal: 14, backgroundColor: colors.bg },
  input: { flex: 1, minWidth: 0, paddingVertical: 14, fontSize: 15, color: colors.textPrimary },
  showText: { fontSize: 12, color: colors.textBrand, ...FONTS.semi, paddingLeft: 8 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: 12 },
  primaryBtn: { backgroundColor: colors.navy, borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', marginTop: 20, minHeight: 48, justifyContent: 'center' },
  primaryBtnText: { color: colors.textOnNavy, fontSize: 16, ...FONTS.bold },
  linkBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  linkText: { color: colors.textBrand, fontSize: 14, ...FONTS.semi },
});

export default React.memo(ResetPasswordScreen);
