/**
 * PdClientsScreen — a public defender office's client list (A11 step 2; docs/PUBLIC_DEFENDER.md).
 * Search by name, case number or phone; newest first, 50 per page. Add a client one at a time
 * (name, phone, language, case number, first court date) or upload a CSV file (PdImport).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill } from '../components/bondDesk/ui';
import { PdGate } from '../components/publicDefender/PdParts';
import { fmtDay } from '../services/bondDesk';
import { type PdClient, type PdLang, PD_LANGS, langLabel } from '../services/publicDefender';

interface Page { clients: PdClient[]; page: number; page_size: number; total: number }
const blank = { name: '', phone: '', lang: 'en' as PdLang, case_number: '', court_date: '', court_time: '', court_name: '' };

function PdClientsScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PdClient[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [off, setOff] = useState(false);
  const [notMember, setNotMember] = useState(false);
  const [problem, setProblem] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p = 1, term = q) => {
    try {
      const r = await api.get<Page>('/pd/clients', { params: { q: term || undefined, page: p } });
      if (!mounted.current) return;
      setRows(prev => (p === 1 || !prev ? r.data.clients : [...prev, ...r.data.clients]));
      setPage(p); setTotal(r.data.total); setProblem(prev => (prev ? '' : prev));
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (!mounted.current) return;
      if (code === 'feature_unavailable') setOff(true); else if (code === 'not_member') setNotMember(true);
      else setProblem(apiErrorMessage(e, t('pd_load_failed')));
    }
  }, [q]);
  useFocusEffect(useCallback(() => { load(1); }, [load]));

  const add = async () => {
    setBusy(true);
    try {
      const court_dates = form.court_date ? [{ court_date: form.court_date, court_time: form.court_time || null, court_name: form.court_name || null }] : [];
      const r = await api.post<{ client: PdClient }>('/pd/clients', { name: form.name, phone: form.phone, lang: form.lang, case_number: form.case_number, court_dates });
      if (!mounted.current) return;
      showToast(t('pd_client_added'), 'success');
      setForm(blank); setAdding(false);
      navigation.navigate('PdClient', { clientId: r.data.client.id });
    } catch (e) { if (mounted.current) setProblem(apiErrorMessage(e, t('pd_failed'))); }
    finally { if (mounted.current) setBusy(false); }
  };

  return (
    <PdGate off={off} notMember={notMember} error={problem} hasData={rows !== null} testID="pd-clients-screen">
      <ScrollView testID="pd-clients-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!!problem && <Notice tone="error" text={problem} testID="pd-clients-error" />}
        <Card>
          <Field label={t('pd_search')} value={q} onChangeText={setQ} placeholder={t('pd_search_ph')} testID="pd-search" maxLength={80} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Btn kind="ghost" label={t('pd_search_go')} onPress={() => load(1, q)} testID="pd-search-go" />
            <Btn label={t('pd_add_client')} onPress={() => setAdding(v => !v)} testID="pd-add-toggle" />
            <Btn kind="ghost" label={t('pd_upload_csv')} onPress={() => navigation.navigate('PdImport' as never)} testID="pd-open-import" />
          </View>
        </Card>
        {adding && (
          <Card title={t('pd_add_client')} testID="pd-add-form">
            <Field label={t('pd_col_name')} value={form.name} onChangeText={v => setForm({ ...form, name: v })} testID="pd-add-name" maxLength={160} />
            <Field label={t('pd_col_phone')} value={form.phone} onChangeText={v => setForm({ ...form, phone: v })} keyboardType="phone-pad" testID="pd-add-phone" maxLength={40} />
            <Line muted>{t('pd_col_language')}</Line>
            <Chips options={PD_LANGS.map(l => ({ key: l, label: langLabel(l) }))} value={form.lang} onChange={l => setForm({ ...form, lang: l })} testIDPrefix="pd-add-lang" />
            <Field label={t('pd_col_case_number')} value={form.case_number} onChangeText={v => setForm({ ...form, case_number: v })} testID="pd-add-case" maxLength={80} />
            <Field label={t('pd_first_court_date')} value={form.court_date} onChangeText={v => setForm({ ...form, court_date: v })} placeholder={t('pd_ph_date')} testID="pd-add-date" maxLength={10} />
            <Field label={t('pd_court_time')} value={form.court_time} onChangeText={v => setForm({ ...form, court_time: v })} placeholder={t('pd_ph_time')} testID="pd-add-time" maxLength={5} />
            <Field label={t('pd_court_name')} value={form.court_name} onChangeText={v => setForm({ ...form, court_name: v })} testID="pd-add-court" maxLength={160} />
            <Btn label={t('pd_save')} onPress={add} busy={busy} disabled={!form.name.trim() || !form.phone.trim() || !form.case_number.trim()} testID="pd-add-save" />
          </Card>
        )}
        <Card title={t('pd_clients_n', { n: total })} testID="pd-client-list">
          {rows?.length === 0 && <Line muted testID="pd-clients-empty">{t(q ? 'pd_clients_none_match' : 'pd_clients_none')}</Line>}
          {rows?.map(c => (
            <View key={c.id} style={{ marginTop: 8 }} testID={`pd-client-${c.id}`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Line strong>{c.name}</Line>
                {c.unread > 0 && <Pill text={t('pd_unread_n', { n: c.unread })} tone="warn" />}
                {c.opted_out && <Pill text={t('pd_opted_out')} tone="danger" />}
                {!c.reminders_on && <Pill text={t('pd_reminders_off')} />}
              </View>
              <Line muted>{c.case_number} · {langLabel(c.lang)} · {c.next_court_date ? t('pd_next_court', { day: fmtDay(c.next_court_date) }) : t('pd_no_upcoming')}</Line>
              <Btn kind="ghost" label={t('pd_open_client')} onPress={() => navigation.navigate('PdClient', { clientId: c.id })} testID={`pd-open-client-${c.id}`} />
            </View>
          ))}
          {rows && rows.length < total && <Btn kind="ghost" label={t('pd_load_more')} onPress={() => load(page + 1)} testID="pd-clients-more" />}
        </Card>
      </ScrollView>
    </PdGate>
  );
}

export default React.memo(PdClientsScreen);
