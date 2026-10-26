/**
 * Bond overview: the case file (edit), status changes (only the moves the
 * server allows — services/bondDesk TRANSITIONS), the power executed on the
 * bond, and enrolling the defendant in check-ins.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../constants/theme';
import { t, useLang } from '../../i18n';
import { Btn, Card, Chips, Field, Line, Row } from './ui';
import { BondFields, bondBody, type BondDraft } from './bondFields';
import { type BondDetail, type BondStatus, type Power, TRANSITIONS, centsToInput, fmtDay, isIsoDate, money, parseCents, todayIso, transitionNeeds } from '../../services/bondDesk';

export const draftFromBond = (b: BondDetail['bond']): BondDraft => ({
  defendant_name: b.defendant_name || '', bond_amount: centsToInput(b.bond_amount_cents), defendant_phone: b.defendant_phone || '',
  defendant_email: b.defendant_email || '', defendant_dob: b.defendant_dob || '', defendant_address: b.defendant_address || '',
  case_number: b.case_number || '', court_name: b.court_name || '', county: b.county || '', state: b.state || '',
  court_date: b.court_date || '', charges: b.charges || '', surety_name: b.surety_name || '', notes: b.notes || '',
});

export function OverviewSection({ detail, reload, onCheckins }: { detail: BondDetail; reload: () => Promise<void>; onCheckins: () => void }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const b = detail.bond;
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<BondDraft>(() => draftFromBond(b));
  const [editErr, setEditErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [to, setTo] = useState<BondStatus | null>(null);
  const [date, setDate] = useState(todayIso());
  const [deadline, setDeadline] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [statusErr, setStatusErr] = useState('');

  const [powers, setPowers] = useState<Power[] | null>(null);
  const [powerErr, setPowerErr] = useState('');

  const saveEdit = async () => {
    const { body, error } = bondBody(draft);
    if (error) { setEditErr(t(error)); return; }
    setBusy('edit'); setEditErr('');
    try {
      await api.patch(`/bond-desk/bonds/${b.id}`, body);
      setEditOpen(false); showToast(t('bdk_saved'), 'success'); await reload();
    } catch (e) { setEditErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };

  const changeStatus = async () => {
    if (!to) return;
    const need = transitionNeeds(b.status, to);
    if (need.date && !isIsoDate(date)) { setStatusErr(t('bdk_err_date')); return; }
    if (need.deadline && !isIsoDate(deadline)) { setStatusErr(t('bdk_err_deadline')); return; }
    const cents = need.amount ? parseCents(amount) : null;
    if (need.amount && (cents === null || cents <= 0)) { setStatusErr(t('bdk_err_amount')); return; }
    setBusy('status'); setStatusErr('');
    try {
      await api.post(`/bond-desk/bonds/${b.id}/status`, {
        status: to, date: need.date ? date : undefined, deadline_on: need.deadline ? deadline : undefined,
        amount_cents: need.amount ? cents : undefined, note: note.trim() || undefined,
      });
      setTo(null); setNote(''); setAmount(''); setDeadline('');
      showToast(t('bdk_status_changed', { status: t(`bdk_st_${to}`) }), 'success');
      await reload();
    } catch (e) { setStatusErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };

  const loadPowers = async () => {
    setPowerErr('');
    try {
      const r = await api.get<{ powers: Power[] }>('/bond-desk/powers', { params: { status: 'available' } });
      setPowers((r.data?.powers || []).filter(p => p.limit_cents >= b.bond_amount_cents && (!p.expires_on || p.expires_on >= todayIso())));
    } catch (e) { setPowerErr(apiErrorMessage(e, t('bdk_load_failed'))); }
  };
  const assignPower = async (p: Power) => {
    setBusy(`power-${p.id}`); setPowerErr('');
    try {
      await api.post(`/bond-desk/bonds/${b.id}/power`, { power_id: p.id });
      setPowers(null); showToast(t('bdk_power_assigned', { number: p.number }), 'success'); await reload();
    } catch (e) { setPowerErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };

  const enrollCheckins = async () => {
    if (!b.defendant_phone && !b.defendant_email) { showToast(t('ckm_need_contact'), 'error'); return; }
    setBusy('checkin');
    try {
      const r = await api.post<{ enrollment: { id: number } }>('/checkins/enroll', {
        defendant_name: b.defendant_name, defendant_phone: b.defendant_phone || undefined, defendant_email: b.defendant_email || undefined,
        case_number: b.case_number || undefined, court_date: b.court_date && b.court_date >= todayIso() ? b.court_date : undefined, check_in_freq: 'daily',
      });
      await api.patch(`/bond-desk/bonds/${b.id}`, { checkin_enrollment_id: r.data.enrollment.id });
      showToast(t('bdk_checkins_enrolled'), 'success'); await reload();
    } catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); } finally { setBusy(null); }
  };

  const moves = TRANSITIONS[b.status] || [];
  const need = to ? transitionNeeds(b.status, to) : null;
  const dash = '—';

  return (
    <>
      <Card title={t('bdk_case_file')} testID="bond-overview">
        <Row label={t('bdk_f_defendant_name')} value={b.defendant_name} />
        <Row label={t('bdk_f_bond_amount')} value={money(b.bond_amount_cents)} testID="bond-amount" />
        <Row label={t('bdk_status')} value={t(`bdk_st_${b.status}`)} testID="bond-status" />
        <Row label={t('bdk_f_case_number')} value={b.case_number || dash} />
        <Row label={t('bdk_f_court_name')} value={[b.court_name, b.county, b.state].filter(Boolean).join(', ') || dash} />
        <Row label={t('bdk_f_court_date')} value={b.court_date ? fmtDay(b.court_date) : dash} />
        <Row label={t('bdk_f_phone')} value={b.defendant_phone || dash} />
        <Row label={t('bdk_f_email')} value={b.defendant_email || dash} />
        <Row label={t('bdk_f_surety')} value={b.surety_name || dash} />
        {!!b.posted_on && <Row label={t('bdk_posted_on')} value={fmtDay(b.posted_on)} />}
        {!!b.forfeited_on && <Row label={t('bdk_forfeited_on')} value={fmtDay(b.forfeited_on)} />}
        {!!b.forfeiture_deadline_on && <Row label={t('bdk_deadline_on')} value={fmtDay(b.forfeiture_deadline_on)} testID="bond-deadline" />}
        {!!b.discharged_on && <Row label={t('bdk_discharged_on')} value={fmtDay(b.discharged_on)} />}
        {b.forfeiture_paid_cents != null && <Row label={t('bdk_forfeiture_paid')} value={money(b.forfeiture_paid_cents)} />}
        {!!b.charges && <Line>{t('bdk_f_charges')}: {b.charges}</Line>}
        {!!b.notes && <Line muted>{b.notes}</Line>}
        <Btn kind="ghost" label={t('bdk_edit')} onPress={() => { setDraft(draftFromBond(b)); setEditErr(''); setEditOpen(true); }} testID="bond-edit" />
      </Card>

      <Card title={t('bdk_change_status')} testID="bond-status-card">
        {!moves.length ? <Line muted testID="bond-status-final">{t('bdk_status_final')}</Line> : (
          <>
            <Chips options={moves.map(k => ({ key: k, label: k === 'active' && b.status === 'forfeited' ? t('bdk_reinstate') : t(`bdk_st_${k}`) }))}
              value={to} onChange={k => { setTo(k); setStatusErr(''); }} testIDPrefix="bond-move" />
            {!!to && need && (
              <>
                {need.date && <Field label={t(`bdk_move_date_${to}`)} value={date} onChangeText={setDate} testID="bond-move-date" placeholder={t('bdk_date_ph')} />}
                {need.deadline && <Field label={t('bdk_deadline_on')} value={deadline} onChangeText={setDeadline} testID="bond-move-deadline" placeholder={t('bdk_date_ph')} />}
                {need.deadline && <Line muted>{t('bdk_deadline_help')}</Line>}
                {need.amount && <Field label={t('bdk_forfeiture_paid')} value={amount} onChangeText={setAmount} testID="bond-move-amount" keyboardType="decimal-pad" />}
                <Field label={t('bdk_note_optional')} value={note} onChangeText={setNote} testID="bond-move-note" />
                {!!statusErr && <Line tone="danger" testID="bond-move-error">{statusErr}</Line>}
                <Btn label={t('bdk_confirm_status', { status: t(`bdk_st_${to}`) })} onPress={changeStatus} busy={busy === 'status'} testID="bond-move-save" />
              </>
            )}
          </>
        )}
      </Card>

      <Card title={t('bdk_power')} testID="bond-power">
        {b.power ? (
          <>
            <Row label={t('bdk_power_number')} value={b.power.number} testID="bond-power-number" />
            <Row label={t('bdk_f_surety')} value={b.power.surety_name} />
            <Row label={t('bdk_power_limit')} value={money(b.power.limit_cents)} />
          </>
        ) : (
          <>
            <Line muted>{t('bdk_no_power')}</Line>
            {powers === null
              ? <Btn kind="ghost" label={t('bdk_assign_power')} onPress={loadPowers} testID="bond-power-load" />
              : !powers.length ? <Line tone="warn" testID="bond-power-none">{t('bdk_no_fitting_power', { amount: money(b.bond_amount_cents) })}</Line>
              : powers.map(p => (
                <TouchableOpacity key={p.id} accessibilityRole="button" testID={`bond-power-pick-${p.id}`} onPress={() => assignPower(p)}
                  style={{ minHeight: 44, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Line strong>{p.number} · {p.surety_name}</Line>
                  <Line muted>{t('bdk_power_limit')}: {money(p.limit_cents)}{p.expires_on ? ` · ${t('bdk_expires', { date: fmtDay(p.expires_on) })}` : ''}</Line>
                </TouchableOpacity>
              ))}
            {!!powerErr && <Line tone="danger" testID="bond-power-error">{powerErr}</Line>}
          </>
        )}
      </Card>

      <Card title={t('bdk_checkins')} testID="bond-checkins">
        {b.checkin_enrollment_id
          ? <><Line tone="ok">{t('bdk_checkins_on')}</Line><Btn kind="ghost" label={t('bd_open_checkins')} onPress={onCheckins} testID="bond-checkins-open" /></>
          : <><Line muted>{t('bdk_checkins_off')}</Line><Btn kind="ghost" label={t('bdk_checkins_enroll')} onPress={enrollCheckins} busy={busy === 'checkin'} testID="bond-checkins-enroll" /></>}
      </Card>

      <Modal visible={editOpen} animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View>
              <Card title={t('bdk_edit')}>
                <BondFields draft={draft} set={(k, v) => setDraft(p => ({ ...p, [k]: v }))} />
                {!!editErr && <Line tone="danger" testID="bond-edit-error">{editErr}</Line>}
                <Btn label={t('bdk_save')} onPress={saveEdit} busy={busy === 'edit'} testID="bond-edit-save" />
                <Btn kind="ghost" label={t('cancel')} onPress={() => setEditOpen(false)} />
              </Card>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
