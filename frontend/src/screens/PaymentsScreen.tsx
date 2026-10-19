import { useToast } from '../components/ToastProvider';
import { escapeHtml } from '../utils/html';
import { AppIcon } from '../components/AppIcon';
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
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, LayoutAnimation} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, apiErrorMessage, isPaymentsUnavailable } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { ScreenCapture } from '../utils/webCompat';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';
import { usePaymentSheet, PAYMENTS_COMING_SOON } from '../payments';
import { useAuthGate } from '../components/AuthGate';
import { t, useLang, perLang, locale } from '../i18n';

// ── Payment purposes ──────────────────────────────────────────────────────────

const PURPOSES = perLang(() => [
  { key: 'consultation', label: t('x_payments_consultation_fee'), icon: '💬', defaultAmount: '150', description: t('x_payments_one_time_fee_initial') },
  { key: 'retainer',     label: t('x_payments_attorney_retainer'), icon: '⚖️', defaultAmount: '1500', description: t('x_payments_upfront_retainer_retain_attorney') },
  { key: 'bail',         label: t('x_payments_bail_assistance'),  icon: '🔓', defaultAmount: '500', description: t('x_payments_deposit_toward_bail_bond') },
  { key: 'other',        label: t('x_payments_other_custom'),   icon: '💳', defaultAmount: '100', description: t('x_payments_custom_amount_any_legal') },
]);

// ── Payment methods -- primary 3 + more ───────────────────────────────────────

const PRIMARY_METHODS = perLang(() => [
  { key: 'stripe',    label: t('x_payments_credit_debit_card'), icon: '💳', sub: t('x_payments_visa_mastercard_amex') },
  { key: Platform.OS === 'ios' ? 'apple_pay' : 'google_pay',
    label: Platform.OS === 'ios' ? 'Apple Pay' : 'Google Pay',
    icon: Platform.OS === 'ios' ? '🍎' : '🤖',
    sub: t('x_payments_fast_no_card_entry') },
  { key: 'paypal',    label: 'PayPal', icon: '🅿', sub: t('x_payments_pay_with_paypal_balance') },
]);

const MORE_METHODS = perLang(() => [
  { key: 'braintree',       label: 'Venmo',                icon: '💜', sub: t('x_payments_via_braintree') },
  { key: 'ach',             label: t('x_payments_bank_transfer_ach'),   icon: '🏦', sub: t('x_payments_us_bank_accounts') },
  { key: 'zelle',           label: 'Zelle',                icon: '⚡', sub: t('x_payments_instructions_provided') },
  { key: 'amazon_pay',      label: 'Amazon Pay',           icon: '📦', sub: t('x_payments_amazon_account') },
  { key: 'crypto_coinbase', label: t('x_payments_crypto_coinbase'),    icon: '₿',  sub: 'BTC, ETH, USDC' },
]);

// ── Sub-components ─────────────────────────────────────────────────────────────

function PurposeCard({ p, selected, onSelect }: any) {
  useLang();
  return (
    <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      style={[styles.purposeCard, selected && styles.purposeCardSelected]}
      accessibilityLabel={p.icon} onPress={() => onSelect(p)}
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
  useLang();
  return (
    <TouchableOpacity
      accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      style={[styles.methodRow, selected && styles.methodRowSelected]}
      accessibilityLabel={m.icon} onPress={() => onSelect(m.key)}
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

// Stripe PaymentSheet hook — enables native card sheet instead of browser redirect
function PaymentsScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);


  // Generate PDF payment receipt
  const generateReceipt = React.useCallback(async (payment: Record<string, unknown>) => {
    setGeneratingReceipt(true);
    try {
      const Print   = await import('expo-print');
      const Sharing = await import('expo-sharing');
      const date = new Date(String(payment.created_at || Date.now())).toLocaleDateString(locale(), {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const h = (k: string, p?: Record<string, string | number>) => escapeHtml(t(k, p));
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; padding: 40px; max-width: 600px; margin: 0 auto; color: #1C1C1E; }
  .header { text-align: center; border-bottom: 2px solid #1B2A6B; padding-bottom: 20px; margin-bottom: 30px; }
  .logo { font-size: 28px; font-weight: 900; color: #1B2A6B; }
  .tagline { font-size: 13px; color: #6B7280; margin-top: 4px; }
  h2 { font-size: 22px; color: #1B2A6B; margin: 0 0 4px; }
  .receipt-no { font-size: 12px; color: #6B7280; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  td { padding: 10px 0; font-size: 14px; border-bottom: 1px solid #E5E7EB; }
  td:last-child { text-align: right; font-weight: 600; }
  .total td { font-size: 16px; font-weight: 700; border-bottom: 2px solid #1B2A6B; color: #1B2A6B; }
  .footer { margin-top: 40px; font-size: 11px; color: #9CA3AF; text-align: center; }
</style></head><body>
<div class="header">
  <div class="logo">⚖️ Justice Gavel</div>
  <div class="tagline">${h('x_payments_rc_tagline')}</div>
</div>
<h2>${h('x_payments_rc_title')}</h2>
<p class="receipt-no">${h('x_payments_rc_number', { number: `JG-${String(payment.id || Date.now()).slice(-8).toUpperCase()}`, date })}</p>
<table>
  <tr><td>${h('x_payments_rc_description')}</td><td>${escapeHtml(payment.description || payment.tier || t('x_payments_rc_subscription'))}</td></tr>
  <tr><td>${h('x_payments_rc_amount')}</td><td>$${((Number((payment as unknown as import('../types/api').Payment).amount_cents) || 0) / 100).toFixed(2)}</td></tr>
  <tr><td>${h('x_payments_rc_status')}</td><td>${escapeHtml(payment.status || t('x_payments_rc_paid'))}</td></tr>
  <tr><td>${h('x_payments_rc_date')}</td><td>${date}</td></tr>
</table>
<table class="total"><tr><td>${h('x_payments_rc_total_paid')}</td><td>$${((Number((payment as any).amount_cents) || 0) / 100).toFixed(2)}</td></tr></table>
<div class="footer">
  ${h('x_payments_rc_footer')}<br>
  ${h('x_payments_rc_questions')}
</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: t('x_payments_save_share_receipt'),
      });
    } catch {
      showToast(t('home_sos_failed'));
    } finally {
      setGeneratingReceipt(false);
    }
  }, [showToast]);

  const { gated, unlocking, unlock } = useBiometricGate('payments');

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [purpose, setPurpose]     = useState(PURPOSES()[0]);
  // Pre-select payment purpose from navigation params
  React.useEffect(() => {
    const productId = (route?.params as Record<string,string>)?.productId;
    if (productId) setPurpose(productId as any);
  }, [route?.params]);

  const [amount, setAmount]       = useState(PURPOSES()[0].defaultAmount);
  const [method, setMethod]       = useState(PRIMARY_METHODS()[0].key);
  const [showMore, setShowMore]   = useState(false);
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const [loading, setLoading]     = useState(false);
  const [status, setStatus]       = useState('');
  const [lastMethod, setLastMethod] = useState<string | null>(null);
  const [generatingReceipt, setGeneratingReceipt] = React.useState(false);
  const [lastPayment, setLastPayment] = React.useState<Record<string, unknown> | null>(null);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  useEffect(() => {
    AsyncStorage.getItem('last_payment_method').then(m => { if (m) setLastMethod(m); });
  }, []);

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;

  const onSelectPurpose = (p: ReturnType<typeof PURPOSES>[0]) => {
    setPurpose(p);
    setAmount(p.defaultAmount);
    setStatus('');
  };

  const allMethods = [
    ...PRIMARY_METHODS(),
    ...(showMore ? MORE_METHODS() : []),
  ];
  const selectedMethod = allMethods.find(m => m.key === method) || PRIMARY_METHODS()[0];

  const onPay = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setStatus(t('x_payments_please_enter_valid_amount')); return; }
    requireAuth(() => doPayment(amt));
  };

  const doPayment = async (amt: number) => {
    setLoading(true);
    setLastPayment(null);
    setStatus('');
    try {
      const res = await api.post('/pay/create', {
        method,
        amount: amt,
        currency: 'USD',
        meta: {
          description: t('x_payments_justice_gavel', { label: purpose.label }),
          purpose: purpose.key,
        }
      });
      await AsyncStorage.setItem('last_payment_method', method).catch(() => {}); // non-fatal storage write
      setLastMethod(method);

      if (res.data?.clientSecret) {
        // Native Stripe PaymentSheet — no browser redirect needed
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: res.data?.clientSecret,
          merchantDisplayName: 'Justice Gavel',
          allowsDelayedPaymentMethods: false,
        });
        if (!initError) {
          const { error: presentError } = await presentPaymentSheet();
          if (!presentError) {
            setStatus(t('x_payments_payment_complete'));
            setLastPayment({ ...(res.data || {}), amount: amt, method, purpose: purpose.label, created_at: new Date().toISOString() });
          } else if (presentError.code === 'payments_unavailable') {
            setStatus(PAYMENTS_COMING_SOON());
          } else if (presentError.code !== 'Canceled') {
            setStatus(presentError.message || t('x_booking_payment_failed_please_try'));
          }
        }
      } else if (res.data?.url) {
        Linking.openURL(res.data?.url).catch(() => showToast(t('action_failed'), 'error'));
        setStatus(t('x_payments_payment_page_opened_complete'));
      } else if (res.data?.instructions) {
        setStatus(res.data?.instructions);
      } else {
        setStatus(t('x_payments_payment_initiated_check_email'));
      }
    } catch (e: any) {
      setLoading(false);
      const serverMsg = apiErrorMessage(e, '');
      const statusCode = e.response?.status;

      if (isPaymentsUnavailable(e) || statusCode === 503) {
        // Billing not configured on the backend -- friendly message, nothing charged
        setStatus(PAYMENTS_COMING_SOON());
      } else if (statusCode === 401 || statusCode === 403) {
        setStatus(t('x_payments_please_sign_make_payment'));
      } else if (!e.response && serverMsg.toLowerCase().includes('network')) {
        setStatus(t('x_ch_no_connection_check_internet'));
      } else {
        setStatus(t('x_payments_payment_could_not_be', { value: (serverMsg || t('x_consumer_subscription_please_try_again')) }));
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
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('x_payments_make_payment')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>{t('x_payments_secure_encrypted_transactions')}</Text>
      </View>

      {/* Step 1: Purpose */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.stepLabel}>{t('x_payments_step_1_what_this')}</Text>
        {PURPOSES().map(p => (
          <PurposeCard key={p.key} p={p} selected={purpose.key === p.key} onSelect={onSelectPurpose} />
        ))}
      </View>

      {/* Step 2: Amount */}
      <View style={styles.section}>
        <Text maxFontSizeMultiplier={1.4} style={styles.stepLabel}>{t('x_payments_step_2_amount')}</Text>
        <View style={styles.amountRow}>
          <Text maxFontSizeMultiplier={1.4} style={styles.currencySymbol}>$</Text>
          <TextInput
          accessibilityLabel="0.00"
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
        <Text maxFontSizeMultiplier={1.4} style={styles.stepLabel}>{t('x_payments_step_3_how_would')}</Text>

        {lastMethod && lastMethod !== method && (
          <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.lastUsedBanner} onPress={() => setMethod(lastMethod)}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.lastUsedText}>
              {t('x_payments_use_last_method', { value: [...PRIMARY_METHODS(), ...MORE_METHODS()].find(m => m.key === lastMethod)?.label || lastMethod })}
            </Text>

          </TouchableOpacity>
        )}

        {allMethods.map(m => (
          <MethodRow key={m.key} m={m} selected={method === m.key} onSelect={setMethod} />
        ))}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.moreToggle} onPress={() => setShowMore(m => !m)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.moreToggleText}>
            {showMore ? t('x_payments_fewer_options') : t('x_payments_more_payment_options_venmo')}
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
          <Text maxFontSizeMultiplier={1.4} style={styles.summaryMeta}>{t('x_payments_via', { label: selectedMethod.label })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.summaryMeta}>{t('qc_encrypted')}</Text>
        </View>

        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6}
          style={[styles.payBtn, loading && styles.payBtnDisabled]}
          onPress={onPay}
          disabled={loading}>
          {loading
            ? <ActivityIndicator color={colors.bgCard} />
            : <Text maxFontSizeMultiplier={1.4} style={styles.payBtnText}>{t('x_payments_pay_with', { value: (parseFloat(amount || '0') || 0).toFixed(2), label: selectedMethod.label })}</Text>
          }
        </TouchableOpacity>

        {!!status && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.statusText,
            (status.startsWith('Payment could') || status.startsWith('Please sign')) && styles.statusError,
            status === PAYMENTS_COMING_SOON() && styles.statusConfig,
          ]}>
            {status}
          </Text>
        )}
        {/* Receipt download (after a completed payment) */}
        {!!lastPayment && (
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                style={{ flexDirection:'row', alignItems:'center', gap:4, marginTop:8,
                  paddingVertical:6 }}
                onPress={() => lastPayment && generateReceipt(lastPayment)}
          hitSlop={{  top: 12, bottom: 12, left: 12, right: 12  }}
                disabled={generatingReceipt}
                accessibilityLabel={t('x_payments_download_payment_receipt')}
              >
                <AppIcon name="document-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
                  color:colors.textBrand, fontWeight:'600' }}>
                  {generatingReceipt ? t('x_expungement_generating') : t('x_payments_download_receipt')}
                </Text>
              </TouchableOpacity>
        )}
      </View>

      <Text maxFontSizeMultiplier={1.4} style={styles.footerNote}>
        {t('x_payments_payments_processed_securely_justice')}
      </Text>

      <View style={{ height: 40 }} />
      <AuthGateModal />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.blue,
        padding:12, marginTop:12, marginBottom:8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:colors.textSecond, lineHeight:16 }}>
          {t('x_payments_payments_processed_securely_by')}
        </Text>
      </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: 0 },
  header: { backgroundColor: COLORS.navy, padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { color: COLORS.bgSubtle, fontSize: 12, lineHeight: 20, marginTop: 3 },
  section: { backgroundColor: COLORS.bgCard, margin: 12, marginBottom: 0, borderRadius: 14, padding: 16, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  stepLabel: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },

  purposeCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1.5, borderColor: COLORS.bgSubtle, borderRadius: 12, marginBottom: 8, backgroundColor: COLORS.bg },
  purposeCardSelected: { borderColor: COLORS.navy, backgroundColor: COLORS.bgSubtle },
  purposeIcon: { fontSize: 22, marginRight: 12 },
  purposeLabel: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textOnGold },
  purposeLabelSelected: { color: COLORS.navy },
  purposeSub: { fontSize: 12, color: COLORS.info, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 8, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  radioSelected: { borderColor: COLORS.navy },
  radioDot: { width: 10, height: 10, borderRadius: 4, backgroundColor: COLORS.navy },

  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.bg },
  currencySymbol: { fontSize: 22, fontWeight: '700', color: colors.textBrand, marginRight: 4 },
  amountInput: { flex: 1, fontSize: 28, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.navy, paddingVertical: 10 },
  currencyCode: { fontSize: 14, lineHeight: 21, color: colors.info, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  lastUsedBanner: { backgroundColor: colors.legalBg, borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: colors.legal },
  lastUsedText: { fontSize: 12, lineHeight: 20, color: colors.legal, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  methodRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderWidth: 1.5, borderColor: COLORS.bgSubtle, borderRadius: 12, marginBottom: 8, backgroundColor: COLORS.bg },
  methodRowSelected: { borderColor: COLORS.navy, backgroundColor: COLORS.bgSubtle },
  methodIcon: { fontSize: 22, marginRight: 12 },
  methodLabel: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textOnGold },
  methodLabelSelected: { color: COLORS.navy },
  methodSub: { fontSize: 12, color: COLORS.info, marginTop: 1 },
  checkmark: { fontSize: 18, color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginLeft: 4 },
  moreToggle: { alignItems: 'center', paddingVertical: 8 },
  moreToggleText: { fontSize: 12, lineHeight: 20, color: colors.blue, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  summaryCard: { margin: 12, backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.07, shadowRadius: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  summaryLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
  summaryAmount: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textBrand },
  summaryMeta: { fontSize: 12, color: colors.info },
  payBtn: { backgroundColor: colors.legal, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  payBtnDisabled: { opacity: 0.6 },
  payBtnText: { color: colors.bgCard, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  statusText: { marginTop: 12, fontSize: 12, color: colors.legal, textAlign: 'center', lineHeight: 18 },
  statusConfig: { color: COLORS.info, backgroundColor: COLORS.infoBg, padding: 12, borderRadius: 8, marginTop: 10, lineHeight: 20 },
  statusError: { color: colors.emergency },
  footerNote: { textAlign: 'center', color: colors.info, fontSize: 12, marginTop: 8, paddingHorizontal: 24, lineHeight: 18 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(PaymentsScreen);
