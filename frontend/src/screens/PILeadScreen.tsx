import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
/**
 * PILeadScreen -- Personal Injury & Civil Rights Lead Submission
 *
 * Lets a user describe their injury or rights violation.
 * Submitted lead goes to the PI attorney lead marketplace.
 * Attorneys pay a flat connection fee (the same for every case). You pay nothing.
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
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl, LayoutAnimation} from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { attorneyLeadFeeDisplay } from '../constants/leadFee';
import { Picker } from '@react-native-picker/picker';
import { getUserState, localizedStateList } from '../utils/userState';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme, type ThemeColors, themeColors } from '../constants/theme';
import { hapticImpact } from '../utils/webCompat';
import { useAuthGate } from '../components/AuthGate';
import { t, perLang, useLang } from '../i18n';

type Step = 'type' | 'severity' | 'details' | 'submitted';

const CASE_TYPES = perLang(() => {
  const c = themeColors();
  return [
  { key: 'Personal Injury',  label: t('x_pilead_i_was_injured'),             icon: ICONS.drug, color: c.warnDark, bg: c.bailBg,
    sub: t('x_pilead_car_accident_slip_fall') },
  { key: 'Civil Rights',     label: t('x_pilead_my_rights_were_violated'),   icon: ICONS.rights, color: c.textBrand, bg: c.bgSubtle,
    sub: t('x_pilead_police_misconduct_wrongful_arrest') },
  { key: 'Employment',       label: t('x_pilead_work_problem'),              icon: ICONS.briefcase, color: c.legalDark, bg: c.legalBg,
    sub: t('x_pilead_wrongful_termination_discrimination_') },
  { key: 'Medical',          label: t('x_pilead_medical_malpractice'),       icon: ICONS.medical, color: c.emergencyDark, bg: c.emergencyBg,
    sub: t('x_pilead_surgical_error_misdiagnosis_medicati') },
];
});

const SEVERITIES = perLang(() => {
  const c = themeColors();
  return [
  { key: 'minor',        label: t('x_pilead_minor'),        sub: t('x_pilead_small_injury_recovered_quickly'),    color: c.legalDark, bg: c.legalBg },
  { key: 'moderate',     label: t('x_pilead_moderate'),     sub: t('x_pilead_medical_treatment_needed'),           color: c.warnDark, bg: c.warnBg },
  { key: 'serious',      label: t('x_pilead_serious'),      sub: t('x_pilead_hospitalized_lasting_impact'),     color: c.info, bg: c.bgSubtle },
  { key: 'catastrophic', label: t('x_pilead_catastrophic'), sub: t('x_pilead_permanent_disability_death'),      color: c.emergencyDark, bg: c.emergencyBg },
];
});

function PILeadScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  return () => { mountedRef.current = false; }; }, []);
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
  const [stateCode, setStateCode] = useState('');
  const [city, setCity]         = useState('');
  const [fees, setFees]         = useState<Record<string, string> | null>(null);

  React.useEffect(() => {
    getUserState().then(st => { if (st?.code && mountedRef.current) setStateCode(c => c || st.code); }).catch(() => {});
    api.get('/billing/pi-lead/fees').then(r => {
      const map: Record<string, string> = {};
      for (const f of (r.data?.fees || []) as { lead_type: string; fee_display: string }[]) map[f.lead_type] = f.fee_display;
      if (mountedRef.current) setFees(map);
    }).catch(() => {});
  }, []);

  const selectedType     = CASE_TYPES().find(tItem => tItem.key === caseType);
  const selectedSeverity = SEVERITIES().find(s => s.key === severity);

  const submit = () => requireAuth(async () => {
    hapticImpact().catch(() => undefined);   // haptics are optional
    if (!description.trim() || description.trim().length < 20) {
      showToast(t('x_pilead_please_describe_what_happened'));
      return;
    }
    if (!stateCode) { showToast(t('pl_state_required'), 'warning'); return; }
    if (mountedRef.current) setLoading(true);
    try {
      await api.post('/billing/pi-lead/submit', {
        case_type:   caseType,
        severity,
        description: description.trim(),
        state:       stateCode,
        city:        city.trim() || undefined,
      });
      if (mountedRef.current) setStep('submitted');
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('pl_submit_failed')), 'error');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  });

  // ── Submitted ────────────────────────────────────────────────────────────
  if (step === 'submitted') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.successWrap}>
        <AppIcon name="checkmark-circle" size={20} color={colors.legal} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.successTitle, { color: colors.textPrimary }]}>{t('x_pilead_case_review')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.successSub, { color: colors.textSecond }]}>
          {t('x_pilead_attorneys_area_will_review')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.doneBtn, { backgroundColor: COLORS.navy }]}
          accessibilityLabel={t('x_pilead_browse_lawyers_now')} onPress={() => navigation.navigate('LawyersTab')}
        >
          <IconLabel icon={ICONS.lawyer} textStyle={styles.doneBtnText} maxFontSizeMultiplier={1.4}>{t('x_pilead_browse_lawyers_now_2')}</IconLabel>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.homeBtn}
          accessibilityLabel={t('x_booking_back_home')} onPress={() => navigation.navigate('HomeTab')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.homeBtnText, { color: colors.textMuted }]}>{t('x_booking_back_home')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      testID="p-i-lead-screen"
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
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>{t('x_pilead_what_happened')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepSub, { color: colors.textMuted }]}>
              {t('x_pilead_case_description_free_confidential')}
            </Text>
            {CASE_TYPES().map(tItem => (
              <TouchableOpacity
                accessibilityRole="button"
                key={tItem.key}
                style={[styles.typeCard, { backgroundColor: tItem.bg, borderColor: tItem.color + '55' }]}
                accessibilityLabel={tItem.label} onPress={() => { setCaseType(tItem.key); setStep('severity'); }}

              >
                <AppIcon name={tItem.icon} size={22} color={colors.textBrand} style={styles.typeIcon} />
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.typeLabel, { color: tItem.color }]}>{tItem.label}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.typeSub, { color: colors.textMuted }]}>{tItem.sub}</Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={[styles.typeArrow, { color: tItem.color }]}>›</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ── Step 2: Severity ──────────────────────────────────────────── */}
        {step === 'severity' && (
          <>
            <TouchableOpacity
          accessibilityRole="button" accessibilityLabel={t('ja_back')} onPress={() => setStep('type')} style={styles.back}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.backText, { color: colors.textMuted }]}>{t('ja_back')}</Text>
            </TouchableOpacity>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>{t('x_pilead_how_serious_was_it')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepSub, { color: colors.textMuted }]}>
              {t('x_pilead_this_helps_match_with')}
            </Text>
            {(caseType === 'Civil Rights' ? SEVERITIES().slice(0, 3) : SEVERITIES()).map(s => (
              <TouchableOpacity
                accessibilityRole="button"
                key={s.key}
                style={[styles.sevCard, { backgroundColor: s.bg, borderColor: s.color + '44' },
                  severity === s.key && { borderColor: s.color, borderWidth: 2 }]}
                onPress={() => { setSeverity(s.key); setStep('details'); }}
                accessibilityLabel={s.label}

              >
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.sevLabel, { color: s.color }]}>{s.label}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.sevSub, { color: colors.textSecond }]}>{s.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <Text maxFontSizeMultiplier={1.4} style={[styles.feeNote, { color: colors.textMuted }]}>
              {t('x_pilead_attorneys_pay_flat_connection', { PI_LEAD_FEE_DISPLAY: attorneyLeadFeeDisplay(caseType, fees) })}
            </Text>
          </>
        )}

        {/* ── Step 3: Description ───────────────────────────────────────── */}
        {step === 'details' && (
          <>
            <TouchableOpacity
          accessibilityRole="button" accessibilityLabel={t('ja_back')} onPress={() => setStep('severity')} style={styles.back}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.backText, { color: colors.textMuted }]}>{t('ja_back')}</Text>
            </TouchableOpacity>

            {/* Summary badge */}
            <View style={[styles.summaryBadge, { backgroundColor: selectedType ? selectedType.bg : colors.bgCard,
              borderColor: selectedType ? selectedType.color + '55' : colors.border }]}>
              {!!selectedType && <AppIcon name={selectedType.icon} size={18} color={selectedType.color} />}
              <Text maxFontSizeMultiplier={1.4} style={[styles.summaryText, { color: selectedType?.color || colors.textPrimary }]}>
                {selectedType?.label} · {selectedSeverity?.label}
              </Text>
            </View>

            <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, { color: colors.textPrimary }]}>{t('x_pilead_describe_what_happened')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepSub, { color: colors.textMuted }]}>
              {t('x_pilead_be_specific_when_where')}
            </Text>

            <TextInput
              style={[styles.descInput, { backgroundColor: colors.bgCard, borderColor: colors.border,
                color: colors.textPrimary }]}
              multiline
              maxLength={2000}
              numberOfLines={7}
              placeholder={t('x_pilead_e_g_march_12')}
              placeholderTextColor={colors.textSecond}
              value={description}
              onChangeText={setDesc}
              textAlignVertical="top"
              accessibilityLabel={t('x_pilead_describe_what_happened')}

          returnKeyType="next"
          blurOnSubmit
        />

            <Text maxFontSizeMultiplier={1.4} style={[styles.charCount, { color: colors.textMuted }]}>
              {description.length < 20 ? t('x_pilead_more_characters_needed', { value: 20 - description.length }) : t('x_pilead_characters', { length: description.length })}
            </Text>

            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textSecond }]}>{t('pl_state_label')}</Text>
            <View style={[styles.pickerWrap, { borderColor: colors.border, backgroundColor: colors.bgCard }]}>
              <Picker testID="pilead-state" selectedValue={stateCode} onValueChange={v => setStateCode(String(v))}
                style={{ height: 48, color: colors.textPrimary, backgroundColor: colors.bgCard, borderWidth: 0, paddingHorizontal: 8 }}>
                <Picker.Item label={t('pl_state_pick')} value="" />
                {localizedStateList().map(st => <Picker.Item key={st.code} label={st.name} value={st.code} />)}
              </Picker>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textSecond }]}>{t('pl_city_label')}</Text>
            <TextInput testID="pilead-city" value={city} onChangeText={setCity} maxLength={100} accessibilityLabel={t('pl_city_label')}
              placeholder={t('pl_city_placeholder')} placeholderTextColor={colors.placeholder}
              style={[styles.cityInput, { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]} />

            {/* Privacy note */}
            <View style={[styles.privacyNote, { backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle,
              borderColor: colors.blue + '44' }]}>
              <IconLabel icon={ICONS.lock} textStyle={[styles.privacyText, { color: colors.info }]} maxFontSizeMultiplier={1.4}>{t('x_pilead_name_contact_info_hidden')}</IconLabel>
            </View>

            <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
              style={[styles.submitBtn, { backgroundColor: COLORS.navy },
                (loading || description.trim().length < 20 || !stateCode) && styles.submitBtnDisabled]}
              onPress={submit}
              disabled={loading || description.trim().length < 20 || !stateCode}
              accessibilityLabel={t('x_pilead_submit_case_attorneys')}
          accessibilityHint={t('cp_double_tap')}
            >
              {loading
                ? <ActivityIndicator color={colors.bgCard} />
                : <Text maxFontSizeMultiplier={1.4} style={styles.submitBtnText}>{t('x_pilead_submit_my_case_free')}</Text>}
            </TouchableOpacity>
          </>
        )}


      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
  fieldLabel:  { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 6 },
  pickerWrap:  { borderWidth: 1.5, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: 12 },
  cityInput:   { borderWidth: 1.5, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  privacyNote: { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 16 },
  privacyText: { fontSize: 12, lineHeight: 17 },
  submitBtn:         { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.md },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText:     { color: colors.white, fontSize: 16, lineHeight: 24, ...FONTS.black },

  // Submitted
  successWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  successTitle: { fontSize: 22, ...FONTS.black, textAlign: 'center', marginBottom: 10 },
  successSub:   { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  doneBtn:      { borderRadius: RADIUS.lg, paddingVertical: 16, paddingHorizontal: 28, alignItems: 'center', ...SHADOW.md, marginBottom: 12 },
  doneBtnText:  { color: colors.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },
  homeBtn:      { paddingVertical: 10 },
  homeBtnText:  { fontSize: 14,
    lineHeight: 21, },
});

// Module-level fallback for helper components
export default React.memo(PILeadScreen);