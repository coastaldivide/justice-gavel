import { RNShare } from '../utils/webCompat';
import { parseLocalDate } from '../utils/dateUtils';
import { scheduleReminder as postReminder } from '../services/reminders';
import { AIDisclaimer } from '../components/AIDisclaimer';
import { useToast } from '../components/ToastProvider';
import UPLDisclaimer from '../components/UPLDisclaimer';
/**
 * DeadlineCalculatorScreen -- Criminal defense deadline calculator
 *
 * Computes all critical deadlines from an arrest date or judgment date:
 *   - Arraignment window
 *   - Bail hearing deadline
 *   - Preliminary hearing
 *   - Speedy trial clock
 *   - Notice of Appeal (federal 14 days / state 30 days)
 *   - AEDPA habeas corpus (1 year from final conviction)
 *   - Motion to Suppress filing window
 *
 * Zero API calls. Pure date arithmetic + jurisdiction rules.
 * Works offline. Color-coded: red = ≤7 days, amber = ≤30, green = safe.
 *
 * Entry points:
 *   1. CaseScreen Tools tab
 *   2. MoreStack navigator
 */
import React, { useState, useMemo } from 'react';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, RefreshControl, LayoutAnimation } from 'react-native';
import { getUserState, stateName } from '../utils/userState';
import { t, useLang, perLang, locale } from '../i18n';

// ── Deadline rules per stage ──────────────────────────────────────────────────
interface DeadlineRule {
  label:       string;
  icon:        string;
  description: string;
  compute:     (arrestDate: Date, judgmentDate: Date | null, state: string) => Date | null;
  note:        string;
}


// ── DMV DUI license hearing deadline (days from arrest) ─────────────────────
const STATE_DMV_DUI_DAYS: Record<string, number> = {
  AK: 7,  // 7 days to request hearing
  AL: 10,  // 10 days to request hearing
  AR: 7,  // 7 days to request hearing
  AZ: 15,  // 15 days to request hearing
  CA: 10,  // 10 days to request hearing
  CO: 7,  // 7 days to request hearing
  CT: 7,  // 7 days to request hearing
  DC: 10,  // 10 days to request hearing
  DE: 15,  // 15 days to request hearing
  FL: 10,  // 10 days to request hearing
  GA: 10,  // 10 days to request hearing
  HI: 6,  // 6 days to request hearing
  IA: 10,  // 10 days to request hearing
  ID: 7,  // 7 days to request hearing
  IL: 46,  // 46 days to request hearing
  IN: 10,  // 10 days to request hearing
  KS: 14,  // 14 days to request hearing
  KY: 30,  // 30 days to request hearing
  LA: 15,  // 15 days to request hearing
  MA: 15,  // 15 days to request hearing
  MD: 10,  // 10 days to request hearing
  ME: 10,  // 10 days to request hearing
  MI: 14,  // 14 days to request hearing
  MN: 7,  // 7 days to request hearing
  MO: 15,  // 15 days to request hearing
  MS: 10,  // 10 days to request hearing
  MT: 20,  // 20 days to request hearing
  NC: 10,  // 10 days to request hearing
  ND: 25,  // 25 days to request hearing
  NE: 10,  // 10 days to request hearing
  NH: 30,  // 30 days to request hearing
  NJ: 10,  // 10 days to request hearing
  NM: 20,  // 20 days to request hearing
  NV: 7,  // 7 days to request hearing
  NY: 7,  // 7 days to request hearing
  OH: 30,  // 30 days to request hearing
  OK: 15,  // 15 days to request hearing
  OR: 10,  // 10 days to request hearing
  PA: 10,  // 10 days to request hearing
  RI: 10,  // 10 days to request hearing
  SC: 30,  // 30 days to request hearing
  SD: 10,  // 10 days to request hearing
  TN: 30,  // 30 days to request hearing (TCA § 55-10-406)
  TX: 15,  // 15 days to request hearing
  UT: 10,  // 10 days to request hearing
  VA: 7,  // 7 days to request hearing
  VT: 7,  // 7 days to request hearing
  WA: 20,  // 20 days to request hearing
  WI: 10,  // 10 days to request hearing
  WV: 15,  // 15 days to request hearing
  WY: 20,  // 20 days to request hearing
};

const DEADLINE_RULES = perLang((): DeadlineRule[] => [
  {
    label: t('whn_dui_3_title'),
    icon:  '🏛️',
    description: t('x_deadline_calculator_first_court_appearance_charges'),
    note: t('x_deadline_calculator_most_states_48_72'),
    compute: (arrest, _, state) => {
      const d = new Date(arrest);
      const hrs = (state && STATE_ARRAIGNMENT_HRS[state]) || 72;
      d.setHours(d.getHours() + hrs);
      return d;
    } },
  {
    label: t('x_deadline_calculator_dmv_license_hearing_dui'),
    icon:  '🚗',
    description: t('x_deadline_calculator_deadline_request_hearing_keep'),
    note: t('x_deadline_calculator_only_applies_dui_dwi'),
    compute: (arrest, _, state) => {
      const days = state ? STATE_DMV_DUI_DAYS[state] : undefined;
      if (!days) return null;
      const d = new Date(arrest);
      d.setDate(d.getDate() + days);
      return d;
    } },
  {
    label: t('whn_dui_4_title'),
    icon:  '🔓',
    description: t('x_deadline_calculator_right_bail_determination'),
    note: t('x_deadline_calculator_most_states_require_bail'),
    compute: (arrest) => {
      const d = new Date(arrest);
      d.setHours(d.getHours() + 48);
      return d;
    } },
  {
    label: t('x_deadline_calculator_preliminary_hearing'),
    icon:  '📋',
    description: t('x_deadline_calculator_probable_cause_hearing_felony'),
    note: t('x_deadline_calculator_federal_within_14_days'),
    compute: (arrest) => {
      const d = new Date(arrest);
      d.setDate(d.getDate() + 14);
      return d;
    } },
  {
    label: t('x_deadline_calculator_speedy_trial_assert_right'),
    icon:  '⏱️',
    description: t('x_deadline_calculator_deadline_formally_assert_6th'),
    note: t('x_deadline_calculator_assert_writing_as_early'),
    compute: (arrest, _, state) => {
      const d = new Date(arrest);
      const days = (state && STATE_SPEEDY_TRIAL_DAYS[state]) || 30;
      d.setDate(d.getDate() + days);
      return d;
    } },
  {
    label: t('x_deadline_calculator_federal_speedy_trial_act'),
    icon:  '⚖️',
    description: t('x_deadline_calculator_federal_trial_must_begin'),
    note: t('x_deadline_calculator_18_u_s_c'),
    compute: (arrest) => {
      const d = new Date(arrest);
      d.setDate(d.getDate() + 70);
      return d;
    } },
  {
    label: t('x_deadline_calculator_notice_appeal_federal'),
    icon:  '📣',
    description: t('x_deadline_calculator_14_day_deadline_from'),
    note: t('x_deadline_calculator_fed_r_app_p'),
    compute: (_, judgment) => {
      if (!judgment) return null;
      const d = new Date(judgment);
      d.setDate(d.getDate() + 14);
      return d;
    } },
  {
    label: t('x_deadline_calculator_notice_appeal_state_30'),
    icon:  '📣',
    description: t('x_deadline_calculator_30_day_deadline_from'),
    note: t('x_deadline_calculator_verify_state_s_exact'),
    compute: (_, judgment) => {
      if (!judgment) return null;
      const d = new Date(judgment);
      d.setDate(d.getDate() + 30);
      return d;
    } },
  {
    label: t('x_deadline_calculator_aedpa_habeas_corpus'),
    icon:  '⚖️',
    description: t('x_deadline_calculator_1_year_limit_from'),
    note: t('x_deadline_calculator_28_u_s_c'),
    compute: (_, judgment, state) => {
      if (!judgment) return null;
      const d = new Date(judgment);
      const yrs = (state && STATE_PCR_YEARS[state]) || 1;
      d.setFullYear(d.getFullYear() + yrs);
      return d;
    } },
  {
    label: t('x_deadline_calculator_state_pcr_petition'),
    icon:  '📜',
    description: t('x_deadline_calculator_post_conviction_relief_state'),
    note: t('x_deadline_calculator_varies_widely_by_state'),
    compute: (_, judgment) => {
      if (!judgment) return null;
      const d = new Date(judgment);
      d.setFullYear(d.getFullYear() + 1);
      return d;
    } },
]);

// ── State-specific arraignment / bail deadline overrides ─────────────────────
// Sources: published state statutes, last verified April 2026.
// Only overrides where the state differs materially from federal/common standard.
const STATE_ARRAIGNMENT_HRS: Record<string, number> = {
  CA: 48, TX: 48, NY: 24, FL: 24, IL: 48, PA: 72, OH: 48, GA: 72,
  MI: 48, NC: 48, NJ: 24, VA: 72, WA: 72, AZ: 24, MA: 24, TN: 72,
  IN: 48, MO: 48, MD: 24, WI: 48, CO: 48, MN: 36, SC: 48, AL: 72,
  LA: 72, KY: 48, OR: 36, OK: 48, CT: 24, UT: 72, IA: 48, NV: 48,
  AR: 48, MS: 48, KS: 48, NM: 48, NE: 48, ID: 48, WV: 48, HI: 48,
  NH: 24, ME: 48, MT: 72, RI: 24, DE: 24, SD: 48, ND: 48, AK: 24,
  VT: 48, WY: 72, DC: 24 };

// States with notable speedy trial rules (days to assert)
const STATE_SPEEDY_TRIAL_DAYS: Record<string, number> = {
  AK: 120,
  AL: 180,
  AR: 175,
  AZ: 150,
  CA: 60,
  CO: 180,
  CT: 180,
  DC: 100,
  DE: 180,
  FL: 90,
  GA: 180,
  HI: 180,
  IA: 90,
  ID: 180,
  IL: 120,
  IN: 70,
  KS: 180,
  KY: 180,
  LA: 120,
  MA: 365,
  MD: 180,
  ME: 180,
  MI: 180,
  MN: 60,
  MO: 180,
  MS: 270,
  MT: 180,
  NC: 120,
  ND: 90,
  NE: 180,
  NH: 180,
  NJ: 180,
  NM: 180,
  NV: 60,
  NY: 90,
  OH: 90,
  OK: 180,
  OR: 60,
  PA: 365,
  RI: 180,
  SC: 180,
  SD: 180,
  TN: 75,
  TX: 180,
  UT: 180,
  VA: 175,
  VT: 180,
  WA: 60,
  WI: 90,
  WV: 180,
  WY: 180,
};

// State PCR petition windows (years)
const STATE_PCR_YEARS: Record<string, number> = {
  AK: 1,
  AL: 2,
  AR: 3,
  AZ: 2,
  CA: 2,
  CO: 2,
  CT: 5,
  DC: 2,
  DE: 3,
  FL: 2,
  GA: 4,
  HI: 1,
  IA: 3,
  ID: 5,
  IL: 6,
  IN: 1,
  KS: 1,
  KY: 3,
  LA: 2,
  MA: 3,
  MD: 10,
  ME: 1,
  MI: 1,
  MN: 2,
  MO: 1,
  MS: 1,
  MT: 1,
  NC: 5,
  ND: 2,
  NE: 1,
  NH: 3,
  NJ: 5,
  NM: 2,
  NV: 1,
  NY: 1,
  OH: 1,
  OK: 1,
  OR: 2,
  PA: 1,
  RI: 3,
  SC: 1,
  SD: 1,
  TN: 1,
  TX: 0,
  UT: 1,
  VA: 2,
  VT: 3,
  WA: 1,
  WI: 2,
  WV: 1,
  WY: 1,
};


function getStateName(code: string): string {
  return stateName(code) || code;
}

// ── Color coding ──────────────────────────────────────────────────────────────
function deadlineColor(deadline: Date, today: Date): 'red' | 'amber' | 'green' | 'gray' {
  const daysUntil = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0)  return 'gray';
  if (daysUntil <= 7) return 'red';
  if (daysUntil <= 30) return 'amber';
  return 'green';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(locale(), { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

function daysLabel(deadline: Date, today: Date): string {
  const days = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0)  return t('x_deadline_calculator_days_ago', { days: Math.abs(days) });
  if (days === 0) return t('x_deadline_calculator_today');
  if (days === 1) return t('x_date_utils_tomorrow');
  return t('x_deadline_calculator_days_away', { days });
}

function parseDate(str: string): Date | null {
  if (!str.trim()) return null;
  return parseLocalDate(str.trim());
}

// ── Deadline row ──────────────────────────────────────────────────────────────
function DeadlineRow({ rule, arrest, judgment, today, isDark, state }: {
  rule: DeadlineRule; arrest: Date | null; judgment: Date | null;
  today: Date; isDark: boolean; state?: string;
}) {
  useLang();
  const { showToast } = useToast();
  const [remindLoading, setRemindLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const deadline = arrest ? rule.compute(arrest, judgment, state || '') : null;

  const addToCalendar = React.useCallback(async (title: string, dueDate: Date) => {
    try {
      const Calendar = await import('expo-calendar');
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        showToast(t('x_deadline_calculator_enable_calendar_access_settings'));
        return;
      }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const defaultCal = calendars.find(cal => cal.isPrimary) || calendars[0];
      if (!defaultCal) {
        showToast(t('x_deadline_calculator_could_not_locate_calendar'));
        return;
      }
      const start = new Date(dueDate);
      start.setHours(9, 0, 0, 0);
      const end = new Date(start);
      end.setHours(17, 0, 0, 0);
      await Calendar.createEventAsync(defaultCal.id, {
        title: t('x_deadline_calculator_justice_gavel_deadline', { title }),
        startDate: start,
        endDate: end,
        alarms: [
          { relativeOffset: -60 * 24 * 7 },  // 1 week before
          { relativeOffset: -60 * 24 },       // 1 day before
          { relativeOffset: -60 * 2 },        // 2 hours before
        ],
        notes: t('x_deadline_calculator_calculated_by_justice_gavel'),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      showToast(t('x_deadline_calculator_added_calendar_with_reminders', { title }), 'success');
    } catch {
      showToast(t('x_deadline_calculator_could_not_add_event'));
    }
  }, [showToast]);

  // Schedule a push notification reminder 3 days before a deadline
  const scheduleReminder = async (label: string, due: Date) => {
    const remind3Days = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 3, 9, 0, 0, 0);
    if (remind3Days <= new Date()) {
      showToast(t('x_deadline_calculator_this_deadline_within_3'));
      return;
    }
    setRemindLoading(true);
    try {
      await postReminder({
        title: t('x_deadline_calculator_deadline_3_days'),
        body: label + ' -- ' + due.toLocaleDateString(locale(),
          { month: 'short', day: 'numeric', year: 'numeric' }),
        deliverAt: remind3Days });
      showToast(t('x_deadline_calculator_reminder_set_3_days'), 'success');
    } catch {
      showToast(t('x_deadline_calculator_make_sure_re_signed'), 'info');
    } finally {
      setRemindLoading(false);
    }
  };

  if (!deadline) {
  return (
      <View style={[styles.row, { backgroundColor: COLORS.bgCard, borderColor: COLORS.border, opacity: 0.5 }]}
        testID="deadline-calculator-screen">
        <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20 }}>{rule.icon}</Text>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.rowLabel, { color: COLORS.textSecond }]}>{rule.label}</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.rowSub, { color: COLORS.textSecond }]}>
            {rule.label.includes('Appeal') || rule.label.includes('Habeas') || rule.label.includes('PCR')
              ? t('x_deadline_calculator_enter_judgment_date_above')
              : t('x_deadline_calculator_enter_arrest_date_above')}
          </Text>


        </View>
      </View>
    );
  }
  const status = deadlineColor(deadline, today);
  const COLOR_MAP = {
    red:   { bg: isDark ? COLORS.emergencyBg : COLORS.emergencyBg, border: COLORS.emergencyDark, text: COLORS.emergencyDark },
    amber: { bg: isDark ? COLORS.bailBg : COLORS.warnBg, border: COLORS.warnDark, text: COLORS.warnDark },
    green: { bg: isDark ? COLORS.legalBg : COLORS.legalBg, border: COLORS.legalDark, text: COLORS.legalDark },
    gray:  { bg: COLORS.bgCard,                  border: COLORS.border, text: COLORS.textSecond } };
  const col = COLOR_MAP[status];


  return (
    <TouchableOpacity
      accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      style={[styles.row, { backgroundColor: col.bg, borderColor: col.border }]}
      onPress={() => setExpanded(p => !p)}
      activeOpacity={0.85}
      accessibilityLabel={`${rule.label}: ${formatDate(deadline)}`}
    >
      <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20 }}>{rule.icon}</Text>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.rowLabel, { color: COLORS.textPrimary }]}>{rule.label}</Text>
          <View style={[styles.daysBadge, { backgroundColor: col.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.daysBadgeText}>{daysLabel(deadline, today)}</Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[styles.rowDate, { color: col.text }]}>{formatDate(deadline)}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.rowDesc, { color: COLORS.textSecond }]}>{rule.description}</Text>
        {expanded && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.rowNote, { color: COLORS.textMuted, borderTopColor: COLORS.border }]}>
            {rule.note}
          </Text>
        )}
        {expanded && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('x_deadline_calculator_remind_me_3_days', { label: rule.label })}
              onPress={() => scheduleReminder(rule.label, deadline)}
              disabled={remindLoading}
              style={{ marginTop: 6, marginRight: 8, flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
                borderWidth: 1, borderColor: COLORS.navy + '40',
                backgroundColor: COLORS.navy + '08', alignSelf: 'flex-start', opacity: remindLoading ? 0.6 : 1 }}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 18,
                color: COLORS.navy, fontFamily: 'Inter_600SemiBold', fontWeight: '600' }}>
                {remindLoading ? t('x_deadline_calculator_setting') : t('x_deadline_calculator_remind_me')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('x_deadline_calculator_add_calendar', { label: rule.label })}
              onPress={() => addToCalendar(rule.label, deadline)}
              style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
                borderWidth: 1, borderColor: COLORS.border,
                backgroundColor: COLORS.bgCard, alignSelf: 'flex-start' }}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, lineHeight: 18, color: COLORS.info,
                fontFamily: 'Inter_600SemiBold', fontWeight: '600' }}>
                {t('x_deadline_calculator_calendar')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <Text maxFontSizeMultiplier={1.4} style={[{ color: COLORS.textMuted, marginLeft: 6 }]}>{expanded ? '▲' : '▼'}</Text>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
function DeadlineCalculatorScreen(): React.JSX.Element {
  useLang();
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);



  // User's state -- loaded once on mount for state-specific deadlines
  const [userState, setUserStateLocal] = React.useState('');
  const [stateName, setStateName] = React.useState('');
  React.useEffect(() => {
    getUserState().then(s => {
      if (s?.code) { setUserStateLocal(s.code); setStateName(getStateName(s.code)); }
    }).catch(() => {});
  }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200)
  }, []);

  const today = useMemo(() => new Date(), []);

  const [arrestInput,   setArrestInput]   = useState('');
  const [judgmentInput, setJudgmentInput] = useState('');

  const arrestDate   = parseDate(arrestInput);
  const judgmentDate = parseDate(judgmentInput);

  const urgentCount = useMemo(() => {
    if (!arrestDate) return 0;
    return DEADLINE_RULES().filter(r => {
      const d = r.compute(arrestDate, judgmentDate, userState);
      if (!d) return false;
      const status = deadlineColor(d, today);
      return status === 'red' || status === 'amber';
    }).length;
  }, [arrestDate, judgmentDate, today, userState]);

  return (
    <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps='handled' style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      <UPLDisclaimer compact />

      {/* Header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.title, { color: colors.textPrimary }]}>{t('x_cs_deadline_calculator')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.sub, { color: colors.textMuted }]}>
          {t('x_deadline_calculator_enter_dates_compute_all')}
        </Text>
      </View>

      {/* Date inputs */}
      <View style={[styles.inputCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.inputLabel, { color: colors.textMuted }]}>{t('x_deadline_calculator_arrest_date')}</Text>
        <TextInput
          style={[styles.dateInput, { borderColor: colors.border, color: colors.textPrimary,
            backgroundColor: colors.bg }]}
          value={arrestInput}
          onChangeText={setArrestInput}
          placeholder={t('x_deadline_calculator_e_g_march_10')}
          placeholderTextColor={colors.textSecond}
          keyboardType="default"
          returnKeyType="next"
          blurOnSubmit
        />
        <Text maxFontSizeMultiplier={1.4} style={[styles.inputLabel, { color: colors.textMuted, marginTop: 12 }]}>
          {t('x_deadline_calculator_judgment_conviction_date_appeal')}
        </Text>
        <TextInput
          style={[styles.dateInput, { borderColor: colors.border, color: colors.textPrimary,
            backgroundColor: colors.bg }]}
          value={judgmentInput}
          onChangeText={setJudgmentInput}
          placeholder={t('x_deadline_calculator_e_g_march_21')}
          placeholderTextColor={colors.textSecond}
          keyboardType="default"
          accessibilityLabel={t('x_deadline_calculator_judgment_date')}
          returnKeyType="next"
          blurOnSubmit
        />
        {!arrestDate && arrestInput.length > 0 && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.parseError, { color: colors.emergency }]}>
            {t('x_deadline_calculator_cannot_parse_date_try')}
          </Text>
        )}
      </View>

      {/* Urgent banner */}
      {urgentCount > 0 && (
        <View style={[styles.urgentBanner, { backgroundColor: isDark ? colors.emergencyBg : colors.emergencyBg,
          borderColor: colors.emergencyDark }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.urgentText, { color: colors.emergencyDark }]}>
            {t(urgentCount === 1 ? 'x_deadline_calculator_deadline_require_immediate_attention_one' : 'x_deadline_calculator_deadline_require_immediate_attention_other', { urgentCount })}
          </Text>
        </View>
      )}

      {/* Color legend */}
      <View style={[styles.legend, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {[
          { color: colors.emergencyDark, label: t('x_deadline_calculator_7_days_act_today') },
          { color: colors.warnDark, label: t('x_deadline_calculator_30_days_urgent') },
          { color: colors.legalDark, label: t('x_deadline_calculator_30_days_scheduled') },
          { color: colors.textSecond, label: t('x_deadline_calculator_past_not_applicable') },
        ].map((item, i) => (
          <View key={`item-${i}`} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.legendText, { color: colors.textSecond }]}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Deadlines */}
      {!!stateName && (
        <Text testID="deadline-state-note" maxFontSizeMultiplier={1.4} style={[styles.legendText, { color: colors.textSecond, marginBottom: 8 }]}>
          {t('x_deadline_calculator_using_rules_where_deadlines', { stateName })}
        </Text>
      )}
      <View style={styles.deadlineList}>
        {DEADLINE_RULES().map((rule, i) => (
          <DeadlineRow
            key={`DEADLINE-${i}`}
            rule={rule}
            arrest={arrestDate}
            judgment={judgmentDate}
            today={today}
            isDark={isDark}
            state={userState}
          />
        ))}
      </View>

      {/* Disclaimer */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimer, { color: colors.textSecond }]}>
        {t('x_deadline_calculator_deadlines_general_estimates_verify')}
      </Text>

      <View style={{ height: 40 }} />

        <TouchableOpacity
          accessibilityRole="button"

          style={{ backgroundColor:colors.navy, borderRadius:10, padding:14,
            alignItems:'center', marginHorizontal:16, marginBottom:12 }}
          onPress={async () => {
          try {
              await RNShare.share({
                message: t('x_deadline_calculator_justice_gavel_deadline_calculator'),
                title: t('x_deadline_calculator_legal_deadlines') });
            } catch {}
          }}
          accessibilityLabel={t('x_deadline_calculator_share_deadline_results')}
          accessibilityHint={t('x_deadline_calculator_shares_this_information')}
        >
          <Text maxFontSizeMultiplier={1.4} style={{ color:colors.textOnNavy, fontWeight:'700', fontSize:14 }}>
            {t('x_deadline_calculator_share_results')}
          </Text>
        </TouchableOpacity>

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 10,
        borderLeftWidth: 4, borderLeftColor: colors.warn,
        padding: 12, marginTop: 16, marginBottom: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 16,
          color: colors.textSecond, fontStyle: 'italic' }}>
          {t('x_deadline_calculator_critical_deadlines_shown_general')}
        </Text>
      </View>

      </ScrollView>
      <AIDisclaimer variant="banner" />

      </KeyboardAvoidingView>
  );
}

const makeStyles = () => StyleSheet.create({
  screen:       { flex: 1 },
  scroll:       { padding: 16, paddingBottom: 40 },
  header:       { marginBottom: 16 },
  title:        { fontSize: 22, ...FONTS.black, marginBottom: 4 },
  sub:          { fontSize: 12, lineHeight: 19 },

  inputCard:    { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 12, ...SHADOW.sm },
  inputLabel:   { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  dateInput:    { borderWidth: 1.5, borderRadius: RADIUS.md, padding: 11, fontSize: 14,
    lineHeight: 21 },
  parseError:   { fontSize: 11, marginTop: 4 },

  urgentBanner: { borderRadius: RADIUS.md, borderWidth: 2, padding: 12, marginBottom: 10 },
  urgentText:   { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700', textAlign: 'center' },

  legend:       { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginBottom: 16,
    flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:    { width: 10, height: 10, borderRadius: 4 },
  legendText:   { fontSize: 11 },

  deadlineList: { gap: 8, marginBottom: 16 },
  row:          { borderRadius: RADIUS.md, borderWidth: 1.5, padding: 12,
    flexDirection: 'row', alignItems: 'flex-start', ...SHADOW.sm },
  rowLabel:     { fontSize: 12, lineHeight: 20, fontWeight: '700', flex: 1, marginRight: 6 },
  rowDate:      { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginTop: 2 },
  rowDesc:      { fontSize: 11, marginTop: 3, lineHeight: 16 },
  rowNote:      { fontSize: 11, marginTop: 8, lineHeight: 16, paddingTop: 8, borderTopWidth: 1 },
  rowSub:       { fontSize: 11, marginTop: 2 },

  daysBadge:    { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  daysBadgeText:{ color: COLORS.bgCard, fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  disclaimer:   { fontSize: 11, lineHeight: 17, textAlign: 'center', fontStyle: 'italic' } });

// Module-level fallback for helper components
const styles = makeStyles();
export default React.memo(DeadlineCalculatorScreen);