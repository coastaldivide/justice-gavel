import { HapticButton } from '../components/HapticButton';
import { AppIcon } from '../components/AppIcon';
/**
 * OfflineStatusScreen -- Offline capability guide
 *
 * Shows clearly what works and what doesn't without a connection.
 * Reachable from the offline banner on any screen, and from Settings.
 *
 * Works fully offline -- no API calls.
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useTheme, RADIUS } from '../constants/theme';
import {
  isOnline, getLastOnlineAt, cacheAgeLabel,
  getCachedCases, getCachedMotions, getCachedLawyers, getCachedLessons,
} from '../services/offlineCache';
declare var data: any;

type Feature = {
  label: string;
  offline: boolean;
  cached: boolean;
  note: string;
  icon: string;
};

const STATIC_FEATURES: Feature[] = [
  { icon: '⚖️', label: 'Constitutional Rights Card',   offline: true,  cached: false, note: 'Always available. No connection needed.' },
  { icon: '⏰', label: 'Deadline Calculator',           offline: true,  cached: false, note: 'Computes all deadlines locally. No connection needed.' },
  { icon: '🤝', label: 'Diversion Checker',             offline: true,  cached: false, note: 'Fully static. Works offline.' },
  { icon: '🏠', label: 'Tenant Rights Guide',           offline: true,  cached: false, note: 'Fully static. Works offline.' },
  { icon: '✈️', label: 'ICE Detention Guide',           offline: true,  cached: false, note: 'Fully static -- EN and ES. Works offline.' },
  { icon: '🧒', label: 'Juvenile Justice Guide',        offline: true,  cached: false, note: 'Fully static. Works offline.' },
  { icon: '🧠', label: 'Mental Health Guide',           offline: true,  cached: false, note: 'Fully static. Works offline.' },
  { icon: '👨‍👩‍👧', label: 'Family Court Guide',           offline: true,  cached: false, note: 'Fully static. Works offline.' },
  { icon: '🌎', label: 'Immigration Consequences',      offline: true,  cached: false, note: 'Fully static. Works offline.' },
  { icon: '🏘️', label: 'Housing Rights Guide',          offline: true,  cached: false, note: 'Fully static. Works offline.' },
  { icon: '📋', label: 'Expungement Reference Cards',   offline: true,  cached: false, note: '51-jurisdiction static reference. Works offline.' },
  { icon: '💙', label: 'Crisis Resources (988)',         offline: true,  cached: false, note: 'Static. Works offline. 988 always reachable.' },
];

const CACHED_FEATURES = [
  { icon: '📁', label: 'My Cases',         key: 'cases',   note: 'Last 30 days cached on device.' },
  { icon: '📋', label: 'Saved Motions',    key: 'motions', note: 'Last 30 generated motions cached.' },
  { icon: '⭐', label: 'Saved Lawyers',    key: 'lawyers', note: 'Cached from last sync.' },
  { icon: '📚', label: 'Legal Lessons',    key: 'lessons', note: 'Cached from last load.' },
];

const ONLINE_ONLY = [
  { icon: '💬', label: 'AI Chat & Research',        note: 'Requires connection to Anthropic API.' },
  { icon: '📋', label: 'Motion Generator',           note: 'AI generation requires connection.' },
  { icon: '🔍', label: 'Discovery Analysis',         note: 'Document upload requires connection.' },
  { icon: '⚖️', label: 'Find Lawyers / Bail',       note: 'GPS search requires connection.' },
  { icon: '🎯', label: 'AI Lawyer Match',            note: 'AI matching requires connection.' },
  { icon: '🔔', label: 'Arrest Monitor',             note: 'Live alerts require connection.' },
  { icon: '🌐', label: 'Real-Time Translator',       note: 'Interpretation requires connection.' },
  { icon: '🔓', label: 'Quick Connect / Emergency',  note: 'Provider matching requires connection.' },
];

export default function OfflineStatusScreen({ navigation }: ScreenProps): React.JSX.Element {

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors } = useTheme();
  const [online, setOnline]         = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastOnline, setLastOnline] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<Record<string, { isCache: boolean; cachedAt: string | null }>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    let [on, lastAt, cases, motions, lawyers, lessons]: any[] = [false, null, {}, {}, {}, {}];
    try { [on, lastAt, cases, motions, lawyers, lessons] = (await Promise.all([
      isOnline(),
      getLastOnlineAt(),
      getCachedCases(),
      getCachedMotions(),
      getCachedLawyers(),
      getCachedLessons(),
    ])) as any[]; } catch { /* use defaults above */ }
    setOnline(on);
    setLastOnline(lastAt);
    setCacheStatus({
      cases:   { isCache: cases.isCache,   cachedAt: cases.cachedAt },
      motions: { isCache: motions.isCache, cachedAt: motions.cachedAt },
      lawyers: { isCache: lawyers.isCache, cachedAt: lawyers.cachedAt },
      lessons: { isCache: lessons.isCache, cachedAt: lessons.cachedAt },
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const statusColor = online === null ? colors.textMuted
    : online ? colors.legal : colors.emergency;
  const statusLabel = online === null ? 'Checking…'
    : online ? 'Connected' : 'No connection';

  return (
    <ScrollView
      testID="offline-status-screen"
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.steel} />}
    >
      {/* Connection status */}
      <View style={[styles.statusCard, { backgroundColor: colors.bgCard, borderColor: online ? colors.legalDark : colors.emergencyDark }]}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
          {lastOnline && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.statusSub, { color: colors.textMuted }]}>
              Last online: {cacheAgeLabel(lastOnline)}
            </Text>
          )}
        </View>
        <TouchableOpacity accessibilityRole="button"
          style={[styles.refreshBtn, { borderColor: colors.border }]}
          onPress={onRefresh}
          accessibilityLabel="Check connection"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.refreshBtnText, { color: colors.textMuted }]}>↺ Check</Text>
        </TouchableOpacity>
      </View>

      {/* Cached data status */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>CACHED ON YOUR DEVICE</Text>
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {CACHED_FEATURES.map((feat, i) => {
          const s = cacheStatus[feat.key];
          const hasCache = s?.isCache;
          return (
            <View key={feat.key} style={[styles.featureRow,
              i < CACHED_FEATURES.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.featureIcon}>{feat.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.featureLabel, { color: colors.textPrimary }]}>{feat.label}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.featureNote, { color: colors.textMuted }]}>
                  {hasCache ? cacheAgeLabel(s.cachedAt) : 'Not yet cached -- open while online to cache'}
                </Text>
              </View>
              <View style={[styles.pill,
                { backgroundColor: hasCache ? colors.legalBg : colors.bgCard,
                  borderColor: hasCache ? colors.legalDark : colors.border }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.pillText, { color: hasCache ? colors.legal : colors.textMuted }]}>
                  {hasCache ? '✓ Cached' : 'Not cached'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Always offline */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>ALWAYS AVAILABLE OFFLINE</Text>
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {STATIC_FEATURES.map((feat, i) => (
          <View key={feat.label} style={[styles.featureRow,
            i < STATIC_FEATURES.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.featureIcon}>{feat.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureLabel, { color: colors.textPrimary }]}>{feat.label}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureNote, { color: colors.textMuted }]}>{feat.note}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: colors.legalBg, borderColor: colors.legalDark }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.pillText, { color: colors.legal }]}>✓ Offline</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Requires connection */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>REQUIRES CONNECTION</Text>
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {ONLINE_ONLY.map((feat, i) => (
          <View key={feat.label} style={[styles.featureRow,
            i < ONLINE_ONLY.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.featureIcon, { opacity: 0.5 }]}>{feat.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureLabel, { color: colors.textSecond }]}>{feat.label}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureNote, { color: colors.textMuted }]}>{feat.note}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: colors.emergencyBg, borderColor: colors.emergencyBg }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.pillText, { color: colors.emergency }]}>Online only</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ height: 40 }} />

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No results found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection or try again.</Text>
        </View>
      )}
      </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:         { flex: 1 },
  scroll:         { padding: 16 },
  statusCard:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: RADIUS.lg, borderWidth: 1.5, marginBottom: 20 },
  statusDot:      { width: 12, height: 12, borderRadius: 8 },
  statusLabel:    { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  statusSub:      { fontSize: 12, marginTop: 2 },
  refreshBtn:     { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  refreshBtnText: { fontSize: 12, lineHeight: 20, fontWeight: '600' },
  sectionLabel:   { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  card:           { borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
  featureRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  featureIcon:    { fontSize: 20, width: 28, textAlign: 'center' },
  featureLabel:   { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2 },
  featureNote:    { fontSize: 11, lineHeight: 16 },
  pill:           { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  pillText:       { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
});
