import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, LayoutAnimation} from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { t, useLang, locale } from '../i18n';

interface Stats {
  lawyerCount: number;
  bailCount: number;
  alertsSent: number;
  userCount: number;
  citiesCovered: number;
  coverage: { city: string; state?: string | null; n: number }[];
  lastUpdated: string;
}

function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
  useLang();
  return (
    <View style={[styles.statCard, { borderTopColor: color, borderTopWidth: 3 }]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.statIcon}>{icon}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.statValue, { color }]}>{value}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AdvocacyScreen(): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { colors } = useTheme();
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
      setError(apiErrorMessage(e, t('x_advocacy_could_not_load_stats')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  return (
    <ScrollView
      testID="advocacy-screen"
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.navy]} />}
    >
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('x_advocacy_advocacy_dashboard')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.sub}>{t('x_advocacy_justice_gavel_network_at')}</Text>
      </View>

      {loading && !stats ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.navy} size="large" />
      ) : error ? (
        <View style={styles.errorCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{error}</Text>
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.retryBtn} accessibilityLabel={t('retry')} onPress={() => load()}
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.retryText}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : stats ? (
        <>
          {/* Key stats grid */}
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>{t('x_advocacy_network_stats')}</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="⚖️" value={stats.lawyerCount}    label={t("advocacy.stats.active_lawyers")}    color={colors.navy} />
            <StatCard icon="🔓" value={stats.bailCount}      label={t("advocacy.stats.bail_agents")}       color={colors.warnDark} />
            <StatCard icon="📍" value={stats.citiesCovered}  label={t('x_advocacy_cities_covered')}   color={colors.legalDark} />
            <StatCard icon="🚨" value={stats.alertsSent}     label={t('x_advocacy_sos_alerts_sent')}  color={colors.emergencyDark} />
            <StatCard icon="👥" value={stats.userCount}      label={t('x_advocacy_registered_users')} color={colors.blue} />
            <StatCard icon="🕐" value={formatDate(stats.lastUpdated)} label={t('x_advocacy_last_updated')} color={colors.textSecond} />
          </View>

          {/* City coverage */}
          {stats.coverage && stats.coverage.length > 0 && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>{t('x_advocacy_city_coverage')}</Text>
              <View style={styles.coverageCard}>
                {stats.coverage.map((c, i) => (
                  <View key={`${c.city}-${c.state || ''}`} style={[styles.coverageRow, i < stats.coverage.length - 1 && styles.coverageRowBorder]}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.coverageCity}>{c.state ? `${c.city}, ${c.state}` : c.city}</Text>
                    <View style={styles.coverageBar}>
                      {/* bar length relative to the best-covered city */}
                      <View style={[styles.coverageFill, { width: `${Math.max(4, Math.round((c.n / Math.max(1, stats.coverage[0]?.n || 1)) * 100))}%` }]} />
                    </View>
                    <Text maxFontSizeMultiplier={1.4} style={styles.coverageCount}>{t('x_advocacy_lawyers', { n: c.n })}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Mission statement */}
          <View style={styles.missionCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.missionTitle}>{t('x_advocacy_our_mission')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.missionText}>
              {t('x_advocacy_justice_gavel_connects_people')}
            </Text>
          </View>
        </>
      ) : null}

        <Text style={{ fontSize: 11, color: colors.textSecond, textAlign: 'center', padding: 12, paddingBottom: 24 }}>{t('x_advocacy_this_content_general_educational')}</Text>
        </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: 16, paddingBottom: 40 },
  header: { backgroundColor: COLORS.navy, borderRadius: 16, padding: 16, marginBottom: 16 },
  heading: { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900' },
  sub: { color: COLORS.bgSubtle, fontSize: 12, lineHeight: 20, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  statCard: { width: '47%', backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, alignItems: 'center', elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  statIcon: { fontSize: 22, marginBottom: 6 },
  statValue: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 2 },
  statLabel: { fontSize: 11, color: colors.info, fontWeight: '600', textAlign: 'center' },
  coverageCard: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginBottom: 16, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  coverageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  coverageRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.bg },
  coverageCity: { width: 130, fontSize: 12, color: colors.textPrimary, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  coverageBar: { flex: 1, height: 6, backgroundColor: COLORS.bgSubtle, borderRadius: 4, overflow: 'hidden' },
  coverageFill: { height: '100%', backgroundColor: COLORS.navy, borderRadius: 4 },
  coverageCount: { width: 60, fontSize: 11, color: colors.info, textAlign: 'right' },
  missionCard: { backgroundColor: COLORS.bgSubtle, borderRadius: 14, padding: 16, borderLeftWidth: 4, borderLeftColor: COLORS.navy },
  missionTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.navy, marginBottom: 8 },
  missionText: { fontSize: 12, color: colors.textOnGold, lineHeight: 21 },
  errorCard: { backgroundColor: colors.emergencyBg, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 20 },
  errorText: { color: colors.emergency, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 12 },
  retryBtn: { backgroundColor: colors.emergency, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20 },
  retryText: { color: colors.textOnAccent, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(AdvocacyScreen);
