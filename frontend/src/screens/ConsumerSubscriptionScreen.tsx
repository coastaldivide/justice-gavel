/**
 * ConsumerSubscriptionScreen — plans for people using the app.
 *
 * Names, prices, trial lengths and each plan's features come from
 * GET /api/billing/tiers?audience=consumer — the list the server charges from and
 * enforces. Buying: services/purchase.ts (payment sheet on a phone, Stripe Checkout
 * in a browser, then a server-verified confirm). Nothing unlocks before the card is
 * confirmed. Without Stripe the server answers payments_unavailable → friendly message.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../hooks/useConfirm';
import { useHasSession } from '../components/SignInNeeded';
import { usePurchase, takePendingCheckout } from '../services/purchase';
import { consumerPlansFrom, featureLabel, type ConsumerPlan, type SubscriptionView } from '../services/plans';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';

export { consumerPlansFrom };
export type { ConsumerPlan };

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }) : '');

/** One line about the current plan's state (trial end, renewal, failed payment, ending). */
export function planStatusLine(s: SubscriptionView): string {
  if (s.cancel_at_period_end) return t('plan_status_ends', { date: fmtDay(s.status === 'trialing' ? s.trial_ends_at : s.current_period_end) });
  if (s.status === 'trialing') return t('plan_status_trial', { date: fmtDay(s.trial_ends_at) });
  if (s.status === 'past_due') return t('plan_status_past_due');
  if (s.status === 'active') return t('plan_status_renews', { date: fmtDay(s.current_period_end) });
  return t('plan_status_inactive');
}

function ConsumerSubscriptionScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { hasSession } = useHasSession();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const purchase = usePurchase();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [plans, setPlans] = useState<ConsumerPlan[]>([]);
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [annual, setAnnual] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tiers, mine] = await Promise.all([
        api.get('/billing/tiers', { params: { audience: 'consumer' } }),
        hasSession ? api.get('/billing/consumer/subscription').catch(() => null) : Promise.resolve(null),
      ]);
      if (!mounted.current) return;
      setPlans(consumerPlansFrom(tiers.data));
      const cur = (mine?.data as { subscription?: SubscriptionView | null } | undefined)?.subscription ?? null;
      setSub(cur && cur.paid ? cur : null);
      setLoadError('');
    } catch (e) {
      if (mounted.current) setLoadError(apiErrorMessage(e, t('x_consumer_subscription_could_not_load_plans')));
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [hasSession]);
  useEffect(() => { load(); }, [load]);

  const confirmPlan = useCallback(async (ids: Record<string, string | undefined>) =>
    (await api.post('/billing/subscription/confirm', ids)).data as { subscription: SubscriptionView; message: string }, []);

  // Back from Stripe Checkout (web): finish the purchase once.
  const sessionId = (route?.params as { checkout_session_id?: string } | undefined)?.checkout_session_id;
  useEffect(() => {
    if (!sessionId || !hasSession) return;
    takePendingCheckout('consumer_plan');
    setBusy('checkout');
    purchase.finish(confirmPlan, { checkout_session_id: sessionId }).then(r => {
      if (!mounted.current) return;
      setBusy(null);
      if (r.status === 'done') { setNotice({ text: r.data.message, tone: 'ok' }); load(); }
      else if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
    });
    // purchase.finish is stable for this screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hasSession, confirmPlan, load]);

  const iosGate = () => {
    // Apple §3.1.1: digital subscriptions on iOS are bought on the website.
    confirm(t('x_consumer_subscription_subscribe_web'), t('x_consumer_subscription_ios_subscriptions_managed_at'),
      { confirmLabel: t('x_consumer_subscription_open_website') })
      .then(ok => { if (ok) Linking.openURL('https://justicegavel.app/plans').catch(() => {}); });
  };

  const subscribe = (tier: string) => requireAuth(async () => {
    if (Platform.OS === 'ios') return iosGate();
    setBusy(tier); setNotice(null);
    const r = await purchase.run({
      key: 'consumer_plan',
      start: async (ui) => (await api.post('/billing/consumer/subscribe', { tier, ui, return_path: '/plans' })).data,
      confirm: confirmPlan,
    });
    if (!mounted.current) return;
    setBusy(null);
    if (r.status === 'done') { setNotice({ text: r.data.message, tone: 'ok' }); load(); }
    else if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
  });

  const switchTo = (tier: string, name: string) => {
    if (Platform.OS === 'ios') return iosGate();
    confirm(t('plan_switch_title', { name }), t('plan_switch_body'), { confirmLabel: t('plan_switch_cta') }).then(async ok => {
      if (!ok) return;
      setBusy(tier); setNotice(null);
      try {
        const r = await api.post('/billing/subscription/change', { tier });
        if (mounted.current) setNotice({ text: r.data?.message, tone: 'ok' });
        load();
      } catch (e) {
        if (mounted.current) setNotice({ text: apiErrorMessage(e, t('pay_failed')), tone: 'error' });
      } finally { if (mounted.current) setBusy(null); }
    });
  };

  const cancel = () => {
    confirm(t('x_consumer_subscription_cancel_plan'), t('plan_cancel_body'), { confirmLabel: t('plan_cancel_cta'), destructive: true }).then(async ok => {
      if (!ok) return;
      setBusy('cancel');
      try {
        const r = await api.post('/billing/cancel', { provider_type: 'consumer' });
        if (mounted.current) setNotice({ text: r.data?.message, tone: 'ok' });
        load();
      } catch (e) {
        showToast(apiErrorMessage(e, t('x_consumer_subscription_please_try_again_if')), 'error');
      } finally { if (mounted.current) setBusy(null); }
    });
  };

  if (loading) return <View style={[s.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.textBrand} /></View>;

  const currentKey = sub?.tier || null;
  const isCurrent = (p: ConsumerPlan) => currentKey === p.key || currentKey === p.annualKey;
  const anySavings = plans.some(p => p.annualSavings);

  return (
    <ScrollView testID="consumer-subscription-screen" style={[s.screen, { backgroundColor: colors.bg }]} contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <AuthGateModal />
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.4} style={s.heading}>{t('x_consumer_subscription_choose_plan')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.subheading}>{t('plan_intro_consumer')}</Text>
      </View>

      {!!notice && (
        <View testID="plan-notice" style={[s.notice, { borderColor: notice.tone === 'ok' ? colors.legal : colors.danger, backgroundColor: notice.tone === 'ok' ? colors.legalBg : colors.errorBg }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: notice.tone === 'ok' ? colors.legalDark : colors.danger, fontSize: 14, lineHeight: 20 }}>{notice.text}</Text>
        </View>
      )}
      {busy === 'checkout' && <ActivityIndicator style={{ marginTop: 12 }} color={colors.textBrand} />}

      {sub && (
        <View testID="current-plan" style={[s.card, { borderColor: colors.legal }]}>
          <Text maxFontSizeMultiplier={1.4} style={s.cardKicker}>{t('plan_your_plan')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{sub.name}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[s.cardLine, sub.status === 'past_due' && { color: colors.danger }]}>{planStatusLine(sub)}</Text>
          <View style={s.row}>
            <TouchableOpacity accessibilityRole="button" testID="plan-billing" style={s.ghostBtn} onPress={() => navigation.navigate('Payments' as never)}>
              <Text maxFontSizeMultiplier={1.4} style={s.ghostBtnText}>{t('plan_billing_link')}</Text>
            </TouchableOpacity>
            {!sub.cancel_at_period_end && (
              <TouchableOpacity accessibilityRole="button" testID="plan-cancel" style={s.ghostBtn} onPress={cancel} disabled={busy === 'cancel'}>
                <Text maxFontSizeMultiplier={1.4} style={[s.ghostBtnText, { color: colors.danger }]}>{t('x_consumer_subscription_cancel_plan')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <View style={s.toggleWrap}>
        {[false, true].map(a => (
          <TouchableOpacity key={String(a)} accessibilityRole="tab" aria-selected={annual === a} accessibilityState={{ selected: annual === a }}
            style={[s.toggleBtn, annual === a && s.toggleBtnActive]} onPress={() => setAnnual(a)}>
            <Text maxFontSizeMultiplier={1.3} style={[s.toggleText, annual === a && s.toggleTextActive]}>
              {a ? t('x_consumer_subscription_annual') : t('x_consumer_subscription_monthly')}
            </Text>
            {a && anySavings && <View style={s.saveBadge}><Text maxFontSizeMultiplier={1.2} style={s.saveBadgeText}>{t('x_consumer_subscription_save_yearly')}</Text></View>}
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.card}>
        <Text maxFontSizeMultiplier={1.4} style={s.cardKicker}>{t('x_consumer_subscription_free_account')}</Text>
        {['plan_free_rights', 'plan_free_directory', 'plan_free_cases', 'plan_free_lessons', 'plan_free_chat'].map(k => (
          <View key={k} style={s.featureRow}>
            <Text maxFontSizeMultiplier={1.4} style={[s.check, { color: colors.legal }]}>✓</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.featureText}>{t(k)}</Text>
          </View>
        ))}
      </View>

      {!!loadError && <Text maxFontSizeMultiplier={1.4} style={s.footer}>{loadError}</Text>}
      {plans.map(p => {
        const useAnnual = annual && !!p.annualKey;
        const key = useAnnual ? (p.annualKey as string) : p.key;
        const price = useAnnual ? (p.annualPrice as string) : p.price;
        const trial = (useAnnual ? p.annualTrialDays : p.trialDays) || 0;
        const current = isCurrent(p) && currentKey === key;
        return (
          <View key={p.key} testID={`plan-${p.key}`} style={[s.card, current && { borderColor: colors.legal }]}>
            <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{p.label}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.price} testID={`consumer-price-${p.key}`}>{price}</Text>
            {annual && <Text maxFontSizeMultiplier={1.4} style={s.cardLine}>{p.annualKey ? (p.annualSavings || t('x_consumer_subscription_billed_yearly')) : t('x_consumer_subscription_monthly_billing_only')}</Text>}
            {!sub && trial > 0 && <Text maxFontSizeMultiplier={1.4} style={[s.cardLine, { color: colors.legal }]}>{t('plan_trial_card', { days: trial, price })}</Text>}
            <View style={{ marginVertical: 10 }}>
              {p.features.map(f => (
                <View key={f} style={s.featureRow}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.check, { color: colors.textBrand }]}>✓</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.featureText}>{featureLabel(f)}</Text>
                </View>
              ))}
            </View>
            {current ? (
              <View style={s.currentPill}><Text maxFontSizeMultiplier={1.4} style={s.currentPillText}>{t('x_consumer_subscription_re_this_plan')}</Text></View>
            ) : (
              <TouchableOpacity accessibilityRole="button" testID={`subscribe-${key}`} style={[s.primaryBtn, !!busy && { opacity: 0.6 }]} disabled={!!busy}
                onPress={() => (sub ? switchTo(key, p.label) : subscribe(key))}>
                {busy === key ? <ActivityIndicator color={COLORS.white} /> : (
                  <Text maxFontSizeMultiplier={1.4} style={s.primaryBtnText}>
                    {sub ? t('plan_switch_cta') : trial > 0 ? t('plan_start_trial', { days: trial }) : t('x_subscription_subscribe_2')}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        );
      })}
      <Text maxFontSizeMultiplier={1.4} style={s.footer}>{t('plan_footer_card')}</Text>
      <TouchableOpacity accessibilityRole="button" style={{ alignItems: 'center', paddingVertical: 16 }}
        onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeTab' as never))}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, color: colors.info, textDecorationLine: 'underline' }}>{t('x_consumer_subscription_continue_with_free_features_2')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 20 },
  heading: { fontSize: 26, ...FONTS.black, color: colors.textOnNavy },
  subheading: { color: colors.textOnNavy, opacity: 0.85, fontSize: 13, lineHeight: 19, marginTop: 4 },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 12, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1.5, borderColor: colors.border },
  cardKicker: { fontSize: 11, ...FONTS.black, color: colors.textMuted, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  cardTitle: { fontSize: 17, ...FONTS.heavy, color: colors.textPrimary },
  cardLine: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 4 },
  price: { fontSize: 22, ...FONTS.black, color: colors.textBrand, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  ghostBtnText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  toggleWrap: { flexDirection: 'row', marginHorizontal: 12, marginTop: 12, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, padding: 4, backgroundColor: colors.bgCard },
  toggleBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  toggleBtnActive: { backgroundColor: colors.navy },
  toggleText: { fontSize: 14, ...FONTS.bold, color: colors.textMuted },
  toggleTextActive: { color: colors.textOnNavy },
  saveBadge: { backgroundColor: colors.legalDark, borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 2 },
  saveBadgeText: { fontSize: 11, color: COLORS.white, ...FONTS.heavy },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6 },
  check: { fontSize: 13, ...FONTS.black, marginRight: 8, lineHeight: 19 },
  featureText: { fontSize: 13, lineHeight: 19, color: colors.textSecond, flex: 1 },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryBtnText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy, textAlign: 'center' },
  currentPill: { minHeight: 44, borderRadius: RADIUS.md, backgroundColor: colors.legalBg, alignItems: 'center', justifyContent: 'center' },
  currentPillText: { color: colors.legal, fontSize: 14, ...FONTS.heavy },
  footer: { fontSize: 12, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17, marginTop: 16 },
});

export default React.memo(ConsumerSubscriptionScreen);
