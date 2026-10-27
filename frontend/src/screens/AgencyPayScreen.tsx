/**
 * AgencyPayScreen — "Pay {agency}" (https://justicegavel.app/pay/<slug>): the bail agency's public
 * pay page, for money paid before the bond is in the agency's records. No account. docs/BOND_DESK.md.
 *
 * The payer enters the amount ($1–$50,000, typed dollars parsed to cents exactly), their name,
 * phone and/or e-mail (for the receipt) and the defendant's name, agrees that the payment goes to
 * the agency and is final, and pays in Stripe Checkout on the agency's own Stripe account. The
 * agency attaches the payment to the bond and the numbered receipt is sent then.
 *
 * API: /api/bd-pay/agency/:slug (backend routes/bdPay.js).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { api, apiErrorMessage } from '../services/api';
import { FONTS, useTheme } from '../constants/theme';
import { LANGS, getLang, setLang, t, useLang, type Lang } from '../i18n';
import { Btn, Card, Check, Chips, Field, Line, Notice } from '../components/bondDesk/ui';
import { money, openHosted, parseCents } from '../services/bondDesk';

interface PayPage { agency: { name: string; phone: string | null; license: string | null }; available: boolean; min_cents: number; max_cents: number }
export const PAY_SLUG = /^[a-z0-9]{10,32}$/;

/** The payer's form → the request body, or the i18n key of the first problem. */
export function payBody(f: { amount: string; payer: string; phone: string; email: string; defendant: string; textReceipt: boolean; agree: boolean },
  limits: { min_cents: number; max_cents: number }): { body?: Record<string, unknown>; error?: string } {
  const cents = parseCents(f.amount);
  if (cents === null || cents < limits.min_cents || cents > limits.max_cents) return { error: 'apy_err_amount' };
  if (!f.payer.trim()) return { error: 'apy_err_payer' };
  if (!f.defendant.trim()) return { error: 'apy_err_defendant' };
  if (!f.phone.trim() && !f.email.trim()) return { error: 'apy_err_contact' };
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return { error: 'apy_err_email' };
  if (!f.agree) return { error: 'apy_err_agree' };
  return { body: { amount_cents: cents, payer_name: f.payer.trim(), payer_phone: f.phone.trim() || null, payer_email: f.email.trim() || null,
    defendant_name: f.defendant.trim(), receipt_by_text: f.textReceipt && !!f.phone.trim(), agree_final: true, lang: getLang() } };
}

function AgencyPayScreen({ route }: ScreenProps) {
  const lang = useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const params = (route?.params || {}) as { slug?: string; paid?: string };
  const slug = String(params.slug || '').trim().toLowerCase();
  const base = `/bd-pay/agency/${encodeURIComponent(slug)}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [page, setPage] = useState<PayPage | null>(null);
  const [linkError, setLinkError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ amount: '', payer: '', phone: '', email: '', defendant: '', textReceipt: false, agree: false });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    if (!PAY_SLUG.test(slug)) { setLinkError(t('apy_link_invalid')); return; }
    try { const r = await api.get<PayPage>(base); if (mounted.current) { setPage(r.data); setLinkError(''); } }
    catch (e) {
      if (!mounted.current) return;
      const st = (e as { response?: { status?: number } })?.response?.status;
      if (st === 404) setLinkError(t('apy_link_invalid')); else setError(apiErrorMessage(e, t('apl_load_failed')));
    }
  }, [base, slug]);
  useEffect(() => { load(); }, [load]);

  const pay = async () => {
    if (!page) return;
    const { body, error: err } = payBody(f, page);
    if (err) { setError(t(err, { min: money(page.min_cents), max: money(page.max_cents) })); return; }
    setBusy(true); setError('');
    try { const r = await api.post<{ url: string }>(`${base}/checkout`, body); await openHosted(r.data.url); }
    catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('apl_failed'))); } finally { if (mounted.current) setBusy(false); }
  };

  if (linkError) {
    return <ScrollView style={{ backgroundColor: colors.bg }} testID="agency-pay-screen"><Card title={t('apy_title_plain')} testID="agency-pay-invalid"><Line tone="danger">{linkError}</Line></Card></ScrollView>;
  }
  if (!page) {
    return (
      <View style={[s.center, { backgroundColor: colors.bg }]} testID="agency-pay-screen">
        {error ? <Card><Line tone="danger">{error}</Line><Btn kind="ghost" label={t('try_again')} onPress={load} /></Card> : <ActivityIndicator size="large" color={colors.textBrand} />}
      </View>
    );
  }
  const agency = page.agency.name;
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} testID="agency-pay-screen" contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.3} style={s.heading} accessibilityRole="header">{t('apy_title', { agency })}</Text>
        {!!page.agency.license && <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('apy_license', { license: page.agency.license })}</Text>}
      </View>
      <View style={s.body}>
        <Card>
          <Chips options={LANGS.map(l => ({ key: l, label: t(`bdk_lang_${l}`) }))} value={lang} onChange={(l: Lang) => setLang(l, { persist: false })} testIDPrefix="apy-lang" />
          <Line>{t('apy_intro', { agency })}</Line>
          {!!page.agency.phone && (
            <TouchableOpacity accessibilityRole="link" style={s.call} testID="agency-pay-call"
              onPress={() => Linking.openURL(`tel:${String(page.agency.phone).replace(/[^\d+]/g, '')}`).catch(() => {})}>
              <Text maxFontSizeMultiplier={1.4} style={s.callText}>{t('ckl_call_agency', { agency })}: {page.agency.phone}</Text>
            </TouchableOpacity>
          )}
        </Card>
        {params.paid === '1' && <Notice tone="ok" text={t('apy_paid', { agency })} testID="agency-pay-paid" />}
        {!page.available ? <Notice text={t('apy_unavailable', { agency })} testID="agency-pay-unavailable" /> : (
          <Card title={t('apy_form_title')} testID="agency-pay-form">
            <Field label={t('apy_amount', { min: money(page.min_cents), max: money(page.max_cents) })} value={f.amount} onChangeText={set('amount')} keyboardType="decimal-pad" testID="apy-amount" placeholder="250.00" />
            <Field label={t('apy_payer')} value={f.payer} onChangeText={set('payer')} autoCapitalize="words" testID="apy-payer" />
            <Field label={t('apy_phone')} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" testID="apy-phone" />
            <Field label={t('apy_email')} value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" testID="apy-email" />
            <Field label={t('apy_defendant')} value={f.defendant} onChangeText={set('defendant')} autoCapitalize="words" testID="apy-defendant" />
            {!!f.phone.trim() && <Check label={t('apy_text_receipt')} value={f.textReceipt} onChange={set('textReceipt')} testID="apy-text-receipt" />}
            <Check label={t('apy_agree', { agency })} value={f.agree} onChange={set('agree')} testID="apy-agree" />
            {!!error && <Line tone="danger" testID="apy-error">{error}</Line>}
            <Btn label={t('apy_pay')} onPress={pay} busy={busy} testID="apy-pay" />
            <Line muted>{t('apy_stripe_note', { agency })}</Line>
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
});

export default React.memo(AgencyPayScreen);
