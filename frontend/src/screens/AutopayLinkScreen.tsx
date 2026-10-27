/**
 * AutopayLinkScreen — the page a payer opens from the personal link a bail agency texted or
 * e-mailed (https://justicegavel.app/autopay/<token>): pay the bond's payment plan automatically
 * with a card. No account; the link is the credential (only its SHA-256 is stored on the server).
 * Root-level route, so it works signed out, browsing or signed in. docs/BOND_DESK.md.
 *
 *   - The agency, the payer, the schedule (dates and amounts) and the consent text exactly as the
 *     server stores it (amounts, dates, how to stop, "All payments are final"), in the language
 *     picked on the page. The card is saved by Stripe on the agency's own account (Stripe Checkout);
 *     this page never sees a card number.
 *   - Once on: the card (brand + last 4), "Stop automatic payments", and — when the bank asked the
 *     payer to confirm a payment — "Confirm payment".
 *
 * API: /api/bd-pay/autopay/:token (backend routes/bdPay.js). ⚖ Off (503) until counsel answers 3.2.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { useConfirm } from '../hooks/useConfirm';
import { FONTS, useTheme } from '../constants/theme';
import { LANGS, getLang, setLang, t, useLang, type Lang } from '../i18n';
import { Btn, Card, Check, Chips, Line, Notice } from '../components/bondDesk/ui';
import { fmtDay, money, openHosted } from '../services/bondDesk';

export interface AutopayView {
  enabled: boolean; agency: { name: string; phone: string | null }; payer_name: string; defendant_name: string;
  status: 'link_sent' | 'active' | 'stopped'; stopped_by: string | null; card: { brand: string | null; last4: string } | null;
  balance_cents: number; schedule: { due_on: string; amount_cents: number }[];
  consent: { version: string; lang: string; text: string }; action_needed: { amount_cents: number; due_on: string } | null; can_start: boolean;
}
export const AUTOPAY_TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
const LINK_ERRORS: Record<string, string> = { link_invalid: 'apl_link_invalid', link_expired: 'apl_link_expired', feature_unavailable: 'apl_unavailable' };

function AutopayLinkScreen({ route }: ScreenProps) {
  const lang = useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { confirm } = useConfirm();
  const params = (route?.params || {}) as { token?: string; saved?: string; paid?: string };
  const token = String(params.token || '').trim();
  const base = `/bd-pay/autopay/${encodeURIComponent(token)}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [view, setView] = useState<AutopayView | null>(null);
  const [linkError, setLinkError] = useState('');
  const [error, setError] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!AUTOPAY_TOKEN.test(token)) { setLinkError(t('apl_link_invalid')); return; }
    try {
      const r = await api.get<AutopayView>(base, { params: { lang: getLang() } });
      if (mounted.current) { setView(r.data); setLinkError(''); setError(prev => (prev ? '' : prev)); }
    } catch (e) {
      if (!mounted.current) return;
      const err = e as { response?: { status?: number; data?: { code?: string } } };
      const code = err?.response?.data?.code || '';
      if (LINK_ERRORS[code]) setLinkError(t(LINK_ERRORS[code]));
      else if (err?.response?.status === 404) setLinkError(t('apl_link_invalid'));
      else setError(apiErrorMessage(e, t('apl_load_failed')));
    }
  }, [base, token]);
  useEffect(() => { load(); }, [load, lang]);

  /** One button's request: busy while it runs, its error shown, the previous error cleared. */
  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('apl_failed'))); } finally { if (mounted.current) setBusy(null); }
  };
  const start = () => act('start', async () => {
    if (!view) return;
    const r = await api.post<{ url: string }>(`${base}/start`, { agree: true, consent_version: view.consent.version, lang: getLang() });
    await openHosted(r.data.url);
  });
  const confirmPayment = () => act('confirm', async () => {
    const r = await api.post<{ url: string }>(`${base}/confirm`, { lang: getLang() }); await openHosted(r.data.url);
  });
  const stop = async () => {
    // errors: act() has the try / catch that shows a failed request
    if (!(await confirm(t('apl_stop_title'), t('apl_stop_body'), { confirmLabel: t('apl_stop') }))) return;
    await act('stop', async () => { const r = await api.post<AutopayView>(`${base}/stop`, { lang: getLang() }); if (mounted.current) setView(r.data); });
  };

  const langPicker = (
    <Chips options={LANGS.map(l => ({ key: l, label: t(`bdk_lang_${l}`) }))} value={lang} onChange={(l: Lang) => setLang(l, { persist: false })} testIDPrefix="apl-lang" />
  );
  if (linkError) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} testID="autopay-link-screen">
        <Card title={t('apl_title')} testID="autopay-link-error"><Line tone="danger">{linkError}</Line><Line muted>{t('apl_ask_agency')}</Line></Card>
      </ScrollView>
    );
  }
  if (!view) {
    return (
      <View style={[s.center, { backgroundColor: colors.bg }]} testID="autopay-link-screen">
        {error ? <Card><Line tone="danger">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></Card> : <ActivityIndicator size="large" color={colors.textBrand} />}
      </View>
    );
  }
  const agency = view.agency.name;
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} testID="autopay-link-screen" contentContainerStyle={{ paddingBottom: 48 }}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('apl_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('apl_from', { agency })}</Text>
      </View>
      <View style={s.body}>
        <Card>
          {langPicker}
          <Line strong>{t('apl_hello', { name: view.payer_name })}</Line>
          <Line>{t('apl_for', { defendant: view.defendant_name })}</Line>
          <Line muted testID="autopay-link-balance">{t('apl_balance', { amount: money(view.balance_cents) })}</Line>
          {!!view.agency.phone && (
            <TouchableOpacity accessibilityRole="link" testID="autopay-link-call" style={s.call}
              onPress={() => Linking.openURL(`tel:${String(view.agency.phone).replace(/[^\d+]/g, '')}`).catch(() => {})}>
              <Text maxFontSizeMultiplier={1.4} style={s.callText}>{t('ckl_call_agency', { agency })}: {view.agency.phone}</Text>
            </TouchableOpacity>
          )}
        </Card>
        {params.saved === '1' && view.status === 'active' && <Notice tone="ok" text={t('apl_saved')} testID="autopay-link-saved" />}
        {params.saved === '1' && view.status === 'link_sent' && <Notice text={t('apl_saving')} testID="autopay-link-saving" />}
        {params.paid === '1' && <Notice tone="ok" text={t('apl_paid')} testID="autopay-link-paid" />}
        {!!error && <Notice tone="error" text={error} testID="autopay-link-error-msg" />}

        {view.status === 'active' && (
          <Card title={t('apl_on_title')} testID="autopay-link-active">
            <Line tone="ok">{t('apl_on', { card: view.card ? `${view.card.brand || ''} •••• ${view.card.last4}`.trim() : '' })}</Line>
            {view.action_needed && (
              <View testID="autopay-link-action">
                <Line tone="warn" strong>{t('apl_action', { amount: money(view.action_needed.amount_cents), date: fmtDay(view.action_needed.due_on) })}</Line>
                <Btn label={t('apl_confirm_payment')} onPress={confirmPayment} busy={busy === 'confirm'} testID="autopay-link-confirm" />
              </View>
            )}
            <Btn kind="danger" label={t('apl_stop')} onPress={stop} busy={busy === 'stop'} testID="autopay-link-stop" />
          </Card>
        )}
        {view.status === 'stopped' && <Card testID="autopay-link-stopped"><Line>{t('apl_stopped', { agency })}</Line></Card>}

        {(view.status === 'link_sent' || view.status === 'active') && view.schedule.length > 0 && (
          <Card title={t('apl_schedule')} testID="autopay-link-schedule">
            {view.schedule.map(x => <Line key={x.due_on}>{`${fmtDay(x.due_on)} — ${money(x.amount_cents)}`}</Line>)}
          </Card>
        )}

        {view.status === 'link_sent' && (
          <Card title={t('apl_agree_title')} testID="autopay-link-consent">
            <Text maxFontSizeMultiplier={1.4} style={s.consent} testID="autopay-link-consent-text">{view.consent.text}</Text>
            {view.can_start ? (
              <>
                <Check label={t('apl_agree')} value={agree} onChange={setAgree} testID="autopay-link-agree" />
                <Btn label={t('apl_save_card')} onPress={start} disabled={!agree} busy={busy === 'start'} testID="autopay-link-start" />
                <Line muted>{t('apl_stripe_note', { agency })}</Line>
              </>
            ) : <Line muted>{t('apl_nothing_to_set_up')}</Line>}
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 },
  heading: { fontSize: 22, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, fontSize: 14, lineHeight: 20, marginTop: 4 },
  body: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  call: { minHeight: 44, justifyContent: 'center', marginTop: 6 },
  callText: { color: colors.textBrand, fontSize: 15, ...FONTS.semiBold, textDecorationLine: 'underline' },
  consent: { fontSize: 14, lineHeight: 21, color: colors.textPrimary, marginTop: 6 },
});

export default React.memo(AutopayLinkScreen);
