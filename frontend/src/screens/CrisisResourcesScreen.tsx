/**
 * CrisisResourcesScreen -- Mental health & crisis resources
 *
 * One job: get someone in crisis to the right line fast.
 * Design principle: calm, not clinical. Warm, not alarmist.
 * The 988 button is the first thing on screen. Everything else is secondary.
 *
 * Entry points:
 *   1. EmergencyScreen "Mental Health & Crisis" quick action
 *   2. HomeScreen tile
 *   3. ChatScreen when user expresses distress
 *   4. ResourcesScreen "Crisis Support" category
 */
import { api } from '../services/api';
import React, { useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, RefreshControl} from 'react-native';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';

declare var data: any;
declare var setIsLoading: any; // hoisted from component scope
// ── Hotlines ──────────────────────────────────────────────────────────────────
const CRISIS_LINES = [
  {
    key: '988',
    name: '988 Suicide & Crisis Lifeline',
    number: '988',
    description: 'Free, confidential support 24/7. Call or text 988.',
    forWhom: 'Suicidal thoughts, emotional distress, mental health crisis of any kind',
    primary: true,
    color: COLORS.blue,
    bg:    COLORS.bgSubtle,
  },
  {
    key: 'samhsa',
    name: 'SAMHSA Helpline',
    number: '1-800-662-4357',
    description: 'Substance Abuse & Mental Health Services. Free, confidential, 24/7.',
    forWhom: 'Substance abuse, addiction, mental health treatment referrals',
    primary: false,
    color: COLORS.legalDark,
    bg:    COLORS.legalBg,
  },
  {
    key: 'domestic',
    name: 'National DV Hotline',
    number: '1-800-799-7233',
    description: 'Domestic violence support 24/7. Also available via text: text START to 88788.',
    forWhom: 'Domestic violence, intimate partner violence, safety planning',
    primary: false,
    color: COLORS.emergencyDark,
    bg:    COLORS.emergencyBg,
  },
  {
    key: 'veterans',
    name: 'Veterans Crisis Line',
    number: '1-800-273-8255',
    description: 'Press 1 after dialing. Text 838255.',
    forWhom: 'Veterans, service members, and their families',
    primary: false,
    color: COLORS.blue,
    bg:    COLORS.bgSubtle,
  },
  {
    key: 'trevor',
    name: 'The Trevor Project',
    number: '1-866-488-7386',
    description: 'LGBTQ+ youth crisis support 24/7. Also text START to 678-678.',
    forWhom: 'LGBTQ+ young people in crisis',
    primary: false,
    color: COLORS.legalDark,
    bg:    COLORS.legalBg,
  },
];

// ── Self-help grounding tips ──────────────────────────────────────────────────
const GROUNDING = [
  { icon: '🫁', title: t('crisis_breathe_title'), body: t('crisis_breathe_body') },
  { icon: '👁️', title: t('crisis_ground_title'), body: t('crisis_ground_body') },
  { icon: '📍', title: t('crisis_safe_title'), body: t('crisis_safe_body') },
];

function callLine(number: string) {
  Linking.openURL(`tel:${number.replace(/[^0-9]/g, '')}`).catch(() => {}).finally(() => setIsLoading(false));
}

export default function CrisisResourcesScreen({ route, navigation }: ScreenProps): React.JSX.Element {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [isLoading, setIsLoading] = React.useState(true);
  const [dbLines, setDbLines] = React.useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string>('');
  React.useEffect(() => {
    api.get('/resources?category=CRISIS_LINE&limit=20')
      .then(r => { if (r.data?.length) setDbLines(r.data || []); })
      .catch(() => {}).finally(() => setIsLoading(false));
  }, []);
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/resources?category=CRISIS_LINE&limit=20').then(r => { if (r.data) setDbLines(r.data || []); }).catch(()=>{})
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 600);
  }, []);


  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>{t('crisis_header_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>
          Whatever you're going through right now -- an arrest, a crisis, a moment
          {t('crisis_header_sub')}
        </Text>
      </View>

      {/* ── 988 PRIMARY BUTTON ─────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => callLine('988')}
            accessibilityRole="button"
        activeOpacity={0.88}
        accessibilityLabel="Call 988 Suicide and Crisis Lifeline"
        accessibilityHint="Opens your phone to call the free 24/7 crisis line"
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnIcon}>📞</Text>
        <View style={styles.primaryBtnText}>
          <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnTitle}>{t('crisis_988_label')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnSub}>
            {t('crisis_988_sub')}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnArrow}>›</Text>
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.4} style={styles.primaryNote}>
        {t('crisis_privacy_note')}
      </Text>

      {/* ── Grounding ──────────────────────────────────────────────────── */}
      <View style={[styles.groundingCard, { backgroundColor: colors.bgCard }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.groundingLabel}>{t('crisis_grounding_label')}</Text>
        {GROUNDING.map((g, i) => (
          <View key={i} style={styles.groundingRow}>
            <Text maxFontSizeMultiplier={1.4} style={styles.groundingIcon}>{g.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.groundingTitle, { color: colors.textPrimary }]}>{g.title}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.groundingBody,  { color: colors.textSecond }]}>{g.body}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── More crisis lines ──────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('crisis_more_lines')}</Text>

      {CRISIS_LINES.filter(l => !l.primary).map(line => (
        <TouchableOpacity
          key={line.key}
          style={[styles.lineCard, { backgroundColor: colors.bgCard }]}
          onPress={() => callLine(line.number)}
            accessibilityRole="button"
          activeOpacity={0.85}
          accessibilityLabel={`Call ${line.name}`}
          accessibilityHint={line.forWhom}
        >
          <View style={[styles.lineDot, { backgroundColor: line.bg }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineDotText, { color: line.color }]}>📞</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineName, { color: colors.textPrimary }]}>{line.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineNumber, { color: line.color }]}>{line.number}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineFor, { color: colors.textMuted }]}>{line.forWhom}</Text>
          </View>
        </TouchableOpacity>
      ))}

      {/* ── Legal help separator ───────────────────────────────────────── */}
      <View style={styles.divider}>
        <View style={[styles.divLine, { backgroundColor: colors.border }]} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.divText, { color: colors.textMuted }]}>{t('crisis_legal_divider')}</Text>
        <View style={[styles.divLine, { backgroundColor: colors.border }]} />
      </View>

      <View style={styles.legalRow}>
        <TouchableOpacity
          style={[styles.legalBtn, { backgroundColor: COLORS.navy }]}
          onPress={() => navigation.navigate('LawyersTab')}
            accessibilityRole="button"
          accessibilityLabel={t("crisis_find_lawyer")}
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.legalBtnIcon}>⚖️</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.legalBtnText}>Find a Lawyer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.legalBtn, { backgroundColor: COLORS.bail }]}
          onPress={() => navigation.navigate('MoreTab', { screen: 'HelpNow' })}
            accessibilityRole="button"
          accessibilityLabel="Get immediate help"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.legalBtnIcon}>🔓</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.legalBtnText}>HELP NOW</Text>
        </TouchableOpacity>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.footer, { color: colors.textMuted }]}>
        Justice Gavel connects you to legal help. For mental health emergencies,
        please call 988 or 911.
      </Text>

      <View style={{ height: 40 }} />

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>🆘</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>Loading resources...</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>If this takes too long, call 988 or 911 directly.</Text>
        </View>
      )}
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16 },

  header: { marginBottom: 20 },
  headerTitle: {
    fontSize: 28, ...FONTS.black, color: COLORS.navy, marginBottom: 8,
  },
  headerSub: {
    fontSize: 14, color: COLORS.textSecond, lineHeight: 21,
  },

  // 988 primary button -- the whole point of the screen
  primaryBtn: {
    backgroundColor: colors.blue,
    borderRadius: RADIUS.xl,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 10,
    ...SHADOW.md,
    shadowColor: colors.blue,
    shadowOpacity: 0.35,
  },
  primaryBtnIcon:  { fontSize: 28 },
  primaryBtnText:  { flex: 1 },
  primaryBtnTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, letterSpacing: 0.3 },
  primaryBtnSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 3, lineHeight: 17 },
  primaryBtnArrow: { fontSize: 28, color: 'rgba(255,255,255,0.6)', ...FONTS.medium },

  primaryNote: {
    fontSize: 11, color: COLORS.textMuted, textAlign: 'center',
    marginBottom: 20, lineHeight: 16, paddingHorizontal: 8,
  },

  // Grounding exercises
  groundingCard: {
    borderRadius: RADIUS.lg, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  groundingLabel: {
    fontSize: 11, ...FONTS.black, color: COLORS.textMuted,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12,
  },
  groundingRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  groundingIcon:  { fontSize: 20, marginTop: 1 },
  groundingTitle: { fontSize: 14,
    lineHeight: 21, ...FONTS.heavy, marginBottom: 2 },
  groundingBody:  { fontSize: 12, lineHeight: 18 },

  sectionLabel: {
    fontSize: 11, ...FONTS.black, textTransform: 'uppercase',
    letterSpacing: 1.2, marginBottom: 10,
  },

  // Crisis line cards
  lineCard: {
    borderRadius: RADIUS.lg, padding: 16, marginBottom: 9,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  lineDot: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  lineDotText:   { fontSize: 18 },
  lineName:      { fontSize: 12, lineHeight: 20, ...FONTS.heavy, marginBottom: 2 },
  lineNumber:    { fontSize: 14,
    lineHeight: 21, ...FONTS.black, marginBottom: 3 },
  lineFor:       { fontSize: 11, lineHeight: 16 },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 20 },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 11, ...FONTS.semi },

  // Legal CTAs
  legalRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  legalBtn: {
    flex: 1, borderRadius: RADIUS.lg, paddingVertical: 16,
    alignItems: 'center', gap: 8, ...SHADOW.sm,
  },
  legalBtnIcon: { fontSize: 20 },
  legalBtnText: { color: COLORS.bgCard, fontSize: 12, lineHeight: 20, ...FONTS.black },

  footer: {
    fontSize: 11, textAlign: 'center', lineHeight: 17, paddingHorizontal: 12,
  },
});
