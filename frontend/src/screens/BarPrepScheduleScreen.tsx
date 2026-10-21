/**
 * BarPrepScheduleScreen — Personalized Study Schedule
 *
 * Combines:
 *   • Exam countdown clock
 *   • Daily study goal (SM-2 driven)
 *   • Questions due today per category
 *   • 14-day calendar heatmap of due dates
 *   • Recommended focus areas
 */

import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { validCourtDate } from '../utils/dateUtils';
import { categoryLabel } from '../constants/barPrepCategories';
import { FONTS, RADIUS, SHADOW, useTheme, themeColors } from '../constants/theme';
import { GradientHeader } from '../components/GradientHeader';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScheduleDay {
  date:           string;    // ISO YYYY-MM-DD
  due_count:      number;
  is_today:       boolean;
  goal_met:       boolean;
}

/** GET /bar-prep/schedule (services/barPrepAnalytics.js getStudySchedule), days in the person's zone */
interface StudySchedule {
  exam_date?:          string | null;
  days_until_exam?:    number | null;
  daily_goal:          number;
  due_today:           number;
  completed_today:     number;
  recommended_categories: string[];
  calendar:            ScheduleDay[];    // 14-day window
  total_overdue:       number;
  estimated_study_mins: number;
}



function daysUntilColor(days: number): string {
  if (days <= 7)  return themeColors().bail;
  if (days <= 30) return themeColors().steelMid;
  return themeColors().legal;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function BarPrepScheduleScreen({ navigation }: ScreenProps<'BarPrepSchedule'>) {
  useLang();
  const { colors }             = useTheme();
  const [schedule, setSchedule] = useState<StudySchedule | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [examDate, setExamDate] = useState('');
  const [savingDate, setSavingDate] = useState(false);

  const { showToast } = useToast();
  const load = useCallback(async () => {
    try {
      const res = await api.get('/bar-prep/schedule');
      setSchedule(res.data);
      if (res.data.exam_date) {
        // Keep whatever the user has typed; only fill an empty field.
        setExamDate(prev => prev || res.data.exam_date);
      }
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_bar_prep_home_could_not_load_bar')), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  const { hasSession, recheck } = useHasSession();
  useEffect(() => { if (hasSession) load(); else if (hasSession === false) setLoading(false); }, [hasSession, load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const saveExamDate = useCallback(async () => {
    const day = examDate.trim();
    if (!validCourtDate(day)) {
      showToast(`${t('x_bar_prep_schedule_invalid_date')} ${t('x_bar_prep_schedule_please_enter_date_yyyy')}`, 'error');
      return;
    }
    setSavingDate(true);
    try {
      await api.put('/bar-prep/progress', { exam_date: day });
      await load();
      showToast(t('x_bar_prep_schedule_exam_date_updated_schedule'), 'success');
    } catch (e) {
      showToast(apiErrorMessage(e, t('x_bar_prep_schedule_could_not_save_exam')), 'error');
    } finally {
      setSavingDate(false);
    }
  }, [examDate, load, showToast]);

  const styles = makeStyles(colors);

  if (hasSession === false) {
    return (
      <View style={styles.container}>
        <GradientHeader title={t('x_bar_prep_schedule_study_schedule')} onBack={() => navigation.goBack()} />
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

  const todayProgress = schedule
    ? Math.min(1, schedule.completed_today / Math.max(1, schedule.daily_goal))
    : 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <GradientHeader
        title={t('x_bar_prep_schedule_study_schedule')}
        subtitle={t('x_bar_prep_schedule_spaced_repetition_plan')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Exam Date ────────────────────────────────────────────── */}
        <View style={[styles.examCard, { backgroundColor: colors.card }]}>
          <IconLabel icon={ICONS.calendar} textStyle={styles.examCardTitle}>{t('x_bar_prep_schedule_bar_exam_date')}</IconLabel>
          <View style={styles.examInputRow}>
            <TextInput
              style={[styles.examInput, { backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }]}
              value={examDate}
              onChangeText={setExamDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
            <TouchableOpacity accessibilityRole="button"
              style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              onPress={saveExamDate}
              disabled={savingDate}
            >
              <Text style={styles.saveBtnText}>{savingDate ? '…' : t('case_save')}</Text>
            </TouchableOpacity>
          </View>
          {typeof schedule?.days_until_exam === 'number' && (
            <View style={styles.countdownRow}>
              <Text style={[styles.countdownNum, {
                color: daysUntilColor(schedule.days_until_exam),
              }]}>
                {schedule.days_until_exam}
              </Text>
              <Text style={styles.countdownLabel}>{' '}{t('x_bar_prep_schedule_days_until_exam')}</Text>
            </View>
          )}
        </View>

        {/* ── Today's Goal ─────────────────────────────────────────── */}
        <View style={[styles.goalCard, { backgroundColor: colors.card }]}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalTitle}>{t('x_bar_prep_schedule_today_s_goal')}</Text>
            <Text style={styles.goalFraction}>
              {schedule?.completed_today || 0} / {schedule?.daily_goal || 0} Q
            </Text>
          </View>
          <View style={styles.goalTrack}>
            <View style={[
              styles.goalFill,
              {
                width: `${todayProgress * 100}%` as any,
                backgroundColor: todayProgress >= 1 ? colors.legal : colors.primary,
              },
            ]} />
          </View>
          <View style={styles.goalMeta}>
            <IconLabel icon={ICONS.clock} textStyle={styles.goalMetaText}>{t('x_bar_prep_schedule_min_complete_today_s', { value: schedule?.estimated_study_mins || 0 })}</IconLabel>
            {(schedule?.total_overdue || 0) > 0 && (
              <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.overdueText}>{t('x_bar_prep_schedule_overdue', { total_overdue: schedule?.total_overdue })}</IconLabel>
            )}
          </View>

          <TouchableOpacity accessibilityRole="button"
            style={[styles.startBtn, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('BarPrepHome')}
            activeOpacity={0.85}
          >
            <IconLabel icon={ICONS.play} textStyle={styles.startBtnText}>{(schedule?.completed_today || 0) >= (schedule?.daily_goal || 1)
                ? t('x_bar_prep_schedule_goal_complete_study_more')
                : t('x_bar_prep_schedule_study_remaining', { value: (schedule?.daily_goal || 0) - (schedule?.completed_today || 0) })}</IconLabel>
          </TouchableOpacity>
        </View>

        {/* ── Recommended Categories ───────────────────────────────── */}
        {(schedule?.recommended_categories || []).length > 0 && (
          <>
            <IconLabel icon={ICONS.pin} textStyle={styles.sectionTitle}>{t('x_bar_prep_schedule_focus_today')}</IconLabel>
            <View style={styles.recommendList}>
              {(schedule?.recommended_categories || []).map((cat, i) => (
                <View key={cat} style={[styles.recommendChip, { backgroundColor: colors.card }]}>
                  <Text style={styles.recommendRank}>{i + 1}</Text>
                  <Text style={styles.recommendName}>
                    {categoryLabel(cat)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── 14-Day Calendar ──────────────────────────────────────── */}
        <IconLabel icon={ICONS.calendar} textStyle={styles.sectionTitle}>{t('x_bar_prep_schedule_14_day_review_calendar')}</IconLabel>
        <View style={[styles.calendarCard, { backgroundColor: colors.card }]}>
          <View style={styles.calendarGrid}>
            {(schedule?.calendar || []).map(day => {
              // A calendar day (no time, no zone): noon UTC names the same day everywhere.
              const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
              const bg    = day.goal_met  ? colors.legal
                          : day.is_today  ? colors.primary
                          : day.due_count > 0 ? colors.primary + '44'
                          : colors.border;

              return (
                <View key={day.date} style={styles.calendarCell}>
                  <View style={[styles.calendarDot, { backgroundColor: bg }]}>
                    {day.due_count > 0 && (
                      <Text style={styles.calendarCount}>
                        {day.due_count > 9 ? '9+' : day.due_count}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.calendarLabel, (day as any).is_today && { color: colors.textBrand, ...FONTS.bold }]}>
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.calendarLegendRow}>
            <LegendDot color={colors.legal} label={t('x_bar_prep_schedule_goal_met')} />
            <LegendDot color={colors.primary} label={t('x_attorney_inbox_today')} />
            <LegendDot color={colors.primary + '44'} label={t('x_bar_prep_schedule_due')} />
          </View>
        </View>

        <View style={{ height: 30 }} />
        <Text maxFontSizeMultiplier={1.2} testID="bar-prep-disclaimer"
          style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 12, lineHeight: 16 }}>
          {t('x_bar_prep_explanation_supplemental_study_only_not')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  useLang();
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:       { flex: 1, backgroundColor: colors.bg },
    center:          { justifyContent: 'center', alignItems: 'center' },
    scroll:          { flex: 1 },
    scrollContent:   { paddingBottom: 40 },
    examCard:        { margin: 16, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.sm },
    examCardTitle:   { fontSize: 14, ...FONTS.bold, color: colors.text, marginBottom: 12 },
    examInputRow:    { flexDirection: 'row', gap: 10 },
    examInput:       {
      flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10,
      borderRadius: RADIUS.md, borderWidth: 1.5,
      fontSize: 14, ...FONTS.medium,
    },
    saveBtn:         {
      paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, flexShrink: 0,
      borderRadius: RADIUS.md, justifyContent: 'center',
    },
    saveBtnText:     { fontSize: 14, ...FONTS.bold, color: colors.textOnAccent },
    countdownRow:    { flexDirection: 'row', alignItems: 'baseline', marginTop: 14 },
    countdownNum:    { fontSize: 36, ...FONTS.bold },
    countdownLabel:  { fontSize: 15, color: colors.textMuted },
    goalCard:        { marginHorizontal: 16, marginTop: 4, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.sm },
    goalHeader:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    goalTitle:       { fontSize: 15, ...FONTS.bold, color: colors.text },
    goalFraction:    { fontSize: 15, ...FONTS.bold, color: colors.textBrand },
    goalTrack:       { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
    goalFill:        { height: '100%', borderRadius: 4 },
    goalMeta:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    goalMetaText:    { fontSize: 12, color: colors.textMuted },
    overdueText:     { fontSize: 12, color: colors.bail, ...FONTS.semiBold },
    startBtn:        { paddingVertical: 13, borderRadius: RADIUS.lg, alignItems: 'center' },
    startBtnText:    { fontSize: 15, ...FONTS.bold, color: colors.textOnAccent },
    sectionTitle:    {
      fontSize: 13, ...FONTS.bold, color: colors.text,
      marginTop: 20, marginBottom: 10, marginHorizontal: 16,
    },
    recommendList:   { paddingHorizontal: 12, gap: 6 },
    recommendChip:   {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      padding: 12, borderRadius: RADIUS.md,
    },
    recommendRank:   {
      width: 24, height: 24, borderRadius: 12,
      backgroundColor: colors.primary, textAlign: 'center',
      fontSize: 12, ...FONTS.bold, color: colors.textOnAccent,
      lineHeight: 24,
    },
    recommendName:   { fontSize: 14, color: colors.text, ...FONTS.medium },
    calendarCard:    { marginHorizontal: 16, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.sm },
    calendarGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    calendarCell:    { width: 44, alignItems: 'center' },
    calendarDot:     {
      width: 36, height: 36, borderRadius: 8,
      justifyContent: 'center', alignItems: 'center',
    },
    calendarCount:   { fontSize: 11, ...FONTS.bold, color: colors.white },
    calendarLabel:   { fontSize: 9, color: colors.textMuted, marginTop: 3, textAlign: 'center' },
    calendarLegendRow: {
      flexDirection: 'row', justifyContent: 'center', gap: 16,
      marginTop: 14,
    },
  });
}