/**
 * AdminResultsScreen — publish results (build plan B11; admin role only, the server checks it).
 * Preview the numbers for a period (default: the last 90 days), then publish an immutable,
 * dated snapshot. Publishing is refused under 100 answered court dates. Nothing is published
 * automatically. The public page (/results) shows the latest published snapshot only.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { makeStyles } from './CourtDatesScreen';
import { ResultsBody, type ResultsSnapshot } from './ResultsScreen';
import { formatCourtDay } from '../services/corePath';

type Preview = Omit<ResultsSnapshot, 'id' | 'published_at' | 'methods'> & { can_publish: boolean; min_answered: number };

function AdminResultsScreen(_props: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [snaps, setSnaps] = useState<ResultsSnapshot[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (f?: string, tt?: string) => {
    setBusy(true); setErr('');
    try {
      const params: Record<string, string> = {};
      if (f) params.from = f; if (tt) params.to = tt;
      const [p, s] = await Promise.all([
        api.get<Preview>('/admin/results/preview', { params }),
        api.get<{ snapshots: ResultsSnapshot[] }>('/admin/results/snapshots'),
      ]);
      setPreview(p.data); setSnaps(s.data.snapshots || []);
      setFrom(p.data.period.from); setTo(p.data.period.to);
    } catch (e) { setErr(apiErrorMessage(e, t('ares_load_failed'))); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const publish = async () => {
    if (!preview?.can_publish) return;
    const ok = await confirm(t('ares_publish_q'), t('ares_publish_body', { from: formatCourtDay(from), to: formatCourtDay(to) }), { confirmLabel: t('ares_publish') });
    if (!ok) return;
    try {
      await api.post('/admin/results/publish', { from, to });
      showToast(t('ares_published'), 'success');
      load(from, to);
    } catch (e) { showToast(apiErrorMessage(e, t('ares_publish_failed')), 'error'); }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="admin-results-screen" keyboardShouldPersistTaps="handled">
      <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('ares_title')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('ares_intro')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('ares_from')}</Text>
      <TextInput accessibilityLabel={t('ares_from')} testID="ares-from" style={styles.inputFull} value={from} onChangeText={setFrom} maxLength={10} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
      <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('ares_to')}</Text>
      <TextInput accessibilityLabel={t('ares_to')} testID="ares-to" style={styles.inputFull} value={to} onChangeText={setTo} maxLength={10} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
      <TouchableOpacity accessibilityRole="button" testID="ares-preview" style={styles.secondaryBtn} onPress={() => load(from.trim(), to.trim())} disabled={busy}>
        <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('ares_preview')}</Text>
      </TouchableOpacity>
      {busy && <ActivityIndicator color={colors.textBrand} accessibilityLabel={t('loading')} />}
      {!!err && <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="ares-error">{err}</Text>}
      {preview && (
        <View testID="ares-preview-box">
          <ResultsBody r={preview} styles={styles} />
          {!preview.can_publish && (
            <Text maxFontSizeMultiplier={1.4} style={styles.error} testID="ares-too-small">{t('ares_too_small', { answered: preview.answered, min: preview.min_answered })}</Text>
          )}
          <TouchableOpacity accessibilityRole="button" testID="ares-publish" style={[styles.primaryBtn, !preview.can_publish && { opacity: 0.5 }]} disabled={!preview.can_publish} onPress={publish}>
            <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('ares_publish')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={styles.group}>{t('ares_history')}</Text>
      {snaps.length === 0 && <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="ares-none">{t('ares_none')}</Text>}
      {snaps.map(s => (
        <Text key={s.id} maxFontSizeMultiplier={1.4} style={styles.rowSub} testID="ares-snapshot">
          {t('ares_snapshot_line', { day: formatCourtDay(String(s.published_at).slice(0, 10)), from: formatCourtDay(s.period.from), to: formatCourtDay(s.period.to), rate: s.appearance_rate == null ? '—' : `${s.appearance_rate}%` })}
        </Text>
      ))}
    </ScrollView>
  );
}

export default React.memo(AdminResultsScreen);
