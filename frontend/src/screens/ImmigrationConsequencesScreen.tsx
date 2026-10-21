import { AIDisclaimer } from '../components/AIDisclaimer';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon } from '../components/AppIcon';
/**
 * ImmigrationConsequencesScreen -- Criminal Record & Immigration Consequences
 *
 * Two-tab layout:
 *   1. Consequences -- which offenses trigger what immigration consequences
 *   2. DACA / Visas -- specific impact by immigration status
 *
 * Covers the three primary consequences:
 *   - Deportation / removal
 *   - Inadmissibility (bars to re-entry or status adjustment)
 *   - DACA / visa / naturalization impacts
 *
 * Fully static. Works offline.
 * Note: immigration law is extremely complex -- strong attorney referral throughout.
 */
import React from 'react';

import { View, Text, StyleSheet, ScrollView, LayoutAnimation } from 'react-native';
import { useTheme, RADIUS, themeColors } from '../constants/theme';
import { InfoTabs } from '../components/InfoTabs';
import { UnreviewedNotice } from '../components/LegalSource';
import { t, perLang, useLang } from '../i18n';
import { ICONS } from '../components/AppIcon';


const CONSEQUENCE_GROUPS = perLang(() => {
  const c = themeColors();
  return [
  {
    severity: t('x_immigration_consequences_deportable_almost_always_triggers'),
    color:    c.emergency,
    bg:       c.emergencyBg,
    offenses: [
      { offense: t('x_immigration_consequences_aggravated_felony_ina_101'), detail: t('x_immigration_consequences_broadest_most_severe_category') },
      { offense: t('x_immigration_consequences_drug_conviction_any_controlled'), detail: t('x_immigration_consequences_any_drug_conviction_including') },
      { offense: t('x_immigration_consequences_domestic_violence_stalking_child'), detail: t('x_immigration_consequences_conviction_domestic_violence_stalkin') },
      { offense: t('x_immigration_consequences_firearm_offense'), detail: t('x_immigration_consequences_any_conviction_relating_purchase') },
      { offense: t('x_immigration_consequences_two_more_crimes_involving'), detail: t('x_immigration_consequences_crimes_involving_fraud_theft') },
    ],
  },
  {
    severity: t('x_immigration_consequences_inadmissibility_bars_re_entry'),
    color:    c.warn,
    bg:       c.warnBg,
    offenses: [
      { offense: t('x_immigration_consequences_single_crime_involving_moral'), detail: t('x_immigration_consequences_one_cimt_with_potential') },
      { offense: t('x_immigration_consequences_any_drug_offense_conviction'), detail: t('x_immigration_consequences_conviction_even_admission_drug') },
      { offense: t('x_immigration_consequences_prostitution_within_10_years'), detail: t('x_immigration_consequences_conviction_admission_engaging_prosti') },
      { offense: t('x_immigration_consequences_health_related_grounds'), detail: t('x_immigration_consequences_not_criminal_matter_but') },
    ],
  },
  {
    severity: t('x_immigration_consequences_less_severe_but_still'),
    color:    c.legal,
    bg:       c.legalBg,
    offenses: [
      { offense: t('x_immigration_consequences_simple_assault_misdemeanor'), detail: t('x_immigration_consequences_may_may_not_be') },
      { offense: 'DUI / DWI', detail: t('x_immigration_consequences_not_automatically_cimt_however') },
      { offense: t('x_immigration_consequences_shoplifting_petit_theft'), detail: t('x_immigration_consequences_shoplifting_with_conviction_may') },
      { offense: t('x_immigration_consequences_disorderly_conduct'), detail: t('x_immigration_consequences_generally_not_cimt_however') },
    ],
  },
];
});

const STATUS_SECTIONS = perLang(() => [
  {
    icon: ICONS.shield,
    title: t('x_immigration_consequences_daca_recipients'),
    body: t('x_immigration_consequences_daca_does_not_provide'),
    critical: true,
  },
  {
    icon: ICONS.statusOk,
    title: t('x_immigration_consequences_green_card_holders_lprs'),
    body: t('x_immigration_consequences_lawful_permanent_residents_can'),
    critical: false,
  },
  {
    icon: ICONS.clipboard,
    title: t('x_immigration_consequences_visa_holders_temporary_status'),
    body: t('x_immigration_consequences_any_criminal_conviction_can'),
    critical: false,
  },
  {
    icon: ICONS.starFilled,
    title: t('x_immigration_consequences_naturalization_applicants'),
    body: t('x_immigration_consequences_naturalize_applicant_must_demonstrat'),
    critical: false,
  },
  {
    icon: ICONS.lawyer,
    title: t('x_immigration_consequences_padilla_warnings_what_criminal'),
    body: t('x_immigration_consequences_under_padilla_v_kentucky'),
    critical: false,
  },
  {
    icon: ICONS.puzzle,
    title: t('x_immigration_consequences_vacating_convictions_immigration_pur'),
    body: t('x_immigration_consequences_if_were_convicted_without'),
    critical: false,
  },
  {
    icon: ICONS.phone,
    title: t('resources'),
    body: t('x_immigration_consequences_national_immigration_project_nipnlg'),
    critical: false,
  },
]);

function ImmigrationConsequencesScreen(): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState<'consequences' | 'status'>('consequences');

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="immigration-consequences-screen"
      contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 12, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <AppIcon name="globe-outline" size={20} color={themeColors().textBrand} />
        <Text style={[styles.headerTitle, { color: colors.textOnNavy }]} maxFontSizeMultiplier={1.4}>{t('x_immigration_consequences_immigration_charges')}</Text>
        <Text style={[styles.headerSub, { color: colors.steel }]} maxFontSizeMultiplier={1.4}>{t('x_immigration_consequences_consequences_convictions')}</Text>
      </View>

      <UnreviewedNotice inset={false} text={t('imm_not_reviewed')} />
      <InfoTabs
        testID="immigration-tabs"
        tabs={[{ key: 'consequences', label: t('x_immigration_consequences_criminal_consequences') }, { key: 'status', label: t('x_immigration_consequences_by_immigration_status') }]}
        active={tab}
        onChange={k => setTab(k as 'consequences' | 'status')}
      />

      {tab === 'consequences' && CONSEQUENCE_GROUPS().map(group => (
        <View key={group.severity} style={{ marginBottom: 10 }}>
          <View style={[styles.groupHeader, { backgroundColor: group.bg, borderLeftColor: group.color }]}>
            <Text style={[styles.groupTitle, { color: group.color }]} maxFontSizeMultiplier={1.4}>{group.severity}</Text>
          </View>
          {group.offenses.map(o => (
            <View key={o.offense} style={[styles.offenseCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              <Text style={[styles.offenseTitle, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{o.offense}</Text>
              <Text style={[styles.offenseDetail, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{o.detail}</Text>
            </View>
          ))}
        </View>
      ))}

      {tab === 'status' && STATUS_SECTIONS().map(sec => (
        <View key={sec.title} style={[styles.statusCard, { backgroundColor: colors.bgCard,
          borderColor: sec.critical ? colors.emergency : colors.border }]}>
          <View style={styles.statusHeader}>
            <AppIcon name={sec.icon} size={22} color={colors.textBrand} style={styles.statusIcon} />
            <Text style={[styles.statusTitle, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{sec.title}</Text>
          </View>
          <Text style={[styles.statusBody, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{sec.body}</Text>
        </View>
      ))}

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { borderTopColor: colors.border }]}>
        <Text style={[styles.disclaimerText, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>
          {t('x_family_court_this_information_general_education')}
        </Text>
      </View>
      <AIDisclaimer variant="banner" />

    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:        { flex: 1 },
  scroll:        { padding: 16 },
  header:        { borderRadius: RADIUS.lg, padding: 20, marginTop: 12, alignItems: 'center' },
  headerIcon:    { fontSize: 36, marginBottom: 8 },
  headerTitle:   { color: colors.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:     { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  alertBox:      { borderRadius: RADIUS.md, borderWidth: 1.5, padding: 12, marginBottom: 14 },
  alertTitle:    { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 6 },
  alertBody:     { fontSize: 12, lineHeight: 19 },
  tabs:          { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  tabBtn:        { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:      { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  groupHeader:   { borderRadius: RADIUS.sm, borderLeftWidth: 4, padding: 10, marginBottom: 6 },
  groupTitle:    { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  offenseCard:   { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 6 },
  offenseTitle:  { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 5 },
  offenseDetail: { fontSize: 12, lineHeight: 18 },
  statusCard:    { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  statusHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusIcon:    { fontSize: 22 },
  statusTitle:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  statusBody:    { fontSize: 12, lineHeight: 20 },
  cta:           { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 6, marginBottom: 10 },
  ctaText:       { color: colors.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  disclaimer:    { borderTopWidth: 1, paddingTop: 12 },
  disclaimerText:{ fontSize: 11, lineHeight: 17, textAlign: 'center' },
  card: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textSecond },
});
export default React.memo(ImmigrationConsequencesScreen);