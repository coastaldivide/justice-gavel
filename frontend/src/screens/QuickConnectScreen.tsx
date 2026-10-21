import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import type { ScreenProps } from '../types/navigation';
import { t, useLang } from '../i18n';
import { hapticSuccess, hapticWarn } from '../services/haptics';
/**
 * QuickConnectScreen -- $20 one-time package
 *
 * $10 for one bail bondsman + $10 for one criminal defense lawyer
 * nearest to the user's location. Single charge, instant delivery.
 * No subscription. No forms. One tap.
 *
 * Flow:
 *   1. Screen loads → GPS + the price quote (price, account credit, amount due)
 *   2. Tap → requireAuth → POST /billing/quickconnect creates the payment →
 *      Stripe payment sheet → POST /billing/quickconnect/confirm
 *      (credit covering the whole price skips the sheet)
 *   3. Result: bondsman card + lawyer card, both with direct Call buttons
 * Without Stripe (no key, or web) the button explains payments aren't available.
 */
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, LayoutAnimation } from 'react-native';
import { getLocation } from '../services/location';
import { api, apiErrorMessage, isPaymentsUnavailable } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import { usePaymentSheet, PAYMENTS_COMING_SOON } from '../payments';
import { getUserState } from '../utils/userState';
import { getToken } from '../utils/secureStorage';
import { locale } from '../i18n';

const QC_PRICE_CENTS = 2000;   // shown until the server's quote arrives (signed out)
const usd = (cents: number) => (cents / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' });
interface Quote { price_cents: number; credit_cents: number; amount_cents: number }
interface QcContact { id: number; name: string; phone: string | null; address?: string | null; rating?: number | null; lat?: number | null; lng?: number | null; specialties?: string[] | string | null; free_consultation?: number | boolean | null }
interface QcResult { charged: string; credit_applied_cents?: number; bondsman: QcContact | null; lawyer: QcContact | null }

// Module-level link helpers: no hooks; failures reported via onError.
function callPhone(phone: string, onError?: () => void) {
  Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => onError?.());
}

function openDirections(lat: number, lng: number, name: string, onError?: () => void) {
  const url = Platform.OS === 'ios'
    ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => onError?.());
}

// ── Contact result card ────────────────────────────────────────────────────────
function ResultCard({ contact, type, price }: { contact: QcContact; type: 'bondsman' | 'lawyer'; price: string }) {
  useLang();
  const { showToast } = useToast();
  const onLinkError = () => showToast(t('x_match_action_unavailable_this_device'), 'error');
  const isBail  = type === 'bondsman';
  const accent  = isBail ? COLORS.bail : COLORS.legal;
  const bg      = isBail ? COLORS.bailBg   : COLORS.legalBg;
  const typeLabel = isBail ? `🔓 ${t('qc_type_bondsman')}` : `⚖️ ${t('qc_type_lawyer')}`;

  let specialties: string[] = [];
  if (contact.specialties) {
    try {
      specialties = Array.isArray(contact.specialties) ? contact.specialties : JSON.parse(String(contact.specialties));
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
  }

  return (
    <View style={[styles.resultCard, { borderLeftColor: accent, borderLeftWidth: 4 }]}>
      {/* Type + price badge */}
      <View style={styles.resultCardHeader}>
        <View style={[styles.typeBadge, { backgroundColor: bg }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.typeBadgeText, { color: accent }]}>{typeLabel}</Text>
        </View>
        <View style={[styles.priceBadge, { backgroundColor: accent + '18' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.priceBadgeText, { color: accent }]}>{price}</Text>
        </View>
      </View>

      {/* Name + address */}
      <Text maxFontSizeMultiplier={1.4} style={styles.contactName}>{contact.name}</Text>
      {contact.address && (
        <Text maxFontSizeMultiplier={1.4} style={styles.contactAddress} numberOfLines={2}>{contact.address}</Text>
      )}

      {/* Rating */}
      {!!contact.rating && (
        <IconLabel icon={ICONS.starFilled} textStyle={styles.contactRating} maxFontSizeMultiplier={1.4}>{Number(contact.rating).toFixed(1)}</IconLabel>
      )}

      {/* Specialties */}
      {specialties.length > 0 && (
        <View style={styles.tagRow}>
          {specialties.slice(0, 3).map(s => (
            <View key={s} style={[styles.tag, { backgroundColor: accent + '15', borderColor: accent + '40' }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.tagText, { color: accent }]}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Free consult badge */}
      {(contact.free_consultation === 1 || contact.free_consultation === true) && (
        <View style={styles.freeConsultBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeConsultText}>{t('x_quick_connect_free_consultation')}</Text>
        </View>
      )}

      {/* Primary CTA -- always visible, large */}
      {contact.phone ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.callBtn, { backgroundColor: accent }]}
          onPress={() => callPhone(String(contact.phone), onLinkError)}
            activeOpacity={0.85}
          accessibilityHint={t('x_bail_search_opens_phone_dialer')}
        >
          <IconLabel icon={ICONS.phone} textStyle={styles.callBtnText} maxFontSizeMultiplier={1.4}>{t('help_now_call')}</IconLabel>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnPhone}>{contact.phone}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.callBtn, { backgroundColor: COLORS.textFaint }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>{t('help_now_no_phone')}</Text>
        </View>
      )}

      {/* Directions */}
      {contact.lat != null && contact.lng != null && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.dirBtn}
          accessibilityLabel={t('help_now_directions')} onPress={() => openDirections(Number(contact.lat), Number(contact.lng), contact.name, onLinkError)}
            activeOpacity={0.85}
        >
          <IconLabel icon={ICONS.directions} textStyle={styles.dirBtnText} maxFontSizeMultiplier={1.4}>{t('help_now_directions')}</IconLabel>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
function QuickConnectScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const [quote, setQuote] = React.useState<Quote>({ price_cents: QC_PRICE_CENTS, credit_cents: 0, amount_cents: QC_PRICE_CENTS });

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    return () => { mountedRef.current = false; };
  }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  // Price, this account's credit and the amount due come from the server (signed out: the list price).
  const loadQuote = React.useCallback(async () => {
    if (!(await getToken().catch(() => null))) return;
    try {
      const r = await api.get<Quote>('/billing/quickconnect/quote');
      if (mountedRef.current && Number.isFinite(r.data?.amount_cents)) setQuote(r.data);
    } catch { /* offline: the list price stays */ }
  }, []);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    loadQuote().finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [loadQuote]);
  const [locReady, setLocReady]   = useState(false);
  const [locError, setLocError]   = useState(false);
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [paying, setPaying]       = useState(false);
  const [result, setResult]       = useState<QcResult | null>(null);
  const [error, setError]         = useState('');
  const { available: sheetAvailable, initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  // A payment that went through whose contacts could not be loaded yet (lost connection) — retried, never re-charged.
  const [paidPi, setPaidPi] = useState<string | null>(null);

  const { requireAuth, AuthGateModal } = useAuthGate(navigation, true); // quick phone+PIN mode

  // Get GPS on mount
  useEffect(() => {
    loadQuote();
    getLocation()
      .then(({ lat, lng }) => {
        if (!mountedRef.current) return;
        setCoords({ lat, lng });
        setLocReady(true);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setLocReady(true);
        setLocError(true);
      });
  }, [loadQuote]);

  const handlePay = () => {
    requireAuth(() => doPay());
  };

  const fail = (msg: string) => {
    if (!mountedRef.current) return;
    setError(msg);
    hapticWarn();
    showToast(msg, 'error');
    setPaying(false);
  };

  /** Load the contacts for a payment that succeeded. null (with a retry message) when that fails. */
  const confirmPaid = async (piId: string): Promise<QcResult | null> => {
    try {
      const r = await api.post<QcResult>('/billing/quickconnect/confirm', { payment_intent_id: piId });
      if (mountedRef.current) setPaidPi(null);
      return r.data;
    } catch {
      fail(t('qc_paid_retry'));
      return null;
    }
  };
  const retryConfirm = async () => {
    if (!paidPi) return;
    setPaying(true); setError('');
    const done = await confirmPaid(paidPi);
    if (done && mountedRef.current) { setResult(done); setPaying(false); hapticSuccess(); }
  };

  const doPay = async () => {
    setPaying(true);
    setError('');
    try {
      const st = await getUserState().catch(() => null);
      const res = await api.post<QcResult & { requires_payment?: boolean; client_secret?: string; payment_intent_id?: string }>('/billing/quickconnect', {
        lat: coords?.lat, lng: coords?.lng, state: st?.code || undefined,
      });
      let done: QcResult | null = res.data?.requires_payment ? null : res.data;
      if (!done) {
        // The card is collected by Stripe's payment sheet; nothing is revealed until it succeeds.
        if (!sheetAvailable || !res.data?.client_secret || !res.data?.payment_intent_id) return fail(PAYMENTS_COMING_SOON());
        const init = await initPaymentSheet({ paymentIntentClientSecret: res.data.client_secret, merchantDisplayName: 'Justice Gavel' });
        if (init.error) return fail(init.error.message || t('x_booking_payment_setup_failed_please'));
        const paid = await presentPaymentSheet();
        if (paid.error) {
          if (paid.error.code === 'Canceled') { if (mountedRef.current) setPaying(false); return; }
          return fail(paid.error.message || t('x_quick_connect_card_was_declined_please'));
        }
        if (mountedRef.current) setPaidPi(res.data.payment_intent_id);
        done = await confirmPaid(res.data.payment_intent_id);
        if (!done) return;
      }
      if (!mountedRef.current) return;
      setResult(done);
      hapticSuccess();
      // Fire post-purchase retention trigger (48hr arrest monitoring upsell)
      api.post('/push/retention/post-purchase', { purchase_type: 'quickconnect' }).catch((e) => { __DEV__ && console.warn(e?.message); });
    } catch (e: any) {
      const status = e?.response?.status;
      if (isPaymentsUnavailable(e) || status === 503) return fail(t('x_common_payments_aren_t_available'));
      if (status === 402) return fail(t('x_quick_connect_card_was_declined_please'));
      if (!e?.response) return fail(t('x_ch_no_connection_check_internet'));
      fail(apiErrorMessage(e, t('x_quick_connect_could_not_connect')));
    }
  };

  // ── Pre-payment view ───────────────────────────────────────────────────────
  if (!result) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}
        testID="quick-connect-screen">
        <AuthGateModal />

        {/* Header */}
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('qc_heading')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>{t('x_quick_connect_one_bondsman_one_lawyer')}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.preScroll} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

          {/* Price breakdown */}
          <View style={styles.priceCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.priceCardTitle}>{t('qc_what_you_get')}</Text>

            <View style={styles.priceRow}>
              <View style={[styles.priceIcon, { backgroundColor: colors.bailBg }]}>
                <AppIcon name="cash-outline" size={20} color={colors.legal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemLabel}>{t('qc_bondsman')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemSub}>{t('qc_bondsman_sub')}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.priceAmount, { color: COLORS.bail }]}>{usd(quote.price_cents / 2)}</Text>
            </View>

            <View style={styles.priceDivider} />

            <View style={styles.priceRow}>
              <View style={[styles.priceIcon, { backgroundColor: colors.legalBg }]}>
                <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemLabel}>{t('qc_lawyer')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemSub}>{t('qc_lawyer_sub')}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.priceAmount, { color: COLORS.legal }]}>{usd(quote.price_cents / 2)}</Text>
            </View>

            <View style={styles.totalRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.totalLabel}>{t('qc_total')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.totalAmount} testID="qc-total">{usd(quote.price_cents)}</Text>
            </View>
            {quote.credit_cents > 0 && (
              <View style={styles.creditRow}>
                <Text maxFontSizeMultiplier={1.4} style={styles.creditLabel}>{t('qc_credit_label')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.creditAmount}>-{usd(quote.credit_cents)}</Text>
              </View>
            )}
            {quote.credit_cents > 0 && (
              <View style={[styles.totalRow, { borderTopWidth: 1.5, borderTopColor: colors.legal, marginTop: 6, paddingTop: 8 }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.totalLabel, { color: colors.legalDark }]}>{t('qc_you_pay')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.totalAmount, { color: colors.legalDark }]}>{usd(quote.amount_cents)}</Text>
              </View>
            )}
            <Text maxFontSizeMultiplier={1.4} style={styles.accountNote}>{t('x_quick_connect_free_account_required_takes')}</Text>
            <View style={{ display: 'none' }}>
            </View>
          </View>

          {/* What happens after */}
          <View style={styles.stepsCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.stepsTitle}>{t('qc_how_it_works')}</Text>
            {[
              { n: '1', text: t('qc_step1_price', { price: usd(quote.amount_cents) }) },
              { n: '2', text: t('qc_step2') },
              { n: '3', text: t('qc_step3') },
              { n: '4', text: t('x_quick_connect_call_them_directly_they') },
            ].map(s => (
              <View key={s.n} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.stepNumText}>{s.n}</Text>
                </View>
                <Text maxFontSizeMultiplier={1.4} style={styles.stepText}>{s.text}</Text>
              </View>
            ))}
          </View>

          {/* Guarantees */}
          <View style={styles.guaranteeRow}>
            {[t('qc_encrypted'), t('qc_no_sub'), t('qc_nearest')].map(g => (
              <View key={g} style={styles.guaranteeChip}>
                <Text maxFontSizeMultiplier={1.4} style={styles.guaranteeText}>{g}</Text>
              </View>
            ))}
          </View>

          {/* Location status */}
          {!locReady ? (
            <View style={styles.locRow}>
              <ActivityIndicator size="small" color={COLORS.navy} style={{ marginRight: 8 }} />
              <Text maxFontSizeMultiplier={1.4} style={styles.locText}>{t('qc_loc_getting')}</Text>
            </View>
          ) : locError ? (
            <View style={[styles.locRow, styles.locError]}>
              <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.locErrorText} maxFontSizeMultiplier={1.4}>{t('x_quick_connect_location_unavailable_we_ll')}</IconLabel>
            </View>
          ) : (
            <View style={[styles.locRow, styles.locReady]}>
              <IconLabel icon={ICONS.location} textStyle={styles.locReadyText} maxFontSizeMultiplier={1.4}>{t('x_quick_connect_location_ready_results_near')}</IconLabel>
            </View>
          )}

          {/* Error */}
          {!!error && (
            <View style={styles.errorBox}>
              <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.errorText} maxFontSizeMultiplier={1.4}>{error}</IconLabel>
            </View>
          )}

          {/* PAY NOW button */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.payNowBtn,
              (!locReady || paying) && styles.payNowBtnDisabled,
            ]}
            testID="pay-button" onPress={paidPi ? retryConfirm : handlePay}
            disabled={!locReady || paying}
            activeOpacity={0.88}
          >
            {paying ? (
              <>
                <ActivityIndicator color={colors.bgCard} size="small" style={{ marginRight: 10 }} />
                <Text maxFontSizeMultiplier={1.4} style={styles.payNowBtnText}>{t('qc_pay_processing')}</Text>
              </>
            ) : (
              <>
                <Text maxFontSizeMultiplier={1.4} style={styles.payNowBtnText}>{paidPi ? t('qc_load_contacts') : `${t('qc_pay_btn')} — ${usd(quote.amount_cents)}`}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.payNowBtnSub}>{t('x_quick_connect_1_bondsman_1_lawyer')}</Text>
              </>
            )}
          </TouchableOpacity>

          <Text maxFontSizeMultiplier={1.4} style={styles.footerNote}>
            {t('x_quick_connect_payments_processed_securely_by')}
          </Text>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    );
  }

  // ── Post-payment results view ──────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AuthGateModal />

      {/* Success header */}
      <View style={[styles.header, styles.headerSuccess]}>
        <AppIcon name="checkmark-circle" size={20} color={colors.legal} />
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('x_family_connect_re_connected')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          {t('x_quick_connect_charged', { charged: result.charged })}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.resultsScroll} showsVerticalScrollIndicator={false}>

        <Text maxFontSizeMultiplier={1.4} style={styles.callPrompt}>
          {t('x_quick_connect_call_them_now_they')}
        </Text>

        {/* Bondsman result */}
        {result.bondsman ? (
          <ResultCard contact={result.bondsman} type="bondsman" price={usd(quote.price_cents / 2)} />
        ) : (
          <View style={styles.noResult}>
            <Text maxFontSizeMultiplier={1.4} style={styles.noResultText}>
              {t('x_quick_connect_no_bondsman_found_our')}
            </Text>
          </View>
        )}

        {/* Lawyer result */}
        {result.lawyer ? (
          <ResultCard contact={result.lawyer} type="lawyer" price={usd(quote.price_cents / 2)} />
        ) : (
          <View style={styles.noResult}>
            <Text maxFontSizeMultiplier={1.4} style={styles.noResultText}>
              {t('x_quick_connect_no_lawyer_found_our')}
            </Text>
          </View>
        )}

        {/* Receipt */}
        <View style={styles.receiptCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.receiptTitle}>{t('x_quick_connect_receipt')}</Text>
          {[t('qc_receipt_bondsman'), t('qc_receipt_lawyer')].map(item => (
            <View key={item} style={styles.receiptRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptItem}>{item}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptPrice}>{usd(quote.price_cents / 2)}</Text>
            </View>
          ))}
          {!!result.credit_applied_cents && (
            <View style={styles.receiptRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptItem}>{t('qc_credit_label')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptPrice}>-{usd(result.credit_applied_cents)}</Text>
            </View>
          )}
          <View style={styles.receiptTotal}>
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptTotalLabel}>{t('x_quick_connect_total_charged')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptTotalAmount}>{result.charged}</Text>
          </View>
        </View>

        {/* Back to home */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.homeBtn}
          accessibilityLabel={t('x_quick_connect_back_home')} onPress={() => navigation.navigate('HomeTab')}
            activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.homeBtnText}>{t('x_quick_connect_back_home')}</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    backgroundColor: COLORS.navy,
    paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 20,
    borderBottomWidth: 2, borderBottomColor: COLORS.steel + '50' },
  headerSuccess: { backgroundColor: COLORS.legal },
  successIcon: { fontSize: 32, textAlign: 'center', marginBottom: 6 },
  heading:    { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, textAlign: 'center' },
  subheading: { fontSize: 12, lineHeight: 20, ...FONTS.medium, color: colors.textOnNavy, marginTop: 4, textAlign: 'center' },

  preScroll:    { padding: 16 },
  resultsScroll:{ padding: 16 },

  // Price card
  priceCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 14, ...SHADOW.md },
  priceCardTitle: { fontSize: 12, lineHeight: 20, ...FONTS.black, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
  priceRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  priceIcon:  { width: 44, height: 44, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  priceIconText: { fontSize: 20 },
  priceItemLabel: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.textPrimary },
  priceItemSub:   { fontSize: 12, color: COLORS.textMuted, marginTop: 2, lineHeight: 16 },
  priceAmount: { fontSize: 22, ...FONTS.black },
  priceDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 14 },
  creditRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 6, paddingHorizontal: 2 },
  creditLabel: { fontSize: 12, lineHeight: 20, color: COLORS.legal, fontWeight: '600' },
  creditAmount: { fontSize: 14, lineHeight: 21, color: colors.legalDark, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 14, borderTopWidth: 2, borderTopColor: COLORS.navy,
    marginTop: 4 },
  totalLabel:  { fontSize: 16, lineHeight: 24, ...FONTS.black, color: COLORS.navy },
  totalAmount: { fontSize: 32, ...FONTS.black, color: COLORS.navy },

  // How it works
  stepsCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg,
    padding: 16, marginBottom: 14, ...SHADOW.sm },
  stepsTitle: { fontSize: 12, lineHeight: 20, ...FONTS.black, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  stepRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  stepNum:    { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText:{ color: COLORS.bgCard, fontSize: 12, lineHeight: 20, ...FONTS.black },
  stepText:   { fontSize: 14,
    ...FONTS.medium, color: COLORS.textPrimary, flex: 1, lineHeight: 19 },

  // Guarantees
  guaranteeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  guaranteeChip: {
    flex: 1, minWidth: 100,
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.pill,
    paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  guaranteeText: { fontSize: 12, ...FONTS.bold, color: COLORS.textSecond },

  // Location status
  locRow:      { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: RADIUS.md, marginBottom: 12 },
  locText:     { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  locError:    { backgroundColor: COLORS.warnBg },
  locErrorText:{ fontSize: 12, lineHeight: 20, color: colors.textOnGold, ...FONTS.medium },
  locReady:    { backgroundColor: COLORS.legalBg },
  locReadyText:{ fontSize: 12, lineHeight: 20, color: COLORS.legal, ...FONTS.bold },

  errorBox: {
    backgroundColor: COLORS.emergencyBg, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.emergency + '44',
    padding: 12, marginBottom: 12 },
  errorText: { color: COLORS.emergency, fontSize: 12, lineHeight: 20, ...FONTS.medium },

  demoHelpCard: {
    backgroundColor: COLORS.steelMid, borderRadius: 14, padding: 16,
    marginTop: 8, marginBottom: 4, borderWidth: 1, borderColor: COLORS.steelMid },
  demoHelpTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.steelMid, marginBottom: 8 },
  demoHelpBody:  { fontSize: 12, color: colors.steel, lineHeight: 20, marginBottom: 10 },
  demoHelpCode:  { fontFamily: 'monospace', backgroundColor: COLORS.bg, color: colors.bgCard },
  demoHelpOr:    { textAlign: 'center', color: colors.steel, marginBottom: 8 },
  demoHelpBtn:   { backgroundColor: COLORS.navy, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  demoHelpBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 12 },
  // Pay Now button
  payNowBtn: {
    backgroundColor: COLORS.navy,
    borderRadius: RADIUS.xl, paddingVertical: 16,
    alignItems: 'center', flexDirection: 'column',
    marginBottom: 12,
    shadowColor: COLORS.navy, shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    borderWidth: 1.5, borderColor: COLORS.steel + '60' },
  payNowBtnDisabled: { opacity: 0.55 },
  payNowBtnText: { color: COLORS.bgCard, fontSize: 20, ...FONTS.black, letterSpacing: 0.3 },
  payNowBtnSub:  { color: COLORS.steel, fontSize: 11, ...FONTS.medium, marginTop: 4, letterSpacing: 0.2 },

  practiceAreaWrap: { backgroundColor: COLORS.bgCard, borderRadius: 14, marginBottom: 14, overflow: 'hidden' },
  accountNote: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginTop: 6, marginBottom: -6, fontStyle: 'italic' },
  footerNote: { textAlign: 'center', color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 4 },

  // Results
  callPrompt: { fontSize: 15, ...FONTS.bold, color: colors.textBrand, textAlign: 'center', marginBottom: 16, lineHeight: 21 },

  resultCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg,
    padding: 16, marginBottom: 14, ...SHADOW.md },
  resultCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge:     { paddingHorizontal: 10, paddingVertical: 10, borderRadius: RADIUS.pill },
  typeBadgeText: { fontSize: 12, ...FONTS.bold },
  priceBadge:    { paddingHorizontal: 10, paddingVertical: 10, borderRadius: RADIUS.pill },
  priceBadgeText:{ fontSize: 14, lineHeight: 21, ...FONTS.black },
  contactName:   { fontSize: 18, ...FONTS.heavy, color: COLORS.textPrimary, marginBottom: 3 },
  contactAddress:{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6, lineHeight: 16 },
  contactRating: { fontSize: 12, color: colors.textOnGold, ...FONTS.bold, marginBottom: 6 },
  tagRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  tag:           { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  tagText:       { fontSize: 11, ...FONTS.medium },
  freeConsultBadge: { backgroundColor: COLORS.legalBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, alignSelf: 'flex-start', marginBottom: 10 },
  freeConsultText:  { color: COLORS.legal, fontSize: 12, ...FONTS.bold },
  callBtn: { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  callBtnText:  { color: colors.textOnGold, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 1 },
  callBtnPhone: { color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 20, ...FONTS.medium, marginTop: 3 },
  dirBtn:       { backgroundColor: COLORS.bg, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  dirBtnText:   { fontSize: 12, lineHeight: 20, ...FONTS.bold, color: COLORS.textSecond },

  noResult: { backgroundColor: COLORS.warnBg, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: COLORS.warn + '33' },
  noResultText: { fontSize: 12, color: colors.textOnGold, ...FONTS.medium, lineHeight: 19 },

  // Receipt
  receiptCard: { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14 },
  receiptTitle: { fontSize: 11, ...FONTS.black, color: COLORS.info, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  receiptRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  receiptItem: { fontSize: 12, lineHeight: 20, color: colors.textOnGold, ...FONTS.medium },
  receiptPrice:{ fontSize: 12, lineHeight: 20, color: COLORS.info, ...FONTS.bold },
  receiptTotal:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.steel + '30', paddingTop: 12, marginTop: 4 },
  receiptTotalLabel:  { fontSize: 14, lineHeight: 21, color: colors.textOnGold, ...FONTS.bold },
  receiptTotalAmount: { fontSize: 22, color: colors.textOnGold, ...FONTS.black },

  homeBtn: { alignItems: 'center', paddingVertical: 16 },
  homeBtnText: { fontSize: 14, lineHeight: 21, color: colors.info, ...FONTS.bold } });

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(QuickConnectScreen);