import { AppIcon } from '../components/AppIcon';
/**
 * JuvenileJusticeScreen -- Juvenile Justice Rights & Navigation
 *
 * Covers the full juvenile justice arc:
 *   1. Rights card -- what a juvenile and their parents need to know
 *   2. What happens next -- detention hearing → adjudication → disposition → sealing
 *   3. Juvenile record sealing -- dramatically more favorable than adult expungement
 *
 * Key legal distinctions built in:
 *   - Parental notification rights
 *   - No public record (in most states)
 *   - Different terminology (adjudicated delinquent, not convicted)
 *   - Miranda applies but with extra protections for juveniles
 *   - Automatic sealing timelines by state
 */
import React from 'react';
import type {} from '../types/navigation';
import { View, Text, StyleSheet, ScrollView, LayoutAnimation } from 'react-native';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';
import { InfoTabs } from '../components/InfoTabs';
import { t, perLang, useLang } from '../i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

type ProcessStep = {
  title: string;
  timeline: string;
  what: string;
  rights: string;
  tip: string;
};

// ── Juvenile process steps ────────────────────────────────────────────────────
const PROCESS_STEPS = perLang((): ProcessStep[] => [
  {
    title:    t('x_juvenile_justice_arrest_contact'),
    timeline: t('x_juvenile_justice_immediate'),
    what:     t('x_juvenile_justice_juvenile_can_be_taken'),
    rights:   t('x_juvenile_justice_miranda_warnings_apply_juveniles'),
    tip:      t('x_juvenile_justice_most_important_thing_juvenile'),
  },
  {
    title:    t('x_juvenile_justice_intake_decision'),
    timeline: t('x_juvenile_justice_within_24_72_hours'),
    what:     t('x_juvenile_justice_probation_officer_intake_officer'),
    rights:   t('x_juvenile_justice_parents_have_right_be'),
    tip:      t('x_juvenile_justice_cooperating_with_intake_does'),
  },
  {
    title:    t('x_juvenile_justice_detention_hearing'),
    timeline: t('x_juvenile_justice_within_24_72_hours_2'),
    what:     t('x_juvenile_justice_if_juvenile_held_detention'),
    rights:   t('x_juvenile_justice_right_attorney_applies_at'),
    tip:      t('x_juvenile_justice_detention_hearing_first_opportunity'),
  },
  {
    title:    t('x_juvenile_justice_petition_arraignment'),
    timeline: t('x_juvenile_justice_days_weeks_after_arrest'),
    what:     t('x_juvenile_justice_prosecutor_some_states_probation'),
    rights:   t('x_juvenile_justice_juvenile_has_right_deny'),
    tip:      t('x_juvenile_justice_language_different_juvenile_not'),
  },
  {
    title:    t('x_juvenile_justice_adjudicatory_hearing'),
    timeline: t('x_juvenile_justice_weeks_months_after_petition'),
    what:     t('x_juvenile_justice_this_juvenile_equivalent_trial'),
    rights:   t('x_juvenile_justice_full_due_process_rights'),
    tip:      t('x_juvenile_justice_hearings_typically_closed_public'),
  },
  {
    title:    t('x_juvenile_justice_disposition_hearing'),
    timeline: t('x_juvenile_justice_follows_adjudication'),
    what:     t('x_juvenile_justice_if_adjudicated_delinquent_judge'),
    rights:   t('x_juvenile_justice_right_present_mitigating_evidence'),
    tip:      t('x_juvenile_justice_disposition_where_attorney_s'),
  },
  {
    title:    t('juv_tab_sealing'),
    timeline: t('x_juvenile_justice_at_completion_age_18'),
    what:     t('x_juvenile_justice_juvenile_records_confidential_most'),
    rights:   t('x_juvenile_justice_sealed_records_cannot_be'),
    tip:      t('x_juvenile_justice_see_sealing_tab_state'),
  },
]);

// ── Rights sections ───────────────────────────────────────────────────────────
const RIGHTS_SECTIONS = perLang(() => [
  {
    heading: t('x_juvenile_justice_have_right_remain_silent'),
    body:    t('x_juvenile_justice_miranda_warnings_apply_juveniles_2'),
    icon:    '🤫',
  },
  {
    heading: t('x_juvenile_justice_parent_must_be_notified'),
    body:    t('x_juvenile_justice_police_must_notify_parent'),
    icon:    '👨‍👩‍👧',
  },
  {
    heading: t('x_juvenile_justice_have_right_attorney'),
    body:    t('x_juvenile_justice_re_gault_1967_supreme'),
    icon:    '⚖️',
  },
  {
    heading: t('x_juvenile_justice_records_confidential'),
    body:    t('x_juvenile_justice_juvenile_court_records_not'),
    icon:    '🔒',
  },
  {
    heading: t('x_juvenile_justice_not_convicted'),
    body:    t('x_juvenile_justice_terminology_different_it_matters'),
    icon:    '📋',
  },
  {
    heading: t('x_juvenile_justice_can_still_be_tried'),
    body:    t('x_juvenile_justice_serious_offenses_prosecutors_can'),
    icon:    '⚠️',
  },
  {
    heading: t('x_juvenile_justice_rehabilitation_goal'),
    body:    t('x_juvenile_justice_juvenile_justice_system_designed'),
    icon:    '🌱',
  },
  {
    heading: t('x_juvenile_justice_future_priority'),
    body:    t('x_juvenile_justice_juvenile_adjudication_does_not'),
    icon:    '🏆',
  },
]);

// ── Sealing data ──────────────────────────────────────────────────────────────
type SealingEntry = { state: string; automatic: boolean; when: string; notes: string };
const SEALING_DATA = perLang((): SealingEntry[] => [
  { state:'AL', automatic:false, when:t('x_juvenile_justice_age_18_petition_required'),    notes:t('x_juvenile_justice_misdemeanor_adjudications_only_felon') },
  { state:'AK', automatic:false, when:t('x_juvenile_justice_age_18_2_years'), notes:t('x_juvenile_justice_petition_court_all_charges') },
  { state:'AZ', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_superior_court_petition_fee') },
  { state:'AR', automatic:false, when:t('x_juvenile_justice_age_21_5_years'), notes:t('x_juvenile_justice_petition_required_violent_offenses') },
  { state:'CA', automatic:true,  when:t('x_juvenile_justice_age_18_most_offenses'),        notes:t('x_juvenile_justice_automatic_sealing_under_ab') },
  { state:'CO', automatic:true,  when:t('x_juvenile_justice_age_18_upon_completion'),     notes:t('x_juvenile_justice_broad_automatic_sealing_petition') },
  { state:'CT', automatic:true,  when:t('x_juvenile_justice_age_18'),                        notes:t('x_juvenile_justice_records_erased_automatically_most') },
  { state:'DE', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_must_be_offense_free') },
  { state:'FL', automatic:false, when:t('x_juvenile_justice_age_21_petition'),             notes:t('x_juvenile_justice_petition_required_certain_serious') },
  { state:'GA', automatic:false, when:t('x_juvenile_justice_age_21_4_years'), notes:t('x_juvenile_justice_petition_juvenile_court_fee') },
  { state:'HI', automatic:true,  when:t('x_juvenile_justice_age_18'),                        notes:t('x_juvenile_justice_records_sealed_automatically_most') },
  { state:'ID', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_petition_juvenile_court_some') },
  { state:'IL', automatic:true,  when:t('x_juvenile_justice_age_18_minor_offenses'),       notes:t('x_juvenile_justice_automatic_expungement_minor_offenses') },
  { state:'IN', automatic:false, when:t('x_juvenile_justice_age_18_1_year'),    notes:t('x_juvenile_justice_petition_required_restricted_access') },
  { state:'IA', automatic:false, when:t('x_juvenile_justice_age_18'),                        notes:t('x_juvenile_justice_records_confidential_but_not') },
  { state:'KS', automatic:false, when:t('x_juvenile_justice_age_18_2_years_2'), notes:t('x_juvenile_justice_petition_district_court') },
  { state:'KY', automatic:false, when:t('x_juvenile_justice_age_18_2_years'), notes:t('x_juvenile_justice_petition_required_felony_equivalent') },
  { state:'LA', automatic:false, when:t('x_juvenile_justice_age_17_la_adulthood'), notes:t('x_juvenile_justice_louisiana_raised_adult_age') },
  { state:'ME', automatic:false, when:t('x_juvenile_justice_age_18_3_years'),              notes:t('x_juvenile_justice_petition_district_court_class') },
  { state:'MD', automatic:true,  when:t('x_juvenile_justice_age_18_most_offenses'),        notes:t('x_juvenile_justice_broad_automatic_expungement_petition') },
  { state:'MA', automatic:true,  when:t('x_juvenile_justice_age_18_most_offenses'),        notes:t('x_juvenile_justice_records_sealed_automatically_some') },
  { state:'MI', automatic:false, when:t('x_juvenile_justice_age_17_petition'),             notes:t('x_juvenile_justice_petition_family_court_good') },
  { state:'MN', automatic:true,  when:t('x_juvenile_justice_upon_completion_sentence'),   notes:t('x_juvenile_justice_one_most_favorable_states') },
  { state:'MS', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_petition_youth_court_limited') },
  { state:'MO', automatic:false, when:t('x_juvenile_justice_age_17_petition_at'), notes:t('x_juvenile_justice_records_confidential_petition_expung') },
  { state:'MT', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_youth_court_petition_felony') },
  { state:'NE', automatic:false, when:t('x_juvenile_justice_age_17_3_years'), notes:t('x_juvenile_justice_petition_separate_juvenile_court') },
  { state:'NV', automatic:true,  when:t('x_juvenile_justice_age_21_3_years'), notes:t('x_juvenile_justice_automatic_sealing_if_no') },
  { state:'NH', automatic:false, when:t('x_juvenile_justice_age_17_petition'),             notes:t('x_juvenile_justice_petition_district_court_annual') },
  { state:'NJ', automatic:true,  when:t('x_juvenile_justice_age_19_5_years'), notes:t('x_juvenile_justice_automatic_expungement_most_adjudicat') },
  { state:'NM', automatic:false, when:t('x_juvenile_justice_age_18_1_year_2'),  notes:t('x_juvenile_justice_children_s_court_petition') },
  { state:'NY', automatic:true,  when:t('x_juvenile_justice_age_18_eligible_youth'),       notes:t('x_juvenile_justice_youthful_offender_yo_designation') },
  { state:'NC', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_district_court_petition_nonviolent') },
  { state:'ND', automatic:false, when:t('x_juvenile_justice_age_18_2_years_3'), notes:t('x_juvenile_justice_petition_juvenile_court') },
  { state:'OH', automatic:false, when:t('x_juvenile_justice_age_18_2_years'), notes:t('x_juvenile_justice_juvenile_court_petition_sealing') },
  { state:'OK', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_juvenile_court_petition_first') },
  { state:'OR', automatic:true,  when:t('x_juvenile_justice_age_18_most_offenses'),        notes:t('x_juvenile_justice_broad_automatic_expungement_measure') },
  { state:'PA', automatic:false, when:t('x_juvenile_justice_age_18_petition_age'),   notes:t('x_juvenile_justice_petition_juvenile_court_act') },
  { state:'RI', automatic:true,  when:t('x_juvenile_justice_age_18_most_offenses'),        notes:t('x_juvenile_justice_automatic_expungement_petition_serio') },
  { state:'SC', automatic:false, when:t('x_juvenile_justice_age_18_5_years'), notes:t('x_juvenile_justice_family_court_petition_limited') },
  { state:'SD', automatic:false, when:t('x_juvenile_justice_age_18_1_year_2'),  notes:t('x_juvenile_justice_circuit_court_petition') },
  { state:'TN', automatic:false, when:t('x_juvenile_justice_age_17_petition_after'), notes:t('x_juvenile_justice_juvenile_court_petition_t') },
  { state:'TX', automatic:false, when:t('x_juvenile_justice_age_17_petition_at_2'),      notes:t('x_juvenile_justice_petition_juvenile_court_fam') },
  { state:'UT', automatic:true,  when:t('x_juvenile_justice_age_18_5_years_2'), notes:t('x_juvenile_justice_automatic_expungement_most_petition') },
  { state:'VT', automatic:true,  when:t('x_juvenile_justice_age_18_most_offenses'),        notes:t('x_juvenile_justice_records_expunged_automatically_stron') },
  { state:'VA', automatic:false, when:t('x_juvenile_justice_age_19_5_years_2'), notes:t('x_juvenile_justice_circuit_court_petition_16') },
  { state:'WA', automatic:true,  when:t('x_juvenile_justice_upon_completion_most_offenses'), notes:t('x_juvenile_justice_some_broadest_automatic_sealing') },
  { state:'WV', automatic:false, when:t('x_juvenile_justice_age_18_petition'),             notes:t('x_juvenile_justice_circuit_court_petition_first') },
  { state:'WI', automatic:false, when:t('x_juvenile_justice_age_17_petition'),             notes:t('x_juvenile_justice_circuit_court_petition_expunged') },
  { state:'WY', automatic:false, when:t('x_juvenile_justice_age_19_2_years'), notes:t('x_juvenile_justice_district_court_petition') },
  { state:'DC', automatic:true,  when:t('x_juvenile_justice_age_21_2_years'), notes:t('x_juvenile_justice_broad_automatic_sealing_petition_2') },
]);

// ── Component ─────────────────────────────────────────────────────────────────
// Loading state
function JuvenileJusticeScreen(): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
      return () => { mountedRef.current = false; };
  }, []);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = React.useState<'rights' | 'process' | 'sealing'>('rights');

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="juvenile-justice-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
{/* Heightened disclaimer for content involving minors */}
<View style={{ backgroundColor: colors.legalBg, borderLeftWidth: 3, borderLeftColor: colors.legal, padding: 12, margin: 12, borderRadius: 6 }}>
  <Text style={{ fontSize: 11, color: colors.legal, fontWeight: '700', marginBottom: 3 }} maxFontSizeMultiplier={1.4}>{t('x_juvenile_justice_content_involving_minors')}</Text>
  <Text style={{ fontSize: 11, color: colors.legal, lineHeight: 16 }} maxFontSizeMultiplier={1.4}>
    {t('x_juvenile_justice_this_information_general_education')}
  </Text>
</View>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerTitle, { color: colors.textOnNavy }]}>{t('juv_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerSub, { color: colors.steel }]}>{t('x_juvenile_justice_rights_juvenile_system')}</Text>
      </View>

      <View style={{ paddingHorizontal: 12 }}>
      <InfoTabs
        testID="juvenile-tabs"
        tabs={[{ key: 'rights', label: t('x_juvenile_justice_rights') }, { key: 'process', label: t('x_juvenile_justice_process') }, { key: 'sealing', label: t('juv_tab_sealing') }]}
        active={tab}
        onChange={k => setTab(k as 'rights' | 'process' | 'sealing')}
      />

      {tab === 'rights' && RIGHTS_SECTIONS().map(sec => (
        <View key={sec.heading} style={[styles.rightCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={styles.rightCardHeader}>
            <Text maxFontSizeMultiplier={1.4} style={styles.rightCardIcon}>{sec.icon}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.rightCardTitle, { color: colors.textPrimary }]}>{sec.heading}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={[styles.rightCardBody, { color: colors.textMuted }]}>{sec.body}</Text>
        </View>
      ))}

      {tab === 'process' && PROCESS_STEPS().map((step, i) => (
        <View key={step.title} style={[styles.stepCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={styles.stepCardHeader}>
            <View style={[styles.stepNumBadge, { backgroundColor: colors.navy }]}>
              <Text maxFontSizeMultiplier={1.2} style={styles.stepNumBadgeText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.stepCardTitle, { color: colors.textPrimary }]}>{step.title}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.stepTimeline, { color: colors.textMuted }]}>{step.timeline}</Text>
            </View>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepSectionLabel, { color: colors.textMuted }]}>{t('x_juvenile_justice_what_happens')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepBody, { color: colors.textSecond }]}>{step.what}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepSectionLabel, { color: colors.textMuted }]}>{t('tr_your_rights')}</Text>
          <View style={[styles.rightsBlock, { borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepBody, { color: colors.textSecond }]}>{step.rights}</Text>
          </View>
          <View style={[styles.tipBlock, { borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.tipLabel}>{t('x_juvenile_justice_tip')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.stepBody, { color: colors.textSecond }]}>{step.tip}</Text>
          </View>
        </View>
      ))}

      {tab === 'sealing' && SEALING_DATA().map(row => (
        <View key={row.state} style={[styles.sealingRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={[styles.stateBadge, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.stateBadgeText, { color: colors.textBrand }]}>{row.state}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.sealingRowTop}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.sealingWhen, { color: colors.textPrimary }]}>{row.when}</Text>
              <View style={[styles.autoChip, { backgroundColor: row.automatic ? colors.legalBg : colors.bgSubtle }]}>
                <Text maxFontSizeMultiplier={1.2} style={[styles.autoChipText, { color: row.automatic ? colors.legalDark : colors.textMuted }]}>
                  {row.automatic ? t('x_juvenile_justice_automatic') : t('x_juvenile_justice_petition')}
                </Text>
              </View>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[styles.sealingNotes, { color: colors.textMuted }]}>{row.notes}</Text>
          </View>
        </View>
      ))}
      </View>

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
  screen:           { flex: 1 },
  scroll:           { padding: 16 },
  header:           { borderRadius: RADIUS.lg, padding: 20, marginBottom: 14, alignItems: 'center' },
  headerIcon:       { fontSize: 36, marginBottom: 8 },
  headerTitle:      { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:        { color: colors.steel, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  tabs:             { flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  tabBtn:           { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel:         { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  infoBox:          { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 14 },
  infoBoxText:      { color: colors.steel, fontSize: 12, lineHeight: 19 },
  rightCard:        { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  rightCardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rightCardIcon:    { fontSize: 22 },
  rightCardTitle:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', flex: 1 },
  rightCardBody:    { fontSize: 12, lineHeight: 20 },
  ctaBtn:           { borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: 10, marginBottom: 6 },
  ctaBtnText:       { color: COLORS.bg, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  stepScroll:       { marginBottom: 12 },
  stepScrollContent:{ gap: 8, paddingBottom: 4 },
  stepPill:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, gap: 6 },
  stepPillNum:      { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', width: 16, textAlign: 'center' },
  stepPillLabel:    { fontSize: 12, fontWeight: '700', maxWidth: 90 },
  stepCard:         { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 12 },
  stepCardHeader:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  stepNumBadge:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepNumBadgeText: { color: COLORS.bg, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900' },
  stepCardTitle:    { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 2 },
  stepTimeline:     { fontSize: 12 },
  stepSectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
  stepBody:         { fontSize: 12, lineHeight: 20 },
  rightsBlock:      { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginBottom: 4 },
  tipBlock:         { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginTop: 8 },
  tipLabel:         { color: colors.legal, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 6 },
  stepNav:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  stepNavBtn:       { padding: 8 },
  stepNavLabel:     { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  stepNavCount:     { fontSize: 12 },
  filterRow:        { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterChip:       { paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1 },
  filterChipText:   { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  sealingRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 8 },
  stateBadge:       { width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  stateBadgeText:   { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_900Black', fontWeight: '900' },
  sealingRowTop:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  autoChip:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  autoChipText:     { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  sealingWhen:      { fontSize: 12, fontWeight: '600', flex: 1 },
  sealingNotes:     { fontSize: 12, lineHeight: 17 },
  disclaimer:       { borderTopWidth: 1, paddingTop: 12, marginTop: 8, marginBottom: 8 },
  disclaimerText:   { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  card: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textSecond },
});
export default React.memo(JuvenileJusticeScreen);