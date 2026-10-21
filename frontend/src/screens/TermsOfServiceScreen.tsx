import { COLORS } from '../constants/theme';
import { useToast } from '../components/ToastProvider';
/**
 * TermsOfServiceScreen
 *
 * Full Terms of Service -- required by Apple App Store and Google Play.
 * Accessible from: Settings → Terms of Service
 * Also shown inline during Onboarding (first-time accept flow).
 *
 * Legal notices:
 *  • Not a law firm and does not provide legal advice
 *  • AI output is informational only
 *  • Unauthorized Practice of Law disclaimer
 *  • Subscription and refund terms
 *  • Encounter Recorder recording law notice
 */
import React, { useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { hapticImpact } from '../utils/webCompat';
import {useTheme} from '../constants/theme';
import { t, perLang, useLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

/** Effective date (shown in the reader's language, e.g. "1 de mayo de 2026"). */
const EFFECTIVE_ISO = '2026-05-25';
const effectiveDate = () => new Date(`${EFFECTIVE_ISO}T12:00:00Z`).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const COMPANY = 'Justice Gavel LLC';
const CONTACT_EMAIL = 'legal@justicegavel.app';
const WEBSITE       = 'https://justicegavel.app';

type Section = { heading: string; body: string };

const SECTIONS = perLang((): Section[] => [
  {
    heading: t('x_terms_of_service_1_what_justice_gavel'),
    body:
      t('x_terms_of_service_justice_gavel_legal_information'),
  },
  {
    heading: t('x_terms_of_service_2_eligibility'),
    body:
      t('x_terms_of_service_must_be_at_least'),
  },
  {
    heading: t('x_terms_of_service_3_account'),
    body:
      t('x_terms_of_service_responsible_maintaining_confidential', { CONTACT_EMAIL }),
  },
  {
    heading: t('x_terms_of_service_4_ai_legal_assistant'),
    body:
      t('x_terms_of_service_our_ai_assistant_powered'),
  },
  {
    heading: t('x_terms_of_service_5_encounter_recorder_recording'),
    body:
      t('x_terms_of_service_encounter_recorder_feature_records'),
  },
  {
    heading: t('x_terms_of_service_6_attorney_bail_agent'),
    body:
      t('x_terms_of_service_attorney_bail_agent_listings'),
  },
  {
    heading: t('x_terms_of_service_7_subscriptions_payments'),
    body:
      t('x_terms_of_service_some_features_require_paid', { CONTACT_EMAIL }),
  },
  {
    heading: t('x_terms_of_service_8_privacy'),
    body:
      t('x_terms_of_service_use_justice_gavel_also'),
  },
  {
    heading: t('x_terms_of_service_9_prohibited_conduct'),
    body:
      t('x_terms_of_service_may_not_use_justice'),
  },
  {
    heading: t('x_terms_of_service_10_intellectual_property'),
    body:
      t('x_terms_of_service_all_content_features_functionality', { COMPANY: COMPANY }),
  },
  {
    heading: t('x_terms_of_service_11_disclaimer_warranties'),
    body:
      t('x_terms_of_service_justice_gavel_provided_as'),
  },
  {
    heading: t('x_terms_of_service_12_limitation_liability'),
    body:
      t('x_terms_of_service_maximum_extent_permitted_by', { COMPANY: COMPANY.toUpperCase() }),
  },
  {
    heading: t('x_terms_of_service_13_indemnification'),
    body:
      t('x_terms_of_service_agree_defend_indemnify_hold'),
  },
  {
    heading: t('x_terms_of_service_13_governing_law_dispute'),
    body:
      t('x_terms_of_service_these_terms_governed_by'),
  },
  {
    heading: t('x_terms_of_service_14_changes_these_terms'),
    body:
      t('x_terms_of_service_we_may_update_these'),
  },
  {
    heading: t('x_terms_of_service_15_contact_us'),
    body:
      t('x_terms_of_service_email_website_legal_inquiries', { COMPANY: COMPANY, CONTACT_EMAIL, WEBSITE }),
  },
]);

function TermsOfServiceScreen(): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const { colors, isDark } = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  const openEmail = () => {
    hapticImpact();
    Linking.openURL(`mailto:${CONTACT_EMAIL}`).catch(() => showToast(t('action_failed'), 'error'));
  };

  return (
    <ScrollView
      testID="terms-of-service-screen"
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
          {t('onb_terms_tos')}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerMeta}>
          {t('x_privacy_policy_effective', { EFFECTIVE_DATE: effectiveDate() })}
        </Text>
      </View>

      {/* ── Critical notice ─────────────────────────────────────── */}
      <View style={[styles.noticeBox, { backgroundColor: isDark ? colors.surface : colors.warnBg,
        borderLeftColor: colors.warnDark }]}>
        <IconLabel icon={ICONS.lawyer} textStyle={[styles.noticeTitle,
          { color: colors.warnDark }]} maxFontSizeMultiplier={1.3}>{t('x_terms_of_service_not_legal_advice')}</IconLabel>
        <Text maxFontSizeMultiplier={1.3} style={[styles.noticeBody,
          { color: isDark ? colors.warn : colors.textMuted }]}>
          {t('x_terms_of_service_justice_gavel_provides_legal')}
        </Text>
      </View>

      {/* ── Sections ────────────────────────────────────────────── */}
      {SECTIONS()?.length === 0 ? (

        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <IconLabel icon={ICONS.inbox} textStyle={{ fontSize: 32, marginBottom: 12 }}></IconLabel>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
            {t('empty_state_nothing')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32 }}>
            {t('x_attorney_privacy_results_will_appear_here')}
          </Text>
        </View>
        ) : SECTIONS().map((section, idx) => (
        <View key={`SECTIONS-${idx}`} style={[styles.section, { backgroundColor: colors.bgCard,
          borderLeftColor: idx === 0 ? colors.emergency :
                          idx === 4 ? colors.warnDark :
                          idx === 6 ? colors.legal : colors.border }]}>
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

      {/* ── Footer CTA ──────────────────────────────────────────── */}
      <View style={[styles.footer, { backgroundColor: colors.bgCard }]}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.footerText,
          { color: colors.textMuted }]}>
          {t('x_terms_of_service_questions_about_these_terms')}
        </Text>
        <TouchableOpacity
          onPress={openEmail}
          style={[styles.footerBtn, { borderColor: colors.border }]}
          accessibilityRole="link"
          accessibilityLabel={t('x_terms_of_service_email_legal_justicegavel_app')}
        >
          <IconLabel icon={ICONS.mail} textStyle={[styles.footerBtnText,
            { color: colors.textBrand }]} maxFontSizeMultiplier={1.3}>{CONTACT_EMAIL}</IconLabel>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.3} style={[styles.footerCopy,
          { color: colors.textMuted }]}>
          {t('x_terms_of_service_all_rights_reserved_innocent', { value: new Date().getFullYear(), COMPANY: COMPANY })}
        </Text>
      </View>

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:          { paddingBottom: 32 },
  header:          { padding: 28, paddingTop: 48 },
  headerEyebrow:   { color: 'rgba(133,183,235,0.8)', fontSize: 11, fontWeight: '800',
                     letterSpacing: 3, marginBottom: 6 },
  headerTitle:     { color: COLORS.bg, fontSize: 28, fontWeight: '900', marginBottom: 8 },
  headerMeta:      { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  noticeBox:       { margin: 16, borderRadius: 12, padding: 16, borderLeftWidth: 5 },
  noticeTitle:     { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  noticeBody:      { fontSize: 13, lineHeight: 20 },
  section:         { marginHorizontal: 16, marginBottom: 12, borderRadius: 12,
                     padding: 18, borderLeftWidth: 4 },
  sectionHeading:  { fontSize: 14, fontWeight: '800', marginBottom: 10, lineHeight: 20 },
  sectionBody:     { fontSize: 13, lineHeight: 21 },
  footer:          { margin: 16, borderRadius: 14, padding: 24, alignItems: 'center', gap: 12 },
  footerText:      { fontSize: 13 },
  footerBtn:       { borderWidth: 1, borderRadius: 10, paddingVertical: 12,
                     paddingHorizontal: 20 },
  footerBtnText:   { fontSize: 13, fontWeight: '700' },
  footerCopy:      { fontSize: 11, textAlign: 'center', lineHeight: 17 },
});
export default React.memo(TermsOfServiceScreen);