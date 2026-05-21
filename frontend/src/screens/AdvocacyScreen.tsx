import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { api } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';

declare var data: any;
interface Stats {
  lawyerCount: number;
  bailCount: number;
  alertsSent: number;
  userCount: number;
  citiesCovered: number;
  coverage: { city: string; n: number }[];
  lastUpdated: string;
}

function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderTopColor: color, borderTopWidth: 3 }]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.statIcon}>{icon}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.statValue, { color }]}>{value}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AdvocacyScreen(): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [stats, setStats]       = useState<Stats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState('');

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError('');
    try {
      const r = await api.get('/advocacy/stats');
      setStats(r.data || {});
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not load stats. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.navy]} />}
    >
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Advocacy Dashboard</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.sub}>Justice Gavel network at a glance</Text>
      </View>

      {loading && !stats ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.navy} size="large" />
      ) : error ? (
        <View style={styles.errorCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}
            accessibilityRole="button"
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : stats ? (
        <>
          {/* Key stats grid */}
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>Network stats</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="⚖️" value={stats.lawyerCount}    label="Active lawyers"    color={colors.navy} />
            <StatCard icon="🔓" value={stats.bailCount}      label="Bail agents"       color={colors.warnDark} />
            <StatCard icon="📍" value={stats.citiesCovered}  label="Cities covered"   color={colors.legalDark} />
            <StatCard icon="🚨" value={stats.alertsSent}     label="SOS alerts sent"  color={colors.emergencyDark} />
            <StatCard icon="👥" value={stats.userCount}      label="Registered users" color={colors.blue} />
            <StatCard icon="🕐" value={formatDate(stats.lastUpdated)} label="Last updated" color={colors.textSecond} />
          </View>

          {/* City coverage */}
          {stats.coverage && stats.coverage.length > 0 && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>City coverage</Text>
              <View style={styles.coverageCard}>
                {stats.coverage.map((c, i) => (
                  <View key={c.city} style={[styles.coverageRow, i < stats.coverage.length - 1 && styles.coverageRowBorder]}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.coverageCity}>{c.city}</Text>
                    <View style={styles.coverageBar}>
                      <View style={[styles.coverageFill, { width: `${Math.min(100, (c.n / 5) * 100)}%` as any }]} />
                    </View>
                    <Text maxFontSizeMultiplier={1.4} style={styles.coverageCount}>{c.n} lawyers</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Mission statement */}
          <View style={styles.missionCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.missionTitle}>Our mission</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.missionText}>
              Justice Gavel connects people in the criminal justice system with qualified defense attorneys, bail agents, and legal resources -- regardless of income, language, or location. Every alert sent, every lawyer found, and every lesson completed moves us toward a more equitable justice system.
            </Text>
          </View>
        </>
      ) : null}

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📣</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No advocacy resources available</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check back soon for updates.</Text>
        </View>
      )}
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: 16, paddingBottom: 40 },
  header: { backgroundColor: '#042C53', borderRadius: 16, padding: 16, marginBottom: 16 },
  heading: { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900' },
  sub: { color: COLORS.bgSubtle, fontSize: 12, lineHeight: 20, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.steel, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  statCard: { width: '47%', backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, alignItems: 'center', elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  statIcon: { fontSize: 22, marginBottom: 6 },
  statValue: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 2 },
  statLabel: { fontSize: 11, color: colors.steel, fontWeight: '600', textAlign: 'center' },
  coverageCard: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginBottom: 16, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  coverageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  coverageRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.bg },
  coverageCity: { width: 130, fontSize: 12, color: colors.bgCard, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  coverageBar: { flex: 1, height: 6, backgroundColor: COLORS.bgSubtle, borderRadius: 4, overflow: 'hidden' },
  coverageFill: { height: '100%', backgroundColor: '#042C53', borderRadius: 4 },
  coverageCount: { width: 60, fontSize: 11, color: colors.steel, textAlign: 'right' },
  missionCard: { backgroundColor: COLORS.bgSubtle, borderRadius: 14, padding: 16, borderLeftWidth: 4, borderLeftColor: '#042C53' },
  missionTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 8 },
  missionText: { fontSize: 12, color: colors.bgCard, lineHeight: 21 },
  errorCard: { backgroundColor: '#EF5350', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 20 },
  errorText: { color: '#EF5350', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 12 },
  retryBtn: { backgroundColor: '#EF5350', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20 },
  retryText: { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
