/**
 * PILeadScreen -- Personal Injury & Civil Rights Lead Submission
 *
 * Lets a user describe their injury or rights violation.
 * Submitted lead goes to the PI attorney lead marketplace.
 * PI attorneys pay $50-$500 to accept the lead; user gets free connection.
 *
 * Entry points:
 *   1. LawyersScreen Need modal → "I Was Injured" or "Rights Violated"
 *   2. CaseScreen closed/dismissed → civil rights upsell button
 *   3. ChatScreen after PI or civil rights AI response
 *
 * Zero cost to user. Monetized via attorney lead fee.
 */
import React, { useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, RefreshControl} from 'react-native';
import { api } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

declare var data: any;
type Step = 'type' | 'severity' | 'details' | 'submitted';

const CASE_TYPES = [
  { key: 'Personal Injury',  label: 'I was injured',             icon: '🩹', color: COLORS.warnDark, bg: COLORS.bailBg,
    sub: 'Car accident, slip & fall, medical mistake, workplace injury' },
  { key: 'Civil Rights',     label: 'My rights were violated',   icon: '✊', color: COLORS.navy, bg: COLORS.bgSubtle,
    sub: 'Police misconduct, wrongful arrest, excessive force' },
  { key: 'Employment',       label: 'Work problem',              icon: '💼', color: COLORS.legalDark, bg: COLORS.legalBg,
    sub: 'Wrongful termination, discrimination, unpaid wages' },
  { key: 'Medical',          label: 'Medical malpractice',       icon: '🏥', color: COLORS.emergencyDark, bg: COLORS.emergencyBg,
    sub: 'Surgical error, misdiagnosis, medication mistake' },
];

const SEVERITIES = [
  { key: 'minor',        label: 'Minor',        sub: 'Small injury, recovered quickly',    color: COLORS.legalDark, bg: COLORS.legalBg,  fee: '$49.99' },
  { key: 'moderate',     label: 'Moderate',     sub: 'Medical treatment needed',           color: COLORS.warnDark, bg: COLORS.warnBg,  fee: '$149.99' },
  { key: 'serious',      label: 'Serious',      sub: 'Hospitalized or lasting impact',     color: COLORS.blue, bg: COLORS.bgSubtle,  fee: '$299.99' },
  { key: 'catastrophic', label: 'Catastrophic', sub: 'Permanent disability or death',      color: COLORS.emergencyDark, bg: COLORS.emergencyBg,  fee: '$499.99' },
];

export default function PILeadScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200)
  }, []);

  const { requireAuth } = useAuthGate(navigation);

  const initType = (route?.params as import('../types/api').RouteParams)?.caseType || '';

  const [step, setStep]         = useState<Step>(initType ? 'severity' : 'type');
  const [caseType, setCaseType] = useState(initType);
  const [severity, setSeverity] = useState('');
  const [description, setDesc]  = useState('');
  const [loading, setLoading]   = useState(false);

  const selectedType     = CASE_TYPES.find(t => t.key === caseType);
  const selectedSeverity = SEVERITIES.find(s => s.key === severity);

  const submit = () => requireAuth(async () => {
    if (!description.trim() || description.trim().length < 20) {
      Alert.alert('Add a bit more detail', 'Please describe what happened in a few sentences so attorneys can evaluate your case.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/billing/pi-lead/submit', {
        case_type:   caseType,
        severity,
        description: description.trim(),
      });
      setStep('submitted');
    } catch {
      Alert.alert('Could not submit', 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  });

  // ── Submitted ────────────────────────────────────────────────────────────
  if (step === 'submitted') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.successWrap}>
        <Text maxFontSizeMultiplier={1.4} style={styles.successEmoji}>✅</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.successTitle, { color: colors.textPrimary }]}>Your case is in review</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.successSub, { color: colors.textSecond }]}>
          Attorneys in your area will review your case. When one accepts, you'll get their contact info -- at no cost to you. Attorneys pay a referral fee, not you.
        </Text>
        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: COLORS.navy }]}
          onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
          accessibilityLabel="Find a lawyer now"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.doneBtnText}>⚖️  Browse Lawyers Now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.homeBtn}
          accessibilityRole="button"
          onPress={() => navigation.navigate('HomeTab')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.homeBtnText, { color: colors.textMuted }]}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>

        {/* Progress */}
        <View style={styles.progress}>
          {(['type','severity','details'] as Step[]).map((s, i) => (
            <View key={s} style={[
              styles.progressDot,
              { backgroundColor: ['type','severity','details'].indexOf(step) >= i
                  ? COLORS.navy : colors.border }
            ]} />
          ))}
        </View>

        {/* ── Step 1: Case type ─────────────────────────────────────────── */}
        {step === 'type' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>What happened?</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepSub, { color: colors.textMuted }]}>
              Your case description is free and confidential. Attorneys pay to contact you -- you pay nothing.
            </Text>
            {CASE_TYPES.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.typeCard, { backgroundColor: t.bg, borderColor: t.color + '55' }]}
                onPress={() => { setCaseType(t.key); setStep('severity'); }}
            accessibilityRole="button"
                accessibilityLabel={t.label}

              >
                <Text maxFontSizeMultiplier={1.4} style={styles.typeIcon}>{t.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.typeLabel, { color: t.color }]}>{t.label}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.typeSub, { color: colors.textMuted }]}>{t.sub}</Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={[styles.typeArrow, { color: t.color }]}>›</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ── Step 2: Severity ──────────────────────────────────────────── */}
        {step === 'severity' && (
          <>
            <TouchableOpacity onPress={() => setStep('type')} style={styles.back}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.backText, { color: colors.textMuted }]}>← Back</Text>
            </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>How serious was it?</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepSub, { color: colors.textMuted }]}>
              This helps match you with the right attorney. More serious cases connect with more experienced lawyers.
            </Text>
            {(caseType === 'Civil Rights' ? SEVERITIES.slice(0, 3) : SEVERITIES).map(s => (
              <TouchableOpacity
                key={s.key}
                style={[styles.sevCard, { backgroundColor: s.bg, borderColor: s.color + '44' },
                  severity === s.key && { borderColor: s.color, borderWidth: 2 }]}
                onPress={() => { setSeverity(s.key); setStep('details'); }}
            accessibilityRole="button"
                accessibilityLabel={s.label}

              >
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.sevLabel, { color: s.color }]}>{s.label}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.sevSub, { color: colors.textSecond }]}>{s.sub}</Text>
                </View>
                <View style={[styles.feePill, { backgroundColor: s.color }]}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.feePillText}>{s.fee} attorney fee</Text>
                </View>
              </TouchableOpacity>
            ))}
            <Text maxFontSizeMultiplier={1.4} style={[styles.feeNote, { color: colors.textMuted }]}>
              The fee is paid by the attorney who takes your case -- not by you.
            </Text>
          </>
        )}

        {/* ── Step 3: Description ───────────────────────────────────────── */}
        {step === 'details' && (
          <>
            <TouchableOpacity onPress={() => setStep('severity')} style={styles.back}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.backText, { color: colors.textMuted }]}>← Back</Text>
            </TouchableOpacity>

            {/* Summary badge */}
            <View style={[styles.summaryBadge, { backgroundColor: selectedType ? selectedType.bg : colors.bgCard,
              borderColor: selectedType ? selectedType.color + '55' : colors.border }]}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 18 }}>{selectedType?.icon}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.summaryText, { color: selectedType?.color || colors.textPrimary }]}>
                {selectedType?.label} · {selectedSeverity?.label}
              </Text>
            </View>

            <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>Describe what happened</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepSub, { color: colors.textMuted }]}>
              Be specific -- when, where, and what happened. Attorneys use this to evaluate your case. Keep it factual.
            </Text>

            <TextInput
              style={[styles.descInput, { backgroundColor: colors.bgCard, borderColor: colors.border,
                color: colors.textPrimary }]}
              multiline
              maxLength={2000}
              numberOfLines={7}
              placeholder="e.g. On March 12, 2025 I was rear-ended at the intersection of..."
              placeholderTextColor={COLORS.textSecond}
              value={description}
              onChangeText={setDesc}
              textAlignVertical="top"
              accessibilityLabel="Describe what happened"

          returnKeyType="next"
          blurOnSubmit
        />

            <Text maxFontSizeMultiplier={1.4} style={[styles.charCount, { color: colors.textMuted }]}>
              {description.length < 20 ? `${20 - description.length} more characters needed` : `${description.length} characters`}
            </Text>

            {/* Privacy note */}
            <View style={[styles.privacyNote, { backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle,
              borderColor: colors.blue + '44' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.privacyText, { color: colors.blue }]}>
                🔒 Your name and contact info are hidden from attorneys until you choose to share them. You stay anonymous until a match is made.
              </Text>
            </View>

            <TouchableOpacity activeOpacity={0.6}
              style={[styles.submitBtn, { backgroundColor: COLORS.navy },
                (loading || description.trim().length < 20) && styles.submitBtnDisabled]}
              onPress={submit}
              disabled={loading || description.trim().length < 20}
              accessibilityLabel="Submit your case to attorneys"
              accessibilityRole="button"
            >
              {loading
                ? <ActivityIndicator color={colors.bgCard} />
                : <Text maxFontSizeMultiplier={1.4} style={styles.submitBtnText}>Submit My Case -- Free →</Text>}
            </TouchableOpacity>
          </>
        )}


      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📋</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No civil leads available</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection or broaden your search criteria.</Text>
        </View>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 60 },

  progress: { flexDirection: 'row', gap: 8, marginBottom: 20, justifyContent: 'center' },
  progressDot: { width: 24, height: 4, borderRadius: 2 },

  back:     { marginBottom: 8 },
  backText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  stepTitle: { fontSize: 22, ...FONTS.black, marginBottom: 6 },
  stepSub:   { fontSize: 12, lineHeight: 19, marginBottom: 20 },

  // Type step
  typeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RADIUS.lg, borderWidth: 1.5,
    padding: 16, marginBottom: 10, ...SHADOW.sm,
  },
  typeIcon:  { fontSize: 28 },
  typeLabel: { fontSize: 16,
    lineHeight: 24, ...FONTS.black, marginBottom: 2 },
  typeSub:   { fontSize: 12, lineHeight: 16 },
  typeArrow: { fontSize: 22, fontWeight: '300' },

  // Severity step
  sevCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: RADIUS.lg, borderWidth: 1,
    padding: 16, marginBottom: 10, ...SHADOW.sm,
  },
  sevLabel:  { fontSize: 16, lineHeight: 24, ...FONTS.black, marginBottom: 2 },
  sevSub:    { fontSize: 12 },
  feePill:   { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, marginLeft: 8 },
  feePillText:{ color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  feeNote:   { fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 16 },

  // Details step
  summaryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: RADIUS.md, borderWidth: 1,
    padding: 10, marginBottom: 16, alignSelf: 'flex-start',
  },
  summaryText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  descInput: {
    borderWidth: 1.5, borderRadius: RADIUS.lg,
    padding: 16, fontSize: 14, lineHeight: 21,
    minHeight: 160, marginBottom: 6,
  },
  charCount:   { fontSize: 11, textAlign: 'right', marginBottom: 14 },
  privacyNote: { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 16 },
  privacyText: { fontSize: 12, lineHeight: 17 },
  submitBtn:         { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.md },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText:     { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },

  // Submitted
  successWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  successTitle: { fontSize: 22, ...FONTS.black, textAlign: 'center', marginBottom: 10 },
  successSub:   { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  doneBtn:      { borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 28, alignItems: 'center', ...SHADOW.md, marginBottom: 12 },
  doneBtnText:  { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },
  homeBtn:      { paddingVertical: 10 },
  homeBtnText:  { fontSize: 14,
    lineHeight: 21, },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);