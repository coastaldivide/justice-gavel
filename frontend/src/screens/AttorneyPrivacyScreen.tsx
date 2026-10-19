import { useToast } from '../components/ToastProvider';
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Linking, LayoutAnimation} from 'react-native';
import { COLORS } from '../constants/theme';
import { t, perLang, useLang } from '../i18n';

const SECTIONS = perLang(() => [
  {
    title: t('x_attorney_privacy_attorney_client_privilege'),
    icon: '⚖️',
    body: t('x_attorney_privacy_justice_gavel_legal_technology'),
  },
  {
    title: t('x_attorney_privacy_data_segregation'),
    icon: '🔒',
    body: t('x_attorney_privacy_each_attorney_account_logically'),
  },
  {
    title: t('x_attorney_privacy_professional_responsibility_complian'),
    icon: '📋',
    body: t('x_attorney_privacy_justice_gavel_designed_help'),
  },
  {
    title: t('x_attorney_privacy_data_storage_security'),
    icon: '🛡️',
    body: t('x_attorney_privacy_data_at_rest_aes'),
  },
  {
    title: t('x_attorney_privacy_baa_data_processing_agreement'),
    icon: '📄',
    body: t('x_attorney_privacy_firms_requiring_formal_business'),
  },
  {
    title: t('x_attorney_privacy_ethical_walls_conflict_screening'),
    icon: '🚧',
    body: t('x_attorney_privacy_ethical_wall_functionality_available'),
  },
  {
    title: t('x_attorney_privacy_ai_disclaimer'),
    icon: '🤖',
    body: t('x_attorney_privacy_all_ai_generated_content'),
  },
]);

function AttorneyPrivacyScreen({ navigation }: { navigation?: { navigate: (name: string) => void } }) {
  useLang();
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const { showToast } = useToast();
  const colors = COLORS;
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={s.container}
    >
      {/* Header */}
      <View style={[s.header, { backgroundColor: COLORS.navy }]}>
        <Text style={s.headerIcon} maxFontSizeMultiplier={1.4}>🔏</Text>
        <Text style={s.headerTitle} maxFontSizeMultiplier={1.4}>{t('x_attorney_privacy_attorney_platform_privacy')}</Text>
        <Text style={s.headerSub} maxFontSizeMultiplier={1.4}>
          {t('x_attorney_privacy_data_policy_professional_responsibil')}
        </Text>
      </View>

      {/* Effective date */}
      <View style={[s.effectiveBadge, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}>
        <Text style={[s.effectiveText, { color: COLORS.textMuted }]} maxFontSizeMultiplier={1.4}>
          {t('x_attorney_privacy_effective_january_1_2026')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          accessibilityLabel={t('x_attorney_privacy_full_privacy_policy')}
          onPress={() => navigation?.navigate('PrivacyPolicy')}
        >
          <Text style={[s.fullPolicyLink, { color: COLORS.navy }]} maxFontSizeMultiplier={1.4}>{t('x_attorney_privacy_full_privacy_policy_2')}</Text>
        </TouchableOpacity>
      </View>

      {/* Accordion sections */}
      {SECTIONS()?.length === 0 ? (

        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>📭</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: (colors as any).text, marginBottom: 6 }}>
            {t('empty_state_nothing')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32 }}>
            {t('x_attorney_privacy_results_will_appear_here')}
          </Text>
        </View>
        ) : SECTIONS().map((sec, idx) => (
        <View
          key={`SECTIONS-${idx}`}
          style={[s.section, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}
        >
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={s.sectionHeader}
            accessibilityLabel={sec.icon} onPress={() => setExpanded(expanded === idx ? null : idx)}
          >
            <Text style={s.sectionIcon} maxFontSizeMultiplier={1.4}>{sec.icon}</Text>
            <Text style={[s.sectionTitle, { color: COLORS.textPrimary, flex: 1 }]} maxFontSizeMultiplier={1.4}>
              {sec.title}
            </Text>
            <Text style={[s.chevron, { color: COLORS.textMuted }]} maxFontSizeMultiplier={1.4}>
              {expanded === idx ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>
          {expanded === idx && (
            <View style={[s.sectionBody, { borderTopColor: COLORS.border }]}>
              <Text style={[s.bodyText, { color: COLORS.textSecond }]} maxFontSizeMultiplier={1.4}>
                {sec.body}
              </Text>
            </View>
          )}
        </View>
      ))}

      {/* Contact block */}
      <View style={[s.contactBlock, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}>
        <Text style={[s.contactTitle, { color: COLORS.textPrimary }]} maxFontSizeMultiplier={1.4}>{t('x_attorney_privacy_need_baa_dpa')}</Text>
        <Text style={[s.contactBody, { color: COLORS.textSecond }]} maxFontSizeMultiplier={1.4}>
          {t('x_attorney_privacy_contact_our_legal_team')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[s.contactBtn, { backgroundColor: COLORS.navy }]}
          accessibilityLabel={t('x_attorney_privacy_contact_legal_team')}
          onPress={() => Linking.openURL('mailto:legal@justicegavel.app?subject=BAA%20%2F%20DPA%20request').catch(() => showToast('legal@justicegavel.app'))}
        >
          <Text style={s.contactBtnText} maxFontSizeMultiplier={1.4}>{t('x_attorney_privacy_contact_legal_team_2')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[s.contactBtn, s.contactBtnOutline, { borderColor: COLORS.navy }]}
          onPress={() => Linking.openURL('mailto:privacy@justicegavel.app').catch(() => showToast('privacy@justicegavel.app'))}
        >
          <Text style={[s.contactBtnText, { color: COLORS.navy }]} maxFontSizeMultiplier={1.4}>{t('x_attorney_privacy_request_data_deletion')}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:        { padding: 0, paddingBottom: 24 },
  header:           { padding: 28, paddingTop: 52, alignItems: 'center' },
  headerIcon:       { fontSize: 40, marginBottom: 12 },
  headerTitle:      { fontSize: 22, fontWeight: '800', color: COLORS.white, textAlign: 'center', marginBottom: 8 },
  headerSub:        { fontSize: 14, color: 'rgba(255,255,255,0.82)', textAlign: 'center', lineHeight: 20 },
  effectiveBadge:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, marginHorizontal: 0 },
  effectiveText:    { fontSize: 12 },
  fullPolicyLink:   { fontSize: 12, fontWeight: '600' },
  section:          { marginHorizontal: 16, marginTop: 12, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', padding: 16 },
  sectionIcon:      { fontSize: 22, marginRight: 12 },
  sectionTitle:     { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  chevron:          { fontSize: 12, marginLeft: 8 },
  sectionBody:      { padding: 16, paddingTop: 12, borderTopWidth: 1 },
  bodyText:         { fontSize: 14, lineHeight: 22 },
  contactBlock:     { margin: 16, marginTop: 24, borderRadius: 12, borderWidth: 1, padding: 20 },
  contactTitle:     { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  contactBody:      { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  contactBtn:       { paddingVertical: 13, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  contactBtnOutline:{ backgroundColor: 'transparent', borderWidth: 1.5 },
  contactBtnText:   { color: COLORS.white, fontSize: 14, fontWeight: '700' },
});
export default React.memo(AttorneyPrivacyScreen);