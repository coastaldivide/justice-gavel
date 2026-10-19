import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon } from '../components/AppIcon';
/**
 * HousingRightsScreen -- Housing Rights & Criminal Record
 *
 * Two-tab layout:
 *   1. Eviction Defense -- expanded from TenantRightsScreen (no overlap)
 *   2. Criminal Record & Housing -- the specific barrier this population faces
 *
 * Covers:
 *   - Fair Chance Housing laws (ban-the-box for housing)
 *   - HUD guidance on criminal record screening
 *   - Public housing and Section 8 with a record
 *   - How to challenge a denial based on criminal history
 *
 * Fully static. Works offline.
 */
import React from 'react';

import { View, Text, StyleSheet, ScrollView, LayoutAnimation } from 'react-native';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';
import { InfoTabs } from '../components/InfoTabs';
import { t, perLang, useLang } from '../i18n';


const RECORD_SECTIONS = perLang(() => [
  {
    icon: '⚖️',
    title: t('x_housing_rights_hud_fair_housing_act'),
    body: t('x_housing_rights_department_housing_urban_development'),
  },
  {
    icon: '🏠',
    title: t('x_housing_rights_what_landlords_can_cannot'),
    body: t('x_housing_rights_landlords_can_consider_criminal'),
  },
  {
    icon: '📋',
    title: t('x_housing_rights_fair_chance_housing_state'),
    body: t('x_housing_rights_growing_number_cities_states'),
  },
  {
    icon: '🏘️',
    title: t('x_housing_rights_public_housing_section_8'),
    body: t('x_housing_rights_public_housing_authorities_phas'),
  },
  {
    icon: '🛑',
    title: t('x_housing_rights_challenging_denial'),
    body: t('x_housing_rights_if_denied_housing_based'),
  },
  {
    icon: '📝',
    title: t('x_housing_rights_expungement_housing'),
    body: t('x_housing_rights_sealed_expunged_record_generally'),
  },
  {
    icon: '📞',
    title: t('resources'),
    body: t('x_housing_rights_national_fair_housing_alliance'),
  },
]);

const EVICTION_SECTIONS = perLang(() => [
  {
    icon: '📋',
    title: t('x_housing_rights_types_eviction_notices'),
    body: t('x_housing_rights_pay_quit_have_x'),
  },
  {
    icon: '⏰',
    title: t('x_housing_rights_timeline_act_immediately'),
    body: t('x_housing_rights_moment_receive_eviction_notice'),
  },
  {
    icon: '⚖️',
    title: t('x_housing_rights_rights_eviction_proceeding'),
    body: t('x_housing_rights_have_right_appear_court'),
  },
  {
    icon: '🔑',
    title: t('x_housing_rights_self_help_eviction_illegal'),
    body: t('x_housing_rights_landlord_cannot_lock_out'),
  },
  {
    icon: '💰',
    title: t('x_housing_rights_emergency_rental_assistance'),
    body: t('x_housing_rights_emergency_rental_assistance_era'),
  },
  {
    icon: '🏘️',
    title: t('x_housing_rights_after_eviction'),
    body: t('x_housing_rights_eviction_judgment_appears_rental'),
  },
]);

function HousingRightsScreen(): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState<'record' | 'eviction'>('record');
  const sections = tab === 'record' ? RECORD_SECTIONS() : EVICTION_SECTIONS();

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="housing-rights-screen"
      contentContainerStyle={{ paddingBottom: 32, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <AppIcon name="home-outline" size={20} color={COLORS.navy} />
        <Text style={[styles.headerTitle, { color: colors.textOnNavy }]} maxFontSizeMultiplier={1.4}>{t('civil_housing_title')}</Text>
        <Text style={[styles.headerSub, { color: colors.steel }]} maxFontSizeMultiplier={1.4}>{t('x_housing_rights_tenant_rights_evictions')}</Text>
      </View>

      <InfoTabs
        testID="housing-rights-tabs"
        tabs={[{ key: 'record', label: t('x_housing_rights_criminal_record_housing') }, { key: 'eviction', label: t('x_housing_rights_eviction_defense') }]}
        active={tab}
        onChange={k => setTab(k as 'record' | 'eviction')}
      />

      {/* Section cards */}
      {sections.map(sec => (
        <View key={sec.title} style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardIcon} maxFontSizeMultiplier={1.4}>{sec.icon}</Text>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{sec.title}</Text>
          </View>
          <Text style={[styles.cardBody, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{sec.body}</Text>
        </View>
      ))}

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { borderTopColor: colors.border }]}>
        <Text style={[styles.disclaimerText, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>
          {t('x_family_court_this_information_general_education')}
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:          { flex: 1 },
  scroll:          { padding: 16 },
  header:          { borderRadius: RADIUS.lg, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon:      { fontSize: 36, marginBottom: 8 },
  headerTitle:     { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:       { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  tabs:            { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  tabBtn:          { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:        { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', textAlign: 'center' },
  offlineNote:     { borderRadius: RADIUS.sm, borderWidth: 1, padding: 9, marginBottom: 12 },
  offlineNoteText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  card:            { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardIcon:        { fontSize: 22 },
  cardTitle:       { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  cardBody:        { fontSize: 12, lineHeight: 20 },
  cta:             { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 6, marginBottom: 10 },
  ctaText:         { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  disclaimer:      { borderTopWidth: 1, paddingTop: 12 },
  disclaimerText:  { fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
export default React.memo(HousingRightsScreen);