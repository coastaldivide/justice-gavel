/**
 * Indemnitors (co-signers) on a bond: add, edit, remove. The server refuses to
 * remove one who is already on a sent packet (409 on_packet).
 */
import React, { useState } from 'react';
import { api, apiErrorMessage } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../../hooks/useConfirm';
import { t, useLang } from '../../i18n';
import { Btn, Card, Field, Line } from './ui';
import { type BondDetail, type Indemnitor, isIsoDate } from '../../services/bondDesk';

const EMPTY = { full_name: '', relationship: '', phone: '', email: '', address: '', dob: '', employer: '' };
type Draft = typeof EMPTY;

export function indemnitorBody(d: Draft): { body?: Record<string, string | null>; error?: string } {
  if (!d.full_name.trim()) return { error: 'bdk_err_name' };
  if (d.dob.trim() && !isIsoDate(d.dob.trim())) return { error: 'bdk_err_date' };
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return { error: 'bdk_err_email' };
  const body: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(d)) body[k] = v.trim() || null;
  return { body };
}

export function IndemnitorsSection({ detail, reload }: { detail: BondDetail; reload: () => Promise<void> }) {
  useLang();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!editing) return;
    const { body, error } = indemnitorBody(editing.draft);
    if (error) { setErr(t(error)); return; }
    setBusy(true); setErr('');
    try {
      if (editing.id) await api.patch(`/bond-desk/indemnitors/${editing.id}`, body);
      else await api.post(`/bond-desk/bonds/${detail.bond.id}/indemnitors`, body);
      setEditing(null); showToast(t('bdk_saved'), 'success'); await reload();
    } catch (e) { setErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(false); }
  };

  const remove = async (i: Indemnitor) => {
    if (!(await confirm(t('bdk_ind_remove_title', { name: i.full_name }), undefined, { confirmLabel: t('bdk_remove'), destructive: true }))) return;
    try { await api.delete(`/bond-desk/indemnitors/${i.id}`); showToast(t('bdk_removed'), 'success'); await reload(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
  };

  const set = (k: keyof Draft) => (v: string) => setEditing(p => (p ? { ...p, draft: { ...p.draft, [k]: v } } : p));

  return (
    <>
      <Card title={t('bdk_indemnitors')} testID="bond-indemnitors">
        {!detail.indemnitors.length && <Line muted testID="ind-empty">{t('bdk_ind_none')}</Line>}
        {detail.indemnitors.map(i => (
          <Card key={i.id} testID={`ind-${i.id}`} style={{ marginHorizontal: 0 }}>
            <Line strong>{i.full_name}{i.relationship ? ` · ${i.relationship}` : ''}</Line>
            {!!(i.phone || i.email) && <Line>{[i.phone, i.email].filter(Boolean).join(' · ')}</Line>}
            {!!i.address && <Line muted>{i.address}</Line>}
            {!!i.employer && <Line muted>{t('bdk_ind_employer')}: {i.employer}</Line>}
            <Btn kind="ghost" label={t('bdk_edit')} testID={`ind-edit-${i.id}`} onPress={() => {
              setErr('');
              setEditing({ id: i.id, draft: { full_name: i.full_name, relationship: i.relationship || '', phone: i.phone || '', email: i.email || '', address: i.address || '', dob: i.dob || '', employer: i.employer || '' } });
            }} />
            <Btn kind="danger" label={t('bdk_remove')} testID={`ind-remove-${i.id}`} onPress={() => remove(i)} />
          </Card>
        ))}
        {!editing && <Btn label={t('bdk_ind_add')} onPress={() => { setErr(''); setEditing({ id: null, draft: EMPTY }); }} testID="ind-add" />}
      </Card>
      {editing && (
        <Card title={editing.id ? t('bdk_edit') : t('bdk_ind_add')} testID="ind-form">
          <Field label={t('bdk_ind_name')} value={editing.draft.full_name} onChangeText={set('full_name')} testID="ind-f-full_name" autoCapitalize="words" />
          <Field label={t('bdk_ind_relationship')} value={editing.draft.relationship} onChangeText={set('relationship')} testID="ind-f-relationship" />
          <Field label={t('bdk_f_phone')} value={editing.draft.phone} onChangeText={set('phone')} testID="ind-f-phone" keyboardType="phone-pad" />
          <Field label={t('bdk_f_email')} value={editing.draft.email} onChangeText={set('email')} testID="ind-f-email" keyboardType="email-address" autoCapitalize="none" />
          <Field label={t('bdk_f_address')} value={editing.draft.address} onChangeText={set('address')} testID="ind-f-address" />
          <Field label={t('bdk_f_dob')} value={editing.draft.dob} onChangeText={set('dob')} testID="ind-f-dob" placeholder={t('bdk_date_ph')} />
          <Field label={t('bdk_ind_employer')} value={editing.draft.employer} onChangeText={set('employer')} testID="ind-f-employer" />
          {!!err && <Line tone="danger" testID="ind-error">{err}</Line>}
          <Btn label={t('bdk_save')} onPress={save} busy={busy} testID="ind-save" />
          <Btn kind="ghost" label={t('cancel')} onPress={() => setEditing(null)} />
        </Card>
      )}
    </>
  );
}
