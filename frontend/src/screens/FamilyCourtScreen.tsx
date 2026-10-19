import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon } from '../components/AppIcon';
/**
 * FamilyCourtScreen -- Family Court Navigation Guide
 *
 * Three-tab layout matching existing civil screens:
 *   1. Custody & Visitation -- types, how courts decide, what to do
 *   2. Protective Orders    -- emergency vs permanent, how to get one
 *   3. Child Support        -- how it's calculated, modification, enforcement
 *
 * Fully static. Works offline. No API calls.
 * Criminal record implications noted throughout -- the intersection
 * this population actually faces.
 */
import React from 'react';

import { View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutAnimation } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';
import { InfoTabs } from '../components/InfoTabs';
import { t, perLang, useLang } from '../i18n';


const CUSTODY_SECTIONS = perLang(() => [
  {
    icon: '⚖️',
    title: t('x_family_court_types_custody'),
    body: t('x_family_court_legal_custody_right_make'),
  },
  {
    icon: '🧒',
    title: t('x_family_court_how_courts_decide'),
    body: t('x_family_court_every_state_uses_best'),
  },
  {
    icon: '🔒',
    title: t('x_family_court_criminal_record_custody'),
    body: t('x_family_court_criminal_record_does_not'),
  },
  {
    icon: '📋',
    title: t('x_family_court_emergency_custody'),
    body: t('x_family_court_if_child_immediate_danger'),
  },
  {
    icon: '✏️',
    title: t('x_family_court_modifying_custody_order'),
    body: t('x_family_court_once_custody_order_place'),
  },
  {
    icon: '🏛️',
    title: t('x_family_court_representing_yourself'),
    body: t('x_family_court_have_right_represent_yourself'),
  },
  {
    icon: '📞',
    title: t('x_family_court_if_cannot_afford_attorney'),
    body: t('x_family_court_legal_aid_organizations_provide'),
  },
]);

const ORDERS_SECTIONS = perLang(() => [
  {
    icon: '🚨',
    title: t('x_family_court_emergency_protective_order_epo'),
    body: t('x_family_court_issued_by_police_scene'),
  },
  {
    icon: '📋',
    title: t('x_family_court_temporary_restraining_order_tro'),
    body: t('x_family_court_filed_at_courthouse_usually'),
  },
  {
    icon: '⚖️',
    title: t('x_family_court_permanent_protective_order'),
    body: t('x_family_court_issued_after_full_court'),
  },
  {
    icon: '📝',
    title: t('x_family_court_how_file'),
    body: t('x_family_court_go_family_court_civil'),
  },
  {
    icon: '🔒',
    title: t('x_family_court_what_protective_order_covers'),
    body: t('x_family_court_protective_order_can_protect'),
  },
  {
    icon: '⚠️',
    title: t('x_family_court_if_have_criminal_record'),
    body: t('x_family_court_criminal_history_does_not'),
  },
  {
    icon: '🌐',
    title: t('x_family_court_national_resources'),
    body: t('x_family_court_national_domestic_violence_hotline'),
  },
]);

const SUPPORT_SECTIONS = perLang(() => [
  {
    icon: '🧮',
    title: t('x_family_court_how_child_support_calculated'),
    body: t('x_family_court_every_state_uses_formula'),
  },
  {
    icon: '💼',
    title: t('x_family_court_income_unemployment'),
    body: t('x_family_court_if_unemployed_underemployed_courts'),
  },
  {
    icon: '🔒',
    title: t('x_family_court_child_support_criminal_record'),
    body: t('x_family_court_if_incarcerated_still_legally'),
  },
  {
    icon: '📝',
    title: t('x_family_court_modifying_support_order'),
    body: t('x_family_court_child_support_can_be'),
  },
  {
    icon: '⚠️',
    title: t('x_family_court_non_payment_consequences'),
    body: t('x_family_court_unpaid_child_support_treated'),
  },
  {
    icon: '📞',
    title: t('x_family_court_getting_help'),
    body: t('x_family_court_every_state_has_child'),
  },
]);

function FamilyCourtScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState<'custody' | 'orders' | 'support'>('custody');
  const allSections = tab === 'custody' ? CUSTODY_SECTIONS() : tab === 'orders' ? ORDERS_SECTIONS() : SUPPORT_SECTIONS();

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="family-court-screen"
      contentContainerStyle={{ paddingBottom: 32, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerTitle, { color: colors.textOnNavy }]}>{t('civil_family_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerSub, { color: colors.steel }]}>{t('x_family_court_custody_support_orders')}</Text>
      </View>

      <View style={{ paddingHorizontal: 12 }}>
        <InfoTabs
          testID="family-court-tabs"
          tabs={[{ key: 'custody', label: t('x_family_court_custody') }, { key: 'orders', label: t('x_court_forms_protective_orders') }, { key: 'support', label: t('x_family_court_child_support') }]}
          active={tab}
          onChange={k => setTab(k as 'custody' | 'orders' | 'support')}
        />
      </View>

      {/* Child-support estimator CTA (support tab only) */}
      {tab === 'support' && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('x_family_court_open_child_support_estimator')}
          style={[styles.cta, { backgroundColor: colors.navy, marginHorizontal: 12 }]}
          onPress={() => navigation.navigate('ChildSupport')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.ctaText, { color: colors.textOnNavy }]}>
            {t('x_family_court_estimate_child_support')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Section cards */}
      {allSections?.length === 0 ? (

        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>📭</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
            {t('empty_state_nothing')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32 }}>
            {t('x_attorney_privacy_results_will_appear_here')}
          </Text>
        </View>
        ) : allSections.map((sec: any, idx: number) => (
        <View key={`allSecti-${idx}`} style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {sec.title ? <Text maxFontSizeMultiplier={1.4} style={[styles.cardTitle, { color: colors.textPrimary }]}>{sec.title}</Text> : null}
          {sec.body  ? <Text maxFontSizeMultiplier={1.4} style={[styles.cardBody,  { color: colors.textMuted  }]}>{sec.body}</Text>  : null}
          {sec.steps ? sec.steps.map((step: string, si: number) => (
            <Text maxFontSizeMultiplier={1.4} key={si} style={[styles.cardBody, { color: colors.textMuted }]}>• {step}</Text>
          )) : null}
        </View>
      ))}

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { borderTopColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimerText, { color: colors.textMuted }]}>
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
  tabBtn:          { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tabLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  offlineNote:     { borderRadius: RADIUS.sm, borderWidth: 1, padding: 9, marginBottom: 12 },
  offlineNoteText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  card:            { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardIcon:        { fontSize: 22 },
  cardTitle:       { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  cardBody:        { fontSize: 12, lineHeight: 20 },
  cta:             { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 6, marginBottom: 10 },
  ctaText:         { color: COLORS.bg, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  disclaimer:      { borderTopWidth: 1, paddingTop: 12 },
  disclaimerText:  { fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
export default React.memo(FamilyCourtScreen);