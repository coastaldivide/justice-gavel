import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
import type { ScreenProps } from '../types/navigation';
import { t, useLang } from '../i18n';
import { hapticSuccess, hapticWarn } from '../services/haptics';
/**
 * QuickConnectScreen -- $19.99 one-time package
 *
 * $10 for one bail bondsman + $10 for one criminal defense lawyer
 * nearest to the user's location. Single charge, instant delivery.
 * No subscription. No forms. One tap.
 *
 * Flow:
 *   1. Screen loads → GPS fires → "Pay Now $19.99" button ready
 *   2. Tap → requireAuth → charge $19.99
 *   3. Result: bondsman card + lawyer card, both with direct Call buttons
 */
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, LayoutAnimation } from 'react-native';
import { getLocation } from '../services/location';
import { api, apiErrorMessage, isPaymentsUnavailable } from '../services/api';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';

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
function ResultCard({ contact, type, price }: { contact: Record<string,any>; type: 'bondsman' | 'lawyer'; price: string }) {
  useLang();
  const { showToast } = useToast();
  const onLinkError = () => showToast(t('x_match_action_unavailable_this_device'), 'error');
  const isBail  = type === 'bondsman';
  const accent  = isBail ? COLORS.bail : COLORS.legal;
  const bg      = isBail ? COLORS.bailBg   : COLORS.legalBg;
  const typeLabel = isBail ? '🔓 Bail Bondsman' : '⚖️ Criminal Defense Lawyer';

  let specialties: string[] = [];
  if (contact.specialties) {
    try {
      specialties = Array.isArray(contact.specialties) ? contact.specialties : JSON.parse(contact.specialties);
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
      {contact.rating && (
        <Text maxFontSizeMultiplier={1.4} style={styles.contactRating}>★ {contact.rating.toFixed(1)}</Text>
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
      {contact.free_consultation === 1 && (
        <View style={styles.freeConsultBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.freeConsultText}>{t('x_quick_connect_free_consultation')}</Text>
        </View>
      )}

      {/* Primary CTA -- always visible, large */}
      {contact.phone ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.callBtn, { backgroundColor: accent }]}
          onPress={() => callPhone(contact.phone, onLinkError)}
            activeOpacity={0.85}
          accessibilityHint={t('x_bail_search_opens_phone_dialer')}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>{t('help_now_call')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnPhone}>{contact.phone}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.callBtn, { backgroundColor: COLORS.textFaint }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>{t('help_now_no_phone')}</Text>
        </View>
      )}

      {/* Directions */}
      {contact.lat && contact.lng && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.dirBtn}
          accessibilityLabel={t('help_now_directions')} onPress={() => openDirections(contact.lat, contact.lng, contact.name, onLinkError)}
            activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.dirBtnText}>{t('help_now_directions')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
function QuickConnectScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const [credit, setCredit] = React.useState<number>(0);

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    return () => { mountedRef.current = false; };
  }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/billing/subscription')
      .then(r => { if (mountedRef.current) setCredit(Number(r.data?.credit_cents) || 0); })
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, []);
  const [locReady, setLocReady]   = useState(false);
  const [locError, setLocError]   = useState(false);
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [paying, setPaying]       = useState(false);
  const [result, setResult]       = useState<any>(null);
  const [error, setError]         = useState('');

  const { requireAuth, AuthGateModal } = useAuthGate(navigation, true); // quick phone+PIN mode

  // Get GPS on mount
  useEffect(() => {
    api.get('/billing/subscription')
      .then(r => { if (mountedRef.current) setCredit(Number(r.data?.credit_cents) || 0); })
      .catch(() => {});
    getLocation()
      .then(({ lat, lng }) => {
        setCoords({ lat, lng });
        setLocReady(true);
      })
      .catch(() => {
        setLocReady(true);
        setLocError(true);
      });
  }, []);

  const handlePay = () => {
    requireAuth(() => doPay());
  };

  const doPay = async () => {
    setPaying(true);
    setError('');
    try {
          const res = await api.post('/billing/quickconnect', {
        lat:          (coords as any)?.lat,
        lng:          (coords as any)?.lng,
        state:        (coords as any)?.state || '',  // derived from GPS reverse-geocode in backend
      });
      setResult(res.data || null);
      hapticSuccess();
      // Fire post-purchase retention trigger (48hr arrest monitoring upsell)
      api.post('/push/retention/post-purchase', { purchase_type: 'quickconnect' }).catch((e) => { __DEV__ && console.warn(e?.message); });
    } catch (e: any) {
      const errMsg   = apiErrorMessage(e, '');
      const status   = e.response?.status;
      let userMsg = errMsg;

      if (isPaymentsUnavailable(e) || status === 503) {
        userMsg = t('x_common_payments_aren_t_available');
      } else if (status === 402 && errMsg.toLowerCase().includes('payment')) {
        userMsg = t('x_quick_connect_card_was_declined_please');
      } else if (!e.response) {
        userMsg = t('x_ch_no_connection_check_internet');
      }

      setError(userMsg);
      hapticWarn();
      showToast(userMsg, 'error');
      setPaying(false);
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
              <Text maxFontSizeMultiplier={1.4} style={[styles.priceAmount, { color: COLORS.bail }]}>$10</Text>
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
              <Text maxFontSizeMultiplier={1.4} style={[styles.priceAmount, { color: COLORS.legal }]}>$10</Text>
            </View>

            <View style={styles.totalRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.totalLabel}>{t('qc_total')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.totalAmount}>$19.99</Text>
            </View>
            {credit > 0 && (
              <View style={styles.creditRow}>
                <Text maxFontSizeMultiplier={1.4} style={styles.creditAmount}>-${((credit ?? 0) / 100).toFixed(2)}</Text>
              </View>
            )}
            {credit > 0 && (
              <View style={[styles.totalRow, { borderTopWidth: 1.5, borderTopColor: colors.legal, marginTop: 6, paddingTop: 8 }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.totalLabel, { color: colors.legalDark }]}>{t('qc_you_pay')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.totalAmount, { color: colors.legalDark }]}>${Math.max(0, (2000 - credit) / 100).toFixed(2)}</Text>
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
              { n: '1', text: t('x_quick_connect_tap_pay_now_one') },
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
              <Text maxFontSizeMultiplier={1.4} style={styles.locErrorText}>
                {t('x_quick_connect_location_unavailable_we_ll')}
              </Text>
            </View>
          ) : (
            <View style={[styles.locRow, styles.locReady]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.locReadyText}>{t('x_quick_connect_location_ready_results_near')}</Text>
            </View>
          )}

          {/* Error */}
          {!!error && (
            <View style={styles.errorBox}>
              <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>⚠ {error}</Text>
            </View>
          )}

          {/* PAY NOW button */}
          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.payNowBtn,
              (!locReady || paying) && styles.payNowBtnDisabled,
            ]}
            testID="pay-button" onPress={handlePay}
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
                <Text maxFontSizeMultiplier={1.4} style={styles.payNowBtnText}>{credit > 0 ? t('x_quick_connect_pay_now', { value: Math.max(0,(2000-credit)/100).toFixed(2) }) : `${t('qc_pay_btn')} -- $19.99`}</Text>
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
          {result.mock ? t('x_family_connect_demo_mode_no_real_2') : t('x_quick_connect_charged', { charged: result.charged })}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.resultsScroll} showsVerticalScrollIndicator={false}>

        <Text maxFontSizeMultiplier={1.4} style={styles.callPrompt}>
          {t('x_quick_connect_call_them_now_they')}
        </Text>

        {/* Bondsman result */}
        {result.bondsman ? (
          <ResultCard contact={result.bondsman} type="bondsman" price="$10" />
        ) : (
          <View style={styles.noResult}>
            <Text maxFontSizeMultiplier={1.4} style={styles.noResultText}>
              {t('x_quick_connect_no_bondsman_found_our')}
            </Text>
          </View>
        )}

        {/* Lawyer result */}
        {result.lawyer ? (
          <ResultCard contact={result.lawyer} type="lawyer" price="$10" />
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
          {(result.breakdown || []).map((b: any) => (
            <View key={b.item} style={styles.receiptRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptItem}>{b.item}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptPrice}>{b.price}</Text>
            </View>
          ))}
          <View style={styles.receiptTotal}>
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptTotalLabel}>{t('x_quick_connect_total_charged')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptTotalAmount}>{result.charged || '$19.99'}</Text>
          </View>
          {result.mock && (
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptMock}>{t('x_family_connect_demo_mode_no_real_2')}</Text>
          )}
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
  creditLabel: { fontSize: 12, lineHeight: 20, color: colors.legal, fontWeight: '600' },
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
  receiptMock: { fontSize: 11, color: COLORS.info, textAlign: 'center', marginTop: 8 },

  homeBtn: { alignItems: 'center', paddingVertical: 16 },
  homeBtnText: { fontSize: 14, lineHeight: 21, color: colors.info, ...FONTS.bold } });

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(QuickConnectScreen);