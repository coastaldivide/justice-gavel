/**
 * DiversionScreen -- Diversion program eligibility checker
 *
 * Diversion = prosecutor agrees to dismiss charges if defendant completes
 * a program (community service, counseling, drug court, etc.)
 * Almost all first-time, non-violent offenders qualify in most states.
 * Most defendants and families don't know to ask for it.
 *
 * Zero API calls. All content is hardcoded state rules + logic.
 * No backend needed. Works offline.
 *
 * Entry points:
 *   1. HomeScreen tile "Diversion?"
 *   2. WhatHappensNextScreen -- tip at arraignment step
 *   3. CaseScreen -- suggested for open first-time cases
 */
import React, { useCallback, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl} from 'react-native';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';

declare var data: any;
// ── Diversion program data ────────────────────────────────────────────────────
type DiversionType = {
  name: string;
  description: string;
  typical: string;      // what completion looks like
  outcome: string;      // what happens when completed
};

const DIVERSION_PROGRAMS: DiversionType[] = [
  {
    name: 'Deferred Prosecution',
    description: 'Charges are filed but paused. Complete the program → charges dismissed.',
    typical: '6-18 months probation, counseling, or community service',
    outcome: 'Charges dismissed and often eligible for expungement immediately',
  },
  {
    name: 'Pre-Trial Diversion',
    description: 'Charges are never formally filed. Complete the requirements and the case is closed -- nothing on your record.',
    typical: '3-12 months with drug testing, community service, or classes',
    outcome: 'No conviction, no public record of charges',
  },
  {
    name: 'Drug Court',
    description: 'Intensive substance abuse treatment instead of incarceration.',
    typical: '12-18 months treatment, regular court check-ins, drug testing',
    outcome: 'Charges dismissed or significantly reduced. Recovery-focused.',
  },
  {
    name: 'Mental Health Court',
    description: 'Mental health treatment and support instead of traditional prosecution.',
    typical: '6-24 months treatment, medication compliance, regular court appearances',
    outcome: 'Charges dismissed upon successful completion',
  },
  {
    name: 'Community Service Diversion',
    description: 'Simple: complete hours of community service, charges dropped.',
    typical: '40-200 hours of community service',
    outcome: 'Charges dismissed. Fastest and simplest program.',
  },
];

// ── State-specific diversion notes ────────────────────────────────────────────
const STATE_NOTES: Record<string, string> = {
  TN: 'Tennessee allows charge diversion for first-time offenders with most misdemeanors and some non-violent felonies. No prior felonies. Ask your lawyer to apply within 30 days of your first court appearance.',
  TX: 'Texas offers diversion at the prosecutor\'s discretion. Strong programs in Houston and Austin. Drug cases have dedicated programs. Ask your lawyer to apply as early as possible.',
  CA: 'California has broad diversion options -- military service members, mental health cases, and drug offenses all have dedicated programs. One of the most accessible states for diversion.',
  FL: 'Florida\'s diversion program is available in every county. First-time offenders with minor charges are strong candidates. Ask your lawyer to contact the State Attorney\'s office.',
  NY: 'New York\'s ACD (Adjournment in Contemplation of Dismissal) is effectively diversion -- charges dismissed after 6-12 months if no re-arrest. Available for many misdemeanors.',
  GA: 'Georgia offers First Offender Act (O.C.G.A. § 42-8-60) -- not technically diversion but has same outcome: no conviction on your record upon completion of sentence.',
  OH: 'Ohio has an Intervention in Lieu of Conviction program available for drug charges, mental health cases, and other non-violent offenses.',
};

const DEFAULT_STATE_NOTE = 'Most states offer some form of diversion for first-time, non-violent offenders. Ask your attorney to request diversion at or before arraignment -- the earlier you ask, the better your chances.';

// ── Charge types ──────────────────────────────────────────────────────────────
const CHARGE_TYPES = [
  { key: 'drug_simple',    label: t('div_charge_drug'),   likely: 'strong',     programs: ['Drug Court', 'Pre-Trial Diversion', 'Deferred Prosecution'] },
  { key: 'theft_minor',    label: t('div_charge_theft'), likely: 'strong',     programs: ['Community Service Diversion', 'Pre-Trial Diversion'] },
  { key: 'dui_first',      label: t('div_charge_dui'),              likely: 'moderate',   programs: ['Deferred Prosecution', 'Drug Court'] },
  { key: 'disorderly',     label: t('div_charge_disorderly'), likely: 'strong',     programs: ['Community Service Diversion', 'Pre-Trial Diversion'] },
  { key: 'assault_simple', label: t('div_charge_assault'),       likely: 'moderate',   programs: ['Deferred Prosecution', 'Mental Health Court'] },
  { key: 'fraud_minor',    label: t('div_charge_fraud'),          likely: 'moderate',   programs: ['Pre-Trial Diversion (PTD)', 'Deferred Prosecution'] },
  { key: 'drug_sales',     label: t('div_charge_drug_sales'),       likely: 'low',        programs: ['Drug Court'] },
  { key: 'felony_violent', label: t('div_charge_violent'),                   likely: 'unlikely',   programs: [] },
  { key: 'domestic',       label: t('div_charge_domestic'),                likely: 'restricted', programs: ['Mental Health Court'] },
];

const PRIOR_OPTIONS = [
  { key: 'none',   label: t('div_prior_none') },
  { key: 'minor',  label: t('div_prior_minor') },
  { key: 'felony', label: t('div_prior_felony') },
];

const LIKELIHOOD_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string; message: string }> = {
  strong: {
    label: t('div_likely_strong'),
    color: COLORS.legal,
    bg: COLORS.legalBg,
    icon: '✅',
    message: 'Based on your charge type and history, you appear likely eligible to apply for diversion. Diversion is granted at the prosecutor\'s discretion -- eligibility means you qualify to apply, not that it is possible. Ask your attorney to request it at or before your first court appearance.',
  },
  moderate: {
    label: t('div_likely_good'),
    color: COLORS.blue,
    bg: COLORS.bgSubtle,
    icon: '✓',
    message: 'You may be eligible to apply for diversion. The prosecutor has full discretion to grant or deny it regardless of eligibility. An attorney presenting a strong application at arraignment significantly improves acceptance rates.',
  },
  low: {
    label: t('div_likely_possible'),
    color: COLORS.warn,
    bg: COLORS.warnBg,
    icon: '⚠️',
    message: 'Diversion is possible but less common for this charge type. The prosecutor retains full discretion. Specialized programs like Drug Court or Mental Health Court may still be available. Ask your attorney specifically about your jurisdiction.',
  },
  restricted: {
    label: t('div_likely_limited'),
    color: COLORS.warn,
    bg: COLORS.warnBg,
    icon: '⚠️',
    message: 'Diversion is restricted for domestic violence charges in most states due to mandatory prosecution policies. Mental Health Court may still be available. An attorney can advise on your specific case.',
  },
  unlikely: {
    label: t('div_likely_unlikely'),
    color: COLORS.emergency,
    bg: COLORS.emergencyBg,
    icon: '✕',
    message: 'Diversion is generally not available for violent felonies. Focus on finding an experienced criminal defense attorney who can negotiate the best possible outcome.',
  },
};

function adjustForPriors(base: string, priorKey: string): string {
  if (priorKey === 'felony') {
    if (base === 'strong') return 'moderate';
    if (base === 'moderate') return 'low';
    if (base === 'low') return 'unlikely';
  }
  if (priorKey === 'minor') {
    if (base === 'strong') return 'moderate';
  }
  return base;
}

const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC',
  ];

export default function DiversionScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [divLoading,       setDivLoading]       = React.useState(true);
  const [divError,         setDivError]         = React.useState(false);
  const [diversionLesson, setDiversionLesson] = React.useState<any>(null);
  React.useEffect(() => {
    setDivLoading(true);
    api.get("/lessons?category=Court%20Process&limit=5").then(r => {
      const d = ((r as any).data || []).find((l: any) => l.title?.toLowerCase().includes('diversion'));
      if (d) setDiversionLesson(d);
    }).catch(() => { setDivError(true); }).finally(() => setDivLoading(false));
  }, []);
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/lessons?category=Court%20Process&limit=5')
      .then(r => { const d=((r as any).data||[]).find(l=>l.title?.toLowerCase().includes('diversion'));
        if (d && mountedRef.current) setDiversionLesson(d); })
      .catch(() => { if (mountedRef.current) setDivError(true); });
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 800);
  }, []);


  const [step, setStep]       = useState<'form' | 'result'>('form');
  const [state, setState]     = useState((route?.params as any)?.state || '');
  const [charge, setCharge]   = useState('');
  const [prior, setPrior]     = useState('none');
  const [showState, setShowState] = useState(false);
  const [isLoading, setIsLoading] = React.useState(true);

    const chargeData  = CHARGE_TYPES.find(c => c.key === charge);
  const baseLikely  = chargeData?.likely ?? 'moderate';
  const adjLikely   = adjustForPriors(baseLikely, prior);
  const likelihood  = LIKELIHOOD_CONFIG[adjLikely];
  const programs    = (chargeData?.programs ?? [])
    .map(name => DIVERSION_PROGRAMS.find(p => p.name === name))
    .filter(Boolean) as DiversionType[];
  const stateNote   = STATE_NOTES[state] || DEFAULT_STATE_NOTE;

  // ── Form ─────────────────────────────────────────────────────────────────
  if (step === 'form') return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      {/* Hero */}
      <View style={styles.hero}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroEmoji}>🤝</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroTitle}>{t('div_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroSub}>
          Diversion programs let first-time offenders complete community service,
          counseling, or treatment -- and have charges dismissed. Most people
          eligible for diversion never ask for it.
        </Text>
      </View>

      {/* State */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textPrimary }]}>Your state</Text>
      <TouchableOpacity
          activeOpacity={0.6}
        style={[styles.stateBtn, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
        onPress={() => setShowState(p => !p)}
            accessibilityRole="button"
        accessibilityLabel={`Select state, currently ${state}`}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.stateBtnText, { color: colors.textPrimary }]}>{state}  ▾</Text>
      </TouchableOpacity>
      {showState && (
        <ScrollView
          style={[styles.stateDropdown, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          nestedScrollEnabled
        >
          {US_STATES.map(st => (
            <TouchableOpacity
              accessibilityRole="button"
              key={st}
              style={[styles.stateRow, state === st && { backgroundColor: colors.bg }]}
              onPress={() => { setState(st); setShowState(false); }}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.stateRowText, { color: colors.textPrimary },
                state === st && { color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }]}>{st}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Charge type */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textPrimary }]}>What is the charge?</Text>
      <View style={styles.chargeList}>
        {CHARGE_TYPES.map(ct => (
          <TouchableOpacity
            accessibilityRole="button"
            key={ct.key}
            style={[
              styles.chargeChip,
              { borderColor: colors.border, backgroundColor: colors.bgCard },
              charge === ct.key && { borderColor: COLORS.navy, backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle },
            ]}
            onPress={() => setCharge(ct.key === charge ? '' : ct.key)}
            accessibilityLabel={ct.label}
            accessibilityState={{ selected: charge === ct.key }}>
            <Text maxFontSizeMultiplier={1.4} style={[
              styles.chargeChipText,
              { color: colors.textSecond },
              charge === ct.key && { color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
            ]}>{ct.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Prior record */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textPrimary }]}>Criminal history</Text>
      <View style={styles.priorRow}>
        {PRIOR_OPTIONS.map(p => (
          <TouchableOpacity
            accessibilityRole="button"
            key={p.key}
            style={[
              styles.priorChip,
              { borderColor: colors.border, backgroundColor: colors.bgCard },
              prior === p.key && { borderColor: COLORS.navy, backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle },
            ]}
            onPress={() => setPrior(p.key)}
            accessibilityLabel={p.label}
            accessibilityState={{ selected: prior === p.key }}>
            <Text maxFontSizeMultiplier={1.4} style={[
              styles.priorChipText,
              { color: colors.textSecond },
              prior === p.key && { color: COLORS.navy, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
            ]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.checkBtn, !charge && styles.checkBtnDisabled]}
        onPress={() => charge && setStep('result')}
            accessibilityRole="button"
        disabled={!charge}
        accessibilityLabel="Check diversion eligibility"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.checkBtnText}>Check Eligibility  →</Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textMuted }]}>
        Free · No sign-in required · Not legal advice
      </Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // ── Result ───────────────────────────────────────────────────────────────

  if (isLoading) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#042C53' }}>
      <ActivityIndicator size="large" color="#C9A84C" />
    </View>
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {divError && (
        <View style={{margin:16,padding:14,backgroundColor:colors.surface,
          borderRadius:10,borderWidth:1,borderColor:colors.border}}>
          <Text style={{color:colors.danger,fontWeight:'700',fontSize:14}}>
            ⚠ Could not load diversion programs. Check your connection and pull down to retry.
          </Text>
        </View>
      )}
      {/* Verdict card */}
      <View style={[styles.verdictCard, { backgroundColor: likelihood.bg, borderColor: likelihood.color }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.verdictIcon}>{likelihood.icon}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.verdictLabel, { color: likelihood.color }]}>{likelihood.label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.verdictState, { color: colors.textMuted }]}>
          {state} · {chargeData?.label} · {PRIOR_OPTIONS.find(p => p.key === prior)?.label}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.verdictMessage, { color: likelihood.color }]}>{likelihood.message}</Text>
      </View>

      {/* State-specific note */}
      <View style={[styles.stateNote, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.stateNoteLabel, { color: colors.textMuted }]}>
          {STATE_NOTES[state] ? `${state} -- State rules` : 'General guidance'}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.stateNoteBody, { color: colors.textSecond }]}>{stateNote}</Text>
      </View>

      {/* Matching programs */}
      {programs.length > 0 && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>Programs you may qualify for</Text>
          {programs.map(prog => (
            <View key={prog.name} style={[styles.programCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.progName, { color: colors.textPrimary }]}>{prog.name}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.progDesc, { color: colors.textSecond }]} numberOfLines={3} ellipsizeMode="tail">{prog.description}</Text>
              <View style={styles.progRow}>
                <View style={styles.progCell}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.progCellLabel, { color: colors.textMuted }]}>Typical requirements</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.progCellVal, { color: colors.textSecond }]}>{prog.typical}</Text>
                </View>
              </View>
              <View style={[styles.progOutcome, { backgroundColor: COLORS.legalBg }]}>
                <Text maxFontSizeMultiplier={1.4} style={styles.progOutcomeText}>✓  {prog.outcome}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      {/* What to do */}
      <View style={[styles.actionCard, { backgroundColor: COLORS.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.actionTitle}>What to do right now</Text>
        {[
          'Tell your lawyer you want to apply for diversion -- use those exact words.',
          'Ask at or before arraignment. The earlier you request it, the better.',
          'Diversion must be requested -- judges and prosecutors rarely offer it unsolicited.',
          'Even a public defender can file a diversion application.',
        ].map((s, i) => (
          <View key={i} style={styles.actionItem}>
            <Text maxFontSizeMultiplier={1.4} style={styles.actionNum}>{i + 1}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.actionText}>{s}</Text>
          </View>
        ))}
      </View>

      {/* CTAs */}
      <View style={styles.ctaRow}>
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: COLORS.legal }]}
          onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
          accessibilityLabel="Find a lawyer"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaBtnText}>⚖️  Find a Lawyer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: colors.bgCard, borderWidth: 1.5, borderColor: colors.border }]}
          accessibilityRole="button"
          onPress={() => { setStep('form'); setCharge(''); }}
          accessibilityLabel="Check a different charge"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.ctaBtnText, { color: colors.textSecond }]}>← Try Another</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.prosecutorNote, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.prosecutorNoteTitle, { color: colors.textPrimary }]}>
          ⚖️  Prosecutor's discretion
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.prosecutorNoteBody, { color: colors.textSecond }]}>
          Diversion is granted entirely at the prosecutor's discretion. Showing as "likely eligible to apply" means you meet the general criteria -- it does not guarantee acceptance. The prosecutor can decline for any reason, including prior contact with the criminal justice system, the specific facts of the offense, or local policy. An attorney who knows the local DA's office can make a substantial difference in acceptance rates.
        </Text>
      </View>
      <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textMuted }]}>
        General information only -- not legal advice. Verify eligibility rules with a licensed attorney in your jurisdiction.
      </Text>

      <View style={{ height: 40 }} />

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>⚖️</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No diversion programs found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Diversion programs vary by county. Contact your attorney or the court clerk.</Text>
        </View>
      )}
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16 },

  hero: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 20, alignItems: 'center', ...SHADOW.md,
  },
  heroEmoji: { fontSize: 36, marginBottom: 8 },
  heroTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, textAlign: 'center', marginBottom: 8 },
  heroSub:   { fontSize: 12, color: COLORS.steel, textAlign: 'center', lineHeight: 19 },

  fieldLabel: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, marginBottom: 8, marginTop: 16 },

  stateBtn: {
    borderWidth: 1.5, borderRadius: RADIUS.md,
    paddingHorizontal: 16, paddingVertical: 11, alignSelf: 'flex-start',
  },
  stateBtnText:   { fontSize: 16, lineHeight: 24, ...FONTS.heavy },
  stateDropdown:  { borderRadius: RADIUS.md, borderWidth: 1, maxHeight: 200, marginBottom: 4, ...SHADOW.md },
  stateRow:       { paddingVertical: 10, paddingHorizontal: 16 },
  stateRowText:   { fontSize: 14,
    lineHeight: 21, },

  chargeList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  chargeChip: {
    paddingHorizontal: 13, paddingVertical: 8,
    borderRadius: RADIUS.pill, borderWidth: 1.5,
  },
  chargeChipText: { fontSize: 12, ...FONTS.semi },

  priorRow: { flexDirection: 'column', gap: 7, marginBottom: 20 },
  priorChip: {
    paddingHorizontal: 16, paddingVertical: 11,
    borderRadius: RADIUS.md, borderWidth: 1.5,
  },
  priorChipText: { fontSize: 12, lineHeight: 20, ...FONTS.semi },

  checkBtn:         { backgroundColor: COLORS.navy, borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.md },
  checkBtnDisabled: { backgroundColor: COLORS.textMuted },
  checkBtnText:     { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },
  disclaimer:       { fontSize: 11, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  // Result
  verdictCard: {
    borderRadius: RADIUS.xl, borderWidth: 2,
    padding: 20, alignItems: 'center', marginBottom: 14, ...SHADOW.sm,
  },
  verdictIcon:    { fontSize: 44, marginBottom: 6 },
  verdictLabel:   { fontSize: 20, ...FONTS.black, marginBottom: 4 },
  verdictState:   { fontSize: 11, marginBottom: 10 },
  verdictMessage: { fontSize: 12, textAlign: 'center', lineHeight: 19 },

  stateNote: {
    borderRadius: RADIUS.lg, padding: 16, marginBottom: 14,
    borderWidth: 1, ...SHADOW.sm,
  },
  stateNoteLabel: { fontSize: 11, ...FONTS.black, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  stateNoteBody:  { fontSize: 12, lineHeight: 19 },

  sectionLabel: { fontSize: 11, ...FONTS.black, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 },

  programCard: {
    borderRadius: RADIUS.lg, padding: 15, marginBottom: 10, borderWidth: 1, ...SHADOW.sm,
  },
  progName:        { fontSize: 15, lineHeight: 22, ...FONTS.heavy, marginBottom: 4 },
  progDesc:        { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  progRow:         { marginBottom: 8 },
  progCell:        {},
  progCellLabel:   { fontSize: 11, ...FONTS.heavy, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  progCellVal:     { fontSize: 12, lineHeight: 17 },
  progOutcome:     { borderRadius: RADIUS.md, padding: 9, marginTop: 4 },
  progOutcomeText: { fontSize: 12, ...FONTS.heavy, color: COLORS.legal },

  actionCard: { borderRadius: RADIUS.xl, padding: 16, marginBottom: 14, ...SHADOW.md },
  actionTitle: { fontSize: 15, lineHeight: 22, ...FONTS.black, color: COLORS.bgCard, marginBottom: 12 },
  actionItem:  { flexDirection: 'row', gap: 8, marginBottom: 9 },
  actionNum:   {
    width: 22, height: 22, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: COLORS.bgCard, fontSize: 12, ...FONTS.black,
    textAlign: 'center', lineHeight: 22,
  },
  actionText: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.88)', lineHeight: 18 },

  ctaRow:   { flexDirection: 'row', gap: 8, marginBottom: 14 },
  ctaBtn:   { flex: 1, borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center', ...SHADOW.sm },
  ctaBtnText: { fontSize: 12, lineHeight: 20, ...FONTS.heavy, color: COLORS.bgCard },
  prosecutorNote:      { borderRadius: 8, borderWidth: 1, padding: 16, marginBottom: 12 },
  prosecutorNoteTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 6 },
  prosecutorNoteBody:  { fontSize: 12, lineHeight: 18 },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);