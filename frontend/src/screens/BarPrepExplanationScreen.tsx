/**
 * BarPrepExplanationScreen — Full AI Explanation
 *
 * Deep-dive on a single MBE question:
 *   • Rule statement  • Case citation  • Analysis  • Related concepts
 *
 * Navigated to from:
 *   BarPrepQuizScreen (practice mode inline card "View Full Explanation →")
 *   BarPrepProgressScreen (flag review)
 */

import { RNShare } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { api }            from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { GradientHeader } from '../components/GradientHeader';
import { useHaptics }     from '../hooks/useHaptics';
import { t, useLang } from '../i18n';

interface ExplanationData {
  question_id:   number;
  stem:          string;
  correct_answer: string;
  correct_text:  string;   // derived: option_{correct_answer.toLowerCase()}
  explanation:   string;
  rule_tested:   string;
  case_citation?: string;
  category:      string;
  difficulty:    string;
  ai_explanation?: string;  // richer GPT-4 expansion if available
}

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: COLORS.legal, medium: COLORS.steelMid, hard: COLORS.bail,
};

export default function BarPrepExplanationScreen({
  route, navigation
}: ScreenProps<'BarPrepExplanation'>) {
  useLang();
  const { question_id } = (route?.params ?? {}) as { question_id: number };
  const { colors }  = useTheme();
  const { impact }  = useHaptics();
  const [data, setData]       = useState<ExplanationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [flagging, setFlagging] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/bar-prep/explain/${question_id}`);
      const expl = res.data.explanation;
      // correct_text is not a DB column — derive it from the option letter
      if (expl && expl.correct_answer) {
        const key = `option_${expl.correct_answer.toLowerCase()}` as keyof typeof expl;
        expl.correct_text = (expl[key] as string) ?? expl.correct_answer;
      }
      setData(expl);
    } catch {
      Alert.alert(t('error'), t('x_bar_prep_explanation_could_not_load_explanation'));
    } finally {
      setLoading(false);
    }
  }, [question_id]);

  useEffect(() => { load(); }, [load]);

  const flagQuestion = useCallback(async () => {
    setFlagging(true);
    try {
      await api.post(`/bar-prep/questions/${question_id}/flag`, { reason: 'confusing' });
      Alert.alert(t('x_bar_prep_explanation_thanks'), t('x_bar_prep_explanation_question_flagged_review'));
    } catch {
      Alert.alert(t('error'), t('x_bar_prep_explanation_could_not_flag_question'));
    } finally {
      setFlagging(false);
    }
  }, [question_id]);

  const shareExplanation = useCallback(async () => {
    if (!data) return;
    impact('light');
    await RNShare.share({
      title: t('x_bar_prep_explanation_mbe_explanation', { rule_tested: data.rule_tested }),
      message: t('x_bar_prep_explanation_rule_justice_gavel_bar', { rule_tested: data.rule_tested, explanation: data.explanation }),
    });
  }, [data, impact]);

  const styles = makeStyles(colors);

  if (loading) {
  return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>{t('x_bar_prep_explanation_explanation_unavailable')}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>{t('x_bar_prep_explanation_go_back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GradientHeader
        title={t('x_bar_prep_explanation_mbe_explanation_2')}
        subtitle={data.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
        onBack={() => navigation.goBack()}
        rightAction={
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_bar_prep_explanation_share_explanation')} onPress={shareExplanation}>
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: 14 }}>{t('x_bar_prep_explanation_share')}</Text>{/* design-audit-ignore: rendered inside the navy GradientHeader */}
          </TouchableOpacity>
        }
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* ── Question stem recap ──────────────────────────────────── */}
        <View style={styles.questionCard}>
          <View style={styles.questionMeta}>
            <View style={[styles.diffBadge, { backgroundColor: DIFFICULTY_COLOR[data.difficulty] + '22' }]}>
              <Text style={[styles.diffText, { color: DIFFICULTY_COLOR[data.difficulty] }]}>
                {data.difficulty.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.categoryBadge}>
              Q {data.question_id}
            </Text>
          </View>
          <Text style={styles.stemText}>{data.stem}</Text>
          <View style={styles.correctAnswerRow}>
            <View style={styles.correctBadge}>
              <Text style={styles.correctBadgeText}>✓ {data.correct_answer}</Text>
            </View>
            <Text style={styles.correctAnswerText} numberOfLines={2}>
              {data.correct_text}
            </Text>
          </View>
        </View>

        {/* ── Rule Statement ──────────────────────────────────────── */}
        <SectionCard
          title={t('x_bar_prep_explanation_rule_tested')}
          colors={colors}
          accent={colors.primary}
        >
          <Text style={styles.ruleText}>{data.rule_tested}</Text>
          {data.case_citation && (
            <Text style={styles.citationText}>📖 {data.case_citation}</Text>
          )}
        </SectionCard>

        {/* ── Explanation ─────────────────────────────────────────── */}
        <SectionCard
          title={t('x_bar_prep_explanation_why_this_answer')}
          colors={colors}
          accent={COLORS.legal}
        >
          <Text style={styles.explanationText}>{data.explanation}</Text>
        </SectionCard>

        {/* ── AI Deep-Dive (if available) ─────────────────────────── */}
        {data.ai_explanation && (
          <SectionCard
            title={t('x_bar_prep_explanation_ai_deep_dive')}
            colors={colors}
            accent={colors.blue}
          >
            <Text style={styles.explanationText}>{data.ai_explanation}</Text>
          </SectionCard>
        )}

        {/* ── Related Rules (if parseable from explanation) ────────── */}
        <SectionCard title={t('x_bar_prep_explanation_study_this')} colors={colors} accent={colors.border}>
          <Text style={styles.studyText}>
            {t('x_bar_prep_explanation_look_up')}{' '}<Text style={styles.studyHighlight}>{data.rule_tested}</Text>
            {data.case_citation ? ' ' + t('x_bar_prep_explanation_particularly', { case_citation: data.case_citation }) : '.'}
          </Text>
          <Text style={[styles.studyText, { marginTop: 8 }]}>
            {t('x_bar_prep_explanation_category')}{' '}<Text style={styles.studyHighlight}>
              {data.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </Text>
          </Text>
        </SectionCard>

        {/* ── Flag & Action Row ────────────────────────────────────── */}
        <View style={styles.actionRow}>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.actionBtn, styles.flagBtn]}
            onPress={flagQuestion}
            disabled={flagging}
          >
            <Text style={styles.flagBtnText}>
              {flagging ? t('x_bar_prep_explanation_flagging') : t('x_bar_prep_explanation_flag_question')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.actionBtn, styles.doneBtn]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.doneBtnText}>{t('x_bar_prep_explanation_done')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionCard({
  title, children, colors, accent,
}: { title: string; children: React.ReactNode; colors: any; accent: string }) {
  useLang();
  return (
    <View style={[cardStyles.card, { backgroundColor: colors.card, borderLeftColor: accent }]}>
      <Text style={[cardStyles.title, { color: (colors as any).text }] as any}>{title}</Text>
      {children}

        {/* Bar prep disclaimer */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center',
            paddingHorizontal: 16, paddingVertical: 8, lineHeight: 14 }}
        >
          {t('x_bar_prep_explanation_supplemental_study_only_not')}
        </Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card:  {
    marginHorizontal: 16, marginTop: 12, padding: 16,
    borderRadius: RADIUS.lg, borderLeftWidth: 4,
    ...SHADOW.sm,
  },
  title: { fontSize: 13, ...FONTS.bold, marginBottom: 10 },
});

function makeStyles(colors: any) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.bg },
    center:        { justifyContent: 'center', alignItems: 'center' },
    scroll:        { flex: 1 },
    scrollContent: { paddingBottom: 40 },
    errorText:     { fontSize: 15, color: colors.textMuted, marginBottom: 12 },
    backLink:      { fontSize: 15, color: colors.primary },
    questionCard:  {
      margin: 16, padding: 16, borderRadius: RADIUS.lg,
      backgroundColor: colors.card, ...SHADOW.sm,
    },
    questionMeta:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    diffBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    diffText:      { fontSize: 11, ...FONTS.bold },
    categoryBadge: { fontSize: 12, color: colors.textMuted },
    stemText:      {
      fontSize: 15, ...FONTS.medium, color: colors.text,
      lineHeight: 22, marginBottom: 14,
    },
    correctAnswerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    correctBadge:     {
      backgroundColor: COLORS.legal, paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: 8, flexShrink: 0,
    },
    correctBadgeText: { fontSize: 13, ...FONTS.bold, color: colors.white },
    correctAnswerText: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },
    ruleText:      { fontSize: 14, ...FONTS.semiBold, color: colors.text },
    citationText:  { fontSize: 13, color: colors.textMuted, marginTop: 8, fontStyle: 'italic' },
    explanationText: { fontSize: 14, color: colors.text, lineHeight: 22 },
    studyText:     { fontSize: 14, color: colors.text, lineHeight: 21 },
    studyHighlight: { ...FONTS.semiBold, color: colors.primary },
    actionRow:     {
      flexDirection: 'row', marginHorizontal: 16, marginTop: 20, gap: 10,
    },
    actionBtn:     {
      flex: 1, paddingVertical: 13, borderRadius: RADIUS.lg,
      alignItems: 'center', ...SHADOW.sm,
    },
    flagBtn:       { backgroundColor: colors.border },
    flagBtnText:   { fontSize: 14, color: colors.textSecond, ...FONTS.medium },
    doneBtn:       { backgroundColor: colors.primary },
    doneBtnText:   { fontSize: 14, color: colors.textOnAccent, ...FONTS.bold },
  });
}