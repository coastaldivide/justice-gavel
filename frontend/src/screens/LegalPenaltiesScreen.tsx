/**
 * LegalPenaltiesScreen — recorded drug penalties and DUI laws for a state.
 *
 * Opened as "DUILaws" (DUI tab) or "DrugPenalties" (drug tab). Data comes from
 * the public GET /api/legaldata/drugs|dui?state=XX (state rows plus federal
 * "FED" rows), shown exactly as recorded with each row's source label and the
 * date it was recorded. None of it has been reviewed by a lawyer (the server's
 * `meta.reviewed` says so), and the screen says that plainly — it never shows
 * penalty figures of its own.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { cachedGet, apiErrorMessage } from '../services/api';
import { useTheme } from '../constants/theme';
import { getUserState, setUserState, stateName, localizedStateList } from '../utils/userState';
import { t, useLang, locale } from '../i18n';
import { IconLabel, ICONS } from '../components/AppIcon';

type TabKey = 'drug' | 'dui';

interface DrugRow {
  id: number; state: string; drug_schedule: string; offense_type: string; amount_threshold: string | null;
  charge_level: string; notes: string | null; source: string | null; source_url: string | null; created_at: string | null;
}
interface DuiRow {
  id: number; state: string; bac_limit: number | null; bac_limit_cdl: number | null; bac_limit_under21: number | null;
  first_jail_min: number | null; first_jail_max: number | null; first_fine_min: number | null; first_fine_max: number | null;
  first_license_days: number | null; implied_consent: number | null; ignition_interlock: string | null;
  notes: string | null; source: string | null; source_url: string | null; created_at: string | null;
}
interface Meta { disclaimer?: string; recorded_at?: string | null; reviewed?: boolean }

const OFFENSES = ['possession', 'distribution', 'trafficking', 'delivery', 'manufacture', 'cultivation', 'sale'];
const offenseLabel = (o: string) => (OFFENSES.includes(o) ? t(`pen_offense_${o}`) : o);
const levelLabel = (l: string) => (['felony', 'misdemeanor', 'infraction'].includes(l) ? t(`pen_level_${l}`) : l);
const scheduleLabel = (s: string) => {
  if (/^(I|II|III|IV|V)(\/(I|II|III|IV|V))?$/.test(s)) return t('pen_schedule', { schedule: s });
  return ({ cannabis: t('pen_drug_cannabis'), meth: t('pen_drug_meth'), cocaine: t('pen_drug_cocaine'), heroin: t('pen_drug_heroin'), fentanyl: t('pen_drug_fentanyl') } as Record<string, string>)[s] || s;
};
const money = (n: number | null | undefined) => (n == null ? '' : Number(n).toLocaleString(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const dayText = (d: number | null | undefined) => {
  if (d == null) return '';
  if (d >= 365 && d % 365 === 0) return d === 365 ? t('pen_year_one') : t('pen_years', { n: d / 365 });
  return t('pen_days', { n: d });
};
const recorded = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }) : '');

function LegalPenaltiesScreen({ route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const initialTab: TabKey = route?.name === 'DUILaws' ? 'dui' : 'drug';
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [state, setState] = useState<string>('TN');
  const [stateReady, setStateReady] = useState(false);
  const [picking, setPicking] = useState(false);
  const [rows, setRows] = useState<(DrugRow | DuiRow)[]>([]);
  const [meta, setMeta] = useState<Meta>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getUserState().then(s => { if (s?.code) setState(s.code); }).finally(() => setStateReady(true));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await cachedGet(`/legaldata/${tab === 'dui' ? 'dui' : 'drugs'}?state=${encodeURIComponent(state)}`);
      const data = Array.isArray(r.data?.data) ? r.data.data : [];
      // The state's own rows first, then federal ones.
      data.sort((a: DrugRow, b: DrugRow) => Number(a.state === 'FED') - Number(b.state === 'FED'));
      setRows(data);
      setMeta(r.data?.meta || {});
    } catch (e) {
      setError(apiErrorMessage(e, t('pen_load_error')));
    } finally {
      setLoading(false);
    }
  }, [tab, state]);
  useEffect(() => { if (stateReady) load(); }, [stateReady, load]);

  const chooseState = (code: string) => { setPicking(false); setState(code); setUserState(code).catch(() => {}); };

  const sourceLine = (r: { source: string | null; created_at: string | null }) =>
    t('pen_source', { source: r.source || t('pen_source_unknown'), date: recorded(r.created_at) || '—' });

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]} testID="penalties-screen">
      <View style={styles.tabBar} accessibilityRole="tablist">
        {(['drug', 'dui'] as TabKey[]).map(k => (
          <TouchableOpacity key={k} testID={`penalties-tab-${k}`} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}
            style={[styles.tab, tab === k && { borderBottomColor: colors.navy }]} onPress={() => setTab(k)}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.tabText, { color: tab === k ? colors.textBrand : colors.textMuted }]}>
              {k === 'drug' ? t('hn_charge_drug') : t('pen_tab_dui')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityRole="button" testID="penalties-state" style={styles.statePick} onPress={() => setPicking(true)}>
          <IconLabel icon={ICONS.location} textStyle={styles.stateText} maxFontSizeMultiplier={1.3}>{stateName(state)}</IconLabel>
          <Text maxFontSizeMultiplier={1.3} style={styles.stateChange}>{t('pen_change_state')}</Text>
        </TouchableOpacity>

        <View style={styles.notice} testID="penalties-notice">
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.noticeText} maxFontSizeMultiplier={1.4}>{meta.disclaimer || t('pen_not_reviewed')}</IconLabel>
        </View>

        {loading ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />
          : error ? (
            <View style={styles.empty} testID="penalties-error">
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>{error}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.retry} onPress={load}>
                <Text maxFontSizeMultiplier={1.3} style={styles.retryText}>{t('try_again')}</Text>
              </TouchableOpacity>
            </View>
          ) : rows.length === 0 ? (
            <Text maxFontSizeMultiplier={1.4} style={styles.emptyText} testID="penalties-empty">{t('pen_none', { state: stateName(state) })}</Text>
          ) : tab === 'drug' ? (rows as DrugRow[]).map(r => (
            <View key={r.id} style={styles.card} testID="penalties-row">
              <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle}>
                {r.state === 'FED' ? t('pen_federal') : stateName(r.state)} · {scheduleLabel(r.drug_schedule)} · {offenseLabel(r.offense_type)}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.cardMeta}>
                {levelLabel(r.charge_level)}{r.amount_threshold && r.amount_threshold !== 'any' ? ` · ${t('pen_amount', { amount: r.amount_threshold })}` : ''}
              </Text>
              {!!r.notes && <Text maxFontSizeMultiplier={1.4} style={styles.cardBody}>{r.notes}</Text>}
              <Text maxFontSizeMultiplier={1.3} style={styles.source}>{sourceLine(r)}</Text>
            </View>
          )) : (rows as DuiRow[]).map(r => (
            <View key={r.id} style={styles.card} testID="penalties-row">
              <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle}>{stateName(r.state)}</Text>
              {r.bac_limit != null && <Text maxFontSizeMultiplier={1.4} style={styles.cardBody}>{t('pen_dui_bac', { bac: r.bac_limit, cdl: r.bac_limit_cdl ?? '—', under21: r.bac_limit_under21 ?? '—' })}</Text>}
              {(r.first_jail_max != null || r.first_fine_max != null) && (
                <Text maxFontSizeMultiplier={1.4} style={styles.cardBody}>
                  {t('pen_dui_first', { jail_min: dayText(r.first_jail_min ?? 0), jail_max: dayText(r.first_jail_max), fine_min: money(r.first_fine_min), fine_max: money(r.first_fine_max) })}
                </Text>
              )}
              {r.first_license_days != null && <Text maxFontSizeMultiplier={1.4} style={styles.cardBody}>{t('pen_dui_license', { days: dayText(r.first_license_days) })}</Text>}
              {r.implied_consent != null && <Text maxFontSizeMultiplier={1.4} style={styles.cardBody}>{Number(r.implied_consent) ? t('pen_dui_implied_yes') : t('pen_dui_implied_no')}</Text>}
              {!!r.ignition_interlock && <Text maxFontSizeMultiplier={1.4} style={styles.cardBody}>{t('pen_dui_iid', { value: r.ignition_interlock })}</Text>}
              {!!r.notes && <Text maxFontSizeMultiplier={1.4} style={styles.cardBody}>{r.notes}</Text>}
              <Text maxFontSizeMultiplier={1.3} style={styles.source}>{sourceLine(r)}</Text>
            </View>
          ))}
        {!loading && !error && rows.length > 0 && (
          <Text maxFontSizeMultiplier={1.3} style={styles.footer}>{t('pen_notes_english')}</Text>
        )}
      </ScrollView>

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle} accessibilityRole="header">{t('pen_change_state')}</Text>
            <FlatList
              data={localizedStateList()}
              keyExtractor={s => s.code}
              renderItem={({ item }) => (
                <TouchableOpacity accessibilityRole="button" testID={`penalties-state-${item.code}`} style={styles.modalRow} onPress={() => chooseState(item.code)}>
                  <Text maxFontSizeMultiplier={1.3} style={[styles.modalRowText, item.code === state && { fontWeight: '800' }]}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity accessibilityRole="button" style={styles.retry} onPress={() => setPicking(false)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.retryText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  screen: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 760, alignSelf: 'center' },
  statePick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bgCard, marginBottom: 12 },
  stateText: { fontSize: 15, fontWeight: '700', color: c.textPrimary, flexShrink: 1 },
  stateChange: { fontSize: 13, fontWeight: '700', color: c.textBrand },
  notice: { backgroundColor: c.warnBg, borderRadius: 10, padding: 12, marginBottom: 12 },
  noticeText: { fontSize: 13, lineHeight: 19, color: c.textPrimary },
  card: { backgroundColor: c.bgCard, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  cardMeta: { fontSize: 13, fontWeight: '700', color: c.textSecond },
  cardBody: { fontSize: 14, lineHeight: 20, color: c.textPrimary },
  source: { fontSize: 12, lineHeight: 17, color: c.textMuted, marginTop: 4 },
  empty: { alignItems: 'center', gap: 10, marginTop: 24 },
  emptyText: { fontSize: 14, lineHeight: 20, color: c.textSecond, textAlign: 'center', marginTop: 16 },
  retry: { minHeight: 44, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: c.navy, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 8 },
  retryText: { fontSize: 14, fontWeight: '700', color: c.textBrand },
  footer: { fontSize: 12, lineHeight: 17, color: c.textMuted, marginTop: 8 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: c.bgCard, borderRadius: 16, padding: 16, maxHeight: '80%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary, marginBottom: 8 },
  modalRow: { minHeight: 44, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  modalRowText: { fontSize: 15, color: c.textPrimary },
});

export default React.memo(LegalPenaltiesScreen);
