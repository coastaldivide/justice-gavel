/**
 * ResultsScreen — the public results page (https://justicegavel.app/results; build plan B11).
 * Shows ONLY the latest snapshot an admin published (GET /api/results): appearance rate,
 * reminders sent, text opt-out rate, number of court dates, the period, and the fixed methods
 * note. Before anything is published the page says so and shows no numbers. Any auth state.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api } from '../services/api';
import { useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { makeStyles } from './CourtDatesScreen';
import { formatCourtDay } from '../services/corePath';

export interface ResultsSnapshot {
  id: number; published_at: string; period: { from: string; to: string };
  court_dates: number; asked: number; answered: number; attended: number; rescheduled: number; missed: number; no_answer: number;
  appearance_rate: number | null; reminders_sent: number; texted_numbers: number; opted_out: number; opt_out_rate: number | null;
  methods_version: number; methods: string;
}

const n = (v: number) => Number(v || 0).toLocaleString(locale());
const pct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`);

/** The numbers and the methods note (shared with the admin page's preview). */
export function ResultsBody({ r, styles }: { r: Omit<ResultsSnapshot, 'id' | 'published_at' | 'methods'> & { methods?: string }; styles: any }) {
  const rows: Array<[string, string, string]> = [
    ['results-rate', t('pres_rate'), pct(r.appearance_rate)],
    ['results-court-dates', t('pres_court_dates'), n(r.court_dates)],
    ['results-answers', t('pres_answers'), t('pres_answers_value', { attended: n(r.attended), missed: n(r.missed), rescheduled: n(r.rescheduled), no_answer: n(r.no_answer) })],
    ['results-reminders', t('pres_reminders'), n(r.reminders_sent)],
    ['results-optout', t('pres_optout'), t('pres_optout_value', { rate: pct(r.opt_out_rate), opted: n(r.opted_out), texted: n(r.texted_numbers) })],
  ];
  return (
    <View>
      <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="results-period">{t('pres_period', { from: formatCourtDay(r.period.from), to: formatCourtDay(r.period.to) })}</Text>
      {rows.map(([id, label, value]) => (
        <View key={id} style={styles.box} testID={id}>
          <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{label}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.boxTitle}>{value}</Text>
        </View>
      ))}
      <View style={styles.box} testID="results-methods">
        <Text maxFontSizeMultiplier={1.4} style={styles.boxStrong}>{t('pres_methods_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{t(`pres_methods_v${r.methods_version || 1}`)}</Text>
      </View>
    </View>
  );
}

function ResultsScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'none' | 'error'>('loading');
  const [snap, setSnap] = useState<ResultsSnapshot | null>(null);
  useEffect(() => {
    let live = true;
    api.get<{ snapshot: ResultsSnapshot }>('/results')
      .then(r => { if (live) { setSnap(r.data.snapshot); setPhase('ok'); } })
      .catch(e => { if (live) setPhase(e?.response?.status === 404 ? 'none' : 'error'); });
    return () => { live = false; };
  }, []);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="results-screen">
      <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('pres_title')}</Text>
      {phase === 'loading' && <ActivityIndicator color={colors.textBrand} accessibilityLabel={t('loading')} />}
      {phase === 'none' && <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="results-none">{t('pres_none')}</Text>}
      {phase === 'error' && <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="results-error">{t('pres_load_failed')}</Text>}
      {phase === 'ok' && snap && (
        <>
          <ResultsBody r={snap} styles={styles} />
          <Text maxFontSizeMultiplier={1.4} style={styles.source} testID="results-published">{t('pres_published', { day: formatCourtDay(String(snap.published_at).slice(0, 10)) })}</Text>
        </>
      )}
      {navigation?.canGoBack?.() && (
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
          <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('back')}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

export default React.memo(ResultsScreen);
