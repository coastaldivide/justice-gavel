/**
 * Money on a bond: premium and fees owed (charges), payments received with
 * numbered receipts, the balance, the payment plan and payment reminders.
 *
 * Nothing is computed here that the server does not also check: amounts are
 * parsed exactly (services/bondDesk parseCents), a payment above the balance
 * is refused before it is sent (and by the server, 409 over_balance), and a
 * plan can only be saved when its installments add up to the total charges.
 */
import React, { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../../services/api';
import { fetchFile } from '../../services/fileDownload';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../constants/theme';
import { t, useLang } from '../../i18n';
import { Btn, Card, Check, Chips, Field, Line, Pill, Row, useTextPrompt } from './ui';
import { type Access, type BondDetail, type Charge, type PayMethod, type Payment, type PlanRow, PAY_METHODS, centsToInput, checkPlan, fmtDay, isIsoDate, money, parseCents, splitPlan, todayIso } from '../../services/bondDesk';

const instTone = { paid: 'ok', partial: 'warn', due: 'muted', overdue: 'danger' } as const;

export function MoneySection({ detail, reload, access }: { detail: BondDetail; reload: () => Promise<void>; access: Access | null }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const prompt = useTextPrompt();
  const b = detail.bond;
  const m = detail.money;
  const [busy, setBusy] = useState<string | null>(null);

  // charge form
  const [chargeOpen, setChargeOpen] = useState(false);
  const [kind, setKind] = useState<'premium' | 'fee'>('premium');
  const [chargeAmt, setChargeAmt] = useState('');
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeErr, setChargeErr] = useState('');
  // payment form
  const [payOpen, setPayOpen] = useState(false);
  const [payAmt, setPayAmt] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [payer, setPayer] = useState('');
  const [payOn, setPayOn] = useState(todayIso());
  const [ref, setRef] = useState('');
  const [payErr, setPayErr] = useState('');
  // plan editor
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [splitN, setSplitN] = useState('4');
  const [splitFirst, setSplitFirst] = useState(todayIso());
  const [splitEvery, setSplitEvery] = useState('30');
  const [planErr, setPlanErr] = useState('');
  // reminder
  const [remOpen, setRemOpen] = useState(false);
  const [remTo, setRemTo] = useState<string>('defendant');
  const [remChannel, setRemChannel] = useState<'sms' | 'email'>('sms');
  const [remConsent, setRemConsent] = useState(false);
  const [remErr, setRemErr] = useState('');

  const addCharge = async () => {
    const cents = parseCents(chargeAmt);
    if (cents === null || cents <= 0) { setChargeErr(t('bdk_err_amount')); return; }
    setBusy('charge'); setChargeErr('');
    try {
      await api.post(`/bond-desk/bonds/${b.id}/charges`, { kind, amount_cents: cents, description: chargeDesc.trim() || null });
      setChargeOpen(false); setChargeAmt(''); setChargeDesc(''); showToast(t('bdk_saved'), 'success'); await reload();
    } catch (e) { setChargeErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };
  const voidCharge = async (c: Charge) => {
    const reason = await prompt.ask(t('bdk_void_charge_title', { amount: money(c.amount_cents) }), t('bdk_void_reason'));
    if (!reason) return;
    try { await api.post(`/bond-desk/charges/${c.id}/void`, { reason }); showToast(t('bdk_voided'), 'success'); await reload(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
  };

  const addPayment = async () => {
    const cents = parseCents(payAmt);
    if (cents === null || cents <= 0) { setPayErr(t('bdk_err_amount')); return; }
    if (cents > m.balance_cents) { setPayErr(t('bdk_err_over_balance', { balance: money(m.balance_cents) })); return; }
    if (!payer.trim()) { setPayErr(t('bdk_err_payer')); return; }
    if (!isIsoDate(payOn) || payOn > todayIso()) { setPayErr(t('bdk_err_pay_date')); return; }
    setBusy('pay'); setPayErr('');
    try {
      const r = await api.post<{ payment: Payment }>(`/bond-desk/bonds/${b.id}/payments`, { amount_cents: cents, method, payer_name: payer.trim(), received_on: payOn, reference: ref.trim() || null });
      setPayOpen(false); setPayAmt(''); setPayer(''); setRef(''); setPayOn(todayIso());
      showToast(t('bdk_payment_recorded', { receipt: r.data.payment.receipt_no }), 'success'); await reload();
    } catch (e) { setPayErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };
  const voidPayment = async (p: Payment) => {
    const reason = await prompt.ask(t('bdk_void_payment_title', { receipt: p.receipt_no }), t('bdk_void_reason'));
    if (!reason) return;
    try { await api.post(`/bond-desk/payments/${p.id}/void`, { reason }); showToast(t('bdk_voided'), 'success'); await reload(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); }
  };
  const receipt = async (p: Payment) => {
    try { await fetchFile(`/bond-desk/payments/${p.id}/receipt.pdf`, `receipt-${p.receipt_no}.pdf`, 'application/pdf'); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_download_failed')), 'error'); }
  };

  const check = plan ? checkPlan(plan, m.charged_cents) : null;
  const savePlan = async (rows: PlanRow[]) => {
    const c = checkPlan(rows, m.charged_cents);
    if (!c.ok) { setPlanErr(t(`bdk_plan_err_${c.error}`, { total: money(c.total_cents), charged: money(m.charged_cents) })); return; }
    setBusy('plan'); setPlanErr('');
    try {
      await api.put(`/bond-desk/bonds/${b.id}/plan`, { installments: c.installments });
      setPlan(null); showToast(t(rows.length ? 'bdk_plan_saved' : 'bdk_plan_removed'), 'success'); await reload();
    } catch (e) { setPlanErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };

  const sendReminder = async () => {
    if (remChannel === 'sms' && !remConsent) { setRemErr(t('bdk_err_consent')); return; }
    setBusy('remind'); setRemErr('');
    try {
      const to = remTo === 'defendant' ? { to: 'defendant' } : { to: 'indemnitor', indemnitor_id: Number(remTo) };
      const r = await api.post<{ status: 'sent' | 'skipped' | 'failed' }>(`/bond-desk/bonds/${b.id}/remind`, { ...to, channel: remChannel, consent_confirmed: remConsent });
      if (r.data?.status === 'sent') { setRemOpen(false); setRemConsent(false); showToast(t('bdk_reminder_sent'), 'success'); }
      else setRemErr(t(r.data?.status === 'failed' ? 'bdk_reminder_failed' : 'bdk_reminder_skipped'));
    } catch (e) { setRemErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };

  return (
    <>
      {prompt.element}
      <Card title={t('bdk_balance')} testID="money-summary">
        <Row label={t('bdk_charged')} value={money(m.charged_cents)} testID="money-charged" />
        <Row label={t('bdk_paid')} value={money(m.paid_cents)} testID="money-paid" />
        <Row label={t('bdk_balance')} value={money(m.balance_cents)} testID="money-balance" />
        {m.overdue_cents > 0 && <Line tone="danger" testID="money-overdue">{t('bdk_overdue_amount', { amount: money(m.overdue_cents) })}</Line>}
        {!!m.next_due && <Line>{t('bdk_next_due', { amount: money(m.next_due.amount_cents - m.next_due.covered_cents), date: fmtDay(m.next_due.due_on) })}</Line>}
      </Card>

      <Card title={t('bdk_charges')} testID="money-charges">
        {!detail.charges.length && <Line muted>{t('bdk_charges_none')}</Line>}
        {detail.charges.map(c => (
          <View key={c.id} testID={`charge-${c.id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Line strong>{t(`bdk_charge_${c.kind}`)} · {money(c.amount_cents)}</Line>
            {!!c.description && <Line muted>{c.description}</Line>}
            {c.voided_at ? <Pill text={t('bdk_voided_pill', { reason: c.void_reason || '' })} tone="danger" />
              : <Btn kind="danger" label={t('bdk_void')} onPress={() => voidCharge(c)} testID={`charge-void-${c.id}`} />}
          </View>
        ))}
        {!chargeOpen ? <Btn kind="ghost" label={t('bdk_add_charge')} onPress={() => { setChargeErr(''); setChargeOpen(true); }} testID="charge-add" /> : (
          <>
            <Chips options={[{ key: 'premium' as const, label: t('bdk_charge_premium') }, { key: 'fee' as const, label: t('bdk_charge_fee') }]} value={kind} onChange={setKind} testIDPrefix="charge-kind" />
            <Field label={t('bdk_amount')} value={chargeAmt} onChangeText={setChargeAmt} keyboardType="decimal-pad" testID="charge-amount" />
            <Field label={t('bdk_description')} value={chargeDesc} onChangeText={setChargeDesc} testID="charge-desc" />
            <Line muted>{t('bdk_premium_help')}</Line>
            {!!chargeErr && <Line tone="danger" testID="charge-error">{chargeErr}</Line>}
            <Btn label={t('bdk_save')} onPress={addCharge} busy={busy === 'charge'} testID="charge-save" />
            <Btn kind="ghost" label={t('cancel')} onPress={() => setChargeOpen(false)} />
          </>
        )}
      </Card>

      <Card title={t('bdk_payments')} testID="money-payments">
        {!detail.payments.length && <Line muted>{t('bdk_payments_none')}</Line>}
        {detail.payments.map(p => (
          <View key={p.id} testID={`payment-${p.id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Line strong>{p.receipt_no} · {money(p.amount_cents)} · {t(`bdk_pm_${p.method}`)}</Line>
            <Line muted>{t('bdk_payment_line', { payer: p.payer_name, date: fmtDay(p.received_on) })}{p.reference ? ` · ${p.reference}` : ''}</Line>
            {p.voided_at && <Pill text={t('bdk_voided_pill', { reason: p.void_reason || '' })} tone="danger" />}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Btn kind="ghost" label={t('bdk_receipt')} onPress={() => receipt(p)} testID={`payment-receipt-${p.id}`} />
              {!p.voided_at && <Btn kind="danger" label={t('bdk_void')} onPress={() => voidPayment(p)} testID={`payment-void-${p.id}`} />}
            </View>
          </View>
        ))}
        {!payOpen ? <Btn label={t('bdk_add_payment')} onPress={() => { setPayErr(''); setPayOpen(true); }} disabled={m.balance_cents <= 0} testID="payment-add" /> : (
          <>
            <Field label={t('bdk_amount')} value={payAmt} onChangeText={setPayAmt} keyboardType="decimal-pad" testID="payment-amount" />
            <Chips options={PAY_METHODS.map(k => ({ key: k, label: t(`bdk_pm_${k}`) }))} value={method} onChange={setMethod} testIDPrefix="payment-method" />
            <Field label={t('bdk_payer')} value={payer} onChangeText={setPayer} testID="payment-payer" autoCapitalize="words" />
            <Field label={t('bdk_received_on')} value={payOn} onChangeText={setPayOn} testID="payment-date" placeholder={t('bdk_date_ph')} />
            <Field label={t('bdk_reference')} value={ref} onChangeText={setRef} testID="payment-ref" />
            {!!payErr && <Line tone="danger" testID="payment-error">{payErr}</Line>}
            <Btn label={t('bdk_record_payment')} onPress={addPayment} busy={busy === 'pay'} testID="payment-save" />
            <Btn kind="ghost" label={t('cancel')} onPress={() => setPayOpen(false)} />
          </>
        )}
      </Card>

      <Card title={t('bdk_plan')} testID="money-plan">
        {!m.plan_in_sync && detail.installments.length > 0 && <Line tone="warn" testID="plan-out-of-sync">{t('bdk_plan_out_of_sync', { plan: money(m.plan_scheduled_cents), charged: money(m.charged_cents) })}</Line>}
        {!detail.installments.length && !plan && <Line muted>{t('bdk_plan_none')}</Line>}
        {!plan && detail.installments.map(i => (
          <View key={i.id} testID={`inst-${i.id}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
            <Line>{fmtDay(i.due_on)} · {money(i.amount_cents)}</Line>
            <Pill text={t(`bdk_inst_${i.status}`)} tone={instTone[i.status]} />
          </View>
        ))}
        {!plan ? (
          <Btn kind="ghost" label={detail.installments.length ? t('bdk_plan_edit') : t('bdk_plan_create')} disabled={m.charged_cents <= 0} testID="plan-edit"
            onPress={() => { setPlanErr(''); setPlan(detail.installments.map(i => ({ due_on: i.due_on, amount: centsToInput(i.amount_cents) }))); }} />
        ) : (
          <View testID="plan-editor">
            <Line muted>{t('bdk_plan_help', { charged: money(m.charged_cents) })}</Line>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label={t('bdk_split_n')} value={splitN} onChangeText={setSplitN} keyboardType="number-pad" testID="plan-split-n" maxLength={2} /></View>
              <View style={{ flex: 1 }}><Field label={t('bdk_split_every')} value={splitEvery} onChangeText={setSplitEvery} keyboardType="number-pad" testID="plan-split-every" maxLength={3} /></View>
            </View>
            <Field label={t('bdk_split_first')} value={splitFirst} onChangeText={setSplitFirst} testID="plan-split-first" placeholder={t('bdk_date_ph')} />
            <Btn kind="ghost" label={t('bdk_split')} testID="plan-split" onPress={() => {
              const n = Number.parseInt(splitN, 10); const every = Number.parseInt(splitEvery, 10);
              const rows = n >= 1 && n <= 52 && every >= 1 ? splitPlan(m.charged_cents, n, splitFirst, every) : [];
              if (!rows.length) { setPlanErr(t('bdk_plan_err_bad_row')); return; }
              setPlanErr(''); setPlan(rows);
            }} />
            {plan.map((r, idx) => (
              <View key={idx} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}><Field label={t('bdk_due_on')} value={r.due_on} testID={`plan-due-${idx}`} placeholder={t('bdk_date_ph')}
                  onChangeText={v => setPlan(p => p && p.map((x, i) => (i === idx ? { ...x, due_on: v } : x)))} /></View>
                <View style={{ flex: 1 }}><Field label={t('bdk_amount')} value={r.amount} testID={`plan-amt-${idx}`} keyboardType="decimal-pad"
                  onChangeText={v => setPlan(p => p && p.map((x, i) => (i === idx ? { ...x, amount: v } : x)))} /></View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('bdk_remove')} testID={`plan-del-${idx}`}
                  onPress={() => setPlan(p => p && p.filter((_, i) => i !== idx))} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}>
                  <Line tone="danger">✕</Line>
                </TouchableOpacity>
              </View>
            ))}
            <Btn kind="ghost" label={t('bdk_plan_add_row')} onPress={() => setPlan(p => [...(p || []), { due_on: '', amount: '' }])} testID="plan-add-row" />
            <Line testID="plan-total" tone={check?.ok ? 'ok' : 'warn'}>{t('bdk_plan_total', { total: money(check?.total_cents ?? 0), charged: money(m.charged_cents) })}</Line>
            {!!planErr && <Line tone="danger" testID="plan-error">{planErr}</Line>}
            <Btn label={t('bdk_plan_save')} onPress={() => savePlan(plan)} disabled={!plan.length || !check?.ok} busy={busy === 'plan'} testID="plan-save" />
            {detail.installments.length > 0 && <Btn kind="danger" label={t('bdk_plan_remove')} onPress={() => savePlan([])} testID="plan-remove" />}
            <Btn kind="ghost" label={t('cancel')} onPress={() => setPlan(null)} testID="plan-cancel" />
          </View>
        )}
      </Card>

      <Card title={t('bdk_reminder')} testID="money-reminder">
        {!remOpen ? <Btn kind="ghost" label={t('bdk_send_reminder')} onPress={() => { setRemErr(''); setRemOpen(true); }} disabled={m.balance_cents <= 0} testID="reminder-open" /> : (
          <>
            <Chips options={[{ key: 'defendant', label: b.defendant_name }, ...detail.indemnitors.map(i => ({ key: String(i.id), label: i.full_name }))]}
              value={remTo} onChange={setRemTo} testIDPrefix="reminder-to" />
            <Chips options={[{ key: 'sms' as const, label: t('bdk_channel_sms') }, { key: 'email' as const, label: t('bdk_channel_email') }]}
              value={remChannel} onChange={setRemChannel} testIDPrefix="reminder-channel" />
            {remChannel === 'sms' && (
              <>
                <Line muted>{t('bdk_text_cost', { cost: money(access?.text_cents ?? 5) })}</Line>
                {!access?.texts_live && <Line tone="warn">{t('bdk_texts_off')}</Line>}
                <Check label={t('bdk_consent_text')} value={remConsent} onChange={setRemConsent} testID="reminder-consent" />
              </>
            )}
            {!!remErr && <Line tone="danger" testID="reminder-error">{remErr}</Line>}
            <Btn label={t('bdk_send')} onPress={sendReminder} busy={busy === 'remind'} testID="reminder-send" />
            <Btn kind="ghost" label={t('cancel')} onPress={() => setRemOpen(false)} />
          </>
        )}
      </Card>
    </>
  );
}
