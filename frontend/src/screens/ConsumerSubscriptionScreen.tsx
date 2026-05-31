/**
 * ConsumerSubscriptionScreen -- User-facing subscription plans
 *
 * Three tiers for individuals / families:
 *   Advisor  $29.99/mo -- full search, unlimited AI, lessons, arrest search
 *   Pro      $14.99/mo -- Advisor + arrest monitoring alerts
 *   Intel    $19.99/mo ($249.99/yr) -- Pro + county analytics + weekly reports
 *
 * 7-day free trial on all tiers.
 */
import React, { useRef, useState, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Alert, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../services/api';

import { useAuthGate } from '../components/AuthGate';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

declare var data: any;
declare var setError: any;
declare var setSub: any;
// Billing period toggle data
const MONTHLY_TIERS = [
  {
    key: 'advisor', label: '24 Hour Advisor', price: '$29.99/mo', annualKey: 'starter_annual',
    annualPrice: '$79.99/yr', annualMonthly: '$6.67/mo', savings: 'Save $40',
    cents: 2999, icon: '🔓', color: COLORS.legal, bg: COLORS.legalBg,
    trial: '30-day free trial', highlight: false,
    features: [
      'Find lawyers & bail agents -- full contact info',
      'Unlimited AI legal chat',
      'All Know Your Rights lessons',
      'Case management + court date reminders',
      'Push alerts: court dates (7d, 3d, day-of)',
    ],
  },
  {
    key: 'legal_pro', label: 'Legal Pro', price: '$14.99/mo', annualKey: 'pro_annual',
    annualPrice: '$119.99/yr', annualMonthly: '$10.00/mo', savings: 'Save $60',
    cents: 1499, icon: '⭐', color: COLORS.navy, bg: COLORS.bgSubtle,
    trial: '30-day free trial', highlight: true, badge: 'Most Popular',
    features: [
      'Everything in Advisor +',
      '24/7 arrest monitoring -- push alerts when someone is booked',
      'Priority lawyer search results',
      'AI Lawyer Match report',
    ],
  },
  {
    key: 'legal_radar', label: 'Legal Radar', price: '$19.99/mo', annualKey: 'legal_radar_annual',
    annualPrice: '$249.99/yr', annualMonthly: '$20.83/mo', savings: 'Save $90',
    cents: 1999, icon: '📊', color: COLORS.blue, bg: COLORS.bgSubtle,
    trial: '30-day free trial', highlight: false,
    features: [
      'Real-time arrest monitoring alerts',
      'County arrest analytics dashboard',
      'Weekly Legal Radar intelligence report',
      'Charge trend & bail amount data',
      'Court activity tracker in your area',
    ],
  },
  {
    key: 'esquire',
    label: 'Justice Gavel Esquire',
    price: '$49.00/mo',
    cents: 4900,
    icon: '⚖️',
    color: COLORS.navy,
    bg: '#1a1a2e22',
    trial: null,
    annualKey: 'esquire_annual',
    annualPrice: '$399.00/yr',
    annualCents: 39900,
    features: [
      'Full attorney dashboard & client management',
      'AI motion library — draft, review, file',
      'Case & matter management with AI research',
      'Firm vertical tools — plea tracker, docket',
      'CLE credit tracking',
      'PI lead marketplace',
      'Priority AI processing',
    ],
  },
];

const TIERS = [
  {
    key: 'advisor',
    label: '24 Hour Advisor',
    price: '$29.99/mo',
    cents: 2999,
    annualKey: 'advisor_annual',
    annualPrice: '$79.99/yr',
    annualCents: 7999,
    icon: '🔓',
    color: COLORS.legal,
    bg: COLORS.legalBg,
    trial: '7-day free trial',
    features: [
      'Find lawyers & bail agents -- full contact info',
      'Search arrest records by name',
      'Unlimited AI legal chat',
      'All Know Your Rights lessons',
      'Full legal resource library',
      'Case management',
    ],
    highlight: false,
  },
  {
    key: 'legal_pro',
    label: 'Legal Pro',
    price: '$29.00/mo',
    cents: 2900,
    icon: '⭐',
    color: COLORS.navy,
    bg: COLORS.bgSubtle,
    trial: '7-day free trial',
    features: [
      'Everything in Advisor +',
      'Arrest monitoring -- get alerted if someone you know is booked',
      'Priority results in lawyer search',
      'SOS emergency alert to contacts',
      'Lawyer Match AI report',
    ],
    highlight: true,
    badge: 'Most Popular',
  },
  {
    key: 'legal_radar',
    label: 'Legal Radar',
    price: '$19.99/mo',
    cents: 1999,
    icon: '📊',
    color: COLORS.blue,
    bg: COLORS.bgSubtle,
    trial: '7-day free trial',
    features: [
      'Everything in Pro',
      'County arrest analytics dashboard',
      'Weekly intelligence reports for your county',
      'Charge trend breakdowns',
      'Bail amount averages by charge type',
    ],
    highlight: false,
  },
];

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
          <Text maxFontSizeMultiplier={1.4} style={styles.tierPrice}>
            {annual ? tier.annualPrice : tier.price}
          </Text>
          {annual && (
            <Text maxFontSizeMultiplier={1.4} style={styles.tierPriceSub}>{tier.annualMonthly} · {tier.savings}</Text>
          )}
        </View>
        {active && (
          <View style={styles.activePill}>
            <Text maxFontSizeMultiplier={1.4} style={styles.activePillText}>✓ Active</Text>
          </View>
        )}
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.trialText, { color: tier.color }]}>
        ✓ {annual ? '7-day free trial' : tier.trial}
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
          onPress={() => onSubscribe(tier.key, annual)}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={COLORS.bgCard} size="small" />
            : <>
                <Text maxFontSizeMultiplier={1.4} style={styles.subBtnText}>Start Free Trial</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.subBtnSub}>
                  Then {annual ? tier.annualPrice : tier.price} -- cancel anytime
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

export default function ConsumerSubscriptionScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/billing/consumer/subscription').then(r => { if (r.data) setSub(r.data || null); }).catch(()=>{})
    setTimeout(() => setRefreshing(false), 600);
  }, []);
  const [subscribing, setSubscribing]   = useState<string | null>(null);
  const [annual, setAnnual]             = useState(false);
  const { requireAuth, AuthGateModal }  = useAuthGate(navigation);

  useEffect(() => { loadSub(); }, []);

  const loadSub = async () => {
    setLoading(true);
    try {
      const res = await api.get('/billing/consumer/subscription');
      setSubscription(res.data?.subscription);
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    finally { setLoading(false); }
  };

  const handleSubscribe = (tier: string, isAnnual: boolean) => {
    const key = isAnnual ? (tier + '_annual') : tier;
    requireAuth(() => doSubscribe(key));
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
      const res = await api.post('/billing/consumer/subscribe', { tier });
      setSubscription(res.data?.subscription);
      Alert.alert('🎉 Free Trial Started!', res.data?.message || '7-day free trial activated.');
      setTimeout(() => navigation.navigate('HomeTab'), 2000);
      loadSub();
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message;
      if (msg?.includes('Already subscribed')) {
        setError('You already have an active plan. Manage it in Settings.');
      } else {
        Alert.alert('Payment could not be processed. Please check your payment details and try again, or contact support.', msg || 'Please try again.');
      }
    } finally { setSubscribing(null); }
  };

  const handleCancel = () => {
    Alert.alert('Cancel Plan', 'You\'ll keep access until the end of your billing period.', [
      { text: 'Keep plan', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: async () => {
        try {
          await api.post('/billing/cancel');
          setSubscription(null);
          Alert.alert('Cancelled', 'Your plan has been cancelled.');
        } catch (e: any) {
          Alert.alert('Payment could not be processed. Please check your payment details and try again, or contact support.', 'Please try again. If this keeps happening, check your internet connection.');
        }
      }},
    ]);
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
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>Full access to everything -- starting at $29.99/mo</Text>
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
          <View style={styles.savingsBadge}>
            <Text maxFontSizeMultiplier={1.4} style={styles.savingsBadgeText}>Save up to $80</Text>
          </View>
        </TouchableOpacity>
      </View>

      {annual && (
        <View style={styles.annualNote}>
          <Text maxFontSizeMultiplier={1.4} style={styles.annualNoteText}>
            ℹ️ Annual plans have a 7-day free trial. Monthly plans have 30 days.
            After the trial you're billed the full annual price.
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
              ✓ {TIERS.find(t => t.key === activeTier)?.label || activeTier} Plan -- {subscription.status}
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

      {MONTHLY_TIERS.map(tier => (
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
        All plans include a 7-day free trial. Cancel anytime before trial ends and you won't be charged.
        Payments processed securely by Stripe.
      </Text>
      <TouchableOpacity
          accessibilityRole="button"
        onPress={() => Alert.alert('Restore Purchases', 'Checking your previous purchases...\n\nIf you had an active subscription it will be restored. This may take a moment.', [{ text: 'OK' }])}
        style={{ alignItems: 'center', paddingVertical: 16 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 12, lineHeight: 20, textDecorationLine: 'underline' }}>Restore Purchases</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>💳</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No plans available</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Please check your connection and try again.</Text>
        </View>
      )}
          <TouchableOpacity
          accessibilityRole="button"
          style={{ alignItems: 'center', paddingVertical: 16 }}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : null}
          accessibilityLabel="Continue with free features">
          <Text style={{ fontSize: 13, color: colors.steel, textDecorationLine: 'underline' }}>
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

  activeBanner: { backgroundColor: COLORS.legal, margin: 12, marginBottom: 4, borderRadius: RADIUS.lg, padding: 16, flexDirection: 'row', alignItems: 'center' },
  activeBannerTitle: { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },
  activeBannerSub:   { color: colors.legal, fontSize: 12, marginTop: 2 },
  cancelLink: { color: '#EF5350', fontSize: 12, lineHeight: 20, ...FONTS.semi },

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
  annualNote: { backgroundColor: COLORS.bgSubtle, marginHorizontal: 12, marginBottom: 4, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#85B7EB' },
  annualNoteText: { fontSize: 11, color: colors.blue, lineHeight: 16 },
  savingsBadgeText: { fontSize: 11, color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  tierPriceSub: { fontSize: 12, color: COLORS.legal, fontWeight: '700', marginTop: 1 },
  footer: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', paddingHorizontal: 24, lineHeight: 16, marginTop: 16 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
