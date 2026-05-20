/**
 * AgeGateScreen -- Year-of-birth age verification
 *
 * Required before any user can browse or register.
 * Checks: birth year entered → calculated age ≥ 18.
 *
 * Legal basis:
 *   - Bail contracts require 18+ in all US states
 *   - Stripe ToS requires 18+ for payment processing
 *   - Juvenile cases use different courts/lawyers -- app content doesn't apply
 *
 * UX design:
 *   - Year only (not full DOB) -- least friction, sufficient for age check
 *   - Warm, non-accusatory copy
 *   - Under-18 path directs to Family Connect instead of hard-blocking
 *   - Result stored in AsyncStorage so gate never shows twice
 *
 * Entry point: App.tsx checks 'age_verified' key before showing any screen
 */
import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import { useNavigation } from '@react-navigation/native';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR     = CURRENT_YEAR - 100;   // 100 years old max
const MAX_YEAR     = CURRENT_YEAR - 18;    // must be born ≤ 18 years ago

type Phase = 'entry' | 'underage';

export default function AgeGateScreen({ route, navigation }: ScreenProps) {
  const { colors: COLORS } = useTheme();
  const [year, setYear]   = useState('');
  const [phase, setPhase] = useState<Phase>('entry');
  const navigation = useNavigation();
  const [error, setError] = useState('');

  const handleYear = (text: string) => {
    // Only digits, max 4 characters
    const clean = text.replace(/[^0-9]/g, '').slice(0, 4);
    setYear(clean);
    setError('');
  };

  const verify = async () => {
    const y = parseInt(year, 10);

    if (!year || year.length < 4 || isNaN(y)) {
      setError('Please enter your 4-digit birth year.');
      return;
    }
    if (y < MIN_YEAR || y > CURRENT_YEAR) {
      setError('Please enter a valid birth year.');
      return;
    }

    const age = CURRENT_YEAR - y;

    if (age < 18) {
      setPhase('underage');
      return;
    }

    // 18 or older -- mark verified and proceed
    await AsyncStorage.setItem('age_verified', 'true');
    if (onVerified) onVerified(); else navigation.navigate('Onboarding');
  };

  // ── Under 18 screen ────────────────────────────────────────────────────────
  if (phase === 'underage') return (
    <View style={styles.screen}>
      <View style={styles.centered}>
        <Text maxFontSizeMultiplier={1.4} style={styles.underageEmoji}>👨‍👩‍👧</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.underageTitle}>
          This app is for adults 18 and older.
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.underageSub}>
          If someone under 18 was arrested, a parent or guardian should use
          this app to find help. Tap below to search for a bail agent and lawyer
          on their behalf.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.familyBtn}
          onPress={async () => {
    try {

    hapticSelection();

            // Mark verified=false so gate shows again next time,
            // but set a family-mode flag and let the adult proceed
            await AsyncStorage.setItem('age_verified', 'family_mode');
            if (onVerified) onVerified(); else navigation.navigate('Onboarding');

    } catch (e) {
      __DEV__ && console.warn('[AgeGateScreen.tsx]', e?.message);
    }
  }}
          accessibilityLabel="I am the parent or guardian"
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.familyBtnText}>
            I'm a parent or guardian -- get help now →
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => { setPhase('entry'); setYear(''); }}
          accessibilityRole="button"
          accessibilityLabel="Go back and re-enter birth year"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.backBtnText}>← Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Entry screen ───────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.centered}>

        {/* Logo mark */}
        <View style={styles.logoWrap}>
          <Text maxFontSizeMultiplier={1.4} style={styles.logoText}>JTB</Text>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.title}>Justice Gavel</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subtitle}>Legal help at your fingertips</Text>

        <View style={styles.gateCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.gateTitle}>What year were you born?</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.gateHint}>
            You must be 18 or older to use this app.
          </Text>

          <TextInput
            style={[styles.yearInput, !!error && styles.yearInputError]}
            value={year}
            onChangeText={handleYear}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="e.g. 1990"
            placeholderTextColor={COLORS.textSecond}
            returnKeyType="done"
            onSubmitEditing={verify}
            autoFocus
            accessibilityLabel="Enter your birth year"
            accessibilityHint="Four digit year, for example 1985"
          />

          {!!error && (
            <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{error}</Text>
          )}
          <TouchableOpacity activeOpacity={0.6}
            style={[styles.continueBtn, year.length < 4 && styles.continueBtnDisabled]}
            onPress={verify}
            disabled={year.length < 4}
            accessibilityLabel="Continue"
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.continueBtnText}>Continue →</Text>
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.legalNote}>
          By continuing you agree to our{' '}
          <Text maxFontSizeMultiplier={1.4}
            style={styles.legalLink}
            onPress={() => Linking.openURL('https://justicegavel.app/terms').catch(() => {})}
          >
            Terms of Service
          </Text>
          {' '}and{' '}
          <Text maxFontSizeMultiplier={1.4}
            style={styles.legalLink}
            onPress={() => Linking.openURL('https://justicegavel.app/privacy').catch(() => {})}
          >
            Privacy Policy
          </Text>
          .
        </Text>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: COLORS.navy },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28,
  },

  logoWrap: {
    width: 64, height: 64, borderRadius: 14,
    backgroundColor: COLORS.steel,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12, ...SHADOW.md,
  },
  logoText:  { fontSize: 22, ...FONTS.black, color: COLORS.navy },
  title:     { fontSize: 28, ...FONTS.black, color: COLORS.bgCard, marginBottom: 4 },
  subtitle:  { fontSize: 12, lineHeight: 20, color: COLORS.steel, marginBottom: 36 },

  gateCard: {
    width: '100%', backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.xl, padding: 24,
    alignItems: 'center', ...SHADOW.lg,
    marginBottom: 20,
  },
  gateTitle: { fontSize: 18, ...FONTS.black, color: COLORS.navy, marginBottom: 6, textAlign: 'center' },
  gateHint:  { fontSize: 12, lineHeight: 20, color: COLORS.textMuted, marginBottom: 20, textAlign: 'center' },

  yearInput: {
    width: 160, height: 64,
    borderWidth: 2, borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    textAlign: 'center',
    fontSize: 32, ...FONTS.black, color: COLORS.navy,
    backgroundColor: COLORS.bg,  // light bg fallback (AgeGateScreen is light-only)
    marginBottom: 8,
    letterSpacing: 6,
  },
  yearInputError: { borderColor: COLORS.emergency },
  errorText:      { fontSize: 12, color: COLORS.emergency, marginBottom: 10, textAlign: 'center' },

  continueBtn: {
    width: '100%', backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg, paddingVertical: 15,
    alignItems: 'center', marginTop: 8,
  },
  continueBtnDisabled: { backgroundColor: COLORS.textSecond },
  continueBtnText:     { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },

  legalNote: { fontSize: 11, color: COLORS.steel, textAlign: 'center', lineHeight: 17 },
  legalLink: { color: COLORS.steel, textDecorationLine: 'underline' },

  // Under-18 screen
  underageEmoji: { fontSize: 48, marginBottom: 16 },
  underageTitle: {
    fontSize: 20, ...FONTS.black, color: COLORS.bgCard,
    textAlign: 'center', marginBottom: 12,
  },
  underageSub: {
    fontSize: 14, color: COLORS.steel, textAlign: 'center',
    lineHeight: 21, marginBottom: 28,
  },
  familyBtn: {
    width: '100%', backgroundColor: COLORS.bail,
    borderRadius: RADIUS.lg, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12, ...SHADOW.md,
  },
  familyBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },
  backBtn:       { paddingVertical: 12 },
  backBtnText:   { color: COLORS.steel, fontSize: 14, lineHeight: 21, ...FONTS.semi },
});
