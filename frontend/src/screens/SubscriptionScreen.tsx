/**
 * SubscriptionScreen — plans for attorneys and bail agents.
 *
 * Every price and feature comes from the server's price list (the list it
 * charges from and enforces):
 *   attorneys   GET /billing/tiers?audience=attorney → POST /billing/subscribe → /billing/subscription/confirm
 *   bail agents GET /billing/bondsman/tiers          → POST /billing/bondsman/subscribe → …/subscription/confirm
 * Buying goes through services/purchase.ts (payment sheet / Stripe Checkout, then a
 * server-verified confirm); nothing is unlocked before the card is confirmed.
 * Without Stripe the server answers payments_unavailable and the screen says so.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage, unwrapList } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import { useConfirm } from '../hooks/useConfirm';
import { useHasSession } from '../components/SignInNeeded';
import { useStoredUser, isBailAgentUser } from '../hooks/useStoredUser';
import { usePurchase, takePendingCheckout } from '../services/purchase';
import { plansFrom, featureLabel, usd, type SubscriptionView } from '../services/plans';
import { BONDSMAN_LEAD_FEE_DISPLAY } from '../constants/leadFee';
import { COLORS, FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';

type ProviderType = 'lawyer' | 'bail_agent';

/** One purchasable plan, normalised from either price list. */
export type ProviderPlan = { key: string; name: string; price: string; sub: string | null; features: string[]; trialDays: number; billing: 'monthly' | 'annual' };

export function attorneyPlansFrom(body: unknown): ProviderPlan[] {
  return plansFrom(body, 'attorney').flatMap(p => [
    { key: p.key, name: p.label, price: p.price, sub: t('x_subscription_billed_monthly'), features: p.features.map(featureLabel), trialDays: p.trialDays, billing: 'monthly' as const },
    ...(p.annualKey ? [{ key: p.annualKey, name: `${p.label} · ${t('x_consumer_subscription_annual')}`, price: p.annualPrice as string, sub: p.annualSavings || t('x_subscription_billed_once_year'), features: p.features.map(featureLabel), trialDays: p.annualTrialDays || 0, billing: 'annual' as const }] : []),
  ]);
}

type BondsmanTier = { key: string; name: string; display: string; annual_cents: number; annual_savings_cents: number; counties: number | 'all' };
export function bondsmanPlansFrom(body: unknown): ProviderPlan[] {
  return unwrapList<BondsmanTier>(body, 'tiers').filter(x => x && typeof x.display === 'string').map(x => ({
    key: x.key, name: x.name, price: x.display,
    sub: x.annual_cents ? t('plan_bondsman_annual', { price: usd(x.annual_cents), saving: usd(x.annual_savings_cents) }) : null,
    features: [x.counties === 'all' ? t('plan_feat_lead_alerts_all') : t(Number(x.counties) === 1 ? 'plan_feat_lead_alerts_one' : 'plan_feat_lead_alerts_other', { n: x.counties })],
    trialDays: 0, billing: 'monthly' as const,
  }));
}

const fmtDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }) : '');
type BondsmanSub = { active: boolean; tier: string | null; name?: string; status?: string; renews_at?: string | null; cancel_at_period_end?: boolean };

function SubscriptionScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { confirm } = useConfirm();
  const { hasSession } = useHasSession();
  const { user, ready } = useStoredUser();
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const purchase = usePurchase();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [type, setType] = useState<ProviderType>('lawyer');
  useEffect(() => { if (ready && isBailAgentUser(user)) setType('bail_agent'); }, [ready, user]);
  const [plans, setPlans] = useState<ProviderPlan[]>([]);
  const [current, setCurrent] = useState<{ tier: string; line: string; cancelling: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (pt: ProviderType) => {
    try {
      if (pt === 'lawyer') {
        const [tiers, mine] = await Promise.all([
          api.get('/billing/tiers', { params: { audience: 'attorney' } }),
          hasSession ? api.get('/billing/subscription', { params: { provider_type: 'lawyer' } }).catch(() => null) : Promise.resolve(null),
        ]);
        if (!mounted.current) return;
        setPlans(attorneyPlansFrom(tiers.data));
        const sub = (mine?.data as { subscription?: SubscriptionView | null } | undefined)?.subscription;
        setCurrent(sub?.paid ? {
          tier: sub.tier, cancelling: sub.cancel_at_period_end,
          line: sub.cancel_at_period_end ? t('plan_status_ends', { date: fmtDay(sub.status === 'trialing' ? sub.trial_ends_at : sub.current_period_end) })
            : sub.status === 'trialing' ? t('plan_status_trial', { date: fmtDay(sub.trial_ends_at) })
              : sub.status === 'past_due' ? t('plan_status_past_due') : t('plan_status_renews', { date: fmtDay(sub.current_period_end) }),
        } : null);
      } else {
        const [tiers, mine] = await Promise.all([
          api.get('/billing/bondsman/tiers'),
          hasSession ? api.get('/billing/bondsman/subscription').catch(() => null) : Promise.resolve(null),
        ]);
        if (!mounted.current) return;
        setPlans(bondsmanPlansFrom(tiers.data));
        const b = mine?.data as BondsmanSub | undefined;
        setCurrent(b?.active && b.tier ? {
          tier: b.tier, cancelling: !!b.cancel_at_period_end,
          line: b.cancel_at_period_end ? t('plan_status_ends', { date: fmtDay(b.renews_at) }) : b.status === 'past_due' ? t('plan_status_past_due') : t('plan_status_renews', { date: fmtDay(b.renews_at) }),
        } : null);
      }
      setNotice(n => (n?.tone === 'error' && n.text === t('x_consumer_subscription_could_not_load_plans') ? null : n));
    } catch (e) {
      if (mounted.current) { setPlans([]); setNotice({ text: apiErrorMessage(e, t('x_consumer_subscription_could_not_load_plans')), tone: 'error' }); }
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [hasSession]);
  useEffect(() => { setLoading(true); load(type); }, [type, load]);

  const confirmFor = useCallback((pt: ProviderType) => async (ids: Record<string, string | undefined>) =>
    (await api.post(pt === 'lawyer' ? '/billing/subscription/confirm' : '/billing/bondsman/subscription/confirm', ids)).data as { message: string }, []);

  // Back from Stripe Checkout (web)
  const sessionId = (route?.params as { checkout_session_id?: string } | undefined)?.checkout_session_id;
  useEffect(() => {
    if (!sessionId || !hasSession) return;
    const pending = takePendingCheckout('provider_plan');
    const pt: ProviderType = pending?.ctx?.type === 'bail_agent' ? 'bail_agent' : 'lawyer';
    setType(pt);
    purchase.finish(confirmFor(pt), { checkout_session_id: sessionId }).then(r => {
      if (!mounted.current) return;
      if (r.status === 'done') { setNotice({ text: r.data.message, tone: 'ok' }); load(pt); }
      else if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hasSession, confirmFor, load]);

  const iosGate = () => confirm(t('x_consumer_subscription_subscribe_web'), t('x_subscription_ios_subscriptions_managed_at'),
    { confirmLabel: t('x_consumer_subscription_open_website') }).then(ok => { if (ok) Linking.openURL('https://justicegavel.app/subscribe').catch(() => {}); });

  const subscribe = (plan: ProviderPlan) => requireAuth(async () => {
    if (Platform.OS === 'ios') { iosGate(); return; }
    setBusy(plan.key); setNotice(null);
    const r = await purchase.run({
      key: 'provider_plan', ctx: { type },
      start: async (ui) => (await api.post(type === 'lawyer' ? '/billing/subscribe' : '/billing/bondsman/subscribe',
        { tier: plan.key, billing: plan.billing, ui, return_path: '/subscribe' })).data,
      confirm: confirmFor(type),
    });
    if (!mounted.current) return;
    setBusy(null);
    if (r.status === 'done') { setNotice({ text: r.data.message, tone: 'ok' }); load(type); }
    else if (r.status === 'error') setNotice({ text: r.message, tone: 'error' });
  });

  const switchTo = (plan: ProviderPlan) => {
    if (Platform.OS === 'ios') { iosGate(); return; }
    confirm(t('plan_switch_title', { name: plan.name }), t('plan_switch_body'), { confirmLabel: t('plan_switch_cta') }).then(async ok => {
      if (!ok) return;
      setBusy(plan.key); setNotice(null);
      try {
        const r = await api.post(type === 'lawyer' ? '/billing/subscription/change' : '/billing/bondsman/subscription/change', { tier: plan.key, billing: plan.billing });
        if (mounted.current) setNotice({ text: r.data?.message, tone: 'ok' });
        load(type);
      } catch (e) {
        if (mounted.current) setNotice({ text: apiErrorMessage(e, t('pay_failed')), tone: 'error' });
      } finally { if (mounted.current) setBusy(null); }
    });
  };

  const cancel = () => confirm(t('x_subscription_cancel_plan_2'), t('plan_cancel_body'), { confirmLabel: t('plan_cancel_cta'), destructive: true }).then(async ok => {
    if (!ok) return;
    setBusy('cancel'); setNotice(null);
    try {
      const r = type === 'lawyer' ? await api.post('/billing/cancel', { provider_type: 'lawyer' }) : await api.post('/billing/bondsman/subscription/cancel', {});
      if (mounted.current) setNotice({ text: r.data?.message, tone: 'ok' });
      load(type);
    } catch (e) {
      if (mounted.current) setNotice({ text: apiErrorMessage(e, t('x_subscription_could_not_cancel_plan')), tone: 'error' });
    } finally { if (mounted.current) setBusy(null); }
  });

  return (
    <ScrollView testID="subscription-screen" style={[s.screen, { backgroundColor: colors.bg }]} contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(type); }} />}>
      <AuthGateModal />
      <View style={s.header}>
        <Text maxFontSizeMultiplier={1.4} style={s.heading}>{t('x_subscription_provider_plans')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.subheading}>{t('plan_intro_pro')}</Text>
      </View>

      <View style={s.toggleWrap}>
        {([['lawyer', t('x_family_connect_attorney')], ['bail_agent', t('x_family_connect_bail_agent')]] as const).map(([pt, label]) => (
          <TouchableOpacity key={pt} accessibilityRole="tab" aria-selected={type === pt} accessibilityState={{ selected: type === pt }}
            testID={`provider-type-${pt}`} style={[s.toggleBtn, type === pt && s.toggleBtnActive]} onPress={() => { setNotice(null); setType(pt); }}>
            <Text maxFontSizeMultiplier={1.3} style={[s.toggleText, type === pt && s.toggleTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!notice && (
        <View testID="subscription-notice" style={[s.notice, { borderColor: notice.tone === 'ok' ? colors.legal : colors.danger, backgroundColor: notice.tone === 'ok' ? colors.legalBg : colors.errorBg }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: notice.tone === 'ok' ? colors.legalDark : colors.danger, fontSize: 14, lineHeight: 20 }}>{notice.text}</Text>
        </View>
      )}

      {current && (
        <View testID="current-plan" style={[s.card, { borderColor: colors.legal }]}>
          <Text maxFontSizeMultiplier={1.4} style={s.kicker}>{t('plan_your_plan')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{plans.find(p => p.key === current.tier)?.name || current.tier}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.cardLine}>{current.line}</Text>
          <View style={s.row}>
            <TouchableOpacity accessibilityRole="button" style={s.ghostBtn} onPress={() => navigation.navigate('Payments' as never)}>
              <Text maxFontSizeMultiplier={1.4} style={s.ghostText}>{t('plan_billing_link')}</Text>
            </TouchableOpacity>
            {!current.cancelling && (
              <TouchableOpacity accessibilityRole="button" testID="plan-cancel" style={s.ghostBtn} onPress={cancel} disabled={busy === 'cancel'}>
                <Text maxFontSizeMultiplier={1.4} style={[s.ghostText, { color: colors.danger }]}>{t('x_subscription_cancel_plan')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {loading ? <ActivityIndicator style={{ marginVertical: 32 }} size="large" color={colors.navy} /> : plans.map(plan => {
        const mine = current?.tier === plan.key;
        return (
          <View key={plan.key} testID={`plan-${plan.key}`} style={[s.card, mine && { borderColor: colors.legal }]}>
            <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{plan.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.price} testID={`plan-price-${plan.key}`}>{plan.price}</Text>
            {!!plan.sub && <Text maxFontSizeMultiplier={1.4} style={s.cardLine}>{plan.sub}</Text>}
            {!current && plan.trialDays > 0 && <Text maxFontSizeMultiplier={1.4} style={[s.cardLine, { color: colors.legal }]}>{t('plan_trial_card', { days: plan.trialDays, price: plan.price })}</Text>}
            <View style={{ marginVertical: 10 }}>
              {plan.features.map(f => (
                <View key={f} style={s.featureRow}>
                  <Text maxFontSizeMultiplier={1.4} style={[s.check, { color: colors.legal }]}>✓</Text>
                  <Text maxFontSizeMultiplier={1.4} style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            {mine ? (
              <View style={s.currentPill}><Text maxFontSizeMultiplier={1.4} style={s.currentPillText}>{t('x_consumer_subscription_re_this_plan')}</Text></View>
            ) : (
              <TouchableOpacity accessibilityRole="button" testID={`subscribe-${plan.key}`} accessibilityLabel={t('x_subscription_subscribe', { name: plan.name })}
                style={[s.primaryBtn, !!busy && { opacity: 0.6 }]} disabled={!!busy} onPress={() => (current ? switchTo(plan) : subscribe(plan))}>
                {busy === plan.key ? <ActivityIndicator color={COLORS.white} /> : (
                  <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>
                    {current ? t('plan_switch_cta') : plan.trialDays ? t('plan_start_trial', { days: plan.trialDays }) : t('x_subscription_subscribe_2')}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {type === 'bail_agent' && (
        <View style={s.card}>
          <Text maxFontSizeMultiplier={1.4} style={s.cardTitle}>{t('x_subscription_leads')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.cardLine}>{t('plan_bondsman_leads_note', { fee: BONDSMAN_LEAD_FEE_DISPLAY })}</Text>
          <TouchableOpacity accessibilityRole="button" style={[s.primaryBtn, { marginTop: 12 }]} onPress={() => navigation.navigate('BondsmanDashboard' as never)}>
            <Text maxFontSizeMultiplier={1.4} style={s.primaryText}>{t('x_subscription_open_lead_dashboard')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={s.footer}>{t('plan_footer_card')}</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: 40 },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 20 },
  heading: { fontSize: 26, ...FONTS.black, color: colors.textOnNavy },
  subheading: { color: colors.textOnNavy, opacity: 0.85, fontSize: 13, lineHeight: 19, marginTop: 4 },
  toggleWrap: { flexDirection: 'row', marginHorizontal: 12, marginTop: 12, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, padding: 4, backgroundColor: colors.bgCard },
  toggleBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md },
  toggleBtnActive: { backgroundColor: colors.navy },
  toggleText: { fontSize: 14, ...FONTS.bold, color: colors.textMuted },
  toggleTextActive: { color: colors.textOnNavy },
  notice: { marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  card: { backgroundColor: colors.bgCard, marginHorizontal: 12, marginTop: 12, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1.5, borderColor: colors.border },
  kicker: { fontSize: 11, ...FONTS.black, color: colors.textMuted, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  cardTitle: { fontSize: 17, ...FONTS.heavy, color: colors.textPrimary },
  cardLine: { fontSize: 13, lineHeight: 19, color: colors.textSecond, marginTop: 4 },
  price: { fontSize: 22, ...FONTS.black, color: colors.textBrand, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  ghostText: { fontSize: 14, ...FONTS.semi, color: colors.info },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6 },
  check: { fontSize: 13, ...FONTS.black, marginRight: 8, lineHeight: 19 },
  featureText: { fontSize: 13, lineHeight: 19, color: colors.textSecond, flex: 1 },
  primaryBtn: { minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: colors.textOnNavy, fontSize: 15, ...FONTS.heavy, textAlign: 'center' },
  currentPill: { minHeight: 44, borderRadius: RADIUS.md, backgroundColor: colors.legalBg, alignItems: 'center', justifyContent: 'center' },
  currentPillText: { color: colors.legal, fontSize: 14, ...FONTS.heavy },
  footer: { fontSize: 12, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17, marginTop: 16 },
});

export default React.memo(SubscriptionScreen);
