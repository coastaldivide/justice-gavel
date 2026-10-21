import { AIDisclaimer } from '../components/AIDisclaimer';
import { escapeHtml } from '../utils/html';
import { unwrapList, apiErrorMessage } from '../services/api';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import Analytics from '../services/analytics';
import { ScreenCapture, hapticImpact, RNShare } from '../utils/webCompat';
import type { ScreenProps } from '../types/navigation';
/**
 * MotionLibraryScreen -- AI motion template generator
 *
 * Design direction: editorial precision -- this is a professional tool
 * used by attorneys filing real court documents. Clean grids, tight
 * typography, no decoration that distracts from the task. Feels like
 * a well-designed legal software product, not a consumer app.
 *
 * No per-motion charge exists (the server never bills a draft), so the
 * screen shows no price.
 *
 * Flow:
 *   Library → Select motion type → Fill fields (smart form)
 *   → Confirm → Generated draft (job, polled) → Edit → Copy / Share / PDF
 *   → History (motion_history: open, filing status, delete)
 *
 * Entry points:
 *   1. CaseScreen → "Motions" tab (primary -- pre-fills case data)
 *   2. Direct navigation (standalone use)
 */
import NetInfo from '@react-native-community/netinfo';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Linking, Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Animated, LayoutAnimation, InteractionManager } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { api }         from '../services/api';
import { pollJob } from '../services/jobPoller';
import { cacheMotions, markOnline } from '../services/offlineCache';
import { getUserState } from '../utils/userState';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme, type ThemeColors, themeColors } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import LegalDisclaimerModal, { hasValidConsent } from '../components/LegalDisclaimerModal';
import { useBiometricGate, BiometricLockView } from '../hooks/useBiometricGate';
import { t, useLang, perLang, locale } from '../i18n';

// ── Motion type definitions (mirrors backend) ─────────────────────────────────
// ── Trial-stage motions ───────────────────────────────────────────────────────
const TRIAL_MOTIONS = perLang(() => {
  const c = themeColors();
  return [
  { key: 'suppress',         label: t('x_motion_templates_motion_suppress'),        icon: ICONS.shield, color: c.emergencyDark, bg: c.emergencyBg,
    desc: t('x_motion_library_challenge_illegally_obtained_evidenc') },
  { key: 'bail_reduction',   label: t('x_motion_templates_motion_bail_reduction'),  icon: ICONS.bail, color: c.info, bg: c.bgSubtle,
    desc: t('x_motion_library_argue_lower_bail_release') },
  { key: 'continuance',      label: t('x_motion_templates_motion_continuance'),     icon: ICONS.calendar, color: c.warnDark, bg: c.warnBg,
    desc: t('x_motion_library_request_additional_time_prepare') },
  { key: 'dismiss',          label: t('x_motion_templates_motion_dismiss'),          icon: ICONS.lawyer, color: c.info, bg: c.bgSubtle,
    desc: t('x_motion_library_seek_dismissal_speedy_trial') },
  { key: 'discovery',        label: t('x_motion_templates_motion_discovery'),       icon: ICONS.clipboard, color: c.legalDark, bg: c.legalBg,
    desc: t('x_motion_library_compel_prosecution_disclose_brady') },
  { key: 'limine',           label: t('x_motion_templates_motion_limine'),           icon: ICONS.ban, color: c.textSecond, bg: c.bgSubtle,
    desc: t('x_motion_library_exclude_prejudicial_evidence_before') },
  { key: 'speedy_trial',     label: t('x_motion_library_motion_speedy_trial'),    icon: ICONS.clock, color: c.info, bg: c.bgSubtle,
    desc: t('x_motion_library_assert_6th_amendment_right') },
  { key: 'compel',           label: t('x_motion_library_motion_compel'),           icon: ICONS.pin, color: c.legalDark, bg: c.legalBg,
    desc: t('x_motion_library_force_prosecution_comply_with') },
];
});

// ── Appeal and post-conviction motions ─────────────────────────────────────────
const APPEAL_MOTIONS = perLang(() => {
  const c = themeColors();
  return [
  { key: 'notice_of_appeal', label: t('x_motion_library_notice_appeal'),           icon: ICONS.speak, color: c.emergencyDark, bg: c.emergencyBg,
    desc: t('x_motion_library_preserve_appellate_rights_federal'),
    deadline: true },
  { key: 'appeal_brief',     label: t('x_motion_library_appellate_brief'),            icon: ICONS.document, color: c.textBrand, bg: c.bgSubtle,
    desc: t('x_motion_library_full_substantive_brief_arguing') },
  { key: 'sentence_reduction',label: t('x_motion_library_motion_reduce_sentence'), icon: ICONS.peace, color: c.legalDark, bg: c.legalBg,
    desc: t('x_motion_library_post_conviction_sentence_modificatio') },
  { key: 'habeas_corpus',    label: t('x_motion_library_petition_habeas_corpus'), icon: ICONS.lawyer, color: c.info, bg: c.bgSubtle,
    desc: t('x_motion_library_collateral_attack_unlawful_detention'),
    deadline: true },
];
});

// Combined for backwards compatibility
const MOTION_TYPES = perLang(() => [...TRIAL_MOTIONS(), ...APPEAL_MOTIONS()]);

// ── Field definitions per motion type ────────────────────────────────────────
const FIELD_DEFS = perLang((): Record<string, { key: string; label: string; placeholder: string; multiline?: boolean }[]> => ({
  suppress: [
    { key: 'defendant_name',       label: t('x_motion_library_defendant_name'),                  placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',          label: t('x_check_in_manager_case_number'),                     placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',           label: t('x_check_in_manager_court'),                           placeholder: 'Shelby County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',                label: t('state'),                           placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'charge',               label: t('x_motion_library_charge_s'),                       placeholder: 'DUI, Possession of Controlled Substance' }, // i18n-exempt: sample English court-filing value
    { key: 'amendment_theory',     label: t('x_motion_library_constitutional_theory'),           placeholder: '4th Amendment -- unlawful search and seizure' }, // i18n-exempt: sample English court-filing value
    { key: 'specific_violation',   label: t('x_motion_library_specific_violation'),              placeholder: 'No reasonable suspicion for the initial traffic stop -- officer admitted he saw no moving violation and only stopped vehicle because of neighborhood' }, // i18n-exempt: sample English court-filing value
    { key: 'fruit_of_poisonous_tree', label: t('x_motion_library_fruit_poisonous_tree'), placeholder: 'Yes -- all evidence recovered after the unlawful stop (controlled substance, breathalyzer result) must be suppressed as derivative evidence. No independent source or inevitable discovery exception applies.' }, // i18n-exempt: sample English court-filing value
    { key: 'good_faith_exception', label: t('x_motion_library_does_prosecution_claim_good'), placeholder: 'No warrant was obtained, so Leon does not apply. If prosecution argues Leon, counter: no reasonably well-trained officer could have relied on a bare-bones stop without articulable suspicion.' }, // i18n-exempt: sample English court-filing value
    { key: 'search_date',          label: t('x_motion_library_date_search_stop'),             placeholder: 'March 10, 2025' }, // i18n-exempt: sample English court-filing value
    { key: 'search_location',      label: t('x_motion_library_location_search'),              placeholder: 'Interstate 40 westbound, Memphis, TN' }, // i18n-exempt: sample English court-filing value
    { key: 'officer_name',         label: t('x_motion_library_officer_name_badge'),              placeholder: 'Officer J. Rodriguez, Badge #4421' }, // i18n-exempt: sample English court-filing value
    { key: 'grounds',           label: t('x_motion_library_grounds_suppression'), placeholder: 'No probable cause -- officer lacked reasonable suspicion for the stop', multiline: true }, // i18n-exempt: sample English court-filing value
  ],
  bail_reduction: [
    { key: 'defendant_name',       label: t('x_motion_library_defendant_name'),              placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',          label: t('x_check_in_manager_case_number'),                 placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',           label: t('x_check_in_manager_court'),                       placeholder: 'Davidson County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',                label: t('state'),                       placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'charge',               label: t('x_motion_library_charge_s'),                   placeholder: 'Aggravated Assault' }, // i18n-exempt: sample English court-filing value
    { key: 'current_bail',         label: t('x_motion_library_current_bail_amount'),         placeholder: '$50,000' },
    { key: 'length_in_custody',    label: t('x_motion_library_time_custody_date'),     placeholder: '47 days as of filing date' }, // i18n-exempt: sample English court-filing value
    { key: 'ability_to_pay',       label: t('x_motion_library_ability_pay_current_bail'), placeholder: 'Cannot meet current bail -- monthly income $2,800, no savings; family unable to contribute more than $2,000' }, // i18n-exempt: sample English court-filing value
    { key: 'community_ties',       label: t('x_motion_library_community_ties'),              placeholder: '15-year resident, owns home, family in Nashville', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'employment',           label: t('x_practice_area_selector_employment'),                  placeholder: 'Employed full-time at ABC Construction for 8 years; employer confirms position held' }, // i18n-exempt: sample English court-filing value
    { key: 'prior_record',         label: t('x_motion_library_prior_record'),                placeholder: 'No prior felony convictions, one misdemeanor 2018' }, // i18n-exempt: sample English court-filing value
    { key: 'travel_documents',     label: t('x_motion_library_passport_travel_documents'), placeholder: 'No passport; has never traveled outside Tennessee; surrenders all travel documents' }, // i18n-exempt: sample English court-filing value
    { key: 'voluntary_surrender',  label: t('x_motion_library_surrender_cooperation'),     placeholder: 'Defendant surrendered voluntarily on March 10, 2025; fully cooperative with booking' }, // i18n-exempt: sample English court-filing value
    { key: 'other_pending_charges',label: t('x_motion_library_other_pending_charges'),       placeholder: 'None' }, // i18n-exempt: sample English court-filing value
    { key: 'proposed_bail',        label: t('x_motion_library_proposed_bail_ror'),         placeholder: '$5,000 or release on own recognizance with electronic monitoring' }, // i18n-exempt: sample English court-filing value
  ],
  continuance: [
    { key: 'defendant_name',    label: t('x_motion_library_defendant_name'),      placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_check_in_manager_case_number'),         placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',        label: t('x_check_in_manager_court'),               placeholder: 'Knox County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('state'),               placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'hearing_date',      label: t('x_motion_library_current_hearing_date'),placeholder: 'April 15, 2025' }, // i18n-exempt: sample English court-filing value
    { key: 'reason',            label: t('x_motion_library_reason_continuance'), placeholder: 'New forensic evidence received March 28 requires expert review', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'requested_new_date',label: t('x_motion_library_proposed_new_date'),   placeholder: 'Any date after May 15, 2025' }, // i18n-exempt: sample English court-filing value
  ],
  dismiss: [
    { key: 'defendant_name',    label: t('x_motion_library_defendant_name'),      placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_check_in_manager_case_number'),         placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',        label: t('x_check_in_manager_court'),               placeholder: 'Hamilton County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('state'),               placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'charge',            label: t('x_motion_library_charge_s'),           placeholder: 'Drug Possession' }, // i18n-exempt: sample English court-filing value
    { key: 'grounds',           label: t('x_motion_library_grounds_dismissal'), placeholder: 'Speedy trial violation -- 270 days elapsed since arrest with no trial date set', multiline: true }, // i18n-exempt: sample English court-filing value
  ],
  discovery: [
    { key: 'defendant_name',    label: t('x_motion_library_defendant_name'),      placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_check_in_manager_case_number'),         placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',        label: t('x_check_in_manager_court'),               placeholder: 'Shelby County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('state'),               placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'charge',            label: t('x_motion_library_charge_s'),           placeholder: 'Armed Robbery' }, // i18n-exempt: sample English court-filing value
    { key: 'items_requested',   label: t('x_motion_library_items_be_disclosed'), placeholder: 'All body camera footage, witness statements, lab reports, informant identity', multiline: true }, // i18n-exempt: sample English court-filing value
  ],
  limine: [
    { key: 'defendant_name',    label: t('x_motion_library_defendant_name'),      placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_check_in_manager_case_number'),         placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',        label: t('x_check_in_manager_court'),               placeholder: 'Davidson County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('state'),               placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'charge',            label: t('x_motion_library_charge_s'),           placeholder: 'Assault' }, // i18n-exempt: sample English court-filing value
    { key: 'evidence_to_exclude', label: t('x_motion_library_evidence_exclude'), placeholder: 'Defendant\'s 2018 prior conviction for unrelated offense', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'grounds',           label: t('x_motion_library_grounds'),             placeholder: 'Unfair prejudice substantially outweighs probative value under FRE 403', multiline: true }, // i18n-exempt: sample English court-filing value
  ],
  speedy_trial: [
    { key: 'defendant_name',       label: t('x_motion_library_defendant_name'),                placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',          label: t('x_check_in_manager_case_number'),                   placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',           label: t('x_check_in_manager_court'),                         placeholder: 'Knox County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',                label: t('state'),                         placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'charge',               label: t('x_motion_library_charge_s'),                     placeholder: 'Theft' }, // i18n-exempt: sample English court-filing value
    { key: 'arrest_date',          label: t('x_motion_library_arrest_date'),                   placeholder: 'June 1, 2024' }, // i18n-exempt: sample English court-filing value
    { key: 'current_date',         label: t('x_motion_library_current_date'),                  placeholder: 'March 28, 2025' }, // i18n-exempt: sample English court-filing value
    { key: 'delays_caused_by',     label: t('x_motion_library_reason_delay_by_whom'),    placeholder: 'Prosecution requested 3 continuances totaling 210 days; no legitimate reason given', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'date_right_asserted',  label: t('x_motion_library_date_defendant_asserted_speedy'), placeholder: 'September 15, 2024 -- written demand filed with clerk; copy attached as Exhibit A' }, // i18n-exempt: sample English court-filing value
    { key: 'prejudice_to_defendant', label: t('x_motion_library_prejudice_defendant_barker_factor'), placeholder: 'Defendant has been incarcerated 300 days causing loss of employment; key alibi witness relocated and cannot be located; anxiety and stress from prolonged proceedings', multiline: true }, // i18n-exempt: sample English court-filing value
  ],
  compel: [
    { key: 'defendant_name',    label: t('x_motion_library_defendant_name'),      placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_check_in_manager_case_number'),         placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',        label: t('x_check_in_manager_court'),               placeholder: 'Shelby County Criminal Court' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('state'),               placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'charge',            label: t('x_motion_library_charge_s'),           placeholder: 'Drug Trafficking' }, // i18n-exempt: sample English court-filing value
    { key: 'items_withheld',    label: t('x_motion_library_items_withheld_by_prosecution'), placeholder: 'CI identity, recorded conversations, lab analysis', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'request_date',      label: t('x_motion_library_date_discovery_was_requested'), placeholder: 'January 15, 2025' }, // i18n-exempt: sample English court-filing value
  ],

  // ── Appeal and post-conviction field definitions ─────────────────────────
  notice_of_appeal: [
    { key: 'defendant_name',    label: t('x_motion_library_defendant_appellant_name'), placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_motion_library_trial_court_case_number'),    placeholder: 'CR-2025-00123' }, // i18n-exempt: sample English court-filing value
    { key: 'trial_court',       label: t('x_motion_library_trial_court_name'),           placeholder: 'Shelby County Criminal Court, Division III' }, // i18n-exempt: sample English court-filing value
    { key: 'appellate_court',   label: t('x_motion_library_appellate_court'),            placeholder: 'Court of Criminal Appeals of Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('x_motion_library_state_jurisdiction'),       placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'conviction_date',   label: t('x_motion_library_date_conviction_verdict'), placeholder: 'March 14, 2025' }, // i18n-exempt: sample English court-filing value
    { key: 'judgment_date',     label: t('x_motion_library_date_judgment_was_entered'),  placeholder: 'March 21, 2025 -- THIS IS YOUR DEADLINE TRIGGER' }, // i18n-exempt: sample English court-filing value
    { key: 'sentence',          label: t('x_motion_library_sentence_imposed'),           placeholder: '8 years TDOC -- count 1; 2 years probation -- count 2' }, // i18n-exempt: sample English court-filing value
    { key: 'grounds_preview',   label: t('x_motion_library_preliminary_grounds_brief_full'), placeholder: 'Insufficient evidence; improper jury instruction on mens rea; 4th Amendment suppression denied in error', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'counsel_name',      label: t('x_motion_library_appellate_counsel_name'),     placeholder: 'Jane A. Doe, Esq.' }, // i18n-exempt: sample English court-filing value
    { key: 'counsel_bar_number',label: t('hn_bar_number'),                 placeholder: 'TN Bar No. 012345' }, // i18n-exempt: sample English court-filing value
  ],

  appeal_brief: [
    { key: 'defendant_name',    label: t('x_motion_library_appellant_name'),             placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_motion_library_appellate_case_number'),      placeholder: 'M2025-00456-CCA-R3-CD' }, // i18n-exempt: sample English court-filing value
    { key: 'appellate_court',   label: t('x_motion_library_appellate_court'),            placeholder: 'Court of Criminal Appeals of Tennessee, Middle Section' }, // i18n-exempt: sample English court-filing value
    { key: 'trial_court_name',  label: t('x_motion_library_trial_court'),                placeholder: 'Davidson County Criminal Court, Division II' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('x_motion_library_state_jurisdiction'),       placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'conviction',        label: t('x_motion_library_conviction_s'),              placeholder: 'Aggravated Assault (Class C Felony); Reckless Endangerment' }, // i18n-exempt: sample English court-filing value
    { key: 'sentence',          label: t('x_motion_library_sentence'),                   placeholder: '6 years at 30%; consecutive' }, // i18n-exempt: sample English court-filing value
    { key: 'standard_of_review',label: t('x_motion_library_standard_review_primary_issue'), placeholder: 'De novo -- pure question of law regarding jury instruction; abuse of discretion -- evidentiary ruling', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'grounds_for_reversal', label: t('x_motion_library_grounds_reversal_each_issue'), placeholder: '1. Jury instruction on self-defense was constitutionally deficient\n2. Trial court abused discretion admitting prior bad acts under TRE 404(b)\n3. Evidence insufficient to support aggravated assault conviction', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'key_facts',         label: t('x_motion_library_key_facts_record'),   placeholder: 'Defendant acted in self-defense after victim made threatening advance. No prior criminal record. Three eyewitnesses corroborate defendant\'s account.', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'preserved_objections', label: t('x_motion_library_objections_preserved_at_trial'), placeholder: 'Obj. to 404(b) evidence at T.Tr. 142:3; obj. to jury instruction at T.Tr. 298:17', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'relief_requested',  label: t('x_motion_library_relief_requested'),           placeholder: 'Reverse conviction and remand for new trial; alternatively, reduce to lesser-included offense', multiline: true }, // i18n-exempt: sample English court-filing value
  ],

  sentence_reduction: [
    { key: 'defendant_name',    label: t('x_motion_library_defendant_name'),             placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_check_in_manager_case_number'),                placeholder: 'CR-2020-00456' }, // i18n-exempt: sample English court-filing value
    { key: 'court_name',        label: t('x_check_in_manager_court'),                      placeholder: 'U.S. District Court, M.D. Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('x_motion_library_state_jurisdiction'),       placeholder: 'Tennessee (Federal)' }, // i18n-exempt: sample English court-filing value
    { key: 'conviction',        label: t('x_motion_library_conviction'),                 placeholder: '21 U.S.C. § 841(a)(1) -- Distribution of a Controlled Substance' }, // i18n-exempt: sample English court-filing value
    { key: 'original_sentence', label: t('x_motion_library_original_sentence'),         placeholder: '120 months -- mandatory minimum' }, // i18n-exempt: sample English court-filing value
    { key: 'time_served',       label: t('x_motion_library_time_served_date'),        placeholder: '84 months (7 years) as of filing date' }, // i18n-exempt: sample English court-filing value
    { key: 'grounds',           label: t('x_motion_library_grounds_reduction'),      placeholder: 'First Step Act -- retroactive application of Fair Sentencing Act; Amendment 782 retroactivity', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'rehabilitation',    label: t('x_motion_library_rehabilitation_evidence'),    placeholder: 'GED earned 2022; completed 1,200 hours vocational training; no disciplinary infractions in 4 years; mentor program participant', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'family_circumstances', label: t('x_motion_library_family_community_circumstances'), placeholder: 'Sole surviving parent of two minor children (ages 8 and 11) currently in foster care', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'community_support', label: t('x_motion_library_community_support_letters'),  placeholder: 'Letters from pastor, former employer, and family members attached as Exhibit A' }, // i18n-exempt: sample English court-filing value
    { key: 'proposed_sentence', label: t('x_motion_library_proposed_reduced_sentence'),  placeholder: 'Time served, or 84 months -- within revised guideline range of 70-87 months' }, // i18n-exempt: sample English court-filing value
  ],

  habeas_corpus: [
    { key: 'petitioner_name',   label: t('x_motion_library_petitioner_name'),            placeholder: 'John Smith' }, // i18n-exempt: sample English court-filing value
    { key: 'case_number',       label: t('x_motion_library_habeas_case_number_if'), placeholder: 'Leave blank if new filing' }, // i18n-exempt: sample English court-filing value
    { key: 'court',             label: t('x_motion_library_court_filing'),            placeholder: 'U.S. District Court, W.D. Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'state',             label: t('state'),                      placeholder: 'Tennessee' }, // i18n-exempt: sample English court-filing value
    { key: 'conviction_date',   label: t('x_motion_library_date_conviction_became_final'), placeholder: 'June 15, 2024 (cert. denied by Tenn. Supreme Court)' }, // i18n-exempt: sample English court-filing value
    { key: 'sentence',          label: t('x_motion_library_sentence'),                   placeholder: 'Life without possibility of parole' }, // i18n-exempt: sample English court-filing value
    { key: 'current_custodian', label: t('x_motion_library_respondent_custodian'),     placeholder: 'Warden James T. Riley, Riverbend Maximum Security Institution' }, // i18n-exempt: sample English court-filing value
    { key: 'constitutional_violation', label: t('x_motion_library_constitutional_violation_s'), placeholder: '6th Amendment -- ineffective assistance of counsel (Strickland); 14th Amendment -- Brady violation', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'grounds',           label: t('x_motion_library_detailed_grounds'),           placeholder: 'Trial counsel failed to investigate alibi witnesses known before trial. Three witnesses would have placed petitioner 40 miles from the crime scene. Counsel made no investigation and presented no alibi defense.', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'prior_appeals',     label: t('x_motion_library_prior_state_court_proceedings'), placeholder: 'Direct appeal -- Tenn. Ct. Crim. App. 2022 (affirmed); TPCA petition -- Davidson Co. dismissed 2024', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'exhaustion_of_remedies', label: t('x_motion_library_state_remedies_exhausted'), placeholder: 'All claims presented to Tennessee Court of Criminal Appeals and Tennessee Supreme Court. No further state remedies available.', multiline: true }, // i18n-exempt: sample English court-filing value
    { key: 'timeliness_explanation', label: t('x_motion_library_aedpa_timeliness_1_year'), placeholder: 'Petition filed within one year of conviction becoming final on June 15, 2024. Filing date: June 10, 2025.', multiline: true }, // i18n-exempt: sample English court-filing value
  ] }));

type Phase = 'library' | 'form' | 'confirm' | 'generating' | 'result' | 'history';

// ── Filing status config ──────────────────────────────────────────────────────
const FILING_STATUS = perLang(() => {
  const c = themeColors();
  return {
  draft:   { label: t('x_motion_library_draft'),   color: c.textMuted, bg: c.bgSubtle, icon: ICONS.edit },
  filed:   { label: t('x_motion_library_filed'),   color: c.info, bg: c.bgSubtle, icon: ICONS.mail },
  granted: { label: t('x_firm_vertical_granted'), color: c.legalDark, bg: c.legalBg, icon: ICONS.statusOk },
  denied:  { label: t('x_motion_library_denied'),  color: c.emergencyDark, bg: c.emergencyBg, icon: ICONS.statusError },
  pending: { label: t('case_status_pending'), color: c.warnDark, bg: c.warnBg, icon: ICONS.hourglass } } as const;
});
type FilingStatus = keyof ReturnType<typeof FILING_STATUS>;

// ── Motion type card ──────────────────────────────────────────────────────────
function MotionCard({ m, onPress }: { m: ReturnType<typeof MOTION_TYPES>[0]; onPress: () => void }) {
  useLang();
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
      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={[styles.motionCard, { backgroundColor: m.bg, borderColor: m.color + '44' }]}
        onPress={handlePress}
        testID={`motion-card-${m.key}`}
        activeOpacity={1}
        accessibilityLabel={`${m.label} -- ${m.desc}`}
      >
        <AppIcon name={m.icon} size={22} color={colors.textBrand} style={styles.motionIcon} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.motionLabel, { color: m.color }]}>{m.label}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.motionDesc,  { color: colors.textMuted }]}>{m.desc}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── History item ──────────────────────────────────────────────────────────────
function HistoryItem({ item, onOpen, onDelete, onStatusChange }: any) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const m = MOTION_TYPES().find(tItem => tItem.key === item.motion_type);
  const [showPicker, setShowPicker] = useState(false);
  const [status, setStatus] = useState<FilingStatus>(item.filing_status || 'draft');
  const [updating, setUpdating] = useState(false);

  const cfg = FILING_STATUS()[status] || FILING_STATUS().draft;

  const changeStatus = async (s: FilingStatus) => {
    setShowPicker(false);
    if (s === status) return;
    setUpdating(true);
    try {
      await api.patch(`/motions/${item.id}/status`, { status: s });
      setStatus(s);
      onStatusChange?.(item.id, s);
    } catch {
      showToast(t('home_sos_failed'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <View style={[styles.historyRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
      testID="motion-library-screen">
      {/* Open motion */}
      <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
        accessibilityLabel={m?.label || item.motion_type} onPress={() => onOpen(item)}
      >
        <AppIcon name={m?.icon || ICONS.document} size={22} color={colors.textBrand} style={styles.historyIcon} />
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.historyLabel, { color: colors.textPrimary }]} numberOfLines={1}>
            {m?.label || item.motion_type}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.historyDate, { color: colors.textMuted }]}>
            {new Date(item.created_at ?? 0).toLocaleDateString(locale(), { month:'short', day:'numeric', year:'numeric' })}
            {item.filed_at && status === 'filed'
              ? ' ' + t('x_motion_library_filed_2', { value: new Date(item.filed_at).toLocaleDateString(locale(), { month:'short', day:'numeric' }) })
              : ''}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Status badge -- tappable */}
      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        style={[styles.statusBadgeBtn, { backgroundColor: cfg.bg, borderColor: cfg.color + '60' }]}
        onPress={() => setShowPicker(p => !p)}
        disabled={updating}
      >
        {updating ? <Text maxFontSizeMultiplier={1.4} style={[styles.statusBadgeText, { color: cfg.color }]}>…</Text>
          : <IconLabel icon={cfg.icon} maxFontSizeMultiplier={1.4} textStyle={[styles.statusBadgeText, { color: cfg.color }]}>{cfg.label}</IconLabel>}
      </TouchableOpacity>

      {/* Delete */}
      <TouchableOpacity accessibilityRole="button"

        onPress={() => onDelete(item.id)}
        style={styles.historyDelete}
        accessibilityLabel={t('x_motion_library_delete_motion')}
          accessibilityHint={t('x_discovery_permanently_removes_this_item')}
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 16 }}>✕</Text>
      </TouchableOpacity>

      {/* Status picker dropdown */}
      {showPicker && (
        <View style={[styles.statusPicker, {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: colors.bg,
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 6 }]}>
          {(Object.entries(FILING_STATUS()) as [FilingStatus, ReturnType<typeof FILING_STATUS>[FilingStatus]][]).map(([key, cfg]) => (
            <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              key={key}
              style={[styles.statusPickerRow,
                key === status && { backgroundColor: cfg.bg }]}
              onPress={() => changeStatus(key)}
              accessibilityLabel={t('x_motion_library_mark_as', { label: cfg.label })}
            >
              <AppIcon name={cfg.icon} size={14} color={cfg.color} style={{ marginRight: 8 }} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.statusPickerLabel, { color: key === status ? cfg.color : colors.textPrimary, fontWeight: key === status ? '700' : '400' }]}>
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
  dui:         ['suppress', 'discovery', 'continuance', 'dismiss'],
  dwi:         ['suppress', 'discovery', 'continuance', 'dismiss'],
  drunk:       ['suppress', 'discovery'],
  alcohol:     ['suppress', 'discovery'],
  breathalyzer:['suppress'],

  // Drug offenses
  drug:        ['suppress', 'discovery', 'dismiss'],
  narcotics:   ['suppress', 'discovery', 'dismiss'],
  possession:  ['suppress', 'discovery', 'dismiss'],
  trafficking: ['suppress', 'bail_reduction', 'discovery'],
  marijuana:   ['suppress', 'dismiss', 'discovery'],
  controlled:  ['suppress', 'discovery'],

  // Assault / Violence
  assault:     ['discovery', 'limine', 'continuance'],
  battery:     ['discovery', 'limine'],
  domestic:    ['discovery', 'limine', 'suppress'],
  violent:     ['bail_reduction', 'discovery'],

  // Theft / Property
  theft:       ['discovery', 'limine', 'dismiss'],
  burglary:    ['suppress', 'discovery', 'bail_reduction'],
  robbery:     ['suppress', 'discovery', 'bail_reduction'],
  shoplifting: ['dismiss', 'discovery'],
  fraud:       ['discovery', 'limine', 'dismiss'],

  // Weapons
  weapon:      ['suppress', 'discovery', 'dismiss'],
  firearm:     ['suppress', 'discovery'],
  gun:         ['suppress', 'discovery'],

  // Traffic / Driving
  traffic:     ['dismiss', 'discovery', 'continuance'],
  reckless:    ['dismiss', 'discovery'],
  speeding:    ['dismiss', 'discovery'],

  // General
  felony:      ['bail_reduction', 'discovery', 'continuance'],
  misdemeanor: ['dismiss', 'continuance'] };

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

function MotionLibraryScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const userStateRef = React.useRef<string>('');
  React.useEffect(() => {
    const _task = InteractionManager.runAfterInteractions(() => {
    getUserState().then((s: any) => { if (s?.code) userStateRef.current = s.code; }).catch(() => {});
    });
    return () => _task.cancel();
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
      setReviewResult({ score:'warn', issues:[t('x_motion_library_review_unavailable_check_connection')],
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
  const egStyles = makeEgStyles(colors);

  const styles = makeStyles(colors);
  const { caseId, caseTitle, prefill } = (route?.params as import('../types/api').RouteParams) ?? {};
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);

  const [phase,     setPhase]     = useState<Phase>('library');
  const [selected,  setSelected]  = useState<ReturnType<typeof MOTION_TYPES>[0] | null>(null);
  const [fields,    setFields]    = useState<Record<string, string>>({});
  const [editDraft, setEditDraft] = useState('');
  const [attorneyReviewed, setAttorneyReviewed] = useState(false);
  const [showExportGate, setShowExportGate]     = useState(false);
  const [reviewResult, setReviewResult]   = useState<{
    score: string; issues: string[]; suggestions: string[]; missing_fields: string[];
  } | null>(null);
  const [reviewing, setReviewing]         = useState(false);
  const [isOffline, setIsOffline] = React.useState(false);
  React.useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false);
    });
    return unsub;
  }, []);
  const [history,   setHistory]   = useState<any[]>([]);
  const [histLoading,setHistLoad] = useState(false);
  const [copied,    setCopied]    = useState(false);
  const [histFilter, setHistFilter] = useState<FilingStatus | 'all'>('all');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const { confirm } = useConfirm();

  // Pre-fill from case if provided
  useEffect(() => {
    if (prefill && typeof prefill === 'object') setFields(prev => ({ ...prev, ...(prefill as Record<string,string>) }));
  }, [prefill]);

  const loadHistory = useCallback(async () => {
    setHistLoad(true);
    try {
      markOnline();
      const res = await api.get('/motions/history');
      const motions = unwrapList(res.data, 'motions', 'history');
      setHistory(motions);
      cacheMotions(motions).catch(() => {});  // write-through cache for offline use
      setPhase('history');
    } catch (e: any) {
      showToast(t('x_golden_gavel_unable_load_please_check'), 'error'); __DEV__ && console.warn(e?.message); }
    setHistLoad(false);
  }, [showToast]);

  // Set header
  useEffect(() => {
    navigation.setOptions({
      title: phase === 'history' ? t('x_motion_library_motion_history')
           : phase === 'result'  ? t('x_motion_library_generated_motion')
           : t('x_nav_motion_library'),
      headerRight: () => phase === 'library' ? (
        <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={{ marginRight: 14 }} accessibilityLabel={t('x_discovery_history')} onPress={() => loadHistory()}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textBrand, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>{t('x_discovery_history')}</Text>
        </TouchableOpacity>
      ) : null });
  }, [colors.textBrand, phase, navigation, loadHistory]);




  const selectMotion = (m: ReturnType<typeof MOTION_TYPES>[0]) => {
    requireAuth(() => {
      setSelected(m);
      setFields(typeof prefill === 'object' && prefill ? prefill as Record<string,string> : {});
      setPhase('form');
    });
  };

  const generate = useCallback(async () => {
    if (!selected) return;
    if (!consentGranted) { setDisclaimerVisible(true); return; }
    setPhase('generating');
    try {
      const res = await api.post('/motions/generate', {
        motion_type: selected.key,
        fields,
        case_id: caseId ?? undefined });
      // Async path: backend returns jobId
      if (res.data?.jobId) {
        const jobId = res.data?.jobId;
        // Stay in 'generating' phase while polling
        const job = await pollJob(jobId, {
          timeoutMs: 210_000 });  // phase stays 'generating' -- the spinner keeps showing
        const content = (job.result as any)?.content || (job.result as any)?.draft || '';
        setEditDraft(content);
        Analytics.motionGenerated(selected.key);
      setPhase('result');
        return;
      }
      // Sync fallback
      setEditDraft(res.data?.draft || res.data?.content || '');
      setPhase('result');
    } catch (e: any) {
      const msg = apiErrorMessage(e, t('x_motion_library_could_not_generate_motion'));
      showToast(msg, 'info');
      setPhase('form');
    }
  }, [selected, fields, showToast, consentGranted, caseId]);

  const copyToClipboard = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(editDraft);
    } catch {
      showToast(t('x_motion_library_could_not_copy_please'), 'error');
      return;
    }
    hapticImpact().catch(() => {});
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2500);
  }, [editDraft, showToast]);

  const shareMotion = useCallback(async () => {
    // Require attorney-reviewed acknowledgment before every export
    // LegalZoom pattern: high-stakes documents gate on confirmation before delivery
    if (!attorneyReviewed) {
      setShowExportGate(true);
      return;
    }
    try {
      await RNShare.share({ message: editDraft, title: selected?.label || t('x_motion_library_motion') });
    } catch {
      // Share API unavailable on this browser/device — fail silently
    }
    setAttorneyReviewed(false); // reset for next export
  }, [editDraft, selected, attorneyReviewed]);

  const printMotion = useCallback(async () => {
    try {
      const Print   = await import('expo-print');
      const Sharing = await import('expo-sharing');
      const today = new Date().toLocaleDateString(locale(), {
        year: 'numeric', month: 'long', day: 'numeric' });
      const motionLabel = selected?.label || t('x_motion_library_pdf_motion');
      const bodyHtml = editDraft
        .split('\n')
        .map((line: string) => {
          if (!line.trim()) return '<p style="margin:0;height:10px"></p>';
          if (line === line.toUpperCase() && line.trim().length > 3) {
            return `<p style="text-align:center;font-weight:bold;margin:16px 0 8px">${escapeHtml(line.trim())}</p>`;
          }
          return `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`;
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
  <div class="hdr"><span>${escapeHtml(caseTitle || t('x_motion_library_pdf_case'))}</span><span>${escapeHtml(today)}</span></div>
  <h1>${escapeHtml(motionLabel)}</h1>
  <div class="disc">${escapeHtml(t('x_motion_library_pdf_disclaimer'))}</div>
  ${bodyHtml}
  <div class="footer">${escapeHtml(t('x_motion_library_pdf_footer'))}</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: t('x_motion_library_pdf_export', { motion: motionLabel }),
          UTI: 'com.adobe.pdf' });
      } else {
        await Print.printAsync({ html });
      }
    } catch {
      showToast(t('x_motion_library_could_not_generate_pdf'));
    }
  }, [editDraft, selected, caseTitle, showToast]);

  const deleteHistory = useCallback(async (id: number) => {
    confirm(t('x_motion_library_delete_motion_2'), t('x_discovery_this_cannot_be_undone'),
      { confirmLabel: t('case_delete'), destructive: true }).then(async ok => { if (!ok) return;
      await api.delete(`/motions/history/${id}`).catch((e) => { __DEV__ && console.warn(e?.message); });
        setHistory(h => h.filter(m => m.id !== id));
    });
  }, [confirm]);

  if (gated) return <BiometricLockView onUnlock={unlock} unlocking={unlocking} />;

  const fieldDefs = selected ? (FIELD_DEFS()[selected.key] || []) : [];
  const filledCount = fieldDefs.filter(f => fields[f.key]?.trim()).length;

  // ── RENDER: Library ───────────────────────────────────────────────────────
  if (phase === 'library') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={styles.libraryScroll} testID="motion-library">
      <View style={{ backgroundColor: colors.warnBg, borderRadius: 8, padding: 12, marginBottom: 12,
        borderLeftWidth: 4, borderLeftColor: colors.gold }}>
        <IconLabel icon={ICONS.lawyer} textStyle={{ color: colors.goldText, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12, marginBottom: 4 }} maxFontSizeMultiplier={1.4}>{t('x_motion_library_ai_generated_drafts_attorney')}</IconLabel>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>
          {t('x_motion_library_these_motions_ai_generated')}
        </Text>
      </View>
      <AuthGateModal />
      <LegalDisclaimerModal visible={disclaimerVisible} onAccept={onConsentAccepted} />
      {isOffline && (
        <View testID="motion-offline-banner" style={{ backgroundColor: colors.warnBg, borderRadius: 8, padding: 10, margin: 12, marginBottom: 0 }}>
          <IconLabel icon={ICONS.offline} textStyle={{ color: colors.warnDark, fontSize: 12 }} maxFontSizeMultiplier={1.4}>{t('x_motion_library_re_offline_drafting_motion')}</IconLabel>
        </View>
      )}

      {caseTitle && (
        <View style={[styles.casePill, { backgroundColor: COLORS.navy + '14', borderColor: COLORS.navy + '30' }]}>
          <IconLabel icon={ICONS.cases} textStyle={[styles.casePillText, { color: themeColors().textBrand }]} maxFontSizeMultiplier={1.4}>{caseTitle}</IconLabel>
        </View>
      )}
      <Text maxFontSizeMultiplier={1.4} style={[styles.pageTitle, { color: colors.textPrimary }]}>{t('x_cs_motion_library')}</Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.pageSub, { color: colors.textMuted }]}>
        {t('x_motion_library_ai_generated_court_ready')}
      </Text>

      {/* Value prop banner */}
      <View style={[styles.valueBanner, { backgroundColor: isDark ? colors.bgCard : colors.bgSubtle, borderColor: COLORS.navy + '33' }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.valueBannerText, { color: colors.textBrand }]}>
          {t('x_motion_library_average_time_saved_per')}{' '}<Text maxFontSizeMultiplier={1.4} style={{ fontFamily: 'Inter_800ExtraBold', fontWeight: '800' }}>{t('x_motion_library_1_3_hours')}</Text>
        </Text>
      </View>

      {/* Motion grid */}
      <View style={styles.grid}>
        {/* ── Suggested for the charges passed in from the case ── */}
        {relevantMotions.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { borderColor: colors.border }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHeaderText, { color: colors.textMuted }]}>{t('x_motion_library_suggested_charges')}</Text>
            </View>
            {MOTION_TYPES().filter(m => relevantMotions.includes(m.key)).map(m => (
              <MotionCard key={`rel-${m.key}`} m={m} onPress={() => selectMotion(m)} />
            ))}
          </>
        )}
        {/* ── Trial motions ── */}
        <View style={[styles.sectionHeader, { borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHeaderText, { color: colors.textMuted }]}>{t('x_motion_library_trial_motions')}</Text>
        </View>
        {TRIAL_MOTIONS().map(m => (
          <MotionCard key={m.key} m={m} onPress={() => selectMotion(m)} />
        ))}

        {/* ── Appeal & post-conviction ── */}
        <View style={[styles.sectionHeader, {
          borderColor: colors.emergency + '40',
          backgroundColor: colors.emergency + '08',
          marginTop: 12 }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHeaderText, { color: colors.emergency }]}>
            {t('x_motion_library_appeal_amp_post_conviction')}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionHeaderSub, { color: colors.emergency }]}>
            {t('x_motion_library_strict_deadlines_act_immediately')}
          </Text>
        </View>
        {APPEAL_MOTIONS().map(m => (
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
        <View style={[styles.deadlineBanner, { backgroundColor: colors.emergency }]}>
          <IconLabel icon={ICONS.alarm} textStyle={styles.deadlineBannerText} maxFontSizeMultiplier={1.4}>{selected.key === 'notice_of_appeal'
              ? t('x_motion_library_deadline_critical_federal_14')
              : t('x_motion_library_aedpa_1_year_statute')}</IconLabel>
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
          <AppIcon name={selected.icon} size={22} color={colors.textBrand} style={styles.selectedIcon} />
          <Text maxFontSizeMultiplier={1.4} style={[styles.selectedLabel, { color: selected.color }]}>{selected.label}</Text>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, {
            width: `${Math.round(filledCount / Math.max(fieldDefs.length, 1) * 100)}%`,
            backgroundColor: selected.color }]} />
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[styles.progressLabel, { color: colors.textMuted }]}>
          {t('x_motion_library_fields_completed', { filledCount, length: fieldDefs.length })}
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
              placeholderTextColor={colors.textSecond}
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
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={[styles.disclaimerText, { color: isDark ? colors.gold : colors.textSecond }]} maxFontSizeMultiplier={1.4}>{t('x_motion_library_ai_generated_drafts_require')}</IconLabel>
        </View>

        {/* Generate button */}
        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={[styles.generateBtn, { backgroundColor: selected.color }]}
          onPress={() => {
            confirm(t('motion_generate_confirm_title', { label: selected.label }), t('motion_generate_confirm_body'),
              { confirmLabel: t('motion_generate_confirm_btn') }).then(ok => { if (ok) generate(); });
          }}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.generateBtnText}>
            {t('motion_generate_btn', { label: selected.label })}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.backLink} accessibilityLabel={t('x_motion_library_back_library')} onPress={() => setPhase('library')}
          >
          <Text maxFontSizeMultiplier={1.4} style={[styles.backLinkText, { color: colors.textMuted }]}>{t('x_motion_library_back_library')}</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
    </View>
  );

  // Attorney-reviewed export gate (rendered in the result phase)
  const exportGate = (
    <>
      {/* ── Attorney-Reviewed Export Gate ────────────────────────────────────────
           LegalZoom pattern: require explicit confirmation before delivering
           high-stakes documents. A motion filed in a real court can create
           adverse precedent, waive rights, or prejudice a case if poorly drafted.
           This gate ensures the user has had the draft reviewed before exporting. */}
      {showExportGate && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowExportGate(false)}>
          <View style={egStyles.overlay}>
            <View style={egStyles.card}>
              <IconLabel icon={ICONS.lawyer} textStyle={egStyles.title} maxFontSizeMultiplier={1.4}>{t('x_motion_library_before_export')}</IconLabel>
              <Text maxFontSizeMultiplier={1.4} style={egStyles.body}>
                {t('x_motion_library_this_motion_draft_has')}{' '}
                <Text maxFontSizeMultiplier={1.4} style={egStyles.bold}>{t('x_motion_library_has_not_been_reviewed')}</Text>
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={egStyles.body}>
                {t('x_motion_library_filing_unreviewed_motion_can')}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                style={egStyles.reviewBtn}
                accessibilityLabel={t('x_motion_library_find_free_legal_help')} onPress={() => Linking.openURL('https://www.lawhelp.org/').catch(() => showToast(t('action_failed'), 'error'))}
              >
                <Text maxFontSizeMultiplier={1.4} style={egStyles.reviewBtnText}>{t('x_motion_library_find_free_legal_help')}</Text>
              </TouchableOpacity>
              <View style={egStyles.checkRow}>
                <TouchableOpacity
                  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                  onPress={() => setAttorneyReviewed(v => !v)}
                  style={egStyles.checkBox}
                  accessibilityState={{ checked: attorneyReviewed }}
                  accessibilityLabel={t('x_motion_library_i_have_reviewed_this')}
                >
                  <View style={[egStyles.checkInner, attorneyReviewed && egStyles.checkInnerChecked]}>
                    {attorneyReviewed && <Text maxFontSizeMultiplier={1.4} style={egStyles.checkMark}>✓</Text>}
                  </View>
                </TouchableOpacity>
                <Text maxFontSizeMultiplier={1.4} style={egStyles.checkLabel}>
                  {t('x_motion_library_i_have_reviewed_this_2')}
                </Text>
              </View>
              <View style={egStyles.btnRow}>
                <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                  style={egStyles.cancelBtn}
                  accessibilityLabel={t('x_firm_public_profile_go_back')} onPress={() => setShowExportGate(false)}
                >
                  <Text maxFontSizeMultiplier={1.4} style={egStyles.cancelBtnText}>{t('x_firm_public_profile_go_back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                  style={[egStyles.exportBtn, !attorneyReviewed && egStyles.exportBtnDisabled]}
                  onPress={() => {
                    setShowExportGate(false);
                    shareMotion();
                  }}
                  disabled={!attorneyReviewed}
                  accessibilityState={{ disabled: !attorneyReviewed }}>
                  <Text maxFontSizeMultiplier={1.4} style={[egStyles.exportBtnText, !attorneyReviewed && egStyles.exportBtnTextDisabled]}>{t('x_motion_library_export_motion')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );

  // ── RENDER: Generating ────────────────────────────────────────────────────
  if (phase === 'generating') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.centreWrap}>
        <ActivityIndicator size="large" color={selected?.color || COLORS.navy} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.generatingLabel, { color: colors.textPrimary }]}>
          {t('x_motion_library_drafting', { label: selected?.label })}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.generatingSub, { color: colors.textMuted }]}>
          {t('x_motion_library_applying_jurisdiction_rules_case')}
        </Text>
      </View>

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
        <View style={[styles.citationWarning, { backgroundColor: colors.bgSubtle, borderColor: COLORS.navy + '60', marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }]}>
          <IconLabel icon={ICONS.clipboard} textStyle={[styles.citationWarningTitle, { color: themeColors().textBrand }]} maxFontSizeMultiplier={1.4}>{t('x_motion_library_this_structural_draft_attorney')}</IconLabel>
          <Text maxFontSizeMultiplier={1.4} style={[styles.citationWarningBody, { color: isDark ? colors.steel : colors.blue }]}>
            {t('x_motion_library_complete_appellate_brief_requires')}
          </Text>
        </View>
      )}

      {/* Action bar */}
        <View style={styles.resultActionBar}>
          <TouchableOpacity accessibilityRole="button"

            style={[styles.resultAction, { backgroundColor: copied ? colors.legal : COLORS.navy }]}
            onPress={copyToClipboard}
            accessibilityLabel={t('x_motion_library_copy_motion_clipboard')}
          accessibilityHint={t('x_motion_library_copies_clipboard')}
          >
            <IconLabel icon={ICONS.clipboard} textStyle={styles.resultActionText} maxFontSizeMultiplier={1.4}>{copied ? t('x_motion_library_copied') : t('res_copy')}</IconLabel>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"

            style={[styles.resultAction, { backgroundColor: COLORS.blue }]}
            onPress={shareMotion}
            accessibilityLabel={t('x_motion_library_share_motion')}
          accessibilityHint={t('x_deadline_calculator_shares_this_information')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.resultActionText}>{t('x_bar_prep_explanation_share')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[styles.resultAction, { backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.steel }]}
            onPress={printMotion}
            accessibilityLabel={t('x_motion_library_export_motion_as_pdf')}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.resultActionText}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[styles.resultAction, { backgroundColor: colors.bgCard, borderWidth: 1.5, borderColor: colors.border }]}
            accessibilityLabel={t('x_motion_library_new')} onPress={() => { setPhase('library'); setSelected(null); setEditDraft(''); }}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.resultActionText, { color: colors.textSecond }]}>{t('x_motion_library_new')}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[styles.resultAction, { backgroundColor: colors.legal }]}
            onPress={() => navigation.navigate('LegalResearch', {
              initialQuery: selected
                ? `Precedent and case law supporting a ${selected.label} -- cite key cases`
                : '' })}
            accessibilityLabel={t('x_motion_library_research_precedent_this_motion')}
            >
            <IconLabel icon={ICONS.lawyer} textStyle={styles.resultActionText} maxFontSizeMultiplier={1.4}>{t('x_motion_library_research')}</IconLabel>
          </TouchableOpacity>
        </View>

              {/* AI Review button */}
              <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                style={{ flexDirection:'row', alignItems:'center', gap:8, paddingVertical:12,
                  paddingHorizontal:16, borderRadius:10, borderWidth:1,
                  borderColor:colors.border, backgroundColor:colors.bgSubtle,
                  marginBottom:8 }}
                onPress={reviewDraft}
          hitSlop={{  top: 12, bottom: 12, left: 12, right: 12  }}
                disabled={reviewing}
                accessibilityLabel={t('x_motion_library_run_ai_review_this')}
              >
                <AppIcon name="search-outline" size={20} color={themeColors().textBrand} />
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize:14, lineHeight:21,
                  fontWeight:'700', color:colors.textPrimary }}>
                  {reviewing ? t('x_motion_library_reviewing') : t('x_motion_library_ai_review_draft')}
                </Text>
              </TouchableOpacity>

              {/* Review results */}
              {reviewResult && (
                <View style={{ borderRadius:10, padding:14, marginBottom:8,
                  backgroundColor:
                    reviewResult.score==='pass' ? colors.legalBg :
                    reviewResult.score==='fail' ? colors.emergencyBg : colors.warnBg,
                  borderWidth:1,
                  borderColor:
                    reviewResult.score==='pass' ? colors.legalDark :
                    reviewResult.score==='fail' ? colors.emergencyDark : colors.warnDark }}>
                  <IconLabel icon={reviewResult.score==='pass' ? ICONS.statusOk : reviewResult.score==='fail' ? ICONS.statusError : ICONS.statusWarn} textStyle={{ fontSize:14, lineHeight:21,
                    fontWeight:'700', marginBottom:6,
                    color:
                      reviewResult.score==='pass' ? colors.legalDark :
                      reviewResult.score==='fail' ? colors.emergencyDark : colors.warnDark }} maxFontSizeMultiplier={1.4}>{reviewResult.score==='pass' ? t('x_motion_library_looks_good') :
                     reviewResult.score==='fail' ? t('x_motion_library_issues_found') : t('x_motion_library_minor_issues')}</IconLabel>
                  {reviewResult.missing_fields?.length > 0 && (
                    <Text maxFontSizeMultiplier={1.4} style={{ fontSize:13, lineHeight:19,
                      color:colors.emergencyDark, marginBottom:4 }}>
                      {t('x_motion_library_missing', { value: reviewResult.missing_fields.join(', ') })}
                    </Text>
                  )}
                  {reviewResult.issues?.map((issue: string, i: number) => (
                    <Text key={`item-${i}`} maxFontSizeMultiplier={1.4} style={{ fontSize:12,
                      lineHeight:18, color:colors.warnDark, marginBottom:2 }}>
                      • {issue}
                    </Text>
                  ))}
                  {reviewResult.suggestions?.length > 0 && (
                    <IconLabel icon={ICONS.idea} textStyle={{ fontSize:12, lineHeight:18,
                      color:themeColors().info, marginTop:4 }} maxFontSizeMultiplier={1.4}>{reviewResult.suggestions[0]}</IconLabel>
                  )}
                </View>
              )}

        {/* MANDATORY citation warning -- impossible to dismiss without reading */}
        <View style={[styles.citationWarning, { backgroundColor: isDark ? colors.bailBg : colors.warnBg, borderColor: colors.warnDark }]}>
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={[styles.citationWarningTitle, { color: colors.bail }]} maxFontSizeMultiplier={1.4}>{t('x_motion_library_required_verify_before_filing')}</IconLabel>
          <Text maxFontSizeMultiplier={1.4} style={[styles.citationWarningBody, { color: isDark ? colors.warn : colors.textSecond }]}>
            {t('x_motion_library_every_case_citation_this')}
          </Text>
        </View>

        {/* Info chip */}
        <View style={[styles.editChip, { backgroundColor: isDark ? colors.bgElevated : colors.bgSubtle, borderColor: colors.blue + '44' }]}>
          <IconLabel icon={ICONS.edit} textStyle={[styles.editChipText, { color: colors.info }]} maxFontSizeMultiplier={1.4}>{t('x_motion_library_review_edit_below_before')}</IconLabel>
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
            testID="motion-draft"
            value={editDraft}
            onChangeText={setEditDraft}
            textAlignVertical="top"
            selectionColor={COLORS.navy}
            accessibilityLabel={t('x_motion_library_editable_motion_draft_tap')}
            autoCorrect={false}
            spellCheck={false}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      {exportGate}
    </KeyboardAvoidingView>
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
        {(['all', ...Object.keys(FILING_STATUS())] as (FilingStatus | 'all')[]).map(key => {
          const cfg = key === 'all' ? null : FILING_STATUS()[key as FilingStatus];
          const active = histFilter === key;
          return (
            <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              key={key}
              style={[styles.histFilterChip, active && {
                backgroundColor: cfg ? cfg.bg : COLORS.navy + '14',
                borderColor: cfg ? cfg.color : themeColors().textBrand }]}
              onPress={() => setHistFilter(key)}
            >
              {key === 'all' || !cfg
                ? <Text maxFontSizeMultiplier={1.4} style={[styles.histFilterText, { color: active ? COLORS.navy : colors.textMuted }]}>{t('x_practice_area_selector_all')}</Text>
                : <IconLabel icon={cfg.icon} maxFontSizeMultiplier={1.4} textStyle={[styles.histFilterText, { color: active ? cfg.color : colors.textMuted }]}>{cfg.label}</IconLabel>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {histLoading
        ? <ActivityIndicator color={themeColors().textBrand} style={{ marginTop: 40 }} />
        : history.length === 0
        ? (
          <View style={styles.centreWrap}>
            <AppIcon name="document-outline" size={20} color={themeColors().textBrand} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.generatingLabel, { color: colors.textPrimary }]}>{t('x_motion_library_no_motions_yet')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.generatingSub, { color: colors.textMuted }]}>
              {t('x_motion_library_generate_first_motion_from')}
            </Text>
            <TouchableOpacity
  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              style={[styles.generateBtn, { backgroundColor: COLORS.navy, marginTop: 20, width: '100%' }]}
              accessibilityLabel={t('x_motion_library_back_library_2')} onPress={() => setPhase('library')}
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.generateBtnText, { color: colors.white }]}>{t('x_motion_library_back_library_2')}</Text>
            </TouchableOpacity>
          </View>
        )
        : filteredHistoryView.length === 0
        ? (
          <View style={styles.centreWrap}>
            <IconLabel icon={ICONS.document} textStyle={[styles.generatingSub, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{histFilter === 'all' ? t('x_motion_library_no_saved_motions_yet') : t('x_motion_library_no_motions_with_status', { value: FILING_STATUS()[histFilter as FilingStatus]?.label || histFilter })}</IconLabel>
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
                setSelected(MOTION_TYPES().find(m => m.key === h.motion_type) || null);
                setEditDraft(res.data?.draft);
                setPhase('result');
              }
            }}
            onDelete={deleteHistory}
          />
        ))
      }
      <AIDisclaimer variant="banner" />

    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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

  // Form
  formScroll: { padding: 16, paddingBottom: 40 },
  selectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg,
    borderWidth: 1.5, padding: 12, marginBottom: 14 },
  selectedIcon:  { fontSize: 22 },
  selectedLabel: { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },

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
  generateBtnText: { color: colors.textOnAccent, fontSize: 15, lineHeight: 22, ...FONTS.black },
  backLink:      { paddingVertical: 10, alignItems: 'center' },
  backLinkText:  { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Generating
  generatingLabel: { fontSize: 18, ...FONTS.heavy, textAlign: 'center', marginTop: 16, marginBottom: 6 },
  generatingSub:   { fontSize: 12, textAlign: 'center', lineHeight: 20 },

  // Result
  resultScroll:    { padding: 16, paddingBottom: 40 },
  resultActionBar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  resultAction:    { flex: 1, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center' },
  resultActionText:{ color: colors.textOnNavy, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
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
  // a full-width row inside the wrapping card grid
  sectionHeader:     { width: '100%', paddingHorizontal: 4, paddingVertical: 10, marginTop: 8, marginBottom: 4,
    borderRadius: RADIUS.md, borderWidth: 1, paddingLeft: 12 },
  sectionHeaderText: { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', letterSpacing: 1.2 },
  sectionHeaderSub:  { fontSize: 11, fontWeight: '600', marginTop: 2 },
  deadlineBanner:    { marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    borderRadius: RADIUS.md, padding: 12 },
  deadlineBannerText:{ color: colors.bgCard, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 17 },
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
const makeEgStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay:    { flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', alignItems:'center', padding:20 },
  card:       { backgroundColor:colors.bgCard, borderRadius:16, padding:20, width:'100%', maxWidth:420 },
  title:      { fontSize:18, fontWeight:'700', color:colors.textBrand, marginBottom:12, textAlign:'center' },
  body:       { fontSize:13, color:colors.info, lineHeight:20, marginBottom:12 },
  bold:       { fontWeight:'700', color:colors.textPrimary },
  reviewBtn:  { backgroundColor:colors.bgSubtle, borderRadius:8, padding:12, alignItems:'center', marginBottom:16 },
  reviewBtnText: { fontSize:13, fontWeight:'600', color:colors.info },
  checkRow:   { flexDirection:'row', alignItems:'flex-start', gap:10, marginBottom:16 },
  checkBox:   { marginTop:2, flexShrink:0 },
  checkInner: { width:22, height:22, borderRadius:4, borderWidth:2, borderColor:colors.textMuted, alignItems:'center', justifyContent:'center' },
  checkInnerChecked: { backgroundColor:colors.navy, borderColor:colors.navy },
  checkMark:  { color:colors.textOnNavy, fontSize:13, fontWeight:'700' }, // design-audit-ignore: rendered only when checked (navy fill)
  checkLabel: { flex:1, fontSize:12, color:colors.info, lineHeight:18 },
  btnRow:     { flexDirection:'row', gap:10 },
  cancelBtn:  { flex:1, borderRadius:10, borderWidth:1, borderColor:colors.border, padding:12, alignItems:'center' },
  cancelBtnText: { fontSize:14,
    lineHeight: 21, color:colors.info, fontWeight:'500' },
  exportBtn:  { flex:1, borderRadius:10, backgroundColor:colors.navy, padding:12, alignItems:'center' },
  exportBtnDisabled: { backgroundColor:colors.border },
  exportBtnText: { fontSize:14,
    lineHeight: 21, color:colors.textOnNavy, fontWeight:'700' },
  exportBtnTextDisabled: { color:colors.textSecond } });
export default React.memo(MotionLibraryScreen);