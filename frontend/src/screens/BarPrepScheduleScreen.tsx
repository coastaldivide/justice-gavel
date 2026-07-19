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
  TextInput, RefreshControl, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { api }            from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { GradientHeader } from '../components/GradientHeader';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScheduleDay {
  date:           string;    // ISO YYYY-MM-DD
  due_count:      number;
  is_today:       boolean;
  goal_met:       boolean;
}

interface StudySchedule {
  exam_date?:          string;
  days_until_exam?:    number;
  daily_goal:          number;
  due_today:           number;
  completed_today:     number;
  recommended_categories: string[];
  calendar:            ScheduleDay[];    // 14-day window
  total_overdue:       number;
  estimated_study_mins: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  homicide: 'Homicide', theft_property: 'Theft & Property',
  defenses: 'Defenses', criminal_procedure: 'Crim Procedure',
  fifth_sixth_amendment: '5th & 6th Amendment',
  fourth_amendment: '4th Amendment', due_process: 'Due Process',
  equal_protection: 'Equal Protection', first_amendment: '1st Amendment',
  incorporation_14th: 'Incorporation / 14th',
};

function daysUntilColor(days: number): string {
  if (days <= 7)  return COLORS.bail;
  if (days <= 30) return COLORS.steelMid;
  return COLORS.legal;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function BarPrepScheduleScreen({ navigation }: ScreenProps<'BarPrepSchedule'>) {
  const { colors }             = useTheme();
  const [schedule, setSchedule] = useState<StudySchedule | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [examDate, setExamDate] = useState('');
  const [savingDate, setSavingDate] = useState(false);

  const load = useCallback(async (date?: string) => {
    try {
      const url = date ? `/bar-prep/schedule?exam_date=${date}` : '/bar-prep/schedule';
      const res = await api.get(url);
      setSchedule(res.data);
      if (res.data.exam_date && !examDate) {
        setExamDate(res.data.exam_date);
      }
    } catch {
      /* silently handle */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [examDate]);

  useEffect(() => { load(); }, []);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const saveExamDate = useCallback(async () => {
    if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      Alert.alert('Invalid Date', 'Please enter a date in YYYY-MM-DD format.');
      return;
    }
    setSavingDate(true);
    try {
      await api.put('/bar-prep/progress', { exam_date: examDate });
      await load(examDate);
      Alert.alert('Saved!', 'Exam date updated. Schedule recalculated.');
    } catch {
      Alert.alert('Error', 'Could not save exam date.');
    } finally {
      setSavingDate(false);
    }
  }, [examDate, load]);

  const styles = makeStyles(colors);

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
        title="Study Schedule"
        subtitle="Spaced Repetition Plan"
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
          <Text style={styles.examCardTitle}>📅 Bar Exam Date</Text>
          <View style={styles.examInputRow}>
            <TextInput
              style={[styles.examInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              value={examDate}
              onChangeText={setExamDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              onPress={saveExamDate}
              disabled={savingDate}
            >
              <Text style={styles.saveBtnText}>{savingDate ? '…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
          {schedule?.days_until_exam !== undefined && (
            <View style={styles.countdownRow}>
              <Text style={[styles.countdownNum, {
                color: daysUntilColor(schedule.days_until_exam),
              }]}>
                {schedule.days_until_exam}
              </Text>
              <Text style={styles.countdownLabel}> days until exam</Text>
            </View>
          )}
        </View>

        {/* ── Today's Goal ─────────────────────────────────────────── */}
        <View style={[styles.goalCard, { backgroundColor: colors.card }]}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalTitle}>Today's Goal</Text>
            <Text style={styles.goalFraction}>
              {schedule?.completed_today || 0} / {schedule?.daily_goal || 0} Q
            </Text>
          </View>
          <View style={styles.goalTrack}>
            <View style={[
              styles.goalFill,
              {
                width: `${todayProgress * 100}%` as any,
                backgroundColor: todayProgress >= 1 ? COLORS.legal : colors.primary,
              },
            ]} />
          </View>
          <View style={styles.goalMeta}>
            <Text style={styles.goalMetaText}>
              ⏱ ~{schedule?.estimated_study_mins || 0} min to complete today's goal
            </Text>
            {(schedule?.total_overdue || 0) > 0 && (
              <Text style={styles.overdueText}>
                ⚠️ {schedule!.total_overdue} overdue
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.startBtn, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('BarPrepHome')}
            activeOpacity={0.85}
          >
            <Text style={styles.startBtnText}>
              {(schedule?.completed_today || 0) >= (schedule?.daily_goal || 1)
                ? '✓ Goal Complete — Study More?'
                : `▶ Study ${(schedule?.daily_goal || 0) - (schedule?.completed_today || 0)} Remaining`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Recommended Categories ───────────────────────────────── */}
        {(schedule?.recommended_categories || []).length > 0 && (
          <>
            <Text style={styles.sectionTitle}>📌 Focus Today</Text>
            <View style={styles.recommendList}>
              {(schedule?.recommended_categories || []).map((cat, i) => (
                <View key={cat} style={[styles.recommendChip, { backgroundColor: colors.card }]}>
                  <Text style={styles.recommendRank}>{i + 1}</Text>
                  <Text style={styles.recommendName}>
                    {CATEGORY_LABELS[cat] || cat}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── 14-Day Calendar ──────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>📆 14-Day Review Calendar</Text>
        <View style={[styles.calendarCard, { backgroundColor: colors.card }]}>
          <View style={styles.calendarGrid}>
            {(schedule?.calendar || []).map(day => {
              const date  = new Date(day.date);
              const label = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
              const bg    = day.goal_met  ? COLORS.legal
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
                  <Text style={[styles.calendarLabel, day.is_today && { color: colors.primary, fontFamily: FONTS.bold }]}>
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.calendarLegendRow}>
            <LegendDot color=COLORS.legal label="Goal met" />
            <LegendDot color={colors.primary} label="Today" />
            <LegendDot color={colors.primary + '44'} label="Due" />
          </View>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: '#888' }}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:       { flex: 1, backgroundColor: colors.background },
    center:          { justifyContent: 'center', alignItems: 'center' },
    scroll:          { flex: 1 },
    scrollContent:   { paddingBottom: 40 },
    examCard:        { margin: 16, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.xs },
    examCardTitle:   { fontSize: 14, fontFamily: FONTS.bold, color: colors.text, marginBottom: 12 },
    examInputRow:    { flexDirection: 'row', gap: 10 },
    examInput:       {
      flex: 1, paddingHorizontal: 14, paddingVertical: 10,
      borderRadius: RADIUS.md, borderWidth: 1.5,
      fontSize: 14, fontFamily: FONTS.medium,
    },
    saveBtn:         {
      paddingHorizontal: 20, paddingVertical: 10,
      borderRadius: RADIUS.md, justifyContent: 'center',
    },
    saveBtnText:     { fontSize: 14, fontFamily: FONTS.bold, color: '#fff' },
    countdownRow:    { flexDirection: 'row', alignItems: 'baseline', marginTop: 14 },
    countdownNum:    { fontSize: 36, fontFamily: FONTS.bold },
    countdownLabel:  { fontSize: 15, color: colors.textMuted },
    goalCard:        { marginHorizontal: 16, marginTop: 4, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.xs },
    goalHeader:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    goalTitle:       { fontSize: 15, fontFamily: FONTS.bold, color: colors.text },
    goalFraction:    { fontSize: 15, fontFamily: FONTS.bold, color: colors.primary },
    goalTrack:       { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
    goalFill:        { height: '100%', borderRadius: 4 },
    goalMeta:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    goalMetaText:    { fontSize: 12, color: colors.textMuted },
    overdueText:     { fontSize: 12, color: COLORS.bail, fontFamily: FONTS.semibold },
    startBtn:        { paddingVertical: 13, borderRadius: RADIUS.lg, alignItems: 'center' },
    startBtnText:    { fontSize: 15, fontFamily: FONTS.bold, color: '#fff' },
    sectionTitle:    {
      fontSize: 13, fontFamily: FONTS.bold, color: colors.text,
      marginTop: 20, marginBottom: 10, marginHorizontal: 16,
    },
    recommendList:   { paddingHorizontal: 12, gap: 6 },
    recommendChip:   {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      padding: 12, borderRadius: RADIUS.md,
    },
    recommendRank:   {
      width: 24, height: 24, borderRadius: 12,
      backgroundColor: COLORS.primary, textAlign: 'center',
      fontSize: 12, fontFamily: FONTS.bold, color: '#fff',
      lineHeight: 24,
    },
    recommendName:   { fontSize: 14, color: colors.text, fontFamily: FONTS.medium },
    calendarCard:    { marginHorizontal: 16, padding: 16, borderRadius: RADIUS.lg, ...SHADOW.xs },
    calendarGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    calendarCell:    { width: 44, alignItems: 'center' },
    calendarDot:     {
      width: 36, height: 36, borderRadius: 8,
      justifyContent: 'center', alignItems: 'center',
    },
    calendarCount:   { fontSize: 11, fontFamily: FONTS.bold, color: '#fff' },
    calendarLabel:   { fontSize: 9, color: colors.textMuted, marginTop: 3, textAlign: 'center' },
    calendarLegendRow: {
      flexDirection: 'row', justifyContent: 'center', gap: 16,
      marginTop: 14,
    },
  });
}
