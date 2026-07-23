/**
 * BarPrepProgressScreen — MBE Progress Dashboard
 *
 * Charts & analytics:
 *   • Pass probability meter
 *   • Category accuracy breakdown (bar chart)
 *   • Streak calendar (30-day)
 *   • Peer percentile
 *   • Subject progress rings
 *   • Recent session history
 */

import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { api }            from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { GradientHeader } from '../components/GradientHeader';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CategoryStat {
  category:       string;
  correct:        number;
  total:          number;
  accuracy_pct:   number;
}

interface Session {
  id:             number;
  started_at:     string;
  mode:           string;
  correct_count:  number;
  total_answered: number;
  score_pct:      number;
}

interface Dashboard {
  streak_days:       number;
  pass_probability:  number;
  peer_percentile:   number;
  questions_due:     number;
  total_answered:    number;
  correct_total:     number;
  category_stats:    CategoryStat[];
  recent_sessions:   Session[];
  streak_calendar:   string[];   // ISO date strings with activity
}

const CATEGORY_LABELS: Record<string, string> = {
  homicide: 'Homicide', theft_property: 'Theft & Property',
  defenses: 'Defenses', criminal_procedure: 'Crim Procedure',
  fifth_sixth_amendment: '5th & 6th Amend.',
  fourth_amendment: '4th Amendment', due_process: 'Due Process',
  equal_protection: 'Equal Protection', first_amendment: '1st Amendment',
  incorporation_14th: 'Incorporation / 14th',
};

function getAccuracyColor(pct: number): string {
  if (pct >= 75) return COLORS.legal;
  if (pct >= 55) return COLORS.steelMid;
  return COLORS.bail;
}

// ── Screen ────────────────────────────────────────────────────────────────────
// @ts-ignore
export default function BarPrepProgressScreen({ navigation }: ScreenProps<'BarPrepProgress'>) {
  const { colors }              = useTheme();
  const [data, setData]         = useState<Dashboard | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/bar-prep/progress');
      setData(res.data);
    } catch {
      /* silently handle */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const styles = makeStyles(colors);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const overall = data
    ? Math.round((data.correct_total / Math.max(1, data.total_answered)) * 100)
    : 0;

  return (
    <View style={styles.container}>
      <GradientHeader
        title="Progress Dashboard"
        subtitle="MBE Performance Analytics"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* ── Hero Stats ──────────────────────────────────────────── */}
        <View style={styles.heroRow}>
          {/* Pass Probability */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Pass Probability</Text>
            <Text style={[styles.heroValue, {
              color: getAccuracyColor(data?.pass_probability || 0),
            }]}>
              {data?.pass_probability || 0}%
            </Text>
            <Text style={styles.heroSub}>Target: 66%+</Text>
          </View>

          {/* Overall Accuracy */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Overall Accuracy</Text>
            <Text style={[styles.heroValue, { color: getAccuracyColor(overall) }]}>
              {overall}%
            </Text>
            <Text style={styles.heroSub}>{data?.total_answered || 0} answered</Text>
          </View>

          {/* Streak + Peer */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Streak</Text>
            <Text style={[styles.heroValue, { color: colors.primary }]}>
              🔥 {data?.streak_days || 0}d
            </Text>
            <Text style={styles.heroSub}>Top {data?.peer_percentile || '--'}%</Text>
          </View>
        </View>

        {/* ── Category Breakdown ──────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Category Accuracy</Text>
        <View style={styles.categoryList}>
          {(data?.category_stats || []).map(stat => (
            <View key={stat.category} style={[styles.categoryRow, { backgroundColor: colors.card }]}>
              <Text style={styles.categoryName} numberOfLines={1}>
                {CATEGORY_LABELS[stat.category] || stat.category}
              </Text>
              <View style={styles.categoryBarTrack}>
                <View style={[
                  styles.categoryBarFill,
                  {
                    width: `${Math.min(100, stat.accuracy_pct)}%` as any,
                    backgroundColor: getAccuracyColor(stat.accuracy_pct),
                  },
                ]} />
              </View>
              <Text style={[styles.categoryPct, { color: getAccuracyColor(stat.accuracy_pct) }]}>
                {stat.accuracy_pct}%
              </Text>
              <Text style={styles.categorySub}>{stat.correct}/{stat.total}</Text>
            </View>
          ))}
          {(!data?.category_stats || data.category_stats.length === 0) && (
            <Text style={styles.emptyText}>Answer some questions to see your breakdown.</Text>
          )}
        </View>

        {/* ── 30-Day Streak Calendar ──────────────────────────────── */}
        <Text style={styles.sectionTitle}>30-Day Activity</Text>
        <View style={[styles.calendarCard, { backgroundColor: colors.card }]}>
          <View style={styles.calendarGrid}>
            {Array.from({ length: 30 }, (_, i) => {
              const d = new Date();
              d.setDate(d.getDate() - (29 - i));
              const iso = d.toISOString().slice(0, 10);
              const active = (data?.streak_calendar || []).includes(iso);
              return (
                <View
                  key={iso}
                  style={[
                    styles.calendarDot,
                    { backgroundColor: active ? colors.primary : colors.border },
                  ]}
                />
              );
            })}
          </View>
          <Text style={styles.calendarLegend}>
            {data?.streak_days || 0}-day current streak
          </Text>
        </View>

        {/* ── Recent Sessions ─────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Recent Sessions</Text>
        <View style={styles.sessionList}>
          {(data?.recent_sessions || []).slice(0, 8).map(ses => (
            <View key={ses.id} style={[styles.sessionRow, { backgroundColor: colors.card }]}>
              <View style={styles.sessionLeft}>
                <Text style={styles.sessionMode}>
                  {ses.mode === 'timed' ? '⏱' : '✏️'} {ses.mode}
                </Text>
                <Text style={styles.sessionDate}>
                  {new Date(ses.started_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.sessionRight}>
                <Text style={[
                  styles.sessionScore,
                  { color: getAccuracyColor(ses.score_pct) },
                ]}>
                  {ses.score_pct}%
                </Text>
                <Text style={styles.sessionFraction}>
                  {ses.correct_count}/{ses.total_answered}
                </Text>
              </View>
            </View>
          ))}
          {(!data?.recent_sessions || data.recent_sessions.length === 0) && (
            <Text style={styles.emptyText}>Complete a session to see your history.</Text>
          )}
        </View>

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('BarPrepHome')}
        >
          <Text style={styles.ctaBtnText}>▶ Start New Session</Text>
        </TouchableOpacity>

        {/* Bar prep disclaimer */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 10, color: '#888', textAlign: 'center',
            paddingHorizontal: 16, paddingVertical: 8, lineHeight: 14 }}
        >
          For supplemental study only. Not endorsed by any state bar or the NCBE.
        </Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.background },
    center:        { justifyContent: 'center', alignItems: 'center' },
    scroll:        { flex: 1 },
    scrollContent: { paddingBottom: 40 },
    heroRow:       { flexDirection: 'row', padding: 12, gap: 8 },
    heroCard:      {
      flex: 1, padding: 12, borderRadius: RADIUS.lg,
      // @ts-ignore
      backgroundColor: colors.card, alignItems: 'center', ...SHADOW.xs,
    },
    heroLabel:     { fontSize: 10, color: colors.textMuted, textAlign: 'center', marginBottom: 4 },
    // @ts-ignore
    heroValue:     { fontSize: 22, fontFamily: FONTS.bold },
    heroSub:       { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    sectionTitle:  {
      // @ts-ignore
      fontSize: 13, fontFamily: FONTS.bold, color: colors.text,
      marginTop: 20, marginBottom: 10, marginHorizontal: 16,
    },
    categoryList:  { marginHorizontal: 12, gap: 6 },
    categoryRow:   {
      flexDirection: 'row', alignItems: 'center', padding: 12,
      borderRadius: RADIUS.md, gap: 8,
    },
    categoryName:  { width: 120, fontSize: 12, color: colors.text },
    categoryBarTrack: {
      flex: 1, height: 6, backgroundColor: colors.border,
      borderRadius: 3, overflow: 'hidden',
    },
    categoryBarFill: { height: '100%', borderRadius: 3 },
    // @ts-ignore
    categoryPct:   { width: 38, fontSize: 12, fontFamily: FONTS.bold, textAlign: 'right' },
    categorySub:   { width: 36, fontSize: 10, color: colors.textMuted, textAlign: 'right' },
    // @ts-ignore
    calendarCard:  { marginHorizontal: 16, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.xs },
    calendarGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    calendarDot:   { width: 22, height: 22, borderRadius: 4 },
    calendarLegend: { fontSize: 12, color: colors.textMuted, marginTop: 10, textAlign: 'center' },
    sessionList:   { marginHorizontal: 12, gap: 6 },
    sessionRow:    {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: 12, borderRadius: RADIUS.md,
    },
    sessionLeft:   {},
    // @ts-ignore
    sessionMode:   { fontSize: 13, fontFamily: FONTS.medium, color: colors.text },
    sessionDate:   { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    sessionRight:  { alignItems: 'flex-end' },
    // @ts-ignore
    sessionScore:  { fontSize: 18, fontFamily: FONTS.bold },
    sessionFraction: { fontSize: 11, color: colors.textMuted },
    emptyText:     { color: colors.textMuted, fontSize: 13, textAlign: 'center', padding: 20 },
    ctaBtn:        {
      marginHorizontal: 16, marginTop: 24, paddingVertical: 15,
      borderRadius: RADIUS.lg, alignItems: 'center', ...SHADOW.sm,
    },
    // @ts-ignore
    ctaBtnText:    { fontSize: 16, fontFamily: FONTS.bold, color: '#fff' },
  });
}