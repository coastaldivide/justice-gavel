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

const OFFLINE_FEATURES: { icon: string; label: string; hint: string; screen: string }[] = [
  { icon: '📋', label: 'Know Your Rights Card', hint: 'Your rights during a stop or arrest',     screen: 'RightsCard' },
  { icon: '⏰', label: 'Deadline Calculator',   hint: 'Arraignment, appeal and filing deadlines', screen: 'DeadlineCalculator' },
  { icon: '🚨', label: 'Just Arrested guide',   hint: 'Step-by-step: what to do right now',      screen: 'JustArrested' },
  { icon: '💰', label: 'Bail Calculator',       hint: 'Typical bail ranges by state',             screen: 'BailCalculator' },
  { icon: '📁', label: 'My Cases',              hint: 'Saved cases sync when you reconnect',     screen: 'Cases' },
];

const NEEDS_CONNECTION = [
  'AI legal chat, research and motion drafting',
  'Lawyer and bail agent search',
  'Messages, bookings and payments',
];

function OfflineStatusScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors } = useTheme();
  const online = useNetworkStatus();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.scroll}>
      <View style={[styles.status, { backgroundColor: online ? colors.legalBg : colors.warnBg }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.statusText, { color: online ? colors.legalDark : colors.warnDark }]}>
          {online ? '✓ You are online — everything is available.' : '📡 You are offline. These tools still work:'}
        </Text>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.section, { color: colors.textMuted }]}>WORKS OFFLINE</Text>
      {OFFLINE_FEATURES.map(f => (
        <TouchableOpacity
          key={f.screen}
          accessibilityRole="button"
          accessibilityLabel={`Open ${f.label}`}
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

      <Text maxFontSizeMultiplier={1.4} style={[styles.section, { color: colors.textMuted }]}>NEEDS A CONNECTION</Text>
      {NEEDS_CONNECTION.map(item => (
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
