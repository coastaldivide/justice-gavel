/**
 * DiversionScreen.tsx — Diversion program eligibility (merged)
 *
 * Replaces: DiversionScreen.tsx + MentalHealthDiversionScreen.tsx
 * Drug diversion, mental health diversion, and veteran court —
 * all the same question: "Can I avoid a criminal record?"
 *
 * Tabs: Drug/Alcohol | Mental Health | Veterans Court (route `tab`, or
 * "MentalHealthDiversion" opens the mental-health tab).
 *
 * The questions are a checklist to bring to a lawyer. The app has no recorded
 * diversion rules for any state, so it never says whether someone qualifies
 * (it used to count "yes" answers into "You may qualify").
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, LayoutAnimation } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useTheme } from '../constants/theme';
import { UnreviewedNotice } from '../components/LegalSource';
import { t, perLang, useLang } from '../i18n';

type TabKey = 'drug' | 'mental' | 'veteran';

const TABS = perLang((): { key: TabKey; label: string; emoji: string }[] => [
  { key: 'drug',    label: t('x_diversion_drug_alcohol'), emoji: '💊' },
  { key: 'mental',  label: t('x_diversion_mental_health'),  emoji: '🧠' },
  { key: 'veteran', label: t('x_diversion_veterans_court'),  emoji: '🎖' },
]);

// Drug diversion criteria (from DiversionScreen)
const DRUG_CRITERIA = perLang(() => [
  { question: t('x_diversion_this_first_second_drug'), key: 'firstOffense' },
  { question: t('x_diversion_was_charge_simple_possession'), key: 'possession' },
  { question: t('x_diversion_do_have_no_prior'), key: 'nonViolent' },
  { question: t('x_diversion_willing_complete_drug_treatment'), key: 'treatment' },
  { question: t('x_diversion_can_comply_with_regular'), key: 'testing' },
  { question: t('x_diversion_charge_non_violent_felony'), key: 'chargeType' },
]);

// Mental health diversion criteria (from MentalHealthDiversionScreen)
const MENTAL_CRITERIA = perLang(() => [
  { question: t('x_diversion_have_been_diagnosed_with'), key: 'diagnosis' },
  { question: t('x_diversion_there_significant_link_between'), key: 'nexus' },
  { question: t('x_diversion_charge_non_violent_low'), key: 'nonViolent' },
  { question: t('x_diversion_willing_participate_court_ordered'), key: 'treatment' },
  { question: t('x_diversion_do_have_stable_housing'), key: 'housing' },
  { question: t('x_diversion_this_first_second_offense'), key: 'priorRecord' },
]);

// Veteran court criteria
const VETERAN_CRITERIA = perLang(() => [
  { question: t('x_diversion_current_former_member_us'), key: 'veteran' },
  { question: t('x_diversion_do_have_service_connected'), key: 'serviceCondition' },
  { question: t('x_diversion_charge_non_violent_offense'), key: 'nonViolent' },
  { question: t('x_diversion_willing_participate_va_services'), key: 'vaServices' },
  { question: t('x_diversion_there_veterans_treatment_court'), key: 'localCourt' },
]);

const COURT_TYPE: Record<TabKey, string> = { drug: 'Drug Court', mental: 'Mental Health Court', veteran: 'Veterans' }; // i18n-exempt: data keys

function DiversionScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const routeTab = (route?.params as { tab?: TabKey } | undefined)?.tab;
  const startTab: TabKey = routeTab && ['drug', 'mental', 'veteran'].includes(routeTab) ? routeTab
    : route?.name === 'MentalHealthDiversion' ? 'mental' : 'drug';
  const [activeTab, setActiveTab] = useState<TabKey>(startTab);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});

  const switchTab = (key: TabKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(key);
    setAnswers({});
  };

  const criteria = activeTab === 'drug' ? DRUG_CRITERIA() :
                   activeTab === 'mental' ? MENTAL_CRITERIA() : VETERAN_CRITERIA();
  const yesCount = criteria.filter(c => answers[c.key]).length;
  const answered = Object.keys(answers).length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]} testID="diversion-screen">
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
        {TABS().map(tab => (
          <TouchableOpacity
            key={tab.key}
            testID={`diversion-tab-${tab.key}`}
            style={styles.tab}
            onPress={() => switchTab(tab.key)}
            aria-selected={activeTab === tab.key}
            accessibilityRole="tab"
          >
            <Text style={{ fontSize: 16, marginBottom: 2 }}>{tab.emoji}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.tabText, { color: activeTab === tab.key ? colors.textBrand : colors.textMuted }]}>
              {tab.label}
            </Text>
            {activeTab === tab.key && <View style={[styles.tabLine, { backgroundColor: colors.navy }]} />}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <UnreviewedNotice inset={false} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.intro, { color: colors.textSecond }]}>{t('div_intro')}</Text>

        {criteria.map((c, i) => (
          <View key={c.key} style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.question, { color: colors.textPrimary }]}>{i + 1}. {c.question}</Text>
              <Switch
                testID={`diversion-q-${c.key}`}
                accessibilityLabel={c.question}
                value={answers[c.key] ?? false}
                onValueChange={val => setAnswers(prev => ({ ...prev, [c.key]: val }))}
                trackColor={{ false: colors.border, true: colors.navy }}
              />
            </View>
          </View>
        ))}

        {answered && (
          <View style={[styles.resultCard, { backgroundColor: colors.bgSubtle, borderColor: colors.border }]} testID="diversion-summary">
            <Text maxFontSizeMultiplier={1.4} style={[styles.resultTitle, { color: colors.textPrimary }]}>
              {t('div_answered', { yes: yesCount, total: criteria.length })}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.resultSub, { color: colors.textSecond }]}>{t('div_no_rules')}</Text>
          </View>
        )}

        <View style={[styles.ctaCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.ctaText, { color: colors.textPrimary }]}>
            {t('x_diversion_diversion_eligibility_depends_specif')}
          </Text>
          <TouchableOpacity testID="diversion-courts" style={[styles.ctaBtn, styles.ctaOutline, { borderColor: colors.navy }]}
            onPress={() => navigation.navigate('SpecialtyCourts', { type: COURT_TYPE[activeTab] })} accessibilityRole="button">
            <Text maxFontSizeMultiplier={1.3} style={[styles.ctaBtnText, { color: colors.textBrand }]}>{t('div_find_courts')}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="diversion-lawyer" style={[styles.ctaBtn, { backgroundColor: colors.navy }]}
            onPress={() => navigation.navigate('LawyersTab')} accessibilityRole="button">
            <Text maxFontSizeMultiplier={1.3} style={[styles.ctaBtnText, { color: colors.textOnNavy }]}>{t('x_diversion_find_lawyer')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
    container:  { flex: 1 },
    tabBar:     { flexDirection: 'row', borderBottomWidth: 1 },
    tab:        { flex: 1, alignItems: 'center', minHeight: 56, justifyContent: 'center', paddingVertical: 8 },
    tabText:    { fontSize: 12, fontWeight: '700', textAlign: 'center' },
    tabLine:    { position: 'absolute', bottom: 0, left: 8, right: 8, height: 3, borderRadius: 1 },
    content:    { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 760, alignSelf: 'center' },
    intro:      { fontSize: 13, lineHeight: 19, marginVertical: 12 },
    card:       { borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    question:   { fontSize: 14, lineHeight: 20, flex: 1 },
    resultCard: { borderRadius: 12, padding: 16, marginVertical: 12, borderWidth: 1, gap: 6 },
    resultTitle:{ fontSize: 15, fontWeight: '700' },
    resultSub:  { fontSize: 13, lineHeight: 19 },
    ctaCard:    { borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, gap: 10 },
    ctaText:    { fontSize: 13, lineHeight: 19 },
    ctaBtn:     { borderRadius: 24, minHeight: 48, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
    ctaOutline: { borderWidth: 1.5 },
    ctaBtnText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
});

export default React.memo(DiversionScreen);