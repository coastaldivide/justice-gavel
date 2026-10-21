import { useConfirm } from '../hooks/useConfirm';
import JTBLogo from '../components/JTBLogo';
import { useToast } from '../components/ToastProvider';
/**
 * LoginScreen -- Redesigned with JTB logo, dark brand aesthetic
 */
import React, { useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { setAppAuth } from '../services/auth';
import { startSession } from '../services/session';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { t, useLang } from '../i18n';
import { isEmail } from '../utils/identifier';
import { IconLabel, ICONS } from '../components/AppIcon';


function LoginScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [showPass, setShowPass]     = useState(false);
  const passRef = useRef<TextInput>(null);

  const onLogin = async () => {
if (loading) return;
        if (!identifier.trim()) { setError(t('x_lg_enter_email_address_phone')); return; }
    if (!password)           { setError(t('x_lg_enter_password_sign')); return; }
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/login', { identifier: identifier.trim(), password });
      if (!res.data?.token) throw new Error(t('x_lg_login_failed_check_details'));
      const inApp = !!navigation.getParent()?.getState()?.routeNames?.includes('HomeTab');
      await startSession(res.data);
      // In the guest flow the whole navigator is replaced. Opened from inside the
      // app (browsing → "Sign in"): back to where the person was. Either way
      // App.tsx then opens the account's home screen (after the Terms gate).
      if (inApp && navigation.canGoBack()) navigation.goBack();
    } catch (e: unknown) {
      setError(apiErrorMessage(e, t('x_lg_login_failed_check_details')));
    } finally { setLoading(false); }
  };

  const browseAsGuest = async () => {
    await AsyncStorage.setItem('onboarding_done', 'true').catch(() => {}); // non-fatal storage write
    await AsyncStorage.setItem('has_browsed', 'true').catch(() => {});
    setAppAuth('browsing');
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="login-screen">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Logo section */}
        <View style={styles.logoSection}>
          <View style={styles.logoWrap}>
            <JTBLogo size={96} />
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.wordmark}>Justice Gavel</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.tagline}>{t('x_lg_legal_connection')}</Text>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text maxFontSizeMultiplier={1.4} style={styles.dividerText}>{t('x_lg_sign')}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Browse without account -- TOP of form, first thing seen */}
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.topBrowseBtn} onPress={browseAsGuest} activeOpacity={0.85}
        >
          <IconLabel icon={ICONS.search} textStyle={styles.topBrowseBtnText} maxFontSizeMultiplier={1.4}>{t('x_lg_search_without_account')}</IconLabel>
          <Text maxFontSizeMultiplier={1.4} style={styles.topBrowseBtnSub}>{t('x_lg_find_lawyers_bail_agents')}</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text maxFontSizeMultiplier={1.4} style={styles.dividerText}>{t('x_lg_sign_2')}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('x_lg_email_phone_number')}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder={t('x_lg_email_phone_number_2')}
              placeholderTextColor={colors.textSecond}
              value={identifier}
              onChangeText={(v) => { setIdentifier(v); setError(''); }}
          maxLength={254}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              testID="login-email-input"
              accessibilityLabel={t('x_lg_email_address_phone_number')}
              onSubmitEditing={() => passRef.current?.focus()}
              selectionColor={COLORS.steel}
            />
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.label, { marginTop: 16 }]}>{t('password')}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              ref={passRef}
              testID="login-password-input"
              style={[styles.input, { flex: 1 }]}
              placeholder={t('x_lg_password')}
              placeholderTextColor={colors.textSecond}
              secureTextEntry={!showPass}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={onLogin}
              selectionColor={COLORS.steel}
            />
            <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} accessibilityLabel={showPass ? t('x_lg_hide_password') : t('x_lg_show_password')} onPress={() => setShowPass(s => !s)}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.showBtnText}>{showPass ? t('x_lg_hide') : t('x_lg_show')}</Text>
            </TouchableOpacity>
          </View>

          {!!error && (
            <View style={styles.errorBox} testID="login-error-message">
              <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.errorText} maxFontSizeMultiplier={1.4}>{error}</IconLabel>
            </View>
          )}
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={{ alignItems: 'center', marginBottom: 10 }}
            onPress={() => {
              // forgot password

              const email = identifier.trim();
              if (!email) { showToast(t('x_lg_enter_email_first_then'), 'info'); return; }
              // Reset links go by e-mail only (phone numbers cannot receive one).
              if (!isEmail(email)) { setError(t('lg_reset_needs_email')); return; }
              confirm(t('x_lg_reset_password'), t('x_lg_send_reset_link', { email }),
                { confirmLabel: t('x_lg_send_link') }).then(ok => {
                if (!ok) return;
                api.post('/auth/forgot-password', { email })
                  .then(() => showToast(t('x_lg_reset_link_sent_check'), 'success'))
                  .catch((e: unknown) => showToast(apiErrorMessage(e, t('x_lg_could_not_send_reset')), 'error'));
              });
            }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textBrand, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' }}>{t('x_lg_forgot_password')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"

            accessibilityLabel={t('sign_in')}
          accessibilityHint={t('x_lg_signs_account')}
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            testID="login-submit-button" onPress={onLogin} disabled={loading} activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={colors.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>{t('sign_in')}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.registerLink} onPress={() => navigation.navigate('Register')} testID="login-register-link"
            accessibilityLabel={t('x_lg_create_one')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.registerText}>
              {t('x_lg_don_t_have_account')}{' '}
              <Text maxFontSizeMultiplier={1.4} style={styles.registerHighlight}>{t('x_lg_create_one')}</Text>
            </Text>
          </TouchableOpacity>
        </View>

        <IconLabel icon={ICONS.lock} textStyle={styles.privacy} maxFontSizeMultiplier={1.4}>{t('x_lg_encrypted_never_sold_ccpa')}</IconLabel>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 40 },

  logoSection: { alignItems: 'center', paddingTop: 72, paddingBottom: 28 },
  logoWrap: {
    width: 100, height: 100, borderRadius: RADIUS.xl,
    overflow: 'hidden', marginBottom: 16,
    shadowColor: COLORS.steel, shadowOpacity: 0.3,
    shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  wordmark: {
    fontSize: 30, ...FONTS.black, color: colors.textPrimary,
    letterSpacing: 1, marginBottom: 4,
  },
  tagline: {
    fontSize: 11, ...FONTS.semi, color: colors.info,
    letterSpacing: 5,
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontSize: 11, ...FONTS.bold, color: colors.info,
    letterSpacing: 3, marginHorizontal: 16,
  },

  form: {
    backgroundColor: colors.bgCard,
    borderRadius: RADIUS.xxl,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    ...SHADOW.lg,
  },
  label: { fontSize: 12, ...FONTS.bold, color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 16,
  },
  input: { flex: 1, paddingVertical: 16, fontSize: 15, lineHeight: 22, color: colors.bgCard, ...FONTS.medium },
  showBtn: { paddingLeft: 10, paddingVertical: 6 },
  showBtnText: { fontSize: 12, lineHeight: 20, color: colors.info, ...FONTS.semi },

  errorBox: {
    backgroundColor: colors.emergencyBg,
    borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(183,28,28,0.3)',
    padding: 12, marginTop: 12,
  },
  errorText: { color: colors.emergency, fontSize: 12, lineHeight: 20, ...FONTS.medium },

  primaryBtn: {
    backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg,
    paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
    borderWidth: 1, borderColor: COLORS.steel,
    ...SHADOW.md,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: colors.white, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 0.5 },

  registerLink: { alignItems: 'center', marginTop: 16 },
  registerText: { fontSize: 14, lineHeight: 21, color: colors.textMuted },
  registerHighlight: { color: colors.info, ...FONTS.bold },

  orRow:       { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  orLine:      { flex: 1, height: 1, backgroundColor: 'rgba(133,183,235,0.2)' },
  orText:      { fontSize: 11, color: colors.info, fontFamily: 'Inter_700Bold', fontWeight: '700', marginHorizontal: 12, letterSpacing: 2 },
  browseBtn: {
    borderWidth: 1.5, borderColor: 'rgba(133,183,235,0.4)',
    borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20,
    alignItems: 'center', backgroundColor: 'rgba(133,183,235,0.07)',
  },
  browseBtnText: { color: COLORS.steel, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  browseBtnSub:  { color: colors.info, fontSize: 11, marginTop: 3, fontWeight: '500' },
  topBrowseBtn: {
    backgroundColor: colors.legal,
    borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: colors.legal,
    shadowColor: colors.legal, shadowOpacity: 0.3,
    shadowRadius: 8, elevation: 5,
  },
  topBrowseBtnText: { color: colors.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  topBrowseBtnSub:  { color: colors.textOnAccent, fontSize: 11, marginTop: 3 },
  privacy: { textAlign: 'center', color: colors.textMuted, fontSize: 11, marginTop: 28, letterSpacing: 0.5 },
});
export default React.memo(LoginScreen);