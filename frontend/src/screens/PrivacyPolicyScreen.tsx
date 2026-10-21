import { useTheme, type ThemeColors } from '../constants/theme';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
/**
 * PrivacyPolicyScreen
 *
 * Full Privacy Policy -- required by Apple, Google, and GDPR/CCPA.
 * Covers: data collected, how used, sharing, retention, user rights.
 * Accessible from: Settings → Privacy Policy, Onboarding footer.
 *
 * Compliant with:
 *  • CCPA (California Consumer Privacy Act)
 *  • GDPR (EU users)
 *  • Apple App Store requirements
 *  • Google Play requirements
 */
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { hapticImpact } from '../utils/webCompat';
import { t, perLang, useLang, locale } from '../i18n';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';

/** Effective date (shown in the reader's language, e.g. "1 de mayo de 2026"). */
const EFFECTIVE_ISO = '2026-05-01';
const effectiveDate = () => new Date(`${EFFECTIVE_ISO}T12:00:00Z`).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const COMPANY = 'Justice Gavel LLC';
const CONTACT_EMAIL   = 'privacy@justicegavel.app';
const WEBSITE         = 'https://justicegavel.app';
const DPO_EMAIL       = 'dpo@justicegavel.app'; // Data Protection Officer (GDPR)

// ── Data categories table ─────────────────────────────────────────────────────
type DataRow = {
  category: string;
  examples: string;
  purpose: string;
  shared: string;
  retention: string;
};

const DATA_TABLE = perLang((): DataRow[] => [
  {
    category: t('x_privacy_policy_account_information'),
    examples: t('x_privacy_policy_name_email_phone_number'),
    purpose: t('x_privacy_policy_create_manage_account_authentication'),
    shared: t('x_privacy_policy_not_sold_shared_only'),
    retention: t('x_privacy_policy_until_account_deletion_30'),
  },
  {
    category: t('x_privacy_policy_case_legal_data'),
    examples: t('x_privacy_policy_case_notes_documents_court'),
    purpose: t('x_privacy_policy_provide_case_management_features'),
    shared: t('x_privacy_policy_not_shared_encrypted_at'),
    retention: t('x_privacy_policy_until_account_deletion_manual'),
  },
  {
    category: t('x_privacy_policy_audio_recordings'),
    examples: t('x_privacy_policy_police_encounter_recordings_encounte'),
    purpose: t('x_privacy_policy_transcription_pdf_generation_only'),
    shared: t('x_privacy_policy_processed_by_openai_whisper'),
    retention: t('x_privacy_policy_deleted_from_our_servers'),
  },
  {
    category: t('x_privacy_policy_location_data'),
    examples: t('x_privacy_policy_gps_coordinates_only_when'),
    purpose: t('x_privacy_policy_find_nearby_attorneys_bail'),
    shared: t('x_privacy_policy_not_stored_used_real'),
    retention: t('x_privacy_policy_not_retained_after_search'),
  },
  {
    category: t('x_privacy_policy_device_usage_data'),
    examples: t('x_privacy_policy_device_type_os_version'),
    purpose: t('x_privacy_policy_bug_fixing_performance_monitoring'),
    shared: t('x_privacy_policy_sentry_crash_reporting_only'),
    retention: t('x_privacy_policy_90_days'),
  },
  {
    category: t('x_privacy_policy_ai_conversation_data'),
    examples: t('x_privacy_policy_messages_sent_ai_assistant'),
    purpose: t('x_privacy_policy_generate_ai_responses_improve'),
    shared: t('x_privacy_policy_processed_by_anthropic_not'),
    retention: t('x_privacy_policy_90_days_quality_review'),
  },
  {
    category: t('x_privacy_policy_payment_data'),
    examples: t('x_privacy_policy_subscription_status_payment_method'),
    purpose: t('x_privacy_policy_process_subscriptions'),
    shared: t('x_privacy_policy_stripe_handles_payment_processing'),
    retention: t('x_privacy_policy_per_stripe_retention_policy'),
  },
  {
    category: t('x_privacy_policy_push_notification_tokens'),
    examples: t('x_privacy_policy_expo_push_token_device'),
    purpose: t('x_privacy_policy_send_court_date_reminders'),
    shared: t('x_privacy_policy_expo_push_infrastructure_apple'),
    retention: t('x_privacy_policy_until_disabled_settings_account'),
  },
]);

type Section = { heading: string; body: string };
const SECTIONS = perLang((): Section[] => [
  {
    heading: t('x_privacy_policy_1_who_we'),
    body:
      t('x_privacy_policy_operates_justice_gavel_mobile', { COMPANY: COMPANY, COMPANY2: COMPANY, CONTACT_EMAIL, DPO_EMAIL }),
  },
  {
    heading: t('x_privacy_policy_2_data_we_collect'),
    body:
      t('x_privacy_policy_we_collect_only_data'),
  },
  {
    heading: t('x_privacy_policy_3_how_we_use'),
    body:
      t('x_privacy_policy_we_use_data_provide'),
  },
  {
    heading: t('x_privacy_policy_4_third_party_service'),
    body:
      t('x_privacy_policy_we_work_with_following'),
  },
  {
    heading: t('x_privacy_policy_5_audio_recordings_special'),
    body:
      t('x_privacy_policy_when_use_encounter_recorder'),
  },
  {
    heading: t('x_privacy_policy_6_data_security'),
    body:
      t('x_privacy_policy_we_implement_industry_standard'),
  },
  {
    heading: t('x_privacy_policy_7_rights_gdpr_ccpa'),
    body:
      t('x_privacy_policy_regardless_where_located_have', { CONTACT_EMAIL }),
  },
  {
    heading: t('x_privacy_policy_8_children_s_privacy'),
    body:
      t('x_privacy_policy_justice_gavel_not_directed'),
  },
  {
    heading: t('x_privacy_policy_9_data_retention'),
    body:
      t('x_privacy_policy_we_retain_data_only'),
  },
  {
    heading: t('x_privacy_policy_10_international_data_transfers'),
    body:
      t('x_privacy_policy_we_based_united_states', { DPO_EMAIL }),
  },
  {
    heading: t('x_privacy_policy_11_changes_this_policy'),
    body:
      t('x_privacy_policy_we_may_update_this'),
  },
  {
    heading: t('x_privacy_policy_12_contact_complaints'),
    body:
      t('x_privacy_policy_privacy_inquiries_eu_data', { CONTACT_EMAIL, DPO_EMAIL, WEBSITE }),
  },
]);

function PrivacyPolicyScreen(): React.JSX.Element {
  useLang();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const scrollRef = useRef<ScrollView>(null);
  const [tableExpanded, setTableExpanded] = useState(false);

  const openEmail = (addr: string) => {
    hapticImpact();
    Linking.openURL(`mailto:${addr}`).catch(() =>
      showToast(t('x_privacy_policy_contact_us_at', { addr }), 'info')
    );
  };

  const requestDeletion = () => {
    hapticImpact();
    confirm(t('x_privacy_policy_request_data_deletion'), t('x_privacy_policy_this_will_send_email'),
      { confirmLabel: t('x_privacy_policy_send_request') }).then(ok => { if (ok) openEmail(CONTACT_EMAIL); });
  };

  return (
    <ScrollView
      testID="privacy-policy-screen"
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.2} style={styles.headerEyebrow}>
          JUSTICE GAVEL
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>
          {t('onb_terms_pp')}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerMeta}>
          {t('x_privacy_policy_effective', { EFFECTIVE_DATE: effectiveDate() })}
        </Text>
        <View style={styles.headerBadges}>
          {['GDPR', 'CCPA', 'Apple', 'Google Play'].map(badge => (
            <View key={badge} style={styles.badge}>
              <Text style={styles.badgeText}>✓ {badge}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Quick summary ────────────────────────────────────────── */}
      <View style={[styles.summaryBox, { backgroundColor: isDark ? colors.surface : colors.legalBg,
        borderLeftColor: colors.legalDark }]}>
        <IconLabel icon={ICONS.lock} textStyle={[styles.summaryTitle,
          { color: colors.legalDark }]} maxFontSizeMultiplier={1.2}>{t('x_privacy_policy_privacy_plain_english')}</IconLabel>
        {[
          t('x_privacy_policy_we_do_not_sell'),
          t('x_privacy_policy_we_do_not_show'),
          t('x_privacy_policy_audio_recordings_deleted_from'),
          t('x_privacy_policy_location_used_real_time'),
          t('x_privacy_policy_can_delete_account_all'),
        ].map((item, i) => (
          <Text key={`item-${i}`} maxFontSizeMultiplier={1.3} style={[styles.summaryItem,
            { color: isDark ? colors.legal : colors.legalDark }]}>
            ✓  {item}
          </Text>
        ))}
      </View>

      {/* ── Data table ───────────────────────────────────────────── */}
      <TouchableOpacity
        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={[styles.tableToggle, { backgroundColor: colors.bgCard,
          borderColor: colors.border }]}
        onPress={() => {
          hapticImpact();
          setTableExpanded(v => !v);
        }}
          accessibilityState={{ selected: false }}
        accessibilityLabel={t('x_privacy_policy_toggle_data_collection_table')}
      >
        <IconLabel icon={ICONS.stats} textStyle={[styles.tableToggleText,
          { color: colors.textPrimary }]} maxFontSizeMultiplier={1.3}>{t('x_privacy_policy_what_data_we_collect')}</IconLabel>
        <Text style={[styles.tableChevron, { color: colors.textMuted }]}>
          {tableExpanded ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      {tableExpanded && (
        <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
          {DATA_TABLE()?.length === 0 ? (

        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <AppIcon name={ICONS.inbox} size={32} color={colors.textBrand} style={{ fontSize: 32, marginBottom: 12 }} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
            {t('empty_state_nothing')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32 }}>
            {t('x_attorney_privacy_results_will_appear_here')}
          </Text>
        </View>
        ) : DATA_TABLE().map((row, i) => (
            <View key={`DATA_TAB-${i}`} style={[styles.tableRow,
              { backgroundColor: i % 2 === 0 ? colors.bgCard : colors.bgSubtle,
                borderBottomColor: colors.border }]}>
              <Text maxFontSizeMultiplier={1.2} style={[styles.tableCategory,
                { color: colors.textPrimary }]}>
                {row.category}
              </Text>
              <View style={styles.tableFields}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>{t('x_privacy_policy_examples')}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.examples}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>{t('x_privacy_policy_purpose')}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.purpose}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>{t('x_privacy_policy_shared_with')}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.shared}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableLabel,
                  { color: colors.textMuted }]}>{t('x_privacy_policy_retention')}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.tableValue,
                  { color: colors.textSecond }]}>{row.retention}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Full sections ────────────────────────────────────────── */}
      {SECTIONS().map((section, idx) => (
        <View key={`SECTIONS-${idx}`} style={[styles.section, { backgroundColor: colors.bgCard,
          borderLeftColor: colors.legalDark }]}>
          <Text maxFontSizeMultiplier={1.2} style={[styles.sectionHeading,
            { color: colors.textPrimary }]}>
            {section.heading}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.sectionBody,
            { color: colors.textSecond }]}>
            {section.body}
          </Text>
        </View>
      ))}

      {/* ── User rights CTAs ─────────────────────────────────────── */}
      <View style={[styles.rightsCard, { backgroundColor: colors.bgCard }]}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.rightsTitle,
          { color: colors.textPrimary }]}>
          {t('x_privacy_policy_exercise_rights')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.rightsBtn, { backgroundColor: colors.legalDark }]}
          onPress={() => openEmail(CONTACT_EMAIL)}
          activeOpacity={0.85}
        >
          <IconLabel icon={ICONS.clipboard} textStyle={styles.rightsBtnText} maxFontSizeMultiplier={1.3}>{t('x_privacy_policy_request_data_access_correction')}</IconLabel>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.rightsBtn, { backgroundColor: colors.emergencyDark }]}
          onPress={requestDeletion}
          activeOpacity={0.85}
          accessibilityLabel={t('x_privacy_policy_request_account_data_deletion')}
        >
          <IconLabel icon={ICONS.delete} textStyle={styles.rightsBtnText} maxFontSizeMultiplier={1.3}>{t('x_privacy_policy_request_account_deletion')}</IconLabel>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.3} style={[styles.rightsNote,
          { color: colors.textMuted }]}>
          {t('x_privacy_policy_we_respond_all_privacy')}
        </Text>
      </View>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <View style={[styles.footer, { backgroundColor: colors.bgCard }]}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.footerText,
          { color: colors.textMuted }]}>
          {t('x_privacy_policy_all_rights_reserved', { value: new Date().getFullYear(), COMPANY: COMPANY })}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.footerText,
          { color: colors.textMuted, marginTop: 4 }]}>
          {t('x_privacy_policy_we_believe_rights_including')}
        </Text>
      </View>

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  scroll:           { paddingBottom: 32 },
  header:           { padding: 28, paddingTop: 48 },
  headerEyebrow:    { color: 'rgba(133,183,235,0.8)', fontSize: 11, fontWeight: '800',
                      letterSpacing: 3, marginBottom: 6 },
  headerTitle:      { color: colors.white, fontSize: 28, fontWeight: '900', marginBottom: 8 },
  headerMeta:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 14 },
  headerBadges:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge:            { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20,
                      paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:        { color: colors.white, fontSize: 11, fontWeight: '700' },
  summaryBox:       { margin: 16, borderRadius: 12, padding: 16, borderLeftWidth: 5, gap: 6 },
  summaryTitle:     { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  summaryItem:      { fontSize: 13, lineHeight: 20 },
  tableToggle:      { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row',
                      alignItems: 'center', padding: 14, borderRadius: 12,
                      borderWidth: 1, justifyContent: 'space-between' },
  tableToggleText:  { fontSize: 14, fontWeight: '700', flex: 1 },
  tableChevron:     { fontSize: 14, fontWeight: '700', marginLeft: 8 },
  tableRow:         { padding: 14, borderBottomWidth: 1 },
  tableCategory:    { fontSize: 13, fontWeight: '800', marginBottom: 10 },
  tableFields:      { gap: 3 },
  tableLabel:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
                      textTransform: 'uppercase', marginTop: 6 },
  tableValue:       { fontSize: 12, lineHeight: 18 },
  section:          { marginHorizontal: 16, marginBottom: 10, borderRadius: 12,
                      padding: 18, borderLeftWidth: 4 },
  sectionHeading:   { fontSize: 14, fontWeight: '800', marginBottom: 10, lineHeight: 20 },
  sectionBody:      { fontSize: 13, lineHeight: 21 },
  rightsCard:       { margin: 16, borderRadius: 14, padding: 20, gap: 12 },
  rightsTitle:      { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  rightsBtn:        { borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  rightsBtnText:    { color: colors.bg, fontSize: 14, fontWeight: '700' },
  rightsNote:       { fontSize: 12, textAlign: 'center' },
  footer:           { margin: 16, borderRadius: 12, padding: 20, alignItems: 'center' },
  footerText:       { fontSize: 12, textAlign: 'center' },
});
export default React.memo(PrivacyPolicyScreen);