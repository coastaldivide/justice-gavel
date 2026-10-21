import { useToast } from '../components/ToastProvider';
import { SkeletonLoader } from '../components/SkeletonLoader';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, LayoutAnimation} from 'react-native';
import { api } from '../services/api';
import { getToken } from '../utils/secureStorage';
import { useTheme, COLORS, themed, type ThemeColors } from '../constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { t, useLang, perLang } from '../i18n';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';

interface GavelCriteria {
  avg_rating?: number;
  consultations_booked?: number;
  leads_accepted?: number;
  lessons_completed?: boolean | number;
  lessons_started?: boolean | number;
  min_reviews?: number;
  months_active?: number;
}


// ── Constants ─────────────────────────────────────────────────────────────────
const GAVEL_ICON  = { 0: ICONS.gavel, 1: ICONS.medal, 2: ICONS.medal, 3: ICONS.trophy } as const;
const GAVEL_LABEL = perLang(() => ({ 0: t('x_firm_vertical_none'), 1: t('x_golden_gavel_bronze'), 2: t('x_golden_gavel_silver'), 3: t('x_golden_gavel_golden') } as const));
const GAVEL_COLOR  = themed(colors => ({
  0: { bg: colors.bg, text: colors.textMuted, border: colors.border, header: colors.textMuted },
  1: { bg: colors.bailBg, text: colors.bail, border: colors.bail, header: colors.bail },
  2: { bg: colors.bgSubtle, text: colors.textSecond, border: colors.border, header: colors.textMuted },
  3: { bg: colors.warnBg, text: colors.gold, border: colors.gold, header: colors.gold },
} as const));

// ── Types ─────────────────────────────────────────────────────────────────────
type GavelLevel = 0 | 1 | 2 | 3;
interface Status {
  gavel_level: GavelLevel;
  level_label: string;
  level_emoji: string;
  awarded_at: string | null;
  bronze_at:  string | null;
  silver_at:  string | null;
  golden_at:  string | null;
  tier_type:  string | null;
}
interface Progress {
  user_type: string;
  months_active: number;
  compliance_flags: number;
  consultations_booked?: number;
  avg_rating?: number;
  review_count?: number;
  bar_verified?: boolean;
  lessons_completed?: boolean;
  lessons_started?: boolean;
  leads_accepted?: number;
  license_verified?: boolean;
}
interface EligResult {
  level: GavelLevel;
  level_label: string;
  user_type: string;
  progress: Progress;
  next_level_label: string | null;
  missing_for_next: string[];
  criteria: Record<string, unknown>;
}
interface HallEntry {
  display_name: string;
  tier: string;
  state: string;
  people_helped: number;
  gavel_level: GavelLevel;
  level_label: string;
  level_emoji: string;
  featured: number;
}

// ── Criterion row ─────────────────────────────────────────────────────────────
function CritRow({ label, met }: { label: string; met: boolean }) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.critRow}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.critIcon, { color: met ? colors.legalDark : colors.emergencyDark }]}>
        {met ? '✓' : '✗'}
      </Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.critLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

// ── Journey bar ───────────────────────────────────────────────────────────────
function JourneyBar({ level }: { level: GavelLevel }) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const steps: GavelLevel[] = [1, 2, 3];
  return (
    <View style={styles.journeyRow}
      testID="golden-gavel-screen">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && (
            <View style={[styles.journeyLine, { backgroundColor: level >= s ? GAVEL_COLOR[s].border : colors.border }]} />
          )}
          <View style={[styles.journeyStep,
            { backgroundColor: level >= s ? GAVEL_COLOR[s].bg : colors.bg,
              borderColor:      level >= s ? GAVEL_COLOR[s].border : colors.border }]}>
            <AppIcon name={level >= s ? GAVEL_ICON[s] : ICONS.radioOff} size={22} color={level >= s ? GAVEL_COLOR[s].text : colors.textMuted} style={styles.journeyEmoji} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.journeyLabel, { color: level >= s ? GAVEL_COLOR[s].text : colors.textMuted }]}>
              {GAVEL_LABEL()[s]}
            </Text>
          </View>
        </React.Fragment>
      ))
          }
    </View>
  );
}

// ── Criteria section for one level ───────────────────────────────────────────
function CriteriaSection({ title, progress, criteria, earned }:
  { title: string; progress: Progress; criteria: Record<string, unknown>; earned: boolean }) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (!criteria) return null;
  const { user_type: ut } = progress;

  return (
    <View style={[styles.critSection, { borderColor: earned ? colors.legal : colors.border }]}>
      <View style={styles.critSectionHeader}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.critSectionTitle, { color: colors.textPrimary }]}>{title}</Text>
        {earned && <Text maxFontSizeMultiplier={1.4} style={styles.earnedTag}>{t('x_golden_gavel_earned')}</Text>}
      </View>

      {ut === 'attorney' && <>
        <CritRow
          label={t('x_golden_gavel_active_months', { months_active: progress.months_active, value: ((criteria as GavelCriteria).months_active ?? 0) })}
          met={progress.months_active >= ((criteria as GavelCriteria).months_active ?? 0)} />
        <CritRow
          label={t('x_golden_gavel_consultations', { value: progress.consultations_booked ?? 0, value2: ((criteria as GavelCriteria).consultations_booked ?? 0) })}
          met={(progress.consultations_booked ?? 0) >= ((criteria as GavelCriteria).consultations_booked ?? 0)} />
        <CritRow
          label={t('x_golden_gavel_rating_min_reviews_need', { value: progress.avg_rating ?? 0, value2: ((criteria as GavelCriteria).avg_rating ?? 0), value3: progress.review_count ?? 0, value4: ((criteria as GavelCriteria).min_reviews ?? 0) })}
          met={(progress.avg_rating ?? 0) >= ((criteria as GavelCriteria).avg_rating ?? 0) && (progress.review_count ?? 0) >= ((criteria as GavelCriteria).min_reviews ?? 0)} />
        <CritRow label={t("golden_gavel.bar_verified")}  met={!!progress.bar_verified} />
        <CritRow label={t("golden_gavel.zero_flags")} met={progress.compliance_flags === 0} />
      </>}

      {ut === 'consumer' && <>
        <CritRow
          label={t('x_golden_gavel_active_months', { months_active: progress.months_active, value: ((criteria as GavelCriteria).months_active ?? 0) })}
          met={progress.months_active >= ((criteria as GavelCriteria).months_active ?? 0)} />
        {!!(criteria as GavelCriteria).lessons_started && !(criteria as GavelCriteria).lessons_completed &&
          <CritRow label={t('x_golden_gavel_started_at_least_one')} met={!!progress.lessons_started} />}
        {!!(criteria as GavelCriteria).lessons_completed &&
          <CritRow label={t('x_golden_gavel_all_lessons_completed')} met={!!progress.lessons_completed} />}
        <CritRow label={t("golden_gavel.zero_flags")} met={progress.compliance_flags === 0} />
      </>}

      {ut === 'bondsman' && <>
        <CritRow
          label={t('x_golden_gavel_active_months', { months_active: progress.months_active, value: ((criteria as GavelCriteria).months_active ?? 0) })}
          met={progress.months_active >= ((criteria as GavelCriteria).months_active ?? 0)} />
        <CritRow
          label={t('x_golden_gavel_leads_accepted', { value: progress.leads_accepted ?? 0, value2: ((criteria as GavelCriteria).leads_accepted ?? 0) })}
          met={(progress.leads_accepted ?? 0) >= ((criteria as GavelCriteria).leads_accepted ?? 0)} />
        <CritRow label={t('x_golden_gavel_license_verified')}      met={!!progress.license_verified} />
        <CritRow label={t("golden_gavel.zero_flags")} met={progress.compliance_flags === 0} />
      </>}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
function GoldenGavelScreen(): React.JSX.Element {
  useLang();
  const { showToast } = useToast();

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); return () => { mountedRef.current = false; }; }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [status,    setStatus]    = useState<Status | null>(null);
  const [elig,      setElig]      = useState<EligResult | null>(null);
  const [hall,      setHall]      = useState<HallEntry[]>([]);

  const [loading,   setLoading]   = useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [refreshing,setRefreshing]= useState(false);
  const [optingIn,  setOptingIn]  = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setFetchError(null);
    try {
      let failed = 0;
      // Guests: only the public hall — status / eligibility are per account (no 401 calls).
      const signedIn = !!(await getToken().catch(() => null));
      const none = Promise.resolve({ data: null });
      const [s, e, h] = await Promise.all([
        signedIn ? api.get('/golden-gavel/status').catch(() => { failed++; return { data: null }; }) : none,
        signedIn ? api.get('/golden-gavel/eligibility').catch(() => { failed++; return { data: null }; }) : none,
        api.get('/golden-gavel/hall').catch(() => { failed++; return { data: [] }; }),
      ]);
      if (s.data) setStatus(s.data);
      if (e.data) setElig(e.data);
      if (Array.isArray(h.data)) setHall(h.data);
      if (failed === (signedIn ? 3 : 1)) setFetchError(t('x_golden_gavel_unable_load_please_check'));
    } catch (e: any) {
      setFetchError(t('x_golden_gavel_unable_load_please_check')); __DEV__ && console.warn(e?.message); }
    refresh ? setRefreshing(false) : setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reload when screen comes into focus (catches points earned elsewhere)
  useFocusEffect(useCallback(() => { load(true); }, [load]));

  const handleOptIn = async () => {
    setOptingIn(true);
    try {
      await api.post('/golden-gavel/hall/opt-in', {});
      showToast(t('x_golden_gavel_name_impact_now_publicly'));
      load(true);
    } catch {
      setLoading(false);
      showToast(t('home_sos_failed'));
    }
    setOptingIn(false);
  };

  if (loading) return <SkeletonLoader count={5} label={t('x_golden_gavel_progress')} />;

  const level: GavelLevel = (status?.gavel_level ?? elig?.level ?? 0) as GavelLevel;
  const hasAny = level > 0;
  const headerColor = level > 0 ? GAVEL_COLOR[level as 1 | 2 | 3].header : colors.navy;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.gold} />}
    >
      {fetchError && (
        <View style={{ margin: 16, padding: 14, backgroundColor: colors.bgCard, borderRadius: 10, borderWidth: 1, borderColor: colors.emergency }}>
          <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={{ color: colors.emergency, fontWeight: '700', fontSize: 14 }}>{t('x_golden_gavel_unable_load')}</IconLabel>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>{fetchError}</Text>
        </View>
      )}
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: headerColor }]}>
        <AppIcon name={GAVEL_ICON[hasAny ? level : 0]} size={42} color={COLORS.white} style={styles.headerIcon} />
        <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>{t('x_golden_gavel_gavel_program')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>
          {hasAny
            ? t('x_golden_gavel_gavel', { value: GAVEL_LABEL()[level], value2: status?.awarded_at ? new Date(status.awarded_at).toLocaleDateString() : t('gg_earned') })
            : t('x_golden_gavel_elite_status_earned_not')}
        </Text>
      </View>

      {/* ── Journey bar ─────────────────────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <JourneyBar level={level} />
        {level < 3 && elig?.next_level_label && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.nextHint, { color: colors.textMuted }]}>
            {t('x_golden_gavel_next_gavel', { next_level_label: GAVEL_LABEL()[Math.min(3, level + 1) as GavelLevel], value: elig.missing_for_next.length > 0 ? ` · ${elig.missing_for_next[0]}` : ' ' + t('x_golden_gavel_almost_there') })}
          </Text>
        )}
        {level === 3 && (
          <IconLabel icon={ICONS.trophy} textStyle={[styles.nextHint, { color: colors.goldText }]} maxFontSizeMultiplier={1.4}>{t('x_golden_gavel_have_reached_highest_level')}</IconLabel>
        )}
      </View>

      {/* ── Award dates if any ──────────────────────────────────────────────── */}
      {hasAny && (
        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {status?.bronze_at && (
            <View style={styles.dateRow}>
              <AppIcon name={ICONS.medal} size={20} color={GAVEL_COLOR[1].text} style={styles.dateEmoji} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateLabel, { color: colors.textPrimary }]}>{t('x_golden_gavel_bronze_awarded')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateVal, { color: colors.textMuted }]}>{new Date(status.bronze_at ?? 0).toLocaleDateString()}</Text>
            </View>
          )}
          {status?.silver_at && (
            <View style={styles.dateRow}>
              <AppIcon name={ICONS.medal} size={20} color={colors.textBrand} style={styles.dateEmoji} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateLabel, { color: colors.textPrimary }]}>{t('x_golden_gavel_silver_awarded')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateVal, { color: colors.textMuted }]}>{new Date(status.silver_at ?? 0).toLocaleDateString()}</Text>
            </View>
          )}
          {status?.golden_at && (
            <View style={styles.dateRow}>
              <AppIcon name={ICONS.trophy} size={20} color={GAVEL_COLOR[3].text} style={styles.dateEmoji} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateLabel, { color: colors.textPrimary }]}>{t('x_golden_gavel_golden_awarded')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateVal, { color: colors.textMuted }]}>{new Date(status.golden_at ?? 0).toLocaleDateString()}</Text>
            </View>
          )}
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} activeOpacity={0.6}
            style={[styles.optInBtn, { backgroundColor: headerColor }, optingIn && { opacity: 0.6 }]}
            onPress={handleOptIn}
            disabled={optingIn}>

            {optingIn
              ? <ActivityIndicator color={colors.bgCard} size="small" />
              : <Text maxFontSizeMultiplier={1.4} style={styles.optInBtnText}>{t('gg_opt_in')}</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* ── Criteria cards -- all three levels ──────────────────────────────── */}
      {elig && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('x_golden_gavel_progress_2')}</Text>

          <CriteriaSection
            title={t('x_golden_gavel_bronze_gavel')}
            progress={elig.progress}
            criteria={(elig as any).criteria?.[(elig as any).user_type]?.bronze || (elig as any).criteria?.bronze}
            earned={level >= 1}
          />
          <CriteriaSection
            title={t('x_golden_gavel_silver_gavel')}
            progress={elig.progress}
            criteria={(elig as any).criteria?.[(elig as any).user_type]?.silver || (elig as any).criteria?.silver}
            earned={level >= 2}
          />
          <CriteriaSection
            title={t('x_golden_gavel_golden_gavel')}
            progress={elig.progress}
            criteria={(elig as any).criteria?.[(elig as any).user_type]?.golden || (elig as any).criteria?.golden}
            earned={level >= 3}
          />
        </>
      )}

      {/* ── Hall of Justice ─────────────────────────────────────────────────── */}
      {hall.length > 0 && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('gg_hall')}</Text>
          {hall.length === 0 ? (
            <Text style={{color:colors.textSecond,textAlign:'center',marginTop:24}}>{t('x_golden_gavel_no_hall_fame_entries')}</Text>
          ) : hall.map((entry, i) => (
            <View key={`hall-${i}`} style={[styles.hallCard, {
              backgroundColor: entry.featured ? colors.warnBg : colors.bgCard,
              borderColor: entry.featured ? colors.gold : GAVEL_COLOR[entry.gavel_level as GavelLevel]?.border || colors.border,
            }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <AppIcon name={GAVEL_ICON[entry.gavel_level as GavelLevel] ?? ICONS.gavel} size={22} color={GAVEL_COLOR[entry.gavel_level as GavelLevel]?.text ?? colors.textBrand} style={styles.hallIcon} />
                <View style={{ flex: 1 }}>
                  {entry.featured && <IconLabel icon={ICONS.starFilled} iconColor={colors.goldText} textStyle={[styles.hallMeta, { color: colors.textMuted }]}>{t('gg_featured')}</IconLabel>}
                  <Text maxFontSizeMultiplier={1.4} style={[styles.hallName, { color: colors.textPrimary }]}>
                    {entry.display_name}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.hallMeta, { color: colors.textMuted }]}>
                    {t('x_golden_gavel_gavel_2', { value: GAVEL_LABEL()[entry.gavel_level as GavelLevel] || entry.level_label, value2: entry.tier === 'attorney' ? ' ' + t('x_golden_gavel_attorney') : entry.tier === 'bondsman' ? ' ' + t('x_golden_gavel_bondsman') : ' ' + t('x_golden_gavel_member'), value3: entry.state ? ` · ${entry.state}` : '' })}
                  </Text>
                </View>
                <View style={styles.helpedBadge}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.helpedNum}>{entry.people_helped}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.helpedLabel}>{t('x_golden_gavel_helped')}</Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {!hasAny && (
        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.cardBody, { color: colors.textSecond }]}>
            {t('x_golden_gavel_gavel_program_recognizes_attorneys')}
          </Text>
        </View>
      )}
      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  screen:            { flex: 1 },
  scroll:            { padding: 16 },
  header:            { borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' },
  headerIcon:        { marginBottom: 8 },
  headerTitle:       { color: colors.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:         { color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 20, textAlign: 'center' },
  card:              { borderRadius: 14, padding: 16, borderWidth: 1, marginBottom: 10 },
  cardBody:          { fontSize: 12, lineHeight: 20 },
  sectionLabel:      { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 16 },
  journeyRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  journeyLine:       { flex: 1, height: 2, maxWidth: 48 },
  journeyStep:       { alignItems: 'center', borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8, minWidth: 76 },
  journeyEmoji:      { marginBottom: 3 },
  journeyLabel:      { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  nextHint:          { fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  dateRow:           { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.bg },
  dateEmoji:         { width: 26 },
  dateLabel:         { flex: 1, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  dateVal:           { fontSize: 12 },
  optInBtn:          { marginTop: 12, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  optInBtnText:      { color: colors.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },
  critSection:       { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  critSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  critSectionTitle:  { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  earnedTag:         { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.legal, backgroundColor: colors.legalBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  critRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.bg },
  critIcon:          { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_900Black', fontWeight: '900', width: 18, marginTop: 1 },
  critLabel:         { fontSize: 12, flex: 1, lineHeight: 18 },
  hallCard:          { borderRadius: 12, padding: 12, borderWidth: 1, marginBottom: 8 },
  hallIcon:          {},
  hallName:          { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  hallMeta:          { fontSize: 12, marginTop: 2 },
  helpedBadge:       { alignItems: 'center', minWidth: 48 },
  helpedNum:         { fontSize: 18, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.steelMid },
  helpedLabel:       { fontSize: 11, color: colors.steel, fontWeight: '600' },
});
export default React.memo(GoldenGavelScreen);