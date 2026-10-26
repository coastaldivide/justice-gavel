/**
 * BondReportsScreen — Bond Desk reports for the agency, its sureties and the
 * Department of Insurance: liability by surety, executed powers per surety
 * (date range), receivables, the receipts journal (date range) and collateral
 * held. Each is shown on screen and can be exported as CSV (?format=csv).
 *
 * The numbers are the server's sums of the agent's own entries — this screen
 * does not compute any money; it only formats cents and dates for display.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Row } from '../components/bondDesk/ui';
import { AccessGate } from './BondDeskScreen';
import { type Access, fmtDay, isIsoDate, money, tOr, todayIso } from '../services/bondDesk';

export const REPORTS = ['liability', 'surety', 'receivables', 'receipts', 'collateral'] as const;
type Report = typeof REPORTS[number];
const RANGED: Report[] = ['surety', 'receipts'];

/** Display text for one report cell: cents as money, *_on / *_at as dates. */
export function cell(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (/_cents$/.test(key) && typeof v === 'number') return money(v);
  if (/(_on|_date)$/.test(key) && typeof v === 'string') return fmtDay(v);
  if (typeof v === 'boolean') return v ? t('bdk_yes') : t('x_common_no');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const label = (k: string) => tOr(`bdk_col_${k}`, k.replace(/_cents$/, '').replace(/_/g, ' '));

function firstOfMonth(): string { const d = todayIso(); return `${d.slice(0, 8)}01`; }

function BondReportsScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [access, setAccess] = useState<Access | null>(null);
  const [report, setReport] = useState<Report>('liability');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayIso());
  const [surety, setSurety] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const params = (r: Report): Record<string, string> | null => {
    if (!RANGED.includes(r)) return {};
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
    return { from, to, ...(r === 'surety' && surety.trim() ? { surety: surety.trim() } : {}) };
  };

  const run = async (r: Report = report) => {
    const p = params(r);
    if (!p) { setError(t('bdk_err_range_dates')); return; }
    setBusy(true); setError('');
    try {
      if (!access) {
        const a = await api.get<Access>('/bond-desk/access');
        if (!mounted.current) return;
        setAccess(a.data);
        if (!a.data?.allowed) return;
      }
      const res = await api.get<Record<string, unknown>>(`/bond-desk/reports/${r}`, { params: p });
      if (mounted.current) setData(res.data || {});
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed'))); }
    finally { if (mounted.current) setBusy(false); }
  };
  useEffect(() => { run('liability'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    const p = params(report);
    if (!p) { setError(t('bdk_err_range_dates')); return; }
    const qs = new URLSearchParams({ ...p, format: 'csv' }).toString();
    try { await fetchFile(`/bond-desk/reports/${report}?${qs}`, `${report}-${todayIso()}.csv`, 'text/csv'); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_download_failed')), 'error'); }
  };

  if (access && !access.allowed) {
    return <ScrollView style={{ backgroundColor: colors.bg }} testID="bond-reports-screen"><AccessGate access={access} onPlans={() => navigation.navigate('Subscription' as never)} /></ScrollView>;
  }

  const tables = data ? Object.entries(data).filter(([, v]) => Array.isArray(v)) as [string, Record<string, unknown>[]][] : [];
  const scalars = data ? Object.entries(data).filter(([, v]) => !Array.isArray(v) && (typeof v !== 'object' || v === null)) : [];
  const groups = data ? Object.entries(data).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)) as [string, Record<string, unknown>][] : [];

  return (
    <ScrollView testID="bond-reports-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('bdk_reports')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('bdk_reports_intro')}</Text>
      </View>
      <Card>
        <Chips options={REPORTS.map(k => ({ key: k, label: t(`bdk_rp_${k}`) }))} value={report} testIDPrefix="report"
          onChange={k => { setReport(k); setData(null); if (!RANGED.includes(k)) run(k); }} />
        <Line muted>{t(`bdk_rp_${report}_help`)}</Line>
        {RANGED.includes(report) && (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label={t('bdk_from')} value={from} onChangeText={setFrom} testID="report-from" placeholder={t('bdk_date_ph')} /></View>
              <View style={{ flex: 1 }}><Field label={t('bdk_to')} value={to} onChangeText={setTo} testID="report-to" placeholder={t('bdk_date_ph')} /></View>
            </View>
            {report === 'surety' && <Field label={t('bdk_f_surety')} value={surety} onChangeText={setSurety} testID="report-surety" placeholder={t('bdk_all_sureties')} />}
            <Btn label={t('bdk_run_report')} onPress={() => run()} busy={busy} testID="report-run" />
          </>
        )}
        <Btn kind="ghost" label={t('bdk_export_csv')} onPress={exportCsv} testID="report-csv" />
      </Card>
      {!!error && <Notice text={error} tone="error" testID="report-error" />}
      {busy && !data && <ActivityIndicator style={{ marginTop: 20 }} color={colors.textBrand} />}
      {data && (
        <View testID="report-result">
          {scalars.length > 0 && (
            <Card>{scalars.map(([k, v]) => <Row key={k} label={label(k)} value={cell(k, v)} testID={`report-total-${k}`} />)}</Card>
          )}
          {groups.map(([gk, g]) => (
            <Card key={gk} title={label(gk)}>{Object.entries(g).map(([k, v]) => <Row key={k} label={label(k)} value={cell(k, v)} />)}</Card>
          ))}
          {tables.map(([tk, rows]) => (
            <Card key={tk} title={`${label(tk)} (${rows.length})`} testID={`report-table-${tk}`}>
              {!rows.length && <Line muted>{t('bdk_report_empty')}</Line>}
              {rows.slice(0, 300).map((r, i) => (
                <View key={i} style={s.rowBlock}>
                  {Object.entries(r).filter(([k]) => k !== 'id' && !k.endsWith('_id')).map(([k, v]) => <Row key={k} label={label(k)} value={cell(k, v)} />)}
                </View>
              ))}
              {rows.length > 300 && <Line muted>{t('bdk_report_more', { n: rows.length - 300 })}</Line>}
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  rowBlock: { paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: colors.border },
});

export default React.memo(BondReportsScreen);
