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
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Alert, Linking, KeyboardAvoidingView, Platform, RefreshControl} from 'react-native';
import { api } from '../services/api';
import { useAuthGate } from '../components/AuthGate';
import { useTheme } from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

function callPhone(phone: string) {
  Linking.openURL('tel:' + phone.replace(/\s/g, '')).catch(() => {}).catch(() => {});
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  const steps = ['Find Arrest', 'Your Info', 'Connect'];
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
function ContactCard({ contact, type }: { contact: Record<string,unknown>; type: 'attorney' | 'bail' }) {
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
            {isAtty ? '⚖️ Attorney' : '🔓 Bail Agent'}
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
          accessibilityLabel="No phone on file"
          style={[styles.callBtn, { backgroundColor: color }]}
          onPress={() => callPhone(contact.phone)}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>📞 Call {contact.name.split(' ')[0]}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.callBtn, { backgroundColor: COLORS.emergencyDark }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.callBtnText}>No phone on file</Text>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function FamilyConnectScreen({ route, navigation }: ScreenProps): JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/family/contacts').then(r => { if (r.data) setContacts(r.data || []); }).catch(()=>{})
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 600);
  }, []);

  const passedArrestId = route?.params?.arrest_id;

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [step, setStep] = useState(1);

  // Step 1: find arrest
  const [searchName, setSearchName] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
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
      Alert.alert('Enter a name', 'Enter the first or last name of the person who was arrested.');
      return;
    }
    setSearching(true);
    try {
      const res = await api.get('/arrests/search', {
        params: { name: searchName.trim(), limit: 10 }
      });
      setSearchResults(res.data?.records || []);
      if ((res.data?.records || []).length === 0) {
        Alert.alert('No records found', 'We don\'t have a record matching that name yet. You can still connect with attorneys and bail agents by continuing without an arrest record.');
      }
    } catch (e) {
      Alert.alert('Search failed', 'Could not search right now. Check your connection and try again.');
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
    if (!familyName.trim()) { Alert.alert('Required', 'Please enter your name.'); return; }
    if (!familyPhone.trim()) { Alert.alert('Required', 'Please enter your phone number.'); return; }
    // Require account before charging -- browsing users get sign-in prompt
    requireAuth(() => handleConnect());
  };

  const handleConnect = async () => {
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
    } catch (e) {
      Alert.alert('Could not connect', 'Something went wrong. Check your connection and try again.');
      setStep(2);
    } finally {
      setPaying(false);
    }
  };

  return (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex:1 }}>
<ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      <EmergencyStrip compact={true} />

      {/* Header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heading}>Emergency Connection</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.subheading}>
          Get verified attorneys and bail agents on the phone -- right now
        </Text>
        <View style={styles.priceBadge}>
          <Text maxFontSizeMultiplier={1.4} style={styles.priceText}>$28.99 one-time</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.priceSubText}>No subscription. Instant results.</Text>
        </View>
      </View>

      <StepBar step={step} />

      {/* ── Step 1: Find Arrest ─────────────────────────────────────────────── */}
      {step === 1 && (
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>Who was arrested?</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionSub}>
            Search our arrest database to pre-fill their information for faster help.
          </Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchName}
              onChangeText={setSearchName}
              placeholder="First or last name"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={searchArrests}
              returnKeyType="search"
            />
            <TouchableOpacity activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Search"
              style={[styles.searchBtn, searching && { opacity: 0.6 }]}
              onPress={searchArrests}
              disabled={searching}
            >
              {searching
                ? <ActivityIndicator color={colors.bgCard} size="small" />
                : <Text maxFontSizeMultiplier={1.4} style={styles.searchBtnText}>Search</Text>
              }
            </TouchableOpacity>
          </View>

          {searchResults.length > 0 && (
            <View style={styles.resultsList}>
              <Text maxFontSizeMultiplier={1.4} style={styles.resultsHeader}>{searchResults.length} record(s) found -- tap to select:</Text>
              {searchResults.map((r: Record<string,unknown>) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  key={r.id}
                  style={styles.arrestResult}
                  onPress={() => selectArrest(r)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultName}>{r.name}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultDetail}>
                      {r.county ? `${r.county} County` : ''}{r.state ? `, ${r.state}` : ''}{r.booking_date ? `  ·  ${new Date(r.booking_date).toLocaleDateString()}` : ''}
                    </Text>
                    {r.charges && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultCharges} numberOfLines={1}>
                        {r.charges}
                      </Text>
                    )}
                    {r.bail_amount > 0 && (
                      <Text maxFontSizeMultiplier={1.4} style={styles.arrestResultBail}>
                        Bail: ${r.bail_amount.toLocaleString()}
                      </Text>
                    )}
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={styles.selectArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.skipBtn} onPress={skipToStep2}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.skipBtnText}>
              {searchResults.length > 0 ? 'Continue without selecting a record →' : 'Skip search and continue →'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Step 2: Family Info ─────────────────────────────────────────────── */}
      {step === 2 && (
        <View style={styles.section}>
          {selectedArrest && (
            <View style={styles.arrestSummary}>
              <Text maxFontSizeMultiplier={1.4} style={styles.arrestSummaryTitle}>For: {selectedArrest.name}</Text>
              {selectedArrest.county && (
                <Text maxFontSizeMultiplier={1.4} style={styles.arrestSummaryDetail}>
                  {selectedArrest.county} County{selectedArrest.state ? `, ${selectedArrest.state}` : ''}
                  {selectedArrest.bail_amount > 0 ? `  ·  Bail: $${selectedArrest.bail_amount.toLocaleString()}` : ''}
                </Text>
              )}
              {selectedArrest.charges && (
                <Text maxFontSizeMultiplier={1.4} style={styles.arrestSummaryCharges} numberOfLines={2}>
                  {selectedArrest.charges}
                </Text>
              )}
            </View>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionTitle}>Your contact information</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.sectionSub}>
            So attorneys and bail agents can call you back immediately.
          </Text>

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Your name *</Text>
          <TextInput
            style={styles.input}
            value={familyName}
            onChangeText={setFamilyName}
            placeholder="Jane Smith"
            placeholderTextColor={colors.textMuted}
          returnKeyType="next"
          blurOnSubmit
        />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Your phone number *</Text>
          <TextInput
            style={styles.input}
            value={familyPhone}
            onChangeText={setFamilyPhone}
            placeholder="(615) 555-0100"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          returnKeyType="next"
          blurOnSubmit
        />

          <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Email (optional)</Text>
          <TextInput
            style={styles.input}
            value={familyEmail}
            onChangeText={setFamilyEmail}
            placeholder="jane@example.com"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          returnKeyType="next"
          blurOnSubmit
        />

          <View style={styles.feeBlock}>
            <Text maxFontSizeMultiplier={1.4} style={styles.feeBlockTitle}>What you get for $28.99</Text>
            {[
              '⚖️ 3 verified criminal defense attorneys in the county',
              '🔓 2 bail bondsmen available right now',
              '📋 Pre-filled case info shared with each contact',
              '📞 Direct call buttons -- reach them instantly',
              '🔒 One-time fee, no subscription',
            ].map(item => (
              <View key={item} style={styles.feeItem}>
                <Text maxFontSizeMultiplier={1.4} style={styles.feeItemText}>{item}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.payBtn}
            onPress={proceedToPayment}
          accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.payBtnText}>Pay $28.99 &amp; Get Connected Now</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.payBtnSub}>Demo mode: no real charge</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backBtn} onPress={() => setStep(1)}
              accessibilityLabel="Go back"
              accessibilityHint="Returns to previous step">
            <Text maxFontSizeMultiplier={1.4} style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Step 3: Results ─────────────────────────────────────────────────── */}
      {step === 3 && (
        <View style={styles.section}>
          {paying ? (
            <View style={styles.payingBlock}>
              <ActivityIndicator size="large" color={colors.navy} />
              <Text maxFontSizeMultiplier={1.4} style={styles.payingText}>Connecting you with verified contacts...</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.payingHint}>This takes just a moment</Text>
            </View>
          ) : result ? (
            <>
              <View style={styles.successBanner}>
                <Text maxFontSizeMultiplier={1.4} style={styles.successIcon}>✅</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.successTitle}>You're connected!</Text>
                <Text maxFontSizeMultiplier={1.4} style={styles.successSub}>
                  Call any of the contacts below right now. They are expecting calls.
                </Text>
              </View>

              {result.arrest && (
                <View style={styles.caseCard}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.caseTitle}>Case Information</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.caseName}>{result.arrest.name}</Text>
                  {result.arrest.charges && (
                    <Text maxFontSizeMultiplier={1.4} style={styles.caseCharges}>{result.arrest.charges}</Text>
                  )}
                  {result.arrest.bail_amount > 0 && (
                    <Text maxFontSizeMultiplier={1.4} style={styles.caseBail}>Bail: ${result.arrest.bail_amount.toLocaleString()}</Text>
                  )}
                  {result.arrest.county && (
                    <Text maxFontSizeMultiplier={1.4} style={styles.caseLocation}>
                      {result.arrest.county} County, {result.arrest.state}
                    </Text>
                  )}
                </View>
              )}

              {result.attorneys?.length > 0 && (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={styles.contactsHeading}>⚖️ Criminal Defense Attorneys</Text>
                  {result.attorneys.map((a: Record<string, unknown>) => (
                    <ContactCard key={a.id} contact={a} type="attorney" />
                  ))}
                </>
              )}

              {result.bail_agents?.length > 0 && (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={styles.contactsHeading}>🔓 Bail Bondsmen</Text>
                  {result.bail_agents.map((a: Record<string, unknown>) => (
                    <ContactCard key={a.id} contact={a} type="bail" />
                  ))}
                </>
              )}

              {(!result.attorneys?.length && !result.bail_agents?.length) && (
                <View style={styles.noContacts}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.noContactsText}>
                    No contacts found in our database for this county yet.
                    Try calling your county's public defender office directly.
                  </Text>
                </View>
              )}
              <View style={styles.receiptBlock}>
                <Text maxFontSizeMultiplier={1.4} style={styles.receiptTitle}>Payment Receipt</Text>
                <View style={styles.receiptRow}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptLabel}>Emergency Connection</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptAmount}>$28.99.00</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptLabel}>Connection ID</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptValue}>#{result.connection_id}</Text>
                </View>
                {result.mock && (
                  <Text maxFontSizeMultiplier={1.4} style={styles.receiptMock}>Demo mode -- no real charge</Text>
                )}
              </View>
            </>
          ) : (
            <View style={styles.errorBlock}>
              <Text maxFontSizeMultiplier={1.4} style={styles.errorText}>Something went wrong. Please go back and try again.</Text>
              <TouchableOpacity style={styles.backBtn} onPress={() => setStep(2)}
                accessibilityRole="button"
                >
                <Text maxFontSizeMultiplier={1.4} style={styles.backBtnText}>← Go back</Text>
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

  header: { backgroundColor: '#EF5350', padding: 20, paddingTop: 30, paddingBottom: 24 },
  heading: { fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard },
  subheading: { color: '#EF5350', fontSize: 12, marginTop: 3, lineHeight: 18 },
  priceBadge: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: 10, marginTop: 12, alignSelf: 'flex-start' },
  priceText: { color: COLORS.bgCard, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 18 },
  priceSubText: { color: '#EF5350', fontSize: 11, marginTop: 1 },

  stepBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgCard, paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: COLORS.bgSubtle },
  stepItem: { alignItems: 'center' },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  stepDotActive: { backgroundColor: '#EF5350' },
  stepDotDone: { backgroundColor: colors.legal },
  stepDotText: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.steel },
  stepDotTextActive: { color: COLORS.bgCard },
  stepLabel: { fontSize: 11, color: colors.steel, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  stepLabelActive: { color: '#EF5350' },
  stepLine: { flex: 1, height: 2, backgroundColor: COLORS.bgSubtle, marginHorizontal: 4, marginBottom: 14 },
  stepLineDone: { backgroundColor: colors.legal },

  section: { padding: 16 },
  sectionTitle: { fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#042C53', marginBottom: 4 },
  sectionSub: { fontSize: 12, color: colors.steel, marginBottom: 16, lineHeight: 18 },

  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, backgroundColor: COLORS.bgCard, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, color: colors.bgCard },
  searchBtn: { backgroundColor: '#EF5350', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', minWidth: 70 },
  searchBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  resultsList: { marginTop: 4 },
  resultsHeader: { fontSize: 12, fontWeight: '700', color: colors.steel, marginBottom: 8 },
  arrestResult: { backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', elevation: 1, borderWidth: 1.5, borderColor: COLORS.bgSubtle },
  arrestResultName: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 2 },
  arrestResultDetail: { fontSize: 12, color: colors.steel, marginBottom: 2 },
  arrestResultCharges: { fontSize: 12, color: colors.steel, marginBottom: 2 },
  arrestResultBail: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: '#EF5350' },
  selectArrow: { fontSize: 22, color: '#042C53', fontWeight: '300', marginLeft: 8 },

  skipBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  skipBtnText: { fontSize: 12, lineHeight: 20, color: colors.blue, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  arrestSummary: { backgroundColor: COLORS.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#85B7EB' },
  arrestSummaryTitle: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 4 },
  arrestSummaryDetail: { fontSize: 12, lineHeight: 20, color: colors.blue, marginBottom: 4 },
  arrestSummaryCharges: { fontSize: 12, color: colors.blue, lineHeight: 16 },

  fieldLabel: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.bgCard, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: COLORS.bgCard, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 22, color: colors.bgCard },

  feeBlock: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginTop: 20, marginBottom: 8, borderWidth: 1.5, borderColor: COLORS.bgSubtle },
  feeBlockTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 10 },
  feeItem: { marginBottom: 6 },
  feeItemText: { fontSize: 12, color: colors.steel, lineHeight: 18 },

  payBtn: { backgroundColor: '#EF5350', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  payBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  payBtnSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 3 },

  backBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  backBtnText: { fontSize: 12, lineHeight: 20, color: colors.blue, fontWeight: '600' },

  payingBlock: { alignItems: 'center', paddingVertical: 40 },
  payingText: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_700Bold', fontWeight: '700', color: '#042C53', marginTop: 16 },
  payingHint: { fontSize: 12, color: colors.steel, marginTop: 6 },

  successBanner: { backgroundColor: colors.legal, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 16 },
  successIcon: { fontSize: 36, marginBottom: 8 },
  successTitle: { fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', color: COLORS.bgCard, marginBottom: 4 },
  successSub: { fontSize: 12, color: colors.legal, textAlign: 'center', lineHeight: 18 },

  caseCard: { backgroundColor: COLORS.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#85B7EB' },
  caseTitle: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.blue, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  caseName: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 4 },
  caseCharges: { fontSize: 12, color: colors.blue, marginBottom: 4, lineHeight: 17 },
  caseBail: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#EF5350', marginBottom: 2 },
  caseLocation: { fontSize: 12, color: colors.blue },

  contactsHeading: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.bgCard, marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactCard: { backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 10, elevation: 2, shadowColor: COLORS.bg, shadowOpacity: 0.06, shadowRadius: 4 },
  contactHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  contactName: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 2 },
  contactAddress: { fontSize: 12, color: colors.steel },
  contactTypeBadge: { paddingHorizontal: 8, paddingVertical: 10, borderRadius: 8, marginLeft: 8 },
  contactTypeBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  contactRating: { fontSize: 12, color: '#FFA726', fontWeight: '700', marginBottom: 8 },
  callBtn: { borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  callBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },

  noContacts: { backgroundColor: '#FFA726', borderRadius: 12, padding: 16, marginVertical: 8 },
  noContactsText: { fontSize: 14, color: colors.steel, lineHeight: 20 },

  receiptBlock: { backgroundColor: COLORS.bg, borderRadius: 12, padding: 16, marginTop: 16 },
  receiptTitle: { fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.steel, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  receiptLabel: { fontSize: 12, lineHeight: 20, color: colors.steel },
  receiptAmount: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53' },
  receiptValue: { fontSize: 12, lineHeight: 20, color: colors.steel },
  receiptMock: { fontSize: 11, color: colors.steel, marginTop: 6, textAlign: 'center' },

  errorBlock: { alignItems: 'center', padding: 40 },
  errorText: { fontSize: 14, color: colors.steel, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
});
