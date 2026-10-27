/**
 * Automatic payments on a bond's payment plan (docs/BOND_DESK.md "Automatic payments", ⚖ counsel
 * question 3.2 — hidden while the server's BOND_AUTOPAY_ENABLED is off).
 *
 * The agent sends the payer (defendant or an indemnitor) a personal link by text and/or e-mail; the
 * payer reads the amounts, dates, how to stop and "all payments are final" on that page and saves
 * a card with Stripe for the agency. Each installment is then charged on its due day; a declined
 * card is tried once more 3 days later. Shown here: the status, the card (brand + last 4), every
 * attempt, a warning when the plan changed after the payer agreed, and "Stop automatic payments".
 * Until the agency's card payments are on (Stripe Connect), only "Set up card payments" is shown.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { api, apiErrorMessage } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../constants/theme';
import { t, useLang, LANGS, type Lang } from '../../i18n';
import { Btn, Card, Check, Chips, Line, Pill } from './ui';
import { type Access, type AutopayInfo, type BondDetail, type ConnectState, attemptTone, fmtDay, fmtWhen, money } from '../../services/bondDesk';

export function AutopayCard({ detail, access, reload, onSettings }: { detail: BondDetail; access: Access | null; reload: () => Promise<void>; onSettings?: () => void }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const b = detail.bond;
  const [info, setInfo] = useState<AutopayInfo | null>(null);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('defendant');
  const [deliver, setDeliver] = useState<'sms' | 'email' | 'both' | 'none'>('sms');
  const [lang, setLang] = useState<Lang>('en');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([api.get<AutopayInfo>(`/bond-desk/bonds/${b.id}/autopay`), api.get<ConnectState>('/bond-desk/connect')]);
      setInfo(a.data); setConnect(c.data);
    } catch { setInfo(null); }   // older server or no access: the card stays hidden
  }, [b.id]);
  useEffect(() => { load(); }, [load, detail.payments.length]);

  if (!info || !connect || access?.autopay_enabled === false || !info.enabled) return null;
  const ap = info.autopay;
  const live = ap && ap.status !== 'stopped';
  const hasPlan = detail.installments.length > 0;

  const send = async () => {
    if ((deliver === 'sms' || deliver === 'both') && !consent) { setErr(t('bdk_err_consent')); return; }
    setBusy('send'); setErr('');
    try {
      const target = to === 'defendant' ? { to: 'defendant' } : { to: 'indemnitor', indemnitor_id: Number(to) };
      const r = await api.post<{ link: string; delivery: { sms: string | null; email: string | null } }>(`/bond-desk/bonds/${b.id}/autopay/link`,
        { ...target, deliver, consent_confirmed: consent, lang });
      setLink(r.data.link); setOpen(false); setConsent(false);
      const d = r.data.delivery;
      showToast(d.sms === 'sent' || d.email === 'sent' ? t('bdk_ap_link_sent') : t('bdk_ap_link_made'), 'success');
      await load();
    } catch (e) { setErr(apiErrorMessage(e, t('bdk_save_failed'))); } finally { setBusy(null); }
  };
  const stop = async () => {
    setBusy('stop');
    try { const r = await api.post<AutopayInfo>(`/bond-desk/bonds/${b.id}/autopay/stop`, {}); setInfo(r.data); showToast(t('bdk_ap_stopped'), 'success'); await reload(); }
    catch (e) { showToast(apiErrorMessage(e, t('bdk_save_failed')), 'error'); } finally { setBusy(null); }
  };
  const copy = async () => { if (link) { await Clipboard.setStringAsync(link); showToast(t('bdk_link_copied'), 'success'); } };

  return (
    <Card title={t('bdk_ap_title')} testID="autopay-card">
      {connect.status !== 'enabled' ? (
        <>
          <Line testID="autopay-needs-connect">{t('bdk_ap_needs_connect')}</Line>
          {!!onSettings && <Btn kind="ghost" label={t('bdk_connect_setup')} onPress={onSettings} testID="autopay-setup-payments" />}
        </>
      ) : (
        <>
          <Line muted>{t('bdk_ap_intro', { fee: money(info.fee_cents) })}</Line>
          {!ap || ap.status === 'stopped' ? <Line testID="autopay-status">{ap ? t('bdk_ap_status_stopped', { by: t(`bdk_ap_by_${ap.stopped_by || 'agent'}`), date: fmtWhen(ap.stopped_at) }) : t('bdk_ap_status_none')}</Line> : null}
          {ap?.status === 'link_sent' && <Line testID="autopay-status">{t('bdk_ap_status_link_sent', { name: ap.payer_name, date: fmtWhen(ap.link_expires_at) })}</Line>}
          {ap?.status === 'active' && (
            <>
              <Line tone="ok" testID="autopay-status">{t('bdk_ap_status_active', { name: ap.payer_name, card: ap.card ? `${ap.card.brand || ''} •••• ${ap.card.last4}`.trim() : '' })}</Line>
              {!!ap.consent_at && <Line muted>{t('bdk_ap_agreed', { date: fmtWhen(ap.consent_at) })}</Line>}
            </>
          )}
          {info.plan_changed && <Line tone="warn" testID="autopay-plan-changed">{t('bdk_ap_plan_changed')}</Line>}
          {!hasPlan && !live && <Line muted>{t('bdk_ap_needs_plan')}</Line>}
          {!!link && (
            <View testID="autopay-link">
              <Line strong>{t('bdk_ap_link_label')}</Line>
              <Line muted>{link}</Line>
              <Btn kind="ghost" label={t('bdk_copy_link')} onPress={copy} testID="autopay-copy" />
            </View>
          )}
          {live && <Btn kind="danger" label={t('bdk_ap_stop')} onPress={stop} busy={busy === 'stop'} testID="autopay-stop" />}
          {!live && hasPlan && !open && <Btn label={t('bdk_ap_send')} onPress={() => { setErr(''); setOpen(true); }} disabled={detail.money.balance_cents <= 0} testID="autopay-open" />}
          {open && (
            <View testID="autopay-form">
              <Chips options={[{ key: 'defendant', label: b.defendant_name }, ...detail.indemnitors.map(i => ({ key: String(i.id), label: i.full_name }))]}
                value={to} onChange={setTo} testIDPrefix="autopay-to" />
              <Chips options={(['sms', 'email', 'both', 'none'] as const).map(k => ({ key: k, label: t(`bdk_deliver_${k}`) }))} value={deliver} onChange={setDeliver} testIDPrefix="autopay-deliver" />
              <Chips options={LANGS.map(k => ({ key: k, label: t(`bdk_lang_${k}`) }))} value={lang} onChange={setLang} testIDPrefix="autopay-lang" />
              {(deliver === 'sms' || deliver === 'both') && (
                <>
                  <Line muted>{t('bdk_text_cost', { cost: money(access?.text_cents ?? 5) })}</Line>
                  <Check label={t('bdk_consent_text')} value={consent} onChange={setConsent} testID="autopay-consent" />
                </>
              )}
              {!!err && <Line tone="danger" testID="autopay-error">{err}</Line>}
              <Btn label={t('bdk_send')} onPress={send} busy={busy === 'send'} testID="autopay-send" />
              <Btn kind="ghost" label={t('cancel')} onPress={() => setOpen(false)} />
            </View>
          )}
          {info.attempts.length > 0 && <Line strong>{t('bdk_ap_history')}</Line>}
          {info.attempts.map(a => (
            <View key={a.id} testID={`autopay-attempt-${a.id}`} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Line>{t('bdk_ap_attempt_line', { amount: money(a.amount_cents), date: fmtDay(a.due_on), n: a.attempt })}</Line>
              <Pill text={t(`bdk_ap_att_${a.status}`)} tone={attemptTone(a.status)} />
              {a.status === 'failed' && a.retry_on && <Line muted>{t('bdk_ap_retry_on', { date: fmtDay(a.retry_on) })}</Line>}
              {a.status === 'failed' && !!a.failure_message && <Line muted>{a.failure_message}</Line>}
            </View>
          ))}
        </>
      )}
    </Card>
  );
}
