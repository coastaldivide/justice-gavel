import { COLORS } from '../constants/theme';
/**
 * MatterScreen.tsx — Law firm matter detail view
 * Shows matter details, assigned attorney, court dates, linked cases, billing.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, StyleSheet, LayoutAnimation } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { formatDate } from '../utils/dateUtils';

import { ScreenProps } from '../types/navigation';
import { RouteParams } from '../types/api';
import { t, useLang } from '../i18n';

type Props = ScreenProps<'Matter'>;

function MatterScreen({ route, navigation }: Props) {
  useLang();
  const matterId = (route.params as RouteParams | undefined)?.matterId;
  const [matter, setMatter]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!matterId) { setLoading(false); return; }
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/matters/${matterId}`);
      setMatter(data.matter ?? data);
    } catch (e: any) {
      setError(apiErrorMessage(e, t('x_matter_failed_load_matter')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [matterId]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (error)   return <View style={styles.center}><Text accessibilityRole="alert">{error}</Text></View>;
  if (!matter) return <View style={styles.center}><Text>{t('x_matter_matter_not_found')}</Text></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text maxFontSizeMultiplier={1.3} style={styles.title}>{matter.title}</Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>{matter.client_name}</Text>

      {[
        [t('x_cs_status'),            matter.status],
        [t('x_matter_type'),          matter.matter_type],
        [t('x_matter_jurisdiction'),  matter.jurisdiction],
        [t('nav_title_court_date'),    matter.court_date ? formatDate(String(matter.court_date)) : '—'],
        [t('x_matter_capital_case'),  matter.capital_case ? t('x_common_yes') : t('x_common_no')],
        [t('x_matter_co_defendants'), matter.co_defendant_count ?? '0'],
        [t('x_matter_bail_amount'),   matter.bail_amount ? `$${Number(matter.bail_amount).toLocaleString()}` : '—'],
        [t('x_matter_bail_status'),   matter.bail_status ?? '—'],
      ].map(([label, value]) => (
        <View key={`field-${label}`} style={styles.row}>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>{label}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.value}>{value}</Text>
        </View>
      ))}

      {matter.notes && (
        <View style={styles.notes}>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>{t('x_cs_notes')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.noteText}>{matter.notes}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.btn} accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        onPress={() => navigation.navigate('VideoConsultation', { matterId })}>
        <Text style={styles.btnText}>{t('x_matter_schedule_video_consultation')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: COLORS.bg },
  content:  { padding: 20 },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: 22, fontWeight: '700', color: COLORS.navy, marginBottom: 4 },
  subtitle: { fontSize: 15, color: COLORS.textMuted, marginBottom: 20 },
  row:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  label:    { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  value:    { fontSize: 14, color: COLORS.textPrimary, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  notes:    { marginTop: 16 },
  noteText: { fontSize: 14, color: COLORS.textSecond, lineHeight: 22, marginTop: 4 },
  btn:      { backgroundColor: COLORS.navy, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  btnText:  { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
export default React.memo(MatterScreen);