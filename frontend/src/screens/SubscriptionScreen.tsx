import { useConfirm } from '../hooks/useConfirm';
import { BONDSMAN_LEAD_FEE_DISPLAY } from '../constants/leadFee';
import { useToast } from '../components/ToastProvider';
/**
 * SubscriptionScreen -- provider plans (attorneys and bail agents)
 *
 * Every price shown here comes from the backend — the same table the backend
 * charges from (routes/billing/_shared.js):
 *   attorneys   GET /api/billing/tiers?audience=attorney → POST /api/billing/subscribe
 *   bail agents GET /api/billing/bondsman/tiers          → POST /api/billing/bondsman/subscribe
 * Nothing is hard-coded, and no placement / ranking promises are made: the
 * directory's search order does not depend on a paid plan.
 * Without Stripe the subscribe calls answer 503 payments_unavailable and the
 * screen says so (no charge, free features keep working).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage, isPaymentsUnavailable, unwrapList } from '../services/api';
import { PAYMENTS_COMING_SOON } from '../payments';
import { useTheme, COLORS } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';

type ProviderType = 'lawyer' | 'bail_agent';

/** One purchasable plan, normalised from either pricing endpoint. */
export type ProviderPlan = {
  key: string;
  name: string;
  price: string;          // exactly as the backend displays it
  sub?: string | null;    // e.g. "$1490/yr · Save $298/yr" or "3 counties"
  features: string[];
  trialDays?: number | null;
};

/** What each attorney plan includes (features only — prices come from the API). */
const ATTORNEY_FEATURES: Record<string, string[]> = {
  esquire: [
    'Attorney dashboard and client inbox',
    'AI motion drafting library (review before filing)',
    'Case and matter management with AI research',
    'Conflict checks and docket tools',
  ],
};
ATTORNEY_FEATURES.esquire_annual = ATTORNEY_FEATURES.esquire;

export function attorneyPlansFrom(body: unknown): ProviderPlan[] {
  return unwrapList<Record<string, any>>(body, 'tiers')
    .filter(t => t && t.audience === 'attorney' && typeof t.display_price === 'string')
    .map(t => ({
      key: String(t.key),
      name: String(t.name),
      price: t.display_price,
      sub: t.billing === 'annual' ? 'Billed once a year' : 'Billed monthly',
      features: ATTORNEY_FEATURES[t.key] || [],
      trialDays: Number(t.trial_days) || null,
    }));
}

export function bondsmanPlansFrom(body: unknown): ProviderPlan[] {
  return unwrapList<Record<string, any>>(body, 'tiers')
    .filter(t => t && typeof t.display === 'string')
    .map(t => ({
      key: String(t.key),
      name: String(t.name),
      price: t.display,
      sub: t.annual_display ? `or ${t.annual_display}${t.annual_savings ? ` · ${t.annual_savings}` : ''}` : null,
      features: String(t.label || '').split('·').map((f: string) => f.trim()).filter(Boolean),
      trialDays: null,
    }));
}

function TierCard({ plan, active, onSubscribe, loading, styles }: {
  plan: ProviderPlan; active: boolean; onSubscribe: (key: string) => void; loading: boolean; styles: any;
}) {
  return (
    <View style={styles.tierCard} testID={`plan-${plan.key}`}>
      <View style={styles.tierHeader}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.tierLabel}>{plan.name}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.tierPrice} testID={`plan-price-${plan.key}`}>{plan.price}</Text>
          {!!plan.sub && <Text maxFontSizeMultiplier={1.4} style={styles.featureText}>{plan.sub}</Text>}
        </View>
        {active && (
          <View style={styles.activeBadge}>
            <Text maxFontSizeMultiplier={1.4} style={styles.activeBadgeText}>✓ Active</Text>
          </View>
        )}
      </View>

      {plan.features.length > 0 && (
        <View style={styles.featureList}>
          {plan.features.map(f => (
            <View key={f} style={styles.featureRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.featureCheck}>✓</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      )}

      {!active ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Subscribe to ${plan.name}`}
          activeOpacity={0.6}
          style={[styles.subscribeBtn, loading && { opacity: 0.6 }]}
          onPress={() => onSubscribe(plan.key)}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={COLORS.bgCard} size="small" />
            : <>
                <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnText}>
                  {plan.trialDays ? `Start ${plan.trialDays}-Day Free Trial` : 'Subscribe'}
                </Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnSub}>
                  {plan.trialDays ? `Then ${plan.price} -- ` : ''}cancel anytime · auto-renews
                </Text>
              </>
          }
        </TouchableOpacity>
      ) : (
        <View style={styles.activeBlock}>
          <Text maxFontSizeMultiplier={1.4} style={styles.activeBannerSub}>✓ You're on this plan</Text>
        </View>
      )}
    </View>
  );
}

function SubscriptionScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [providerType, setProviderType] = useState<ProviderType>('lawyer');
  const [plans, setPlans]               = useState<ProviderPlan[]>([]);
  const [activeTier, setActiveTier]     = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [loadError, setLoadError]       = useState('');
  const [error, setError]               = useState('');
  const [subscribing, setSubscribing]   = useState<string | null>(null);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const load = useCallback(async (type: ProviderType) => {
    setLoadError('');
    try {
      if (type === 'lawyer') {
        const [tiers, sub] = await Promise.all([
          api.get('/billing/tiers', { params: { audience: 'attorney' } }),
          api.get('/billing/subscription').catch(() => null),
        ]);
        if (!mountedRef.current) return;
        setPlans(attorneyPlansFrom(tiers.data));
        const s = sub?.data?.subscription;
        setActiveTier(s && ['active', 'trialing'].includes(s.status) ? s.tier : null);
      } else {
        const [tiers, sub] = await Promise.all([
          api.get('/billing/bondsman/tiers'),
          api.get('/billing/bondsman/subscription').catch(() => null),
        ]);
        if (!mountedRef.current) return;
        setPlans(bondsmanPlansFrom(tiers.data));
        setActiveTier(sub?.data?.active ? sub.data.tier : null);
      }
    } catch (e: any) {
      if (mountedRef.current) { setPlans([]); setLoadError(apiErrorMessage(e, 'Could not load plans. Check your connection.')); }
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(providerType).finally(() => { if (mountedRef.current) setLoading(false); });
  }, [providerType, load]);

  const onRefresh = () => {
    setRefreshing(true);
    load(providerType).finally(() => { if (mountedRef.current) setRefreshing(false); });
  };

  const doSubscribe = async (tier: string) => {
    // iOS App Store IAP gate (Apple §3.1.1): digital subscriptions on iOS go through the website.
    if (Platform.OS === 'ios') {
      confirm('Subscribe on Web?', 'iOS subscriptions are managed at justicegavel.app/subscribe.',
        { confirmLabel: 'Open Website' }).then(ok => { if (ok) Linking.openURL('https://justicegavel.app/subscribe').catch(() => {}); });
      return;
    }
    setSubscribing(tier);
    setError('');
    try {
      const res = providerType === 'lawyer'
        ? await api.post('/billing/subscribe', { tier, provider_type: 'lawyer' })
        : await api.post('/billing/bondsman/subscribe', { tier });
      showToast(res.data?.message || 'Subscription started.', 'success');
      await load(providerType);
    } catch (e: any) {
      if (isPaymentsUnavailable(e)) setError(PAYMENTS_COMING_SOON);
      else if (e?.response?.status === 409) setError('You already have an active plan. Manage it in Settings.');
      else setError(apiErrorMessage(e, 'Could not start the subscription. Please try again.'));
    } finally {
      if (mountedRef.current) setSubscribing(null);
    }
  };

  const handleSubscribe = (tier: string) => { requireAuth(() => doSubscribe(tier)); };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      testID="subscription-screen"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {!!error && (
        <View testID="subscription-error" style={{ margin: 16, padding: 14, backgroundColor: colors.errorBg,
          borderRadius: 10, borderWidth: 1, borderColor: colors.danger }}>
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 14 }}>⚠ {error}</Text>
        </View>
      )}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Provider Plans</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          Tools for attorneys and bail agents who work with Justice Gavel users
        </Text>
      </View>

      <View style={styles.toggleBlock}>
        <Text maxFontSizeMultiplier={1.4} style={styles.toggleTitle}>I am a:</Text>
        <View style={styles.toggleRow}>
          {([['lawyer', '⚖️ Attorney'], ['bail_agent', '🔓 Bail Agent']] as const).map(([type, label]) => (
            <TouchableOpacity key={type}
              accessibilityRole="button"
              accessibilityState={{ selected: providerType === type }}
              testID={`provider-type-${type}`}
              style={[styles.toggleChip, providerType === type && styles.toggleChipActive]}
              onPress={() => { setError(''); setProviderType(type); }}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.toggleChipText, providerType === type && styles.toggleChipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 32 }} size="large" color={colors.navy} />
      ) : loadError ? (
        <View style={{ alignItems: 'center', padding: 24 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textSecond, textAlign: 'center', marginBottom: 8 }}>{loadError}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={onRefresh}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.primary }}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : plans.map(plan => (
        <TierCard key={plan.key} plan={plan} styles={styles}
          active={activeTier === plan.key}
          onSubscribe={handleSubscribe}
          loading={subscribing === plan.key} />
      ))}

      {providerType === 'bail_agent' && (
        <View style={styles.bondsCTA}>
          <Text maxFontSizeMultiplier={1.4} style={styles.bondsCTATitle}>🔓 Leads</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.bondsCTAText}>
            Bondsmen accept only the leads they want, for a flat {BONDSMAN_LEAD_FEE_DISPLAY} per
            lead -- the same fee whatever the bail amount.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.bondsCTABtn}
            accessibilityLabel={'Open Lead Dashboard \u2192'} onPress={() => navigation.navigate('BondsmanDashboard')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.bondsCTABtnText}>Open Lead Dashboard →</Text>
          </TouchableOpacity>
        </View>
      )}

      <AuthGateModal />
      <Text maxFontSizeMultiplier={1.4} style={styles.footer}>
        Subscriptions auto-renew until cancelled; cancel any time in Settings.
        A paid plan does not change where you appear in directory search results.
      </Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { backgroundColor: COLORS.navy, padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { color: COLORS.bgSubtle, fontSize: 12, marginTop: 3, lineHeight: 18 },

  activeBanner: { backgroundColor: colors.legalBg, margin: 12, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center' },
  activeBannerTitle: { color: colors.textPrimary, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },
  activeBannerSub: { color: colors.legal, fontSize: 12, marginTop: 2 },
  cancelLink: { color: colors.danger, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  toggleBlock: { backgroundColor: colors.bgCard, margin: 12, marginBottom: 0, borderRadius: 12, padding: 14 },
  toggleTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.info, marginBottom: 8 },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', backgroundColor: COLORS.bgCard },
  toggleChipActive: { borderColor: COLORS.navy, backgroundColor: COLORS.bgSubtle },
  toggleChipText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.info },
  toggleChipTextActive: { color: COLORS.navy },

  tierCard: { margin: 12, marginBottom: 0, backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 6, borderWidth: 1.5, borderColor: 'transparent' },
  tierCardHighlight: { borderColor: colors.blue, elevation: 4 },
  tierBadge: { position: 'absolute', top: -1, right: 16, backgroundColor: colors.blue, paddingHorizontal: 10, paddingVertical: 10, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  tierBadgeText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  tierHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  tierIcon: { fontSize: 28, marginRight: 12 },
  tierLabel: { fontSize: 16, fontWeight: '800', color: colors.textBrand },
  tierPrice: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textBrand, marginTop: 1 },
  activeBadge: { backgroundColor: colors.legalBg, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20 },
  activeBadgeText: { color: colors.legal, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  featureList: { marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  featureCheck: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginRight: 8, marginTop: 1, color: colors.legal },
  featureText: { fontSize: 12, color: colors.info, flex: 1, lineHeight: 18 },
  subscribeBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', backgroundColor: COLORS.navy },
  subscribeBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 15,
    lineHeight: 22, },
  subscribeBtnSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  activeBlock: { backgroundColor: colors.legalBg, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  activeText: { color: colors.legal, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  intelCard: { margin: 12, marginBottom: 0, backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, elevation: 1 },
  intelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  intelIcon: { fontSize: 22, marginRight: 10 },
  intelLabel: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info },
  intelPrice: { fontSize: 12, lineHeight: 20, color: colors.info, marginTop: 1 },
  intelDesc: { fontSize: 12, color: colors.info, lineHeight: 18, marginBottom: 12 },

  bondsCTA: { margin: 12, backgroundColor: colors.infoBg, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.steelMid },
  bondsCTATitle: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 6 },
  bondsCTAText: { fontSize: 12, color: colors.textSecond, lineHeight: 18, marginBottom: 12 },
  bondsCTABtn: { backgroundColor: COLORS.steelDark, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  bondsCTABtnText: { color: COLORS.white, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  footer: { fontSize: 11, color: colors.info, textAlign: 'center', paddingHorizontal: 24, lineHeight: 16, marginTop: 16 },
});

export default React.memo(SubscriptionScreen);