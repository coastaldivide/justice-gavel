/**
 * LoginScreen -- Redesigned with JTB logo, dark brand aesthetic
 */
import React, { useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {  } from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { setAppAuth } from '../services/auth';
import { registerForPush } from '../services/push';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import * as secureStorage from '../utils/secureStorage';

declare var JusticeGavelLogo: any;
declare var showPassword: any;
export default function LoginScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [showPass, setShowPass]     = useState(false);
  const passRef = useRef<TextInput>(null);

  const onLogin = async () => {
    if (!identifier.trim()) { setError('Enter your email address or phone number to continue.'); return; }
    if (!password)           { setError('Enter your password to sign in.'); return; }
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/login', { identifier: identifier.trim(), password });
      await secureStorage.setToken( res.data?.token);
      await secureStorage.setItem('user', JSON.stringify(res.data?.user));
      try { const t = await registerForPush(); await api.post('/push/token', { expoPushToken: t }); } catch (e: any) { __DEV__ && console.warn(e?.message); }
      setAppAuth('authed');
    } catch (e: any) {
      setError(e.response?.data?.error || 'Login failed. Check your details and try again.');
    } finally { setLoading(false); }
  };

  const browseAsGuest = async () => {
    await AsyncStorage.setItem('onboarding_done', 'true');
    setAppAuth('browsing');
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Logo section */}
        <View style={styles.logoSection}>
          <View style={styles.logoWrap}>
            <JusticeGavelLogo size={96} showTagline={false} />
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.wordmark}>Justice Gavel</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.tagline}>YOUR LEGAL CONNECTION</Text>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text maxFontSizeMultiplier={1.4} style={styles.dividerText}>SIGN IN</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Browse without account -- TOP of form, first thing seen */}
        <TouchableOpacity style={styles.topBrowseBtn} onPress={browseAsGuest} activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="OR SIGN IN"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.topBrowseBtnText}>🔍  Search Without an Account</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.topBrowseBtnSub}>Find lawyers & bail agents instantly -- no sign-up</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text maxFontSizeMultiplier={1.4} style={styles.dividerText}>OR SIGN IN</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>Email or phone number</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="you@example.com  or  615-555-0100"
              placeholderTextColor={COLORS.textSecond}
              value={identifier}
              onChangeText={v => { setIdentifier(v); setError(''); }}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              testID="login-email-input"
              onSubmitEditing={() => passRef.current?.focus()}
              selectionColor={COLORS.steel}
            />
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <View style={styles.inputWrap}>
            <TextInput
              ref={passRef}
              testID="login-password-input"
              style={[styles.input, { flex: 1 }]}
              placeholder="Your password"
              placeholderTextColor={COLORS.textSecond}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={onLogin}
              selectionColor={COLORS.steel}
            />
            <TouchableOpacity onPress={() => setShowPass(s => !s)}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.showBtnText}>{showPass ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          {!!error && (
            <View style={styles.errorBox} testID="login-error-message">
              <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>⚠  {error}</Text>
            </View>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            style={{ alignItems: 'center', marginBottom: 10 }}
            onPress={() => {
              // forgot password

              const email = identifier.trim();
              if (!email) { Alert.alert('Enter your email first', 'Type your email above then tap "Forgot password?"'); return; }
              Alert.alert('Reset Password', `Send a reset link to ${email}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Send Link', onPress: () => {
                    api.post('/auth/forgot-password', { email })
                      .then(() => Alert.alert('Sent ✓', 'Check your email for a password reset link. It expires in 1 hour.'))
                      .catch(() => Alert.alert('Could not send', 'Check the email address and try again.'));
                  }
                },
              ]);
            }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.navy, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' }}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Sign In"
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            testID="login-submit-button" onPress={onLogin} disabled={loading} activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={colors.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>Sign In</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.registerLink} onPress={() => navigation.navigate('Register')} testID="login-register-link"
            accessibilityRole="button"
            accessibilityLabel="Create one"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.registerText}>
              Don't have an account?{'  '}
              <Text maxFontSizeMultiplier={1.4} style={styles.registerHighlight}>Create one</Text>
            </Text>
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.privacy}>
          🔒  Encrypted  ·  Never sold  ·  CCPA compliant
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 40 },

  logoSection: { alignItems: 'center', paddingTop: 72, paddingBottom: 28 },
  logoWrap: {
    width: 100, height: 100, borderRadius: RADIUS.xl,
    overflow: 'hidden', marginBottom: 16,
    shadowColor: COLORS.steel, shadowOpacity: 0.3,
    shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  wordmark: {
    fontSize: 30, ...FONTS.black, color: COLORS.bgCard,
    letterSpacing: 1, marginBottom: 4,
  },
  tagline: {
    fontSize: 11, ...FONTS.semi, color: COLORS.steel,
    letterSpacing: 5,
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: {
    fontSize: 11, ...FONTS.bold, color: COLORS.steel,
    letterSpacing: 3, marginHorizontal: 16,
  },

  form: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.xxl,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.lg,
  },
  label: { fontSize: 12, ...FONTS.bold, color: COLORS.textMuted, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 16,
  },
  input: { flex: 1, paddingVertical: 16, fontSize: 15, lineHeight: 22, color: COLORS.bgCard, ...FONTS.medium },
  showBtn: { paddingLeft: 10, paddingVertical: 6 },
  showBtnText: { fontSize: 12, lineHeight: 20, color: COLORS.steel, ...FONTS.semi },

  errorBox: {
    backgroundColor: 'rgba(183, 28, 28, 0.15)',
    borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(183,28,28,0.3)',
    padding: 12, marginTop: 12,
  },
  errorText: { color: '#EF5350', fontSize: 12, lineHeight: 20, ...FONTS.medium },

  primaryBtn: {
    backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg,
    paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
    borderWidth: 1, borderColor: COLORS.steel,
    ...SHADOW.md,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 0.5 },

  registerLink: { alignItems: 'center', marginTop: 16 },
  registerText: { fontSize: 14, lineHeight: 21, color: COLORS.textMuted },
  registerHighlight: { color: COLORS.steel, ...FONTS.bold },

  orRow:       { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  orLine:      { flex: 1, height: 1, backgroundColor: 'rgba(133,183,235,0.2)' },
  orText:      { fontSize: 11, color: colors.blue, fontFamily: 'Inter_700Bold', fontWeight: '700', marginHorizontal: 12, letterSpacing: 2 },
  browseBtn: {
    borderWidth: 1.5, borderColor: 'rgba(133,183,235,0.4)',
    borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20,
    alignItems: 'center', backgroundColor: 'rgba(133,183,235,0.07)',
  },
  browseBtnText: { color: '#85B7EB', fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  browseBtnSub:  { color: colors.blue, fontSize: 11, marginTop: 3, fontWeight: '500' },
  topBrowseBtn: {
    backgroundColor: colors.legal,
    borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: colors.legal,
    shadowColor: colors.legal, shadowOpacity: 0.3,
    shadowRadius: 8, elevation: 5,
  },
  topBrowseBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  topBrowseBtnSub:  { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 3 },
  privacy: { textAlign: 'center', color: COLORS.textMuted, fontSize: 11, marginTop: 28, letterSpacing: 0.5 },
});
