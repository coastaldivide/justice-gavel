import type { ScreenProps } from '../types/navigation';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, LayoutAnimation } from 'react-native';
import { api } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { t, perLang, useLang } from '../i18n';

const PLANS = perLang(() => [
  { key: 'basic',  label: t('x_insurance_basic'),  icon: '🛡️', desc: t('x_insurance_consultations_document_review_q'),     color: COLORS.blue },
  { key: 'legal_pro',    label: t('tier_legal_pro'),    icon: '⚖️', desc: t('x_insurance_basic_court_date_reminders'), color: COLORS.blue },
  { key: 'family', label: t('x_insurance_family'), icon: '👨‍👩‍👧', desc: t('x_insurance_pro_covers_spouse_dependents'),               color: COLORS.legalDark },
]);

const FEATURES = perLang(() => [
  { label: t('x_insurance_unlimited_legal_q'), basic: true,  pro: true,  family: true },
  { label: t('x_insurance_document_review_2_mo'),  basic: true,  pro: true,  family: true },
  { label: t('x_insurance_attorney_consultations'),  basic: false, pro: true,  family: true },
  { label: t('x_insurance_court_date_reminders'),    basic: false, pro: true,  family: true },
  { label: t('x_insurance_ai_lawyer_matching'),      basic: false, pro: true,  family: true },
  { label: t('x_insurance_covers_family_members'),   basic: false, pro: false, family: true },
]);

function InsuranceScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); return () => { mountedRef.current = false; }; }, []);

  const [plan, setPlan]     = useState('basic');
  const [quote, setQuote]   = useState<any>(null);
  const [error, setError]   = useState('');
  const [getting, setGetting] = useState(false);

  const getQuote = async () => {
    if (mountedRef.current) setGetting(true);
    if (mountedRef.current) setQuote(null);
    try {
const r = await api.post('/insurance/quote', { plan, city: 'your area' });
      if (mountedRef.current) setQuote(r.data || null);
    } catch {
      if (mountedRef.current) setError(t('x_insurance_could_not_load_insurance'));
    }
    if (mountedRef.current) setGetting(false);
  };

  const selected = PLANS().find(p => p.key === plan) ?? PLANS()[0];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll}
      testID="insurance-screen">

      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('x_insurance_legal_insurance')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.sub}>{t('x_insurance_protect_yourself_before_need')}</Text>
      </View>

      {/* Plan selector */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionTitle, { color: colors.textMuted }]}>{t('x_insurance_choose_plan')}</Text>
      {PLANS().map(p => (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          key={p.key}
          style={[styles.planCard, { backgroundColor: colors.bgCard, borderColor: colors.border }, plan === p.key && { borderColor: p.color, borderWidth: 2, backgroundColor: p.color + '0A' }]}
          onPress={() => { setPlan(p.key); setQuote(null); }}
          accessibilityLabel={t('x_insurance_select_insurance_plan')}
          activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.planIcon}>{p.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.planLabel, { color: colors.textPrimary }, plan === p.key && { color: p.color }]}>{p.label}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.planDesc, { color: colors.textSecond }]}>{p.desc}</Text>
          </View>
          <View style={[styles.radio, plan === p.key && { borderColor: p.color }]}>
            {plan === p.key && <View style={[styles.radioDot, { backgroundColor: p.color }]} />}
          </View>
        </TouchableOpacity>
      ))}

      {/* Feature comparison */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionTitle, { color: colors.textMuted }]}>{t('x_emergency_share_what_s_included')}</Text>
      <View style={[styles.featuresCard, { backgroundColor: colors.bgCard }]}>
        <View style={styles.featRow}>
          <View style={{ flex: 2 }} />
          {PLANS().map(p => (
            <Text maxFontSizeMultiplier={1.4} key={p.key} style={[styles.featHeader, { color: p.color }]}>{p.label}</Text>
          ))}
        </View>
        {FEATURES().map(f => (
          <View key={f.label} style={styles.featRow}>
            <Text maxFontSizeMultiplier={1.4} style={styles.featLabel}>{f.label}</Text>
            {(['basic', 'pro', 'family'] as const).map(k => (
              <Text maxFontSizeMultiplier={1.4} key={k} style={[styles.featCheck, f[k] ? styles.featYes : styles.featNo]}>
                {f[k] ? '✓' : '--'}
              </Text>
            ))}
          </View>
        ))}
      </View>

      {/* Get quote */}
      <TouchableOpacity
        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6} style={[styles.quoteBtn, { backgroundColor: selected.color }]} onPress={getQuote} disabled={getting}
      >
        {getting ? <ActivityIndicator color={colors.bgCard} /> : <Text maxFontSizeMultiplier={1.4} style={styles.quoteBtnText}>{t('x_insurance_get_my_quote', { label: selected.label })}</Text>}
      </TouchableOpacity>

      {!!error && (
        <View style={{ backgroundColor: colors.emergencyBg, borderRadius: 8, padding: 12, margin: 16, borderWidth: 1, borderColor: colors.emergencyBg }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontSize: 12 }}>⚠️  {error}</Text>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} onPress={() => { setError(''); setQuote(null); }}
            accessibilityLabel={t('x_insurance_retry')}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 }}>{t('x_insurance_retry')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {quote && (
        <View style={[styles.quoteResult, { borderColor: selected.color + '55', backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.quoteLabel}>{t('x_insurance_estimated_monthly_cost')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.quotePrice, { color: selected.color }]}>${quote.monthly}<Text maxFontSizeMultiplier={1.4} style={styles.quoteMo}>{t('x_check_in_manager_mo')}</Text></Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.quoteProvider}>{t('x_insurance_via', { provider: quote.provider })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.quoteLegal}>{quote.legalese}</Text>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={[styles.enrollBtn, { backgroundColor: selected.color }]} onPress={() => navigation.navigate('Payments', { productId: 'insurance' })}
            accessibilityLabel={t('x_insurance_enroll_now')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.enrollBtnText}>{t('x_insurance_enroll_now')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={{ height: 40 }} />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.warn,
        padding:12, marginTop:12, marginBottom:8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:colors.textSecond, fontStyle:'italic', lineHeight:16 }}>
          {t('x_insurance_general_information_only_not')}
        </Text>
      </View>

      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16 },
  header: { backgroundColor: COLORS.navy, borderRadius: 16, padding: 16, marginBottom: 16 },
  heading: { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900' },
  sub: { color: COLORS.bgSubtle, fontSize: 12, lineHeight: 20, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  planCard: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.border, elevation: 1 },
  planIcon: { fontSize: 28 },
  planLabel: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 2 },
  planDesc: { fontSize: 12, lineHeight: 16 },
  radio: { width: 22, height: 22, borderRadius: 12, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 8 },
  featuresCard: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginBottom: 14, elevation: 1 },
  featRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.bg },
  featLabel: { flex: 2, fontSize: 12, color: colors.info, lineHeight: 16 },
  featHeader: { flex: 1, fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textAlign: 'center' },
  featCheck: { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textAlign: 'center' },
  featYes: { color: colors.legal },
  featNo: { color: colors.textMuted },
  quoteBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 14 },
  quoteBtnText: { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  quoteResult: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 20, borderWidth: 1.5, alignItems: 'center', marginBottom: 10 },
  quoteLabel: { fontSize: 12, color: colors.info, fontWeight: '600', marginBottom: 4 },
  quotePrice: { fontSize: 44, fontFamily: 'Inter_900Black', fontWeight: '900' },
  quoteMo: { fontSize: 18, fontWeight: '400' },
  quoteProvider: { fontSize: 12, lineHeight: 20, color: colors.info, marginTop: 4, marginBottom: 6 },
  quoteLegal: { fontSize: 11, color: colors.info, textAlign: 'center', lineHeight: 16, marginBottom: 12 },
  enrollBtn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  enrollBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21 } });
export default React.memo(InsuranceScreen);
