/**
 * BarPrepQuizScreen — MBE Question Drilling
 *
 * Two modes:
 *   practice — explanation shown immediately after each answer
 *   timed    — 100Q / 2.5hr simulation; explanations revealed at end
 *
 * Flow:
 *   question display → answer tap → (practice: inline reveal) → next
 *   → submit batch → navigate to BarPrepProgress
 */

import type { ScreenProps } from '../types/navigation';
import { EmptyState } from '../components/EmptyState';
// FIX #9: removed unused `useMemo` from import
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, BackHandler, Platform, Animated, Vibration,
} from 'react-native';
import { api }            from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useHaptics }     from '../hooks/useHaptics';
import { t, useLang } from '../i18n';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Question {
  id:         number;
  category:   string;
  difficulty: 'easy' | 'medium' | 'hard';
  stem:       string;
  option_a:   string;
  option_b:   string;
  option_c:   string;
  option_d:   string;
}

interface Answer {
  question_id:     number;
  selected_answer: string;
  time_spent_ms:   number;
  /** Set from the server's grading (practice: per answer; timed: on submit). */
  is_correct?:     boolean;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
type OptionLetter = typeof OPTION_LETTERS[number];

const DIFFICULTY_COLOR: Record<string, string> = {
  easy:   COLORS.legal,
  medium: COLORS.steelMid,
  hard:   COLORS.bail,
};

// ── Screen ────────────────────────────────────────────────────────────────────
export default function BarPrepQuizScreen({ route, navigation }: ScreenProps<'BarPrepQuiz'>) {
  useLang();
  const { session_id, questions, mode, time_limit_seconds, subject_id = null } = (route?.params ?? { questions: [] }) as {
    session_id:         number;
    subject_id?:        number | null;
    questions:          Question[];
    mode:               'practice' | 'timed';
    time_limit_seconds: number | null;
  };

  const { colors }                        = useTheme();
  const { impact }                        = useHaptics();
  const [currentIndex, setCurrentIndex]   = useState(0);
  const [answers, setAnswers]             = useState<Record<number, Answer>>({});
  const [selected, setSelected]           = useState<OptionLetter | null>(null);
  const [revealed, setRevealed]           = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [explanation, setExplanation]     = useState<string | null>(null);
  const [submitting, setSubmitting]       = useState(false);
  const [timeLeft, setTimeLeft]           = useState(time_limit_seconds);
  const questionStartMs                   = useRef(Date.now());
  const timerRef                          = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const progressAnim                      = useRef(new Animated.Value(0)).current;

  // FIX #10: store handleSubmit in a ref so the timer always calls the latest version
  const handleSubmitRef = useRef<((isTimeout?: boolean) => void) | undefined>(undefined);

  // FIX #12: in-flight guard prevents double-tap during async practice reveal
  const isSelectingRef = useRef(false);

  const total   = questions.length;
  const current = questions[currentIndex];

  // ── Confirm exit helper (FIX #11: shared by ✕ button and hardware back) ────
  const confirmExit = useCallback(() => {
    Alert.alert(t('x_bar_prep_quiz_exit_quiz'), t('x_bar_prep_quiz_progress_will_be_lost'), [
      { text: t('continue'), style: 'cancel' },
      { text: t('x_bar_prep_quiz_exit'), style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  }, [navigation]);

  // ── Countdown timer (timed mode) ──────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'timed' || !time_limit_seconds) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timerRef.current);
          // FIX #10: call via ref so we get the latest handleSubmit (not stale mount-time closure)
          handleSubmitRef.current?.(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  return () => clearInterval(timerRef.current);
  }, [mode, time_limit_seconds]);
  // mode / time limit are route params, so the timer is not restarted on answer changes.
  // handleSubmit is accessed via ref to avoid the stale-closure problem.

  // ── Back button guard ─────────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmExit();
      return true;
    });
    return () => sub.remove();
  }, [confirmExit]);

  // ── Animate progress bar ─────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue:         (currentIndex + 1) / total,
      duration:        300,
      useNativeDriver: false,
    }).start();
  }, [currentIndex, total, progressAnim]);

  // ── Select an answer ──────────────────────────────────────────────────────
  const selectAnswer = useCallback(async (letter: OptionLetter) => {
    // FIX #12: guard against double-tap (both state check and ref check)
    if (revealed || submitting || isSelectingRef.current) return;
    isSelectingRef.current = true;

    const timeSpent = Date.now() - questionStartMs.current;
    impact('medium');
    setSelected(letter);

    const ans: Answer = {
      question_id:     current.id,
      selected_answer: letter,
      time_spent_ms:   timeSpent,
    };
    setAnswers(prev => ({ ...prev, [current.id]: ans }));

    if (mode === 'practice') {
      try {
        const submitRes = await api.post(`/bar-prep/sessions/${session_id}/answers`, {
          answers: [ans],
        });
        const result = submitRes.data.results?.[0];
        if (result) {
          setAnswers(prev => ({ ...prev, [current.id]: { ...ans, is_correct: !!result.is_correct } }));
          setCorrectAnswer(result.correct_answer);
          setExplanation(result.explanation);
          result.is_correct ? impact('heavy') : Vibration.vibrate(200);
        }
      } catch {
        // Reveal without data — user still sees selected state
      }
      setRevealed(true);
    }

    isSelectingRef.current = false;
  }, [revealed, submitting, current, mode, session_id, impact]);

  // ── Move to next question ─────────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (currentIndex < total - 1) {
      impact('light');
      setCurrentIndex(i => i + 1);
      setSelected(null);
      setRevealed(false);
      setCorrectAnswer(null);
      setExplanation(null);
      questionStartMs.current = Date.now();
    } else {
      handleSubmitRef.current?.(false);
    }
  }, [currentIndex, total, impact]);

  // ── Submit all answers ────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (isTimeout = false) => {
    if (submitting) return;
    clearInterval(timerRef.current);
    setSubmitting(true);

    try {
      // Graded answers: practice answers were graded one by one as they were
      // revealed; timed answers are graded here in one batch.
      let graded: Record<number, Answer> = answers;
      if (mode === 'timed') {
        const res = await api.post(`/bar-prep/sessions/${session_id}/answers`, {
          answers: Object.values(answers),
        });
        const serverResults: { question_id: number; is_correct: boolean }[] = res.data?.results ?? [];
        graded = { ...answers };
        for (const r of serverResults) {
          if (graded[r.question_id]) graded[r.question_id] = { ...graded[r.question_id], is_correct: !!r.is_correct };
        }
      }

      // Navigate to results screen with full session context
      const totalAns  = Object.keys(graded).length;
      const correctAns = Object.values(graded).filter(a => a.is_correct).length;
      navigation.replace('BarPrepResults', {
        session_id,
        score_pct:        totalAns > 0 ? Math.round((correctAns / totalAns) * 100) : 0,
        correct:          correctAns,
        total:            totalAns || total,
        mode,
        subject_id,
        answers:          graded,     // { [question_id]: { selected_answer, is_correct, time_spent_ms } }
        questions,
        timed_out:        isTimeout,
      });
    } catch {
      setSubmitting(false);
      Alert.alert(t('error'), t('x_bar_prep_quiz_failed_submit_answers_try'));
    }
  }, [submitting, answers, mode, session_id, navigation, total, subject_id, questions]);

  // Keep ref in sync with latest callback
  handleSubmitRef.current = handleSubmit;

  const styles = makeStyles(colors);

  const formatTime = (s: number | null) => {
    if (s === null) return '';
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const isLowTime = timeLeft !== null && timeLeft < 300;

  // Opened without a quiz (e.g. deep link / stale state) — nothing to show.
  if (!current) {
    return (
      <EmptyState icon="📝" title={t('x_bar_prep_quiz_no_quiz_progress')}
        subtitle={t('x_bar_prep_quiz_start_practice_session_from')}
        action={{ label: t('x_bar_prep_quiz_go_bar_prep'), onPress: () => navigation.navigate('BarPrepHome') }} />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        
        <TouchableOpacity accessibilityRole="button" onPress={confirmExit}>
          <Text style={styles.exitBtn}>✕</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.counter}>{currentIndex + 1} / {total}</Text>
          {mode === 'timed' && (
            <Text style={[styles.timer, isLowTime && styles.timerLow]}>
              {formatTime(timeLeft)}
            </Text>
          )}
        </View>
        <View style={[
          styles.diffBadge,
          { backgroundColor: DIFFICULTY_COLOR[current.difficulty] + '22' },
        ]}>
          <Text style={[styles.diffText, { color: DIFFICULTY_COLOR[current.difficulty] }]}>
            {current.difficulty.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* ── Progress Bar ────────────────────────────────────────────── */}
      <View style={styles.progressTrack}>
        <Animated.View style={[
          styles.progressFill,
          { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) as any },
        ]} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.categoryLabel}>
          {current.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </Text>
        <Text style={styles.stem}>{current.stem}</Text>

        <View style={styles.optionsContainer}>
          {OPTION_LETTERS.map(letter => {
            const optionKey = `option_${letter.toLowerCase()}` as keyof Question;
            const text      = current[optionKey] as string;
            const isSelected = selected === letter;
            const isCorrect  = revealed && correctAnswer === letter;
            const isWrong    = revealed && isSelected && !isCorrect;

            return (
              <TouchableOpacity accessibilityRole="button"
                key={letter}
                style={[
                  styles.option,
                  isSelected && !revealed && styles.optionSelected,
                  isCorrect             && styles.optionCorrect,
                  isWrong               && styles.optionWrong,
                ]}
                onPress={() => selectAnswer(letter)}
                disabled={revealed || (mode === 'timed' && !!selected)}
                activeOpacity={0.8}
              >
                <View style={[
                  styles.optionLetter,
                  isCorrect && styles.optionLetterCorrect,
                  isWrong   && styles.optionLetterWrong,
                ]}>
                  <Text style={[
                    styles.optionLetterText,
                    (isCorrect || isWrong) && { color: colors.white },
                  ]}>{letter}</Text>
                </View>
                <Text style={[
                  styles.optionText,
                  isCorrect && styles.optionTextCorrect,
                  isWrong   && styles.optionTextWrong,
                ]}>{text}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {revealed && explanation && (
          <View style={[
            styles.explanationCard,
            selected === correctAnswer ? styles.correctCard : styles.wrongCard,
          ]}>
            <Text style={styles.explanationIcon}>
              {selected === correctAnswer ? t('x_bar_prep_quiz_correct') : t('x_bar_prep_quiz_incorrect')}
            </Text>
            <Text style={styles.explanationText}>{explanation}</Text>
            <TouchableOpacity accessibilityRole="button"
              style={styles.fullExplanationLink}
              onPress={() => navigation.navigate('BarPrepExplanation', { question_id: current.id })}
            >
              <Text style={styles.fullExplanationLinkText}>{t('x_bar_prep_quiz_view_full_explanation')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'timed' && selected && !revealed && (
          <View style={styles.timedNote}>
            <Text style={styles.timedNoteText}>{t('x_bar_prep_quiz_answer_recorded_explanations_shown')}</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Bottom Navigation ──────────────────────────────────────── */}
      <View style={styles.bottomBar}>
        {currentIndex < total - 1 ? (
          <TouchableOpacity accessibilityRole="button"
            style={[styles.nextBtn, !selected && !revealed && styles.nextBtnDisabled]}
            onPress={goNext}
            disabled={!selected && !revealed}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>{t('whn_next')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity accessibilityRole="button"
            style={[styles.submitBtn, submitting && styles.nextBtnDisabled]}
            onPress={() => handleSubmit(false)}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>{submitting ? t('x_bar_prep_quiz_submitting') : t('x_bar_prep_quiz_submit_session')}</Text>
          </TouchableOpacity>
        )}

        {/* Bar prep disclaimer */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center',
            paddingHorizontal: 16, paddingVertical: 8, lineHeight: 14 }}
        >
          {t('x_bar_prep_explanation_supplemental_study_only_not')}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:          { flex: 1, backgroundColor: colors.bg },
    header:             {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 12,
      backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    exitBtn:            { fontSize: 18, color: colors.textMuted, padding: 4 },
    headerCenter:       { alignItems: 'center' },
    counter:            { fontSize: 15, ...FONTS.semiBold, color: colors.text },
    timer:              { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    timerLow:           { color: colors.bail, ...FONTS.bold },
    diffBadge:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    diffText:           { fontSize: 11, ...FONTS.bold },
    progressTrack:      { height: 3, backgroundColor: colors.border },
    progressFill:       { height: '100%', backgroundColor: colors.primary },
    scroll:             { flex: 1 },
    scrollContent:      { padding: 20, paddingBottom: 120 },
    categoryLabel:      {
      fontSize: 11, ...FONTS.semiBold, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
    },
    stem:               { fontSize: 17, ...FONTS.medium, color: colors.text, lineHeight: 26, marginBottom: 24 },
    optionsContainer:   { gap: 10 },
    option:             {
      flexDirection: 'row', alignItems: 'flex-start', padding: 14,
      borderRadius: RADIUS.lg, borderWidth: 2, borderColor: colors.border,
      backgroundColor: colors.card, ...SHADOW.sm,
    },
    optionSelected:     { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
    optionCorrect:      { borderColor: COLORS.legal, backgroundColor: colors.legalBg },
    optionWrong:        { borderColor: COLORS.bail, backgroundColor: colors.emergencyBg },
    optionLetter:       {
      width: 28, height: 28, borderRadius: 14, borderWidth: 2,
      borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
      marginRight: 12, flexShrink: 0,
    },
    optionLetterCorrect: { backgroundColor: COLORS.legal, borderColor: COLORS.legal },
    optionLetterWrong:   { backgroundColor: COLORS.bail, borderColor: COLORS.bail },
    optionLetterText:   { fontSize: 13, ...FONTS.bold, color: colors.text },
    optionText:         { flex: 1, fontSize: 15, color: colors.text, lineHeight: 22 },
    optionTextCorrect:  { color: COLORS.legal, ...FONTS.semiBold },
    optionTextWrong:    { color: colors.bail },
    explanationCard:    { marginTop: 20, padding: 16, borderRadius: RADIUS.lg, borderLeftWidth: 4 },
    correctCard:        { backgroundColor: colors.legalBg, borderLeftColor: COLORS.legal },
    wrongCard:          { backgroundColor: colors.emergencyBg, borderLeftColor: COLORS.bail },
    explanationIcon:    { fontSize: 14, ...FONTS.bold, color: colors.text, marginBottom: 8 },
    explanationText:    { fontSize: 14, color: colors.text, lineHeight: 21 },
    fullExplanationLink: { marginTop: 12 },
    fullExplanationLinkText: { fontSize: 13, color: colors.primary, ...FONTS.semiBold },
    timedNote:          {
      marginTop: 20, padding: 12, borderRadius: RADIUS.md,
      backgroundColor: colors.border + '50', alignItems: 'center',
    },
    timedNoteText:      { fontSize: 13, color: colors.textMuted },
    bottomBar:          {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
      backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
    },
    nextBtn:            { backgroundColor: colors.primary, paddingVertical: 15, borderRadius: RADIUS.lg, alignItems: 'center', ...SHADOW.sm },
    submitBtn:          { backgroundColor: colors.legal, paddingVertical: 15, borderRadius: RADIUS.lg, alignItems: 'center', ...SHADOW.sm },
    nextBtnDisabled:    { opacity: 0.4 },
    nextBtnText:        { fontSize: 16, ...FONTS.bold, color: colors.textOnAccent },
  });
}