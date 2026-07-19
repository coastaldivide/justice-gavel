/**
 * BarPrepResultsScreen — shown immediately after every quiz session.
 *
 * Displays: score ring, pass/fail verdict, per-question answer review
 * (correct vs. wrong with the right answer shown), and two CTAs:
 *   • Review Mistakes → launches a targeted practice session on wrong Qs
 *   • See Progress    → goes to BarPrepProgress dashboard
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/NavigationTypes';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'BarPrepResults'>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ScoreRing({ pct }: { pct: number }) {
  const passing = pct >= 65;
  const color   = pct >= 80 ? COLORS.legal : pct >= 65 ? COLORS.steel : COLORS.bail;
  const verdict = pct >= 75 ? 'Excellent' : pct >= 65 ? 'Passing' : 'Keep Studying';
  return (
    <View style={styles.ringWrapper} accessibilityRole="none">
      <View style={[styles.ring, { borderColor: color }]}>
        <Text style={[styles.ringPct, { color }]} accessibilityLabel={`Score ${pct} percent`}>
          {pct}%
        </Text>
        <Text style={styles.ringLabel}>{verdict}</Text>
      </View>
      {passing
        ? <Text style={[styles.passBadge, { color: COLORS.legal }]}>✓ Bar-passing territory</Text>
        : <Text style={[styles.passBadge, { color: COLORS.bail }]}>Review and retry</Text>}
    </View>
  );
}

function AnswerRow({
  q, userAnswer, isCorrect, index,
}: {
  q: any;
  userAnswer: string | undefined;
  isCorrect: boolean;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const correctLetter = q.correct_answer?.toUpperCase();
  const correctText   = q[`option_${q.correct_answer?.toLowerCase()}`] ?? correctLetter;
  const userText      = userAnswer
    ? (q[`option_${userAnswer.toLowerCase()}`] ?? userAnswer.toUpperCase())
    : 'No answer';

  return (
    <TouchableOpacity
      style={[styles.ansRow, isCorrect ? styles.ansCorrect : styles.ansWrong]}
      onPress={() => setExpanded(v => !v)}
      accessibilityRole="button"
      accessibilityLabel={`Question ${index + 1}: ${isCorrect ? 'correct' : 'incorrect'}. Tap to ${expanded ? 'collapse' : 'expand'}.`}
    >
      <View style={styles.ansHeader}>
        <Text style={styles.ansIcon}>{isCorrect ? '✓' : '✗'}</Text>
        <Text style={styles.ansNum}>Q{index + 1}</Text>
        <Text style={styles.ansStem} numberOfLines={expanded ? 0 : 2}>
          {q.stem ?? q.question_text ?? ''}
        </Text>
        <Text style={styles.ansChevron}>{expanded ? '▲' : '▼'}</Text>
      </View>

      {expanded && (
        <View style={styles.ansDetail}>
          {!isCorrect && (
            <View style={styles.ansLine}>
              <Text style={[styles.ansLineLabel, { color: COLORS.bail }]}>Your answer: </Text>
              <Text style={[styles.ansLineVal, { color: COLORS.bail }]}>{userText}</Text>
            </View>
          )}
          <View style={styles.ansLine}>
            <Text style={[styles.ansLineLabel, { color: COLORS.legal }]}>Correct answer: </Text>
            <Text style={[styles.ansLineVal, { color: COLORS.legal }]}>{correctText}</Text>
          </View>
          {q.rule_tested ? (
            <Text style={styles.ansRule}>Rule: {q.rule_tested}</Text>
          ) : null}
          <TouchableOpacity
            style={styles.explainBtn}
            onPress={() => {/* parent will handle */}}
            accessibilityRole="button"
            accessibilityLabel="View full explanation"
          >
            <Text style={styles.explainBtnText}>📖 Full Explanation</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function BarPrepResultsScreen({ route, navigation }: Props) {
  const {
    session_id, score_pct, correct, total, mode,
    subject_id, answers, questions, timed_out,
  } = route.params;

  // Build a quick-lookup: question_id → answer data
  const answerMap = useMemo(() => {
    const map: Record<string, { answer: string; is_correct: boolean }> = {};
    Object.entries(answers ?? {}).forEach(([qid, a]: [string, any]) => {
      map[qid] = a;
    });
    return map;
  }, [answers]);

  const wrongQuestions = useMemo(
    () => (questions ?? []).filter((q: any) => !answerMap[q.id]?.is_correct),
    [questions, answerMap],
  );

  const handleRetryWrong = () => {
    if (wrongQuestions.length === 0) return;
    // Re-launch the quiz with only wrong questions as a practice session
    (navigation as any).replace('BarPrepQuiz', {
      session_id: 0,   // new session created server-side on first answer
      questions: wrongQuestions,
      mode: 'practice',
      time_limit_seconds: null,
    });
  };

  const handleViewProgress = () => {
    navigation.replace('BarPrepProgress');
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      accessibilityLabel="Bar exam prep results"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {timed_out ? '⏱ Time's Up' : '✓ Session Complete'}
        </Text>
        <Text style={styles.subtitle}>
          {mode === 'timed' ? 'Timed Mode' : 'Practice Mode'} · {total} questions
        </Text>
      </View>

      {/* ── Score ring ────────────────────────────────────────────────────── */}
      <ScoreRing pct={score_pct} />

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: COLORS.legal }]}>{correct}</Text>
          <Text style={styles.statLabel}>Correct</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: COLORS.bail }]}>{total - correct}</Text>
          <Text style={styles.statLabel}>Wrong</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: COLORS.steel }]}>{total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>

      {/* ── CTAs ──────────────────────────────────────────────────────────── */}
      <View style={styles.ctaRow}>
        {wrongQuestions.length > 0 && (
          <TouchableOpacity
            style={[styles.ctaBtn, styles.ctaPrimary]}
            onPress={handleRetryWrong}
            accessibilityRole="button"
            accessibilityLabel={`Retry ${wrongQuestions.length} wrong questions`}
          >
            <Text style={styles.ctaBtnTextPrimary}>
              🔁 Retry {wrongQuestions.length} Wrong
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.ctaBtn, styles.ctaSecondary]}
          onPress={handleViewProgress}
          accessibilityRole="button"
          accessibilityLabel="View progress dashboard"
        >
          <Text style={styles.ctaBtnTextSecondary}>📈 View Progress</Text>
        </TouchableOpacity>
      </View>

      {/* ── Answer review ─────────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Answer Review</Text>
      <Text style={styles.sectionHint}>Tap any question to see the correct answer</Text>
      {(questions ?? []).map((q: any, i: number) => {
        const ans = answerMap[q.id];
        return (
          <AnswerRow
            key={q.id}
            q={q}
            index={i}
            userAnswer={ans?.answer}
            isCorrect={!!ans?.is_correct}
          />
        );
      })}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.bgDark ?? '#020E1C' },
  content: { padding: SPACING?.lg ?? 20 },

  header:   { alignItems: 'center', marginBottom: 24 },
  title:    { fontFamily: FONTS?.bold ?? 'System', fontSize: 22, color: COLORS.surface, marginBottom: 4 },
  subtitle: { fontFamily: FONTS?.body ?? 'System', fontSize: 13, color: COLORS.steel },

  // Score ring
  ringWrapper: { alignItems: 'center', marginBottom: 24 },
  ring: {
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 6, justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 6 } }),
  },
  ringPct:    { fontFamily: FONTS?.bold ?? 'System', fontSize: 38, fontVariant: ['tabular-nums'] },
  ringLabel:  { fontFamily: FONTS?.body ?? 'System', fontSize: 13, color: COLORS.steel, marginTop: 2 },
  passBadge:  { fontFamily: FONTS?.bold ?? 'System', fontSize: 14, marginTop: 12 },

  // Stats row
  statsRow:    { flexDirection: 'row', backgroundColor: COLORS.bgCard, borderRadius: RADIUS?.md ?? 12, marginBottom: 20, padding: 16 },
  statBox:     { flex: 1, alignItems: 'center' },
  statNum:     { fontFamily: FONTS?.bold ?? 'System', fontSize: 28, fontVariant: ['tabular-nums'] },
  statLabel:   { fontFamily: FONTS?.body ?? 'System', fontSize: 12, color: COLORS.steel, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(133,183,235,0.15)', marginVertical: 4 },

  // CTAs
  ctaRow:               { flexDirection: 'column', gap: 10, marginBottom: 28 },
  ctaBtn:               { borderRadius: RADIUS?.md ?? 12, paddingVertical: 14, alignItems: 'center' },
  ctaPrimary:           { backgroundColor: COLORS.legal },
  ctaSecondary:         { backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.steel },
  ctaBtnTextPrimary:    { fontFamily: FONTS?.bold ?? 'System', fontSize: 15, color: '#fff' },
  ctaBtnTextSecondary:  { fontFamily: FONTS?.bold ?? 'System', fontSize: 15, color: COLORS.steel },

  // Section label
  sectionLabel: { fontFamily: FONTS?.bold ?? 'System', fontSize: 16, color: COLORS.surface, marginBottom: 4 },
  sectionHint:  { fontFamily: FONTS?.body ?? 'System', fontSize: 12, color: COLORS.steel, marginBottom: 12 },

  // Answer rows
  ansRow:     { borderRadius: RADIUS?.md ?? 10, marginBottom: 8, overflow: 'hidden' },
  ansCorrect: { backgroundColor: COLORS.legalBg ?? '#0D2010', borderLeftWidth: 3, borderLeftColor: COLORS.legal },
  ansWrong:   { backgroundColor: COLORS.bailBg  ?? '#2C1500', borderLeftWidth: 3, borderLeftColor: COLORS.bail },

  ansHeader:  { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 8 },
  ansIcon:    { fontFamily: FONTS?.bold ?? 'System', fontSize: 16, width: 20, textAlign: 'center', color: COLORS.surface, marginTop: 1 },
  ansNum:     { fontFamily: FONTS?.bold ?? 'System', fontSize: 13, color: COLORS.steel, width: 30 },
  ansStem:    { flex: 1, fontFamily: FONTS?.body ?? 'System', fontSize: 13, color: COLORS.surface, lineHeight: 18 },
  ansChevron: { fontFamily: FONTS?.body ?? 'System', fontSize: 11, color: COLORS.steel, marginTop: 2 },

  ansDetail:     { paddingHorizontal: 12, paddingBottom: 12 },
  ansLine:       { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  ansLineLabel:  { fontFamily: FONTS?.bold ?? 'System', fontSize: 13 },
  ansLineVal:    { fontFamily: FONTS?.body ?? 'System', fontSize: 13, flex: 1 },
  ansRule:       { fontFamily: FONTS?.italic ?? 'System', fontSize: 12, color: COLORS.steel, marginTop: 6, fontStyle: 'italic' },
  explainBtn:    { marginTop: 8, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(133,183,235,0.12)', borderRadius: 8, alignSelf: 'flex-start' },
  explainBtnText:{ fontFamily: FONTS?.bold ?? 'System', fontSize: 13, color: COLORS.steel },
});
