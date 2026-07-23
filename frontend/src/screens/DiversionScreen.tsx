// @ts-ignore
import { COLORS } from '../constants/theme';
// @ts-ignore
import { useTranslation } from 'react-i18next';
import { useHaptics } from '../hooks/useHaptics';
/**
 * DiversionScreen.tsx — Diversion program eligibility (merged)
 *
 * Replaces: DiversionScreen.tsx + MentalHealthDiversionScreen.tsx
 * Drug diversion, mental health diversion, and veteran court —
 * all the same question: "Can I avoid a criminal record?"
 *
 * Tabs: Drug/Alcohol | Mental Health | Veterans Court
 */

import React, { useState, useCallback} from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  StyleSheet, LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../constants/theme';

type TabKey = 'drug' | 'mental' | 'veteran';

const TABS: { key: TabKey; label: string; emoji: string }[] = [
  { key: 'drug',    label: 'Drug / Alcohol', emoji: '💊' },
  { key: 'mental',  label: 'Mental Health',  emoji: '🧠' },
  { key: 'veteran', label: 'Veterans Court',  emoji: '🎖' },
];

// Drug diversion criteria (from DiversionScreen)
const DRUG_CRITERIA = [
  { question: 'Is this your first or second drug-related offense?', key: 'firstOffense' },
  { question: 'Was the charge for simple possession (not trafficking/distribution)?', key: 'possession' },
  { question: 'Do you have no prior violent criminal history?', key: 'nonViolent' },
  { question: 'Are you willing to complete a drug treatment program?', key: 'treatment' },
  { question: 'Can you comply with regular drug testing requirements?', key: 'testing' },
  { question: 'Is your charge a non-violent felony or misdemeanor?', key: 'chargeType' },
];

// Mental health diversion criteria (from MentalHealthDiversionScreen)
const MENTAL_CRITERIA = [
  { question: 'Have you been diagnosed with a qualifying mental health disorder (schizophrenia, bipolar, PTSD, depression, etc.)?', key: 'diagnosis' },
  { question: 'Is there a significant link between your mental illness and the alleged offense?', key: 'nexus' },
  { question: 'Is the charge a non-violent or low-level offense?', key: 'nonViolent' },
  { question: 'Are you willing to participate in a court-ordered mental health treatment plan?', key: 'treatment' },
  { question: 'Do you have stable housing or can it be arranged with assistance?', key: 'housing' },
  { question: 'Is this your first or second offense?', key: 'priorRecord' },
];

// Veteran court criteria
const VETERAN_CRITERIA = [
  { question: 'Are you a current or former member of the US military?', key: 'veteran' },
  { question: 'Do you have a service-connected condition (PTSD, TBI, substance abuse)?', key: 'serviceCondition' },
  { question: 'Is the charge a non-violent offense?', key: 'nonViolent' },
  { question: 'Are you willing to participate in VA services and treatment?', key: 'vaServices' },
  { question: 'Is there a Veterans Treatment Court in your jurisdiction?', key: 'localCourt' },
];

function DiversionScreen({ navigation }: any) {
  const { impact, success, error: hapticError } = useHaptics();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('drug');
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const styles = makeStyles(colors);

  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);

  const switchTab = (key: TabKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(key);
    setAnswers({});
  };

  const criteria = activeTab === 'drug' ? DRUG_CRITERIA :
                   activeTab === 'mental' ? MENTAL_CRITERIA : VETERAN_CRITERIA;

  const yesCount   = criteria.filter(c => answers[c.key]).length;
  const eligible   = yesCount === criteria.length;
  const maybeEligible = yesCount >= criteria.length - 1;

  return (
    // @ts-ignore
    <SafeAreaView style={[styles.container, { backgroundColor: (colors as any).background ?? COLORS.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityHint="Double-tap to activate">
          <Text style={[styles.back, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Diversion Programs</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Tabs */}
      // @ts-ignore
      // @ts-ignore
      <View style={[styles.tabBar, { borderBottomColor: (colors as any).border ?? COLORS.border }]}>
        {TABS?.length === 0 ? (

        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>📭</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
            Nothing here yet
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32 }}>
            Results will appear here when available
          </Text>
        </View>
        // @ts-ignore
        ) : items.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => switchTab(tab.key)}
          accessibilityState={{  selected: false  }}
            accessibilityRole="tab"
          >
            <Text style={{ fontSize: 16, marginBottom: 2 }}>{tab.emoji}</Text>
            <Text style={[styles.tabText, {
              // @ts-ignore
              color: activeTab === tab.key ? colors.primary : ((colors as any).subtext ?? COLORS.textMuted),
            }]}>
              {tab.label}
            </Text>
            {activeTab === tab.key && (
              <View style={[styles.tabLine, { backgroundColor: colors.primary }]} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        // @ts-ignore
        // @ts-ignore
        <Text style={[styles.intro, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
          Answer honestly — this helps determine if you may qualify for a diversion program
          that could keep a conviction off your record.
        </Text>

        {/* Eligibility checklist */}
        {criteria.map((c, i) => (
          <View key={c.key} style={[styles.card, { backgroundColor: (colors as any).card ?? colors.bg }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.question, { color: colors.text, flex: 1, marginRight: 12 }]}>
                {i + 1}. {c.question}
              </Text>
              <Switch
                value={answers[c.key] ?? false}
                onValueChange={val => setAnswers(prev => ({ ...prev, [c.key]: val }))}
                // @ts-ignore
                trackColor={{ false: COLORS.border, true: colors.primary + '66' }}
                // @ts-ignore
                thumbColor={answers[c.key] ? colors.primary : COLORS.textMuted}
              />
            </View>
          </View>
        ))}

        {/* Result */}
        {yesCount > 0 && (
          <View style={[styles.resultCard, {
            backgroundColor: eligible ? '#DCFCE7' : maybeEligible ? '#FEF3C7' : '#FEE2E2',
            // @ts-ignore
            borderColor: eligible ? COLORS.success : maybeEligible ? COLORS.warning : COLORS.emergency,
          }]}>
            <Text style={[styles.resultIcon]}>
              {eligible ? '✅' : maybeEligible ? '⚠️' : '❌'}
            </Text>
            <Text style={[styles.resultTitle, {
              color: eligible ? '#15803D' : maybeEligible ? '#92400E' : '#991B1B',
            }]}>
              {eligible     ? 'You may qualify for diversion' :
               maybeEligible? 'You may partially qualify — speak to an attorney' :
                              'You may not qualify — but ask an attorney to be sure'}
            </Text>
            // @ts-ignore
            // @ts-ignore
            <Text style={[styles.resultSub, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
              {yesCount} of {criteria.length} criteria met
            </Text>
          </View>
        )}

        {/* Attorney CTA */}
        <View style={[styles.ctaCard, { backgroundColor: (colors as any).primary + '15' }]}>
          <Text style={[styles.ctaTitle, { color: colors.primary }]}>
            Get a free case evaluation
          </Text>
          <Text style={[styles.ctaText, { color: colors.text }]}>
            Diversion eligibility depends on your specific case and prosecutor.
            An attorney who knows your district can give you a real answer.
          </Text>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
            onPress={() => navigation?.navigate('LawyersTab')}
            accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
          >
            <Text style={styles.ctaBtnText}>Find a lawyer →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:  { flex: 1 },
    header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
    back:       { fontSize: 16, fontWeight: '500' },
    title:      { fontSize: 18, fontWeight: '700' },
    tabBar:     { flexDirection: 'row', borderBottomWidth: 1 },
    tab:        { flex: 1, alignItems: 'center', paddingVertical: 10, position: 'relative' },
    tabActive:  {},
    tabText:    { fontSize: 11, fontWeight: '600', textAlign: 'center' },
    tabLine:    { position: 'absolute', bottom: 0, left: 8, right: 8, height: 2, borderRadius: 1 },
    intro:      { fontSize: 13, lineHeight: 18, marginBottom: 16 },
    // @ts-ignore
    card:       { borderRadius: 12, padding: 14, marginBottom: 8, elevation: 1, shadowColor: COLORS.text, shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:2 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    question:   { fontSize: 14, lineHeight: 20 },
    resultCard: { borderRadius: 12, padding: 16, marginVertical: 12, borderWidth: 1, alignItems: 'center' },
    resultIcon: { fontSize: 28, marginBottom: 8 },
    resultTitle:{ fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
    resultSub:  { fontSize: 12, textAlign: 'center' },
    ctaCard:    { borderRadius: 12, padding: 16, marginTop: 8 },
    ctaTitle:   { fontSize: 15, fontWeight: '700', marginBottom: 6 },
    ctaText:    { fontSize: 13, lineHeight: 18, marginBottom: 12 },
    ctaBtn:     { borderRadius: 24, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center' },
    ctaBtnText: { color: colors.bg, fontSize: 15, fontWeight: '600' },
  });
}

export default React.memo(DiversionScreen);