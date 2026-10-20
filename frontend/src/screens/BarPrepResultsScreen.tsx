/**
 * BarPrepResultsScreen — shown immediately after every quiz session.
 *
 * Displays: score ring, pass/fail verdict, per-question answer review
 * (correct vs. wrong with the right answer shown), and two CTAs:
 *   • Review Mistakes → launches a targeted practice session on wrong Qs
 *   • See Progress    → goes to BarPrepProgress dashboard
 */
import React, { useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { ScreenParams } from '../navigation/NavigationTypes';
import { ScreenProps } from '../types/navigation';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';

type Props = ScreenProps<'BarPrepResults'>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ScoreRing({ pct }: { pct: number }) {
  useLang();
  const { colors } = useTheme();
  const passing = pct >= 65;
  const color   = pct >= 80 ? COLORS.legal : pct >= 65 ? COLORS.steel : COLORS.bail;
  const verdict = pct >= 75 ? t('x_bar_prep_results_excellent') : pct >= 65 ? t('x_bar_prep_results_passing') : t('x_bar_prep_results_keep_studying');
  return (
    <View style={styles.ringWrapper} accessibilityRole="none">
      <View style={[styles.ring, { borderColor: color }]}>
        <Text testID="barprep-score" style={[styles.ringPct, { color }]} accessibilityLabel={t('x_bar_prep_results_score_percent', { pct })}>
          {pct}%
        </Text>
        <Text style={styles.ringLabel}>{verdict}</Text>
      </View>
      {passing
        ? <Text style={[styles.passBadge, { color: colors.legal }]}>{t('x_bar_prep_results_bar_passing_territory')}</Text>
        : <Text style={[styles.passBadge, { color: colors.bail }]}>{t('x_bar_prep_results_review_retry')}</Text>}
    </View>
  );
}

function AnswerRow({
  q, userAnswer, isCorrect, index, onExplain,
}: {
  q: any;
  userAnswer: string | undefined;
  isCorrect: boolean;
  index: number;
  onExplain: () => void;
}) {
  useLang();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const correctLetter = q.correct_answer?.toUpperCase();
  const correctText   = q[`option_${q.correct_answer?.toLowerCase()}`] ?? correctLetter;
  const userText      = userAnswer
    ? (q[`option_${userAnswer.toLowerCase()}`] ?? userAnswer.toUpperCase())
    : t('x_bar_prep_results_no_answer');

  return (
    <TouchableOpacity
      style={[styles.ansRow, isCorrect ? styles.ansCorrect : styles.ansWrong]}
      onPress={() => setExpanded(v => !v)}
      accessibilityRole="button"
      accessibilityLabel={t('x_bar_prep_results_question_tap', { value: index + 1, value2: isCorrect ? t('x_bar_prep_results_correct') : t('x_bar_prep_results_wrong'), })}
      accessibilityState={{ expanded }}
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
              <Text style={[styles.ansLineLabel, { color: COLORS.bail }]}>{t('x_bar_prep_results_answer')}{' '}</Text>
              <Text style={[styles.ansLineVal, { color: COLORS.bail }]}>{userText}</Text>
            </View>
          )}
          <View style={styles.ansLine}>
            <Text style={[styles.ansLineLabel, { color: COLORS.legal }]}>{t('x_bar_prep_results_correct_answer')}{' '}</Text>
            <Text style={[styles.ansLineVal, { color: COLORS.legal }]}>{correctText}</Text>
          </View>
          {q.rule_tested ? (
            <Text style={styles.ansRule}>{t('x_bar_prep_results_rule', { rule_tested: q.rule_tested })}</Text>
          ) : null}
          <TouchableOpacity
            style={styles.explainBtn}
            onPress={onExplain}
            accessibilityRole="button"
            accessibilityLabel={t('x_bar_prep_results_view_full_explanation')}
          >
            <Text style={styles.explainBtnText}>{t('x_bar_prep_results_full_explanation')}</Text>
          </TouchableOpacity>
        
        {/* Supplemental study disclaimer */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center',
            paddingHorizontal: 16, paddingVertical: 8, lineHeight: 14 }}
        >
          {t('x_bar_prep_results_supplemental_study_only_not')}
        </Text>
      </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function BarPrepResultsScreen({ route, navigation }: Props) {
  useLang();
  const {
    score_pct, correct, total, mode,
    answers, questions, timed_out,
  } = (route.params ?? {}) as ScreenParams<'BarPrepResults'>;

  const { showToast } = useToast();
  const [retrying, setRetrying] = useState(false);
  // question_id → the graded answer (selected_answer, is_correct, correct_answer, rule_tested)
  const answerMap = useMemo(() => {
    const map: Record<string, { selected_answer?: string; is_correct?: boolean; correct_answer?: string; rule_tested?: string | null }> = {};
    Object.entries(answers ?? {}).forEach(([qid, a]: [string, any]) => { map[qid] = a; });
    return map;
  }, [answers]);

  // Missed or unanswered questions
  const wrongQuestions = useMemo(
    () => (questions ?? []).filter((q: any) => !answerMap[q.id]?.is_correct),
    [questions, answerMap],
  );

  const handleRetryWrong = async () => {
    if (wrongQuestions.length === 0 || retrying) return;
    setRetrying(true);
    try {
      // A new practice session with exactly these questions.
      const res = await api.post('/bar-prep/sessions', { mode: 'practice', question_ids: wrongQuestions.map((q: any) => q.id) });
      navigation.replace('BarPrepQuiz', {
        session_id: res.data.session_id,
        questions: res.data.questions,
        mode: 'practice',
        time_limit_seconds: null,
      });
    } catch (e) {
      setRetrying(false);
      const status = (e as { response?: { status?: number } })?.response?.status;
      showToast(apiErrorMessage(e, t('x_bar_prep_home_could_not_start_session')), status === 402 ? 'info' : 'error');
      // the free sample is used up: show the plans
      if (status === 402) navigation.navigate('ConsumerSubscription');
    }
  };

  const handleViewProgress = () => {
    navigation.replace('BarPrepProgress');
  };

  if (!route.params) {
    return (
      <EmptyState icon="📊" title={t('x_bar_prep_results_no_results_show')}
        subtitle={t('x_bar_prep_results_finish_bar_prep_quiz')}
        action={{ label: t('x_bar_prep_results_view_progress'), onPress: handleViewProgress }} />
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      accessibilityLabel={t('x_bar_prep_results_bar_exam_prep_results')}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {timed_out ? t('x_bar_prep_results_time_s_up') : t('x_bar_prep_results_session_complete')}
        </Text>
        <Text style={styles.subtitle}>
          {t('x_bar_prep_results_questions', { value: mode === 'timed' ? t('x_bar_prep_results_timed_mode') : t('x_bar_prep_results_practice_mode'), total })}
        </Text>
      </View>

      {/* ── Score ring ────────────────────────────────────────────────────── */}
      <ScoreRing pct={score_pct} />

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: COLORS.legal }]}>{correct}</Text>
          <Text style={styles.statLabel}>{t('x_bar_prep_results_correct')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: COLORS.bail }]}>{total - correct}</Text>
          <Text style={styles.statLabel}>{t('x_bar_prep_results_wrong')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: COLORS.info }]}>{total}</Text>
          <Text style={styles.statLabel}>{t('qc_total')}</Text>
        </View>
      </View>

      {/* ── CTAs ──────────────────────────────────────────────────────────── */}
      <View style={styles.ctaRow}>
        {wrongQuestions.length > 0 && (
          <TouchableOpacity
            style={[styles.ctaBtn, styles.ctaPrimary]}
            testID="barprep-retry-wrong"
            onPress={handleRetryWrong}
            accessibilityRole="button"
            accessibilityLabel={t('x_bar_prep_results_retry_wrong_questions', { length: wrongQuestions.length })}
          >
            <Text style={styles.ctaBtnTextPrimary}>
              {t('x_bar_prep_results_retry_wrong', { length: wrongQuestions.length })}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.ctaBtn, styles.ctaSecondary]}
          onPress={handleViewProgress}
          accessibilityRole="button"
          accessibilityLabel={t('x_bar_prep_results_view_progress_dashboard')}
        >
          <Text style={styles.ctaBtnTextSecondary}>{t('x_bar_prep_results_view_progress_2')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Answer review ─────────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>{t('x_bar_prep_results_answer_review')}</Text>
      <Text style={styles.sectionHint}>{t('x_bar_prep_results_tap_any_question_see')}</Text>
      {(questions ?? []).map((q: any, i: number) => {
        const ans = answerMap[q.id];
        return (
          <AnswerRow
            key={q.id}
            q={{ ...q, correct_answer: ans?.correct_answer ?? q.correct_answer, rule_tested: ans?.rule_tested ?? q.rule_tested }}
            index={i}
            userAnswer={ans?.selected_answer}
            isCorrect={!!ans?.is_correct}
            onExplain={() => navigation.navigate('BarPrepExplanation', { question_id: q.id })}
          />
        );
      })}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.navy },
  content: { padding: 20 },

  header:   { alignItems: 'center', marginBottom: 24 },
  title:    { ...FONTS.bold, fontSize: 22, color: COLORS.surface, marginBottom: 4 },
  subtitle: { ...FONTS.regular, fontSize: 13, color: COLORS.steel },

  // Score ring
  ringWrapper: { alignItems: 'center', marginBottom: 24 },
  ring: {
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 6, justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    ...Platform.select({ ios: { shadowColor: COLORS.black, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 6 } }),
  },
  ringPct:    { ...FONTS.bold, fontSize: 38, fontVariant: ['tabular-nums'] },
  ringLabel:  { ...FONTS.regular, fontSize: 13, color: COLORS.info, marginTop: 2 },
  passBadge:  { ...FONTS.bold, fontSize: 14, marginTop: 12 },

  // Stats row
  statsRow:    { flexDirection: 'row', backgroundColor: COLORS.bgCard, borderRadius: RADIUS?.md ?? 12, marginBottom: 20, padding: 16 },
  statBox:     { flex: 1, alignItems: 'center' },
  statNum:     { ...FONTS.bold, fontSize: 28, fontVariant: ['tabular-nums'] },
  statLabel:   { ...FONTS.regular, fontSize: 12, color: COLORS.info, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(133,183,235,0.15)', marginVertical: 4 },

  // CTAs
  ctaRow:               { flexDirection: 'column', gap: 10, marginBottom: 28 },
  ctaBtn:               { borderRadius: RADIUS?.md ?? 12, paddingVertical: 14, alignItems: 'center' },
  ctaPrimary:           { backgroundColor: COLORS.legal },
  ctaSecondary:         { backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.steel },
  ctaBtnTextPrimary:    { ...FONTS.bold, fontSize: 15, color: COLORS.white },
  ctaBtnTextSecondary:  { ...FONTS.bold, fontSize: 15, color: COLORS.info },

  // Section label
  sectionLabel: { ...FONTS.bold, fontSize: 16, color: COLORS.surface, marginBottom: 4 },
  sectionHint:  { ...FONTS.regular, fontSize: 12, color: COLORS.steel, marginBottom: 12 },

  // Answer rows
  ansRow:     { borderRadius: RADIUS?.md ?? 10, marginBottom: 8, overflow: 'hidden' },
  ansCorrect: { backgroundColor: COLORS.legalBg ?? COLORS.legalBg, borderLeftWidth: 3, borderLeftColor: COLORS.legal },
  ansWrong:   { backgroundColor: COLORS.bailBg  ?? COLORS.bailBg, borderLeftWidth: 3, borderLeftColor: COLORS.bail },

  ansHeader:  { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 8 },
  // rows sit on the light legalBg / bailBg tints: dark text
  ansIcon:    { ...FONTS.bold, fontSize: 16, width: 20, textAlign: 'center', color: COLORS.navy, marginTop: 1 },
  ansNum:     { ...FONTS.bold, fontSize: 13, color: COLORS.navy, width: 30 },
  ansStem:    { flex: 1, ...FONTS.regular, fontSize: 13, color: COLORS.navy, lineHeight: 18 },
  ansChevron: { ...FONTS.regular, fontSize: 11, color: COLORS.steel, marginTop: 2 },

  ansDetail:     { paddingHorizontal: 12, paddingBottom: 12 },
  ansLine:       { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  ansLineLabel:  { ...FONTS.bold, fontSize: 13 },
  ansLineVal:    { ...FONTS.regular, fontSize: 13, flex: 1 },
  ansRule:       { ...FONTS.regular, fontStyle: 'italic' as const, fontSize: 12, color: COLORS.steel, marginTop: 6 },
  explainBtn:    { marginTop: 8, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(133,183,235,0.12)', borderRadius: 8, alignSelf: 'flex-start' },
  explainBtnText:{ ...FONTS.bold, fontSize: 13, color: COLORS.steel },
});