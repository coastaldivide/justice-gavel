/**
 * Collateral taken on a bond: recorded with a numbered receipt (C-…), marked
 * returned with who received it back and when.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { api, apiErrorMessage } from '../../services/api';
import { fetchFile } from '../../services/fileDownload';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../constants/theme';
import { t, useLang } from '../../i18n';
import { Btn, Card, Chips, Field, Line, Pill } from './ui';
import { type BondDetail, type Collateral, type CollateralKind, COLLATERAL_KINDS, fmtDay, isIsoDate, money, parseCents, todayIso } from '../../services/bondDesk';

export function CollateralSection({ detail, reload }: { detail: BondDetail; reload: () => Promise<void> }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CollateralKind>('cash');
  const [desc, setDesc] = useState('');
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');
  const [on, setOn] = useState(todayIso());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState<{ id: number; to: string; on: string; err: string } | null>(null);

  const add = async () => {
    const cents = value.trim() ? parseCents(value) : 0;
    if (!desc.trim()) { setErr(t('bdk_err_description')); return; }
    if (cents === null) { setErr(t('bdk_err_amount')); return; }
    if (!from.trim()) { setErr(t('bdk_err_received_from')); return; }
    if (!isIsoDate(on) || on > todayIso()) { setErr(t('bdk_err_pay_date')); return; }
    setBusy(true); setErr('');
    try {
      await api.post(`/bond-desk/bonds/${detail.bond.id}/collateral`, { kind, description: desc.trim(), value_cents: cents, received_from: from.trim(), received_on: on });
      setOpen(false); setDesc(''); setValue(''); setFrom(''); showToast(t('bdk_saved'), 'success'); await reload();
    } catch (e) { setErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(false); }
  };

  const doReturn = async () => {
    if (!returning) return;
    if (!returning.to.trim()) { setReturning({ ...returning, err: t('bdk_err_returned_to') }); return; }
    if (!isIsoDate(returning.on) || returning.on > todayIso()) { setReturning({ ...returning, err: t('bdk_err_pay_date') }); return; }
    setBusy(true);
    try {
      await api.post(`/bond-desk/collateral/${returning.id}/return`, { returned_to: returning.to.trim(), returned_on: returning.on });
      setReturning(null); showToast(t('bdk_saved'), 'success'); await reload();
    } catch (e) { setReturning({ ...returning, err: apiErrorMessage(e, t('bdk_save_failed')) }); } finally { setBusy(false); }
  };

  const receipt = async (c: Collateral) => {
    try { await fetchFile(`/bond-desk/collateral/${c.id}/receipt.pdf`, `collateral-${c.receipt_no}.pdf`, 'application/pdf'); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_download_failed')), 'error'); }
  };

  return (
    <Card title={t('bdk_collateral')} testID="bond-collateral">
      {!detail.collateral.length && <Line muted>{t('bdk_collateral_none')}</Line>}
      {detail.collateral.map(c => (
        <View key={c.id} testID={`collateral-${c.id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Line strong>{c.receipt_no} · {t(`bdk_ck_${c.kind}`)} · {money(c.value_cents)}</Line>
          <Line>{c.description}</Line>
          <Line muted>{t('bdk_collateral_from', { name: c.received_from, date: fmtDay(c.received_on) })}</Line>
          {c.returned_on ? <Pill text={t('bdk_collateral_returned', { name: c.returned_to || '', date: fmtDay(c.returned_on) })} tone="ok" /> : <Pill text={t('bdk_collateral_held')} tone="warn" />}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Btn kind="ghost" label={t('bdk_receipt')} onPress={() => receipt(c)} testID={`collateral-receipt-${c.id}`} />
            {!c.returned_on && <Btn kind="ghost" label={t('bdk_collateral_return')} onPress={() => setReturning({ id: c.id, to: c.received_from, on: todayIso(), err: '' })} testID={`collateral-return-${c.id}`} />}
          </View>
          {returning?.id === c.id && (
            <>
              <Field label={t('bdk_returned_to')} value={returning.to} onChangeText={v => setReturning({ ...returning, to: v })} testID="collateral-return-to" />
              <Field label={t('bdk_returned_on')} value={returning.on} onChangeText={v => setReturning({ ...returning, on: v })} testID="collateral-return-on" placeholder={t('bdk_date_ph')} />
              {!!returning.err && <Line tone="danger">{returning.err}</Line>}
              <Btn label={t('bdk_save')} onPress={doReturn} busy={busy} testID="collateral-return-save" />
              <Btn kind="ghost" label={t('cancel')} onPress={() => setReturning(null)} />
            </>
          )}
        </View>
      ))}
      {!open ? <Btn kind="ghost" label={t('bdk_collateral_add')} onPress={() => { setErr(''); setOpen(true); }} testID="collateral-add" /> : (
        <>
          <Chips options={COLLATERAL_KINDS.map(k => ({ key: k, label: t(`bdk_ck_${k}`) }))} value={kind} onChange={setKind} testIDPrefix="collateral-kind" />
          <Field label={t('bdk_description')} value={desc} onChangeText={setDesc} testID="collateral-desc" />
          <Field label={t('bdk_value')} value={value} onChangeText={setValue} keyboardType="decimal-pad" testID="collateral-value" />
          <Field label={t('bdk_received_from')} value={from} onChangeText={setFrom} testID="collateral-from" autoCapitalize="words" />
          <Field label={t('bdk_received_on')} value={on} onChangeText={setOn} testID="collateral-on" placeholder={t('bdk_date_ph')} />
          {!!err && <Line tone="danger" testID="collateral-error">{err}</Line>}
          <Btn label={t('bdk_save')} onPress={add} busy={busy} testID="collateral-save" />
          <Btn kind="ghost" label={t('cancel')} onPress={() => setOpen(false)} />
        </>
      )}
    </Card>
  );
}
