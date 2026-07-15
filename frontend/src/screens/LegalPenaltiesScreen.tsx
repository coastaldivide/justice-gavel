import { useHaptics } from '../hooks/useHaptics';
/**
 * LegalPenaltiesScreen.tsx — Legal penalties reference (merged)
 *
 * Replaces: DrugPenaltiesScreen.tsx + DUILawsScreen.tsx
 * Both screens answered the same question with the same UX pattern:
 * "What are the penalties for X in my state?"
 *
 * Tabs: Drug Offenses | DUI / Traffic | Other Offenses
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../constants/theme';
import { t } from '../i18n';

const TABS = [
  { key: 'drug', label: 'Drug Offenses' },
  { key: 'dui',  label: 'DUI / Traffic' },
  { key: 'other',label: 'Other Charges' },
] as const;

type TabKey = typeof TABS[number]['key'];

// Drug penalty data preserved from DrugPenaltiesScreen
const DRUG_SCHEDULES = [
  { schedule: 'Schedule I', examples: 'Heroin, LSD, Ecstasy, Peyote, PCP', max_years: 20, max_fine: 250000 },
  { schedule: 'Schedule II', examples: 'Cocaine, Meth, Oxycodone, Fentanyl', max_years: 15, max_fine: 100000 },
  { schedule: 'Schedule III', examples: 'Anabolic steroids, Ketamine, Codeine', max_years: 5, max_fine: 15000 },
  { schedule: 'Schedule IV', examples: 'Xanax, Valium, Ambien', max_years: 3, max_fine: 10000 },
  { schedule: 'Schedule V', examples: 'Cough preps, Pregabalin', max_years: 1, max_fine: 5000 },
];

// DUI data preserved from DUILawsScreen
const DUI_FACTS = [
  { label: 'Legal BAC Limit', value: '0.08% (0.04% for CDL, 0.02% under-21)' },
  { label: '1st Offense', value: 'Up to 6 months jail, $1,000–$2,000 fine, 6-month license suspension' },
  { label: '2nd Offense', value: 'Up to 1 year jail, $2,000–$5,000 fine, 2-year license suspension' },
  { label: 'Felony DUI', value: '3rd+ offense, injury/death involved, child passenger present' },
  { label: 'Implied Consent', value: 'Refusing BAC test = automatic license suspension in all 50 states' },
  { label: 'Aggravating Factors', value: 'BAC > 0.16%, speeding, accident, prior convictions' },
];

function LegalPenaltiesScreen({ navigation }: any) {
  const { impact, success, error: hapticError } = useHaptics();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('drug');
  const styles = makeStyles(colors);

  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);

  const switchTab = (key: TabKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(key);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: (colors as any).background ?? COLORS.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={[styles.back, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          Legal Penalties
        </Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { backgroundColor: (colors as any).warningBg ?? '#FEF3C7' }]}>
        <Text style={[styles.disclaimerText, { color: (colors as any).warning ?? '#92400E' }]}>
          ⚠ Penalties vary by state and case circumstances. This is general information, not legal advice.
        </Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: (colors as any).border ?? COLORS.border }]}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => switchTab(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text style={[
              styles.tabText,
              { color: activeTab === tab.key ? colors.primary : (colors as any).subtext ?? COLORS.textMuted }
            ]}>
              {tab.label}
            </Text>
            {activeTab === tab.key && (
              <View style={[styles.tabIndicator, { backgroundColor: colors.primary }]} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'drug' && (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Federal Drug Schedules & Maximum Penalties
            </Text>
            {DRUG_SCHEDULES.map((s, i) => (
              <View key={i} style={[styles.card, { backgroundColor: (colors as any).card ?? colors.bg }]}>
                <Text style={[styles.scheduleLabel, { color: colors.primary }]}>
                  {s.schedule}
                </Text>
                <Text style={[styles.examples, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
                  {s.examples}
                </Text>
                <View style={styles.penaltyRow}>
                  <View style={styles.penaltyItem}>
                    <Text style={[styles.penaltyValue, { color: (colors as any).error ?? COLORS.emergency }]}>
                      {s.max_years} yrs
                    </Text>
                    <Text style={[styles.penaltyLabel, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
                      Max prison
                    </Text>
                  </View>
                  <View style={styles.penaltyItem}>
                    <Text style={[styles.penaltyValue, { color: (colors as any).error ?? COLORS.emergency }]}>
                      ${s.max_fine.toLocaleString()}
                    </Text>
                    <Text style={[styles.penaltyLabel, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
                      Max fine
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'dui' && (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              DUI / DWI — Key Facts
            </Text>
            {DUI_FACTS.map((fact, i) => (
              <View key={i} style={[styles.card, { backgroundColor: (colors as any).card ?? colors.bg }]}>
                <Text style={[styles.factLabel, { color: colors.primary }]}>
                  {fact.label}
                </Text>
                <Text style={[styles.factValue, { color: colors.text }]}>
                  {fact.value}
                </Text>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'other' && (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Common Criminal Penalties
            </Text>
            {[
              { charge: 'Simple Assault', class: 'Misdemeanor', prison: '0–1 yr', fine: 'Up to $2,500' },
              { charge: 'Aggravated Assault', class: 'Felony', prison: '2–10 yrs', fine: 'Up to $25,000' },
              { charge: 'Theft (< $500)', class: 'Misdemeanor', prison: '0–1 yr', fine: 'Up to $2,000' },
              { charge: 'Theft ($500–$25k)', class: 'Felony', prison: '1–5 yrs', fine: 'Up to $10,000' },
              { charge: 'Burglary', class: 'Felony', prison: '2–15 yrs', fine: 'Up to $25,000' },
              { charge: 'Robbery', class: 'Felony', prison: '5–25 yrs', fine: 'Up to $50,000' },
              { charge: 'Identity Theft', class: 'Felony', prison: '2–10 yrs', fine: 'Up to $250,000' },
            ].map((item, i) => (
              <View key={i} style={[styles.card, { backgroundColor: (colors as any).card ?? colors.bg }]}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.chargeName, { color: colors.text }]}>{item.charge}</Text>
                  <Text style={[styles.chargeClass, {
                    color: item.class === 'Felony' ? ((colors as any).error ?? COLORS.emergency) : ((colors as any).warning ?? COLORS.warning),
                    backgroundColor: item.class === 'Felony' ? '#FEE2E2' : '#FEF3C7',
                  }]}>
                    {item.class}
                  </Text>
                </View>
                <Text style={[styles.sentenceText, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
                  Prison: {item.prison}  ·  Fine: {item.fine}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:    { flex: 1 },
    header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
    back:         { fontSize: 16, fontWeight: '500' },
    title:        { fontSize: 18, fontWeight: '700', textAlign: 'center' },
    disclaimer:   { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 8 },
    disclaimerText:{ fontSize: 12, lineHeight: 16 },
    tabBar:       { flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: 8 },
    tab:          { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
    tabActive:    {},
    tabText:      { fontSize: 13, fontWeight: '600' },
    tabIndicator: { position: 'absolute', bottom: 0, left: 8, right: 8, height: 2, borderRadius: 1 },
    sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
    card:         { borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: COLORS.text, shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:3, elevation:1 },
    scheduleLabel:{ fontSize: 15, fontWeight: '700', marginBottom: 4 },
    examples:     { fontSize: 13, lineHeight: 18, marginBottom: 10 },
    penaltyRow:   { flexDirection: 'row', gap: 16 },
    penaltyItem:  { flex: 1, alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 8, padding: 10 },
    penaltyValue: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
    penaltyLabel: { fontSize: 11 },
    factLabel:    { fontSize: 14, fontWeight: '700', marginBottom: 6 },
    factValue:    { fontSize: 13, lineHeight: 20 },
    rowBetween:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    chargeName:   { fontSize: 14, fontWeight: '600', flex: 1 },
    chargeClass:  { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
    sentenceText: { fontSize: 13 },
  });
}

export default React.memo(LegalPenaltiesScreen);
