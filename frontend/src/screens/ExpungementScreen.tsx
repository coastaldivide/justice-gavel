import LegalNotice from '../components/LegalNotice';
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
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, cachedGet } from '../services/api';
import { cacheExpungement } from '../services/offlineCache';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { getUserState } from '../utils/userState';

declare var onRefresh: any;
declare var refreshing: any;
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

// ── Static 50-state expungement reference cards ───────────────────────────────
// Pulled from backend STATE_RULES -- kept in sync manually or via API
const STATE_CARDS: Record<string, {
  name: string;
  misdemeanor: string; felony: string; dui: string; dismissed: string;
  statute: string; highlight: string;
}> = {
  AL:{ name:'Alabama',       misdemeanor:'5 yr wait, first-time only',    felony:'Class C non-violent, 5 yr', dui:'Not eligible',       dismissed:'Immediately',        statute:'Ala. Code § 15-27-2',         highlight:'First-offense misdemeanors only. DUI and domestic violence excluded.' },
  AK:{ name:'Alaska',        misdemeanor:'Petition, age 18+ offense-free', felony:'Limited, petition required', dui:'Case-by-case',     dismissed:'Immediately',        statute:'AS § 12.62.180',              highlight:'One of the stricter states. Violent offenses and sex crimes excluded.' },
  AZ:{ name:'Arizona',       misdemeanor:'Petition after probation ends',  felony:'Non-dangerous only',         dui:'Not eligible',     dismissed:'Petition required',  statute:'A.R.S. § 13-907',             highlight:'Set-aside system -- not full expungement. Record shows "set aside."' },
  AR:{ name:'Arkansas',      misdemeanor:'5 yr, first offense',            felony:'Class C/D non-violent, 5 yr',dui:'Not eligible',     dismissed:'Immediately',        statute:'Ark. Code § 16-90-1417',      highlight:'Broad felony eligibility for first offenders. DWI excluded.' },
  CA:{ name:'California',    misdemeanor:'1 yr or probation end',          felony:'Wobbler reductions available',dui:'Possible, 10 yr', dismissed:'Immediately',        statute:'Pen. Code § 1203.4',          highlight:'Dismissal (not expungement). AB 1076 adds automatic relief.' },
  CO:{ name:'Colorado',      misdemeanor:'3 yr wait',                      felony:'Non-violent, 5-10 yr',       dui:'Not eligible',     dismissed:'Petition available', statute:'C.R.S. § 24-72-706',          highlight:'Broad 2022 law adds automatic sealing for many old convictions.' },
  CT:{ name:'Connecticut',   misdemeanor:'3 yr, automatic',                felony:'5 yr, petition',             dui:'Not eligible',     dismissed:'Automatic',          statute:'C.G.S. § 54-142a',            highlight:'Strong automatic erasure. Violent/sex offenses excluded.' },
  DE:{ name:'Delaware',      misdemeanor:'5 yr, petition',                 felony:'7 yr, non-violent only',     dui:'Not eligible',     dismissed:'Petition available', statute:'11 Del. C. § 4372',           highlight:'Must be offense-free since adjudication.' },
  FL:{ name:'Florida',       misdemeanor:'Seal 10 yr, then expunge',       felony:'Seal only, limited',         dui:'Not eligible',     dismissed:'Immediately',        statute:'F.S. § 943.0585',             highlight:'Two-step: seal then expunge. DUI never eligible. One shot per lifetime.' },
  GA:{ name:'Georgia',       misdemeanor:'Restriction after 4 yr',        felony:'First Offender Act only',    dui:'Not eligible',     dismissed:'Immediately',        statute:'O.C.G.A. § 35-3-37',          highlight:'Restriction, not expungement. First Offender Act is the key pathway.' },
  HI:{ name:'Hawaii',        misdemeanor:'5 yr, petition',                 felony:'Non-violent, 10 yr',         dui:'Not eligible',     dismissed:'Petition available', statute:'HRS § 831-3.2',               highlight:'Expungement by executive pardon system. Limited pathways.' },
  ID:{ name:'Idaho',         misdemeanor:'5 yr, petition',                 felony:'5 yr non-violent, petition', dui:'Case-by-case',     dismissed:'Petition available', statute:'Idaho Code § 19-2604',         highlight:'Judge has discretion. First-time offenders most likely to succeed.' },
  IL:{ name:'Illinois',      misdemeanor:'3 yr, many automatic',           felony:'4-7 yr, non-violent',        dui:'Not eligible',     dismissed:'Automatic',          statute:'720 ILCS 5/5-5-3.2',          highlight:'Strong 2023 CLEAR act. Broad automatic sealing for old records.' },
  IN:{ name:'Indiana',       misdemeanor:'5 yr, petition',                 felony:'8-10 yr, non-violent',       dui:'Not eligible',     dismissed:'After 1 yr',         statute:'I.C. § 35-38-9',              highlight:'Restricted access (not full expungement) for most convictions.' },
  IA:{ name:'Iowa',          misdemeanor:'8 yr, petition',                 felony:'Not eligible (most)',        dui:'Not eligible',     dismissed:'After 180 days',     statute:'Iowa Code § 901C.1',           highlight:'One of the stricter states. Simple misdemeanors only.' },
  KS:{ name:'Kansas',        misdemeanor:'3-5 yr, petition',               felony:'5 yr non-violent, petition', dui:'Not eligible',     dismissed:'After case closed',  statute:'K.S.A. § 21-6614',            highlight:'Multiple prior convictions make expungement harder.' },
  KY:{ name:'Kentucky',      misdemeanor:'5 yr, Class B only',             felony:'Class D non-violent, 5 yr',  dui:'Not eligible',     dismissed:'Immediately',        statute:'KRS § 431.073-078',           highlight:'Limited but improving. Class B misdemeanors + limited Class D felonies.' },
  LA:{ name:'Louisiana',     misdemeanor:'5 yr, first offense',            felony:'10 yr non-violent',          dui:'Not eligible',     dismissed:'Immediately',        statute:'La. C.Cr.P. art. 977',        highlight:'Must have completed all terms of sentence.' },
  ME:{ name:'Maine',         misdemeanor:'3 yr, petition',                 felony:'10 yr, Class C only',        dui:'Not eligible',     dismissed:'Petition available', statute:'15 M.R.S. § 2255',            highlight:'New 2021 law expanded access significantly.' },
  MD:{ name:'Maryland',      misdemeanor:'3 yr, petition/automatic',       felony:'15 yr, very limited',        dui:'Not eligible',     dismissed:'Immediately',        statute:'Md. Code Crim. Proc. § 10-105',highlight:'Shielding system for misdemeanors. Broad 2023 Clean Slate Act.' },
  MA:{ name:'Massachusetts', misdemeanor:'3-5 yr, petition',               felony:'7-10 yr, petition',          dui:'Not eligible',     dismissed:'Immediately',        statute:'G.L. c. 276, § 100A',         highlight:'Sealing (not expungement) is the primary remedy.' },
  MI:{ name:'Michigan',      misdemeanor:'3 yr, petition or automatic',    felony:'5-7 yr, petition',           dui:'Not eligible',     dismissed:'Immediately',        statute:'MCL § 780.621',               highlight:'2021 Clean Slate Act added automatic expungement for many old convictions.' },
  MN:{ name:'Minnesota',     misdemeanor:'2 yr, many automatic',           felony:'5 yr non-violent, petition', dui:'Not eligible',     dismissed:'Automatic',          statute:'Minn. Stat. § 609A.02',       highlight:'Strong automatic expungement. One of the best states for clean slate.' },
  MS:{ name:'Mississippi',   misdemeanor:'5 yr, first offense',            felony:'Not eligible (most)',         dui:'Not eligible',     dismissed:'Dismissed/NP only',  statute:'Miss. Code § 99-19-71',       highlight:'Very limited. First offense misdemeanors only.' },
  MO:{ name:'Missouri',      misdemeanor:'3 yr, petition',                 felony:'7 yr, non-violent',          dui:'Not eligible',     dismissed:'After case closed',  statute:'RSMo § 610.140',              highlight:'2018 law significantly expanded eligibility. Misdemeanor 3 yr, felony 7 yr.' },
  MT:{ name:'Montana',       misdemeanor:'5 yr, petition',                 felony:'5 yr, deferred sentence only',dui:'Not eligible',   dismissed:'Petition available', statute:'Mont. Code § 46-18-1102',     highlight:'Deferred imposition of sentence is key vehicle. Conviction itself rarely expunged.' },
  NE:{ name:'Nebraska',      misdemeanor:'3 yr, petition',                 felony:'10 yr, non-violent',         dui:'Not eligible',     dismissed:'Petition available', statute:'Neb. Rev. Stat. § 29-3523',   highlight:'Set-aside system. Must complete all terms of sentence.' },
  NV:{ name:'Nevada',        misdemeanor:'2 yr, petition',                 felony:'7 yr non-violent, petition', dui:'7 yr, first only', dismissed:'Immediately',        statute:'NRS § 179.245',               highlight:'DUI expungement possible after 7 yr for first offense -- one of few states.' },
  NH:{ name:'New Hampshire', misdemeanor:'3 yr, petition',                 felony:'10 yr non-violent, petition', dui:'Not eligible',   dismissed:'After case closed',  statute:'RSA § 651:5',                 highlight:'Annulment system. Judge has broad discretion.' },
  NJ:{ name:'New Jersey',    misdemeanor:'5 yr, petition',                 felony:'6-10 yr, petition',          dui:'Not eligible',     dismissed:'Immediately',        statute:'N.J.S.A. § 2C:52-2',         highlight:'Comprehensive system. Multiple convictions can be expunged together.' },
  NM:{ name:'New Mexico',    misdemeanor:'1-2 yr, petition',               felony:'Deferred only, non-violent', dui:'Not eligible',     dismissed:'Immediately',        statute:'NMSA § 29-3A-1',              highlight:'Broad misdemeanor access. Deferred sentence vehicle for felonies.' },
  NY:{ name:'New York',      misdemeanor:'Sealing, 3 yr',                  felony:'Sealing, 10 yr, 1 felony max',dui:'Not eligible',   dismissed:'Automatic',          statute:'CPL § 160.59',                highlight:'Sealing (not expungement). Max 2 sealed convictions. DWI never eligible.' },
  NC:{ name:'North Carolina',misdemeanor:'5 yr, first offense',            felony:'Class H/I non-violent, 10 yr',dui:'Not eligible',   dismissed:'Immediately',        statute:'G.S. § 15A-145',              highlight:'Limited but consistent. First-time misdemeanor + limited felony.' },
  ND:{ name:'North Dakota',  misdemeanor:'3-5 yr, petition',               felony:'5-10 yr, petition',          dui:'Not eligible',     dismissed:'After case closed',  statute:'N.D.C.C. § 12.1-02-04',       highlight:'Misdemeanor + Class C/D felonies eligible. Judge has discretion.' },
  OH:{ name:'Ohio',          misdemeanor:'1-3 yr, petition',               felony:'3-7 yr, non-violent',        dui:'Not eligible',     dismissed:'After case closed',  statute:'ORC § 2953.32',               highlight:'Sealing system. Broad 2023 expansion. Marijuana offenses widely eligible.' },
  OK:{ name:'Oklahoma',      misdemeanor:'5 yr, petition',                 felony:'5 yr non-violent, petition', dui:'Not eligible',     dismissed:'After case closed',  statute:'22 O.S. § 18',                highlight:'Broad eligibility. Can expunge misdemeanors AND non-violent felonies.' },
  OR:{ name:'Oregon',        misdemeanor:'3-5 yr, automatic or petition',  felony:'3-7 yr, non-violent',        dui:'Not eligible',     dismissed:'Immediately',        statute:'ORS § 137.225',               highlight:'Strong automatic set-aside. Broad eligibility. Measure 11 offenses excluded.' },
  PA:{ name:'Pennsylvania',  misdemeanor:'10 yr or age 70+',               felony:'Very limited -- pardons only', dui:'Not eligible',   dismissed:'Immediately',        statute:'18 Pa.C.S. § 9122',           highlight:'Limited. Clean Slate Act (2018) automates some sealing. Felonies mostly excluded.' },
  RI:{ name:'Rhode Island',  misdemeanor:'5 yr, petition',                 felony:'10 yr non-violent, petition', dui:'Not eligible',   dismissed:'Immediately',        statute:'R.I. Gen. Laws § 12-1.3',     highlight:'Expungement available for first offenders. No prior convictions allowed.' },
  SC:{ name:'South Carolina',misdemeanor:'3 yr, first offense',            felony:'Not eligible (most)',         dui:'Not eligible',   dismissed:'Immediately',        statute:'S.C. Code § 22-5-910',        highlight:'Felony expungement very limited. First-time misdemeanor is primary pathway.' },
  SD:{ name:'South Dakota',  misdemeanor:'Petition after probation',       felony:'Pardon or deferred',          dui:'Not eligible',   dismissed:'After 10 yr',        statute:'SDCL § 23A-3-24',             highlight:'One of the more restrictive states. Pardon is main felony pathway.' },
  TN:{ name:'Tennessee',     misdemeanor:'5 yr, A & B classes',            felony:'Class E non-violent, 5 yr',  dui:'5 yr, first only',dismissed:'Immediately',        statute:'T.C.A. § 40-32-101',          highlight:'First-time DUI expungement possible after 5 yr -- one of few states.' },
  TX:{ name:'Texas',         misdemeanor:'Non-disclosure after probation', felony:'Non-disclosure, limited',     dui:'Not eligible',   dismissed:'Immediately',        statute:'Tex. Govt Code § 411.072',  highlight:'Non-disclosure (sealing) not expungement for most. Dismissals can be expunged.' },
  UT:{ name:'Utah',          misdemeanor:'3-4 yr, petition',               felony:'7 yr non-violent, petition',  dui:'Not eligible',  dismissed:'Petition available', statute:'Utah Code § 77-40-105',        highlight:'Certificate of eligibility required before petition. Process takes months.' },
  VT:{ name:'Vermont',       misdemeanor:'5 yr, automatic (2018 law)',     felony:'Very limited, petition',      dui:'Not eligible',  dismissed:'Automatically',      statute:'13 V.S.A. § 7607',            highlight:'2018 law added automatic expungement for many misdemeanors. Strong clean slate.' },
  VA:{ name:'Virginia',      misdemeanor:'Sealing, 7 yr (2021 law)',       felony:'Sealing, 10 yr (2021 law)',   dui:'Not eligible',  dismissed:'Immediately',        statute:'Va. Code § 19.2-392.6',       highlight:'2021 Clean Slate Act. Sealing not expungement. Violent/DUI excluded.' },
  WA:{ name:'Washington',    misdemeanor:'3 yr, vacation of conviction',   felony:'10 yr non-violent, vacation', dui:'Not eligible',  dismissed:'After case closed',  statute:'RCW § 9.94A.640',             highlight:'Vacation of conviction system. Very broad eligibility. Cannabis auto-vacated.' },
  WV:{ name:'West Virginia', misdemeanor:'1 yr, first offense',            felony:'5 yr first offense, non-violent',dui:'Not eligible',dismissed:'Immediately',       statute:'W. Va. Code § 61-11-26',       highlight:'One of the shorter wait periods for misdemeanors in the country.' },
  WI:{ name:'Wisconsin',     misdemeanor:'5 yr, expungement at sentencing',felony:'At sentencing only',          dui:'Not eligible',  dismissed:'After case closed',  statute:'Wis. Stat. § 973.015',        highlight:'Must be ordered at sentencing -- cannot petition later for most cases.' },
  WY:{ name:'Wyoming',       misdemeanor:'5 yr, petition',                 felony:'5 yr non-violent, petition',  dui:'Not eligible',  dismissed:'After case closed',  statute:'Wyo. Stat. § 7-13-1501',      highlight:'Relatively broad for non-violent felonies. Must be offense-free.' },
  DC:{ name:'District of Columbia', misdemeanor:'5 yr from sentence end (2025 law)',         felony:'10 yr, non-violent',          dui:'Not eligible',  dismissed:'After 2 yr',         statute:'D.C. Code § 16-803',          highlight:'Clean Hands Act (2023) expanded eligibility significantly.' },
};

// ── Expungement eligibility countdown ────────────────────────────────────────
function ExpungementCountdown({ waitYears, caseDate, navigation }: {
  waitYears: number; caseDate: string; navigation: Record<string, any>;
}) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200)
  }, []);

  const eligible = React.useMemo(() => {
    const d = new Date(caseDate);
    d.setFullYear(d.getFullYear() + waitYears);
    return d;
  }, [caseDate, waitYears]);

  const now = new Date();
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
      Alert.alert('Reminder set ✓',
        isEligible
          ? "You'll get a reminder in 3 days to check your eligibility."
          : `You'll get a reminder 30 days before your eligibility date.`
      );
    } catch {
      Alert.alert('Could not set reminder', 'Make sure notifications are enabled in Settings.');
    }
  }, [eligible, isEligible]);

  return (
    <View style={{ backgroundColor: isEligible ? COLORS.legalBg : COLORS.bgSubtle,
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
          <TouchableOpacity
            onPress={scheduleReminder}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: COLORS.navy, borderRadius: 8,
              paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start' }}
            accessibilityRole="button"
            accessibilityLabel="Set a reminder for your eligibility date"
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14 }}>🔔</Text>
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

export default function ExpungementScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
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
      Alert.alert('Could not generate petition',
        'Check your connection and try again.');
    } finally {
      setGenPetition(false);
    }
  };

  // Load user's saved state as default if not passed via route params
  React.useEffect(() => {
    if (!incomingState) {
      getUserState().then(s => {
        if (s?.code) setState(s.code);
      }).catch(() => {});
    }
  }, []);
  // Auto-submit when navigated from CaseScreen with charges + state
  // so user sees results immediately without re-entering data
  React.useEffect(() => {
    if (incomingCharges && incomingState && step === 'form') {
      // Give state one tick to update before submitting
      const t = setTimeout(() => {
        checkEligibility();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [incomingState]);


  const { colors, isDark } = useTheme();
  const incomingCaseId = (route?.params as any)?.case_id;
  var incomingState   = (route?.params as any)?.incomingState || (route?.params as any)?.state || '';
  const incomingCharges = (route?.params as any)?.incomingCharges || null;
  const incomingCaseTitle = (route?.params as any)?.caseTitle || null;

  const [step, setStep]         = useState<'form'|'result'>('form');
  const [state, setState]       = useState(incomingState);
  const [charges, setCharges]   = useState(incomingCharges || '');
  const [caseStatus, setCaseStatus] = useState('Closed');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<EligibilityResult | null>(null);
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [referralLoading, setReferralLoading] = useState('');
  const [attorneys,       setAttorneys]       = useState<any[]>([]);
  const [attLoading,      setAttLoading]      = useState(false);
  const [viewMode, setViewMode]         = useState<'checker'|'cards'>('checker');
  const [cardState, setCardState]       = useState('');
  const [cardFilter, setCardFilter]     = useState<'all'|'misdemeanor'|'felony'>('all');
  const [petitionDraft, setPetitionDraft]   = useState('');
  const [genPetition, setGenPetition]       = useState(false);
  const [showPetition, setShowPetition]     = useState(false);

  const checkEligibility = async () => {
    setLoading(true);
    try {
      const res = await cachedGet('/expungement/check', {
        params: { state, charges, status: caseStatus },
      });
      if (!mountedRef.current) return;
      setResult(res.data || null);
      cacheExpungement(state, res.data);
      // Fetch matched expungement attorneys for this state
      if (res.data?.eligibility && !res.data?.eligibility.notEligible) {
        setAttLoading(true);
        cachedGet('/expungement/attorneys', { params: { state, limit: 5 } })
          .then(r => setAttorneys(r.data?.attorneys || []))
          .catch((e) => { __DEV__ && console.warn(e?.message); })
          .finally(() => setAttLoading(false));
      }
      setStep('result');
    } catch (e: any) {
      Alert.alert('Could Not Load Expungement Data', e.response?.data?.error || 'Could not check eligibility. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReferral = async (partnerKey: string, url: string) => {
    setReferralLoading(partnerKey);
    try {
      await api.post('/expungement/referral', {
        case_id: incomingCaseId,
        state, charges, status: caseStatus, partner: partnerKey,
      }).catch((e) => { __DEV__ && console.warn(e?.message); }); // log but don't block
      await Linking.openURL(url).catch(() => {});
    } catch {
      await Linking.openURL(url).catch(() => {});
    } finally {
      setReferralLoading('');
    }
  };

  const eligColor = result
    ? result.eligibility.likely       ? COLORS.legal
    : result.eligibility.conditional  ? COLORS.warn
    : COLORS.emergency
    : COLORS.textMuted;

  const eligBg = result
    ? result.eligibility.likely       ? COLORS.legalBg
    : result.eligibility.conditional  ? COLORS.warnBg
    : COLORS.emergencyBg
    : COLORS.bg;

  const eligIcon = result
    ? result.eligibility.likely       ? '✅'
    : result.eligibility.conditional  ? '⚠️'
    : '❌'
    : '';

  const eligLabel = result
    ? result.eligibility.likely       ? 'Likely Eligible'
    : result.eligibility.conditional  ? 'Possibly Eligible'
    : 'Not Eligible'
    : '';

  // ── Form step ────────────────────────────────────────────────────────────
  if (step === 'form') return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

      <View style={styles.hero}>

              <Text maxFontSizeMultiplier={1.4} style={styles.heroEmoji}>📋</Text>
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
            style={{ color: colors.blue, textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL('https://www.juvenilelaw.org/find-help').catch(() => {})}
          >
            state\'s juvenile public defender or juvenile court clerk
          </Text>
          {' '}directly.
        </Text>
      </View>

      {/* State */}
      <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Your state</Text>
      <TouchableOpacity style={styles.stateBtn}
        onPress={() => setShowStatePicker(p => !p)}
        accessibilityRole="button">
        <Text maxFontSizeMultiplier={1.4} style={styles.stateBtnText}>{state}  ▾</Text>
      </TouchableOpacity>
      {showStatePicker && (
        <ScrollView style={styles.stateDropdown} nestedScrollEnabled>
          {US_STATES.map(st => (
            <TouchableOpacity
              key={st}
              style={[styles.stateRow, state === st && styles.stateRowActive]}
              onPress={() => { setState(st); setShowStatePicker(false); }}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.stateRowText, state === st && { color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }]}>{st}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Case status */}
      <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>Case outcome</Text>
      <View style={styles.statusRow}>
        {['Closed', 'Dismissed', 'Still Open'].map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.statusChip, caseStatus === s && styles.statusChipActive]}
            onPress={() => setCaseStatus(s)}
              accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.statusChipText, caseStatus === s && styles.statusChipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Charges */}
      <Text maxFontSizeMultiplier={1.4} style={styles.fieldLabel}>What were the charges?</Text>
      <View style={styles.chargeChips}>
        {CHARGE_EXAMPLES.map(ch => (
          <TouchableOpacity
            key={ch}
            style={[styles.chargeChip, charges === ch && styles.chargeChipActive]}
            onPress={() => setCharges(charges === ch ? '' : ch)}
              accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.chargeChipText, charges === ch && styles.chargeChipTextActive]}>{ch}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
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
        onPress={checkEligibility}
        disabled={loading}
        activeOpacity={0.85}>

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
      <View style={[styles.verdictCard, { backgroundColor: eligBg, borderColor: eligColor }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.verdictEmoji}>{eligIcon}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.verdictLabel, { color: eligColor }]}>{eligLabel}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.verdictState}>{result?.stateName} · {result?.chargeType}</Text>
        {result?.eligibility.waitYears > 0 && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.verdictWait, { color: eligColor }]}>
            Typical waiting period: {(result as any).eligibility?.waitYears} year{(result as any).eligibility?.waitYears > 1 ? 's' : ''}
          </Text>
        )}
        {/* Eligibility date calculator */}
            {(result as any).eligibility?.waitYears > 0 && (result as any).caseCreatedAt && (
              <ExpungementCountdown
                waitYears={(result as any).eligibility?.waitYears}
                caseDate={(result as any).caseCreatedAt}
                navigation={navigation}
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
      {result && !result.eligibility.notEligible && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={styles.partnersTitle}>
            Expungement attorneys in {result.stateName || state}
          </Text>
            {/* Generate expungement petition */}
            {result && !result.eligibility.notEligible && (
              <TouchableOpacity
                style={{ marginTop: 12, backgroundColor: colors.legal, borderRadius: 12,
                  paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row',
                  alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onPress={generatePetition}
                disabled={genPetition}
                accessibilityRole="button"
                accessibilityLabel="Generate expungement petition draft"
              >
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16 }}>📋</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ color: colors.bgCard, fontWeight: '700',
                  fontSize: 14, lineHeight: 21 }}>
                  {genPetition ? 'Generating…' : 'Generate Petition Draft'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Petition modal */}
            <Modal visible={showPetition} animationType="slide"
              onRequestClose={() => setShowPetition(false)}>
              <View style={{ flex: 1, backgroundColor: colors.bg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16,
                  borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <TouchableOpacity onPress={() => setShowPetition(false)}
                    style={{ marginRight: 16 }} accessibilityRole="button"
                    >
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 16,
                      color: colors.navy }}>← Close</Text>
                  </TouchableOpacity>
                  <Text maxFontSizeMultiplier={1.4} style={{ flex: 1, fontSize: 16,
                    fontWeight: '700', color: colors.textPrimary }}>
                    Petition Draft
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={async () => {
                      const { Share } = await import('react-native');
                      try {
                        await Share.share({ message: petitionDraft, title: 'Expungement Petition Draft' })
                      } catch (shareErr: any) {
                        // Share API unavailable on this browser/device — fail silently

                    }}}
 accessibilityLabel="Share petition draft"
                  >
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14,
                      color: colors.navy, fontWeight: '600' }}>Share</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ flex: 1, padding: 16 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 20,
                    color: colors.textPrimary, fontFamily: 'Courier New' || 'monospace' }}>
                    {petitionDraft}
                  </Text>
                </ScrollView>
              </View>
            </Modal>

          {attLoading && (
            <View style={[styles.partnerCard, { alignItems: 'center', padding: 20 }]}>
              <ActivityIndicator color={colors.steelMid} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.partnerDesc, { marginTop: 8 }]}>Finding attorneys near you…</Text>
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
                  {!atty.jtb_verified && atty.bar_verified && <View style={{ backgroundColor:colors.bgElevated, borderRadius:20, paddingHorizontal:8, paddingVertical:2 }}><Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, color:colors.steel, fontWeight:'800' }}>✓ Bar Verified</Text></View>}
                  {atty.gavel_level >= 3 && <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, fontWeight:'800', color:colors.gold }}>🏆</Text>}
                  {atty.rating != null && <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, color:colors.warn, fontWeight:'700' }}>★ {Number(atty.rating).toFixed(1)}</Text>}
                </View>
              </View>
              {atty.free_consultation && (
                <View style={{ backgroundColor:colors.legalBg, borderRadius:8, padding:6, marginBottom:6 }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:11, color:colors.legal, fontWeight:'700' }}>✓ Free initial consultation</Text>
                </View>
              )}
              <View style={{ flexDirection:'row', gap:8, marginTop:4 }}>
                {atty.phone && (
                  <TouchableOpacity
                    style={[styles.partnerBtn, { flex:1, backgroundColor:colors.legalDark }]}
                    onPress={() => { Linking.openURL('tel:'+atty.phone).catch(() => {})}}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${atty.name}`}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.partnerBtnText}>📞 Call</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.partnerBtn, { flex:2 }]}
                  onPress={() => navigation.navigate('MoreTab', { screen: 'Booking', params: { lawyerName: atty.name, lawyerPhone: atty.phone || '', lawyerId: atty.id }})}
                  accessibilityRole="button"
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
              {result.partners.map(partner => (
                <View key={partner.key} style={styles.partnerCard}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.partnerName}>{partner.name}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.partnerDesc} numberOfLines={3} ellipsizeMode="tail">{partner.description}</Text>
                  <View style={styles.partnerFeeRow}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.partnerFeeLabel}>Estimated cost</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.partnerFeeValue}>{partner.estimatedCost}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.partnerBtn, referralLoading === partner.key && { opacity: 0.6 }]}
                    onPress={() => handleReferral(partner.key, partner.url)}
                    accessibilityRole="button"
                    disabled={referralLoading === partner.key}
                    activeOpacity={0.85}
                  >
                    {referralLoading === partner.key
                      ? <ActivityIndicator color={colors.bgCard} size="small" />
                      : <Text maxFontSizeMultiplier={1.4} style={styles.partnerBtnText}>{partner.cta}  →</Text>
                    }
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
        <View style={styles.notEligibleCard}>
          <Text maxFontSizeMultiplier={1.4} style={styles.notEligibleTitle}>What you can still do</Text>
          {[
            '⚖️  Speak to a defense attorney -- some exceptions exist',
            '📋  Apply for a Certificate of Relief (limits background check impact)',
            "🏛️  Apply for a Governor's pardon in some states",
            '⏳  Check back when the waiting period is complete',
          ].map(s => <Text maxFontSizeMultiplier={1.4} key={s} style={styles.notEligibleItem}>{s}</Text>)}
          <TouchableOpacity
            style={styles.partnerBtn}
            onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.partnerBtnText}>Find a Criminal Defense Lawyer →</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={styles.disclaimerNote}>{result?.disclaimer}</Text>

      <TouchableOpacity style={styles.startOverBtn} onPress={() => setStep('form')}
        accessibilityRole="button"
      >
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 16 },

  hero: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 20, alignItems: 'center', ...SHADOW.md,
  },
  heroEmoji: { fontSize: 40, marginBottom: 8 },
  heroTitle: { fontSize: 20, ...FONTS.black, color: COLORS.bgCard, textAlign: 'center', marginBottom: 8 },
  heroSub:   { fontSize: 12, color: COLORS.steel, textAlign: 'center', lineHeight: 18 },

  fieldLabel: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.navy, marginBottom: 8, marginTop: 16 },

  stateBtn: {
    backgroundColor: COLORS.bgCard, borderWidth: 1.5, borderColor: COLORS.navy,
    borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 11, alignSelf: 'flex-start',
  },
  stateBtnText: { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy },
  stateDropdown: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: COLORS.border, maxHeight: 200, marginBottom: 4, ...SHADOW.md,
  },
  stateRow:       { paddingVertical: 10, paddingHorizontal: 16 },
  stateRowActive: { backgroundColor: COLORS.bg },
  stateRowText:   { fontSize: 14, lineHeight: 21, color: COLORS.textPrimary },

  statusRow:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  statusChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: RADIUS.pill,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.bgCard,
  },
  statusChipActive:     { borderColor: COLORS.navy, backgroundColor: COLORS.navy },
  statusChipText:       { fontSize: 12, lineHeight: 20, color: COLORS.textSecond, ...FONTS.semi },
  statusChipTextActive: { color: COLORS.bgCard },

  chargeChips:        { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  chargeChip:         { paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.bgCard },
  chargeChipActive:   { borderColor: COLORS.navy, backgroundColor: COLORS.bgSubtle },
  chargeChipText:     { fontSize: 12, color: COLORS.textSecond, ...FONTS.semi },
  chargeChipTextActive: { color: COLORS.navy, ...FONTS.heavy },
  chargeInput: {
    backgroundColor: COLORS.bgCard, borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 11,
    fontSize: 12, lineHeight: 20, color: COLORS.textPrimary, marginBottom: 16,
  },

  checkBtn:     { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.md },
  checkBtnText: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },
  disclaimerNote: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  // Result
  verdictCard: {
    borderRadius: RADIUS.xl, borderWidth: 2, padding: 20, alignItems: 'center',
    marginBottom: 16, ...SHADOW.sm,
  },
  verdictEmoji: { fontSize: 48, marginBottom: 6 },
  verdictLabel: { fontSize: 22, ...FONTS.black, marginBottom: 4 },
  verdictState: { fontSize: 12, color: COLORS.textMuted, marginBottom: 8 },
  verdictWait:  { fontSize: 12, lineHeight: 20, ...FONTS.semi, marginBottom: 6 },
  verdictNote:  { fontSize: 12, color: COLORS.textSecond, textAlign: 'center', lineHeight: 18 },

  explainCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  explainTitle: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.navy, marginBottom: 10 },
  explainItem:  { fontSize: 12, color: COLORS.textSecond, lineHeight: 22 },

  partnersTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.navy, marginBottom: 10 },
  partnerCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  partnerName:     { fontSize: 16, lineHeight: 24, ...FONTS.heavy, color: COLORS.navy, marginBottom: 4 },
  partnerDesc:     { fontSize: 12, color: COLORS.textSecond, lineHeight: 18, marginBottom: 10 },
  partnerFeeRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  partnerFeeLabel: { fontSize: 12, color: COLORS.textMuted },
  partnerFeeValue: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.legal },
  partnerBtn:      { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center' },
  partnerBtnText:  { color: COLORS.bgCard, ...FONTS.heavy, fontSize: 14,
    lineHeight: 21, },

  notEligibleCard: {
    backgroundColor: COLORS.emergencyBg, borderRadius: RADIUS.lg, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#EF5350',
  },
  notEligibleTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.emergency, marginBottom: 10 },
  notEligibleItem:  { fontSize: 12, color: '#EF5350', lineHeight: 22, marginBottom: 2 },

  partnerReturnNote: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginTop: 4 },
  startOverBtn:  { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  startOverText: { fontSize: 12, lineHeight: 20, color: COLORS.steel, ...FONTS.semi },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);