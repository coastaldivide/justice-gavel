/**
 * OfflineStatusScreen — what works without a connection.
 *
 * Reached from the global "No internet connection" banner (App.tsx) and the
 * Settings → My Tools list. Lists the features that run fully on-device and
 * links straight to them.
 */
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useTheme } from '../constants/theme';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { t, useLang, perLang } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

const OFFLINE_FEATURES = perLang((): { icon: string; label: string; hint: string; screen: string }[] => [
  { icon: '📋', label: t('rc_page_title'), hint: t('x_offline_status_rights_during_stop_arrest'),     screen: 'RightsCard' },
  { icon: '⏰', label: t('x_cs_deadline_calculator'),   hint: t('x_offline_status_arraignment_appeal_filing_deadlines'), screen: 'DeadlineCalculator' },
  { icon: '🚨', label: t('x_offline_status_just_arrested_guide'),   hint: t('x_offline_status_step_by_step_what'),      screen: 'JustArrested' },
  { icon: '📅', label: t('ja_my_court_dates'),     hint: t('os_court_dates_hint'),                                   screen: 'CourtDates' },
  { icon: '👨‍👩‍👧', label: t('os_emergency_share'), hint: t('os_emergency_share_hint'),                            screen: 'EmergencyShare' },
  { icon: '📁', label: t('case_tab_cases'),              hint: t('x_offline_status_saved_cases_sync_when'),     screen: 'Cases' },
]);

const NEEDS_CONNECTION = perLang(() => [
  t('x_offline_status_ai_legal_chat_research'),
  t('x_offline_status_lawyer_bail_agent_search'),
  t('x_offline_status_messages_bookings_payments'),
]);

function OfflineStatusScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const online = useNetworkStatus();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.scroll}>
      <View style={[styles.status, { backgroundColor: online ? colors.legalBg : colors.warnBg }]}>
        <IconLabel icon={ICONS.offline} textStyle={[styles.statusText, { color: online ? colors.legalDark : colors.warnDark }]} maxFontSizeMultiplier={1.4}>{online ? t('x_offline_status_online_everything_available') : t('x_offline_status_offline_these_tools_still')}</IconLabel>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.section, { color: colors.textMuted }]}>{t('x_offline_status_works_offline')}</Text>
      {OFFLINE_FEATURES().map(f => (
        <TouchableOpacity
          key={f.screen}
          testID={`offline-open-${f.screen}`}
          accessibilityRole="button"
          accessibilityLabel={t('x_offline_status_open', { label: f.label })}
          style={[styles.row, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={() => navigation.navigate(f.screen as never)}
        >
          <Text style={styles.icon}>{f.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.label, { color: colors.textPrimary }]}>{f.label}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.hint, { color: colors.textMuted }]}>{f.hint}</Text>
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      ))}

      <Text maxFontSizeMultiplier={1.4} style={[styles.section, { color: colors.textMuted }]}>{t('x_offline_status_needs_connection')}</Text>
      {NEEDS_CONNECTION().map(item => (
        <Text key={item} maxFontSizeMultiplier={1.4} style={[styles.needs, { color: colors.textSecond }]}>• {item}</Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:     { padding: 16, paddingBottom: 40 },
  status:     { borderRadius: 12, padding: 14, marginBottom: 8 },
  statusText: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  section:    { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 18, marginBottom: 8 },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 },
  icon:       { fontSize: 22 },
  label:      { fontSize: 15, fontWeight: '600' },
  hint:       { fontSize: 12, marginTop: 2 },
  needs:      { fontSize: 13, lineHeight: 22 },
});

export default OfflineStatusScreen;
