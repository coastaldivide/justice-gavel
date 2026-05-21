/**
 * WhatHappensNextScreen -- t("whn_title") animated legal process walkthrough
 *
 * Entry points:
 *   1. LawyersScreen need modal → tap any charge type → walkthrough appears first
 *   2. HomeScreen tile "What's Next"
 *   3. ChatScreen after AI response mentions a charge type
 *
 * Content: 5-step walkthrough tailored to charge type.
 * Steps: Arrest → Booking → Arraignment → Bail Hearing → Court Date
 * Each step has duration estimate, what to do, and what NOT to do.
 *
 * Purely frontend -- no API calls, no backend. Pure educational content.
 */
import EmergencyStrip from '../components/EmergencyStrip';
import React, { useCallback, useState, useRef, useEffect } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Dimensions, RefreshControl} from 'react-native';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { getUserState } from '../utils/userState';

declare var isLoading: any; // hoisted from component scope
const { width: SW } = Dimensions.get('window');

// ── Charge-type walkthrough data ─────────────────────────────────────────────
type Step = {
  id: number;
  icon: string;
  title: string;
  timeframe: string;
  what: string;
  dos: string[];
  donts: string[];
  tip: string;
};

type ChargeWalkthrough = {
  label: string;
  color: string;
  bg: string;
  intro: string;
  steps: Step[];
};

const WALKTHROUGHS: Record<string, ChargeWalkthrough> = {
  DUI: {
    label: t('whn_charge_dui'),
    color: COLORS.emergencyDark,
    bg:    COLORS.emergencyBg,
    intro: t('whn_dui_intro'),
    steps: [
      { id: 1, icon: '🚔', title: t('whn_dui_1_title'), timeframe: t('whn_dui_1_time'),
        what: t('whn_dui_1_what'),
        dos:   [t('whn_dui_1_do1'), t('whn_dui_1_do2'), t('whn_dui_1_do3')],
        donts: [t('whn_dui_1_dont1'), t('whn_dui_1_dont2'), t('whn_dui_1_dont3')],
        tip:   t('whn_dui_1_tip') },
      { id: 2, icon: '📋', title: t('whn_dui_2_title'), timeframe: t('whn_dui_2_time'),
        what: t('whn_dui_2_what'),
        dos:   [t('whn_dui_2_do1'), t('whn_dui_2_do2'), t('whn_dui_2_do3')],
        donts: [t('whn_dui_2_dont1'), t('whn_dui_2_dont2'), t('whn_dui_2_dont3')],
        tip:   t('whn_dui_2_tip') },
      { id: 3, icon: '🏛️', title: t('whn_dui_3_title'), timeframe: t('whn_dui_3_time'),
        what: t('whn_dui_3_what'),
        dos:   [t('whn_dui_3_do1'), t('whn_dui_3_do2'), t('whn_dui_3_do3')],
        donts: [t('whn_dui_3_dont1'), t('whn_dui_3_dont2'), t('whn_dui_3_dont3')],
        tip:   t('whn_dui_3_tip') },
      { id: 4, icon: '⚖️', title: t('whn_dui_4_title'), timeframe: t('whn_dui_4_time'),
        what: t('whn_dui_4_what'),
        dos:   [t('whn_dui_4_do1'), t('whn_dui_4_do2'), t('whn_dui_4_do3')],
        donts: [t('whn_dui_4_dont1'), t('whn_dui_4_dont2')],
        tip:   t('whn_dui_4_tip') },
      { id: 5, icon: '📅', title: t('whn_dui_5_title'), timeframe: t('whn_dui_5_time'),
        what: t('whn_dui_5_what'),
        dos:   [t('whn_dui_5_do1'), t('whn_dui_5_do2'), t('whn_dui_5_do3')],
        donts: [t('whn_dui_5_dont1'), t('whn_dui_5_dont2'), t('whn_dui_5_dont3')],
        tip:   t('whn_dui_5_tip') },
    ],
  },

  'Drug Offenses': {
    label: t('whn_charge_drug'),
    color: COLORS.blue,
    bg:    COLORS.bgSubtle,
    intro: t('whn_drug_intro'),
    steps: [
      { id: 1, icon: '🚔', title: t('whn_drug_1_title'), timeframe: t('whn_drug_1_time'),
        what: t('whn_drug_1_what'),
        dos:   [t('whn_drug_1_do1'), t('whn_drug_1_do2'), t('whn_drug_1_do3')],
        donts: [t('whn_drug_1_dont1'), t('whn_drug_1_dont2'), t('whn_drug_1_dont3')],
        tip:   t('whn_drug_1_tip') },
      { id: 2, icon: '📋', title: t('whn_drug_2_title'), timeframe: t('whn_drug_2_time'),
        what: t('whn_drug_2_what'),
        dos:   [t('whn_drug_2_do1'), t('whn_drug_2_do2'), t('whn_drug_2_do3')],
        donts: [t('whn_drug_2_dont1'), t('whn_drug_2_dont2'), t('whn_drug_2_dont3')],
        tip:   t('whn_drug_2_tip') },
      { id: 3, icon: '🏛️', title: t('whn_drug_3_title'), timeframe: t('whn_drug_3_time'),
        what: t('whn_drug_3_what'),
        dos:   [t('whn_drug_3_do1'), t('whn_drug_3_do2'), t('whn_drug_3_do3')],
        donts: [t('whn_drug_3_dont1'), t('whn_drug_3_dont2')],
        tip:   t('whn_drug_3_tip') },
      { id: 4, icon: '⚖️', title: t('whn_drug_4_title'), timeframe: t('whn_drug_4_time'),
        what: t('whn_drug_4_what'),
        dos:   [t('whn_drug_4_do1'), t('whn_drug_4_do2'), t('whn_drug_4_do3')],
        donts: [t('whn_drug_4_dont1')],
        tip:   t('whn_drug_4_tip') },
      { id: 5, icon: '📅', title: t('whn_drug_5_title'), timeframe: t('whn_drug_5_time'),
        what: t('whn_drug_5_what'),
        dos:   [t('whn_drug_5_do1'), t('whn_drug_5_do2'), t('whn_drug_5_do3')],
        donts: [t('whn_drug_5_dont1'), t('whn_drug_5_dont2')],
        tip:   t('whn_drug_5_tip') },
    ],
  },

  Assault: {
    label: t('whn_charge_assault'),
    color: COLORS.warnDark,
    bg:    COLORS.warnBg,
    intro: t('whn_assault_intro'),
    steps: [
      { id: 1, icon: '🚔', title: t('whn_assault_1_title'), timeframe: t('whn_assault_1_time'),
        what: t('whn_assault_1_what'),
        dos:   [t('whn_assault_1_do1'), t('whn_assault_1_do2'), t('whn_assault_1_do3')],
        donts: [t('whn_assault_1_dont1'), t('whn_assault_1_dont2'), t('whn_assault_1_dont3')],
        tip:   t('whn_assault_1_tip') },
      { id: 2, icon: '📋', title: t('whn_assault_2_title'), timeframe: t('whn_assault_2_time'),
        what: t('whn_assault_2_what'),
        dos:   [t('whn_assault_2_do1'), t('whn_assault_2_do2'), t('whn_assault_2_do3')],
        donts: [t('whn_assault_2_dont1'), t('whn_assault_2_dont2')],
        tip:   t('whn_assault_2_tip') },
      { id: 3, icon: '🏛️', title: t('whn_assault_3_title'), timeframe: t('whn_assault_3_time'),
        what: t('whn_assault_3_what'),
        dos:   [t('whn_assault_3_do1'), t('whn_assault_3_do2'), t('whn_assault_3_do3')],
        donts: [t('whn_assault_3_dont1')],
        tip:   t('whn_assault_3_tip') },
      { id: 4, icon: '⚖️', title: t('whn_assault_4_title'), timeframe: t('whn_assault_4_time'),
        what: t('whn_assault_4_what'),
        dos:   [t('whn_assault_4_do1'), t('whn_assault_4_do2')],
        donts: [t('whn_assault_4_dont1')],
        tip:   t('whn_assault_4_tip') },
      { id: 5, icon: '📅', title: t('whn_assault_5_title'), timeframe: t('whn_assault_5_time'),
        what: t('whn_assault_5_what'),
        dos:   [t('whn_assault_5_do1'), t('whn_assault_5_do2'), t('whn_assault_5_do3')],
        donts: [t('whn_assault_5_dont1'), t('whn_assault_5_dont2')],
        tip:   t('whn_assault_5_tip') },
    ],
  },

  'General Criminal': {
    label: t('whn_charge_general'),
    color: COLORS.navy,
    bg:    COLORS.bgSubtle,
    intro: t('whn_gen_intro'),
    steps: [
      { id: 1, icon: '🚔', title: t('whn_gen_1_title'), timeframe: t('whn_gen_1_time'),
        what: t('whn_gen_1_what'),
        dos:   [t('whn_gen_1_do1'), t('whn_gen_1_do2'), t('whn_gen_1_do3')],
        donts: [t('whn_gen_1_dont1'), t('whn_gen_1_dont2'), t('whn_gen_1_dont3')],
        tip:   t('whn_gen_1_tip') },
      { id: 2, icon: '📋', title: t('whn_gen_2_title'), timeframe: t('whn_gen_2_time'),
        what: t('whn_gen_2_what'),
        dos:   [t('whn_gen_2_do1'), t('whn_gen_2_do2')],
        donts: [t('whn_gen_2_dont1'), t('whn_gen_2_dont2')],
        tip:   t('whn_gen_2_tip') },
      { id: 3, icon: '🏛️', title: t('whn_gen_3_title'), timeframe: t('whn_gen_3_time'),
        what: t('whn_gen_3_what'),
        dos:   [t('whn_gen_3_do1'), t('whn_gen_3_do2')],
        donts: [t('whn_gen_3_dont1')],
        tip:   t('whn_gen_3_tip') },
      { id: 4, icon: '⚖️', title: t('whn_gen_4_title'), timeframe: t('whn_gen_4_time'),
        what: t('whn_gen_4_what'),
        dos:   [t('whn_gen_4_do1'), t('whn_gen_4_do2')],
        donts: [t('whn_gen_4_dont1')],
        tip:   t('whn_gen_4_tip') },
      { id: 5, icon: '📅', title: t('whn_gen_5_title'), timeframe: t('whn_gen_5_time'),
        what: t('whn_gen_5_what'),
        dos:   [t('whn_gen_5_do1'), t('whn_gen_5_do2'), t('whn_gen_5_do3')],
        donts: [t('whn_gen_5_dont1'), t('whn_gen_5_dont2')],
        tip:   t('whn_gen_5_tip') },
    ],
  },
};

// Map LawyersScreen charge keys to walkthrough keys
const CHARGE_TO_WALKTHROUGH: Record<string, string> = {
  'DUI': 'DUI',
  'Drug Offenses': 'Drug Offenses',
  'Assault': 'Assault',
  'Family Law': 'General Criminal',
  'Immigration': 'General Criminal',
  '': 'General Criminal',
};

// ── Step Card ─────────────────────────────────────────────────────────────────
function StepCard({ step, color, isActive, onPress }: {
  step: Step; color: string; isActive: boolean; onPress: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: isActive ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    }).start();
  }, [isActive]);

  const maxHeight = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 600] });
  const opacity   = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });


  if (isLoading) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#042C53' }}>
      <ActivityIndicator size="large" color="#C9A84C" />
    </View>
  );

  return (
    <TouchableOpacity
      style={[styles.stepCard, isActive && { borderColor: color, borderWidth: 2 }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      {/* Step header -- always visible */}
      <View style={styles.stepHeader}>
        <View style={[styles.stepCircle, { backgroundColor: isActive ? color : COLORS.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepNum, { color: isActive ? COLORS.bgCard : COLORS.textMuted }]}>
            {step.id}
          </Text>
        </View>
        <View style={styles.stepEmoji_wrap}>
          <Text maxFontSizeMultiplier={1.4} style={styles.stepEmoji}>{step.icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.stepTitle, isActive && { color }]}>{step.title}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.stepTimeframe}>{step.timeframe}</Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.stepChevron}>{isActive ? '▲' : '▼'}</Text>
      </View>

      {/* Expandable content */}
      <Animated.View style={{ maxHeight, opacity, overflow: 'hidden' }}>
        <View style={styles.stepBody}>
          <Text maxFontSizeMultiplier={1.4} style={styles.stepWhat}>{step.what}</Text>

          <View style={styles.doBlock}>
            <Text maxFontSizeMultiplier={1.4} style={styles.doLabel}>✓  DO</Text>
            {step.dos.map(d => <Text maxFontSizeMultiplier={1.4} key={d} style={styles.doItem}>• {d}</Text>)}
          </View>

          <View style={styles.dontBlock}>
            <Text maxFontSizeMultiplier={1.4} style={styles.dontLabel}>✗  DON'T</Text>
            {step.donts.map(d => <Text maxFontSizeMultiplier={1.4} key={d} style={styles.dontItem}>• {d}</Text>)}
          </View>

          <View style={[styles.tipBlock, { borderLeftColor: color }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.tipText}>{step.tip}</Text>
          </View>

          {/* Set reminder for this step */}
          <TouchableOpacity
            accessibilityRole="button"
            style={{ flexDirection:'row', alignItems:'center', gap:6, marginTop:12,
              paddingVertical:10, paddingHorizontal:12, borderRadius:8,
              backgroundColor: color + '15', borderWidth:1, borderColor: color + '30',
              alignSelf:'flex-start' }}
            onPress={async () => {
              try {
                const { api } = require('../services/api');
                const remind = new Date();
                remind.setDate(remind.getDate() + 1);
                await api.post('/push/reminders', {
                  title: '📋 Next step: ' + step.title,
                  body: step.what?.slice(0, 80) || 'Review your case next steps.',
                  scheduled_for: remind.toISOString(),
                  notification_type: 'court_reminder',
                });
                const Alert = require('react-native').Alert;
                Alert.alert('Reminder set ✓', 'We\'ll remind you about this step tomorrow.');
              } catch { /* silent */ }
            }}
            accessibilityLabel="Set a reminder for this step"
          >
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12 }}>🔔</Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
              fontWeight:'600', color }}>
              Remind me tomorrow
            </Text>
          </TouchableOpacity>
</View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

// ── State-specific process notes ─────────────────────────────────────────────
// Shown as info cards above the step list when user's state has a notable difference.
const STATE_PROCESS_NOTES: Record<string, { title: string; body: string; color: string }> = {
  IL: {
    title: 'Illinois -- No Cash Bail',
    body: 'Illinois eliminated cash bail in September 2023 (Pretrial Fairness Act). '
        + 'Release conditions are set by a judge at a detention hearing, not a bondsman. '
        + 'You cannot pay a bondsman to secure release.',
    color: COLORS.blue,
  },
  NJ: {
    title: 'New Jersey -- No Cash Bail',
    body: 'New Jersey eliminated cash bail in 2017. A Pretrial Services Unit evaluates '
        + 'flight risk. Release conditions are set by a judge -- not a dollar amount.',
    color: COLORS.blue,
  },
  NM: {
    title: 'New Mexico -- No Cash Bail',
    body: 'New Mexico eliminated cash bail in 2016. Judges set release or detention '
        + 'conditions at a hearing within 24 hours.',
    color: COLORS.blue,
  },
  VT: {
    title: 'Vermont -- No Commercial Bail Bondsmen',
    body: 'Vermont has no commercial bail bond industry. Bail is paid directly '
        + 'to the court and returned at case conclusion. A bail commissioner '
        + 'sets conditions before court.',
    color: COLORS.navy,
  },
  CA: {
    title: 'California -- Bail & Prop 47',
    body: 'California has county-specific bail schedules. Proposition 47 reclassified '
        + 'many nonviolent drug and property offenses as misdemeanors. Zero-bail '
        + 'policies apply in some counties for specific offenses.',
    color: COLORS.warnDark,
  },
  TN: {
    title: 'Tennessee -- General Sessions Court',
    body: 'In Tennessee, a commissioner sets bail within hours of booking. '
        + 'General Sessions Court handles the preliminary hearing. '
        + 'The state uses T.C.A. § 40-7-123 for stop-and-identify.',
    color: COLORS.navy,
  },
  TX: {
    title: 'Texas -- Magistrate Appearance',
    body: 'Texas requires a magistrate appearance within 48 hours. The magistrate '
        + 'reads charges, sets bail, and informs you of rights. '
        + 'Tex. Code Crim. Proc. Art. 15.17.',
    color: COLORS.warnDark,
  },
  NY: {
    title: 'New York -- Bail Reform (2020)',
    body: 'New York eliminated cash bail for most misdemeanors and non-violent '
        + 'felonies in 2020. Arraignment must occur within 24 hours in NYC. '
        + 'Many charges qualify for release on recognizance.',
    color: COLORS.legalDark,
  },
  WA: {
    title: 'Washington -- Bail Reform',
    body: 'Washington has ongoing bail reform. Non-violent offenders are often '
        + 'released on personal recognizance. First appearance within 72 hours.',
    color: COLORS.blue,
  },
  OR: {
    title: 'Oregon -- Measure 110 & Bail Reform',
    body: 'Oregon decriminalized personal-use drug possession in 2021 (Measure 110). '
        + 'Many drug-related charges now involve diversion rather than arrest. '
        + 'Release on recognizance is common for non-violent charges.',
    color: COLORS.legalDark,
  },
};

export default function WhatHappensNextScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);


  // Load user's state for state-specific process notes
  const [processNote, setProcessNote] = React.useState<{
    title: string; body: string; color: string;
  } | null>(null);
  React.useEffect(() => {
    getUserState().then(s => {
      if (s?.code && STATE_PROCESS_NOTES[s.code]) {
        setProcessNote(STATE_PROCESS_NOTES[s.code]);
      }
    }).catch(() => {});
  }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200)
  }, []);

  const chargeKey   = (route?.params as import('../types/api').RouteParams)?.chargeType || '';
  const walkthroughKey = CHARGE_TO_WALKTHROUGH[chargeKey] || 'General Criminal';
  const data        = WALKTHROUGHS[walkthroughKey] || WALKTHROUGHS['General Criminal'];

  const [activeStep, setActiveStep] = useState(1);
  const [isLoading, setIsLoading] = React.useState(true);
  const [expandedStep, setExpandedStep] = React.useState<number | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: activeStep / data.steps.length,
      duration: 350,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
      useNativeDriver: false,
    }).start();
  }, [activeStep]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <EmergencyStrip compact={true} />
        {/* State-specific process note */}
        {processNote && (
          <View style={{ margin: 16, marginBottom: 0, borderRadius: 12, padding: 14,
            backgroundColor: processNote.color + '12',
            borderWidth: 1, borderColor: processNote.color + '30' }}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 19,
              fontWeight: '700', color: processNote.color, marginBottom: 6 }}>
              🏛️ {processNote.title}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 19,
              color: processNote.color }}>
              {processNote.body}
            </Text>
          </View>
        )}

      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: data.color }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroLabel}>{data.label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroTitle}>What Happens Next</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.heroSub}>{data.intro}</Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth, backgroundColor: data.color }]} />
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.progressLabel}>Step {activeStep} of {data.steps.length}</Text>
      </View>

      {/* Step cards */}
      {data.steps.map(step => (
        <StepCard
          key={step.id}
          step={step}
          color={data.color}
          isActive={activeStep === step.id}
          onPress={() => setActiveStep(step.id === activeStep ? 0 : step.id)}
        />
      ))}

      {/* Navigation buttons */}
      <View style={styles.navRow}>
        {activeStep > 1 && (
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnSecondary]}
            onPress={() => setActiveStep(s => Math.max(1, s - 1))}
          accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.navBtnSecondaryText}>← Previous</Text>
          </TouchableOpacity>
        )}
        {activeStep < data.steps.length ? (
          <TouchableOpacity
            style={[styles.navBtn, { backgroundColor: data.color, flex: 2 }]}
          accessibilityRole="button"
            onPress={() => setActiveStep(s => Math.min(data.steps.length, s + 1))}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.navBtnText}>Next Step →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.navBtn, { backgroundColor: COLORS.legal, flex: 2 }]}
            onPress={() => navigation.navigate('LawyersTab')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.navBtnText}>Find a Lawyer Now →</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom CTAs */}
      <View style={styles.ctaRow}>
        <TouchableOpacity
          style={styles.ctaCard}
          onPress={() => navigation.navigate('MoreTab', { screen: 'HelpNow' })}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaIcon}>🚨</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaLabel}>HELP NOW</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaSub}>Bail + Lawyer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.ctaCard}
          onPress={() => navigation.navigate('ChatTab')}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaIcon}>💬</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaLabel}>AI Help</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaSub}>Ask a question</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.ctaCard}
          onPress={() => navigation.navigate('MoreTab', { screen: 'Education' })}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaIcon}>📚</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaLabel}>Know Rights</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.ctaSub}>All lessons</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.warn,
        padding:12, marginTop:12, marginBottom:8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:'#555', fontStyle:'italic', lineHeight:16 }}>
          ⚖️ This guide describes the general criminal justice process. Timelines and
          procedures vary significantly by state, county, and judge. This is general
          information only -- not legal advice.
        </Text>
      </View>

      {/* Empty state */}
      {(data as any)?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📝</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>Content loading...</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection and try again.</Text>
        </View>
      )}
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 0 },

  hero: { padding: 24, paddingTop: 32, paddingBottom: 28 },
  heroLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', ...FONTS.black, letterSpacing: 1.5, marginBottom: 6, textTransform: 'uppercase' },
  heroTitle: { fontSize: 28, ...FONTS.black, color: COLORS.bgCard, marginBottom: 8 },
  heroSub:   { fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 19 },

  progressWrap:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8, backgroundColor: COLORS.bgCard, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  progressTrack: { flex: 1, height: 6, backgroundColor: COLORS.border, borderRadius: 4, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 4 },
  progressLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semi },

  stepCard: {
    backgroundColor: COLORS.bgCard, marginHorizontal: 12, marginTop: 10,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
    overflow: 'hidden',
  },
  stepHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10 },
  stepCircle: { width: 30, height: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNum:    { fontSize: 14, lineHeight: 21, ...FONTS.black },
  stepEmoji_wrap: { width: 32, alignItems: 'center', flexShrink: 0 },
  stepEmoji:  { fontSize: 20 },
  stepTitle:  { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.textPrimary },
  stepTimeframe: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  stepChevron: { fontSize: 12, color: COLORS.textMuted },

  stepBody: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4 },
  stepWhat: { fontSize: 12, color: COLORS.textSecond, lineHeight: 20, marginBottom: 12 },

  doBlock:   { backgroundColor: COLORS.legalBg, borderRadius: RADIUS.md, padding: 10, marginBottom: 8 },
  doLabel:   { fontSize: 11, ...FONTS.black, color: COLORS.legal, marginBottom: 5, letterSpacing: 0.5 },
  doItem:    { fontSize: 12, color: colors.legal, lineHeight: 18 },

  dontBlock:  { backgroundColor: COLORS.emergencyBg, borderRadius: RADIUS.md, padding: 10, marginBottom: 8 },
  dontLabel:  { fontSize: 11, ...FONTS.black, color: COLORS.emergency, marginBottom: 5, letterSpacing: 0.5 },
  dontItem:   { fontSize: 12, color: '#EF5350', lineHeight: 18 },

  tipBlock: { borderLeftWidth: 3, paddingLeft: 10, marginTop: 4 },
  tipText:  { fontSize: 12, color: COLORS.textSecond, lineHeight: 17, fontStyle: 'italic' },

  navRow: { flexDirection: 'row', gap: 8, padding: 16, paddingTop: 18 },
  navBtn: { flex: 1, paddingVertical: 16, borderRadius: RADIUS.lg, alignItems: 'center', ...SHADOW.sm },
  navBtnSecondary:     { flex: 1, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.bgCard },
  navBtnSecondaryText: { color: COLORS.textSecond, ...FONTS.semi, fontSize: 14,
    lineHeight: 21, },
  navBtnText:          { color: COLORS.bgCard, ...FONTS.black, fontSize: 15,
    lineHeight: 22, },

  ctaRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginTop: 4 },
  ctaCard: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  ctaIcon:  { fontSize: 22, marginBottom: 4 },
  ctaLabel: { fontSize: 12, ...FONTS.heavy, color: COLORS.navy },
  ctaSub:   { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
