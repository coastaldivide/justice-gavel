import type { ScreenProps } from '../types/navigation';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, LayoutAnimation } from 'react-native';
import { api } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';

const PLANS = [
  { key: 'basic',  label: 'Basic',  icon: '🛡️', desc: 'Consultations, document review, Q&A hotline',     color: COLORS.blue },
  { key: 'legal_pro',    label: 'Legal Pro',    icon: '⚖️', desc: 'Basic + court date reminders, attorney matching', color: COLORS.blue },
  { key: 'family', label: 'Family', icon: '👨‍👩‍👧', desc: 'Pro + covers spouse and dependents',               color: COLORS.legalDark },
];

const FEATURES = [
  { label: 'Unlimited legal Q&A', basic: true,  pro: true,  family: true },
  { label: 'Document review (2/mo)',  basic: true,  pro: true,  family: true },
  { label: 'Attorney consultations',  basic: false, pro: true,  family: true },
  { label: 'Court date reminders',    basic: false, pro: true,  family: true },
  { label: 'AI lawyer matching',      basic: false, pro: true,  family: true },
  { label: 'Covers family members',   basic: false, pro: false, family: true },
];

function InsuranceScreen({ navigation }: ScreenProps): React.JSX.Element {
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
      if (mountedRef.current) setError('Could not load insurance quote. Check your connection and try again.');
    }
    if (mountedRef.current) setGetting(false);
  };

  const selected = PLANS.find(p => p.key === plan) ?? PLANS[0];

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll}
      testID="insurance-screen">

      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Legal Insurance</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.sub}>Protect yourself before you need a lawyer</Text>
      </View>

      {/* Plan selector */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionTitle, { color: colors.textMuted }]}>Choose your plan</Text>
      {PLANS.map(p => (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          key={p.key}
          style={[styles.planCard, { backgroundColor: colors.bgCard, borderColor: colors.border }, plan === p.key && { borderColor: p.color, borderWidth: 2, backgroundColor: p.color + '0A' }]}
          onPress={() => { setPlan(p.key); setQuote(null); }}
          accessibilityLabel="Select insurance plan"
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
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionTitle, { color: colors.textMuted }]}>What's included</Text>
      <View style={[styles.featuresCard, { backgroundColor: colors.bgCard }]}>
        <View style={styles.featRow}>
          <View style={{ flex: 2 }} />
          {PLANS.map(p => (
            <Text maxFontSizeMultiplier={1.4} key={p.key} style={[styles.featHeader, { color: p.color }]}>{p.label}</Text>
          ))}
        </View>
        {FEATURES.map(f => (
          <View key={f.label} style={styles.featRow}>
            <Text maxFontSizeMultiplier={1.4} style={styles.featLabel}>{f.label}</Text>
            {(['basic', 'legal_pro', 'family'] as const).map(k => (
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
          accessibilityHint="Double-tap to activate" activeOpacity={0.6} style={[styles.quoteBtn, { backgroundColor: selected.color }]} onPress={getQuote} disabled={getting}
      >
        {getting ? <ActivityIndicator color={colors.bgCard} /> : <Text maxFontSizeMultiplier={1.4} style={styles.quoteBtnText}>Get my quote for {selected.label}</Text>}
      </TouchableOpacity>

      {!!error && (
        <View style={{ backgroundColor: colors.emergencyBg, borderRadius: 8, padding: 12, margin: 16, borderWidth: 1, borderColor: colors.emergencyBg }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontSize: 12 }}>⚠️  {error}</Text>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate" onPress={() => { setError(''); setQuote(null); }}
            accessibilityLabel="Retry →"
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 }}>Retry →</Text>
          </TouchableOpacity>
        </View>
      )}
      {quote && (
        <View style={[styles.quoteResult, { borderColor: selected.color + '55', backgroundColor: colors.bgCard }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.quoteLabel}>Your estimated monthly cost</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.quotePrice, { color: selected.color }]}>${quote.monthly}<Text maxFontSizeMultiplier={1.4} style={styles.quoteMo}>/mo</Text></Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.quoteProvider}>via {quote.provider}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.quoteLegal}>{quote.legalese}</Text>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate" style={[styles.enrollBtn, { backgroundColor: selected.color }]} onPress={() => navigation.navigate('Payments', { productId: 'insurance' })}
            accessibilityLabel="Enroll now →"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.enrollBtnText}>Enroll now →</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={{ height: 40 }} />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.warn,
        padding:12, marginTop:12, marginBottom:8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:colors.textSecond, fontStyle:'italic', lineHeight:16 }}>
          ⚖️ General information only -- not insurance or legal advice. Coverage terms
          vary by policy. Review your policy documents and consult a licensed insurance
          professional for advice specific to your situation.
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
