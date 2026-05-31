import UPLDisclaimer from '../components/UPLDisclaimer';
import { MotionTypeBadge } from '../components/MotionTypeBadge';
import Analytics from '../services/analytics';
import { ScreenCapture, hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
/**
 * MotionLibraryScreen -- AI motion template generator
 *
 * Design direction: editorial precision -- this is a professional tool
 * used by attorneys filing real court documents. Clean grids, tight
 * typography, no decoration that distracts from the task. Feels like
 * a well-designed legal software product, not a consumer app.
 *
 * The tension: it costs $9.99 per motion. The price must feel like
 * nothing compared to the 1-3 hours it saves. The UX communicates
 * that value before the paywall appears.
 *
 * Flow:
 *   Library → Select motion type → Fill fields (smart form)
 *   → Review & Pay ($9.99) → Generated draft (full text)
 *   → Edit → Copy / Share → History
 *
 * Entry points:
 *   1. CaseScreen → "Motions" tab (primary -- pre-fills case data)
 *   2. Direct navigation (standalone use)
 */
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Linking, Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Alert, Clipboard, KeyboardAvoidingView, Platform, Animated, Share } from 'react-native';
import { api }         from '../services/api';
import { pollJob } from '../services/jobPoller';
import { cacheMotions, markOnline } from '../services/offlineCache';
import { getUserState } from '../utils/userState';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import LegalDisclaimerModal, { hasValidConsent } from '../components/LegalDisclaimerModal';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';

declare var copyTimer: any;
declare var histFilter: any;
declare var historyFilter: any;
declare var historySearch: any;
declare var load: any;
declare var refreshing: any;
declare var selectedType: any;
declare var setHistFilter: any;
declare var setRefreshing: any;
declare var reviewDraft: any; // hoisted from component scope
declare var reviewResult: any; // hoisted from component scope
declare var reviewing: any; // hoisted from component scope
// ── Motion type definitions (mirrors backend) ─────────────────────────────────
// ── Trial-stage motions ───────────────────────────────────────────────────────
const TRIAL_MOTIONS = [
  { key: 'suppress',         label: 'Motion to Suppress',        icon: '🛡️', color: COLORS.emergencyDark, bg: COLORS.emergencyBg,
    desc: 'Challenge illegally obtained evidence. 4th Amendment.' },
  { key: 'bail_reduction',   label: 'Motion for Bail Reduction',  icon: '🔓', color: COLORS.blue, bg: COLORS.bgSubtle,
    desc: 'Argue for lower bail or release on recognizance.' },
  { key: 'continuance',      label: 'Motion for Continuance',     icon: '📅', color: COLORS.warnDark, bg: COLORS.warnBg,
    desc: 'Request additional time to prepare the defense.' },
  { key: 'dismiss',          label: 'Motion to Dismiss',          icon: '⚖️', color: COLORS.blue, bg: COLORS.bgSubtle,
    desc: 'Seek dismissal on speedy trial, evidence, or jurisdiction grounds.' },
  { key: 'discovery',        label: 'Motion for Discovery',       icon: '📋', color: COLORS.legalDark, bg: COLORS.legalBg,
    desc: 'Compel prosecution to disclose Brady material and evidence.' },
  { key: 'limine',           label: 'Motion in Limine',           icon: '🚫', color: COLORS.textSecond, bg: COLORS.bgSubtle,
    desc: 'Exclude prejudicial evidence before trial begins.' },
  { key: 'speedy_trial',     label: 'Motion for Speedy Trial',    icon: '⏱️', color: COLORS.blue, bg: COLORS.bgSubtle,
    desc: 'Assert the 6th Amendment right to a speedy trial.' },
  { key: 'compel',           label: 'Motion to Compel',           icon: '📌', color: COLORS.legalDark, bg: COLORS.legalBg,
    desc: 'Force prosecution to comply with outstanding discovery requests.' },
];

// ── Appeal and post-conviction motions ─────────────────────────────────────────
const APPEAL_MOTIONS = [
  { key: 'notice_of_appeal', label: 'Notice of Appeal',           icon: '📣', color: COLORS.emergencyDark, bg: COLORS.emergencyBg,
    desc: 'Preserve appellate rights. Federal: 14 days. Most states: 30 days.',
    deadline: true },
  { key: 'appeal_brief',     label: 'Appellate Brief',            icon: '📜', color: COLORS.navy, bg: COLORS.bgSubtle,
    desc: 'Full substantive brief arguing grounds for reversal of conviction or sentence.' },
  { key: 'sentence_reduction',label: 'Motion to Reduce Sentence', icon: '🕊️', color: COLORS.legalDark, bg: COLORS.legalBg,
    desc: 'Post-conviction sentence modification, compassionate release, or First Step Act.' },
  { key: 'habeas_corpus',    label: 'Petition for Habeas Corpus', icon: '⚖️', color: COLORS.blue, bg: COLORS.bgSubtle,
    desc: 'Collateral attack on unlawful detention. Strickland, Brady, actual innocence.',
    deadline: true },
];

// Combined for backwards compatibility
const MOTION_TYPES = [...TRIAL_MOTIONS, ...APPEAL_MOTIONS];

// ── Field definitions per motion type ────────────────────────────────────────
const FIELD_DEFS: Record<string, { key: string; label: string; placeholder: string; multiline?: boolean }[]> = {
  suppress: [
    { key: 'defendant_name',       label: 'Defendant name',                  placeholder: 'John Smith' },
    { key: 'case_number',          label: 'Case number',                     placeholder: 'CR-2025-00123' },
    { key: 'court_name',           label: 'Court',                           placeholder: 'Shelby County Criminal Court' },
    { key: 'state',                label: 'State',                           placeholder: 'Tennessee' },
    { key: 'charge',               label: 'Charge(s)',                       placeholder: 'DUI, Possession of Controlled Substance' },
    { key: 'amendment_theory',     label: 'Constitutional theory',           placeholder: '4th Amendment -- unlawful search and seizure' },
    { key: 'specific_violation',   label: 'Specific violation',              placeholder: 'No reasonable suspicion for the initial traffic stop -- officer admitted he saw no moving violation and only stopped vehicle because of neighborhood' },
    { key: 'fruit_of_poisonous_tree', label: 'Fruit of the poisonous tree?', placeholder: 'Yes -- all evidence recovered after the unlawful stop (controlled substance, breathalyzer result) must be suppressed as derivative evidence. No independent source or inevitable discovery exception applies.' },
    { key: 'good_faith_exception', label: 'Does prosecution claim good faith exception (Leon)?', placeholder: 'No warrant was obtained, so Leon does not apply. If prosecution argues Leon, counter: no reasonably well-trained officer could have relied on a bare-bones stop without articulable suspicion.' },
    { key: 'search_date',          label: 'Date of search/stop',             placeholder: 'March 10, 2025' },
    { key: 'search_location',      label: 'Location of search',              placeholder: 'Interstate 40 westbound, Memphis, TN' },
    { key: 'officer_name',         label: 'Officer name/badge',              placeholder: 'Officer J. Rodriguez, Badge #4421' },
    { key: 'grounds',           label: 'Grounds for suppression', placeholder: 'No probable cause -- officer lacked reasonable suspicion for the stop', multiline: true },
  ],
  bail_reduction: [
    { key: 'defendant_name',       label: 'Defendant name',              placeholder: 'John Smith' },
    { key: 'case_number',          label: 'Case number',                 placeholder: 'CR-2025-00123' },
    { key: 'court_name',           label: 'Court',                       placeholder: 'Davidson County Criminal Court' },
    { key: 'state',                label: 'State',                       placeholder: 'Tennessee' },
    { key: 'charge',               label: 'Charge(s)',                   placeholder: 'Aggravated Assault' },
    { key: 'current_bail',         label: 'Current bail amount',         placeholder: '$50,000' },
    { key: 'length_in_custody',    label: 'Time in custody to date',     placeholder: '47 days as of filing date' },
    { key: 'ability_to_pay',       label: 'Ability to pay current bail', placeholder: 'Cannot meet current bail -- monthly income $2,800, no savings; family unable to contribute more than $2,000' },
    { key: 'community_ties',       label: 'Community ties',              placeholder: '15-year resident, owns home, family in Nashville', multiline: true },
    { key: 'employment',           label: 'Employment',                  placeholder: 'Employed full-time at ABC Construction for 8 years; employer confirms position held' },
    { key: 'prior_record',         label: 'Prior record',                placeholder: 'No prior felony convictions, one misdemeanor 2018' },
    { key: 'travel_documents',     label: 'Passport / travel documents', placeholder: 'No passport; has never traveled outside Tennessee; surrenders all travel documents' },
    { key: 'voluntary_surrender',  label: 'Surrender / cooperation',     placeholder: 'Defendant surrendered voluntarily on March 10, 2025; fully cooperative with booking' },
    { key: 'other_pending_charges',label: 'Other pending charges',       placeholder: 'None' },
    { key: 'proposed_bail',        label: 'Proposed bail / ROR',         placeholder: '$5,000 or release on own recognizance with electronic monitoring' },
  ],
  continuance: [
    { key: 'defendant_name',    label: 'Defendant name',      placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Case number',         placeholder: 'CR-2025-00123' },
    { key: 'court_name',        label: 'Court',               placeholder: 'Knox County Criminal Court' },
    { key: 'state',             label: 'State',               placeholder: 'Tennessee' },
    { key: 'hearing_date',      label: 'Current hearing date',placeholder: 'April 15, 2025' },
    { key: 'reason',            label: 'Reason for continuance', placeholder: 'New forensic evidence received March 28 requires expert review', multiline: true },
    { key: 'requested_new_date',label: 'Proposed new date',   placeholder: 'Any date after May 15, 2025' },
  ],
  dismiss: [
    { key: 'defendant_name',    label: 'Defendant name',      placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Case number',         placeholder: 'CR-2025-00123' },
    { key: 'court_name',        label: 'Court',               placeholder: 'Hamilton County Criminal Court' },
    { key: 'state',             label: 'State',               placeholder: 'Tennessee' },
    { key: 'charge',            label: 'Charge(s)',           placeholder: 'Drug Possession' },
    { key: 'grounds',           label: 'Grounds for dismissal', placeholder: 'Speedy trial violation -- 270 days elapsed since arrest with no trial date set', multiline: true },
  ],
  discovery: [
    { key: 'defendant_name',    label: 'Defendant name',      placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Case number',         placeholder: 'CR-2025-00123' },
    { key: 'court_name',        label: 'Court',               placeholder: 'Shelby County Criminal Court' },
    { key: 'state',             label: 'State',               placeholder: 'Tennessee' },
    { key: 'charge',            label: 'Charge(s)',           placeholder: 'Armed Robbery' },
    { key: 'items_requested',   label: 'Items to be disclosed', placeholder: 'All body camera footage, witness statements, lab reports, informant identity', multiline: true },
  ],
  limine: [
    { key: 'defendant_name',    label: 'Defendant name',      placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Case number',         placeholder: 'CR-2025-00123' },
    { key: 'court_name',        label: 'Court',               placeholder: 'Davidson County Criminal Court' },
    { key: 'state',             label: 'State',               placeholder: 'Tennessee' },
    { key: 'charge',            label: 'Charge(s)',           placeholder: 'Assault' },
    { key: 'evidence_to_exclude', label: 'Evidence to exclude', placeholder: "Defendant's 2018 prior conviction for unrelated offense", multiline: true },
    { key: 'grounds',           label: 'Grounds',             placeholder: 'Unfair prejudice substantially outweighs probative value under FRE 403', multiline: true },
  ],
  speedy_trial: [
    { key: 'defendant_name',       label: 'Defendant name',                placeholder: 'John Smith' },
    { key: 'case_number',          label: 'Case number',                   placeholder: 'CR-2025-00123' },
    { key: 'court_name',           label: 'Court',                         placeholder: 'Knox County Criminal Court' },
    { key: 'state',                label: 'State',                         placeholder: 'Tennessee' },
    { key: 'charge',               label: 'Charge(s)',                     placeholder: 'Theft' },
    { key: 'arrest_date',          label: 'Arrest date',                   placeholder: 'June 1, 2024' },
    { key: 'current_date',         label: 'Current date',                  placeholder: 'March 28, 2025' },
    { key: 'delays_caused_by',     label: 'Reason for delay (by whom)',    placeholder: 'Prosecution requested 3 continuances totaling 210 days; no legitimate reason given', multiline: true },
    { key: 'date_right_asserted',  label: 'Date defendant asserted the speedy trial right', placeholder: 'September 15, 2024 -- written demand filed with clerk; copy attached as Exhibit A' },
    { key: 'prejudice_to_defendant', label: 'Prejudice to defendant (Barker factor 4)', placeholder: 'Defendant has been incarcerated 300 days causing loss of employment; key alibi witness relocated and cannot be located; anxiety and stress from prolonged proceedings', multiline: true },
  ],
  compel: [
    { key: 'defendant_name',    label: 'Defendant name',      placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Case number',         placeholder: 'CR-2025-00123' },
    { key: 'court_name',        label: 'Court',               placeholder: 'Shelby County Criminal Court' },
    { key: 'state',             label: 'State',               placeholder: 'Tennessee' },
    { key: 'charge',            label: 'Charge(s)',           placeholder: 'Drug Trafficking' },
    { key: 'items_withheld',    label: 'Items withheld by prosecution', placeholder: 'CI identity, recorded conversations, lab analysis', multiline: true },
    { key: 'request_date',      label: 'Date discovery was requested', placeholder: 'January 15, 2025' },
  ],

  // ── Appeal and post-conviction field definitions ─────────────────────────
  notice_of_appeal: [
    { key: 'defendant_name',    label: 'Defendant / Appellant name', placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Trial court case number',    placeholder: 'CR-2025-00123' },
    { key: 'trial_court',       label: 'Trial court name',           placeholder: 'Shelby County Criminal Court, Division III' },
    { key: 'appellate_court',   label: 'Appellate court',            placeholder: 'Court of Criminal Appeals of Tennessee' },
    { key: 'state',             label: 'State / Jurisdiction',       placeholder: 'Tennessee' },
    { key: 'conviction_date',   label: 'Date of conviction / verdict', placeholder: 'March 14, 2025' },
    { key: 'judgment_date',     label: 'Date judgment was entered',  placeholder: 'March 21, 2025 -- THIS IS YOUR DEADLINE TRIGGER' },
    { key: 'sentence',          label: 'Sentence imposed',           placeholder: '8 years TDOC -- count 1; 2 years probation -- count 2' },
    { key: 'grounds_preview',   label: 'Preliminary grounds (brief -- full brief comes later)', placeholder: 'Insufficient evidence; improper jury instruction on mens rea; 4th Amendment suppression denied in error', multiline: true },
    { key: 'counsel_name',      label: 'Appellate counsel name',     placeholder: 'Jane A. Doe, Esq.' },
    { key: 'counsel_bar_number',label: 'Bar number',                 placeholder: 'TN Bar No. 012345' },
  ],

  appeal_brief: [
    { key: 'defendant_name',    label: 'Appellant name',             placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Appellate case number',      placeholder: 'M2025-00456-CCA-R3-CD' },
    { key: 'appellate_court',   label: 'Appellate court',            placeholder: 'Court of Criminal Appeals of Tennessee, Middle Section' },
    { key: 'trial_court_name',  label: 'Trial court',                placeholder: 'Davidson County Criminal Court, Division II' },
    { key: 'state',             label: 'State / Jurisdiction',       placeholder: 'Tennessee' },
    { key: 'conviction',        label: 'Conviction(s)',              placeholder: 'Aggravated Assault (Class C Felony); Reckless Endangerment' },
    { key: 'sentence',          label: 'Sentence',                   placeholder: '6 years at 30%; consecutive' },
    { key: 'standard_of_review',label: 'Standard of review for primary issue', placeholder: 'De novo -- pure question of law regarding jury instruction; abuse of discretion -- evidentiary ruling', multiline: true },
    { key: 'grounds_for_reversal', label: 'Grounds for reversal (each issue on a new line)', placeholder: '1. Jury instruction on self-defense was constitutionally deficient\n2. Trial court abused discretion admitting prior bad acts under TRE 404(b)\n3. Evidence insufficient to support aggravated assault conviction', multiline: true },
    { key: 'key_facts',         label: 'Key facts for the record',   placeholder: 'Defendant acted in self-defense after victim made threatening advance. No prior criminal record. Three eyewitnesses corroborate defendant\'s account.', multiline: true },
    { key: 'preserved_objections', label: 'Objections preserved at trial', placeholder: 'Obj. to 404(b) evidence at T.Tr. 142:3; obj. to jury instruction at T.Tr. 298:17', multiline: true },
    { key: 'relief_requested',  label: 'Relief requested',           placeholder: 'Reverse conviction and remand for new trial; alternatively, reduce to lesser-included offense', multiline: true },
  ],

  sentence_reduction: [
    { key: 'defendant_name',    label: 'Defendant name',             placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Case number',                placeholder: 'CR-2020-00456' },
    { key: 'court_name',        label: 'Court',                      placeholder: 'U.S. District Court, M.D. Tennessee' },
    { key: 'state',             label: 'State / Jurisdiction',       placeholder: 'Tennessee (Federal)' },
    { key: 'conviction',        label: 'Conviction',                 placeholder: '21 U.S.C. § 841(a)(1) -- Distribution of a Controlled Substance' },
    { key: 'original_sentence', label: 'Original sentence',         placeholder: '120 months -- mandatory minimum' },
    { key: 'time_served',       label: 'Time served to date',        placeholder: '84 months (7 years) as of filing date' },
    { key: 'grounds',           label: 'Grounds for reduction',      placeholder: 'First Step Act -- retroactive application of Fair Sentencing Act; Amendment 782 retroactivity', multiline: true },
    { key: 'rehabilitation',    label: 'Rehabilitation evidence',    placeholder: 'GED earned 2022; completed 1,200 hours vocational training; no disciplinary infractions in 4 years; mentor program participant', multiline: true },
    { key: 'family_circumstances', label: 'Family / community circumstances', placeholder: 'Sole surviving parent of two minor children (ages 8 and 11) currently in foster care', multiline: true },
    { key: 'community_support', label: 'Community support letters',  placeholder: 'Letters from pastor, former employer, and family members attached as Exhibit A' },
    { key: 'proposed_sentence', label: 'Proposed reduced sentence',  placeholder: 'Time served, or 84 months -- within revised guideline range of 70-87 months' },
  ],

  habeas_corpus: [
    { key: 'petitioner_name',   label: 'Petitioner name',            placeholder: 'John Smith' },
    { key: 'case_number',       label: 'Habeas case number (if assigned)', placeholder: 'Leave blank if new filing' },
    { key: 'court',             label: 'Court filing in',            placeholder: 'U.S. District Court, W.D. Tennessee' },
    { key: 'state',             label: 'State',                      placeholder: 'Tennessee' },
    { key: 'conviction_date',   label: 'Date conviction became final', placeholder: 'June 15, 2024 (cert. denied by Tenn. Supreme Court)' },
    { key: 'sentence',          label: 'Sentence',                   placeholder: 'Life without possibility of parole' },
    { key: 'current_custodian', label: 'Respondent / custodian',     placeholder: 'Warden James T. Riley, Riverbend Maximum Security Institution' },
    { key: 'constitutional_violation', label: 'Constitutional violation(s)', placeholder: '6th Amendment -- ineffective assistance of counsel (Strickland); 14th Amendment -- Brady violation', multiline: true },
    { key: 'grounds',           label: 'Detailed grounds',           placeholder: 'Trial counsel failed to investigate alibi witnesses known before trial. Three witnesses would have placed petitioner 40 miles from the crime scene. Counsel made no investigation and presented no alibi defense.', multiline: true },
    { key: 'prior_appeals',     label: 'Prior state court proceedings', placeholder: 'Direct appeal -- Tenn. Ct. Crim. App. 2022 (affirmed); TPCA petition -- Davidson Co. dismissed 2024', multiline: true },
    { key: 'exhaustion_of_remedies', label: 'State remedies exhausted', placeholder: 'All claims presented to Tennessee Court of Criminal Appeals and Tennessee Supreme Court. No further state remedies available.', multiline: true },
    { key: 'timeliness_explanation', label: 'AEDPA timeliness (1-year limit)', placeholder: 'Petition filed within one year of conviction becoming final on June 15, 2024. Filing date: June 10, 2025.', multiline: true },
  ] };

type Phase = 'library' | 'form' | 'confirm' | 'generating' | 'result' | 'history';

// ── Filing status config ──────────────────────────────────────────────────────
const FILING_STATUS = {
  draft:   { label: 'Draft',   color: COLORS.textMuted, bg: COLORS.bgSubtle, icon: '✏️' },
  filed:   { label: 'Filed',   color: COLORS.blue, bg: COLORS.bgSubtle, icon: '📬' },
  granted: { label: 'Granted', color: COLORS.legalDark, bg: COLORS.legalBg, icon: '✅' },
  denied:  { label: 'Denied',  color: COLORS.emergencyDark, bg: COLORS.emergencyBg, icon: '✕'  },
  pending: { label: 'Pending', color: COLORS.warnDark, bg: COLORS.warnBg, icon: '⏳' } } as const;
type FilingStatus = keyof typeof FILING_STATUS;

// ── Motion type card ──────────────────────────────────────────────────────────
function MotionCard({ m, onPress, onReview, reviewing }: { m: typeof MOTION_TYPES[0]; onPress: () => void; onReview?: () => void; reviewing?: boolean }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start(() => onPress());
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], width: '48%' }}>
              {/* AI Review button */}
              <TouchableOpacity
  accessibilityRole="button"
                style={{ flexDirection:'row', alignItems:'center', gap:8, paddingVertical:12,
                  paddingHorizontal:16, borderRadius:10, borderWidth:1,
                  borderColor:COLORS.border, backgroundColor:COLORS.bgSubtle,
                  marginBottom:8 }}
                onPress={onReview || (() => {})}
                disabled={reviewing}
                accessibilityLabel="Run AI review of this motion draft"
              >
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize:16 }}>🔍</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                  fontWeight:'700', color:COLORS.textPrimary }}>
                  {reviewing ? 'Reviewing…' : 'AI Review Draft'}
                </Text>
              </TouchableOpacity>

              {/* Review results */}
              {reviewResult && (
                <View style={{ borderRadius:10, padding:14, marginBottom:8,
                  backgroundColor:
                    reviewResult.score==='pass' ? COLORS.legalBg :
                    reviewResult.score==='fail' ? COLORS.emergencyBg : COLORS.warnBg,
                  borderWidth:1,
                  borderColor:
                    reviewResult.score==='pass' ? COLORS.legalDark :
                    reviewResult.score==='fail' ? COLORS.emergencyDark : COLORS.warnDark }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                    fontWeight:'700', marginBottom:6,
                    color:
                      reviewResult.score==='pass' ? COLORS.legalDark :
                      reviewResult.score==='fail' ? COLORS.emergencyDark : COLORS.warnDark }}>
                    {reviewResult.score==='pass' ? '✅ Looks good' :
                     reviewResult.score==='fail' ? '❌ Issues found' : '⚠️ Minor issues'}
                  </Text>
                  {reviewResult.missing_fields?.length > 0 && (
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
                      color:COLORS.emergencyDark, marginBottom:4 }}>
                      Missing: {reviewResult.missing_fields.join(', ')}
                    </Text>
                  )}
                  {reviewResult.issues?.map((issue, i) => (
                    <Text key={i} maxFontSizeMultiplier={1.4} style={{ fontSize:12,
                      lineHeight:18, color:COLORS.warnDark, marginBottom:2 }}>
                      • {issue}
                    </Text>
                  ))}
                  {reviewResult.suggestions?.length > 0 && (
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:12, lineHeight:18,
                      color:COLORS.blue, marginTop:4 }}>
                      💡 {reviewResult.suggestions[0]}
                    </Text>
                  )}
                </View>
              )}

<TouchableOpacity accessibilityRole="button"
        style={[styles.motionCard, { backgroundColor: m.bg, borderColor: m.color + '44' }]}
        onPress={handlePress}
        activeOpacity={1}
        accessibilityLabel={`${m.label} -- ${m.desc}`}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.motionIcon}>{m.icon}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.motionLabel, { color: m.color }]}>{m.label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.motionDesc,  { color: COLORS.textMuted }]}>{m.desc}</Text>
        <View style={[styles.motionPrice, { backgroundColor: m.color }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.motionPriceText}>$9.99</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── History item ──────────────────────────────────────────────────────────────
function HistoryItem({ item, onOpen, onDelete, onStatusChange }: any) {
  const { colors, isDark } = useTheme();
  const m = MOTION_TYPES.find(t => t.key === item.motion_type);
  const [showPicker, setShowPicker] = useState(false);
  const [status, setStatus] = useState<FilingStatus>(item.filing_status || 'draft');
  const [updating, setUpdating] = useState(false);

  const cfg = FILING_STATUS[status] || FILING_STATUS.draft;

  const changeStatus = async (s: FilingStatus) => {
    setShowPicker(false);
    if (s === status) return;
    setUpdating(true);
    try {
      await api.patch(`/motions/${item.id}/status`, { status: s });
      setStatus(s);
      onStatusChange?.(item.id, s);
    } catch {
      Alert.alert('Could not update status', 'Check your connection and try again.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <View style={[styles.historyRow, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}
      testID="motion-library-screen">
      {/* Open motion */}
      <TouchableOpacity
  accessibilityRole="button"
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
        accessibilityLabel="{m?.icon || '\ud83d\udcc4'}" onPress={() => onOpen(item)}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.historyIcon}>{m?.icon || '📄'}</Text>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.historyLabel, { color: COLORS.textPrimary }]} numberOfLines={1}>
            {m?.label || item.motion_type}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.historyDate, { color: COLORS.textMuted }]}>
            {new Date(item.created_at ?? 0).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
            {item.filed_at && status === 'filed'
              ? ` · Filed ${new Date(item.filed_at).toLocaleDateString('en-US', { month:'short', day:'numeric' })}`
              : ''}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Status badge -- tappable */}
      <TouchableOpacity accessibilityRole="button"
        style={[styles.statusBadgeBtn, { backgroundColor: cfg.bg, borderColor: cfg.color + '60' }]}
        onPress={() => setShowPicker(p => !p)}
        disabled={updating}
        accessibilityLabel={`Filing status: ${cfg.label}. Tap to change.`}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.statusBadgeText, { color: cfg.color }]}>
          {updating ? '…' : `${cfg.icon} ${cfg.label}`}
        </Text>
      </TouchableOpacity>

      {/* Delete */}
      <TouchableOpacity accessibilityRole="button"
        onPress={() => onDelete(item.id)}
        style={styles.historyDelete}
        accessibilityLabel="Delete motion"
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.textMuted, fontSize: 16 }}>✕</Text>
      </TouchableOpacity>

      {/* Status picker dropdown */}
      {showPicker && (
        <View style={[styles.statusPicker, {
          backgroundColor: COLORS.bgCard,
          borderColor: COLORS.border,
          shadowColor: COLORS.bg,
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 6 }]}>
          {(Object.entries(FILING_STATUS) as [FilingStatus, typeof FILING_STATUS[FilingStatus]][]).map(([key, cfg]) => (
            <TouchableOpacity accessibilityRole="button"
              key={key}
              style={[styles.statusPickerRow,
                key === status && { backgroundColor: cfg.bg }]}
              onPress={() => changeStatus(key)}
              accessibilityLabel={`Mark as ${cfg.label}`}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 14, lineHeight: 21, marginRight: 8 }}>{cfg.icon}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.statusPickerLabel, { color: key === status ? cfg.color : COLORS.textPrimary, fontWeight: key === status ? '700' : '400' }]}>
                {cfg.label}
              </Text>
              {key === status && <Text maxFontSizeMultiplier={1.4} style={[{ marginLeft: 'auto', color: cfg.color }]}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

// ── Charge-to-motion relevance map ───────────────────────────────────────────
// Maps charge keywords to the motion types most relevant for that charge.
// Used to sort/highlight motions when the user has a case with known charges.
const CHARGE_MOTION_MAP: Record<string, string[]> = {
  // DUI / DWI
  dui:         ['Motion to Suppress','Motion for Discovery','Motion for Continuance','Motion to Dismiss'],
  dwi:         ['Motion to Suppress','Motion for Discovery','Motion for Continuance','Motion to Dismiss'],
  drunk:       ['Motion to Suppress','Motion for Discovery'],
  alcohol:     ['Motion to Suppress','Motion for Discovery'],
  breathalyzer:['Motion to Suppress','Motion to Exclude Expert Testimony'],

  // Drug offenses
  drug:        ['Motion to Suppress','Motion for Discovery','Motion to Dismiss','Motion for Diversion'],
  narcotics:   ['Motion to Suppress','Motion for Discovery','Motion to Dismiss'],
  possession:  ['Motion to Suppress','Motion for Discovery','Motion to Dismiss'],
  trafficking: ['Motion to Suppress','Motion for Bail Reduction','Motion for Discovery'],
  marijuana:   ['Motion to Suppress','Motion to Dismiss','Motion for Discovery'],
  controlled:  ['Motion to Suppress','Motion for Discovery'],

  // Assault / Violence
  assault:     ['Motion for Discovery','Motion in Limine','Motion for Continuance'],
  battery:     ['Motion for Discovery','Motion in Limine'],
  domestic:    ['Motion for Discovery','Motion in Limine','Motion to Suppress'],
  violent:     ['Motion for Bail Reduction','Motion for Discovery'],

  // Theft / Property
  theft:       ['Motion for Discovery','Motion in Limine','Motion to Dismiss'],
  burglary:    ['Motion to Suppress','Motion for Discovery','Motion for Bail Reduction'],
  robbery:     ['Motion to Suppress','Motion for Discovery','Motion for Bail Reduction'],
  shoplifting: ['Motion to Dismiss','Motion for Discovery','Motion for Diversion'],
  fraud:       ['Motion for Discovery','Motion in Limine','Motion to Dismiss'],

  // Weapons
  weapon:      ['Motion to Suppress','Motion for Discovery','Motion to Dismiss'],
  firearm:     ['Motion to Suppress','Motion for Discovery'],
  gun:         ['Motion to Suppress','Motion for Discovery'],

  // Traffic / Driving
  traffic:     ['Motion to Dismiss','Motion for Discovery','Motion for Continuance'],
  reckless:    ['Motion to Dismiss','Motion for Discovery'],
  speeding:    ['Motion to Dismiss','Motion for Discovery'],

  // General
  felony:      ['Motion for Bail Reduction','Motion for Discovery','Motion for Continuance'],
  misdemeanor: ['Motion to Dismiss','Motion for Diversion','Motion for Continuance'] };

function getRelevantMotions(charges: string | null): string[] {
  if (!charges) return [];
  const lower = charges.toLowerCase();
  const relevant = new Set<string>();
  for (const [keyword, motions] of Object.entries(CHARGE_MOTION_MAP)) {
    if (lower.includes(keyword)) {
      motions.forEach(m => relevant.add(m));
    }
  }
  return [...relevant];
}

export default function MotionLibraryScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const userStateRef = React.useRef<string>('');
  React.useEffect(() => {
    getUserState().then((s: any) => { if (s?.code) userStateRef.current = s.code; }).catch(() => {});
  }, []);

  // AI motion review pass
  const reviewDraft = async () => {
    setReviewing(true);
    setReviewResult(null);
    try {
      const res = await api.post('/motions/review', {
        draft:       editDraft.trim(),
        motion_type: selected?.label || '',
        state:       userStateRef?.current || '' });
      setReviewResult(res.data || null);
    } catch {
      setReviewResult({ score:'warn', issues:['Review unavailable. Check your connection.'],
        suggestions:[], missing_fields:[] });
    } finally {
      setReviewing(false);
    }
  };

  const { gated, unlocking, unlock } = useBiometricGate('motion_library');

  // Receive charges from CaseScreen for charge-aware filtering
  const incomingCharges = (route?.params as import('../types/api').RouteParams)?.charges || null;
  const relevantMotions = React.useMemo(
    () => getRelevantMotions(incomingCharges),
    [incomingCharges]
  );

  // Prevent screenshots on this sensitive screen (Android FLAG_SECURE + iOS)
  React.useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
  }, []);

  // ── Consent gate ──────────────────────────────────────────────────────────
  const [disclaimerVisible, setDisclaimerVisible] = React.useState(false);
  const [consentGranted, setConsentGranted] = React.useState(false);

  React.useEffect(() => {
    hasValidConsent().then(ok => {
      if (!ok) setDisclaimerVisible(true);
      else setConsentGranted(true);
    }).catch(() => {});
  }, []);

  const onConsentAccepted = React.useCallback(() => {
    setDisclaimerVisible(false);
    setConsentGranted(true);
  }, []);

  const { colors, isDark } = useTheme();
  const { caseId, caseTitle, prefill } = (route?.params as import('../types/api').RouteParams) ?? {};
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const [phase,     setPhase]     = useState<Phase>('library');
  const [selected,  setSelected]  = useState<typeof MOTION_TYPES[0] | null>(null);
  const [fields,    setFields]    = useState<Record<string, string>>({});
  const [draft,     setDraft]     = useState('');
  const [editDraft, setEditDraft] = useState('');
  const [attorneyReviewed, setAttorneyReviewed] = useState(false);
  const [showExportGate, setShowExportGate]     = useState(false);
  const [reviewResult, setReviewResult]   = useState<{
    score: string; issues: string[]; suggestions: string[]; missing_fields: string[];
  } | null>(null);
  const [reviewing, setReviewing]         = useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [isOffline, setIsOffline] = React.useState(false);
  React.useEffect(() => {
    const NetInfo = require('@react-native-community/netinfo').default;
    const unsub = NetInfo.addEventListener((state: Record<string, unknown>) => {
      setIsOffline(state.isConnected === false);
    });
    return unsub;
  }, []);
  const [generating,setGenerating]= useState(false);
  const [history,   setHistory]   = useState<any[]>([]);
  const [histLoading,setHistLoad] = useState(false);
  const [copied,    setCopied]    = useState(false);

  // Pre-fill from case if provided
  useEffect(() => {
    if (prefill && typeof prefill === 'object') setFields(prev => ({ ...prev, ...(prefill as Record<string,string>) }));
  }, [prefill]);

  // Set header
  useEffect(() => {
    navigation.setOptions({
      title: phase === 'history' ? '📄 Motion History'
           : phase === 'result'  ? '📄 Generated Motion'
           : '📄 Motion Library',
      headerRight: () => phase === 'library' ? (
        <TouchableOpacity
  accessibilityRole="button"
          style={{ marginRight: 14 }} accessibilityLabel="History">
          <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.navy, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>History</Text>
        </TouchableOpacity>
      ) : null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, navigation]);


  // Memoize filtered history -- avoids recomputing on every render cycle
  const filteredHistory = useMemo(() => {
    if (!history) return [];
    return history.filter(item => {
      if (historyFilter && historyFilter !== 'all' && item.status !== historyFilter) return false;
      if (historySearch?.trim()) {
        const q = historySearch.toLowerCase();
        return item.motion_type?.toLowerCase().includes(q) ||
               item.draft?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [history]);

const loadHistory = useCallback(async () => {
    setHistLoad(true);
    try {
      markOnline();
      const res = await api.get('/motions/history');
      setHistory(res.data || []);
      setPhase('history');
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    setHistLoad(false);
  }, []);

  const selectMotion = (m: typeof MOTION_TYPES[0]) => {
    requireAuth(() => {
      setSelected(m);
      setFields(typeof prefill === 'object' && prefill ? prefill as Record<string,string> : {});
      setPhase('form');
    });
  };

  const generate = useCallback(async () => {
    if (!selected) return;
    setPhase('generating');
    setGenerating(true);
    try {
      const res = await api.post('/motions/generate', {
        motion_type: selected.key,
        fields });
      // Async path: backend returns jobId
      if (res.data?.jobId) {
        const jobId = res.data?.jobId;
        // Stay in 'generating' phase while polling
        const job = await pollJob(jobId, {
          timeoutMs: 120_000,
          onProgress: ({ status, elapsed }) => {
            // setPhase stays 'generating' -- the spinner keeps showing
          } });
        const content = (job.result as any)?.content || (job.result as any)?.draft || '';
        setDraft(content);
        setEditDraft(content);
        Analytics.motionGenerated(selectedType?.key ?? 'unknown');
      setPhase('result');
        return;
      }
      // Sync fallback
      setDraft(res.data?.draft || res.data?.content || '');
      setEditDraft(res.data?.draft || res.data?.content || '');
      setPhase('result');
    } catch (e: any) {
      const msg = e.response?.data?.error || 'Could not generate motion. Check your connection.';
      Alert.alert('Generation failed', msg);
      setPhase('form');
    } finally {
      setGenerating(false);
    }
  }, [selected, fields]);

  const copyToClipboard = useCallback(async () => {
    await Clipboard.setString(editDraft);
    hapticImpact().catch(()=>{}); setCopied(true);
    copyTimer.current = setTimeout(() => setCopied(false), 2500);
  }, [editDraft]);

  const shareMotion = useCallback(async () => {
    // Require attorney-reviewed acknowledgment before every export
    // LegalZoom pattern: high-stakes documents gate on confirmation before delivery
    if (!attorneyReviewed) {
      setShowExportGate(true);
      return;
    }
    try {
      await Share.share({ message: editDraft, title: selected?.label || 'Motion' });
    } catch (shareErr: any) {
      // Share API unavailable on this browser/device — fail silently
    }
    setAttorneyReviewed(false); // reset for next export
  }, [editDraft, selected, attorneyReviewed]);

  const printMotion = useCallback(async () => {
    try {
      const { default: Print }   = await import('expo-print');
      const { default: Sharing } = await import('expo-sharing');
      const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric' });
      const motionLabel = selected?.label || 'Motion';
      const bodyHtml = editDraft
        .split('\n')
        .map((line: string) => {
          if (!line.trim()) return '<p style="margin:0;height:10px"></p>';
          if (line === line.toUpperCase() && line.trim().length > 3) {
            return `<p style="text-align:center;font-weight:bold;margin:16px 0 8px">${line.trim()}</p>`;
          }
          return `<p style="margin:0 0 8px">${line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`;
        })
        .join('');

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt;
    line-height: 2; color: #000; padding: 1in 1.25in 1in 1.5in; }
  .hdr { border-bottom: 1px solid #000; padding-bottom: 12px; margin-bottom: 24px;
    display: flex; justify-content: space-between; font-size: 10pt; color: #444; }
  h1 { font-size: 14pt; text-align: center; text-transform: uppercase;
    letter-spacing: 1px; margin: 20px 0 16px; }
  .disc { border: 1px solid #999; padding: 8px 12px; margin: 20px 0;
    font-size: 9pt; color: #555; background: #f9f9f9; }
  .footer { position: fixed; bottom: 0.5in; left: 0; right: 0;
    text-align: center; font-size: 9pt; color: #666;
    border-top: 0.5px solid #ccc; padding-top: 6px; }
</style></head>
<body>
  <div class="hdr"><span>${caseTitle || 'Case'}</span><span>${today}</span></div>
  <h1>${motionLabel}</h1>
  <div class="disc">AI-Generated Draft -- Not Legal Advice. Attorney review required before filing.
    Verify all citations and local court rules.</div>
  ${bodyHtml}
  <div class="footer">Justice Gavel AI Draft</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Export: ${motionLabel}`,
          UTI: 'com.adobe.pdf' });
      } else {
        await Print.printAsync({ html });
      }
    } catch {
      Alert.alert('Export failed', 'Could not generate PDF. Try copying the text instead.');
    }
  }, [editDraft, selected, caseTitle]);

  const deleteHistory = useCallback(async (id: number) => {
    Alert.alert('Delete motion?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await api.delete(`/motions/history/${id}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        setHistory(h => h.filter(m => m.id !== id));
      }},
    ]);
  }, []);

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;

  const fieldDefs = selected ? (FIELD_DEFS[selected.key] || []) : [];
  const filledCount = fieldDefs.filter(f => fields[f.key]?.trim()).length;

  // ── RENDER: Library ───────────────────────────────────────────────────────
  if (phase === 'library') return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() =>
      { setRefreshing(true); setLoadError(''); load().finally(() => setRefreshing(false)); }} tintColor={colors.textSecond} />}>
      <View style={{ backgroundColor: colors.warnBg, borderRadius: 8, padding: 12, margin: 12,
        marginBottom: 0, borderLeftWidth: 4, borderLeftColor: colors.gold }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.gold, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12, marginBottom: 4 }}>
          ⚖️ AI-Generated Drafts -- Attorney Review Required
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textFaint, fontSize: 11, lineHeight: 16 }}>
          These motions are AI-generated drafts. They are NOT legal advice and have not been
          reviewed by a licensed attorney. Always have a lawyer review before filing with a court.
        </Text>
      </View>
      <AuthGateModal />

      {caseTitle && (
        <View style={[styles.casePill, { backgroundColor: COLORS.navy + '14', borderColor: COLORS.navy + '30' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.casePillText, { color: COLORS.navy }]}>📁  {caseTitle}</Text>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={[styles.pageTitle, { color: colors.textPrimary }]}>Motion Library</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.pageSub, { color: colors.textMuted }]}>
        AI-generated court-ready drafts. Fill in the case details,
        we write the motion. Review, edit, and file. <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: 'Inter_700Bold', fontWeight: '700', color: COLORS.navy }}>$9.99 per motion.</Text>
      </Text>

      {/* Value prop banner */}
      <View style={[styles.valueBanner, { backgroundColor: isDark ? colors.bgCard : colors.bgSubtle, borderColor: COLORS.navy + '33' }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.valueBannerText, { color: COLORS.navy }]}>
          ⏱  Average time saved per motion: <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }}>1-3 hours</Text>
        </Text>
      </View>

      {/* Motion grid */}
      <View style={styles.grid}>
        {/* ── Trial motions ── */}
        <View style={[styles.sectionHeader, { borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHeaderText, { color: colors.textMuted }]}>TRIAL MOTIONS</Text>
        </View>
        {TRIAL_MOTIONS.map(m => (
          <MotionCard key={m.key} m={m} onPress={() => selectMotion(m)} />
        ))}

        {/* ── Appeal & post-conviction ── */}
        <View style={[styles.sectionHeader, {
          borderColor: COLORS.emergency + '40',
          backgroundColor: COLORS.emergency + '08',
          marginTop: 12 }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHeaderText, { color: COLORS.emergency }]}>
            APPEAL  &amp;  POST-CONVICTION
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHeaderSub, { color: COLORS.emergency }]}>
            Strict deadlines -- act immediately
          </Text>
        </View>
        {APPEAL_MOTIONS.map(m => (
          <MotionCard key={m.key} m={m} onPress={() => selectMotion(m)} />
        ))}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );

  // ── RENDER: Form ──────────────────────────────────────────────────────────
  if (phase === 'form' && selected) return (
    <View style={{ flex: 1 }}>
      {/* Deadline warning banner for time-critical appeal motions */}
      {(selected.key === 'notice_of_appeal' || selected.key === 'habeas_corpus') && (
        <View style={[styles.deadlineBanner, { backgroundColor: COLORS.emergency }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.deadlineBannerText}>
            {selected.key === 'notice_of_appeal'
              ? '⏰  DEADLINE CRITICAL: Federal 14 days · Most states 30 days from judgment. File immediately.'
              : '⏰  AEDPA: 1-year statute of limitations from conviction becoming final. State exhaustion required first.'}
          </Text>
        </View>
      )}
      <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
        <AuthGateModal />

        {/* Selected motion badge */}
        <View style={[styles.selectedBadge, { backgroundColor: selected.bg, borderColor: selected.color + '55' }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.selectedIcon}>{selected.icon}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.selectedLabel, { color: selected.color }]}>{selected.label}</Text>
          <View style={[styles.selectedPrice, { backgroundColor: selected.color }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.selectedPriceText}>$9.99</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, {
            width: `${Math.round(filledCount / Math.max(fieldDefs.length, 1) * 100)}%`,
            backgroundColor: selected.color }]} />
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[styles.progressLabel, { color: colors.textMuted }]}>
          {filledCount} of {fieldDefs.length} fields completed
        </Text>

        {/* Fields */}
        {fieldDefs.map(f => (
          <View key={f.key} style={styles.fieldWrap}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.fieldLabel, { color: colors.textSecond }]}>{f.label}</Text>
            <TextInput
              maxLength={3000}
              style={[
                styles.fieldInput,
                f.multiline && styles.fieldTextArea,
                { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }
              ]}
              placeholder={f.placeholder}
              placeholderTextColor={COLORS.textSecond}
              value={fields[f.key] || ''}
              onChangeText={v => setFields(prev => ({ ...prev, [f.key]: v }))}
              multiline={f.multiline}
              numberOfLines={f.multiline ? 3 : 1}
              textAlignVertical={f.multiline ? 'top' : 'auto'}
              accessibilityLabel={f.label}

          returnKeyType="next"
          blurOnSubmit
        />
          </View>
        ))}

        {/* Disclaimer */}
        <View style={[styles.disclaimer, {
          backgroundColor: isDark ? colors.bgCard : colors.warnBg,
          borderColor: colors.gold + '66'
        }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimerText, { color: isDark ? colors.gold : colors.textSecond }]}>
            ⚠️  AI-generated drafts require attorney review before filing. This is a drafting tool, not legal advice. Always verify citations and local rules.
          </Text>
        </View>

        {/* Generate button */}
        <TouchableOpacity accessibilityRole="button"
          style={[styles.generateBtn, { backgroundColor: selected.color }]}
          onPress={() => {
            Alert.alert(
              `Generate ${selected.label}`,
              `This will charge $9.99 to your account and generate a court-ready draft.\n\nReady to proceed?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Generate -- $9.99', onPress: generate },
              ]
            );
          }}
          accessibilityLabel={`Generate ${selected.label} for $9.99`}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.generateBtnText}>
            Generate {selected.label} -- $9.99 →
          </Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button" style={styles.backLink} accessibilityLabel="\u2190 Back to library" onPress={() => setPhase('library')}
          >
          <Text maxFontSizeMultiplier={1.4} style={[styles.backLinkText, { color: colors.textMuted }]}>← Back to library</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── RENDER: Generating ────────────────────────────────────────────────────
  if (phase === 'generating') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.centreWrap}>
        <ActivityIndicator size="large" color={selected?.color || COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.generatingLabel, { color: colors.textPrimary }]}>
          Drafting {selected?.label}…
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.generatingSub, { color: colors.textMuted }]}>
          Applying jurisdiction rules,{'\n'}case law, and your case details
        </Text>
      </View>

      {/* ── Attorney-Reviewed Export Gate ────────────────────────────────────────
           LegalZoom pattern: require explicit confirmation before delivering
           high-stakes documents. A motion filed in a real court can create
           adverse precedent, waive rights, or prejudice a case if poorly drafted.
           This gate ensures the user has had the draft reviewed before exporting. */}
      {showExportGate && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowExportGate(false)}>
          <View style={egStyles.overlay}>
            <View style={egStyles.card}>
              <Text maxFontSizeMultiplier={1.4} style={egStyles.title}>⚖️ Before You Export</Text>
              <Text maxFontSizeMultiplier={1.4} style={egStyles.body}>
                This motion draft has been prepared with AI assistance and{' '}
                <Text maxFontSizeMultiplier={1.4} style={egStyles.bold}>has not been reviewed by a licensed attorney.</Text>
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={egStyles.body}>
                Filing an unreviewed motion can:{''}
                {'•  '}Create adverse precedent in your case{''}
                {'•  '}Waive important legal rights{''}
                {'•  '}Be rejected by the court for procedural errors{'\n'}
                We strongly recommend having a licensed attorney review this draft before filing.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={egStyles.reviewBtn}
                accessibilityLabel="Find Free Legal Help \u2192" onPress={() => Linking.openURL('https://www.lawhelp.org/').catch(() => {})}
              >
                <Text maxFontSizeMultiplier={1.4} style={egStyles.reviewBtnText}>Find Free Legal Help →</Text>
              </TouchableOpacity>
              <View style={egStyles.checkRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setAttorneyReviewed(v => !v)}
                  style={egStyles.checkBox}
                  accessibilityState={{ checked: attorneyReviewed }}
                  accessibilityLabel="I have reviewed this draft with a licensed attorney"
                >
                  <View style={[egStyles.checkInner, attorneyReviewed && egStyles.checkInnerChecked]}>
                    {attorneyReviewed && <Text maxFontSizeMultiplier={1.4} style={egStyles.checkMark}>✓</Text>}
                  </View>
                </TouchableOpacity>
                <Text maxFontSizeMultiplier={1.4} style={egStyles.checkLabel}>
                  I have reviewed this draft with a licensed attorney, or I understand
                  the risks and choose to proceed without attorney review.
                </Text>
              </View>
              <View style={egStyles.btnRow}>
                <TouchableOpacity accessibilityRole="button"
                  style={egStyles.cancelBtn}
                  accessibilityLabel="Go Back" onPress={() => setShowExportGate(false)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={egStyles.cancelBtnText}>Go Back</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button"
                  style={[egStyles.exportBtn, !attorneyReviewed && egStyles.exportBtnDisabled]}
                  onPress={() => {
                    setShowExportGate(false);
                    shareMotion();
                  }}
                  disabled={!attorneyReviewed}
                  accessibilityState={{ disabled: !attorneyReviewed }}>
                  <Text maxFontSizeMultiplier={1.4} style={egStyles.exportBtnText}>Export Motion</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
</View>
  );

  // ── RENDER: Result ────────────────────────────────────────────────────────
  if (phase === 'result') return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={styles.resultScroll} keyboardShouldPersistTaps="handled">

        {/* Appellate draft scope notice */}
      {selected && ['appeal_brief'].includes(selected.key) && (
        <View style={[styles.citationWarning, { backgroundColor: isDark ? colors.textPrimary : colors.bgSubtle, borderColor: COLORS.navy + '60', marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.citationWarningTitle, { color: COLORS.navy }]}>
            📋  This is a structural draft -- attorney expansion required
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.citationWarningBody, { color: isDark ? colors.steel : colors.blue }]}>
            A complete appellate brief requires 12,000-25,000 words. This draft provides structure, point headings, and argument frameworks. Expect 15-50 hours of attorney work to expand into a complete brief with full citations, facts, and developed arguments.
          </Text>
        </View>
      )}

      {/* Action bar */}
        <View style={styles.resultActionBar}>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.resultAction, { backgroundColor: copied ? COLORS.legal : COLORS.navy }]}
            onPress={copyToClipboard}
            accessibilityLabel="Copy motion to clipboard"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.resultActionText}>{copied ? '✓ Copied' : '📋 Copy'}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.resultAction, { backgroundColor: COLORS.steel }]}
            onPress={shareMotion}
            accessibilityLabel="Share motion"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.resultActionText}>↑ Share</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.resultAction, { backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.steel }]}
            onPress={printMotion}
            accessibilityLabel="Export motion as PDF"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.resultActionText}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.resultAction, { backgroundColor: colors.bgCard, borderWidth: 1.5, borderColor: colors.border }]}
            accessibilityLabel="+ New" onPress={() => { setPhase('library'); setSelected(null); setDraft(''); }}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.resultActionText, { color: colors.textSecond }]}>+ New</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.resultAction, { backgroundColor: COLORS.legal }]}
            onPress={() => navigation.navigate('LegalResearch', {
              initialQuery: selected
                ? `Precedent and case law supporting a ${selected.label} -- cite key cases`
                : '' })}
            accessibilityLabel="Research precedent for this motion"
            >
            <Text maxFontSizeMultiplier={1.4} style={styles.resultActionText}>⚖️ Research</Text>
          </TouchableOpacity>
        </View>

        {/* MANDATORY citation warning -- impossible to dismiss without reading */}
        <View style={[styles.citationWarning, { backgroundColor: isDark ? colors.bailBg : colors.warnBg, borderColor: colors.warnDark }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.citationWarningTitle, { color: colors.bail }]}>
            ⚠️  Required: verify before filing
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.citationWarningBody, { color: isDark ? colors.warn : colors.textSecond }]}>
            Every case citation in this draft must be independently verified before filing. AI-generated citations may contain errors in case names, reporters, page numbers, or holdings. An incorrect citation damages your credibility before the court and may harm your client.{'\n'}
            Verify using Westlaw, Lexis, Google Scholar, or CourtListener. Check local court rules for formatting requirements.
          </Text>
        </View>

        {/* Info chip */}
        <View style={[styles.editChip, { backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle, borderColor: colors.blue + '44' }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.editChipText, { color: colors.blue }]}>
            ✏️  Review and edit below before filing. Check all citations and local court rules.
          </Text>
        </View>

        {/* Editable draft -- document typography */}
        <View style={{ paddingHorizontal: 4 }}>
          <TextInput
            style={[styles.draftInput, {
              backgroundColor: colors.bgCard,
              borderColor: colors.border,
              color: colors.textPrimary }]}
            multiline
              maxLength={2000}
            value={editDraft}
            onChangeText={setEditDraft}
            textAlignVertical="top"
            selectionColor={COLORS.navy}
            accessibilityLabel="Editable motion draft -- tap to edit"
            autoCorrect={false}
            spellCheck={false}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  </View>
  );

  // ── RENDER: History ───────────────────────────────────────────────────────
  // Filtered history
  const filteredHistoryView = history.filter((h: Record<string,unknown>) =>
    histFilter === 'all' || (h.filing_status || 'draft') === histFilter
  );

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ padding: 16 }}>
      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {(['all', ...Object.keys(FILING_STATUS)] as (FilingStatus | 'all')[]).map(key => {
          const cfg = key === 'all' ? null : FILING_STATUS[key as FilingStatus];
          const active = histFilter === key;
          return (
            <TouchableOpacity accessibilityRole="button"
              key={key}
              style={[styles.histFilterChip, active && {
                backgroundColor: cfg ? cfg.bg : COLORS.navy + '14',
                borderColor: cfg ? cfg.color : COLORS.navy }]}
              onPress={() => setHistFilter(key)}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.histFilterText, { color: active ? (cfg?.color || COLORS.navy) : colors.textMuted }]}>
                {key === 'all' ? 'All' : `${cfg!.icon} ${cfg!.label}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {histLoading
        ? <ActivityIndicator color={COLORS.navy} style={{ marginTop: 40 }} />
        : history.length === 0
        ? (
          <View style={styles.centreWrap}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 40, marginBottom: 12 }}>📄</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.generatingLabel, { color: colors.textPrimary }]}>No motions yet</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.generatingSub, { color: colors.textMuted }]}>
              Generate your first motion from the library.
            </Text>
            <TouchableOpacity
  accessibilityRole="button"
              style={[styles.generateBtn, { backgroundColor: COLORS.navy, marginTop: 20, width: '100%' }]}
              accessibilityLabel="\u2190 Back to Library" onPress={() => setPhase('library')}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.generateBtnText}>← Back to Library</Text>
            </TouchableOpacity>
          </View>
        )
        : filteredHistoryView.length === 0
        ? (
          <View style={styles.centreWrap}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.generatingSub, { color: colors.textMuted }]}>{histFilter === 'all' ? '📄 No saved motions yet.\nGenerate your first motion to get started.' : `No motions with status "${FILING_STATUS[histFilter as FilingStatus]?.label || histFilter}".`}</Text>
          </View>
        )
        : filteredHistoryView.map(item => (
          <HistoryItem
            key={item.id}
            item={item}
            onStatusChange={(id: number, s: FilingStatus) => {
              setHistory((prev: Record<string,unknown>[]) => prev.map((h: Record<string,unknown>) =>
                h.id === id ? { ...h, filing_status: s } : h
              ));
            }}
            onOpen={async (h: Record<string,unknown>) => {
              const res = await api.get(`/motions/history/${h.id}`).catch(() => null);
              if (res?.data?.draft) {
                setSelected(MOTION_TYPES.find(m => m.key === h.motion_type) || null);
                setDraft(res.data?.draft);
      cacheMotions(res.data).catch(() => {});  // write-through cache for offline use
                setEditDraft(res.data?.draft);
                setPhase('result');
              }
            }}
            onDelete={deleteHistory}
          />
        ))
      }
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  centreWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Library
  libraryScroll: { padding: 16, paddingBottom: 32 },
  casePill:  { alignSelf: 'flex-start', borderRadius: 16, borderWidth: 1, paddingHorizontal: 12,
    paddingVertical: 10, marginBottom: 14 },
  casePillText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  pageTitle: { fontSize: 22, ...FONTS.black, marginBottom: 6 },
  pageSub:   { fontSize: 12, lineHeight: 20, marginBottom: 14 },
  valueBanner: { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 16 },
  valueBannerText: { fontSize: 12, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },

  motionCard: { borderRadius: RADIUS.xl, borderWidth: 1.5, padding: 16,
    marginBottom: 0, minHeight: 140, ...SHADOW.sm },
  motionIcon:  { fontSize: 28, marginBottom: 8 },
  motionLabel: { fontSize: 12, ...FONTS.black, marginBottom: 4, lineHeight: 17 },
  motionDesc:  { fontSize: 11, lineHeight: 15, marginBottom: 12, flex: 1 },
  motionPrice: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  motionPriceText: { color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

  // Form
  formScroll: { padding: 16, paddingBottom: 40 },
  selectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg,
    borderWidth: 1.5, padding: 12, marginBottom: 14 },
  selectedIcon:  { fontSize: 22 },
  selectedLabel: { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  selectedPrice: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  selectedPriceText: { color: COLORS.bgCard, fontSize: 12, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

  progressBg:   { height: 4, borderRadius: 2, marginBottom: 6, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  progressLabel:{ fontSize: 11, fontWeight: '600', marginBottom: 16 },

  fieldWrap:     { marginBottom: 14 },
  fieldLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.6, marginBottom: 6 },
  fieldInput:    { borderWidth: 1.5, borderRadius: RADIUS.md, paddingHorizontal: 13,
    paddingVertical: 10, fontSize: 14,
    lineHeight: 21 },
  fieldTextArea: { minHeight: 80, paddingTop: 10 },

  disclaimer:    { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 16 },
  disclaimerText:{ fontSize: 12, lineHeight: 17 },

  generateBtn:   { borderRadius: RADIUS.lg, paddingVertical: 16, alignItems: 'center',
    marginBottom: 10, ...SHADOW.sm },
  generateBtnText: { color: COLORS.bgCard, fontSize: 15, lineHeight: 22, ...FONTS.black },
  backLink:      { paddingVertical: 10, alignItems: 'center' },
  backLinkText:  { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Generating
  generatingLabel: { fontSize: 18, ...FONTS.heavy, textAlign: 'center', marginTop: 16, marginBottom: 6 },
  generatingSub:   { fontSize: 12, textAlign: 'center', lineHeight: 20 },

  // Result
  resultScroll:    { padding: 16, paddingBottom: 40 },
  resultActionBar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  resultAction:    { flex: 1, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center' },
  resultActionText:{ color: COLORS.bgCard, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  editChip:        { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginBottom: 12 },
  editChipText:    { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_500Medium', fontWeight: '500' },
  draftInput:      { borderWidth: 1, borderRadius: RADIUS.lg, padding: 20,
    fontSize: 15, lineHeight: 26, minHeight: 600,
    fontFamily: 'Inter_400Regular', letterSpacing: 0.1,
    textAlignVertical: 'top' },

  // History
  historyRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, padding: 16, marginBottom: 8 },
  historyIcon:   { fontSize: 22 },
  historyLabel:  { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2 },
  historyDate:   { fontSize: 12 },
  historyDelete: { padding: 6 },
  sectionHeader:     { paddingHorizontal: 4, paddingVertical: 10, marginTop: 8, marginBottom: 4,
    borderRadius: RADIUS.md, borderWidth: 1, paddingLeft: 12 },
  sectionHeaderText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 1.2 },
  sectionHeaderSub:  { fontSize: 11, fontWeight: '600', marginTop: 2 },
  deadlineBanner:    { marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    borderRadius: RADIUS.md, padding: 12 },
  deadlineBannerText:{ color: COLORS.bgCard, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 17 },
  citationWarning:      { borderRadius: RADIUS.md, borderWidth: 2, padding: 16, marginBottom: 12 },
  citationWarningTitle: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 6 },
  citationWarningBody:  { fontSize: 12, lineHeight: 18 },
  histFilterChip:    { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: 'transparent', backgroundColor: 'transparent' },
  histFilterText:    { fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  statusBadgeBtn:    { paddingHorizontal: 8, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, marginLeft: 8, flexShrink: 0 },
  statusBadgeText:   { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  statusPicker:      { position: 'absolute', right: 0, top: 44, zIndex: 999,
    borderRadius: 12, borderWidth: 1, minWidth: 150, overflow: 'hidden' },
  statusPickerRow:   { flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 11 },
  statusPickerLabel: { fontSize: 12 } });

// Module-level fallback for helper components
const styles = makeStyles(COLORS);
const egStyles = StyleSheet.create({
  overlay:    { flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', alignItems:'center', padding:20 },
  card:       { backgroundColor:COLORS.bgCard, borderRadius:16, padding:20, width:'100%', maxWidth:420 },
  title:      { fontSize:18, fontWeight:'700', color:'#042C53', marginBottom:12, textAlign:'center' },
  body:       { fontSize:13, color:COLORS.steel, lineHeight:20, marginBottom:12 },
  bold:       { fontWeight:'700', color:COLORS.bg },
  reviewBtn:  { backgroundColor:COLORS.bgSubtle, borderRadius:8, padding:12, alignItems:'center', marginBottom:16 },
  reviewBtnText: { fontSize:13, fontWeight:'600', color:COLORS.blue },
  checkRow:   { flexDirection:'row', alignItems:'flex-start', gap:10, marginBottom:16 },
  checkBox:   { marginTop:2, flexShrink:0 },
  checkInner: { width:22, height:22, borderRadius:4, borderWidth:2, borderColor:COLORS.textMuted, alignItems:'center', justifyContent:'center' },
  checkInnerChecked: { backgroundColor:'#042C53', borderColor:'#042C53' },
  checkMark:  { color:COLORS.bgCard, fontSize:13, fontWeight:'700' },
  checkLabel: { flex:1, fontSize:12, color:COLORS.steel, lineHeight:18 },
  btnRow:     { flexDirection:'row', gap:10 },
  cancelBtn:  { flex:1, borderRadius:10, borderWidth:1, borderColor:COLORS.border, padding:12, alignItems:'center' },
  cancelBtnText: { fontSize:14,
    lineHeight: 21, color:COLORS.steel, fontWeight:'500' },
  exportBtn:  { flex:1, borderRadius:10, backgroundColor:'#042C53', padding:12, alignItems:'center' },
  exportBtnDisabled: { backgroundColor:COLORS.border },
  exportBtnText: { fontSize:14,
    lineHeight: 21, color:COLORS.bgCard, fontWeight:'700' } });
