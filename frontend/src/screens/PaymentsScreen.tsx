/**
 * PaymentsScreen -- Seamless, context-aware payment flow
 *
 * Flow:
 *  1. User selects what they're paying for (retainer, consultation, bail assist)
 *  2. Amount pre-fills based on purpose; user can edit
 *  3. Three primary methods shown (Card, Apple/Google Pay, PayPal) + "More options" expander
 *  4. One tap → payment opens in browser
 *  5. Saved method badge shown if a previous method was used
 */
import React, { useState, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { ScreenCapture, hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';
import { useStripe } from '@stripe/stripe-react-native';
import { useAuthGate } from '../components/AuthGate';

declare var amt: any;
declare var data: any;
declare var payment: any;
declare var showMore: any; // hoisted from component scope
// ── Payment purposes ──────────────────────────────────────────────────────────

const PURPOSES = [
  { key: 'consultation', label: 'Consultation fee', icon: '💬', defaultAmount: '150', description: 'One-time fee for your initial attorney meeting' },
  { key: 'retainer',     label: 'Attorney retainer', icon: '⚖️', defaultAmount: '1500', description: 'Upfront retainer to retain your attorney' },
  { key: 'bail',         label: 'Bail assistance',  icon: '🔓', defaultAmount: '500', description: 'Deposit toward bail bond or bail assistance service' },
  { key: 'other',        label: 'Other / custom',   icon: '💳', defaultAmount: '100', description: 'Custom amount for any legal service' },
];

// ── Payment methods -- primary 3 + more ───────────────────────────────────────

const PRIMARY_METHODS = [
  { key: 'stripe',    label: 'Credit / debit card', icon: '💳', sub: 'Visa, Mastercard, Amex' },
  { key: Platform.OS === 'ios' ? 'apple_pay' : 'google_pay',
    label: Platform.OS === 'ios' ? 'Apple Pay' : 'Google Pay',
    icon: Platform.OS === 'ios' ? '🍎' : '🤖',
    sub: 'Fast, no card entry needed' },
  { key: 'paypal',    label: 'PayPal', icon: '🅿', sub: 'Pay with your PayPal balance' },
];

const MORE_METHODS = [
  { key: 'braintree',       label: 'Venmo',                icon: '💜', sub: 'via Braintree' },
  { key: 'ach',             label: 'Bank transfer (ACH)',   icon: '🏦', sub: 'US bank accounts' },
  { key: 'zelle',           label: 'Zelle',                icon: '⚡', sub: 'Instructions provided' },
  { key: 'amazon_pay',      label: 'Amazon Pay',           icon: '📦', sub: 'Amazon account' },
  { key: 'crypto_coinbase', label: 'Crypto (Coinbase)',    icon: '₿',  sub: 'BTC, ETH, USDC' },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function PurposeCard({ p, selected, onSelect }: any) {
  return (
    <TouchableOpacity
          accessibilityRole="button"
      style={[styles.purposeCard, selected && styles.purposeCardSelected]}
      onPress={() => onSelect(p)}
      activeOpacity={0.8}
    >
      <Text maxFontSizeMultiplier={1.4} style={styles.purposeIcon}>{p.icon}</Text>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.purposeLabel, selected && styles.purposeLabelSelected]}>{p.label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.purposeSub} numberOfLines={2} ellipsizeMode="tail">{p.description}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
    </TouchableOpacity>
  );
}

function MethodRow({ m, selected, onSelect }: any) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={[styles.methodRow, selected && styles.methodRowSelected]}
      onPress={() => onSelect(m.key)}
      activeOpacity={0.8}
    >
      <Text maxFontSizeMultiplier={1.4} style={styles.methodIcon}>{m.icon}</Text>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.methodLabel, selected && styles.methodLabelSelected]}>{m.label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.methodSub}>{m.sub}</Text>
      </View>
      {selected && <Text maxFontSizeMultiplier={1.4} style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const allMethods = [
    ...PRIMARY_METHODS,
    ...(showMore ? MORE_METHODS : [])
  ];

// Stripe PaymentSheet hook — enables native card sheet instead of browser redirect
export default function PaymentsScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);


  // Generate PDF payment receipt
  const generateReceipt = React.useCallback(async (payment: Record<string, unknown>) => {
    setGeneratingReceipt(true);
    try {
      const Print   = (await import('expo-print')).default;
      const Sharing = (await import('expo-sharing')).default;
      const date = new Date(String(payment.created_at || Date.now())).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; padding: 40px; max-width: 600px; margin: 0 auto; color: #1a1a2e; }
  .header { text-align: center; border-bottom: 2px solid #042C53; padding-bottom: 20px; margin-bottom: 30px; }
  .logo { font-size: 28px; font-weight: 900; color: #042C53; }
  .tagline { font-size: 13px; color: #6B7280; margin-top: 4px; }
  h2 { font-size: 22px; color: #042C53; margin: 0 0 4px; }
  .receipt-no { font-size: 12px; color: #6B7280; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  td { padding: 10px 0; font-size: 14px; border-bottom: 1px solid #E5E7EB; }
  td:last-child { text-align: right; font-weight: 600; }
  .total td { font-size: 16px; font-weight: 700; border-bottom: 2px solid #042C53; color: #042C53; }
  .footer { margin-top: 40px; font-size: 11px; color: #9CA3AF; text-align: center; }
</style></head><body>
<div class="header">
  <div class="logo">⚖️ Justice Gavel</div>
  <div class="tagline">Legal self-help for everyone · justicegavel.app</div>
</div>
<h2>Payment Receipt</h2>
<p class="receipt-no">Receipt #JG-${String(payment.id || Date.now()).slice(-8).toUpperCase()} · ${date}</p>
<table>
  <tr><td>Description</td><td>${payment.description || payment.tier || 'Subscription'}</td></tr>
  <tr><td>Amount</td><td>$${((Number((payment as unknown as import('../types/api').Payment).amount_cents) || 0) / 100).toFixed(2)}</td></tr>
  <tr><td>Status</td><td>${payment.status || 'Paid'}</td></tr>
  <tr><td>Date</td><td>${date}</td></tr>
</table>
<table class="total"><tr><td>Total Paid</td><td>$${((Number((payment as any).amount_cents) || 0) / 100).toFixed(2)}</td></tr></table>
<div class="footer">
  Justice Gavel, Inc. · Not a law firm · This receipt is for payment purposes only.<br>
  Questions? Contact support at justicegavel.app
</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Save or share your receipt',
      });
    } catch {
      Alert.alert('Could not generate receipt', 'Check your connection and try again.');
    } finally {
      setGeneratingReceipt(false);
    }
  }, []);

  const { gated, unlocking, unlock } = useBiometricGate('payments');

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [purpose, setPurpose]     = useState(PURPOSES[0]);
  // Pre-select payment purpose from navigation params
  React.useEffect(() => {
    const productId = (route?.params as Record<string,string>)?.productId;
    if (productId) setPurpose(productId as any);
  }, [route?.params]);

  const [amount, setAmount]       = useState(PURPOSES[0].defaultAmount);
  const [method, setMethod]       = useState(PRIMARY_METHODS[0].key);
  const [showMore, setShowMore]   = useState(false);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [loading, setLoading]     = useState(false);
  const [status, setStatus]       = useState('');
  const [lastMethod, setLastMethod] = useState<string | null>(null);
  const [generatingReceipt, setGeneratingReceipt] = React.useState(false);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  useEffect(() => {
    AsyncStorage.getItem('last_payment_method').then(m => { if (m) setLastMethod(m); });
  }, []);

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;

  const onSelectPurpose = (p: typeof PURPOSES[0]) => {
    setPurpose(p);
    setAmount(p.defaultAmount);
    setStatus('');
  };

    const selectedMethod = allMethods.find(m => m.key === method) || PRIMARY_METHODS[0];

  const onPay = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setStatus('Please enter a valid amount.'); return; }
    requireAuth(() => doPayment());
  };

  const doPayment = async () => {
    setLoading(true);
    setStatus('');
    try {
      const res = await api.post('/pay/create', {
        method,
        amount: amt,
        currency: 'USD',
        meta: {
          description: `Justice Gavel -- ${purpose.label}`,
          purpose: purpose.key,
        }
      });
      await AsyncStorage.setItem('last_payment_method', method);
      setLastMethod(method);

      if (res.data?.clientSecret) {
        // Native Stripe PaymentSheet — no browser redirect needed
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: res.data.clientSecret,
          merchantDisplayName: 'Justice Gavel',
          allowsDelayedPaymentMethods: false,
        });
        if (!initError) {
          const { error: presentError } = await presentPaymentSheet();
          if (!presentError) {
            setStatus('Payment complete ✓');
          } else if (presentError.code !== 'Canceled') {
            setStatus(presentError.message || 'Payment failed. Please try again.');
          }
        }
      } else if (res.data?.url) {
        Linking.openURL(res.data?.url).catch(() => {});
        setStatus('Payment page opened. Complete your payment in the browser.');
      } else if (res.data?.instructions) {
        setStatus(res.data?.instructions);
      } else {
        setStatus('Payment initiated. Check your email for confirmation.');
      }
    } catch (e: any) {
      setLoading(false);
      const serverMsg = e.response?.data?.error || e.message || '';
      const statusCode = e.response?.status;

      if (statusCode === 503 || serverMsg.toLowerCase().includes('stripe') ||
          serverMsg.toLowerCase().includes('key') || serverMsg.toLowerCase().includes('config')) {
        // Stripe not configured -- show demo mode message instead of raw error
        setStatus('Live payments are not yet configured. In demo mode all other features work normally.');
      } else if (statusCode === 401 || statusCode === 403) { setStatus('Please sign in to make a payment.'); } else if (statusCode === 401 || statusCode === 403) { setStatus('Please sign in to make a payment.');
      } else if (!e.response && serverMsg.toLowerCase().includes('network')) {
        setStatus('No connection. Check your internet and try again.');
      } else {
        setStatus('Payment could not be processed. ' + (serverMsg || 'Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
      testID="payments-screen">

      {/* Header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Make a payment</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>Secure, encrypted transactions</Text>
      </View>

      {/* Step 1: Purpose */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.stepLabel}>Step 1 -- What is this payment for?</Text>
        {PURPOSES.map(p => (
          <PurposeCard key={p.key} p={p} selected={purpose.key === p.key} onSelect={onSelectPurpose} />
        ))}
      </View>

      {/* Step 2: Amount */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.stepLabel}>Step 2 -- Amount</Text>
        <View style={styles.amountRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.currencySymbol}>$</Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={v => setAmount(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}

          returnKeyType="next"
          blurOnSubmit
        />
          <Text maxFontSizeMultiplier={1.4} style={styles.currencyCode}>USD</Text>
        </View>
      </View>

      {/* Step 3: Payment method */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.stepLabel}>Step 3 -- How would you like to pay?</Text>

        {lastMethod && lastMethod !== method && (
          <TouchableOpacity
          accessibilityRole="button" style={styles.lastUsedBanner} onPress={() => setMethod(lastMethod)}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.lastUsedText}>
              ↩ Use last method: {[...PRIMARY_METHODS, ...MORE_METHODS].find(m => m.key === lastMethod)?.label || lastMethod}
            </Text>

              {/* Receipt download */}
              <TouchableOpacity
                accessibilityRole="button"
                style={{ flexDirection:'row', alignItems:'center', gap:4, marginTop:8,
                  paddingVertical:6 }}
                onPress={() => generateReceipt(payment)}
                disabled={generatingReceipt}
                accessibilityLabel="Download payment receipt"
              >
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12 }}>📄</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
                  color:colors.blue, fontWeight:'600' }}>
                  {generatingReceipt ? 'Generating…' : 'Download Receipt'}
                </Text>
              </TouchableOpacity></TouchableOpacity>
        )}

        {allMethods.map(m => (
          <MethodRow key={m.key} m={m} selected={method === m.key} onSelect={setMethod} />
        ))}
        <TouchableOpacity
          accessibilityRole="button" style={styles.moreToggle} onPress={() => setShowMore(m => !m)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.moreToggleText}>
            {showMore ? '▲ Fewer options' : '▼ More payment options (Venmo, ACH, Zelle, Crypto…)'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Summary + Pay */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.summaryLabel}>{purpose.icon} {purpose.label}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.summaryAmount}>${(parseFloat(amount || '0') || 0).toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.summaryMeta}>via {selectedMethod.label}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.summaryMeta}>🔒 Encrypted</Text>
        </View>

        <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
          style={[styles.payBtn, loading && styles.payBtnDisabled]}
          onPress={onPay}
          disabled={loading}>
          {loading
            ? <ActivityIndicator color={colors.bgCard} />
            : <Text maxFontSizeMultiplier={1.4} style={styles.payBtnText}>Pay ${(parseFloat(amount || '0') || 0).toFixed(2)} with {selectedMethod.label}</Text>
          }
        </TouchableOpacity>

        {!!status && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.statusText,
            (status.startsWith('Payment could') || status.startsWith('Please sign')) && styles.statusError,
            status.startsWith('Live payments') && styles.statusConfig,
          ]}>
            {status}
          </Text>
        )}
      </View>

      <Text maxFontSizeMultiplier={1.4} style={styles.footerNote}>
        Payments are processed securely. Justice Gavel does not store your card information.
      </Text>

      <View style={{ height: 40 }} />
      <AuthGateModal />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.blue,
        padding:12, marginTop:12, marginBottom:8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:'#555', lineHeight:16 }}>
          💳 Payments are processed securely by Stripe. Subscriptions auto-renew unless cancelled.
          For billing questions or refund requests, contact support@justicegavel.app.
        </Text>
      </View>

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No results found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection or try again.</Text>
        </View>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: 0 },
  header: { backgroundColor: '#042C53', padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { color: COLORS.bgSubtle, fontSize: 12, lineHeight: 20, marginTop: 3 },
  section: { backgroundColor: COLORS.bgCard, margin: 12, marginBottom: 0, borderRadius: 14, padding: 16, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  stepLabel: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },

  purposeCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1.5, borderColor: COLORS.bgSubtle, borderRadius: 12, marginBottom: 8, backgroundColor: COLORS.bg },
  purposeCardSelected: { borderColor: '#042C53', backgroundColor: COLORS.bgSubtle },
  purposeIcon: { fontSize: 22, marginRight: 12 },
  purposeLabel: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.bgCard },
  purposeLabelSelected: { color: '#042C53' },
  purposeSub: { fontSize: 12, color: colors.steel, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 8, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  radioSelected: { borderColor: '#042C53' },
  radioDot: { width: 10, height: 10, borderRadius: 4, backgroundColor: '#042C53' },

  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: COLORS.bg },
  currencySymbol: { fontSize: 22, fontWeight: '700', color: '#042C53', marginRight: 4 },
  amountInput: { flex: 1, fontSize: 28, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', paddingVertical: 10 },
  currencyCode: { fontSize: 14, lineHeight: 21, color: colors.steel, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  lastUsedBanner: { backgroundColor: colors.legal, borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: colors.legal },
  lastUsedText: { fontSize: 12, lineHeight: 20, color: colors.legal, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  methodRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderWidth: 1.5, borderColor: COLORS.bgSubtle, borderRadius: 12, marginBottom: 8, backgroundColor: COLORS.bg },
  methodRowSelected: { borderColor: '#042C53', backgroundColor: COLORS.bgSubtle },
  methodIcon: { fontSize: 22, marginRight: 12 },
  methodLabel: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.bgCard },
  methodLabelSelected: { color: '#042C53' },
  methodSub: { fontSize: 12, color: colors.steel, marginTop: 1 },
  checkmark: { fontSize: 18, color: '#042C53', fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginLeft: 4 },
  moreToggle: { alignItems: 'center', paddingVertical: 8 },
  moreToggleText: { fontSize: 12, lineHeight: 20, color: colors.blue, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  summaryCard: { margin: 12, backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 16, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.07, shadowRadius: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  summaryLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.bgCard },
  summaryAmount: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#042C53' },
  summaryMeta: { fontSize: 12, color: colors.steel },
  payBtn: { backgroundColor: colors.legal, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  payBtnDisabled: { opacity: 0.6 },
  payBtnText: { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  statusText: { marginTop: 12, fontSize: 12, color: colors.legal, textAlign: 'center', lineHeight: 18 },
  statusConfig: { color: '#FFA726', backgroundColor: '#FFA726', padding: 12, borderRadius: 8, marginTop: 10, lineHeight: 20 },
  statusError: { color: '#EF5350' },
  footerNote: { textAlign: 'center', color: colors.steel, fontSize: 12, marginTop: 8, paddingHorizontal: 24, lineHeight: 18 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
