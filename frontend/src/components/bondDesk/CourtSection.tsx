/**
 * Court dates of a bond (routes/bondDesk/courtDates.js): the hearings with add / edit / delete
 * and attended / missed / rescheduled, the per-bond switch and text language, the numbers that
 * get texts (each needs the agent's "the person gave me this number" confirmation; a number that
 * replied STOP is shown as such), and the timeline of every planned / sent text with its
 * delivery status.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, apiErrorMessage } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../../hooks/useConfirm';
import { t, useLang } from '../../i18n';
import { useTheme } from '../../constants/theme';
import { Btn, Card, Check, Chips, Field, Line, Pill, Row } from './ui';
import {
  type Access, type BdCourtDate, type BdReminder, type BondDetail, type CourtListing, type CourtStatus, type TextRecipient,
  courtDateBody, fmtDay, fmtWhen, money, reminderTone, tOr,
} from '../../services/bondDesk';

const EMPTY = { date: '', time: '', court: '', room: '' };
type Draft = typeof EMPTY;
const MARKS: CourtStatus[] = ['attended', 'rescheduled', 'missed', 'cancelled', 'scheduled'];
const LANGS = ['en', 'es', 'pt', 'vi'] as const;
const statusTone = (s: CourtStatus) => (s === 'attended' ? 'ok' : s === 'missed' ? 'danger' : s === 'scheduled' ? 'muted' : 'warn');

export function CourtSection({ detail, reload, access }: { detail: BondDetail; reload: () => Promise<void>; access: Access | null }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const bondId = detail.bond.id;
  const [data, setData] = useState<CourtListing | null>(null);
  const [texts, setTexts] = useState<BdReminder[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        api.get<CourtListing>(`/bond-desk/bonds/${bondId}/court-dates`),
        api.get<{ reminders: BdReminder[] }>(`/bond-desk/bonds/${bondId}/reminders`),
      ]);
      if (!mounted.current) return;
      setData(c.data); setTexts(r.data?.reminders || []); setError('');
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('bdk_load_failed'))); }
  }, [bondId]);
  useEffect(() => { load(); }, [load]);

  /** Run a change; the server answers with the fresh listing. */
  const run = async (key: string, fn: () => Promise<unknown>, ok = t('bdk_saved')) => {
    if (busy) return false;
    setBusy(key);
    try {
      await fn();
      showToast(ok, 'success');
      await load();
      await reload();   // bd_bonds.court_date (the next hearing) shows on the overview
      return true;
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); return false; }
    finally { if (mounted.current) setBusy(null); }
  };

  const save = async () => {
    if (!editing) return;
    const { body, error: bad } = courtDateBody(editing.draft);
    if (bad) { setFormErr(t(bad)); return; }
    setFormErr('');
    setBusy('save');
    try {
      if (editing.id) await api.patch(`/bond-desk/bonds/${bondId}/court-dates/${editing.id}`, body);
      else await api.post(`/bond-desk/bonds/${bondId}/court-dates`, body);
      setEditing(null);
      showToast(t('bdk_saved'), 'success');
      await load(); await reload();
    } catch (e) { setFormErr(apiErrorMessage(e, t('bdk_save_failed'))); }
    finally { if (mounted.current) setBusy(null); }
  };

  const remove = async (c: BdCourtDate) => {
    if (!(await confirm(t('bdk_cd_delete_q'), t('bdk_cd_delete_body'), { confirmLabel: t('bdk_cd_delete'), destructive: true }))) return;
    await run(`del-${c.id}`, () => api.delete(`/bond-desk/bonds/${bondId}/court-dates/${c.id}`), t('bdk_removed'));
  };
  const mark = (c: BdCourtDate, status: CourtStatus) => run(`mark-${c.id}`, () => api.patch(`/bond-desk/bonds/${bondId}/court-dates/${c.id}`, { status }));
  const toggle = (on: boolean) => run('switch', () => api.put(`/bond-desk/bonds/${bondId}/reminders`, { on }));
  const setLang = (lang: string) => run('lang', () => api.put(`/bond-desk/bonds/${bondId}/reminders`, { on: !!data?.reminders_on, lang }));
  const consent = (p: TextRecipient, on: boolean) => run(`consent-${p.to}-${p.indemnitor_id ?? 0}`,
    () => api.put(`/bond-desk/bonds/${bondId}/text-consent`, { to: p.to, indemnitor_id: p.indemnitor_id ?? undefined, consent_confirmed: on }));

  if (!data) {
    return (
      <Card testID="bond-court">
        {error ? <><Line tone="danger" testID="court-error">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></>
          : <ActivityIndicator color={colors.textBrand} />}
      </Card>
    );
  }

  const set = (k: keyof Draft) => (v: string) => setEditing(p => (p ? { ...p, draft: { ...p.draft, [k]: v } } : p));
  const timeLabel = (c: BdCourtDate) => [fmtDay(c.court_date), c.court_time].filter(Boolean).join(' · ');
  const where = (c: BdCourtDate) => [c.court_name, c.room ? t('bdk_cd_room', { room: c.room }) : null].filter(Boolean).join(' · ');
  const byDay = new Map<number, BdReminder[]>();
  for (const r of texts) { const l = byDay.get(r.court_date_id) || []; l.push(r); byDay.set(r.court_date_id, l); }

  return (
    <View testID="bond-court">
      <Card title={t('bdk_cd_title')}>
        <Line muted>{t('bdk_cd_intro', { tz: data.time_zone, price: money(access?.text_cents ?? 5) })}</Line>
        {!data.texts_live && <Line tone="warn" testID="court-texts-off">{t('bdk_texts_off')}</Line>}
        {data.bond_status !== 'active' && <Line tone="warn" testID="court-inactive">{t('bdk_cd_inactive')}</Line>}
        <Row label={t('bdk_cd_switch')} value={data.reminders_on ? t('bdk_cd_on') : t('bdk_cd_off')} testID="court-switch-state" />
        <Btn kind="ghost" testID="court-switch" busy={busy === 'switch'} label={data.reminders_on ? t('bdk_cd_turn_off') : t('bdk_cd_turn_on')} onPress={() => toggle(!data.reminders_on)} />
        <Line strong>{t('bdk_cd_lang')}</Line>
        <Chips options={LANGS.map(l => ({ key: l, label: t(`bdk_lang_${l}`) }))} value={data.text_lang} onChange={setLang} testIDPrefix="court-lang" />
      </Card>

      <Card title={t('bdk_cd_numbers')} testID="court-recipients">
        <Line muted>{t('bdk_cd_numbers_help')}</Line>
        {data.recipients.map(p => (
          <View key={`${p.to}-${p.indemnitor_id ?? 0}`} testID={`court-recipient-${p.to}-${p.indemnitor_id ?? 0}`} style={{ marginTop: 10 }}>
            <Line strong>{p.name} · {t(`bdk_cd_role_${p.to}`)}</Line>
            {!p.phone ? <Line muted>{t('bdk_cd_no_number')}</Line> : (
              <>
                <Line>{p.phone_masked}</Line>
                {p.opted_out && <Pill tone="danger" text={t('bdk_cd_stopped')} />}
                <Check label={t('bdk_consent_text')} value={p.consent} onChange={v => consent(p, v)} testID={`court-consent-${p.to}-${p.indemnitor_id ?? 0}`} />
                {p.consent && !!p.consent_at && <Line muted>{t('bdk_cd_confirmed', { when: fmtWhen(p.consent_at) })}</Line>}
              </>
            )}
          </View>
        ))}
      </Card>

      <Card title={t('bdk_cd_hearings')} testID="court-hearings">
        {!data.court_dates.length && <Line muted testID="court-empty">{t('bdk_cd_none')}</Line>}
        {data.court_dates.map(c => (
          <Card key={c.id} testID={`court-date-${c.id}`} style={{ marginHorizontal: 0 }}>
            <Line strong>{timeLabel(c)}</Line>
            {!!where(c) && <Line>{where(c)}</Line>}
            <Pill tone={statusTone(c.status)} text={t(`bdk_cd_st_${c.status}`) + (c.status_source === 'reply' ? ` · ${t('bdk_cd_by_reply')}` : '')} />
            {!!c.asked_at && <Line muted>{t('bdk_cd_asked', { when: fmtWhen(c.asked_at) })}</Line>}
            <Line muted>{t('bdk_cd_mark')}</Line>
            <Chips options={MARKS.filter(m => m !== c.status).map(m => ({ key: m, label: t(`bdk_cd_st_${m}`) }))} value={null}
              onChange={m => mark(c, m)} testIDPrefix={`court-mark-${c.id}`} />
            <Btn kind="ghost" label={t('bdk_edit')} testID={`court-edit-${c.id}`} onPress={() => {
              setFormErr('');
              setEditing({ id: c.id, draft: { date: c.court_date, time: c.court_time || '', court: c.court_name || '', room: c.room || '' } });
            }} />
            <Btn kind="danger" label={t('bdk_cd_delete')} testID={`court-delete-${c.id}`} busy={busy === `del-${c.id}`} onPress={() => remove(c)} />
          </Card>
        ))}
        {!editing && <Btn label={t('bdk_cd_add')} testID="court-add" onPress={() => { setFormErr(''); setEditing({ id: null, draft: { ...EMPTY, court: detail.bond.court_name || '' } }); }} />}
      </Card>

      {editing && (
        <Card title={editing.id ? t('bdk_edit') : t('bdk_cd_add')} testID="court-form">
          <Field label={t('bdk_cd_f_date')} value={editing.draft.date} onChangeText={set('date')} placeholder={t('bdk_date_ph')} testID="court-f-date" maxLength={10} />
          <Field label={t('bdk_cd_f_time')} value={editing.draft.time} onChangeText={set('time')} placeholder={t('bdk_cd_time_ph')} testID="court-f-time" maxLength={5} />
          <Field label={t('bdk_cd_f_court')} value={editing.draft.court} onChangeText={set('court')} testID="court-f-court" maxLength={160} />
          <Field label={t('bdk_cd_f_room')} value={editing.draft.room} onChangeText={set('room')} testID="court-f-room" maxLength={60} />
          {!!formErr && <Line tone="danger" testID="court-form-error">{formErr}</Line>}
          <Btn label={t('bdk_cd_save')} onPress={save} busy={busy === 'save'} testID="court-save" />
          <Btn kind="ghost" label={t('cancel')} onPress={() => setEditing(null)} testID="court-cancel" />
        </Card>
      )}

      <Card title={t('bdk_cd_timeline')} testID="court-timeline">
        {!texts.length && <Line muted testID="court-timeline-empty">{t('bdk_cd_timeline_none')}</Line>}
        {data.court_dates.filter(c => byDay.has(c.id)).map(c => (
          <View key={c.id} style={{ marginTop: 8 }}>
            <Line strong>{timeLabel(c)}</Line>
            {(byDay.get(c.id) || []).map(r => (
              <View key={r.id} testID={`court-text-${r.id}`} style={{ marginTop: 6 }}>
                <Line>{t(`bdk_cd_step_${r.step}`)} · {r.name || t(`bdk_cd_role_${r.signer_type}`)} · {r.to_masked}</Line>
                <Line muted>{fmtWhen(r.sent_at || r.send_at)}</Line>
                <Pill tone={reminderTone(r)} text={[
                  t(`bdk_cd_rs_${r.status}`),
                  r.delivery_status ? tOr(`bdk_cd_dl_${r.delivery_status}`, r.delivery_status) : null,
                  r.reason ? tOr(`bdk_cd_reason_${r.reason}`, r.reason) : null,
                ].filter(Boolean).join(' · ')} />
              </View>
            ))}
          </View>
        ))}
      </Card>
    </View>
  );
}
