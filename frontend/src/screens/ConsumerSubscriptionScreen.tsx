import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
/**
 * ConsumerSubscriptionScreen -- User-facing subscription plans
 *
 * Plan names, prices, annual options and trial lengths all come from
 * GET /api/billing/tiers?audience=consumer — the same table the backend
 * charges from. This file only describes what each plan includes.
 */
import React, { useRef, useState, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, LayoutAnimation, InteractionManager } from 'react-native';
import { api, apiErrorMessage, isPaymentsUnavailable, unwrapList } from '../services/api';
import { PAYMENTS_COMING_SOON } from '../payments';

import { useAuthGate } from '../components/AuthGate';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';

/** Presentation + inclusions per plan key. Prices are NOT here. */
const PLAN_COPY: Record<string, { icon: string; color: string; highlight?: boolean; badge?: string; features: string[] }> = {
  legal_radar: {
    icon: '📊', color: COLORS.blue,
    features: [
      'Arrest monitoring alerts from ingested public records',
      'County arrest analytics dashboard',
      'Weekly Legal Radar report',
      'Charge trend and bail amount data',
    ],
  },
  advisor: {
    icon: '🔓', color: COLORS.legal,
    features: [
      'Find lawyers & bail agents -- full contact info',
      'Unlimited AI legal chat',
      'All Know Your Rights lessons',
      'Case management',
    ],
  },
  legal_pro: {
    icon: '⭐', color: COLORS.navy, highlight: true, badge: 'Most Popular',
    features: [
      'Everything in 24 Hour Advisor',
      'Arrest monitoring -- alerts when a watched name appears in ingested public records',
      'AI Lawyer Match report',
      'Video consultations',
    ],
  },
};

export type ConsumerPlan = {
  key: string; label: string; price: string; trialDays: number;
  annualKey: string | null; annualPrice: string | null; annualTrialDays: number | null; annualSavings: string | null;
  icon: string; color: string; highlight?: boolean; badge?: string; features: string[];
};

/** Build the plan cards from GET /billing/tiers?audience=consumer. */
export function consumerPlansFrom(body: unknown): ConsumerPlan[] {
  const tiers = unwrapList<Record<string, any>>(body, 'tiers').filter(t => t && t.audience === 'consumer');
  const monthly = tiers.filter(t => t.billing === 'monthly');
  return monthly.map(m => {
    const annual = tiers.find(t => t.billing === 'annual' && t.matches_monthly === m.key) || null;
    const saving = annual && m.monthly_cents && annual.annual_cents
      ? Math.round((m.monthly_cents * 12 - annual.annual_cents) / 100) : 0;
    const copy = PLAN_COPY[m.key] || { icon: '✓', color: COLORS.navy, features: [] };
    return {
      key: m.key, label: m.name, price: m.display_price, trialDays: Number(m.trial_days) || 0,
      annualKey: annual?.key ?? null,
      annualPrice: annual ? `$${(annual.annual_cents / 100).toFixed(0)}/yr` : null,
      annualTrialDays: annual ? Number(annual.trial_days) || 0 : null,
      annualSavings: saving > 0 ? `Save $${saving}` : null,
      ...copy,
    };
  });
}

function TierCard({ tier, active, onSubscribe, loading, annual }: any) {
  return (
    <View style={[styles.card, tier.highlight && styles.cardHighlight]}
      testID="consumer-subscription-screen">
      {tier.badge && (
        <View style={[styles.badge, { backgroundColor: tier.color }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.badgeText}>{tier.badge}</Text>
        </View>
      )}
      <View style={styles.cardHeader}>
        <Text maxFontSizeMultiplier={1.4} style={styles.tierIcon}>{tier.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.tierLabel, { color: tier.color }]}>{tier.label}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.tierPrice} testID={`consumer-price-${tier.key}`}>
            {annual && tier.annualPrice ? tier.annualPrice : tier.price}
          </Text>
          {annual && (
            <Text maxFontSizeMultiplier={1.4} style={styles.tierPriceSub}>
              {tier.annualPrice ? (tier.annualSavings || 'Billed yearly') : 'Monthly billing only'}
            </Text>
          )}
        </View>
        {active && (
          <View style={styles.activePill}>
            <Text maxFontSizeMultiplier={1.4} style={styles.activePillText}>✓ Active</Text>
          </View>
        )}
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.trialText, { color: tier.color }]}>
        ✓ {(annual && tier.annualPrice ? tier.annualTrialDays : tier.trialDays) || 0}-day free trial
      </Text>

      <View style={styles.featureList}>
        {(tier.features || []).map((f: string) => (
          <View key={f} style={styles.featureRow}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.featureCheck, { color: tier.color }]}>✓</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </View>

      {!active ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.subBtn, { backgroundColor: tier.color }, loading && { opacity: 0.6 }]}
          onPress={() => onSubscribe(annual && tier.annualKey ? tier.annualKey : tier.key, annual && !!tier.annualKey)}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={COLORS.bgCard} size="small" />
            : <>
                <Text maxFontSizeMultiplier={1.4} style={styles.subBtnText}>Start Free Trial</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.subBtnSub}>
                  Then {annual && tier.annualPrice ? tier.annualPrice : tier.price} -- cancel anytime
                </Text>
              </>
          }
        </TouchableOpacity>
      ) : (
        <View style={styles.activeBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.activeBlockText}>✓ You're on this plan</Text>
        </View>
      )}
    </View>
  );
}

function ConsumerSubscriptionScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    });
    return () => { _task.cancel(); mountedRef.current = false; };
  }, []);

  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    api.get('/billing/consumer/subscription')
      .then(r => { if (mountedRef.current) setSubscription(r.data?.subscription ?? null); })
      .catch(() => showToast('Could not refresh. Check your connection.', 'error'))
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  };
  const [subscribing, setSubscribing]   = useState<string | null>(null);
  const [annual, setAnnual]             = useState(false);
  const [plans, setPlans]               = useState<ConsumerPlan[]>([]);
  const [plansError, setPlansError]     = useState('');
  const { requireAuth, AuthGateModal }  = useAuthGate(navigation);

  useEffect(() => { loadSub(); }, []);

  const loadSub = async () => {
    setLoading(true);
    try {
      const [tiersRes, subRes] = await Promise.all([
        api.get('/billing/tiers', { params: { audience: 'consumer' } }),
        api.get('/billing/consumer/subscription').catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setPlans(consumerPlansFrom(tiersRes.data));
      setPlansError('');
      setSubscription(subRes?.data?.subscription ?? null);
    } catch (e: any) {
      if (mountedRef.current) setPlansError(apiErrorMessage(e, 'Could not load plans. Check your connection.'));
    } finally { if (mountedRef.current) setLoading(false); }
  };

  // tierKey is already the exact backend key (monthly or its annual variant).
  const handleSubscribe = (tierKey: string, isAnnual: boolean) => {
    requireAuth(() => doSubscribe(tierKey, isAnnual));
  };

  const doSubscribe = async (tier: string, isAnnual = false) => {
    // ── iOS App Store IAP gate (Apple §3.1.1) ─────────────────────────────────
    // Apple requires digital subscriptions on iOS to use StoreKit (IAP).
    // Until expo-iap is integrated, we block iOS purchases and show instructions.
    if (Platform.OS === 'ios') {
      confirm('Subscribe on Web?', 'iOS subscriptions are managed at justicegavel.app/subscribe. Open website?',
      { confirmLabel: 'Open Website' }).then(ok => { if (ok) Linking.openURL('https://justicegavel.app/subscribe').catch(() => {}); })
      setSubscribing(null);
      return;
    }
    // ── Android / web: proceed with Stripe backend flow ─────────────────────────
    setSubscribing(tier);
    try {
      // Monthly consumer plans: /consumer/subscribe; annual variants: /subscribe.
      const res = isAnnual
        ? await api.post('/billing/subscribe', { tier, provider_type: 'consumer' })
        : await api.post('/billing/consumer/subscribe', { tier });
      setSubscription(res.data?.subscription);
showToast(res.data?.message || 'Free trial activated!', 'success');
      loadSub();
    } catch (e: any) {
      if (isPaymentsUnavailable(e)) {
        showToast(PAYMENTS_COMING_SOON, 'info');
        return;
      }
      const msg = apiErrorMessage(e, 'Please try again.');
      if (msg.includes('Already subscribed') || e?.response?.data?.error === 'already_subscribed') {
        showToast('You already have an active plan. Manage it in Settings.', 'info');
      } else {
        showToast(msg, 'info');
      }
    } finally { setSubscribing(null); }
  };

  const handleCancel = () => {
    confirm('Cancel Plan?', 'You\'ll keep access until the end of your billing period.',
      { confirmLabel: 'Cancel', destructive: true }).then(async ok => {
        if (!ok) return;
        try {
          await api.post('/billing/cancel');
          setSubscription(null);
          showToast('Your plan has been cancelled.');
        } catch (e: any) {
          showToast(apiErrorMessage(e, 'Please try again. If this keeps happening, check your internet connection.'), 'error');
        }
      });
  };

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.navy} />
    </View>
  );

  const activeTier = subscription?.tier;

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
      <AuthGateModal />

      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Choose Your Plan</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          {plans.length ? `Plans from ${plans.map(p => p.price).sort((x, y) => parseFloat(x.replace(/[^0-9.]/g, '')) - parseFloat(y.replace(/[^0-9.]/g, '')))[0]}` : 'Choose the plan that fits'}
        </Text>
      </View>

      {/* Monthly / Annual billing toggle */}
      <View style={styles.toggleWrap}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.toggleBtn, !annual && styles.toggleBtnActive]}
          accessibilityLabel="Monthly" onPress={() => setAnnual(false)}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.toggleBtnText, !annual && styles.toggleBtnTextActive]}>Monthly</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.toggleBtn, annual && styles.toggleBtnActive]}
          accessibilityLabel="Annual" onPress={() => setAnnual(true)}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.toggleBtnText, annual && styles.toggleBtnTextActive]}>Annual</Text>
          {plans.some(p => p.annualSavings) && (
            <View style={styles.savingsBadge}>
              <Text maxFontSizeMultiplier={1.4} style={styles.savingsBadgeText}>Save yearly</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {annual && (
        <View style={styles.annualNote}>
          <Text maxFontSizeMultiplier={1.4} style={styles.annualNoteText}>
            ℹ️ After the free trial an annual plan is billed the full yearly price at once.
          </Text>
        </View>
      )}

      {/* What free users get (with clear limits) */}
      <View style={styles.freeCard}>
        <Text maxFontSizeMultiplier={1.4} style={styles.freeTierLabel}>FREE ACCOUNT</Text>
        <View style={styles.freeRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeItem}>✓  Create account &amp; log in</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeLimitBadge}>Always free</Text>
        </View>
        <View style={styles.freeRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeItem}>✓  AI chat</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeLimitBadge}>3 msgs/day</Text>
        </View>
        <View style={styles.freeRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeItemLocked}>🔒  Lawyer &amp; bail agent contact info</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeLockBadge}>Paid only</Text>
        </View>
        <View style={styles.freeRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeItemLocked}>🔒  Arrest record search</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeLockBadge}>Paid only</Text>
        </View>
        <View style={styles.freeRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeItemLocked}>🔒  Lessons &amp; resources</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeLockBadge}>Paid only</Text>
        </View>
      </View>

      {/* Active subscription banner */}
      {subscription && (
        <View style={styles.activeBanner}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.activeBannerTitle}>
              ✓ {plans.find(t => t.key === activeTier || t.annualKey === activeTier)?.label || activeTier} Plan -- {subscription.status}
            </Text>
            {subscription.trial_ends_at && subscription.status === 'trialing' && (
              <Text maxFontSizeMultiplier={1.4} style={styles.activeBannerSub}>
                Free trial ends {new Date(subscription.trial_ends_at ?? 0).toLocaleDateString()}
              </Text>
            )}
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={handleCancel}
           accessibilityLabel="Cancel">
            <Text maxFontSizeMultiplier={1.4} style={styles.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {!!plansError && (
        <Text maxFontSizeMultiplier={1.4} style={styles.footer}>{plansError}</Text>
      )}
      {plans.map(tier => (
        <TierCard
          key={tier.key}
          tier={tier}
          active={activeTier === tier.key || activeTier === tier.annualKey}
          onSubscribe={handleSubscribe}
          loading={subscribing === tier.key || subscribing === tier.annualKey}
          annual={annual}
        />
      ))}
      <Text maxFontSizeMultiplier={1.4} style={styles.footer}>
        Cancel before the free trial ends and you won't be charged.
        Payments processed securely by Stripe.
      </Text>
      <View style={{ height: 40 }} />

          <TouchableOpacity
          accessibilityRole="button"
          style={{ alignItems: 'center', paddingVertical: 16 }}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : null}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Continue with free features">
          <Text style={{ fontSize: 13, color: colors.info, textDecorationLine: 'underline' }}>
            Continue with free features →
          </Text>
        </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { backgroundColor: COLORS.navy, padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading:    { fontSize: 28, ...FONTS.black, color: COLORS.bgCard },
  subheading: { color: COLORS.steel, fontSize: 12, lineHeight: 20, marginTop: 3 },

  freeCard: {
    backgroundColor: COLORS.bgCard, margin: 12, marginBottom: 4,
    borderRadius: RADIUS.lg, padding: 16, ...SHADOW.sm,
    borderWidth: 1, borderColor: COLORS.border,
  },
  freeTierLabel: { fontSize: 11, ...FONTS.black, color: COLORS.textMuted, letterSpacing: 1.5, marginBottom: 10 },
  freeRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  freeItem:      { fontSize: 12, lineHeight: 20, ...FONTS.medium, color: COLORS.textPrimary, flex: 1 },
  freeItemLocked:{ fontSize: 12, lineHeight: 20, ...FONTS.medium, color: COLORS.textSecond, flex: 1 },
  freeLimitBadge:{ backgroundColor: COLORS.legalBg, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  freeLockBadge: { backgroundColor: COLORS.emergencyBg, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },

  activeBanner: { backgroundColor: COLORS.legalBg, margin: 12, marginBottom: 4, borderRadius: RADIUS.lg, padding: 16, flexDirection: 'row', alignItems: 'center' },
  activeBannerTitle: { color: colors.textOnGold, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },
  activeBannerSub:   { color: colors.legalDark, fontSize: 12, marginTop: 2 },
  cancelLink: { color: COLORS.emergency, fontSize: 12, lineHeight: 20, ...FONTS.semi },

  card: {
    margin: 12, marginBottom: 4,
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl,
    padding: 16, ...SHADOW.md,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  cardHighlight: { borderColor: COLORS.navy, ...SHADOW.lg },
  badge: { position: 'absolute', top: -1, right: 16, paddingHorizontal: 10, paddingVertical: 10, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  badgeText: { color: COLORS.bgCard, fontSize: 11, ...FONTS.black },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  tierIcon:  { fontSize: 28, marginRight: 12 },
  tierLabel: { fontSize: 16, ...FONTS.heavy },
  tierPrice: { fontSize: 22, ...FONTS.black, color: COLORS.navy, marginTop: 1 },
  activePill:     { backgroundColor: COLORS.legalBg, paddingHorizontal: 10, paddingVertical: 10, borderRadius: RADIUS.pill },
  activePillText: { color: COLORS.legal, fontSize: 12, ...FONTS.bold },
  trialText: { fontSize: 12, ...FONTS.bold, marginBottom: 12 },
  featureList: { marginBottom: 16 },
  featureRow:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 7 },
  featureCheck:{ fontSize: 12, lineHeight: 20, ...FONTS.black, marginRight: 8, marginTop: 1 },
  featureText: { fontSize: 12, color: COLORS.textSecond, flex: 1, lineHeight: 18 },
  subBtn:     { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center' },
  subBtnText: { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },
  subBtnSub:  { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },
  activeBlock:     { backgroundColor: COLORS.legalBg, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center' },
  activeBlockText: { color: COLORS.legal, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },

  toggleWrap: {
    flexDirection: 'row', margin: 12, marginBottom: 4,
    backgroundColor: COLORS.bg, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, padding: 4,
  },
  toggleBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: RADIUS.md, flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  toggleBtnActive: { backgroundColor: COLORS.navy },
  toggleBtnText:       { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.textMuted },
  toggleBtnTextActive: { color: COLORS.bgCard },
  savingsBadge: {
    backgroundColor: COLORS.legal, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2,
  },
  annualNote: { backgroundColor: COLORS.bgSubtle, marginHorizontal: 12, marginBottom: 4, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.steel },
  annualNoteText: { fontSize: 11, color: colors.blue, lineHeight: 16 },
  savingsBadgeText: { fontSize: 11, color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  tierPriceSub: { fontSize: 12, color: COLORS.legal, fontWeight: '700', marginTop: 1 },
  footer: { fontSize: 11, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 24, lineHeight: 16, marginTop: 16 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(ConsumerSubscriptionScreen);