import { SkeletonLoader } from '../components/SkeletonLoader';
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { api } from '../services/api';
import {  useTheme, COLORS } from '../constants/theme';
import { useFocusEffect } from '@react-navigation/native';

interface GavelCriteria {
  avg_rating?: number;
  consultations_booked?: number;
  leads_accepted?: number;
  lessons_completed?: boolean | number;
  lessons_started?: boolean | number;
  min_reviews?: number;
  months_active?: number;
  paid_referrals?: number;
}


declare var hasAny: any;
declare var level: any;
declare var fetchError: any; // hoisted from component scope
// ── Constants ─────────────────────────────────────────────────────────────────
const GAVEL_EMOJI  = { 0: '',    1: '🥉', 2: '🥈', 3: '🏆' } as const;
const GAVEL_LABEL  = { 0: 'None', 1: 'Bronze', 2: 'Silver', 3: 'Golden' } as const;
const GAVEL_COLOR  = {
  0: { bg: COLORS.bg, text: COLORS.textMuted, border: COLORS.border, header: COLORS.textMuted },
  1: { bg: COLORS.bailBg, text: COLORS.bail, border: COLORS.bail, header: COLORS.bail },
  2: { bg: COLORS.bgSubtle, text: COLORS.textSecond, border: COLORS.border, header: COLORS.textMuted },
  3: { bg: COLORS.warnBg, text: COLORS.gold, border: COLORS.gold, header: COLORS.gold },
} as const;

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
  paid_referrals?: number;
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.critRow}>
    {fetchError && (
      <View style={{ margin: 16, padding: 14, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.danger || colors.emergency }}>
        <Text style={{ color: colors.danger || colors.emergency, fontWeight: '700', fontSize: 14 }}>⚠ Unable to load</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }}>{fetchError}</Text>
      </View>
    )}
      <Text maxFontSizeMultiplier={1.4} style={[styles.critIcon, { color: met ? COLORS.legalDark : COLORS.emergencyDark }]}>
        {met ? '✓' : '✗'}
      </Text>
      <Text maxFontSizeMultiplier={1.4} style={[styles.critLabel, { color: COLORS.textSecond }]}>{label}</Text>
    </View>
  );
}

// ── Journey bar ───────────────────────────────────────────────────────────────
function JourneyBar({ level }: { level: GavelLevel }) {
  const steps: GavelLevel[] = [1, 2, 3];
  return (
    <View style={styles.journeyRow}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && (
            <View style={[styles.journeyLine, { backgroundColor: level >= s ? GAVEL_COLOR[s].border : COLORS.border }]} />
          )}
          <View style={[styles.journeyStep,
            { backgroundColor: level >= s ? GAVEL_COLOR[s].bg : COLORS.bg,
              borderColor:      level >= s ? GAVEL_COLOR[s].border : COLORS.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.journeyEmoji}>{level >= s ? GAVEL_EMOJI[s] : '○'}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.journeyLabel, { color: level >= s ? GAVEL_COLOR[s].text : COLORS.border }]}>
              {GAVEL_LABEL[s]}
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
  const { colors } = useTheme();
  if (!criteria) return null;
  const { user_type: ut } = progress;

  return (
    <View style={[styles.critSection, { borderColor: earned ? COLORS.legal : COLORS.border }]}>
      <View style={styles.critSectionHeader}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.critSectionTitle, { color: COLORS.textPrimary }]}>{title}</Text>
        {earned && <Text maxFontSizeMultiplier={1.4} style={styles.earnedTag}>✓ Earned</Text>}
      </View>

      {ut === 'attorney' && <>
        <CritRow
          label={`Active ${progress.months_active} / ${((criteria as GavelCriteria).months_active ?? 0)} months`}
          met={progress.months_active >= ((criteria as GavelCriteria).months_active ?? 0)} />
        <CritRow
          label={`Consultations ${progress.consultations_booked ?? 0} / ${((criteria as GavelCriteria).consultations_booked ?? 0)}`}
          met={(progress.consultations_booked ?? 0) >= ((criteria as GavelCriteria).consultations_booked ?? 0)} />
        <CritRow
          label={`Rating ${progress.avg_rating ?? 0} / ${((criteria as GavelCriteria).avg_rating ?? 0)} min (${progress.review_count ?? 0} reviews, need ${((criteria as GavelCriteria).min_reviews ?? 0)})`}
          met={(progress.avg_rating ?? 0) >= ((criteria as GavelCriteria).avg_rating ?? 0) && (progress.review_count ?? 0) >= ((criteria as GavelCriteria).min_reviews ?? 0)} />
        <CritRow label="Bar license verified"  met={!!progress.bar_verified} />
        <CritRow label="Zero compliance flags" met={progress.compliance_flags === 0} />
      </>}

      {ut === 'consumer' && <>
        <CritRow
          label={`Active ${progress.months_active} / ${((criteria as GavelCriteria).months_active ?? 0)} months`}
          met={progress.months_active >= ((criteria as GavelCriteria).months_active ?? 0)} />
        <CritRow
          label={`Paid referrals ${progress.paid_referrals ?? 0} / ${((criteria as GavelCriteria).paid_referrals ?? 0)}`}
          met={(progress.paid_referrals ?? 0) >= ((criteria as GavelCriteria).paid_referrals ?? 0)} />
        {((criteria as GavelCriteria).lessons_started ?? 0) && !((criteria as GavelCriteria).lessons_completed ?? 0) &&
          <CritRow label="Started at least one lesson" met={!!progress.lessons_started} />}
        {((criteria as GavelCriteria).lessons_completed ?? 0) &&
          <CritRow label="All lessons completed" met={!!progress.lessons_completed} />}
        <CritRow label="Zero compliance flags" met={progress.compliance_flags === 0} />
      </>}

      {ut === 'bondsman' && <>
        <CritRow
          label={`Active ${progress.months_active} / ${((criteria as GavelCriteria).months_active ?? 0)} months`}
          met={progress.months_active >= ((criteria as GavelCriteria).months_active ?? 0)} />
        <CritRow
          label={`Leads accepted ${progress.leads_accepted ?? 0} / ${((criteria as GavelCriteria).leads_accepted ?? 0)}`}
          met={(progress.leads_accepted ?? 0) >= ((criteria as GavelCriteria).leads_accepted ?? 0)} />
        <CritRow label="License verified"      met={!!progress.license_verified} />
        <CritRow label="Zero compliance flags" met={progress.compliance_flags === 0} />
      </>}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function GoldenGavelScreen({ navigation }: ScreenProps): React.JSX.Element {

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors, isDark } = useTheme();
  const [status,    setStatus]    = useState<Status | null>(null);
  const [elig,      setElig]      = useState<EligResult | null>(null);
  const [hall,      setHall]      = useState<HallEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [refreshing,setRefreshing]= useState(false);
  const [optingIn,  setOptingIn]  = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const [s, e, h] = await Promise.all([
        api.get('/golden-gavel/status').catch(() => ({ data: null })),
        api.get('/golden-gavel/eligibility').catch(() => ({ data: null })),
        api.get('/golden-gavel/hall').catch(() => ({ data: [] })),
      ]);
      if (s.data) setStatus(s.data);
      if (e.data) setElig(e.data);
      if (h.data) setHall(h.data);
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    refresh ? setRefreshing(false) : setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reload when screen comes into focus (catches points earned elsewhere)
  useFocusEffect(useCallback(() => { load(true); }, [load]));

  const handleOptIn = async () => {
    setOptingIn(true);
    try {
      await api.post('/golden-gavel/hall/opt-in', {});
      Alert.alert('Added to Hall of Justice', 'Your name and impact are now publicly listed.');
      load(true);
    } catch {
      setLoading(false);
      Alert.alert('Could not opt in', 'Check your connection and try again.');
    }
    setOptingIn(false);
  };

  if (loading) return <SkeletonLoader rows={5} label="Progress" />;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.gold} />}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: hasAny ? (gc as any).header : colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerIcon}>{hasAny ? GAVEL_EMOJI[level] : '⚖️'}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>Gavel Program</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>
          {hasAny
            ? `${GAVEL_LABEL[level]} Gavel · ${status?.awarded_at ? new Date(status.awarded_at).toLocaleDateString() : 'Earned'}`
            : 'Elite status -- earned, not purchased'}
        </Text>
      </View>

      {/* ── Journey bar ─────────────────────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <JourneyBar level={level} />
        {level < 3 && elig?.next_level_label && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.nextHint, { color: colors.textMuted }]}>
            Next: {elig.next_level_label} Gavel
            {elig.missing_for_next.length > 0 ? ` · ${elig.missing_for_next[0]}` : ' · Almost there!'}
          </Text>
        )}
        {level === 3 && (
          <Text maxFontSizeMultiplier={1.4} style={[styles.nextHint, { color: colors.gold }]}>
            🏆 You have reached the highest level
          </Text>
        )}
      </View>

      {/* ── Award dates if any ──────────────────────────────────────────────── */}
      {hasAny && (
        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {status?.bronze_at && (
            <View style={styles.dateRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.dateEmoji}>🥉</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateLabel, { color: colors.textPrimary }]}>Bronze awarded</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateVal, { color: colors.textMuted }]}>{new Date(status.bronze_at ?? 0).toLocaleDateString()}</Text>
            </View>
          )}
          {status?.silver_at && (
            <View style={styles.dateRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.dateEmoji}>🥈</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateLabel, { color: colors.textPrimary }]}>Silver awarded</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateVal, { color: colors.textMuted }]}>{new Date(status.silver_at ?? 0).toLocaleDateString()}</Text>
            </View>
          )}
          {status?.golden_at && (
            <View style={styles.dateRow}>
              <Text maxFontSizeMultiplier={1.4} style={styles.dateEmoji}>🏆</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateLabel, { color: colors.textPrimary }]}>Golden awarded</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateVal, { color: colors.textMuted }]}>{new Date(status.golden_at ?? 0).toLocaleDateString()}</Text>
            </View>
          )}
          <TouchableOpacity activeOpacity={0.6}
            accessibilityRole="button"
            style={[styles.optInBtn, { backgroundColor: (gc as any).header }, optingIn && { opacity: 0.6 }]}
            onPress={handleOptIn}
            disabled={optingIn}>

            {optingIn
              ? <ActivityIndicator color={colors.bgCard} size="small" />
              : <Text maxFontSizeMultiplier={1.4} style={styles.optInBtnText}>Add me to the Hall of Justice →</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* ── Criteria cards -- all three levels ──────────────────────────────── */}
      {elig && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>Your progress</Text>

          <CriteriaSection
            title="🥉  Bronze Gavel"
            progress={elig.progress}
            criteria={(elig as any).criteria?.[(elig as any).user_type]?.bronze || (elig as any).criteria?.bronze}
            earned={level >= 1}
          />
          <CriteriaSection
            title="🥈  Silver Gavel"
            progress={elig.progress}
            criteria={(elig as any).criteria?.[(elig as any).user_type]?.silver || (elig as any).criteria?.silver}
            earned={level >= 2}
          />
          <CriteriaSection
            title="🏆  Golden Gavel"
            progress={elig.progress}
            criteria={(elig as any).criteria?.[(elig as any).user_type]?.golden || (elig as any).criteria?.golden}
            earned={level >= 3}
          />
        </>
      )}

      {/* ── Hall of Justice ─────────────────────────────────────────────────── */}
      {hall.length > 0 && (
        <>
          <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>Hall of Justice</Text>
          {hall.length === 0 ? (
            <Text style={{color:colors.textSecond,textAlign:'center',marginTop:24}}>No Hall of Fame entries yet — case evaluations will appear here after attorney review.</Text>
          ) : hall.map((entry, i) => (
            <View key={i} style={[styles.hallCard, {
              backgroundColor: entry.featured ? colors.warnBg : colors.bgCard,
              borderColor: entry.featured ? colors.gold : GAVEL_COLOR[entry.gavel_level as GavelLevel]?.border || colors.border,
            }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text maxFontSizeMultiplier={1.4} style={styles.hallIcon}>{entry.level_emoji || GAVEL_EMOJI[entry.gavel_level as GavelLevel]}</Text>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.hallName, { color: colors.textPrimary }]}>
                    {entry.display_name}{entry.featured ? '  ★' : ''}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.hallMeta, { color: colors.textMuted }]}>
                    {entry.level_label || GAVEL_LABEL[entry.gavel_level as GavelLevel]} Gavel
                    {entry.tier === 'attorney' ? ' · Attorney' : entry.tier === 'bondsman' ? ' · Bondsman' : ' · Member'}
                    {entry.state ? ` · ${entry.state}` : ''}
                  </Text>
                </View>
                <View style={styles.helpedBadge}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.helpedNum}>{entry.people_helped}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.helpedLabel}>helped</Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {!hasAny && (
        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.cardBody, { color: colors.textSecond }]}>
            The Gavel Program recognizes attorneys, advocates, and individuals who demonstrate
            consistent excellence on the Justice Gavel platform.{'\n'}
            Bronze Gavel is the entry point. Meet the criteria above and it is awarded
            automatically every night. It is never purchased.
          </Text>
        </View>
      )}
      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:            { flex: 1 },
  scroll:            { padding: 16 },
  header:            { borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' },
  headerIcon:        { fontSize: 42, marginBottom: 8 },
  headerTitle:       { color: COLORS.bgCard, fontSize: 22, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:         { color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 20, textAlign: 'center' },
  card:              { borderRadius: 14, padding: 16, borderWidth: 1, marginBottom: 10 },
  cardBody:          { fontSize: 12, lineHeight: 20 },
  sectionLabel:      { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 16 },
  journeyRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  journeyLine:       { flex: 1, height: 2, maxWidth: 48 },
  journeyStep:       { alignItems: 'center', borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8, minWidth: 76 },
  journeyEmoji:      { fontSize: 22, marginBottom: 3 },
  journeyLabel:      { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  nextHint:          { fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  dateRow:           { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.bg },
  dateEmoji:         { fontSize: 18, width: 26 },
  dateLabel:         { flex: 1, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  dateVal:           { fontSize: 12 },
  optInBtn:          { marginTop: 12, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  optInBtnText:      { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 14,
    lineHeight: 21, },
  critSection:       { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  critSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  critSectionTitle:  { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  earnedTag:         { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.legal, backgroundColor: colors.legal, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  critRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.bg },
  critIcon:          { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_900Black', fontWeight: '900', width: 18, marginTop: 1 },
  critLabel:         { fontSize: 12, flex: 1, lineHeight: 18 },
  hallCard:          { borderRadius: 12, padding: 12, borderWidth: 1, marginBottom: 8 },
  hallIcon:          { fontSize: 22 },
  hallName:          { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  hallMeta:          { fontSize: 12, marginTop: 2 },
  helpedBadge:       { alignItems: 'center', minWidth: 48 },
  helpedNum:         { fontSize: 18, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#F9A825' },
  helpedLabel:       { fontSize: 11, color: colors.steel, fontWeight: '600' },
});

// Module-level styles for helper components (uses static COLORS, not dynamic theme)
const styles = makeStyles(COLORS);
