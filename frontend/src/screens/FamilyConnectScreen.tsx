import { SampleRecordBadge } from '../components/SampleRecordBadge';
import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
/**
 * FamilyConnectScreen -- $28.99 one-tap emergency connection
 *
 * For family members of someone who was just arrested.
 * Three steps: find arrest → pay $28.99 → get 3 attorneys + 2 bail agents immediately.
 * Pre-fills with arrest data from the scraper if arrest_id is passed via navigation.
 */

import EmergencyStrip from '../components/EmergencyStrip';
import React, { useRef, useState, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import { t, useLang } from '../i18n';

// Plain helper (no hooks); failures are reported through onError.
function callPhone(phone: string, onError?: () => void) {
  Linking.openURL('tel:' + phone.replace(/\D/g, '')).catch(() => onError?.());
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  useLang();
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
  const { showToast } = useToast();
  const isAtty = type === 'attorney';
  const color = isAtty ? COLORS.navy : COLORS.bail;
  const bg = isAtty ? COLORS.bgSubtle : COLORS.emergencyBg;

  let specialties: string[] = [];
  if (contact.specialties) {
    try { specialties = JSON.parse(contact.specialties); } catch { specialties = []; }
  }

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
          <Text maxFontSizeMultiplier={1.4} style={[styles.contactTypeBadgeText, { color }]}>
            {isAtty ? t('x_family_connect_attorney') : t('x_family_connect_bail_agent')}
          </Text>
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

      {contact.rating && (
        <Text maxFontSizeMultiplier={1.4} style={styles.contactRating}>★ {contact.rating?.toFixed(1)}</Text>
      )}

      {contact.phone ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('help_now_no_phone')}
          style={[styles.callBtn, { backgroundColor: color }]}
          onPress={() => callPhone(contact.phone, () => showToast(t('x_emergency_share_please_dial_manually', { phone: contact.phone }), 'warning'))}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>{t('x_family_connect_call', { value: contact.name.split(' ')[0] })}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.callBtn, { backgroundColor: COLORS.emergencyDark }]}>
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

  const handleConnect = async () => {
    if (paying) return; // double-tap guard
    setPaying(true);
    setStep(3);
    try {
      const res = await api.post('/billing/family/connect', {
        arrest_id: selectedArrest?.id || null,
        family_name: familyName.trim(),
        family_phone: familyPhone.trim(),
        family_email: familyEmail.trim() || null,
      });
      setResult(res.data || null);
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_family_connect_something_went_wrong_check')));
      setStep(2);
    } finally {
      setPaying(false);
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
          {t('x_family_connect_get_verified_attorneys_bail')}
        </Text>
        <View style={styles.priceBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.priceText}>{t('x_family_connect_28_99_one_time')}</Text>
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
                      {r.county ? t('x_bondsman_dashboard_county', { county: r.county }) : ''}{r.state ? `, ${r.state}` : ''}{r.booking_date ? `  ·  ${new Date(r.booking_date).toLocaleDateString()}` : ''}
                    </Text>
                    {r.charges && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultCharges} numberOfLines={1}>
                        {r.charges}
                      </Text>
                    )}
                    {((r as import('../types/api').BailAgent).bail_amount ?? 0) > 0 && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultBail}>
                        {t('x_family_connect_bail', { value: ((r as import('../types/api').BailAgent).bail_amount ?? 0).toLocaleString() })}
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
                  {t('x_family_connect_county', { county: selectedArrest.county, value: selectedArrest.state ? `, ${selectedArrest.state}` : '', value2: selectedArrest.bail_amount > 0 ? '  ' + t('x_family_connect_bail_2', { value: selectedArrest.bail_amount.toLocaleString() }) : '' })}
                </Text>
              )}
              {selectedArrest.charges && (
                <Text maxFontSizeMultiplier={1.4} style={styles.arrestSummaryCharges} numberOfLines={2}>
                  {selectedArrest.charges}
                </Text>
              )}
            </View>
          )}
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
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBlockTitle}>{t('x_family_connect_what_get_28_99')}</Text>
            {[
              t('x_family_connect_3_verified_criminal_defense'),
              t('x_family_connect_2_bail_bondsmen_available'),
              t('x_family_connect_pre_filled_case_info'),
              t('x_family_connect_direct_call_buttons_reach'),
              t('x_family_connect_one_time_fee_no'),
            ].map(item => (
              <View key={item} style={styles.feeItem}>
                <Text maxFontSizeMultiplier={1.4} style={styles.feeItemText}>{item}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            style={styles.payBtn}
            onPress={proceedToPayment}
           accessibilityLabel={t('x_family_connect_pay_28_99_amp')}>
            <Text maxFontSizeMultiplier={1.4} style={styles.payBtnText}>{t('x_family_connect_pay_28_99_amp')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.payBtnSub}>{t('x_family_connect_demo_mode_no_real')}</Text>
          </TouchableOpacity>

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
              <ActivityIndicator size="large" color={colors.navy} />
              <Text maxFontSizeMultiplier={1.4} style={styles.payingText}>{t('x_family_connect_connecting_with_verified_contacts')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.payingHint}>{t('x_family_connect_this_takes_just_moment')}</Text>
            </View>
          ) : result ? (
            <>
              <View style={styles.successBanner}>
                <AppIcon name="checkmark-circle" size={20} color={colors.legal} />
                <Text maxFontSizeMultiplier={1.4} style={styles.successTitle}>{t('x_family_connect_re_connected')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.successSub}>
                  {t('x_family_connect_call_any_contacts_below')}
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
                    <Text maxFontSizeMultiplier={1.4} style={styles.caseBail}>{t('x_family_connect_bail', { value: result.arrest.bail_amount.toLocaleString() })}</Text>
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
                  <Text maxFontSizeMultiplier={1.4} style={styles.contactsHeading}>{t('x_family_connect_criminal_defense_attorneys')}</Text>
                  {result.attorneys.map((a: any) => (
                    <ContactCard key={a.id} contact={a} type="attorney" />
                  ))}
                </>
              )}

              {result.bail_agents?.length > 0 && (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={styles.contactsHeading}>{t('x_family_connect_bail_bondsmen')}</Text>
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
              <View style={styles.receiptBlock}>
                <Text maxFontSizeMultiplier={1.4} style={styles.receiptTitle}>{t('x_family_connect_payment_receipt')}</Text>
                <View style={styles.receiptRow}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptLabel}>{t('x_family_connect_emergency_connection')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptAmount}>$28.99.00</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptLabel}>{t('x_family_connect_connection_id')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptValue}>#{result.connection_id}</Text>
                </View>
                {result.mock && (
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptMock}>{t('x_family_connect_demo_mode_no_real_2')}</Text>
                )}
              </View>
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

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingBottom: 40 },

  header: { backgroundColor: colors.emergencyBg, padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textPrimary },
  subheading: { color: colors.emergency, fontSize: 12, marginTop: 3, lineHeight: 18 },
  priceBadge: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: 10, marginTop: 12, alignSelf: 'flex-start' },
  priceText: { color: colors.textPrimary, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 18 },
  priceSubText: { color: colors.textSecond, fontSize: 11, marginTop: 1 },

  stepBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgCard, paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: COLORS.bgSubtle },
  stepItem: { alignItems: 'center' },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  stepDotActive: { backgroundColor: colors.emergency },
  stepDotDone: { backgroundColor: colors.legal },
  stepDotText: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.info },
  stepDotTextActive: { color: colors.bgCard },
  stepLabel: { fontSize: 11, color: COLORS.info, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  stepLabelActive: { color: COLORS.emergency },
  stepLine: { flex: 1, height: 2, backgroundColor: COLORS.bgSubtle, marginHorizontal: 4, marginBottom: 14 },
  stepLineDone: { backgroundColor: colors.legal },

  section: { padding: 16 },
  sectionTitle: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.textBrand, marginBottom: 4 },
  sectionSub: { fontSize: 12, color: colors.info, marginBottom: 16, lineHeight: 18 },

  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, backgroundColor: COLORS.bgCard, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, color: colors.bgCard },
  searchBtn: { backgroundColor: colors.emergency, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', minWidth: 70 },
  searchBtnText: { color: colors.textOnAccent, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  resultsList: { marginTop: 4 },
  resultsHeader: { fontSize: 12, fontWeight: '700', color: colors.info, marginBottom: 8 },
  arrestResult: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', elevation: 1, borderWidth: 1.5, borderColor: COLORS.bgSubtle },
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
  arrestSummary: { backgroundColor: COLORS.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: COLORS.steel },
  arrestSummaryTitle: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.navy, marginBottom: 4 },
  arrestSummaryDetail: { fontSize: 12, lineHeight: 20, color: colors.blue, marginBottom: 4 },
  arrestSummaryCharges: { fontSize: 12, color: colors.blue, lineHeight: 16 },

  fieldLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.textPrimary, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: COLORS.bgCard, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, color: colors.bgCard },

  feeBlock: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginTop: 20, marginBottom: 8, borderWidth: 1.5, borderColor: COLORS.bgSubtle },
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

  caseCard: { backgroundColor: COLORS.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: COLORS.steel },
  caseTitle: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.blue, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  caseName: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.navy, marginBottom: 4 },
  caseCharges: { fontSize: 12, color: colors.blue, marginBottom: 4, lineHeight: 17 },
  caseBail: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.emergency, marginBottom: 2 },
  caseLocation: { fontSize: 12, color: colors.blue },

  contactsHeading: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textPrimary, marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactCard: { backgroundColor: colors.bgCard, borderRadius: 12, padding: 16, marginBottom: 10, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 4 },
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
  callBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  noContacts: { backgroundColor: colors.infoBg, borderRadius: 12, padding: 16, marginVertical: 8 },
  noContactsText: { fontSize: 14, color: colors.info, lineHeight: 20 },

  receiptBlock: { backgroundColor: colors.bg, borderRadius: 12, padding: 16, marginTop: 16 },
  receiptTitle: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.info, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  receiptLabel: { fontSize: 12, lineHeight: 20, color: colors.info },
  receiptAmount: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand },
  receiptValue: { fontSize: 12, lineHeight: 20, color: colors.info },
  receiptMock: { fontSize: 11, color: colors.info, marginTop: 6, textAlign: 'center' },

  errorBlock: { alignItems: 'center', padding: 40 },
  errorText: { fontSize: 14, color: colors.info, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
export default React.memo(FamilyConnectScreen);
