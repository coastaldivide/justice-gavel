/**
 * BondImportScreen — move the agency's open bonds into Bond Desk from a CSV file
 * (docs/BOND_DESK.md "Import open bonds").
 *
 * 1. Download the template (the column names), fill it from the old system (up to 2,000 rows).
 * 2. Pick the file: every row is checked and shown with its own problems; nothing is saved.
 * 3. Import: only when every row is right — all rows are added in one go, or none.
 *    Each row becomes an active bond with its power, first hearing, first indemnitor and, when
 *    something is still owed, one charge "imported balance".
 */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { appendPicked, fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { FONTS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line, Notice, Pill } from '../components/bondDesk/ui';
import { type ImportCheck, importErrorText, importFileErrorText, money } from '../services/bondDesk';

const MAX_CSV = 2 * 1024 * 1024;
type Picked = { uri: string; name: string; size?: number };

function BondImportScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [file, setFile] = useState<Picked | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(true);

  const formFor = async (f: Picked) => {
    const form = new FormData();
    await appendPicked(form, 'file', { uri: f.uri, name: f.name || 'bonds.csv', type: 'text/csv' });
    return form;
  };
  const template = async () => {
    try { await fetchFile('/bond-desk/import/template.csv', 'bond-desk-import-template.csv', 'text/csv'); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_download_failed')), 'error'); }
  };
  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain'], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    if (a.size && a.size > MAX_CSV) { setError(t('bdk_imp_too_big')); return; }
    const f = { uri: a.uri, name: a.name || 'bonds.csv', size: a.size };
    setFile(f); setDone(null); setError(''); setBusy('preview');
    try {
      const res = await api.post<ImportCheck>('/bond-desk/import/preview', await formFor(f), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      if (mounted.current) setCheck(res.data);
    } catch (e) { if (mounted.current) { setCheck(null); setError(apiErrorMessage(e, t('bdk_imp_failed'))); } }
    finally { if (mounted.current) setBusy(null); }
  };
  const doImport = async () => {
    if (!file) return;
    setBusy('import'); setError(prev => (prev ? '' : prev));
    try {
      const res = await api.post<{ imported: number }>('/bond-desk/import', await formFor(file), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000 });
      if (!mounted.current) return;
      setDone(res.data.imported); setCheck(null); setFile(null);
      showToast(t('bdk_imp_done', { n: res.data.imported }), 'success');
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_imp_failed'))); }
    finally { if (mounted.current) setBusy(null); }
  };

  const ready = !!check && !check.file_errors.length && check.invalid === 0 && check.valid > 0;
  const rows = check ? check.rows.filter(r => !onlyErrors || r.errors.length) : [];
  return (
    <ScrollView testID="bond-import-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('bdk_import_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('bdk_imp_intro')}</Text>
      </View>
      {!!error && <Notice text={error} tone="error" testID="import-error" />}
      {done !== null && (
        <Card testID="import-done">
          <Line tone="ok" strong>{t('bdk_imp_done', { n: done })}</Line>
          <Btn label={t('bdk_imp_to_desk')} onPress={() => navigation.navigate('BondDesk' as never)} testID="import-to-desk" />
        </Card>
      )}
      <Card title={t('bdk_imp_step1')}>
        <Line>{t('bdk_imp_columns')}</Line>
        <Line muted>{t('bdk_imp_rules')}</Line>
        <Btn kind="ghost" label={t('bdk_imp_template')} onPress={template} testID="import-template" />
      </Card>
      <Card title={t('bdk_imp_step2')}>
        <Btn label={t('bdk_imp_pick')} onPress={pick} busy={busy === 'preview'} testID="import-pick" />
        {!!file && <Line muted>{file.name}</Line>}
      </Card>
      {check && (
        <Card title={t('bdk_imp_preview')} testID="import-preview">
          <Line strong testID="import-summary">{t('bdk_imp_summary', { total: check.total, valid: check.valid, invalid: check.invalid })}</Line>
          {check.file_errors.map((e, i) => <Line key={i} tone="danger" testID={`import-file-error-${i}`}>{importFileErrorText(e)}</Line>)}
          {check.unknown_columns.length > 0 && <Line muted>{t('bdk_imp_unknown_cols', { cols: check.unknown_columns.join(', ') })}</Line>}
          {check.invalid > 0 && <Btn kind="ghost" label={t(onlyErrors ? 'bdk_imp_show_all' : 'bdk_imp_show_errors')} onPress={() => setOnlyErrors(v => !v)} testID="import-toggle" />}
          {rows.slice(0, 300).map(r => (
            <View key={r.line} style={s.row} testID={`import-row-${r.line}`}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Line strong>{t('bdk_imp_line', { n: r.line })} · {String(r.values.defendant_name || '—')}</Line>
                <Pill text={r.errors.length ? t('bdk_imp_row_bad') : t('bdk_imp_row_ok')} tone={r.errors.length ? 'danger' : 'ok'} />
              </View>
              {!r.errors.length && typeof r.values.bond_amount === 'number' && (
                <Line muted>{[money(r.values.bond_amount as number), r.values.power_number, typeof r.values.balance === 'number' ? t('bdk_imp_balance', { amount: money(r.values.balance as number) }) : null].filter(Boolean).join(' · ')}</Line>
              )}
              {r.errors.map((e, i) => <Line key={i} tone="danger">{importErrorText(e)}</Line>)}
            </View>
          ))}
          {rows.length > 300 && <Line muted>{t('bdk_imp_more', { n: rows.length - 300 })}</Line>}
          <Line muted>{t('bdk_imp_all_or_nothing')}</Line>
          <Btn label={t('bdk_imp_go', { n: check.valid })} onPress={doImport} disabled={!ready} busy={busy === 'import'} testID="import-go" />
        </Card>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 13, lineHeight: 19, marginTop: 4 },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
});

export default React.memo(BondImportScreen);
