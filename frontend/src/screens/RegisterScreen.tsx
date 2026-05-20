import TermsAcceptanceModal from './TermsAcceptanceModal';
import Analytics from '../services/analytics';
import React, { useState, useRef } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { api } from '../services/api';
import { setAppAuth } from '../services/auth';
import JusticeGavelLogo from '../components/JTBLogo';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import * as secureStorage from '../utils/secureStorage';

export default function RegisterScreen({ navigation }: ScreenProps): JSX.Element {
  const { colors, isDark } = useTheme();
  const [showTerms, setShowTerms] = React.useState(false);
  const [identifier, setIdentifier]   = useState('');
  const [password, setPassword]       = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [showPass, setShowPass]       = useState(false);
  const passRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);

  const onRegister = async () => {
    if (!identifier.trim()) { setError('Enter your email or phone number to create your account.'); return; }
    if (!password || password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        identifier: identifier.trim(), password,
        displayName: displayName.trim() || undefined,
      });
      await secureStorage.setToken( res.data?.token);
      await secureStorage.setItem('user', JSON.stringify(res.data?.user));
      // Schedule D7 re-engagement push (fires only if user stays free)
      api.post('/push/d7-reengage').catch((e) => { __DEV__ && console.warn(e?.message); });
      setAppAuth('authed');
    } catch (e) {
      setError(e.response?.data?.error || 'Registration failed. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <View style={styles.logoSection}>
          <View style={styles.logoWrap}>
            <JusticeGavelLogo size={72} />
          </View>
          <Text maxFontSizeMultiplier={1.4} style={styles.wordmark}>Create Account</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.tagline}>Free to use  ·  Legal help for everyone</Text>
        </View>

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
          autoComplete="email"
          importantForAutofill="yes" keyboardType={identifier.includes("@") || (!identifier.match(/^[0-9]/) && identifier.length > 0) ? "email-address" : "phone-pad"}
              textContentType="username" returnKeyType="next"
              onSubmitEditing={() => passRef.current?.focus()}
              selectionColor={COLORS.steel}
            />
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <View style={styles.inputWrap}>
            <TextInput
              ref={passRef}
              style={[styles.input, { flex: 1 }]}
              placeholder="At least 6 characters"
              placeholderTextColor={COLORS.textSecond}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              textContentType="newPassword" returnKeyType="next"
              onSubmitEditing={() => nameRef.current?.focus()}
              selectionColor={COLORS.steel}
            />
            <TouchableOpacity onPress={() => setShowPass(s => !s)}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.showBtnText}>{showPass ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          <Text maxFontSizeMultiplier={1.4} style={[styles.label, { marginTop: 16 }]}>
            Display name <Text maxFontSizeMultiplier={1.4} style={styles.optional}>(optional)</Text>
          </Text>
          <View style={styles.inputWrap}>
            <TextInput
              ref={nameRef}
              style={styles.input}
              placeholder="How should we address you?"
              placeholderTextColor={COLORS.textSecond}
              value={displayName} onChangeText={setDisplayName}
              textContentType="name" returnKeyType="done"
              onSubmitEditing={onRegister}
              selectionColor={COLORS.steel}
            />
          </View>

          {!!error && (
            <View style={styles.errorBox}>
              <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>⚠  {error}</Text>
            </View>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Create Account"
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={onRegister} disabled={loading} activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={colors.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>Create Account</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.loginLink}
            accessibilityRole="button"
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.loginText}>
              Already have an account?{'  '}
              <Text maxFontSizeMultiplier={1.4} style={styles.loginHighlight}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        
      <TermsAcceptanceModal
        visible={showTerms}
        onAccept={() => setShowTerms(false)}
        onDecline={() => setShowTerms(false)}
      />
    </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.privacy}>
          By creating an account you agree to our{' '}
            <Text maxFontSizeMultiplier={1.4}
              style={{ color: COLORS.navy, textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL('https://justicegavel.app/terms').catch(() => {})}
            >Terms of Service</Text>.{'\n'}We never sell your data.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 40 },
  logoSection: { alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 56 : 44, paddingBottom: 24 },
  logoWrap: {
    width: 76, height: 76, borderRadius: RADIUS.lg, overflow: 'hidden',
    marginBottom: 14, shadowColor: COLORS.steel, shadowOpacity: 0.25,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  wordmark: { fontSize: 28, ...FONTS.black, color: COLORS.bgCard, letterSpacing: 0.5, marginBottom: 4 },
  tagline: { fontSize: 12, ...FONTS.medium, color: COLORS.steel },
  form: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xxl,
    padding: 24, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.lg,
  },
  label: { fontSize: 12, ...FONTS.bold, color: COLORS.textMuted, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  optional: { ...FONTS.reg, color: COLORS.textSecond, textTransform: 'none' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 16,
  },
  input: { flex: 1, paddingVertical: 16, fontSize: 15, lineHeight: 22, color: COLORS.bgCard, ...FONTS.medium },
  showBtn: { paddingLeft: 10, paddingVertical: 6 },
  showBtnText: { fontSize: 12, lineHeight: 20, color: COLORS.steel, ...FONTS.semi },
  errorBox: {
    backgroundColor: 'rgba(183,28,28,0.15)', borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(183,28,28,0.3)', padding: 12, marginTop: 12,
  },
  errorText: { color: '#EF5350', fontSize: 12, lineHeight: 20, ...FONTS.medium },
  primaryBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
    borderWidth: 1, borderColor: COLORS.steel, ...SHADOW.md,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 0.5 },
  loginLink: { alignItems: 'center', marginTop: 16 },
  loginText: { fontSize: 14, lineHeight: 21, color: COLORS.textMuted },
  loginHighlight: { color: COLORS.steel, ...FONTS.bold },
  privacy: { textAlign: 'center', color: COLORS.textMuted, fontSize: 11, marginTop: 24, lineHeight: 18 },
});
