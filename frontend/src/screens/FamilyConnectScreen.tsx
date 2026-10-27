import { SampleRecordBadge } from '../components/SampleRecordBadge';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
/**
 * FamilyConnectScreen — emergency connection for the family of someone just arrested.
 *
 * Three steps: find the arrest record (optional) → your contact details → pay
 * the one-time price → the phone numbers of 3 criminal-defense lawyers and 2
 * bail agents near the arrest (or near you). Same payment flow as Quick
 * Connect: POST /billing/family/connect creates the payment → Stripe payment
 * sheet → POST /billing/family/confirm checks it on the server and only then
 * returns the contacts. A payment that went through while the contacts could
 * not be loaded is retried, never charged again. Without payments (no Stripe
 * key, or on the web) the button explains that payments are not available.
 * The price comes from the server (GET /billing/family/quote).
 */

import EmergencyStrip from '../components/EmergencyStrip';
import { FollowBookingCard } from '../components/FollowBookingCard';
import AmeelioCard from '../components/AmeelioCard';
import React, { useRef, useState, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { api, apiErrorMessage, isPaymentsUnavailable } from '../services/api';
import { usePaymentSheet, PAYMENTS_COMING_SOON } from '../payments';
import { getLocation } from '../services/location';
import { getUserState } from '../utils/userState';
import { formatPhone } from '../utils/contact';
import { useTheme, COLORS, type ThemeColors } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import { t, useLang, locale } from '../i18n';

const usd = (cents: number) => (cents / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' });
const FALLBACK_PRICE_CENTS = 0;   // free since Oct 26 2026 (server: billing/connections.js)

// Plain helper (no hooks); failures are reported through onError.
function callPhone(phone: string, onError?: () => void) {
  Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => onError?.());
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const steps = [t('x_family_connect_step_find'), t('x_family_connect_step_info'), t('x_family_connect_step_connect')];
  return (
    <View style={styles.stepBar}>
      {steps.map((label, i) => {
        const num = i + 1;
        const done = step > num;
        const active = step === num;
        return (
          <React.Fragment key={label}>
            {i > 0 && <View style={[styles.stepLine, done && styles.stepLineDone]} />}
            <View style={styles.stepItem}>
              <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.stepDotText, (active || done) && styles.stepDotTextActive]}>
                  {done ? '✓' : num}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ── Contact card ─────────────────────────────────────────────────────────────
function ContactCard({ contact, type }: { contact: Record<string,any>; type: 'attorney' | 'bail' }) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const isAtty = type === 'attorney';
  const color = isAtty ? COLORS.navy : colors.bail;
  const bg = isAtty ? colors.bgSubtle : colors.emergencyBg;

  const specialties: string[] = Array.isArray(contact.specialties) ? contact.specialties : [];

  return (
    <View style={[styles.contactCard, { borderLeftColor: color, borderLeftWidth: 4 }]}>
      <View style={styles.contactHeader}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.contactName, { color }]}>{contact.name}</Text>
          {contact.address && (
            <Text maxFontSizeMultiplier={1.4} style={styles.contactAddress} numberOfLines={1}>{contact.address}</Text>
          )}
        </View>
        <View style={[styles.contactTypeBadge, { backgroundColor: bg }]}>
          <IconLabel icon={isAtty ? ICONS.lawyer : ICONS.bail} textStyle={[styles.contactTypeBadgeText, { color }]} maxFontSizeMultiplier={1.4}>{isAtty ? t('x_family_connect_attorney') : t('x_family_connect_bail_agent')}</IconLabel>
        </View>
      </View>

      {specialties.length > 0 && (
        <View style={styles.tagRow}>
          {specialties.slice(0, 3).map(s => (
            <View key={s} style={[styles.tag, { backgroundColor: bg }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.tagText, { color }]}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {Number(contact.rating) > 0 && (
        <IconLabel icon={ICONS.starFilled} textStyle={styles.contactRating} maxFontSizeMultiplier={1.4}>{Number(contact.rating).toFixed(1)}</IconLabel>
      )}

      {contact.phone ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('x_family_connect_call', { value: contact.name })}
          style={[styles.callBtn, { backgroundColor: color }]}
          onPress={() => callPhone(contact.phone, () => showToast(t('x_emergency_share_please_dial_manually', { phone: contact.phone }), 'warning'))}
        >
          <IconLabel icon={ICONS.phone} textStyle={styles.callBtnText} maxFontSizeMultiplier={1.4}>{t('x_family_connect_call', { value: formatPhone(contact.phone) })}</IconLabel>
        </TouchableOpacity>
      ) : (
        <View style={[styles.callBtn, { backgroundColor: colors.emergencyDark }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>{t('help_now_no_phone')}</Text>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
function FamilyConnectScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const passedArrestId = (route?.params as import('../types/api').RouteParams)?.arrest_id;

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [step, setStep] = useState(1);

  // Step 1: find arrest
  const [searchName, setSearchName] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);   // a search has completed (drives the empty state)
  // Server-reported arrest coverage: false = no public arrest feed is
  // configured, so the empty state must not imply live coverage.
  const [feedsConfigured, setFeedsConfigured] = useState(true);
  const [selectedArrest, setSelectedArrest] = useState<any>(null);

  // Step 2: family info
  const [familyName, setFamilyName] = useState('');
  const [familyPhone, setFamilyPhone] = useState('');
  const [familyEmail, setFamilyEmail] = useState('');

  // Step 3: result
  const [paying, setPaying] = useState(false);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const [result, setResult] = useState<any>(null);
  const [priceCents, setPriceCents] = useState(FALLBACK_PRICE_CENTS);
  const free = priceCents <= 0;
  const [payError, setPayError] = useState('');
  // A payment that went through whose contacts could not be loaded yet — retried, never re-charged.
  const [paidPi, setPaidPi] = useState<string | null>(null);
  const { available: sheetAvailable, initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  useEffect(() => {
    api.get<{ price_cents: number }>('/billing/family/quote')
      .then(r => { if (mountedRef.current && Number.isFinite(r.data?.price_cents)) setPriceCents(r.data.price_cents); })
      .catch(() => { /* offline: the list price stays */ });
  }, []);

  // Load arrest if passed via navigation
  useEffect(() => {
    if (passedArrestId) {
      api.get(`/arrests/${passedArrestId}`).then(res => {
        setSelectedArrest(res.data || null);
      }).catch((e) => { __DEV__ && console.warn(e?.message); });
    }
  }, [passedArrestId]);

  const searchArrests = async () => {
    if (!searchName.trim()) {
      showToast(t('x_family_connect_enter_first_last_name'));
      return;
    }
    setSearching(true);
    try {
          const res = await api.get('/arrests/search', {
        params: { name: searchName.trim(), limit: 10 }
      });
      const records: any[] = Array.isArray(res.data?.records) ? res.data?.records : [];
      setSearchResults(records);
      setFeedsConfigured(res.data?.feeds_configured !== false);
      setSearched(true);
    } catch {
      setSearchResults([]);
      showToast(t('x_family_connect_could_not_search_right'));
    } finally {
      setSearching(false);
    }
  };

  const selectArrest = (arrest: Record<string,unknown>) => {
    setSelectedArrest(arrest);
    setStep(2);
  };

  const skipToStep2 = () => {
    setSelectedArrest(null);
    setStep(2);
  };

  const proceedToPayment = () => {
    if (!familyName.trim()) { showToast(t('x_family_connect_please_enter_name')); return; }
    if (!familyPhone.trim()) { showToast(t('x_family_connect_please_enter_phone_number')); return; }
    // Require account before charging -- browsing users get sign-in prompt
    requireAuth(() => handleConnect());
  };

  const fail = (m: string) => {
    if (!mountedRef.current) return;
    setPayError(m); showToast(m, 'error'); setPaying(false); setStep(2);
  };
  /** Contacts for a payment that succeeded; null (with a retry message) when they could not be loaded. */
  const confirmPaid = async (piId: string) => {
    try {
      const r = await api.post('/billing/family/confirm', { payment_intent_id: piId });
      if (mountedRef.current) setPaidPi(null);
      return r.data;
    } catch {
      fail(t('qc_paid_retry'));
      return null;
    }
  };
  const retryConfirm = async () => {
    if (!paidPi) return;
    setPaying(true); setPayError(''); setStep(3);
    const done = await confirmPaid(paidPi);
    if (done && mountedRef.current) { setResult(done); setPaying(false); }
  };

  const handleConnect = async () => {
    if (paying) return; // double-tap guard
    setPaying(true); setPayError(''); setStep(3);
    try {
      const [loc, st] = await Promise.all([getLocation().catch(() => null), getUserState().catch(() => null)]);
      const res = await api.post('/billing/family/connect', {
        arrest_id: selectedArrest?.id || undefined,
        family_name: familyName.trim(), family_phone: familyPhone.trim(), family_email: familyEmail.trim() || undefined,
        lat: loc?.lat, lng: loc?.lng, state: selectedArrest?.state || st?.code || undefined,
      });
      // Free (price 0): the server returns the contacts at once — no card, no payment sheet.
      if (res.data?.requires_payment === false) {
        if (!mountedRef.current) return;
        setResult(res.data);
        setPaying(false);
        return;
      }
      const pi = res.data?.payment_intent_id;
      // The card is collected by Stripe's payment sheet; nothing is revealed until it succeeds.
      if (!sheetAvailable || !res.data?.client_secret || !pi) return fail(PAYMENTS_COMING_SOON());
      const init = await initPaymentSheet({ paymentIntentClientSecret: res.data.client_secret, merchantDisplayName: 'Justice Gavel' });
      if (init.error) return fail(init.error.message || t('x_booking_payment_setup_failed_please'));
      const paid = await presentPaymentSheet();
      if (paid.error) {
        if (paid.error.code === 'Canceled') { if (mountedRef.current) { setPaying(false); setStep(2); } return; }
        return fail(paid.error.message || t('x_quick_connect_card_was_declined_please'));
      }
      if (mountedRef.current) setPaidPi(pi);
      const done = await confirmPaid(pi);
      if (!done || !mountedRef.current) return;
      setResult(done);
      setPaying(false);
    } catch (e: any) {
      const status = e?.response?.status;
      if (isPaymentsUnavailable(e) || status === 503) return fail(t('x_common_payments_aren_t_available'));
      if (status === 402) return fail(t('x_quick_connect_card_was_declined_please'));
      if (!e?.response) return fail(t('x_ch_no_connection_check_internet'));
      fail(apiErrorMessage(e, t('x_family_connect_something_went_wrong_check')));
    }
  };

  return (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex:1 }}>
<ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
  testID="family-connect-screen">
      <EmergencyStrip compact={true} />

      {/* Header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>{t('x_family_connect_emergency_connection')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          {t('fc2_sub')}
        </Text>
        <View style={styles.priceBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.priceText} testID="family-connect-price">{free ? t('fc2_price_free') : t('fc2_price', { price: usd(priceCents) })}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.priceSubText}>{t('x_family_connect_no_subscription_instant_results')}</Text>
        </View>
      </View>

      <StepBar step={step} />

      {/* ── Step 1: Find Arrest ─────────────────────────────────────────────── */}
      {step === 1 && (
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>{t('x_family_connect_who_was_arrested')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionSub}>
            {t('x_family_connect_search_our_arrest_database')}
          </Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchName}
              onChangeText={setSearchName}
              placeholder={t('x_family_connect_first_last_name')}
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={searchArrests}
              returnKeyType="search"
            maxLength={200}
            />
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.6}
              accessibilityLabel={t('search')}
              style={[styles.searchBtn, searching && { opacity: 0.6 }]}
              onPress={searchArrests}
              disabled={searching}
            >
              {searching
                ? <ActivityIndicator color={colors.bgCard} size="small" />
                : <Text maxFontSizeMultiplier={1.4} style={styles.searchBtnText}>{t('search')}</Text>
              }
            </TouchableOpacity>
          </View>

          {searchResults.length > 0 && (
            <View style={styles.resultsList}>
              <Text maxFontSizeMultiplier={1.4} style={styles.resultsHeader}>{t('x_family_connect_record_s_found_tap', { length: searchResults.length })}</Text>
              {searchResults.map((r: any) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  key={r.id}
                  style={styles.arrestResult}
                  onPress={() => selectArrest(r)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <SampleRecordBadge row={r} />
                    <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultName}>{r.name}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultDetail}>
                      {r.county ? t('x_bondsman_dashboard_county', { county: r.county }) : ''}{r.state ? `, ${r.state}` : ''}{r.booking_date ? `  ·  ${new Date(r.booking_date).toLocaleDateString(locale())}` : ''}
                    </Text>
                    {r.charges && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultCharges} numberOfLines={1}>
                        {r.charges}
                      </Text>
                    )}
                    {((r as import('../types/api').BailAgent).bail_amount ?? 0) > 0 && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultBail}>
                        {t('x_family_connect_bail', { value: ((r as import('../types/api').BailAgent).bail_amount ?? 0).toLocaleString(locale()) })}
                      </Text>
                    )}
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={styles.selectArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {searched && !searching && searchResults.length === 0 && (
            <View testID="arrest-search-empty" style={styles.emptyResults}>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyResultsTitle}>
                {feedsConfigured ? t('x_family_connect_no_matching_record_found') : t('x_family_connect_no_public_arrest_feeds')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.emptyResultsText}>
                {feedsConfigured
                  ? t('x_family_connect_that_s_okay_can')
                  : t('x_family_connect_our_arrest_record_search')}
              </Text>
            </View>
          )}
          <TouchableOpacity accessibilityRole="button" style={styles.skipBtn} onPress={skipToStep2}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.skipBtnText}>
              {searchResults.length > 0 ? t('x_family_connect_continue_without_selecting_record') : t('x_family_connect_skip_search_continue')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Step 2: Family Info ─────────────────────────────────────────────── */}
      {step === 2 && (
        <View style={styles.section}>
          {selectedArrest && (
            <View style={styles.arrestSummary}>
              <SampleRecordBadge row={selectedArrest} />
              <Text maxFontSizeMultiplier={1.4} style={styles.arrestSummaryTitle}>{t('x_family_connect_text', { name: selectedArrest.name })}</Text>
              {selectedArrest.county && (
                <Text maxFontSizeMultiplier={1.4} style={styles.arrestSummaryDetail}>
                  {t('x_family_connect_county', { county: selectedArrest.county, value: selectedArrest.state ? `, ${selectedArrest.state}` : '', value2: selectedArrest.bail_amount > 0 ? '  ' + t('x_family_connect_bail_2', { value: selectedArrest.bail_amount.toLocaleString(locale()) }) : '' })}
                </Text>
              )}
              {selectedArrest.charges && (
                <Text maxFontSizeMultiplier={1.4} style={styles.arrestSummaryCharges} numberOfLines={2}>
                  {selectedArrest.charges}
                </Text>
              )}
            </View>
          )}
          {/* Release / transfer alerts for this booking (⚖ server setting; hidden when off or signed out) */}
          {selectedArrest && !selectedArrest.is_sample && <FollowBookingCard arrestId={Number(selectedArrest.id)} />}
          {/* B10: writing, photos and video calls are free through Ameelio where the facility works with it */}
          <AmeelioCard testID="family-ameelio" />
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>{t('x_family_connect_contact_information')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionSub}>
            {t('x_family_connect_so_attorneys_bail_agents')}
          </Text>

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_family_connect_name')}</Text>
          <TextInput
            style={styles.input}
            value={familyName}
            onChangeText={setFamilyName}
            placeholder={t('x_family_connect_jane_smith')}
            placeholderTextColor={colors.textMuted}
          returnKeyType="next"
          blurOnSubmit
        />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_family_connect_phone_number')}</Text>
          <TextInput
            style={styles.input}
            value={familyPhone}
            onChangeText={setFamilyPhone}
            placeholder={t('x_auth_gate_phone_number')}
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          returnKeyType="next"
          blurOnSubmit
        maxLength={20}
        />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>{t('x_family_connect_email_optional')}</Text>
          <TextInput
          accessibilityLabel={t('x_family_connect_email_address')}
            style={styles.input}
            value={familyEmail}
            onChangeText={setFamilyEmail}
            placeholder={t('x_family_connect_email_address')}
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          returnKeyType="next"
          blurOnSubmit
        maxLength={254}
        />

          <View style={styles.feeBlock}>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBlockTitle}>{free ? t('fc2_what_you_get_free') : t('fc2_what_you_get', { price: usd(priceCents) })}</Text>
            {([
              [ICONS.lawyer, t('fc2_get_lawyers')],
              [ICONS.bail, t('fc2_get_agents')],
              [ICONS.phone, t('x_family_connect_direct_call_buttons_reach')],
              ...(free ? [] : [[ICONS.lock, t('x_family_connect_one_time_fee_no')] as const]),
              [ICONS.alertNormal, t('fc2_listing_note')],
            ] as const).map(([icon, item]) => (
              <View key={item} style={styles.feeItem}>
                <IconLabel icon={icon} maxFontSizeMultiplier={1.4} textStyle={styles.feeItemText}>{item}</IconLabel>
              </View>
            ))}
          </View>

          {!!payError && <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={styles.payError} maxFontSizeMultiplier={1.4} testID="family-connect-error">{payError}</IconLabel>}
          {paidPi ? (
            <TouchableOpacity accessibilityRole="button" testID="family-connect-retry" style={styles.payBtn} onPress={retryConfirm}>
              <Text maxFontSizeMultiplier={1.4} style={styles.payBtnText}>{t('fc2_load_contacts')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity accessibilityRole="button" testID="family-connect-pay" style={styles.payBtn} onPress={proceedToPayment}
              accessibilityLabel={free ? t('fc2_show_free') : t('fc2_pay', { price: usd(priceCents) })}>
              <Text maxFontSizeMultiplier={1.4} style={styles.payBtnText}>{free ? t('fc2_show_free') : t('fc2_pay', { price: usd(priceCents) })}</Text>
              {!free && <Text maxFontSizeMultiplier={1.4} style={styles.payBtnSub}>{t('x_quick_connect_payments_processed_securely_by')}</Text>}
            </TouchableOpacity>
          )}

          <TouchableOpacity accessibilityRole="button" style={styles.backBtn} onPress={() => setStep(1)}
              accessibilityLabel={t('x_gradient_header_go_back')}
              accessibilityHint={t('x_family_connect_returns_previous_step')}>
            <Text maxFontSizeMultiplier={1.4} style={styles.backBtnText}>{t('ja_back')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Step 3: Results ─────────────────────────────────────────────────── */}
      {step === 3 && (
        <View style={styles.section}>
          {paying ? (
            <View style={styles.payingBlock}>
              <ActivityIndicator size="large" color={colors.textBrand} />
              <Text maxFontSizeMultiplier={1.4} style={styles.payingText}>{t('fc2_paying')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.payingHint}>{t('x_family_connect_this_takes_just_moment')}</Text>
            </View>
          ) : result ? (
            <>
              <View style={styles.successBanner}>
                <AppIcon name="checkmark-circle" size={20} color={colors.legal} />
                <Text maxFontSizeMultiplier={1.4} style={styles.successTitle}>{t('x_family_connect_re_connected')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.successSub}>
                  {t('fc2_call_below')}
                </Text>
              </View>

              {result.arrest && (
                <View style={styles.caseCard}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.caseTitle}>{t('x_family_connect_case_information')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.caseName}>{result.arrest.name}</Text>
                  {result.arrest.charges && (
                    <Text maxFontSizeMultiplier={1.4} style={styles.caseCharges}>{result.arrest.charges}</Text>
                  )}
                  {result.arrest.bail_amount > 0 && (
                    <Text maxFontSizeMultiplier={1.4} style={styles.caseBail}>{t('x_family_connect_bail', { value: result.arrest.bail_amount.toLocaleString(locale()) })}</Text>
                  )}
                  {result.arrest.county && (
                    <Text maxFontSizeMultiplier={1.4} style={styles.caseLocation}>
                      {t('x_family_connect_county_2', { county: result.arrest.county, state: result.arrest.state })}
                    </Text>
                  )}
                </View>
              )}

              {result.attorneys?.length > 0 && (
                <>
                  <IconLabel icon={ICONS.lawyer} textStyle={styles.contactsHeading} maxFontSizeMultiplier={1.4}>{t('x_family_connect_criminal_defense_attorneys')}</IconLabel>
                  {result.attorneys.map((a: any) => (
                    <ContactCard key={a.id} contact={a} type="attorney" />
                  ))}
                </>
              )}

              {result.bail_agents?.length > 0 && (
                <>
                  <IconLabel icon={ICONS.bail} textStyle={styles.contactsHeading} maxFontSizeMultiplier={1.4}>{t('x_family_connect_bail_bondsmen')}</IconLabel>
                  {result.bail_agents.map((a: any) => (
                    <ContactCard key={a.id} contact={a} type="bail" />
                  ))}
                </>
              )}

              {(!result.attorneys?.length && !result.bail_agents?.length) && (
                <View style={styles.noContacts}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.noContactsText}>
                    {t('x_family_connect_no_contacts_found_our')}
                  </Text>
                </View>
              )}
              {Number(result.charged_cents) > 0 && <View style={styles.receiptBlock}>
                <Text maxFontSizeMultiplier={1.4} style={styles.receiptTitle}>{t('x_family_connect_payment_receipt')}</Text>
                <View style={styles.receiptRow}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptLabel}>{t('x_family_connect_emergency_connection')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptAmount}>{usd(Number(result.charged_cents))}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptLabel}>{t('x_family_connect_connection_id')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptValue}>#{result.connection_id}</Text>
                </View>
              </View>}
            </>
          ) : (
            <View style={styles.errorBlock}>
              <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>{t('x_family_connect_something_went_wrong_please')}</Text>
              <TouchableOpacity
          accessibilityRole="button" style={styles.backBtn} accessibilityLabel={t('x_age_gate_go_back')} onPress={() => setStep(2)}
                >
                <Text maxFontSizeMultiplier={1.4} style={styles.backBtnText}>{t('x_age_gate_go_back')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
      <View style={{ height: 40 }} />
      <AuthGateModal />
    </ScrollView>
      </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingBottom: 40 },

  header: { backgroundColor: colors.emergencyBg, padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textPrimary },
  subheading: { color: colors.emergency, fontSize: 12, marginTop: 3, lineHeight: 18 },
  priceBadge: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: 10, marginTop: 12, alignSelf: 'flex-start' },
  priceText: { color: colors.textPrimary, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 18 },
  priceSubText: { color: colors.textSecond, fontSize: 11, marginTop: 1 },

  stepBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.bgSubtle },
  stepItem: { alignItems: 'center' },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  stepDotActive: { backgroundColor: colors.emergency },
  stepDotDone: { backgroundColor: colors.legal },
  stepDotText: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info },
  stepDotTextActive: { color: colors.bgCard },
  stepLabel: { fontSize: 11, color: colors.info, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  stepLabelActive: { color: colors.emergency },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.bgSubtle, marginHorizontal: 4, marginBottom: 14 },
  stepLineDone: { backgroundColor: colors.legal },

  section: { padding: 16 },
  sectionTitle: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textBrand, marginBottom: 4 },
  sectionSub: { fontSize: 12, color: colors.info, marginBottom: 16, lineHeight: 18 },

  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, minWidth: 0, backgroundColor: colors.bgCard, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  searchBtn: { backgroundColor: colors.emergency, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', minWidth: 70 },
  searchBtnText: { color: colors.textOnAccent, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  resultsList: { marginTop: 4 },
  resultsHeader: { fontSize: 12, fontWeight: '700', color: colors.info, marginBottom: 8 },
  arrestResult: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', elevation: 1, borderWidth: 1.5, borderColor: colors.bgSubtle },
  arrestResultName: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 2 },
  arrestResultDetail: { fontSize: 12, color: colors.info, marginBottom: 2 },
  arrestResultCharges: { fontSize: 12, color: colors.info, marginBottom: 2 },
  arrestResultBail: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textSecond },
  selectArrow: { fontSize: 22, color: colors.textBrand, fontWeight: '300', marginLeft: 8 },

  skipBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  skipBtnText: { fontSize: 12, lineHeight: 20, color: colors.textBrand, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  emptyResults: { backgroundColor: colors.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 8 },
  emptyResultsTitle: { fontSize: 14, fontWeight: '700', color: colors.textBrand, marginBottom: 4 },
  emptyResultsText: { fontSize: 12, lineHeight: 18, color: colors.info },
  arrestSummary: { backgroundColor: colors.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.steel },
  arrestSummaryTitle: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 4 },
  arrestSummaryDetail: { fontSize: 12, lineHeight: 20, color: colors.info, marginBottom: 4 },
  arrestSummaryCharges: { fontSize: 12, color: colors.info, lineHeight: 16 },

  fieldLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textPrimary, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: colors.bgCard, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, color: colors.textPrimary },

  feeBlock: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginTop: 20, marginBottom: 8, borderWidth: 1.5, borderColor: colors.bgSubtle },
  feeBlockTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 10 },
  feeItem: { marginBottom: 6 },
  feeItemText: { fontSize: 12, color: colors.info, lineHeight: 18 },

  payBtn: { backgroundColor: colors.emergency, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  payBtnText: { color: colors.textOnAccent, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  payBtnSub: { color: colors.textOnAccent, fontSize: 11, marginTop: 3 },

  backBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  backBtnText: { fontSize: 12, lineHeight: 20, color: colors.textBrand, fontWeight: '600' },

  payingBlock: { alignItems: 'center', paddingVertical: 40 },
  payingText: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textBrand, marginTop: 16 },
  payingHint: { fontSize: 12, color: colors.info, marginTop: 6 },

  successBanner: { backgroundColor: colors.legalBg, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 16 },
  successIcon: { fontSize: 36, marginBottom: 8 },
  successTitle: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textPrimary, marginBottom: 4 },
  successSub: { fontSize: 12, color: colors.legal, textAlign: 'center', lineHeight: 18 },

  caseCard: { backgroundColor: colors.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.steel },
  caseTitle: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  caseName: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 4 },
  caseCharges: { fontSize: 12, color: colors.info, marginBottom: 4, lineHeight: 17 },
  caseBail: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.emergency, marginBottom: 2 },
  caseLocation: { fontSize: 12, color: colors.info },

  contactsHeading: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textPrimary, marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactCard: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 10, elevation: 2, shadowColor: colors.bg, shadowOpacity: 0.06, shadowRadius: 4 },
  contactHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  contactName: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 2 },
  contactAddress: { fontSize: 12, color: colors.info },
  contactTypeBadge: { paddingHorizontal: 8, paddingVertical: 10, borderRadius: 8, marginLeft: 8 },
  contactTypeBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  contactRating: { fontSize: 12, color: colors.info, fontWeight: '700', marginBottom: 8 },
  callBtn: { borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  callBtnText: { color: colors.white, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  noContacts: { backgroundColor: colors.infoBg, borderRadius: 12, padding: 16, marginVertical: 8 },
  noContactsText: { fontSize: 14, color: colors.info, lineHeight: 20 },

  receiptBlock: { backgroundColor: colors.bg, borderRadius: 12, padding: 16, marginTop: 16 },
  receiptTitle: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  receiptLabel: { fontSize: 12, lineHeight: 20, color: colors.info },
  receiptAmount: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand },
  receiptValue: { fontSize: 12, lineHeight: 20, color: colors.info },
  payError: { color: colors.textPrimary, backgroundColor: colors.emergencyBg, borderRadius: 10, padding: 10, fontSize: 14, marginTop: 12 },

  errorBlock: { alignItems: 'center', padding: 40 },
  errorText: { fontSize: 14, color: colors.info, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
});
export default React.memo(FamilyConnectScreen);
