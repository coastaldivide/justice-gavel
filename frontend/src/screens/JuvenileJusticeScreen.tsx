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
import type { ScreenProps } from '../types/navigation';
import { getUserState } from '../utils/userState';
import { StatePicker } from '../components/StatePicker';
import { SourceLine, UnreviewedNotice } from '../components/LegalSource';
import { View, Text, StyleSheet, ScrollView, LayoutAnimation, ActivityIndicator } from 'react-native';
import { useTheme, RADIUS, themeColors } from '../constants/theme';
import { InfoTabs } from '../components/InfoTabs';
import { t, perLang, useLang, getLang } from '../i18n';
import api from '../services/api';
import { stateName } from '../utils/userState';
import { ICONS } from '../components/AppIcon';

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
    icon:    ICONS.silent,
  },
  {
    heading: t('x_juvenile_justice_parent_must_be_notified'),
    body:    t('x_juvenile_justice_police_must_notify_parent'),
    icon:    ICONS.family,
  },
  {
    heading: t('x_juvenile_justice_have_right_attorney'),
    body:    t('x_juvenile_justice_re_gault_1967_supreme'),
    icon:    ICONS.lawyer,
  },
  {
    heading: t('x_juvenile_justice_records_confidential'),
    body:    t('x_juvenile_justice_juvenile_court_records_not'),
    icon:    ICONS.lock,
  },
  {
    heading: t('x_juvenile_justice_not_convicted'),
    body:    t('x_juvenile_justice_terminology_different_it_matters'),
    icon:    ICONS.clipboard,
  },
  {
    heading: t('x_juvenile_justice_can_still_be_tried'),
    body:    t('x_juvenile_justice_serious_offenses_prosecutors_can'),
    icon:    ICONS.statusWarn,
  },
  {
    heading: t('x_juvenile_justice_rehabilitation_goal'),
    body:    t('x_juvenile_justice_juvenile_justice_system_designed'),
    icon:    ICONS.breathe,
  },
  {
    heading: t('x_juvenile_justice_future_priority'),
    body:    t('x_juvenile_justice_juvenile_adjudication_does_not'),
    icon:    ICONS.trophy,
  },
]);

// ── Sealing data ──────────────────────────────────────────────────────────────
// Served by GET /api/expungement/juvenile (backend expungement/rules_data.js,
// researched against statutes in the Oct 2026 legal accuracy review). The table
// that used to live here was hand-written and wrong for most states (automatic vs
// petition, ages, Louisiana's 17-year-olds). A row that was not verified comes back
// with verified: false and is shown as "not verified yet" — never as a rule.
type SealingEntry = { state: string; verified: boolean; automatic: boolean | null; when: string | null; notes: string | null; citation: string | null; source_url: string | null };


// ── Component ─────────────────────────────────────────────────────────────────
// Loading state
function JuvenileJusticeScreen({ route }: ScreenProps): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
      return () => { mountedRef.current = false; };
  }, []);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  type Tab = 'rights' | 'process' | 'sealing';
  const initialTab = (route?.params as { tab?: Tab } | undefined)?.tab;
  const [tab, setTab] = React.useState<Tab>(initialTab && ['rights', 'process', 'sealing'].includes(initialTab) ? initialTab : 'rights');
  // Sealing table: the person's state first (all states when none is saved).
  const [sealState, setSealState] = React.useState('');
  React.useEffect(() => { getUserState().then(u => { if (u?.code) setSealState(prev => prev || u.code); }).catch(() => {}); }, []);
  const [sealing, setSealing] = React.useState<SealingEntry[]>([]);
  const [sealingError, setSealingError] = React.useState(false);
  const [sealingLoading, setSealingLoading] = React.useState(false);
  React.useEffect(() => {
    if (tab !== 'sealing') return;
    let cancel = false;
    setSealingLoading(true);
    api.get('/expungement/juvenile', { params: sealState ? { state: sealState } : {} })
      .then(r => { if (!cancel) { setSealing(Array.isArray(r.data?.data) ? r.data.data : []); setSealingError(false); } })
      .catch(() => { if (!cancel) setSealingError(true); })
      .finally(() => { if (!cancel) setSealingLoading(false); });
    return () => { cancel = true; };
  }, [tab, sealState]);
  const sealingRows = sealing.filter(r => !sealState || r.state === sealState);

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
        <AppIcon name={ICONS.lawyer} size={20} color={themeColors().textBrand} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerTitle, { color: colors.textOnNavy }]}>{t('juv_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerSub, { color: colors.steel }]}>{t('x_juvenile_justice_rights_juvenile_system')}</Text>
      </View>

      <View style={{ paddingHorizontal: 12 }}>
      <UnreviewedNotice inset={false} />
      <InfoTabs
        testID="juvenile-tabs"
        tabs={[{ key: 'rights', label: t('x_juvenile_justice_rights') }, { key: 'process', label: t('x_juvenile_justice_process') }, { key: 'sealing', label: t('juv_tab_sealing') }]}
        active={tab}
        onChange={k => setTab(k as 'rights' | 'process' | 'sealing')}
      />

      {tab === 'rights' && RIGHTS_SECTIONS().map(sec => (
        <View key={sec.heading} style={[styles.rightCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={styles.rightCardHeader}>
            <AppIcon name={sec.icon} size={22} color={colors.textBrand} style={styles.rightCardIcon} />
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

      {tab === 'sealing' && (
        <View style={{ marginBottom: 10 }}>
          <StatePicker value={sealState} onChange={setSealState} allowAll testID="juvenile-state" />
        </View>
      )}
      {tab === 'sealing' && sealingLoading && <ActivityIndicator style={{ marginVertical: 20 }} color={colors.textBrand} testID="juvenile-loading" />}
      {tab === 'sealing' && sealingError && (
        <Text maxFontSizeMultiplier={1.4} style={[styles.sealingNotes, { color: colors.textMuted, padding: 16 }]} testID="juvenile-error">{t('pen_load_error')}</Text>
      )}
      {tab === 'sealing' && sealingRows.map(row => (
        <View key={row.state} style={[styles.sealingRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={[styles.stateBadge, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.stateBadgeText, { color: colors.textBrand }]}>{row.state}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {row.verified ? (
              <>
                <View style={styles.sealingRowTop}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.sealingWhen, { color: colors.textPrimary }]}>{row.when}</Text>
                  <View style={[styles.autoChip, { backgroundColor: row.automatic ? colors.legalBg : colors.bgSubtle }]}>
                    <Text maxFontSizeMultiplier={1.2} style={[styles.autoChipText, { color: row.automatic ? colors.legalDark : colors.textMuted }]}>
                      {row.automatic ? t('x_juvenile_justice_automatic') : t('x_juvenile_justice_petition')}
                    </Text>
                  </View>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={[styles.sealingNotes, { color: colors.textMuted }]}>{row.notes}</Text>
                {getLang() !== 'en' && <Text maxFontSizeMultiplier={1.3} style={[styles.sealingNotes, { color: colors.textMuted }]}>{t('pen_notes_english')}</Text>}
                <SourceLine source={row.citation} recorded="2026-10-26" testID="juvenile-row-source" />
              </>
            ) : (
              <Text maxFontSizeMultiplier={1.4} style={[styles.sealingNotes, { color: colors.textMuted }]} testID="juvenile-unverified">
                {t('legal_unverified_withheld', { state: stateName(row.state) })}
              </Text>
            )}
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
  headerTitle:      { color: colors.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
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
  ctaBtnText:       { color: colors.bg, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  stepScroll:       { marginBottom: 12 },
  stepScrollContent:{ gap: 8, paddingBottom: 4 },
  stepPill:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, gap: 6 },
  stepPillNum:      { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', width: 16, textAlign: 'center' },
  stepPillLabel:    { fontSize: 12, fontWeight: '700', maxWidth: 90 },
  stepCard:         { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 12 },
  stepCardHeader:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  stepNumBadge:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepNumBadgeText: { color: colors.white, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900' },
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