import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
import { t } from '../i18n';
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
import { ActivityIndicator, Alert, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getLocation } from '../services/location';
import { api } from '../services/api';
import PracticeAreaSelector from '../components/PracticeAreaSelector';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';

declare var credit: any;
declare var data: any;
declare var setCredit: any;
function callPhone(phone: string) {
  Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => {}).catch(() => {});
}

function openDirections(lat: number, lng: number, name: string) {
  const url = Platform.OS === 'ios'
    ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() => {});
}

// ── Contact result card ────────────────────────────────────────────────────────
function ResultCard({ contact, type, price }: { contact: Record<string,any>; type: 'bondsman' | 'lawyer'; price: string }) {
  const isBail  = type === 'bondsman';
  const accent  = isBail ? COLORS.bail : COLORS.legal;
  const bg      = isBail ? COLORS.bailBg   : COLORS.legalBg;
  const typeLabel = isBail ? '🔓 Bail Bondsman' : '⚖️ Criminal Defense Lawyer';

  let specialties: string[] = [];
  if (contact.specialties) {
    try { specialties = JSON.parse(contact.specialties); } catch (e: any) { __DEV__ && console.warn(e?.message); }
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
          <Text maxFontSizeMultiplier={1.4} style={styles.freeConsultText}>✓ Free consultation</Text>
        </View>
      )}

      {/* Primary CTA -- always visible, large */}
      {contact.phone ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.callBtn, { backgroundColor: accent }]}
          onPress={() => callPhone(contact.phone)}
            activeOpacity={0.85}
          accessibilityLabel={`Call ${contact.name}`}
          accessibilityHint="Opens your phone dialer"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>📞  CALL NOW</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnPhone}>{contact.phone}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.callBtn, { backgroundColor: COLORS.textFaint }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>No phone on file</Text>
        </View>
      )}

      {/* Directions */}
      {contact.lat && contact.lng && (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.dirBtn}
          accessibilityLabel="\ud83d\uddfa  Get Directions" onPress={() => openDirections(contact.lat, contact.lng, contact.name)}
            activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.dirBtnText}>🗺  Get Directions</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function QuickConnectScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/billing/subscription')
      .then(r => { if (mountedRef.current) setCredit(r.data?.credit_cents ?? null); })
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, []);
  const [locReady, setLocReady]   = useState(false);
  const [locError, setLocError]   = useState(false);
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [paying, setPaying]       = useState(false);
  const [result, setResult]       = useState<any>(null);
  const [error, setError]         = useState('');
  const [showDemoHelp, setShowDemoHelp] = useState(false);
  const [practiceArea, setPracticeArea] = useState('');

  const { requireAuth, AuthGateModal } = useAuthGate(navigation, true); // quick phone+PIN mode

  // Get GPS on mount
  useEffect(() => {
    api.get('/billing/subscription')
      .then(r => { if (mountedRef.current) setCredit(r.data?.credit_cents ?? null); })
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
        practice_area: practiceArea || undefined });
      setResult(res.data || null);
      hapticSuccess();
      // Fire post-purchase retention trigger (48hr arrest monitoring upsell)
      api.post('/push/retention/post-purchase', { purchase_type: 'quickconnect' }).catch((e) => { __DEV__ && console.warn(e?.message); });
    } catch (e: any) {
      const errMsg   = e.response?.data?.error || e.message || '';
      const status   = e.response?.status;
      let userMsg = errMsg;

      if (status === 503 || errMsg.toLowerCase().includes('stripe') || errMsg.toLowerCase().includes('key')) {
        userMsg = 'Demo mode -- no charge was made.';
        setShowDemoHelp(true);
      } else if (status === 402 && errMsg.toLowerCase().includes('payment')) {
        userMsg = 'Card was declined. Please try a different payment method.';
      } else if (!e.response) {
        userMsg = 'No connection. Check your internet and try again.';
      }

      setError(userMsg);
      hapticWarn();
      if (status !== 503) Alert.alert('Payment issue', userMsg);
    } finally {
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
          <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Quick Connect</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>One bondsman + one lawyer -- right now</Text>
        </View>

        <ScrollView contentContainerStyle={styles.preScroll} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

          {/* Price breakdown */}
          <View style={styles.priceCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.priceCardTitle}>What you get</Text>

            <View style={styles.priceRow}>
              <View style={[styles.priceIcon, { backgroundColor: colors.bailBg }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceIconText}>💰</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemLabel}>1 Bail Bondsman</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemSub}>Nearest licensed bondsman to you. Direct call button.</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.priceAmount, { color: COLORS.bail }]}>$10</Text>
            </View>

            <View style={styles.priceDivider} />

            <View style={styles.priceRow}>
              <View style={[styles.priceIcon, { backgroundColor: colors.legalBg }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceIconText}>⚖️</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemLabel}>1 Criminal Defense Lawyer</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.priceItemSub}>Nearest verified attorney. Direct call button.</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.priceAmount, { color: COLORS.legal }]}>$10</Text>
            </View>

            <View style={styles.totalRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.totalLabel}>Total</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.totalAmount}>$19.99</Text>
            </View>
            {credit > 0 && (
              <View style={styles.creditRow}>
                <Text maxFontSizeMultiplier={1.4} style={styles.creditLabel}>Referral credit</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.creditAmount}>-${((credit ?? 0) / 100).toFixed(2)}</Text>
              </View>
            )}
            {credit > 0 && (
              <View style={[styles.totalRow, { borderTopWidth: 1.5, borderTopColor: colors.legal, marginTop: 6, paddingTop: 8 }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.totalLabel, { color: colors.legalDark }]}>You pay</Text>
                <Text maxFontSizeMultiplier={1.4} style={[styles.totalAmount, { color: colors.legalDark }]}>${Math.max(0, (2000 - credit) / 100).toFixed(2)}</Text>
              </View>
            )}
            <Text maxFontSizeMultiplier={1.4} style={styles.accountNote}>* Free account required -- takes 10 seconds</Text>
            <View style={{ display: 'none' }}>
            </View>
          </View>

          {/* What happens after */}
          <View style={styles.stepsCard}>
            <Text maxFontSizeMultiplier={1.4} style={styles.stepsTitle}>How it works</Text>
            {[
              { n: '1', text: 'Tap Pay Now -- one-time $19.99 charge' },
              { n: '2', text: 'We find the nearest bondsman and lawyer to you' },
              { n: '3', text: 'Their phone numbers appear immediately' },
              { n: '4', text: 'Call them directly -- they are real and available' },
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
              <Text maxFontSizeMultiplier={1.4} style={styles.locText}>Getting your location…</Text>
            </View>
          ) : locError ? (
            <View style={[styles.locRow, styles.locError]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.locErrorText}>
                ⚠ Location unavailable -- we'll find results for your state
              </Text>
            </View>
          ) : (
            <View style={[styles.locRow, styles.locReady]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.locReadyText}>📍 Location ready -- results near you</Text>
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
                <Text maxFontSizeMultiplier={1.4} style={styles.payNowBtnText}>Processing…</Text>
              </>
            ) : (
              <>
                <Text maxFontSizeMultiplier={1.4} style={styles.payNowBtnText}>{credit > 0 ? `Pay Now -- $${Math.max(0,(2000-credit)/100).toFixed(2)}` : `${t('qc_pay_btn')} -- $19.99`}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.payNowBtnSub}>1 bondsman + 1 lawyer · One-time · No subscription</Text>
              </>
            )}
          </TouchableOpacity>

          {showDemoHelp && (
            <View style={styles.demoHelpCard}>
              <Text maxFontSizeMultiplier={1.4} style={styles.demoHelpTitle}>💡 How to enable payments</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.demoHelpBody}>
                {'1. Open backend/.env\n2. Add STRIPE_SECRET=sk_test_...\n3. Restart the backend\n4. Get key at stripe.com/dashboard'}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.demoHelpOr}>-- or --</Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.demoHelpBtn}
                onPress={() => navigation.navigate('MoreTab', { screen: 'Bail' })}
          activeOpacity={0.85}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.demoHelpBtnText}>🔓 Find a Bail Agent Free Instead →</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.footerNote}>
            Payments processed securely by Stripe.{'\n'}
            Justice Gavel does not store your card information.
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
        <Text maxFontSizeMultiplier={1.4} style={styles.successIcon}>✅</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>You're connected!</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          {result.mock ? 'Demo mode -- no real charge' : `${result.charged} charged`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.resultsScroll} showsVerticalScrollIndicator={false}>

        <Text maxFontSizeMultiplier={1.4} style={styles.callPrompt}>
          Call them now. They are real professionals in your area.
        </Text>

        {/* Bondsman result */}
        {result.bondsman ? (
          <ResultCard contact={result.bondsman} type="bondsman" price="$10" />
        ) : (
          <View style={styles.noResult}>
            <Text maxFontSizeMultiplier={1.4} style={styles.noResultText}>
              No bondsman found in our database for your area yet.{'\n'}
              Try "Bail Agents Near Me" from the home screen.
            </Text>
          </View>
        )}

        {/* Lawyer result */}
        {result.lawyer ? (
          <ResultCard contact={result.lawyer} type="lawyer" price="$10" />
        ) : (
          <View style={styles.noResult}>
            <Text maxFontSizeMultiplier={1.4} style={styles.noResultText}>
              No lawyer found in our database for your area yet.{'\n'}
              Try "Find a Lawyer" from the home screen.
            </Text>
          </View>
        )}

        {/* Receipt */}
        <View style={styles.receiptCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.receiptTitle}>Receipt</Text>
          {(result.breakdown || []).map((b: any) => (
            <View key={b.item} style={styles.receiptRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptItem}>{b.item}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.receiptPrice}>{b.price}</Text>
            </View>
          ))}
          <View style={styles.receiptTotal}>
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptTotalLabel}>Total charged</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptTotalAmount}>{result.charged || '$19.99'}</Text>
          </View>
          {result.mock && (
            <Text maxFontSizeMultiplier={1.4} style={styles.receiptMock}>Demo mode -- no real charge</Text>
          )}
        </View>

        {/* Back to home */}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.homeBtn}
          accessibilityLabel="\u2190 Back to Home" onPress={() => navigation.navigate('HomeTab')}
            activeOpacity={0.85}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.homeBtnText}>← Back to Home</Text>
        </TouchableOpacity>

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
  subheading: { fontSize: 12, lineHeight: 20, ...FONTS.medium, color: COLORS.steel, marginTop: 4, textAlign: 'center' },

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
  creditAmount: { fontSize: 14, lineHeight: 21, color: colors.legal, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
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
  locText:     { fontSize: 12, lineHeight: 20, color: COLORS.textMuted },
  locError:    { backgroundColor: COLORS.warnBg },
  locErrorText:{ fontSize: 12, lineHeight: 20, color: COLORS.warn, ...FONTS.medium },
  locReady:    { backgroundColor: COLORS.legalBg },
  locReadyText:{ fontSize: 12, lineHeight: 20, color: COLORS.legal, ...FONTS.bold },

  errorBox: {
    backgroundColor: COLORS.emergencyBg, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.emergency + '44',
    padding: 12, marginBottom: 12 },
  errorText: { color: COLORS.emergency, fontSize: 12, lineHeight: 20, ...FONTS.medium },

  demoHelpCard: {
    backgroundColor: '#FFA726', borderRadius: 14, padding: 16,
    marginTop: 8, marginBottom: 4, borderWidth: 1, borderColor: '#F9A825' },
  demoHelpTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#FFA726', marginBottom: 8 },
  demoHelpBody:  { fontSize: 12, color: colors.steel, lineHeight: 20, marginBottom: 10 },
  demoHelpCode:  { fontFamily: 'monospace', backgroundColor: COLORS.bg, color: colors.bgCard },
  demoHelpOr:    { textAlign: 'center', color: colors.steel, marginBottom: 8 },
  demoHelpBtn:   { backgroundColor: '#042C53', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
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
  footerNote: { textAlign: 'center', color: COLORS.textSecond, fontSize: 11, lineHeight: 17, marginTop: 4 },

  // Results
  callPrompt: { fontSize: 15, ...FONTS.bold, color: COLORS.textPrimary, textAlign: 'center', marginBottom: 16, lineHeight: 21 },

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
  contactRating: { fontSize: 12, color: COLORS.warn, ...FONTS.bold, marginBottom: 6 },
  tagRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  tag:           { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  tagText:       { fontSize: 11, ...FONTS.medium },
  freeConsultBadge: { backgroundColor: COLORS.legalBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, alignSelf: 'flex-start', marginBottom: 10 },
  freeConsultText:  { color: COLORS.legal, fontSize: 12, ...FONTS.bold },
  callBtn: { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  callBtnText:  { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black, letterSpacing: 1 },
  callBtnPhone: { color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 20, ...FONTS.medium, marginTop: 3 },
  dirBtn:       { backgroundColor: COLORS.bg, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  dirBtnText:   { fontSize: 12, lineHeight: 20, ...FONTS.bold, color: COLORS.textSecond },

  noResult: { backgroundColor: COLORS.warnBg, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: COLORS.warn + '33' },
  noResultText: { fontSize: 12, color: COLORS.warn, ...FONTS.medium, lineHeight: 19 },

  // Receipt
  receiptCard: { backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 14 },
  receiptTitle: { fontSize: 11, ...FONTS.black, color: COLORS.steel, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  receiptRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  receiptItem: { fontSize: 12, lineHeight: 20, color: COLORS.bgCard, ...FONTS.medium },
  receiptPrice:{ fontSize: 12, lineHeight: 20, color: COLORS.steel, ...FONTS.bold },
  receiptTotal:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.steel + '30', paddingTop: 12, marginTop: 4 },
  receiptTotalLabel:  { fontSize: 14, lineHeight: 21, color: COLORS.bgCard, ...FONTS.bold },
  receiptTotalAmount: { fontSize: 22, color: COLORS.bgCard, ...FONTS.black },
  receiptMock: { fontSize: 11, color: COLORS.steel, textAlign: 'center', marginTop: 8 },

  homeBtn: { alignItems: 'center', paddingVertical: 16 },
  homeBtnText: { fontSize: 14, lineHeight: 21, color: COLORS.steel, ...FONTS.bold } });

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
