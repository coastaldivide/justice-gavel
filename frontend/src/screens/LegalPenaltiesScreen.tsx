import { COLORS } from '../constants/theme';
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
import { t, perLang, useLang } from '../i18n';

const TABS = perLang(() => [
  { key: 'drug', label: t('hn_charge_drug') },
  { key: 'dui',  label: t('x_legal_penalties_dui_traffic') },
  { key: 'other',label: t('x_legal_penalties_other_charges') },
] as const);

type TabKey = ReturnType<typeof TABS>[number]['key'];

// Drug penalty data preserved from DrugPenaltiesScreen
const DRUG_SCHEDULES = perLang(() => [
  { schedule: t('x_legal_penalties_schedule_i'), examples: t('x_legal_penalties_heroin_lsd_ecstasy_peyote'), max_years: 20, max_fine: 250000 },
  { schedule: t('x_legal_penalties_schedule_ii'), examples: t('x_legal_penalties_cocaine_meth_oxycodone_fentanyl'), max_years: 15, max_fine: 100000 },
  { schedule: t('x_legal_penalties_schedule_iii'), examples: t('x_legal_penalties_anabolic_steroids_ketamine_codeine'), max_years: 5, max_fine: 15000 },
  { schedule: t('x_legal_penalties_schedule_iv'), examples: t('x_legal_penalties_xanax_valium_ambien'), max_years: 3, max_fine: 10000 },
  { schedule: t('x_legal_penalties_schedule_v'), examples: t('x_legal_penalties_cough_preps_pregabalin'), max_years: 1, max_fine: 5000 },
]);

// DUI data preserved from DUILawsScreen
const DUI_FACTS = perLang(() => [
  { label: t('x_legal_penalties_legal_bac_limit'), value: t('x_legal_penalties_bac_value') },
  { label: t('x_legal_penalties_1st_offense'), value: t('x_legal_penalties_first_value') },
  { label: t('x_legal_penalties_2nd_offense'), value: t('x_legal_penalties_second_value') },
  { label: t('x_legal_penalties_felony_dui'), value: t('x_legal_penalties_felony_value') },
  { label: t('x_legal_penalties_implied_consent'), value: t('x_legal_penalties_implied_value') },
  { label: t('x_legal_penalties_aggravating_factors'), value: t('x_legal_penalties_aggravating_value') },
]);

function LegalPenaltiesScreen({ navigation }: any) {
  useLang();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('drug');
  const styles = makeStyles();

  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);

  const switchTab = (key: TabKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(key);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: (colors as any).bg ?? COLORS.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack()}
          accessibilityLabel={t('x_gradient_header_go_back')}
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={[styles.back, { color: colors.primary }]}>{t('ja_back')}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('x_legal_penalties_legal_penalties')}
        </Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { backgroundColor: (colors as any).warningBg ?? colors.warnBg }]}>
        <Text style={[styles.disclaimerText, { color: (colors as any).warning ?? colors.warnDark }]}>
          {t('x_legal_penalties_penalties_vary_by_state')}
        </Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: (colors as any).border ?? COLORS.border }]}>
        {(TABS() as any)?.length === 0 ? (

        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>📭</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
            {t('empty_state_nothing')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32 }}>
            {t('x_attorney_privacy_results_will_appear_here')}
          </Text>
        </View>
        ) : TABS().map(tab => (
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
              {t('x_legal_penalties_federal_drug_schedules_maximum')}
            </Text>
            {DRUG_SCHEDULES().map((s, i) => (
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
                      {t('x_legal_penalties_yrs', { max_years: s.max_years })}
                    </Text>
                    <Text style={[styles.penaltyLabel, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
                      {t('x_legal_penalties_max_prison')}
                    </Text>
                  </View>
                  <View style={styles.penaltyItem}>
                    <Text style={[styles.penaltyValue, { color: (colors as any).error ?? COLORS.emergency }]}>
                      ${s.max_fine.toLocaleString()}
                    </Text>
                    <Text style={[styles.penaltyLabel, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
                      {t('x_legal_penalties_max_fine')}
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
              {t('x_legal_penalties_dui_dwi_key_facts')}
            </Text>
            {DUI_FACTS().map((fact, i) => (
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
              {t('x_legal_penalties_common_criminal_penalties')}
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
                    color: item.class === 'Felony' ? ((colors as any).error ?? COLORS.emergency) : ((colors as any).warn ?? COLORS.warn),
                    backgroundColor: item.class === 'Felony' ? colors.emergencyBg : colors.warnBg,
                  }]}>
                    {item.class}
                  </Text>
                </View>
                <Text style={[styles.sentenceText, { color: (colors as any).subtext ?? COLORS.textMuted }]}>
                  {t('x_legal_penalties_prison_fine', { prison: item.prison, fine: item.fine })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles() {
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
    card:         { borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: COLORS.textPrimary, shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:3, elevation:1 },
    scheduleLabel:{ fontSize: 15, fontWeight: '700', marginBottom: 4 },
    examples:     { fontSize: 13, lineHeight: 18, marginBottom: 10 },
    penaltyRow:   { flexDirection: 'row', gap: 16 },
    penaltyItem:  { flex: 1, alignItems: 'center', backgroundColor: COLORS.emergencyBg, borderRadius: 8, padding: 10 },
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