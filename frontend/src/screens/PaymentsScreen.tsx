/**
 * PaymentsScreen — Billing: what the account pays for.
 *
 *   GET  /billing/overview   plans (consumer / attorney / bail agent), lead purchases, refund requests
 *   POST /billing/refund     { reason, additional_info? } — policy shown below (same as the server's)
 *
 * The app never takes money for anything that is not a listed plan or lead: there
 * is no "pay any amount" form (retainers and bail are paid to the attorney or the
 * bail agent directly, never through Justice Gavel). Receipts come from Stripe by e-mail.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';
import { ScreenCapture } from '../utils/webCompat';
import { usd, type SubscriptionView } from '../services/plans';
import { planStatusLine } from './ConsumerSubscriptionScreen';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';

type BondsSub = { id: number; name: string; status: string; paid: boolean; renews_at: string | null; cancel_at_period_end: boolean; amount_cents: number; billing_period: string };
type Purchase = { kind: 'bail_lead' | 'case_lead'; id: number; amount_cents: number; at: string; case_type?: string };
type RefundReq = { id: number; reason: string; status: string; created_at: string };
type Overview = { subscriptions: SubscriptionView[]; bondsman_subscriptions: BondsSub[]; purchases: Purchase[]; refund_requests: RefundReq[]; payments_live: boolean };

const REASONS = ['billing_error', 'duplicate', 'accidental', 'unsatisfied', 'other'] as const;
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function PaymentsScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { hasSession, recheck } = useHasSession();
  const { gated, unlocking, unlock } = useBiometricGate('payments');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Overview>('/billing/overview');
      if (mounted.current) { setData(r.data); setError(''); }
    } catch (e) {
      if (mounted.current) setError(apiErrorMessage(e, t('bill_load_error')));
    } finally { if (mounted.current) setRefreshing(false); }
  }, []);
  useEffect(() => { if (hasSession) load(); }, [hasSession, load]);

  const sendRefund = async () => {
    if (!reason) return;
    setSending(true); setNotice(null);
    try {
      const r = await api.post('/billing/refund', { reason, additional_info: note.trim() || undefined });
      if (mounted.current) { setNotice({ text: r.data?.message, tone: 'ok' }); setReason(null); setNote(''); }
      load();
    } catch (e) {
      if (mounted.current) setNotice({ text: apiErrorMessage(e, t('pay_failed')), tone: 'error' });
    } finally { if (mounted.current) setSending(false); }
  };

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;
  if (hasSession === false) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <SignInNeeded navigation={navigation} title={t('bill_title')} body={t('bill_signin_body')} onSignedIn={recheck} />
      </View>
    );
  }

  const paidPlans = (data?.subscriptions || []).filter(x => x.paid);
  const pastPlans = (data?.subscriptions || []).filter(x => !x.paid);
  const bonds = data?.bondsman_subscriptions || [];
  const canRefund = paidPlans.length > 0;

  return (
    <ScrollView testID="payments-screen" style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.4} style={s.heading} accessibilityRole="header">{t('bill_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.sub}>{t('bill_intro')}</Text>
      </View>
      {!data && !error && <ActivityIndicator style={{ marginTop: 24 }} color={colors.navy} />}
      {!!error && (
        <View style={s.card}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.danger }}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" style={s.ghostBtn} onPress={load}><Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('try_again')}</Text></TouchableOpacity>
        </View>
      )}
      {!!notice && (
        <View testID="billing-notice" style={[s.notice, { borderColor: notice.tone === 'ok' ? colors.legal : colors.danger, backgroundColor: notice.tone === 'ok' ? colors.legalBg : colors.errorBg }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: notice.tone === 'ok' ? colors.legalDark : colors.danger, fontSize: 14, lineHeight: 20 }}>{notice.text}</Text>
        </View>
      )}

      {data && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('bill_plans')}</Text>
          {!paidPlans.length && !bonds.some(b => b.paid) && (
            <View style={s.card} testID="billing-no-plan">
              <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('bill_no_plan')}</Text>
            </View>
          )}
          {paidPlans.map(p => (
            <View key={`s${p.id}`} style={s.card} testID="billing-plan">
              <Text maxFontSizeMultiplier={1.4} style={s.title}>{p.name}</Text>
              {p.amount_cents != null && <Text maxFontSizeMultiplier={1.4} style={s.line}>{p.billing === 'annual' ? t('bill_per_year', { price: usd(p.amount_cents) }) : t('bill_per_month', { price: usd(p.amount_cents) })}</Text>}
              <Text maxFontSizeMultiplier={1.4} style={[s.line, p.status === 'past_due' && { color: colors.danger }]}>{planStatusLine(p)}</Text>
            </View>
          ))}
          {bonds.filter(b => b.paid).map(b => (
            <View key={`b${b.id}`} style={s.card} testID="billing-bondsman-plan">
              <Text maxFontSizeMultiplier={1.4} style={s.title}>{b.name}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.line}>{b.billing_period === 'annual' ? t('bill_per_year', { price: usd(b.amount_cents) }) : t('bill_per_month', { price: usd(b.amount_cents) })}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.line}>{b.cancel_at_period_end ? t('plan_status_ends', { date: fmtDay(b.renews_at) }) : t('plan_status_renews', { date: fmtDay(b.renews_at) })}</Text>
            </View>
          ))}
          <View style={s.rowWrap}>
            <TouchableOpacity accessibilityRole="button" testID="billing-consumer-plans" style={s.ghostBtn} onPress={() => navigation.navigate('ConsumerSubscription' as never)}>
              <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('bill_see_plans')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" testID="billing-pro-plans" style={s.ghostBtn} onPress={() => navigation.navigate('Subscription' as never)}>
              <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('bill_see_pro_plans')}</Text>
            </TouchableOpacity>
          </View>

          {pastPlans.length > 0 && (
            <>
              <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('bill_past_plans')}</Text>
              {pastPlans.map(p => (
                <View key={`p${p.id}`} style={s.card}>
                  <Text maxFontSizeMultiplier={1.4} style={s.title}>{p.name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.line}>{t(`bill_status_${p.status === 'refunded' ? 'refunded' : 'ended'}`)} · {fmtDay(p.created_at)}</Text>
                </View>
              ))}
            </>
          )}

          <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('bill_purchases')}</Text>
          {data.purchases.length === 0 ? (
            <View style={s.card}><Text maxFontSizeMultiplier={1.4} style={s.line}>{t('bill_no_purchases')}</Text></View>
          ) : data.purchases.map(p => (
            <View key={`${p.kind}${p.id}`} style={[s.card, s.rowBetween]} testID="billing-purchase">
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text maxFontSizeMultiplier={1.4} style={s.title}>{p.kind === 'bail_lead' ? t('bill_bail_lead') : t('bill_case_lead')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.line}>{fmtDay(p.at)}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={s.amount}>{usd(p.amount_cents)}</Text>
            </View>
          ))}

          <Text maxFontSizeMultiplier={1.4} style={s.section}>{t('bill_refunds')}</Text>
          <View style={s.card}>
            <Text maxFontSizeMultiplier={1.4} style={s.line}>{t('bill_refund_policy')}</Text>
            {canRefund ? (
              <>
                <View style={s.rowWrap}>
                  {REASONS.map(r => (
                    <TouchableOpacity key={r} accessibilityRole="radio" aria-checked={reason === r} accessibilityState={{ checked: reason === r }} testID={`refund-reason-${r}`}
                      style={[s.chip, reason === r && { backgroundColor: colors.navy, borderColor: colors.navy }]} onPress={() => setReason(r)}>
                      <Text maxFontSizeMultiplier={1.3} style={[s.chipText, reason === r && { color: colors.textOnNavy }]}>{t(`bill_reason_${r}`)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={s.input} value={note} onChangeText={setNote} maxLength={1000} multiline
                  placeholder={t('bill_refund_note')} placeholderTextColor={colors.placeholder} accessibilityLabel={t('bill_refund_note')} />
                <TouchableOpacity accessibilityRole="button" testID="refund-send" style={[s.primaryBtn, (!reason || sending) && { opacity: 0.5 }]} disabled={!reason || sending} onPress={sendRefund}>
                  {sending ? <ActivityIndicator color={colors.textOnNavy} /> : <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('bill_refund_send')}</Text>}
                </TouchableOpacity>
              </>
            ) : <Text maxFontSizeMultiplier={1.4} style={[s.line, { marginTop: 8 }]}>{t('bill_refund_none')}</Text>}
            {data.refund_requests.map(r => (
              <Text key={r.id} maxFontSizeMultiplier={1.4} style={[s.line, { marginTop: 8 }]}>
                {fmtDay(r.created_at)} · {t(`bill_reason_${r.reason}`)} · {t(r.status === 'refunded' ? 'bill_refund_done' : 'bill_refund_review')}
              </Text>
            ))}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={s.footer}>{t('bill_footer')}</Text>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  scroll: { paddingBottom: 40 },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 20 },
  heading: { fontSize: 26, ...FONTS.black, color: colors.textOnNavy },
  sub: { color: colors.textOnNavy, opacity: 0.85, fontSize: 13, lineHeight: 19, marginTop: 4 },
  section: { fontSize: 12, ...FONTS.black, color: colors.textMuted, letterSpacing: 1, marginTop: 20, marginHorizontal: 16, textTransform: 'uppercase' },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 8, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 15, ...FONTS.heavy, color: colors.textPrimary },
  line: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 2 },
  amount: { fontSize: 16, ...FONTS.heavy, color: colors.textBrand },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginHorizontal: 12 },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.bgCard },
  ghostText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  chip: { minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipText: { fontSize: 13, ...FONTS.semi, color: colors.textSecond },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: RADIUS.md, padding: 10, minHeight: 64, marginTop: 10, color: colors.inputText, backgroundColor: colors.inputBg, fontSize: 14, textAlignVertical: 'top' },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  primaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy },
  footer: { fontSize: 12, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17, marginTop: 16 },
});

export default React.memo(PaymentsScreen);
