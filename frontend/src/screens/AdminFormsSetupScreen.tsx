/**
 * AdminFormsSetupScreen — the "set up my forms" queue for Justice Gavel staff (admin role; the
 * server checks it on every call: routes/admin/bdSetup.js). Every step is audit-logged.
 *
 *   1. An agency asks for set-up and uploads its surety PDFs (hidden from its library for now).
 *   2. Staff "Start" the request (in progress, assigned to them) and open the forms tool — the same
 *      mapping screen the agency uses (BondFormsScreen with setupRequestId) — on its behalf.
 *   3. "Hand over": the forms appear in the agency's library; the agency gets a push and an e-mail.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useStoredUser, isAdminUser } from '../hooks/useStoredUser';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Chips, Field, Line, Notice, Pill } from '../components/bondDesk/ui';
import { type SetupRequest, fmtWhen, setupTone } from '../services/bondDesk';

type Filter = 'open' | 'ready' | 'all';

function AdminFormsSetupScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { user, ready } = useStoredUser();
  const allowed = isAdminUser(user);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<SetupRequest[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ requests: SetupRequest[] }>('/admin/bd-setup', { params: { status: filter } });
      if (mounted.current) { setRows(r.data?.requests || []); setError(prev => (prev ? '' : prev)); }
    } catch (e) { if (mounted.current) { setRows([]); setError(apiErrorMessage(e, t('adm_load_error'))); } }
    finally { if (mounted.current) setRefreshing(false); }
  }, [filter]);
  useFocusEffect(useCallback(() => { if (allowed) load(); }, [allowed, load]));

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); await load(); } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); } finally { if (mounted.current) setBusy(null); }
  };
  const start = (r: SetupRequest) => act(`start-${r.id}`, async () => { await api.post(`/admin/bd-setup/${r.id}/start`, {}); showToast(t('adm_setup_started'), 'success'); });
  const openTool = (r: SetupRequest) => navigation.navigate('BondForms', { setupRequestId: r.id, agency: r.agency || '' });
  const handOver = (r: SetupRequest) => act(`ready-${r.id}`, async () => {
    await api.post(`/admin/bd-setup/${r.id}/ready`, { note: (notes[r.id] || '').trim() || null });
    showToast(t('adm_setup_handed_over'), 'success');
  });

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.textBrand} /></View>;
  if (!allowed) return <View testID="admin-not-allowed" style={{ flex: 1, backgroundColor: colors.bg, padding: 24 }}><Line>{t('adm_forbidden')}</Line></View>;

  return (
    <ScrollView testID="admin-forms-setup-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <Card title={t('adm_forms_setup')}>
        <Line muted>{t('adm_forms_setup_help')}</Line>
        <Chips options={(['open', 'ready', 'all'] as const).map(k => ({ key: k, label: t(`adm_setup_filter_${k}`) }))} value={filter} onChange={setFilter} testIDPrefix="setup-filter" />
      </Card>
      {!!error && <Notice text={error} tone="error" />}
      {rows === null && <ActivityIndicator style={{ marginTop: 24 }} color={colors.textBrand} />}
      {rows?.length === 0 && !error && <Card testID="setup-empty"><Line muted>{t('adm_empty')}</Line></Card>}
      {rows?.map(r => (
        <Card key={r.id} title={r.agency || r.agent_email || `#${r.id}`} testID={`setup-${r.id}`}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill text={t(`bdk_setup_st_${r.status}`)} tone={setupTone(r.status)} />
            <Pill text={t('adm_setup_forms', { n: r.form_count ?? r.forms.length })} />
          </View>
          {!!r.agent_email && <Line muted>{r.agent_email}</Line>}
          <Line muted>{t('adm_setup_asked', { date: fmtWhen(r.created_at) })}</Line>
          {!!r.note && <Line>{r.note}</Line>}
          {!!r.handled_by_name && <Line muted>{t('adm_setup_handled_by', { name: r.handled_by_name })}</Line>}
          {r.status === 'requested' && <Btn label={t('adm_setup_start')} onPress={() => start(r)} busy={busy === `start-${r.id}`} testID={`setup-start-${r.id}`} />}
          {r.status === 'in_progress' && (
            <>
              <Btn kind="ghost" label={t('adm_setup_open_tool')} onPress={() => openTool(r)} testID={`setup-tool-${r.id}`} />
              <Field label={t('adm_setup_note')} value={notes[r.id] || ''} onChangeText={v => setNotes(n => ({ ...n, [r.id]: v }))} multiline maxLength={1000} testID={`setup-note-${r.id}`} />
              <Btn label={t('adm_setup_hand_over')} onPress={() => handOver(r)} disabled={!(r.form_count ?? r.forms.length)} busy={busy === `ready-${r.id}`} testID={`setup-ready-${r.id}`} />
            </>
          )}
          {r.status === 'ready' && <Line tone="ok">{t('adm_setup_ready_on', { date: fmtWhen(r.ready_at) })}</Line>}
        </Card>
      ))}
    </ScrollView>
  );
}

export default React.memo(AdminFormsSetupScreen);
