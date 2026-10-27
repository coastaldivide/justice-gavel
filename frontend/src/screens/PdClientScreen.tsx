/**
 * PdClientScreen — one client of a public defender office (A11 steps 2–4; docs/PUBLIC_DEFENDER.md):
 *   - details (name, phone, language, case number), reminders on/off, remove the client
 *   - court dates: add, mark attended / rescheduled / missed / cancelled, remove; the texts planned
 *     and sent for each one, with the carrier's delivery status
 *   - the conversation: every text sent and received, newest first (older pages on demand);
 *     reply by text (sent as "{office}: …"; not to a number that replied STOP); mark handled
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { Btn, Card, Check, Field, Line, Notice, Pill, Row } from '../components/bondDesk/ui';
import { PdGate } from '../components/publicDefender/PdParts';
import { fmtDay, fmtWhen } from '../services/bondDesk';
import {
  type PdClientDetail, type PdMessage, type PdCourtStatus, PD_COURT_STATUSES, langLabel, statusLabel, stepLabel, usePdGet,
} from '../services/publicDefender';

const MAX_TEXT = 480;

function PdClientScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const clientId = Number((route?.params as { clientId?: number | string } | undefined)?.clientId);
  const detail = usePdGet<PdClientDetail>(Number.isFinite(clientId) ? `/pd/clients/${clientId}` : null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [messages, setMessages] = useState<PdMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [handled, setHandled] = useState(true);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [newDate, setNewDate] = useState({ court_date: '', court_time: '', court_name: '', room: '' });
  const [showTexts, setShowTexts] = useState<number | null>(null);

  const loadMessages = useCallback(async (before: number | null = null) => {
    try {
      const r = await api.get<{ messages: PdMessage[]; next_before: number | null; handled: boolean }>(`/pd/clients/${clientId}/messages`, { params: { before: before || undefined } });
      if (!mounted.current) return;
      setMessages(prev => (before ? [...prev, ...r.data.messages] : r.data.messages));
      setNextBefore(r.data.next_before); setHandled(r.data.handled);
    } catch { /* the detail load shows the problem */ }
  }, [clientId]);
  useFocusEffect(useCallback(() => { loadMessages(null); }, [loadMessages]));

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key); setProblem(prev => (prev ? '' : prev));
    try { await fn(); if (done) showToast(done, 'success'); await detail.reload(); await loadMessages(null); return true; } catch (e) { if (mounted.current) setProblem(apiErrorMessage(e, t('pd_failed'))); return false; }
    finally { if (mounted.current) setBusy(null); }
  };
  const d = detail.data;
  const c = d?.client;

  const send = () => run('send', async () => { await api.post(`/pd/clients/${clientId}/messages`, { body: reply }); setReply(''); }, t('pd_text_sent'));
  const setStatus = (id: number, status: PdCourtStatus) => run(`st-${id}`, () => api.patch(`/pd/court-dates/${id}`, { status }), t('pd_saved'));
  const addDate = () => run('add-date', async () => {
    await api.post(`/pd/clients/${clientId}/court-dates`, { court_date: newDate.court_date, court_time: newDate.court_time || null, court_name: newDate.court_name || null, room: newDate.room || null });
    setNewDate({ court_date: '', court_time: '', court_name: '', room: '' });
  }, t('pd_saved'));
  const removeDate = (id: number) => confirm(t('pd_remove_date_q'), t('pd_remove_date_body'), { destructive: true, confirmLabel: t('pd_remove') })
    .then(ok => { if (ok) run(`del-${id}`, () => api.delete(`/pd/court-dates/${id}`), t('pd_removed')); });
  const removeClient = () => confirm(t('pd_remove_client_q'), t('pd_remove_client_body'), { destructive: true, confirmLabel: t('pd_remove') })
    .then(async ok => {
      if (!ok) return;
      try { await api.delete(`/pd/clients/${clientId}`); showToast(t('pd_removed'), 'success'); navigation.goBack(); } catch (e) { setProblem(apiErrorMessage(e, t('pd_failed'))); }
    });

  return (
    <PdGate off={detail.off} notMember={detail.notMember} error={detail.error} hasData={!!d} testID="pd-client-screen">
      {d && c && (
        <ScrollView testID="pd-client-screen" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {!!problem && <Notice tone="error" text={problem} testID="pd-client-error" />}
          <Card title={c.name}>
            <Row label={t('pd_col_case_number')} value={c.case_number} />
            <Row label={t('pd_col_phone')} value={c.phone} />
            <Row label={t('pd_col_language')} value={langLabel(c.lang)} />
            {!!c.email && <Row label={t('pd_col_email')} value={c.email} />}
            {c.opted_out && <Notice text={t('pd_client_opted_out')} testID="pd-client-opted-out" />}
            <Check label={t('pd_reminders_toggle')} value={c.reminders_on} onChange={v => run('rem', () => api.patch(`/pd/clients/${clientId}`, { reminders_on: v }), t('pd_saved'))} testID="pd-reminders-toggle" />
            <Btn kind="danger" label={t('pd_remove_client')} onPress={removeClient} testID="pd-remove-client" />
          </Card>

          <Card title={t('pd_court_dates')} testID="pd-court-dates">
            {d.court_dates.length === 0 && <Line muted>{t('pd_court_dates_none')}</Line>}
            {d.court_dates.map(cd => (
              <View key={cd.id} style={{ marginTop: 10 }} testID={`pd-cd-${cd.id}`}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Line strong>{fmtDay(cd.court_date)}{cd.court_time ? ` ${cd.court_time}` : ''}</Line>
                  <Pill text={statusLabel(cd.status)} tone={cd.status === 'attended' ? 'ok' : cd.status === 'missed' ? 'danger' : 'muted'} />
                  {cd.status_source === 'reply' && <Pill text={t('pd_by_reply')} />}
                </View>
                {!!(cd.court_name || cd.room) && <Line muted>{[cd.court_name, cd.room ? t('pd_room', { room: cd.room }) : null].filter(Boolean).join(' · ')}</Line>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {PD_COURT_STATUSES.filter(s => s !== cd.status && s !== 'scheduled').map(s => (
                    <Btn key={s} kind="ghost" label={statusLabel(s)} onPress={() => setStatus(cd.id, s)} busy={busy === `st-${cd.id}`} testID={`pd-cd-${cd.id}-${s}`} />
                  ))}
                  <Btn kind="ghost" label={t(showTexts === cd.id ? 'pd_hide_texts' : 'pd_show_texts', { n: cd.texts.length })} onPress={() => setShowTexts(v => (v === cd.id ? null : cd.id))} testID={`pd-cd-${cd.id}-texts`} />
                  <Btn kind="danger" label={t('pd_remove')} onPress={() => removeDate(cd.id)} testID={`pd-cd-${cd.id}-remove`} />
                </View>
                {showTexts === cd.id && cd.texts.map((x, i) => (
                  <Line key={i} muted>{stepLabel(x.step)} · {fmtWhen(x.sent_at || x.send_at)} · {t(`pd_text_${x.status}`)}{x.delivery ? ` · ${x.delivery}` : ''}{x.reason ? ` (${x.reason})` : ''}</Line>
                ))}
              </View>
            ))}
            <View style={{ marginTop: 12 }} testID="pd-add-date-form">
              <Line strong>{t('pd_add_court_date')}</Line>
              <Field label={t('pd_court_date')} value={newDate.court_date} onChangeText={v => setNewDate({ ...newDate, court_date: v })} placeholder={t('pd_ph_date')} testID="pd-new-date" maxLength={10} />
              <Field label={t('pd_court_time')} value={newDate.court_time} onChangeText={v => setNewDate({ ...newDate, court_time: v })} placeholder={t('pd_ph_time')} testID="pd-new-time" maxLength={5} />
              <Field label={t('pd_court_name')} value={newDate.court_name} onChangeText={v => setNewDate({ ...newDate, court_name: v })} testID="pd-new-court" maxLength={160} />
              <Field label={t('pd_room_label')} value={newDate.room} onChangeText={v => setNewDate({ ...newDate, room: v })} testID="pd-new-room" maxLength={40} />
              <Btn label={t('pd_add_court_date')} onPress={addDate} disabled={!newDate.court_date} busy={busy === 'add-date'} testID="pd-new-save" />
            </View>
          </Card>

          <Card title={t('pd_conversation')} testID="pd-conversation">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <Pill text={t(handled ? 'pd_handled' : 'pd_open')} tone={handled ? 'ok' : 'warn'} />
              <Btn kind="ghost" label={t(handled ? 'pd_reopen' : 'pd_mark_handled')} onPress={() => run('handled', () => api.post(`/pd/clients/${clientId}/handled`, { handled: !handled }))} testID="pd-handled" />
            </View>
            <Field label={t('pd_reply')} value={reply} onChangeText={setReply} multiline maxLength={MAX_TEXT} testID="pd-reply" />
            <Line muted>{t('pd_reply_note', { n: MAX_TEXT - reply.length })}</Line>
            <Btn label={t('pd_send_text')} onPress={send} disabled={!reply.trim() || c.opted_out} busy={busy === 'send'} testID="pd-send" />
            {messages.length === 0 && <Line muted>{t('pd_no_messages')}</Line>}
            {messages.map(m => (
              <View key={m.id} style={{ marginTop: 8 }} testID={`pd-msg-${m.id}`}>
                <Line strong>{m.direction === 'in' ? c.name : (m.sent_by_name || t(`pd_kind_${m.kind}`))} · {fmtWhen(m.created_at)}</Line>
                <Line>{m.body}</Line>
                {m.direction === 'out' && <Line muted>{t(`pd_text_${m.status}`)}{m.delivery ? ` · ${m.delivery}` : ''}</Line>}
              </View>
            ))}
            {nextBefore && <Btn kind="ghost" label={t('pd_older')} onPress={() => loadMessages(nextBefore)} testID="pd-older" />}
          </Card>
        </ScrollView>
      )}
    </PdGate>
  );
}

export default React.memo(PdClientScreen);
