/**
 * PdOfficeScreen — a public defender office's dashboard (A11 step 5; docs/PUBLIC_DEFENDER.md,
 * docs/PUBLIC_DEFENDER_PILOT.md). Members of the office only; hidden while the ⚖ setting is off.
 *
 *   - the consent basis: an office admin ticks the statement before any client is texted (who and when shown)
 *   - clients, court dates in the next 30 days, unread texts, opt-outs; links to Clients, Inbox, Staff
 *   - appearance per month (attended / rescheduled / missed / no answer) and the rate, with its definition
 *   - the office's own 90-day baseline (entered by an office admin, as the office supplies it) next to
 *     the same rate measured since the pilot start — counts only, no claim about cause
 *   - messages per month; export of everything (ZIP of CSV files)
 */
import React, { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { fetchFile } from '../services/fileDownload';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Check, Field, Line, Notice, Pill, Row } from '../components/bondDesk/ui';
import { PdGate } from '../components/publicDefender/PdParts';
import { fmtDay, fmtWhen } from '../services/bondDesk';
import { type PdDashboard, type PdRole, pct, usePdGet } from '../services/publicDefender';

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function PdOfficeScreen({ navigation }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const dash = usePdGet<PdDashboard>('/pd/dashboard');
  const me = usePdGet<{ role: PdRole; consent_statement: string; texts_live: boolean }>('/pd/office');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [editBase, setEditBase] = useState(false);
  const [b, setB] = useState({ pilot_start: '', from: '', to: '', hearings: '', appeared: '', missed: '', source: '' });
  useFocusEffect(React.useCallback(() => { dash.reload(); }, [dash.reload]));   // eslint-disable-line react-hooks/exhaustive-deps

  const d = dash.data;
  const admin = me.data?.role === 'admin';
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key); setProblem(prev => (prev ? '' : prev));
    try { await fn(); if (done) showToast(done, 'success'); await dash.reload(); } catch (e) { setProblem(apiErrorMessage(e, t('pd_failed'))); }
    finally { setBusy(null); }
  };
  const consent = () => run('consent', () => api.post('/pd/office/consent', { agree: true }), t('pd_consent_saved'));
  const startBaseline = () => {
    const x = d?.baseline;
    setB({ pilot_start: d?.office.pilot_start || '', from: x?.from || '', to: x?.to || '', hearings: x ? String(x.hearings) : '', appeared: x ? String(x.appeared) : '', missed: x ? String(x.missed) : '', source: x?.source || '' });
    setEditBase(true);
  };
  const saveBaseline = () => {
    if (![b.from, b.to].every(isDay) || (b.pilot_start && !isDay(b.pilot_start))) { setProblem(t('pd_bad_day')); return; }
    run('baseline', async () => {
      await api.put('/pd/office/baseline', { pilot_start: b.pilot_start || null, from: b.from, to: b.to, hearings: Number(b.hearings), appeared: Number(b.appeared), missed: Number(b.missed), source: b.source });
      setEditBase(false);
    }, t('pd_saved'));
  };
  const exportAll = async () => {
    setBusy('export');
    try { await fetchFile('/pd/export.zip', `public-defender-export-${d?.today || 'today'}.zip`, 'application/zip'); } catch (e) { showToast(apiErrorMessage(e, t('pd_download_failed')), 'error'); }
    finally { setBusy(null); }
  };

  return (
    <PdGate off={dash.off} notMember={dash.notMember} error={dash.error} hasData={!!d} testID="pd-office-screen">
      {d && (
        <ScrollView testID="pd-office-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => dash.reload()} />}>
          <Card title={d.office.name}>
            <Line muted>{[d.office.county, d.office.state].filter(Boolean).join(', ')}{d.office.phone ? ` · ${d.office.phone}` : ''}</Line>
            {me.data && !me.data.texts_live && <Notice text={t('pd_texts_not_live')} testID="pd-texts-not-live" />}
          </Card>
          {!!problem && <Notice tone="error" text={problem} testID="pd-office-error" />}

          <Card title={t('pd_consent_title')} testID="pd-consent">
            {d.office.consent ? (
              <>
                <Line tone="ok">{t('pd_consent_done', { name: d.office.consent.by_name || '—', when: fmtWhen(d.office.consent.at) })}</Line>
                <Line muted>{d.office.consent.text}</Line>
              </>
            ) : admin ? (
              <>
                <Line>{t('pd_consent_needed')}</Line>
                <Check label={t('pd_consent_statement')} value={agree} onChange={setAgree} testID="pd-consent-check" />
                <Btn label={t('pd_consent_save')} onPress={consent} disabled={!agree} busy={busy === 'consent'} testID="pd-consent-save" />
              </>
            ) : <Line tone="warn">{t('pd_consent_wait_admin')}</Line>}
          </Card>

          <Card title={t('pd_overview')}>
            <Row label={t('pd_clients')} value={String(d.clients)} testID="pd-count-clients" />
            <Row label={t('pd_upcoming_30')} value={String(d.upcoming_30_days)} />
            <Row label={t('pd_unread')} value={String(d.unread)} testID="pd-count-unread" />
            <Row label={t('pd_opt_outs')} value={String(d.opt_outs)} testID="pd-count-optouts" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Btn label={t('pd_clients')} onPress={() => navigation.navigate('PdClients' as never)} testID="pd-open-clients" />
              <Btn kind="ghost" label={d.unread ? t('pd_inbox_n', { n: d.unread }) : t('pd_inbox')} onPress={() => navigation.navigate('PdInbox' as never)} testID="pd-open-inbox" />
              <Btn kind="ghost" label={t('pd_staff')} onPress={() => navigation.navigate('PdStaff' as never)} testID="pd-open-staff" />
            </View>
          </Card>

          <Card title={t('pd_compare_title')} testID="pd-compare">
            <Line muted>{t('pd_rate_definition')}</Line>
            <Row label={t('pd_baseline')} value={d.baseline ? `${pct(d.baseline.appearance_rate)} · ${t('pd_counts_short', { a: d.baseline.appeared, m: d.baseline.missed, h: d.baseline.hearings })}` : t('pd_baseline_none')} testID="pd-baseline-rate" />
            {d.baseline && <Line muted>{t('pd_baseline_period', { from: fmtDay(d.baseline.from), to: fmtDay(d.baseline.to), source: d.baseline.source })}</Line>}
            <Row label={t('pd_pilot')} value={d.pilot ? `${pct(d.pilot.appearance_rate)} · ${t('pd_counts_pilot', { a: d.pilot.attended, m: d.pilot.missed, r: d.pilot.rescheduled, n: d.pilot.no_answer })}` : t('pd_pilot_none')} testID="pd-pilot-rate" />
            {d.pilot && <Line muted>{t('pd_pilot_since', { day: fmtDay(d.pilot.since) })}</Line>}
            <Line muted>{t('pd_no_claim')}</Line>
            {admin && !editBase && <Btn kind="ghost" label={t(d.baseline ? 'pd_baseline_edit' : 'pd_baseline_add')} onPress={startBaseline} testID="pd-baseline-edit" />}
            {admin && editBase && (
              <View testID="pd-baseline-form">
                <Line muted>{t('pd_baseline_help')}</Line>
                <Field label={t('pd_pilot_start')} value={b.pilot_start} onChangeText={v => setB({ ...b, pilot_start: v })} placeholder={t('pd_ph_date')} testID="pd-b-pilot" maxLength={10} />
                <Field label={t('pd_b_from')} value={b.from} onChangeText={v => setB({ ...b, from: v })} placeholder={t('pd_ph_date')} testID="pd-b-from" maxLength={10} />
                <Field label={t('pd_b_to')} value={b.to} onChangeText={v => setB({ ...b, to: v })} placeholder={t('pd_ph_date')} testID="pd-b-to" maxLength={10} />
                <Field label={t('pd_b_hearings')} value={b.hearings} onChangeText={v => setB({ ...b, hearings: v.replace(/\D/g, '') })} keyboardType="number-pad" testID="pd-b-hearings" maxLength={8} />
                <Field label={t('pd_b_appeared')} value={b.appeared} onChangeText={v => setB({ ...b, appeared: v.replace(/\D/g, '') })} keyboardType="number-pad" testID="pd-b-appeared" maxLength={8} />
                <Field label={t('pd_b_missed')} value={b.missed} onChangeText={v => setB({ ...b, missed: v.replace(/\D/g, '') })} keyboardType="number-pad" testID="pd-b-missed" maxLength={8} />
                <Field label={t('pd_b_source')} value={b.source} onChangeText={v => setB({ ...b, source: v })} testID="pd-b-source" maxLength={500} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Btn label={t('pd_save')} onPress={saveBaseline} busy={busy === 'baseline'} testID="pd-b-save" />
                  <Btn kind="ghost" label={t('pd_cancel')} onPress={() => setEditBase(false)} />
                </View>
              </View>
            )}
          </Card>

          <Card title={t('pd_appearance_title')} testID="pd-appearance">
            {d.appearance.length === 0 && <Line muted>{t('pd_appearance_none')}</Line>}
            {d.appearance.map(m => (
              <View key={m.month} testID={`pd-month-${m.month}`} style={{ marginTop: 6 }}>
                <Line strong>{m.month} · {pct(m.appearance_rate)}</Line>
                <Line muted>{t('pd_month_counts', { h: m.hearings, a: m.attended, r: m.rescheduled, m: m.missed, n: m.no_answer })}</Line>
              </View>
            ))}
          </Card>

          <Card title={t('pd_upcoming_title')}>
            {d.upcoming.length === 0 && <Line muted>{t('pd_upcoming_none')}</Line>}
            {d.upcoming.map(u => (
              <View key={u.court_date_id} style={{ marginTop: 6 }}>
                <Line strong>{fmtDay(u.court_date)}{u.court_time ? ` ${u.court_time}` : ''} · {u.name}</Line>
                <Line muted>{u.case_number}{u.court_name ? ` · ${u.court_name}` : ''}</Line>
                <Btn kind="ghost" label={t('pd_open_client')} onPress={() => navigation.navigate('PdClient', { clientId: u.client_id })} testID={`pd-upcoming-${u.court_date_id}`} />
              </View>
            ))}
          </Card>

          <Card title={t('pd_messages_title')}>
            {d.messages.length === 0 && <Line muted>{t('pd_messages_none')}</Line>}
            {d.messages.map(m => <Line key={m.month}>{m.month}: {t('pd_messages_counts', { s: m.sent, r: m.received, st: m.staff_replies, f: m.failed })}</Line>)}
            <Line muted>{t('pd_texts_included')}</Line>
          </Card>

          <Card title={t('pd_export_title')}>
            <Line muted>{t('pd_export_line')}</Line>
            <Btn label={t('pd_export')} onPress={exportAll} busy={busy === 'export'} testID="pd-export" />
            {d.opt_outs > 0 && <Pill text={t('pd_opt_outs_n', { n: d.opt_outs })} tone="warn" />}
          </Card>
        </ScrollView>
      )}
    </PdGate>
  );
}

export default React.memo(PdOfficeScreen);
