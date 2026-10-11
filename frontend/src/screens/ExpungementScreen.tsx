import { AIDisclaimer } from '../components/AIDisclaimer';
import { parseLocalDate } from '../utils/dateUtils';
import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
import UPLDisclaimer from '../components/UPLDisclaimer';
/**
 * ExpungementScreen -- Expungement eligibility + marketplace
 *
 * Entry points:
 *   1. Push notification after case marked Closed/Dismissed → deep link with case_id
 *   2. HomeScreen tile "Clear Record"
 *   3. CaseScreen "Check Eligibility" button on closed cases
 *
 * Flow: state picker → charge summary → eligibility result → partner CTA
 */
import React, { useState, useEffect } from 'react';
import { useLatestRef } from '../hooks/useLatestRef';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, LayoutAnimation, InteractionManager } from 'react-native';
import { api, cachedGet, apiErrorMessage } from '../services/api';
import { cacheExpungement } from '../services/offlineCache';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { RNShare } from '../utils/webCompat';
import { getUserState } from '../utils/userState';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const CHARGE_EXAMPLES = [
  'DUI / Drunk Driving', 'Drug Possession', 'Theft / Shoplifting',
  'Assault / Battery', 'Disorderly Conduct', 'Trespassing',
  'Domestic Violence', 'Probation Violation', 'Other / Not sure',
];

type EligibilityResult = {
  state: string; stateName: string; chargeType: string; status: string;
  eligibility: { likely: boolean; conditional: boolean; notEligible: boolean; waitYears: number; note: string };
  partners: { key: string; name: string; description: string; estimatedCost: string; cta: string; url: string }[];
  disclaimer: string;
};


// ── Expungement eligibility countdown ────────────────────────────────────────
function ExpungementCountdown({ waitYears, caseDate }: {
  waitYears: number; caseDate: string;
}) {
  const { showToast } = useToast();

  const eligible = React.useMemo(() => {
    // Date-only strings are local calendar dates (avoid the UTC shift of new Date('YYYY-MM-DD'))
    const d = parseLocalDate(caseDate) ?? new Date(NaN);
    d.setFullYear(d.getFullYear() + waitYears);
    return d;
  }, [caseDate, waitYears]);

  const now = React.useMemo(() => new Date(), []);
  const isEligible = eligible <= now;
  const daysLeft = Math.max(0, Math.ceil((eligible.getTime() - now.getTime()) / 86400000));
  const yearsLeft = (daysLeft / 365).toFixed(1);

  const scheduleReminder = React.useCallback(async () => {
    try {
      const { api } = await import('../services/api');
      const remind = new Date(eligible);
      remind.setDate(remind.getDate() - 30);  // 30 days before eligible
      if (remind <= now) {
        // Less than 30 days away -- remind in 3 days instead
        remind.setTime(Date.now() + 3 * 86400000);
      }
      await api.post('/push/reminders', {
        title: '📋 You may now be eligible for expungement',
        body: 'Based on your waiting period, check your eligibility now.',
        scheduled_for: remind.toISOString(),
        notification_type: 'expungement_eligible',
      });
showToast('Reminder set for when you become eligible.', 'success');
    } catch {
      showToast('Make sure notifications are enabled in Settings.');
    }
  }, [eligible, now, showToast]);

  return (
    <View testID="expungement-screen" style={{ backgroundColor: isEligible ? COLORS.legalBg : COLORS.bgSubtle,
      borderRadius: 12, padding: 14, marginTop: 10,
      borderWidth: 1, borderColor: isEligible ? COLORS.legalDark : COLORS.border }}>
      {isEligible ? (
        <>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22,
            fontWeight: '700', color: COLORS.legalDark, marginBottom: 4 }}>
            ✅ You may now be eligible
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 19,
            color: COLORS.legalDark }}>
            Based on your case date, your {waitYears}-year waiting period has passed.
            Consult an attorney to confirm and begin the petition process.
          </Text>
        </>
      ) : (
        <>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 15, lineHeight: 22,
            fontWeight: '700', color: COLORS.navy, marginBottom: 4 }}>
            ⏳ Eligible in approximately {yearsLeft} years
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 19,
            color: COLORS.textSecond, marginBottom: 10 }}>
            Estimated eligibility date:{' '}
            <Text maxFontSizeMultiplier={1.4} style={{ fontWeight: '700' }}>
              {eligible.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          </Text>
          <TouchableOpacity accessibilityRole="button"
            onPress={scheduleReminder}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: COLORS.navy, borderRadius: 8,
              paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start' }}
            accessibilityLabel="Set a reminder for your eligibility date"
          
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <AppIcon name="notifications-outline" size={20} color={COLORS.navy} />
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 19,
              fontWeight: '700', color: COLORS.bgCard }}>
              Remind me
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function ExpungementScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.  // Log expungement screen visit — prevents re-trigger from nightly scheduler
  useEffect(() => {
    api.post('/expungement/log-visit').catch(() => {}); // non-fatal
  }, []);

  useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
    });
    return () => _task.cancel();
  }, []);


  // Generate expungement petition draft
  const generatePetition = async () => {
    setGenPetition(true);
    try {
      const res = await api.post('/expungement/petition', {
        state: state,
        charge_type: charges,
        county: '',
        full_name: '',
        case_number: incomingCaseId ? `Case #${incomingCaseId}` : '',
      });
      if (!mountedRef.current) return;
      setPetitionDraft(res.data?.draft || '');
      setShowPetition(true);
    } catch {
      showToast('Check your connection and try again.');
    } finally {
      setGenPetition(false);
    }
  };
  // Route params — forward-declared here so effects below can reference them
  // (assigned at the route destructure block below, before useState)
  var incomingState: string = (route?.params as import('../types/api').RouteParams)?.incomingState || '';
  var incomingCharges: string | null = (route?.params as import('../types/api').RouteParams)?.incomingCharges || null;


  // Load user's saved state as default if not passed via route params
  React.useEffect(() => {
    if (!incomingState) {
      getUserState().then(s => {
        if (s?.code) setState(s.code);
      }).catch(() => {});
    }
  }, [incomingState]);


  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const incomingCaseId = (route?.params as import('../types/api').RouteParams)?.case_id;

  const [step, setStep]         = useState<'form'|'result'>('form');
  const [state, setState]       = useState(incomingState);
  const [stateError, setStateError]   = useState('');
  const [charges, setCharges]   = useState(incomingCharges || '');
  const [caseStatus, setCaseStatus] = useState('Closed');

  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<EligibilityResult | null>(null);
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [attorneys,       setAttorneys]       = useState<any[]>([]);
  const [attLoading,      setAttLoading]      = useState(false);
  const [petitionDraft, setPetitionDraft]   = useState('');
  const [genPetition, setGenPetition]       = useState(false);
  const [showPetition, setShowPetition]     = useState(false);

  const checkEligibility = async () => {
    if (!state) { setStateError('Please select your state first.'); setLoading(false); return; }
    setStateError('');
    setLoading(true);
    try {
      const res = await (cachedGet as any)('/expungement/check', {
        params: { state, charges, status: caseStatus },
      });
      if (!mountedRef.current) return;
      setResult(res.data || null);
      cacheExpungement(state, res.data);
      // Fetch matched expungement attorneys for this state
      if (res.data?.eligibility && !res.data?.eligibility.notEligible) {
        setAttLoading(true);
        // Params go in the URL: cachedGet's cache is keyed by URL (a bare path
        // would serve one state's attorneys to every state), and its second
        // argument is the cache TTL, not an axios config.
        cachedGet<{ attorneys?: any[] }>(`/expungement/attorneys?state=${encodeURIComponent(state)}&limit=5`)
          .then((r) => setAttorneys(r.data?.attorneys || []))
          .catch((e: any) => { __DEV__ && console.warn(e?.message); })
          .finally(() => setAttLoading(false));
      }
      setStep('result');
    } catch (e: any) {
      showToast(apiErrorMessage(e, 'Could not check eligibility. Try again.'), 'info');
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when navigated from CaseScreen with charges + state, so the
  // user sees results without re-entering data. Fires on the incoming params
  // only (not on step / handler changes); checkEligibility and step are read
  // through refs.
  const checkEligibilityRef = useLatestRef(() => checkEligibility());
  const stepRef = useLatestRef(step);
  React.useEffect(() => {
    if (incomingCharges && incomingState && stepRef.current === 'form') {
      // Give state one tick to update before submitting
      const t = setTimeout(() => {
        checkEligibilityRef.current();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [incomingState, incomingCharges, checkEligibilityRef, stepRef]);

  const eligColor = result
    ? result?.eligibility?.likely       ? COLORS.legal
    : result?.eligibility?.conditional  ? COLORS.warn
    : COLORS.emergency
    : COLORS.textMuted;

  const eligBg = result
    ? result?.eligibility?.likely       ? COLORS.legalBg
    : result?.eligibility?.conditional  ? COLORS.warnBg
    : COLORS.emergencyBg
    : COLORS.bg;

  const eligIcon = result
    ? result?.eligibility?.likely       ? '✅'
    : result?.eligibility?.conditional  ? '⚠️'
    : '❌'
    : '';

  const eligLabel = result
    ? result?.eligibility?.likely       ? 'Likely Eligible'
    : result?.eligibility?.conditional  ? 'Possibly Eligible'
    : 'Not Eligible'
    : '';

  // ── Form step ────────────────────────────────────────────────────────────
  if (step === 'form') return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
      <UPLDisclaimer compact />

      <View style={styles.hero}>

              <AppIcon name="document-text-outline" size={20} color={COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={styles.heroTitle}>Could your record be cleared?</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroSub}>
          Millions of Americans are eligible to seal or expunge their arrest records --
          but most never apply. Find out in 30 seconds.
        </Text>
      </View>

{/* ── Juvenile Record Notice ───────────────────────────────────────────
           Juvenile records have entirely different expungement rules and are
           handled by separate courts in every state. Route users early. */}
      <View style={{
        backgroundColor: colors.warnBg, borderRadius: 12, padding: 16, margin: 16,
        borderLeftWidth: 3, borderLeftColor: colors.warnDark,
      }}>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, fontWeight: '700', color: colors.bail, marginBottom: 4 }}>
          Under 18 or have a juvenile record?
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.warnDark, lineHeight: 20 }}>
          Juvenile records are sealed or expunged under different laws and through
          separate courts from adult records. The eligibility rules, waiting periods,
          and forms below apply to adult criminal records only.{' '}
          For juvenile records, contact your{' '}
          <Text maxFontSizeMultiplier={1.4}
            style={{ color: colors.textBrand, textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL('https://www.juvenilelaw.org/find-help').catch(() => {})}
          >
            state's juvenile public defender or juvenile court clerk
          </Text>
          {' '}directly.
        </Text>
      </View>

      {/* State */}
      <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Your state</Text>
      <TouchableOpacity
          accessibilityRole="button"
          style={styles.stateBtn}
          testID="expungement-state-picker"
          accessibilityLabel={stateError} onPress={() => setShowStatePicker(p => !p)}
        >
      {!!stateError && <Text testID="expungement-state-error" style={{ color: colors.emergency, fontSize: 12, marginTop: 4, marginLeft: 4 }}>{stateError}</Text>}
        <Text maxFontSizeMultiplier={1.4} style={styles.stateBtnText}>{state}  ▾</Text>
      </TouchableOpacity>
      {showStatePicker && (
        <ScrollView style={styles.stateDropdown} nestedScrollEnabled>
          {US_STATES.map(st => (
            <TouchableOpacity
              accessibilityRole="button"
              key={st}
              style={[styles.stateRow, state === st && styles.stateRowActive]}
              onPress={() => { setState(st); setShowStatePicker(false); }}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.stateRowText, state === st && { color: colors.textBrand, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }]}>{st}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Case status */}
      <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Case outcome</Text>
      <View style={styles.statusRow}>
        {['Closed', 'Dismissed', 'Still Open'].map(s => (
          <TouchableOpacity accessibilityRole="button"
            key={s}
            style={[styles.statusChip, caseStatus === s && styles.statusChipActive]}
            accessibilityLabel={s} onPress={() => setCaseStatus(s)}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.statusChipText, caseStatus === s && styles.statusChipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Charges */}
      <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>What were the charges?</Text>
      <View style={styles.chargeChips}>
        {CHARGE_EXAMPLES.map(ch => (
          <TouchableOpacity accessibilityRole="button"
            key={ch}
            style={[styles.chargeChip, charges === ch && styles.chargeChipActive]}
            accessibilityLabel={ch} onPress={() => setCharges(charges === ch ? '' : ch)}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.chargeChipText, charges === ch && styles.chargeChipTextActive]}>{ch}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
              testID="expungement-charges-input" accessibilityLabel="Describe your charges"
        style={styles.chargeInput}
        placeholder="Or type your charge (e.g. 'possession of marijuana 2020')"
        placeholderTextColor={COLORS.textSecond}
        value={charges.includes('/') || CHARGE_EXAMPLES.includes(charges) ? '' : charges}
        onChangeText={setCharges}
          returnKeyType="next"
          blurOnSubmit
        />

      <TouchableOpacity
  accessibilityRole="button"
        style={[styles.checkBtn, loading && { opacity: 0.6 }]}
        testID="expungement-check-button" onPress={checkEligibility}
        disabled={loading}
        activeOpacity={0.85} accessibilityLabel={"Check My Eligibility  \u2192"}>

        {loading
          ? <ActivityIndicator color={colors.bgCard} />
          : <Text maxFontSizeMultiplier={1.4} style={styles.checkBtnText}>Check My Eligibility  →</Text>
        }
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.4} style={styles.disclaimerNote}>Free eligibility check · No account required · Not legal advice</Text>
      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Result step ───────────────────────────────────────────────────────────
  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.scroll}>

      {/* Eligibility verdict */}
      <View testID="expungement-result-screen" style={[styles.verdictCard, { backgroundColor: eligBg, borderColor: eligColor }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.verdictEmoji}>{eligIcon}</Text>
        <Text testID="expungement-eligible-banner" maxFontSizeMultiplier={1.4} style={[styles.verdictLabel, { color: eligColor }]}>{eligLabel}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.verdictState}>{result?.stateName} · {result?.chargeType}</Text>
        {(result?.eligibility?.waitYears ?? 0) > 0 && (
          <Text testID="expungement-wait-years" maxFontSizeMultiplier={1.4} style={[styles.verdictWait, { color: eligColor }]}>
            Typical waiting period: {(result as any).eligibility?.waitYears} year{(result as any).eligibility?.waitYears > 1 ? 's' : ''}
          </Text>
        )}
        {/* Eligibility date calculator */}
            {(result as any).eligibility?.waitYears > 0 && (result as any).caseCreatedAt && (
              <ExpungementCountdown
                waitYears={(result as any).eligibility?.waitYears}
                caseDate={(result as any).caseCreatedAt}
              />
            )}

        <Text maxFontSizeMultiplier={1.4} style={styles.verdictNote}>{result?.eligibility.note}</Text>
      </View>

      {/* What expungement means */}
      <View style={styles.explainCard}>
        <Text maxFontSizeMultiplier={1.4} style={styles.explainTitle}>What does expungement do?</Text>
        {[
          '🔒 Seals the arrest from most public background checks',
          '💼 Employers, landlords, and lenders cannot see it',
          '✓  You can legally say "I was not arrested" on most applications',
          '⚖️ The court record still exists for law enforcement',
        ].map(item => (
          <Text maxFontSizeMultiplier={1.4} key={item} style={styles.explainItem}>{item}</Text>
        ))}
      </View>

      {/* Attorney marketplace */}
      {result && !result?.eligibility?.notEligible && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={styles.partnersTitle}>
            Expungement attorneys in {result.stateName || state}
          </Text>
            {/* Generate expungement petition */}
            {result && !result?.eligibility?.notEligible && (
              <TouchableOpacity accessibilityRole="button"
                style={{ marginTop: 12, backgroundColor: colors.legal, borderRadius: 12,
                  paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row',
                  alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onPress={generatePetition}
                disabled={genPetition}
                accessibilityLabel="Generate expungement petition draft"
          accessibilityHint="Double-tap to activate"
              
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <AppIcon name="document-text-outline" size={20} color={COLORS.navy} />
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.bgCard, fontWeight: '700',
                  fontSize: 14, lineHeight: 21 }}>
                  {genPetition ? 'Generating…' : 'Generate Petition Draft'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Petition modal */}
            <Modal accessibilityViewIsModal={true} visible={showPetition} animationType="slide"
              onRequestClose={() => setShowPetition(false)}>
              <View style={{ flex: 1, backgroundColor: colors.bg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16,
                  borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <TouchableOpacity
  accessibilityRole="button"
                    accessibilityLabel="Close petition draft"
                    onPress={() => setShowPetition(false)}
                    >
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16,
                      color: colors.textBrand }}>← Close</Text>
                  </TouchableOpacity>
                  <Text maxFontSizeMultiplier={1.4} style={{ flex: 1, fontSize: 16,
                    fontWeight: '700', color: colors.textPrimary }}>
                    Petition Draft
                  </Text>
                  <TouchableOpacity accessibilityRole="button"
                    onPress={async () => {
                      try {
                        await RNShare.share({ message: petitionDraft, title: 'Expungement Petition Draft' })
                      } catch {
                        // Share API unavailable on this browser/device — fail silently

                    }}}
 accessibilityLabel="Share petition draft"
                  >
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14,
                      color: colors.textBrand, fontWeight: '600' }}>Share</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ flex: 1, padding: 16 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 20,
                    color: colors.textPrimary, fontFamily: 'Courier New' }}>
                    {petitionDraft}
                  </Text>
                </ScrollView>
              </View>
            </Modal>

          {attLoading && (
            <View style={[styles.partnerCard, { alignItems: 'center', padding: 20 }]}>
              <ActivityIndicator color={colors.steelMid} />
              <Text testID="expungement-attorneys-section" maxFontSizeMultiplier={1.4} style={[styles.partnerDesc, { marginTop: 8 }]}>Finding attorneys near you…</Text>
            </View>
          )}

          {!attLoading && attorneys.length > 0 && attorneys.map((atty, idx) => (
            <View key={atty.id || idx} style={styles.partnerCard}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.partnerName}>{atty.name}</Text>
                  {atty.address && <Text maxFontSizeMultiplier={1.4} style={[styles.partnerDesc, { marginBottom: 0 }]}>{atty.city || atty.address}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  {atty.jtb_verified  && <View style={{ backgroundColor:colors.legalBg, borderRadius:20, paddingHorizontal:8, paddingVertical:2 }}><Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color:colors.legal, fontWeight:'800' }}>✅ JTB Verified</Text></View>}
                  {!atty.jtb_verified && atty.bar_verified && <View style={{ backgroundColor:colors.bgElevated, borderRadius:20, paddingHorizontal:8, paddingVertical:2 }}><Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color:colors.info, fontWeight:'800' }}>✓ Bar Verified</Text></View>}
                  {atty.gavel_level >= 3 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, fontWeight:'800', color:colors.textPrimary }}>🏆</Text>}
                  {atty.rating != null && <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, color:colors.textPrimary, fontWeight:'700' }}>★ {isNaN(Number(atty.rating)) ? "N/A" : Number(atty.rating).toFixed(1)}</Text>}
                </View>
              </View>
              {atty.free_consultation && (
                <View style={{ backgroundColor:colors.legalBg, borderRadius:8, padding:6, marginBottom:6 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, color:colors.legal, fontWeight:'700' }}>✓ Free initial consultation</Text>
                </View>
              )}
              <View style={{ flexDirection:'row', gap:8, marginTop:4 }}>
                {atty.phone && (
                  <TouchableOpacity accessibilityRole="button"
                    style={[styles.partnerBtn, { flex:1, backgroundColor:colors.legalDark }]}
                    onPress={() => { Linking.openURL('tel:'+atty.phone).catch(() => showToast('Action unavailable.', 'error')); }}
                    accessibilityLabel={`Call ${atty.name}`}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.partnerBtnText}>📞 Call</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity accessibilityRole="button"
                  style={[styles.partnerBtn, { flex:2 }]}
                  onPress={() => navigation.navigate('MoreTab', { screen: 'Booking', params: { lawyerName: atty.name, lawyerPhone: atty.phone || '', lawyerId: atty.id }})}
                  accessibilityLabel={`Book consultation with ${atty.name}`}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.partnerBtnText}>Book Free Consultation →</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {!attLoading && attorneys.length === 0 && (
            <View>
              <Text maxFontSizeMultiplier={1.4} style={styles.partnersTitle}>Partner services</Text>
              {result?.partners?.map(partner => (
                <View key={partner.key} style={styles.partnerCard}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.partnerName}>{partner.name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.partnerDesc} numberOfLines={3} ellipsizeMode="tail">{partner.description}</Text>
                  <View style={styles.partnerFeeRow}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.partnerFeeLabel}>Estimated cost</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.partnerFeeValue}>{partner.estimatedCost}</Text>
                  </View>
                  <TouchableOpacity
  accessibilityRole="button"
                    style={[styles.partnerBtn, false && { opacity: 0.6 }]}
                    onPress={() => Linking.openURL(partner.url)}
                    disabled={false}
                    activeOpacity={0.85}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.partnerBtnText}>{partner.cta}  →</Text>
                  </TouchableOpacity>
              <Text maxFontSizeMultiplier={1.4} style={styles.partnerReturnNote}>
                Opens in browser · Tap Back to return to Justice Gavel
              </Text>
                </View>
          ))}
            </View>
        )}
        </>
      )}

      {/* Not eligible */}
      {result?.eligibility.notEligible && (
        <View testID="expungement-not-eligible-banner" style={styles.notEligibleCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.notEligibleTitle}>What you can still do</Text>
          {[
            '⚖️  Speak to a defense attorney -- some exceptions exist',
            '📋  Apply for a Certificate of Relief (limits background check impact)',
            "🏛️  Apply for a Governor's pardon in some states",
            '⏳  Check back when the waiting period is complete',
          ].map(s => <Text maxFontSizeMultiplier={1.4} key={s} style={styles.notEligibleItem}>{s}</Text>)}
          <TouchableOpacity accessibilityRole="button"
            style={styles.partnerBtn}
            accessibilityLabel={"Find a Criminal Defense Lawyer \u2192"} onPress={() => navigation.navigate('LawyersTab')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.partnerBtnText}>Find a Criminal Defense Lawyer →</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={styles.disclaimerNote}>{result?.disclaimer}</Text>


      <View style={{ height: 40 }} />
      <AIDisclaimer variant="banner" />

    </ScrollView>
  );
}

const makeStyles = (colors: any = COLORS) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16 },

  hero: {
    backgroundColor: colors.navy, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 20, alignItems: 'center', ...SHADOW.md,
  },
  heroEmoji: { fontSize: 40, marginBottom: 8 },
  heroTitle: { fontSize: 20, ...FONTS.black, color: colors.textOnNavy, textAlign: 'center', marginBottom: 8 },
  heroSub:   { fontSize: 12, color: colors.steel, textAlign: 'center', lineHeight: 18 },

  fieldLabel: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: colors.textBrand, marginBottom: 8, marginTop: 16 },

  stateBtn: {
    backgroundColor: colors.bgCard, borderWidth: 1.5, borderColor: colors.navy,
    borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 11, alignSelf: 'flex-start',
  },
  stateBtnText: { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: colors.textBrand },
  stateDropdown: {
    backgroundColor: colors.bgCard, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: colors.border, maxHeight: 200, marginBottom: 4, ...SHADOW.md,
  },
  stateRow:       { paddingVertical: 10, paddingHorizontal: 16 },
  stateRowActive: { backgroundColor: colors.bg },
  stateRowText:   { fontSize: 14, lineHeight: 21, color: colors.textPrimary },

  statusRow:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  statusChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: RADIUS.pill,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  statusChipActive:     { borderColor: colors.navy, backgroundColor: colors.navy },
  statusChipText:       { fontSize: 12, lineHeight: 20, color: colors.textSecond, ...FONTS.semi },
  statusChipTextActive: { color: colors.textOnNavy },

  chargeChips:        { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  chargeChip:         { paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bgCard },
  chargeChipActive:   { borderColor: colors.navy, backgroundColor: colors.bgSubtle },
  chargeChipText:     { fontSize: 12, color: colors.textSecond, ...FONTS.semi },
  chargeChipTextActive: { color: colors.textBrand, ...FONTS.heavy },
  chargeInput: {
    backgroundColor: colors.bgCard, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 11,
    fontSize: 12, lineHeight: 20, color: colors.textPrimary, marginBottom: 16,
  },

  checkBtn:     { backgroundColor: colors.navy, borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.md },
  checkBtnText: { color: colors.textOnNavy, fontSize: 16, lineHeight: 24, ...FONTS.black },
  disclaimerNote: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  // Result
  verdictCard: {
    borderRadius: RADIUS.xl, borderWidth: 2, padding: 20, alignItems: 'center',
    marginBottom: 16, ...SHADOW.sm,
  },
  verdictEmoji: { fontSize: 48, marginBottom: 6 },
  verdictLabel: { fontSize: 22, ...FONTS.black, marginBottom: 4 },
  verdictState: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  verdictWait:  { fontSize: 12, lineHeight: 20, ...FONTS.semi, marginBottom: 6 },
  verdictNote:  { fontSize: 12, color: colors.textSecond, textAlign: 'center', lineHeight: 18 },

  explainCard: {
    backgroundColor: colors.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: colors.border, ...SHADOW.sm,
  },
  explainTitle: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: colors.textBrand, marginBottom: 10 },
  explainItem:  { fontSize: 12, color: colors.textSecond, lineHeight: 22 },

  partnersTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: colors.textBrand, marginBottom: 10 },
  partnerCard: {
    backgroundColor: colors.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.border, ...SHADOW.sm,
  },
  partnerName:     { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: colors.textBrand, marginBottom: 4 },
  partnerDesc:     { fontSize: 12, color: colors.textSecond, lineHeight: 18, marginBottom: 10 },
  partnerFeeRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  partnerFeeLabel: { fontSize: 12, color: colors.textMuted },
  partnerFeeValue: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: colors.legal },
  partnerBtn:      { backgroundColor: colors.navy, borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center' },
  partnerBtnText:  { color: colors.textOnNavy, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },

  notEligibleCard: {
    backgroundColor: colors.emergencyBg, borderRadius: RADIUS.lg, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: colors.emergency,
  },
  notEligibleTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: colors.emergency, marginBottom: 10 },
  notEligibleItem:  { fontSize: 12, color: colors.textSecond, lineHeight: 22, marginBottom: 2 },

  partnerReturnNote: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  startOverBtn:  { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  startOverText: { fontSize: 12, lineHeight: 20, color: colors.steel, ...FONTS.semi },
});

export default React.memo(ExpungementScreen);