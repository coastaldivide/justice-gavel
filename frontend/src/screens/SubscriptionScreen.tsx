import { SkeletonLoader } from '../components/SkeletonLoader';
import { HapticButton } from '../components/HapticButton';
import { GradientHeader } from '../components/GradientHeader';
import { AppIcon } from '../components/AppIcon';
/**
 * SubscriptionScreen -- Attorney & bail agent subscription tiers
 *
 * Shows all tiers with pricing, features, and a 30-day free trial CTA.
 * One-tap subscribe. Manages active subscription display and cancel.
 */

import React, { useRef, useState, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Alert, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { useAuthGate } from '../components/AuthGate';

declare var data: any;
declare var error: any;
declare var setError: any;
declare var setSub: any;
const TIERS = [
  {
    key: 'advisor',
    label: 'Basic Listing',
    price: '$78.99/mo',
    cents: 7900,
    color: COLORS.textSecond,
    bg: COLORS.bgSubtle,
    icon: '📋',
    features: [
      'Directory profile visible to families',
      '🔒 Encrypted client messaging',
      'Searchable by county and case type',
      'Phone and address listing',
      'Rating and review system',
    ],
    highlight: false,
  },
  {
    key: 'legal_radar',
    label: 'Alert Tier',
    price: '$198.99/mo',
    cents: 19900,
    color: COLORS.blue,
    bg: COLORS.bgSubtle,
    icon: '🔔',
    features: [
      'Everything in Basic',
      'Daily arrest alerts by county',
      'Filter by charge type',
      'Email + push notifications',
      'No-attorney flag on leads',
    ],
    highlight: true,
    badge: 'Most Popular',
  },
  {
    key: 'legal_pro',
    label: 'Legal Pro',
    price: '$348.99/mo',
    cents: 34900,
    color: COLORS.navy,
    bg: COLORS.bgSubtle,
    icon: '⭐',
    features: [
      'Everything in Alert',
      'Top placement in all searches',
      'AI match priority -- first recommendation',
      'Verified badge on profile',
      'Unlimited alerts across any county',
      'Weekly county intel report included',
    ],
    highlight: false,
  },
];

const INTEL_TIER = {
  key: 'esquire',
  label: 'Weekly Intel Report',
  price: '$48.99/mo',
  icon: '📊',
  description: 'Weekly arrest data breakdown for your counties -- charge trends, bail averages, unrepresented rates. Add-on to any tier.',
};

function TierCard({ tier, active, onSubscribe, loading }: any) {
  return (
    <View style={[styles.tierCard, tier.highlight && styles.tierCardHighlight]}>
      {tier.badge && (
        <View style={styles.tierBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.tierBadgeText}>{tier.badge}</Text>
        </View>
      )}
      <View style={styles.tierHeader}>
        <Text maxFontSizeMultiplier={1.4} style={styles.tierIcon}>{tier.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.tierLabel, { color: tier.color }]}>{tier.label}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.tierPrice}>{tier.price}</Text>
        </View>
        {active && (
          <View style={styles.activeBadge}>
            <Text maxFontSizeMultiplier={1.4} style={styles.activeBadgeText}>✓ Active</Text>
          </View>
        )}
      </View>

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
          activeOpacity={0.6}
          style={[styles.subscribeBtn, { backgroundColor: tier.color }, loading && { opacity: 0.6 }]}
          onPress={() => onSubscribe(tier.key)}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={COLORS.bgCard} size="small" />
            : <>
                <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnText}>Start 30-Day Free Trial</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnSub}>Then {tier.price} -- cancel anytime · auto-renews</Text>
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

export default function SubscriptionScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/billing/consumer/subscription').then(r => { if (r.data) setSub(r.data || null); }).catch(()=>{})
    setTimeout(() => setRefreshing(false), 600);
  }, []);
  const [subscribing, setSubscribing]   = useState<string | null>(null);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const [providerType, setProviderType] = useState<'lawyer' | 'bail_agent'>('lawyer');

  useEffect(() => {
    loadSubscription();
  }, []);

  const loadSubscription = async () => {
    setLoading(true);
    try {
      const res = await api.get('/billing/subscription');
      setSubscription(res.data?.subscription);
    } catch (e: any) {
      // subscription not available -- screen still renders with upgrade CTAs
      // not subscribed yet -- that's fine
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = (tier: string) => {
    requireAuth(() => doSubscribe(tier));
  };

  const doSubscribe = async (tier: string) => {
    // ── iOS App Store IAP gate (Apple §3.1.1) ─────────────────────────────────
    // Apple requires digital subscriptions on iOS to use StoreKit (IAP).
    // Until expo-iap is integrated, we block iOS purchases and show instructions.
    if (Platform.OS === 'ios') {
      Alert.alert(
        'Subscribe on Web',
        'iOS subscriptions are managed at justicegavel.app/subscribe. You will be redirected.',
        [{ text: 'Open Website', onPress: () => Linking.openURL('https://justicegavel.app/subscribe').catch(() => {}) },
         { text: 'Cancel', style: 'cancel' }]
      );
      setSubscribing(null);
      return;
    }
    // ── Android / web: proceed with Stripe backend flow ─────────────────────────
    setSubscribing(tier);
    try {
      const res = await api.post('/billing/subscribe', { tier, provider_type: providerType });
      setSubscription(res.data?.subscription);
      Alert.alert(
        '🎉 Free Trial Started!',
        res.data?.message || '30-day free trial activated. No credit card charged yet.',
        [{ text: 'Got it' }]
      );
      loadSubscription();
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message;
      if (msg?.includes('Already subscribed')) {
        setError('You already have an active plan. Manage it in Settings.');
      } else {
        setError('Payment failed. Check your card details and try again.');
      }
    } finally {
      setSubscribing(null);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Your Plan',
      "Are you sure? You'll lose access to leads and alerts at the end of your billing period.",
      [
        { text: 'Keep subscription', style: 'cancel' },
        {
          text: 'Yes, cancel', style: 'destructive',
          onPress: async () => {
            try {
              await api.post('/billing/cancel');
              setSubscription(null);
              Alert.alert('Plan Cancelled', 'Your plan has been cancelled. You\'ll still have access until the end of your billing period.');
            } catch (e: any) {
              setError('Payment failed. Check your card details and try again.');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}
        testID="subscription-screen">
        <ActivityIndicator size="large" color={colors.navy} />
      </View>
    );
  }

  const activeTier = subscription?.tier;
  const isCanceled  = subscription?.status === 'canceled' || subscription?.cancel_at_period_end;
  const periodEnd   = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})
    : null;
  const trialEnd = subscription?.trial_ends_at
    ? new Date(subscription.trial_ends_at).toLocaleDateString()
    : null;

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {!!error && (
        <View style={{margin:16,padding:14,backgroundColor:colors.errorBg,
          borderRadius:10,borderWidth:1,borderColor:colors.danger}}>
          <Text style={{color:colors.danger,fontWeight:'700',fontSize:14}}>
            ⚠ {error}
          </Text>
        </View>
      )}
      {/* Header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Attorney Plans</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          Connect with clients the moment they need you most
        </Text>
      </View>

      {/* Grace period / canceled but still active notice */}
      {isCanceled && periodEnd && (
        <View style={[styles.activeBanner, { borderColor: COLORS.textSecond, backgroundColor: isDark ? (colors.warnDark || COLORS.warnDark || COLORS.textPrimary) : (colors.warnBg || COLORS.warnBg || COLORS.bgCard) }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.activeBannerSub, { color: COLORS.textSecond }]}>
            ⚠️  Subscription canceled — access continues until {periodEnd}
          </Text>
        </View>
      )}
      {/* Active subscription banner */}
      {subscription && (
        <View style={styles.activeBanner}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.activeBannerTitle}>
              ✓ {TIERS.find(t => t.key === activeTier)?.label || activeTier} -- {subscription.status}
            </Text>
            {trialEnd && subscription.status === 'trialing' && (
              <Text maxFontSizeMultiplier={1.4} style={styles.activeBannerSub}>Free trial ends {trialEnd}</Text>
            )}
          </View>
          <TouchableOpacity
            accessibilityRole="button" onPress={handleCancel}
             accessibilityLabel="Cancel">
            <Text maxFontSizeMultiplier={1.4} style={styles.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Provider type toggle */}
      <View style={styles.toggleBlock}>
        <Text maxFontSizeMultiplier={1.4} style={styles.toggleTitle}>I am a:</Text>
        <View style={styles.toggleRow}>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toggleChip, providerType === 'lawyer' && styles.toggleChipActive]}
            onPress={() => setProviderType('lawyer')}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.toggleChipText, providerType === 'lawyer' && styles.toggleChipTextActive]}>
              ⚖️ Attorney
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.toggleChip, providerType === 'bail_agent' && styles.toggleChipActive]}
            onPress={() => setProviderType('bail_agent')}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.toggleChipText, providerType === 'bail_agent' && styles.toggleChipTextActive]}>
              🔓 Bail Agent
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tier cards */}
      {TIERS.map(tier => (
        <TierCard
          key={tier.key}
          tier={tier}
          active={activeTier === tier.key}
          onSubscribe={handleSubscribe}
          loading={subscribing === tier.key}
        />
      ))}

      {/* Intel add-on */}
      <View style={styles.intelCard}>
        <View style={styles.intelHeader}>
          <Text maxFontSizeMultiplier={1.4} style={styles.intelIcon}>{INTEL_TIER.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={styles.intelLabel}>{INTEL_TIER.label}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.intelPrice}>{INTEL_TIER.price} add-on</Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.intelDesc} numberOfLines={2} ellipsizeMode="tail">{INTEL_TIER.description}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.subscribeBtn, { backgroundColor: colors.navy }, subscribing === 'intel' && { opacity: 0.6 }]}
          onPress={() => handleSubscribe('intel')}
          disabled={subscribing === 'intel'}
        >
          {subscribing === 'intel'
            ? <ActivityIndicator color={colors.bgCard} size="small" />
            : <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnText}>Add Intel Reports -- $49/mo</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Bail bondsman separate CTA */}
      <View style={styles.bondsCTA}>
        <Text maxFontSizeMultiplier={1.4} style={styles.bondsCTATitle}>🔓 Bail Bondsman?</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.bondsCTAText}>
          Bondsmen use our pay-per-lead system -- no monthly fee.
          Accept individual leads for $25-$300 based on bail amount.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.bondsCTABtn}
          accessibilityLabel="Open Lead Dashboard \u2192" onPress={() => navigation.navigate('BondsmanDashboard')}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.bondsCTABtnText}>Open Lead Dashboard →</Text>
        </TouchableOpacity>

        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:10, color:colors.steel,
          textAlign:'center', fontStyle:'italic', marginTop:8, paddingHorizontal:16 }}>
          Subscriptions auto-renew unless cancelled at least 24 hours before renewal date.
          Manage or cancel in Settings at any time.
        </Text>
        </View>

      <AuthGateModal />
      <Text maxFontSizeMultiplier={1.4} style={styles.footer}>
        All subscriptions include a 30-day free trial. Cancel anytime.
        Flat platform fee only -- compliant with attorney advertising rules in all 50 states.
      </Text>
      <View style={{ height: 40 }} />

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No results found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection or try again.</Text>
        </View>
      )}
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { backgroundColor: '#042C53', padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { color: COLORS.bgSubtle, fontSize: 12, marginTop: 3, lineHeight: 18 },

  activeBanner: { backgroundColor: colors.legal, margin: 12, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center' },
  activeBannerTitle: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },
  activeBannerSub: { color: colors.legal, fontSize: 12, marginTop: 2 },
  cancelLink: { color: colors.danger, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  toggleBlock: { backgroundColor: COLORS.bgCard, margin: 12, marginBottom: 0, borderRadius: 12, padding: 14 },
  toggleTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.steel, marginBottom: 8 },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', backgroundColor: COLORS.bgCard },
  toggleChipActive: { borderColor: '#042C53', backgroundColor: COLORS.bgSubtle },
  toggleChipText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.steel },
  toggleChipTextActive: { color: '#042C53' },

  tierCard: { margin: 12, marginBottom: 0, backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 16, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 6, borderWidth: 1.5, borderColor: 'transparent' },
  tierCardHighlight: { borderColor: colors.blue, elevation: 4 },
  tierBadge: { position: 'absolute', top: -1, right: 16, backgroundColor: colors.blue, paddingHorizontal: 10, paddingVertical: 10, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  tierBadgeText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  tierHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  tierIcon: { fontSize: 28, marginRight: 12 },
  tierLabel: { fontSize: 16, fontWeight: '800' },
  tierPrice: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#042C53', marginTop: 1 },
  activeBadge: { backgroundColor: colors.legal, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20 },
  activeBadgeText: { color: colors.legal, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  featureList: { marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  featureCheck: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginRight: 8, marginTop: 1 },
  featureText: { fontSize: 12, color: colors.steel, flex: 1, lineHeight: 18 },
  subscribeBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  subscribeBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 15,
    lineHeight: 22, },
  subscribeBtnSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  activeBlock: { backgroundColor: colors.legal, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  activeText: { color: colors.legal, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  intelCard: { margin: 12, marginBottom: 0, backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, elevation: 1 },
  intelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  intelIcon: { fontSize: 22, marginRight: 10 },
  intelLabel: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.steel },
  intelPrice: { fontSize: 12, lineHeight: 20, color: colors.steel, marginTop: 1 },
  intelDesc: { fontSize: 12, color: colors.steel, lineHeight: 18, marginBottom: 12 },

  bondsCTA: { margin: 12, backgroundColor: '#FFA726', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#FFA726' },
  bondsCTATitle: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.emergency, marginBottom: 6 },
  bondsCTAText: { fontSize: 12, color: colors.steel, lineHeight: 18, marginBottom: 12 },
  bondsCTABtn: { backgroundColor: '#FFA726', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  bondsCTABtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  footer: { fontSize: 11, color: colors.steel, textAlign: 'center', paddingHorizontal: 24, lineHeight: 16, marginTop: 16 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
