/**
 * BarPrepQuizScreen — MBE Question Drilling
 *
 * Two modes:
 *   practice — explanation shown immediately after each answer
 *   timed    — 100Q / 2.5hr simulation; explanations shown only at end
 *
 * Flow:
 *   question display → answer tap → (practice: inline reveal) → next
 *   → submit batch → results summary → navigate to ExplanationScreen
 */

import type { ScreenProps } from '../types/navigation';
import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, BackHandler, Platform, Animated, Vibration,
} from 'react-native';
import { api }              from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useHaptics }       from '../hooks/useHaptics';

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
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
type OptionLetter = typeof OPTION_LETTERS[number];

const DIFFICULTY_COLOR: Record<string, string> = {
  easy:   '#22c55e',
  medium: '#f59e0b',
  hard:   '#ef4444',
};

// ── Screen ────────────────────────────────────────────────────────────────────
export default function BarPrepQuizScreen({ route, navigation }: ScreenProps<'BarPrepQuiz'>) {
  const { session_id, questions, mode, time_limit_seconds } = route.params as {
    session_id:         number;
    questions:          Question[];
    mode:               'practice' | 'timed';
    time_limit_seconds: number | null;
  };

  const { colors }                        = useTheme();
  const { impact }                        = useHaptics();
  const [currentIndex, setCurrentIndex]   = useState(0);
  const [answers, setAnswers]             = useState<Record<number, Answer>>({});
  const [selected, setSelected]           = useState<OptionLetter | null>(null);
  const [revealed, setRevealed]           = useState(false);  // practice mode only
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [explanation, setExplanation]     = useState<string | null>(null);
  const [submitting, setSubmitting]       = useState(false);
  const [timeLeft, setTimeLeft]           = useState(time_limit_seconds);
  const questionStartMs                   = useRef(Date.now());
  const timerRef                          = useRef<ReturnType<typeof setInterval>>();
  const progressAnim                      = useRef(new Animated.Value(0)).current;

  const total   = questions.length;
  const current = questions[currentIndex];

  // ── Countdown timer (timed mode) ──────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'timed' || !time_limit_seconds) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timerRef.current!);
          handleSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [mode]);

  // ── Back button guard ─────────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Exit Quiz?', 'Your progress will be lost.', [
        { text: 'Continue', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => navigation.goBack() },
      ]);
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  // ── Animate progress bar ─────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue:         (currentIndex + 1) / total,
      duration:        300,
      useNativeDriver: false,
    }).start();
  }, [currentIndex, total]);

  // ── Select an answer ──────────────────────────────────────────────────────
  const selectAnswer = useCallback(async (letter: OptionLetter) => {
    if (revealed || submitting) return;
    const timeSpent = Date.now() - questionStartMs.current;
    impact('medium');
    setSelected(letter);

    // Record answer
    const ans: Answer = {
      question_id:     current.id,
      selected_answer: letter,
      time_spent_ms:   timeSpent,
    };
    setAnswers(prev => ({ ...prev, [current.id]: ans }));

    if (mode === 'practice') {
      // Fetch the reveal (correct answer + explanation)
      try {
        const res = await api.get(`/bar-prep/explain/${current.id}`);
        const expl = res.data.explanation;
        // The explanation service returns the full stored explanation
        // We also need the correct answer from the submit endpoint
        // For practice mode, submit just this one question immediately
        const submitRes = await api.post(`/bar-prep/sessions/${session_id}/answers`, {
          answers: [ans],
        });
        const result = submitRes.data.results?.[0];
        if (result) {
          setCorrectAnswer(result.correct_answer);
          setExplanation(result.explanation);
          if (result.is_correct) {
            impact('heavy');
          } else {
            Vibration.vibrate(200);
          }
        }
      } catch {
        // Fallback — just reveal without API
      }
      setRevealed(true);
    }
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
      handleSubmit(false);
    }
  }, [currentIndex, total, impact]);

  // ── Submit all answers ────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (isTimeout = false) => {
    if (submitting) return;
    clearInterval(timerRef.current!);
    setSubmitting(true);

    try {
      const batchAnswers = mode === 'timed'
        ? Object.values(answers)
        : Object.values(answers); // practice mode submits incrementally, but we still nav to results

      let results: any = null;
      if (mode === 'timed') {
        const res = await api.post(`/bar-prep/sessions/${session_id}/answers`, {
          answers: batchAnswers,
        });
        results = res.data;
      }

      navigation.replace('BarPrepResults', {
        session_id,
        mode,
        results: results || { total: batchAnswers.length, timeout: isTimeout },
      });
    } catch (e) {
      setSubmitting(false);
      Alert.alert('Error', 'Failed to submit answers. Try again.');
    }
  }, [submitting, answers, mode, session_id, navigation]);

  const styles = makeStyles(colors);

  const formatTime = (s: number | null) => {
    if (s === null) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2,'0')}`;
  };

  const isLowTime = timeLeft !== null && timeLeft < 300; // < 5 min

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => BackHandler.exitApp()}>
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
          { width: progressAnim.interpolate({
              inputRange: [0,1], outputRange: ['0%','100%']
            }) as any },
        ]} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* ── Category label ─────────────────────────────────────── */}
        <Text style={styles.categoryLabel}>
          {current.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </Text>

        {/* ── Question Stem ──────────────────────────────────────── */}
        <Text style={styles.stem}>{current.stem}</Text>

        {/* ── Answer Options ─────────────────────────────────────── */}
        <View style={styles.optionsContainer}>
          {OPTION_LETTERS.map(letter => {
            const optionKey = `option_${letter.toLowerCase()}` as keyof Question;
            const text      = current[optionKey] as string;
            const isSelected  = selected === letter;
            const isCorrect   = revealed && correctAnswer === letter;
            const isWrong     = revealed && isSelected && !isCorrect;

            return (
              <TouchableOpacity
                key={letter}
                style={[
                  styles.option,
                  isSelected && !revealed && styles.optionSelected,
                  isCorrect               && styles.optionCorrect,
                  isWrong                 && styles.optionWrong,
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
                    (isCorrect || isWrong) && { color: '#fff' },
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

        {/* ── Practice Mode Explanation ──────────────────────────── */}
        {revealed && explanation && (
          <View style={[
            styles.explanationCard,
            selected === correctAnswer ? styles.correctCard : styles.wrongCard,
          ]}>
            <Text style={styles.explanationIcon}>
              {selected === correctAnswer ? '✅ Correct' : '❌ Incorrect'}
            </Text>
            <Text style={styles.explanationText}>{explanation}</Text>
            <TouchableOpacity
              style={styles.fullExplanationLink}
              onPress={() => navigation.navigate('BarPrepExplanation', {
                question_id: current.id,
              })}
            >
              <Text style={styles.fullExplanationLinkText}>View Full Explanation →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Timed mode: show Next/Submit without reveal ─────────── */}
        {mode === 'timed' && selected && !revealed && (
          <View style={styles.timedNote}>
            <Text style={styles.timedNoteText}>Answer recorded. Explanations shown after submission.</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Bottom Navigation ──────────────────────────────────────── */}
      <View style={styles.bottomBar}>
        {currentIndex < total - 1 ? (
          <TouchableOpacity
            style={[
              styles.nextBtn,
              (!selected && !revealed) && styles.nextBtnDisabled,
            ]}
            onPress={goNext}
            disabled={!selected && !revealed}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>Next →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.nextBtnDisabled]}
            onPress={() => handleSubmit(false)}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>
              {submitting ? 'Submitting…' : '✓ Submit Session'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.background },
    header:        {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 12,
      backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    exitBtn:       { fontSize: 18, color: colors.textMuted, padding: 4 },
    headerCenter:  { alignItems: 'center' },
    counter:       { fontSize: 15, fontFamily: FONTS.semibold, color: colors.text },
    timer:         { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    timerLow:      { color: '#ef4444', fontFamily: FONTS.bold },
    diffBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    diffText:      { fontSize: 11, fontFamily: FONTS.bold },
    progressTrack: { height: 3, backgroundColor: colors.border },
    progressFill:  { height: '100%', backgroundColor: colors.primary },
    scroll:        { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: 120 },
    categoryLabel: {
      fontSize: 11, fontFamily: FONTS.semibold, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
    },
    stem: {
      fontSize: 17, fontFamily: FONTS.medium, color: colors.text,
      lineHeight: 26, marginBottom: 24,
    },
    optionsContainer: { gap: 10 },
    option: {
      flexDirection: 'row', alignItems: 'flex-start', padding: 14,
      borderRadius: RADIUS.lg, borderWidth: 2, borderColor: colors.border,
      backgroundColor: colors.card, ...SHADOW.xs,
    },
    optionSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
    optionCorrect:  { borderColor: '#22c55e', backgroundColor: '#22c55e18' },
    optionWrong:    { borderColor: '#ef4444', backgroundColor: '#ef444418' },
    optionLetter: {
      width: 28, height: 28, borderRadius: 14, borderWidth: 2,
      borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
      marginRight: 12, flexShrink: 0,
    },
    optionLetterCorrect: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
    optionLetterWrong:   { backgroundColor: '#ef4444', borderColor: '#ef4444' },
    optionLetterText:  { fontSize: 13, fontFamily: FONTS.bold, color: colors.text },
    optionText:        { flex: 1, fontSize: 15, color: colors.text, lineHeight: 22 },
    optionTextCorrect: { color: '#22c55e', fontFamily: FONTS.semibold },
    optionTextWrong:   { color: '#ef4444' },
    explanationCard: {
      marginTop: 20, padding: 16, borderRadius: RADIUS.lg,
      borderLeftWidth: 4,
    },
    correctCard: { backgroundColor: '#22c55e12', borderLeftColor: '#22c55e' },
    wrongCard:   { backgroundColor: '#ef444412', borderLeftColor: '#ef4444' },
    explanationIcon: { fontSize: 14, fontFamily: FONTS.bold, color: colors.text, marginBottom: 8 },
    explanationText: { fontSize: 14, color: colors.text, lineHeight: 21 },
    fullExplanationLink: { marginTop: 12 },
    fullExplanationLinkText: { fontSize: 13, color: colors.primary, fontFamily: FONTS.semibold },
    timedNote: {
      marginTop: 20, padding: 12, borderRadius: RADIUS.md,
      backgroundColor: colors.border + '50', alignItems: 'center',
    },
    timedNoteText: { fontSize: 13, color: colors.textMuted },
    bottomBar: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
      backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border,
    },
    nextBtn: {
      backgroundColor: colors.primary, paddingVertical: 15,
      borderRadius: RADIUS.lg, alignItems: 'center', ...SHADOW.sm,
    },
    submitBtn: {
      backgroundColor: '#22c55e', paddingVertical: 15,
      borderRadius: RADIUS.lg, alignItems: 'center', ...SHADOW.sm,
    },
    nextBtnDisabled: { opacity: 0.4 },
    nextBtnText:     { fontSize: 16, fontFamily: FONTS.bold, color: '#fff' },
  });
}
