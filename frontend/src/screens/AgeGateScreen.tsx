import { useToast } from '../components/ToastProvider';
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
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Linking, LayoutAnimation} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { hapticSelection } from '../utils/webCompat';
import { t, useLang } from '../i18n';

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR     = CURRENT_YEAR - 100;   // 100 years old max

type Phase = 'entry' | 'underage';

interface AgeGateProps {
  /** Present when mounted in the guest stack. */
  navigation?: { navigate: (name: string) => void };
  /** Present when App.tsx renders the gate before any navigator. */
  onVerified?: () => void;
}

function AgeGateScreen({ navigation, onVerified }: AgeGateProps) {
  useLang();

  const { showToast } = useToast();
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const { colors: COLORS } = useTheme();
  const styles = makeStyles();
  const [year, setYear]   = useState('');
  const [phase, setPhase] = useState<Phase>('entry');
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
      setError(t('x_age_gate_please_enter_birth_year'));
      return;
    }
    if (y < MIN_YEAR || y > CURRENT_YEAR) {
      setError(t('x_age_gate_please_enter_valid_year'));
      return;
    }

    const age = CURRENT_YEAR - y;

    if (age < 18) {
      setPhase('underage');
      return;
    }

    // 18 or older -- mark verified and proceed
    try {
      await AsyncStorage.setItem('age_verified', 'true');
    } catch {
      // Storage unavailable — still proceed, gate will re-show on next launch
    }
    if (onVerified) onVerified(); else navigation?.navigate('Onboarding');
  };

  // ── Under 18 screen ────────────────────────────────────────────────────────
  if (phase === 'underage') return (
    <View style={styles.screen}>
      {/* ── Emergency bypass — always accessible regardless of age gate ─── */}
      <TouchableOpacity
        onPress={() => { if (navigation) navigation.navigate('Emergency'); else Linking.openURL('tel:911').catch(() => {}); }}
        accessibilityRole="button"
        accessibilityLabel={t('x_age_gate_emergency_help_get_immediate')}
        style={{ backgroundColor: COLORS.bail, borderRadius: 10, padding: 14, marginBottom: 20, flexDirection: 'row', alignItems: 'center' }}
      >
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: COLORS.white, fontWeight: '700', fontSize: 15 }}>{t('x_age_gate_need_help_right_now')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: COLORS.textOnNavy, fontSize: 12, marginTop: 2 }}>{t('x_age_gate_emergency_access_no_setup')}</Text>
        </View>
        <Text style={{ color: COLORS.white, fontSize: 20 }}>→</Text>
      </TouchableOpacity>

      <View style={styles.centered}>
        <Text maxFontSizeMultiplier={1.4} style={styles.underageEmoji}>👨‍👩‍👧</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.underageTitle}>
          {t('x_age_gate_this_app_adults_18')}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.underageSub}>
          {t('x_age_gate_if_someone_under_18')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.familyBtn}
          onPress={async () => {
    try {

    hapticSelection();

            // Mark verified=false so gate shows again next time,
            // but set a family-mode flag and let the adult proceed
            try {
              await AsyncStorage.setItem('age_verified', 'family_mode');
            } catch { /* non-fatal — family mode flag re-set on next launch */ }
            if (onVerified) onVerified(); else navigation?.navigate('Onboarding');

    } catch (e: any) {
      __DEV__ && console.warn('[AgeGateScreen.tsx]', e?.message);
    }
  }}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.familyBtnText}>
            {t('x_age_gate_i_m_parent_guardian')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.backBtn}
          accessibilityLabel={t('x_age_gate_go_back')} onPress={() => { setPhase('entry'); setYear(''); }}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.backBtnText}>{t('x_age_gate_go_back')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Entry screen ───────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      testID="age-gate-screen"
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.centered}>

        {/* Logo mark */}
        <View style={styles.logoWrap}>
          <Text maxFontSizeMultiplier={1.4} style={styles.logoText}>JTB</Text>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.title}>Justice Gavel</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subtitle}>{t('x_age_gate_legal_help_at_fingertips')}</Text>

        <View style={styles.gateCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.gateTitle}>{t('x_age_gate_what_year_were_born')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.gateHint}>
            {t('x_age_gate_must_be_18_older')}
          </Text>

          <TextInput
            style={[styles.yearInput, !!error && styles.yearInputError]}
            value={year}
            onChangeText={handleYear}
            keyboardType="number-pad"
            maxLength={4}
            placeholder={t('ag_year_placeholder')}
            placeholderTextColor={COLORS.textSecond}
            returnKeyType="done"
            onSubmitEditing={verify}
            autoFocus
            accessibilityLabel={t('x_age_gate_enter_birth_year')}
            accessibilityHint={t('x_age_gate_four_digit_year_example')}
          />

          {!!error && (
            <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{error}</Text>
          )}
          <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
            style={[styles.continueBtn, year.length < 4 && styles.continueBtnDisabled]}
            onPress={verify}
            disabled={year.length < 4}
            accessibilityLabel={t('continue')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.continueBtnText}>{t('x_age_gate_continue')}</Text>
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.4} style={styles.legalNote}>
          {t('x_age_gate_by_continuing_agree_our')}{' '}
          <Text maxFontSizeMultiplier={1.4}
            style={styles.legalLink}
            onPress={() => Linking.openURL('https://justicegavel.app/terms').catch(() => showToast(t('action_failed'), 'error'))}
          >
            {t('onb_terms_tos')}
          </Text>
          {' '}{t('x_legal_disclaimer_modal_text')}{' '}
          <Text maxFontSizeMultiplier={1.4}
            style={styles.legalLink}
            onPress={() => Linking.openURL('https://justicegavel.app/privacy').catch(() => showToast(t('action_failed'), 'error'))}
          >
            {t('onb_terms_pp')}
          </Text>
          .
        </Text>

      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = () => StyleSheet.create({
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

export default React.memo(AgeGateScreen);