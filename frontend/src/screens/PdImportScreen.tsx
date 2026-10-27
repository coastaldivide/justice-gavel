/**
 * PdImportScreen — upload a public defender office's client list as CSV (A11 step 2;
 * docs/PUBLIC_DEFENDER.md "Client list").
 *
 * 1. Download the template: name, phone, language, case_number, court_dates (several separated
 *    by ";"), email, court — up to 5,000 rows.
 * 2. Pick the file: every row is checked and shown with its own problems and whether it adds a new
 *    client or updates one already on the list (same phone + case number); nothing is saved.
 * 3. Import: only when every row is right — all rows in one go, or none. A client already on the
 *    list gets the file's court dates (upcoming dates no longer in the file are removed).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { appendPicked, fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Line, Notice, Pill } from '../components/bondDesk/ui';
import { type PdImportCheck, importErrorText, importFileErrorText } from '../services/publicDefender';

const MAX_CSV = 2 * 1024 * 1024;
type Picked = { uri: string; name: string; size?: number };
interface Done { imported: number; added: number; updated: number; court_dates_added: number; court_dates_removed: number }

function PdImportScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [file, setFile] = useState<Picked | null>(null);
  const [check, setCheck] = useState<PdImportCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(true);

  const formFor = async (f: Picked) => {
    const form = new FormData();
    await appendPicked(form, 'file', { uri: f.uri, name: f.name || 'clients.csv', type: 'text/csv' });
    return form;
  };
  const template = async () => {
    try { await fetchFile('/pd/clients/template.csv', 'public-defender-clients-template.csv', 'text/csv'); } catch (e) { showToast(apiErrorMessage(e, t('pd_download_failed')), 'error'); }
  };
  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain'], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    if (a.size && a.size > MAX_CSV) { setProblem(t('pd_imp_too_big')); return; }
    const f = { uri: a.uri, name: a.name || 'clients.csv', size: a.size };
    setFile(f); setDone(null); setProblem(prev => (prev ? '' : prev)); setBusy('preview');
    try {
      const res = await api.post<PdImportCheck>('/pd/clients/import/preview', await formFor(f), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
      if (mounted.current) setCheck(res.data);
    } catch (e) { if (mounted.current) { setCheck(null); setProblem(apiErrorMessage(e, t('pd_imp_failed'))); } }
    finally { if (mounted.current) setBusy(null); }
  };
  const doImport = async () => {
    if (!file) return;
    setBusy('import'); setProblem(prev => (prev ? '' : prev));
    try {
      const res = await api.post<Done>('/pd/clients/import', await formFor(file), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000 });
      if (!mounted.current) return;
      setDone(res.data); setCheck(null); setFile(null);
      showToast(t('pd_imp_done', { n: res.data.imported }), 'success');
    } catch (e) { if (mounted.current) setProblem(apiErrorMessage(e, t('pd_imp_failed'))); }
    finally { if (mounted.current) setBusy(null); }
  };

  const ready = !!check && !check.file_errors.length && check.invalid === 0 && check.valid > 0;
  const rows = check ? check.rows.filter(r => !onlyErrors || r.errors.length) : [];
  return (
    <ScrollView testID="pd-import-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      {!!problem && <Notice text={problem} tone="error" testID="pd-import-error" />}
      {done && (
        <Card testID="pd-import-done">
          <Line tone="ok" strong>{t('pd_imp_done', { n: done.imported })}</Line>
          <Line muted>{t('pd_imp_done_detail', { added: done.added, updated: done.updated, dadd: done.court_dates_added, drem: done.court_dates_removed })}</Line>
          <Btn label={t('pd_clients')} onPress={() => navigation.navigate('PdClients' as never)} testID="pd-import-to-clients" />
        </Card>
      )}
      <Card title={t('pd_imp_step1')}>
        <Line>{t('pd_imp_columns')}</Line>
        <Line muted>{t('pd_imp_rules')}</Line>
        <Btn kind="ghost" label={t('pd_imp_template')} onPress={template} testID="pd-import-template" />
      </Card>
      <Card title={t('pd_imp_step2')}>
        <Btn label={t('pd_imp_pick')} onPress={pick} busy={busy === 'preview'} testID="pd-import-pick" />
        {!!file && <Line muted>{file.name}</Line>}
      </Card>
      {check && (
        <Card title={t('pd_imp_preview')} testID="pd-import-preview">
          <Line strong testID="pd-import-summary">{t('pd_imp_summary', { total: check.total, valid: check.valid, invalid: check.invalid, adds: check.adds, updates: check.updates })}</Line>
          {check.file_errors.map((e, i) => <Line key={i} tone="danger" testID={`pd-import-file-error-${i}`}>{importFileErrorText(e)}</Line>)}
          {check.unknown_columns.length > 0 && <Line muted>{t('pd_imp_unknown_cols', { cols: check.unknown_columns.join(', ') })}</Line>}
          {check.invalid > 0 && <Btn kind="ghost" label={t(onlyErrors ? 'pd_imp_show_all' : 'pd_imp_show_errors')} onPress={() => setOnlyErrors(v => !v)} testID="pd-import-toggle" />}
          {rows.slice(0, 300).map(r => (
            <View key={r.line} style={{ marginTop: 8 }} testID={`pd-import-row-${r.line}`}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Line strong>{t('pd_imp_line', { n: r.line })} · {String(r.values.name || '—')}</Line>
                <Pill text={r.errors.length ? t('pd_imp_row_bad') : t(r.action === 'update' ? 'pd_imp_row_update' : 'pd_imp_row_add')} tone={r.errors.length ? 'danger' : 'ok'} />
              </View>
              {r.errors.map((e, i) => <Line key={i} tone="danger">{importErrorText(e)}</Line>)}
            </View>
          ))}
          {rows.length > 300 && <Line muted>{t('pd_imp_more', { n: rows.length - 300 })}</Line>}
          <Line muted>{t('pd_imp_all_or_nothing')}</Line>
          <Btn label={t('pd_imp_go', { n: check.valid })} onPress={doImport} disabled={!ready} busy={busy === 'import'} testID="pd-import-go" />
        </Card>
      )}
    </ScrollView>
  );
}

export default React.memo(PdImportScreen);
