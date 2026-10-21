import { CONTENT_MAX_WIDTH } from '../utils/responsive';
/**
 * TenantRightsScreen -- Eviction emergency + tenant rights
 *
 * Eviction is the civil equivalent of arrest -- a crisis event with a
 * hard deadline (notice period) and immediate legal consequences.
 * 3.6M eviction filings/year in the US. Most tenants don't get a lawyer.
 *
 * Flow:
 *   1. What's happening? (eviction notice / lockout / utility shutoff / other)
 *   2. Immediate steps for that situation
 *   3. Find a housing attorney → LawyersScreen filtered to Real Estate
 *   4. Legal aid referral (free help for income-qualified)
 *
 * Zero API calls. Works offline.
 *
 * Entry points:
 *   1. LawyersScreen Need modal → "Eviction / Housing"
 *   2. ChatScreen after tenant rights AI response
 *   3. HomeScreen (future tile)
 */
import React from 'react';

import { View, Text, StyleSheet, ScrollView, LayoutAnimation, TouchableOpacity } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { t, perLang, useLang } from '../i18n';
import { UnreviewedNotice } from '../components/LegalSource';
import { IconLabel, ICONS } from '../components/AppIcon';


type Situation = 'eviction_notice' | 'lockout' | 'utility_shutoff' | 'harassment' | 'mold_habitability';

const SITUATIONS = perLang((): { key: Situation; label: string; icon: string; color: string; bg: string }[] => [
  { key: 'eviction_notice',    label: t('x_tenant_rights_i_got_eviction_notice'),        icon: '📄', color: COLORS.emergencyDark, bg: COLORS.emergencyBg },
  { key: 'lockout',            label: t('x_tenant_rights_my_landlord_locked_me'),       icon: '🔒', color: COLORS.warnDark, bg: COLORS.warnBg },
  { key: 'utility_shutoff',    label: t('x_tenant_rights_utilities_were_shut_off'),         icon: '💡', color: COLORS.gold, bg: COLORS.warnBg },
  { key: 'harassment',         label: t('x_tenant_rights_landlord_harassing_me'),        icon: '⚠️', color: COLORS.blue, bg: COLORS.bgSubtle },
  { key: 'mold_habitability',  label: t('x_tenant_rights_unsafe_uninhabitable_unit'),     icon: '🏚️', color: COLORS.textSecond, bg: COLORS.bgSubtle },
]);

const GUIDANCE = perLang((): Record<Situation, { urgent: string[]; rights: string[]; deadline?: string }> => ({
  eviction_notice: {
    deadline: t('x_tenant_rights_typically_have_3_30'),
    urgent: [
      t('x_tenant_rights_read_notice_carefully_note'),
      t('x_tenant_rights_do_not_move_out'),
      t('x_tenant_rights_pay_any_overdue_rent'),
      t('x_tenant_rights_contact_housing_attorney_legal'),
      t('x_tenant_rights_attend_every_court_hearing'),
    ],
    rights: [
      t('x_tenant_rights_landlord_must_go_court'),
      t('x_tenant_rights_cannot_be_locked_out'),
      t('x_tenant_rights_can_dispute_eviction_court'),
      t('x_tenant_rights_retaliation_evictions_after_complain'),
    ],
  },
  lockout: {
    urgent: [
      t('x_tenant_rights_self_help_lockout_illegal'),
      t('x_tenant_rights_document_everything_photos_texts'),
      t('x_tenant_rights_contact_housing_attorney_immediately'),
      t('x_tenant_rights_keep_all_communications_with'),
    ],
    rights: [
      t('x_tenant_rights_landlord_cannot_change_locks'),
      t('x_tenant_rights_may_be_entitled_money'),
      t('x_tenant_rights_emergency_injunctive_relief_can'),
    ],
  },
  utility_shutoff: {
    urgent: [
      t('x_tenant_rights_contact_utility_company_first'),
      t('x_tenant_rights_if_landlord_controls_utilities'),
      t('x_tenant_rights_document_shutoff_with_photos'),
      t('x_tenant_rights_file_complaint_with_local'),
      t('x_tenant_rights_seek_emergency_legal_relief'),
    ],
    rights: [
      t('x_tenant_rights_landlords_cannot_shut_off'),
      t('x_tenant_rights_may_deduct_repair_costs'),
      t('x_tenant_rights_document_all_habitability_issues'),
    ],
  },
  harassment: {
    urgent: [
      t('x_tenant_rights_document_every_incident_dates'),
      t('x_tenant_rights_send_all_communication_writing'),
      t('x_tenant_rights_file_police_report_if'),
      t('x_tenant_rights_contact_housing_attorney_landlord'),
    ],
    rights: [
      t('x_tenant_rights_have_right_quiet_enjoyment'),
      t('x_tenant_rights_landlords_must_give_proper'),
      t('x_tenant_rights_repeated_unannounced_entry_threats'),
    ],
  },
  mold_habitability: {
    urgent: [
      t('x_tenant_rights_send_written_notice_landlord'),
      t('x_tenant_rights_take_photos_videos_all'),
      t('x_tenant_rights_keep_copies_all_communications'),
      t('x_tenant_rights_contact_local_code_enforcement'),
      t('x_tenant_rights_do_not_withhold_rent'),
    ],
    rights: [
      t('x_tenant_rights_landlord_has_legal_duty'),
      t('x_tenant_rights_may_be_entitled_rent'),
      t('x_tenant_rights_retaliation_reporting_habitability_i'),
    ],
  },
}));

function TenantRightsScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // 1. What's happening?  2. Immediate steps + rights for that situation.
  const [situation, setSituation] = React.useState<Situation | ''>('');
  const guidance = situation ? GUIDANCE()[situation] : null;
  const selected = SITUATIONS().find(x => x.key === situation);

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="tenant-rights-screen"
      contentContainerStyle={{ paddingBottom: 32, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <IconLabel icon={ICONS.housing} textStyle={{ fontSize: 32 }} maxFontSizeMultiplier={1.4}></IconLabel>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerTitle, { color: colors.textOnNavy }]}>{t('tr_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerSub, { color: colors.steel }]}>{t('x_tenant_rights_housing_landlord_tenant_law')}</Text>
      </View>

      <UnreviewedNotice />
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 12 }]}>{t('tr_situation_label')}</Text>
      {SITUATIONS().map(sit => {
        const active = sit.key === situation;
        return (
          <TouchableOpacity
            key={sit.key}
            accessibilityRole="button"
            aria-selected={active}
            accessibilityLabel={sit.label}
            testID={`tenant-situation-${sit.key}`}
            onPress={() => setSituation(active ? '' : sit.key)}
            style={[styles.sitCard, { backgroundColor: sit.bg, borderWidth: active ? 2 : 0, borderColor: sit.color }]}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.sitIcon}>{sit.icon}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.sitLabel, { color: sit.color }]}>{sit.label}</Text>
            {active && <Text maxFontSizeMultiplier={1.4} style={[styles.sitCheck, { color: sit.color }]}>✓</Text>}
          </TouchableOpacity>
        );
      })}

      {guidance && selected && (
        <View testID="tenant-guidance">
          {!!guidance.deadline && (
            <View style={[styles.deadlineBanner, { borderColor: COLORS.emergency, backgroundColor: colors.bgCard }]}>
              <IconLabel icon={ICONS.alarm} textStyle={styles.deadlineIcon} maxFontSizeMultiplier={1.4}></IconLabel>
              <Text maxFontSizeMultiplier={1.4} style={styles.deadlineText}>{guidance.deadline}</Text>
            </View>
          )}
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('x_tenant_rights_do_this_now')}</Text>
          {guidance.urgent.map((step, i) => (
            <View key={step} style={[styles.stepRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              <View style={[styles.stepNum, { backgroundColor: selected.color }]}>
                <Text maxFontSizeMultiplier={1.2} style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.stepText, { color: colors.textPrimary }]}>{step}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('tr_your_rights')}</Text>
          <View style={[styles.rightsCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {guidance.rights.map(r => (
              <View key={r} style={styles.rightsRow}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.rightsBullet, { color: colors.legal }]}>✓</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.rightsText, { color: colors.textSecond }]}>{r}</Text>
              </View>
            ))}
          </View>
          <View style={styles.ctaBlock}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('x_tenant_rights_find_housing_attorney')}
              onPress={() => navigation.navigate('LawyersTab')}
              style={[styles.ctaBtn, { backgroundColor: colors.navy }]}
            >
              <IconLabel icon={ICONS.lawyer} textStyle={styles.ctaBtnText} maxFontSizeMultiplier={1.4}>{t('x_tenant_rights_find_housing_attorney_2')}</IconLabel>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { borderTopColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textMuted }]}>
          {t('x_family_court_this_information_general_education')}
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 0, paddingBottom: 40 },

  header: { padding: 20, paddingTop: 16, marginBottom: 16 },
  headerTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, marginBottom: 4 },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },

  sectionLabel: { fontSize: 11, ...FONTS.black, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10, paddingHorizontal: 16 },

  sitCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 8, borderRadius: RADIUS.lg, padding: 14 },
  sitIcon:  { fontSize: 22, flexShrink: 0 },
  sitLabel: { flex: 1, fontSize: 14, lineHeight: 21, ...FONTS.heavy },
  sitCheck: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

  deadlineBanner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', margin: 16, marginTop: 8, borderRadius: RADIUS.lg, borderWidth: 2, padding: 12 },
  deadlineIcon:   { fontSize: 20 },
  deadlineText:   { flex: 1, fontSize: 12, color: colors.textSecond, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 18 },

  stepRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginHorizontal: 16, marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { color: COLORS.bgCard, fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  stepText: { flex: 1, fontSize: 12, lineHeight: 19 },

  rightsCard: { marginHorizontal: 16, borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 20 },
  rightsRow:  { flexDirection: 'row', gap: 8, marginBottom: 8 },
  rightsBullet: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', flexShrink: 0, marginTop: 1 },
  rightsText: { flex: 1, fontSize: 12, lineHeight: 18 },

  ctaBlock: { paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  ctaBtn:   { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center', ...SHADOW.sm },
  ctaBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },
  legalAidBtn: { borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  legalAidText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  disclaimer: { fontSize: 11, textAlign: 'center', lineHeight: 17, paddingHorizontal: 20, marginBottom: 10 },
  card: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textSecond },
});

export default React.memo(TenantRightsScreen);