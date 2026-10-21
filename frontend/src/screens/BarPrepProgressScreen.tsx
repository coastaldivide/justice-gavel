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
import { api, apiErrorMessage } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { GradientHeader } from '../components/GradientHeader';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { toLocalISODate } from '../utils/dateUtils';
import { t, useLang, locale } from '../i18n';
import { categoryLabel } from '../constants/barPrepCategories';
import { IconLabel, ICONS } from '../components/AppIcon';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CategoryStat {
  category:       string;
  correct:        number;
  total:          number;
  accuracy_pct:   number;
}

interface Session {
  id:             string;
  started_at:     string;
  mode:           string;
  correct_count:  number;
  total_answered: number;
  score_pct:      number;
}

interface Dashboard {
  streak_days:       number;
  peer_percentile:   number | null;
  questions_due:     number;
  total_answered:    number;
  correct_total:     number;
  category_stats:    CategoryStat[];
  recent_sessions:   Session[];
  streak_calendar:   string[];   // ISO date strings with activity
}



function getAccuracyColor(pct: number): string {
  if (pct >= 75) return COLORS.legal;
  if (pct >= 55) return COLORS.steelMid;
  return COLORS.bail;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function BarPrepProgressScreen({ navigation }: ScreenProps<'BarPrepProgress'>) {
  useLang();
  const { colors }              = useTheme();
  const [data, setData]         = useState<Dashboard | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get('/bar-prep/progress');
      setData(res.data);
    } catch (e) {
      setError(apiErrorMessage(e, t('x_bar_prep_home_could_not_load_bar')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const { hasSession, recheck } = useHasSession();
  useEffect(() => { if (hasSession) load(); else if (hasSession === false) setLoading(false); }, [hasSession, load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const styles = makeStyles(colors);

  if (hasSession === false) {
    return (
      <View style={styles.container}>
        <GradientHeader title={t('x_bar_prep_progress_progress_dashboard')} onBack={() => navigation.goBack()} />
        <SignInNeeded navigation={navigation} body={t('barprep_signin_body')} onSignedIn={recheck} />
      </View>
    );
  }

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
        title={t('x_bar_prep_progress_progress_dashboard')}
        subtitle={t('x_bar_prep_progress_mbe_performance_analytics')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!!error && (
          <TouchableOpacity accessibilityRole="button" testID="barprep-progress-error" onPress={load} style={[styles.heroCard, { marginBottom: 12 }]}>
            <Text style={styles.heroSub}>{error} · {t('try_again')}</Text>
          </TouchableOpacity>
        )}
        {/* ── Hero Stats ──────────────────────────────────────────── */}
        <View style={styles.heroRow}>
          {/* Overall Accuracy */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>{t('x_bar_prep_progress_overall_accuracy')}</Text>
            <Text style={[styles.heroValue, { color: getAccuracyColor(overall) }]}>
              {overall}%
            </Text>
            <Text style={styles.heroSub}>{t('x_bar_prep_progress_answered', { value: data?.total_answered || 0 })}</Text>
          </View>

          {/* Streak + Peer */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>{t('x_bar_prep_progress_streak')}</Text>
            <IconLabel icon={ICONS.fire} textStyle={[styles.heroValue, { color: colors.primary }]}>{data?.streak_days || 0}d
            </IconLabel>
            <Text style={styles.heroSub}>{t('x_bar_prep_progress_top', { value: data?.peer_percentile ?? '—' })}</Text>
          </View>
        </View>

        {/* ── Category Breakdown ──────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('x_bar_prep_progress_category_accuracy')}</Text>
        <View style={styles.categoryList}>
          {(data?.category_stats || []).map(stat => (
            <View key={stat.category} style={[styles.categoryRow, { backgroundColor: colors.card }]}>
              <Text style={styles.categoryName} numberOfLines={1}>
                {categoryLabel(stat.category)}
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
            <Text style={styles.emptyText}>{t('x_bar_prep_progress_answer_some_questions_see')}</Text>
          )}
        </View>

        {/* ── 30-Day Streak Calendar ──────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('x_bar_prep_progress_30_day_activity')}</Text>
        <View style={[styles.calendarCard, { backgroundColor: colors.card }]}>
          <View style={styles.calendarGrid}>
            {Array.from({ length: 30 }, (_, i) => {
              const d = new Date();
              d.setDate(d.getDate() - (29 - i));
              const iso = toLocalISODate(d);
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
            {t('x_bar_prep_progress_day_current_streak', { value: data?.streak_days || 0 })}
          </Text>
        </View>

        {/* ── Recent Sessions ─────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('x_bar_prep_progress_recent_sessions')}</Text>
        <View style={styles.sessionList}>
          {(data?.recent_sessions || []).slice(0, 8).map(ses => (
            <View key={ses.id} style={[styles.sessionRow, { backgroundColor: colors.card }]}>
              <View style={styles.sessionLeft}>
                <Text style={styles.sessionMode}>
                  {ses.mode === 'timed' ? `⏱ ${t('x_bar_prep_results_timed_mode')}` : `✏️ ${t('x_bar_prep_results_practice_mode')}`}
                </Text>
                <Text style={styles.sessionDate}>
                  {new Date(ses.started_at).toLocaleDateString(locale())}
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
            <Text style={styles.emptyText}>{t('x_bar_prep_progress_complete_session_see_history')}</Text>
          )}
        </View>

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <TouchableOpacity accessibilityRole="button"
          style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('BarPrepHome')}
        >
          <IconLabel icon={ICONS.play} textStyle={styles.ctaBtnText}>{t('x_bar_prep_progress_start_new_session')}</IconLabel>
        </TouchableOpacity>

        {/* Bar prep disclaimer */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center',
            paddingHorizontal: 16, paddingVertical: 8, lineHeight: 14 }}
        >
          {t('x_bar_prep_explanation_supplemental_study_only_not')}
        </Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.bg },
    center:        { justifyContent: 'center', alignItems: 'center' },
    scroll:        { flex: 1 },
    scrollContent: { paddingBottom: 40 },
    heroRow:       { flexDirection: 'row', padding: 12, gap: 8 },
    heroCard:      {
      flex: 1, padding: 12, borderRadius: RADIUS.lg,
      backgroundColor: colors.card, alignItems: 'center', ...SHADOW.sm,
    },
    heroLabel:     { fontSize: 10, color: colors.textMuted, textAlign: 'center', marginBottom: 4 },
    heroValue:     { fontSize: 22, ...FONTS.bold },
    heroSub:       { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    sectionTitle:  {
      fontSize: 13, ...FONTS.bold, color: colors.text,
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
    categoryPct:   { width: 38, fontSize: 12, ...FONTS.bold, textAlign: 'right' },
    categorySub:   { width: 36, fontSize: 10, color: colors.textMuted, textAlign: 'right' },
    calendarCard:  { marginHorizontal: 16, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.sm },
    calendarGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    calendarDot:   { width: 22, height: 22, borderRadius: 4 },
    calendarLegend: { fontSize: 12, color: colors.textMuted, marginTop: 10, textAlign: 'center' },
    sessionList:   { marginHorizontal: 12, gap: 6 },
    sessionRow:    {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: 12, borderRadius: RADIUS.md,
    },
    sessionLeft:   {},
    sessionMode:   { fontSize: 13, ...FONTS.medium, color: colors.text },
    sessionDate:   { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    sessionRight:  { alignItems: 'flex-end' },
    sessionScore:  { fontSize: 18, ...FONTS.bold },
    sessionFraction: { fontSize: 11, color: colors.textMuted },
    emptyText:     { color: colors.textMuted, fontSize: 13, textAlign: 'center', padding: 20 },
    ctaBtn:        {
      marginHorizontal: 16, marginTop: 24, paddingVertical: 15,
      borderRadius: RADIUS.lg, alignItems: 'center', ...SHADOW.sm,
    },
    ctaBtnText:    { fontSize: 16, ...FONTS.bold, color: colors.textOnAccent },
  });
}