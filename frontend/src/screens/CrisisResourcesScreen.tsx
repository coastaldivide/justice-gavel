import { useToast } from '../components/ToastProvider';
import { AppIcon } from '../components/AppIcon';
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
import React, { useMemo } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, RefreshControl, LayoutAnimation, ActivityIndicator } from 'react-native';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';

// ── Hotlines ──────────────────────────────────────────────────────────────────
const CRISIS_LINES = [
  { name: '211 — Social Services',     number: '211',              desc: 'Housing, food, utilities, crisis support. Free, confidential, 24/7.' },
  { name: 'RAINN Sexual Assault',      number: '1-800-656-4673',   desc: 'National Sexual Assault Hotline. Confidential, 24/7.' },
  { name: 'Human Trafficking',         number: '1-888-373-7888',   desc: 'National Human Trafficking Hotline. Text BeFree to 233733.' },
  { name: 'Veterans Crisis Line',      number: '988 (then 1)',     desc: 'Crisis support for Veterans and Service members. 24/7.' },
  { name: 'Trans Lifeline',            number: '1-877-565-8860',   desc: 'Peer support by and for trans people. US and Canada.' },
  { name: 'Crisis Text Line',          number: 'Text HOME to 741741', desc: 'Text-based crisis support. Free, 24/7.' },
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

// Plain helper (no hooks): dial a crisis line; report failure via onError so
// the caller can show the number to dial manually.
function callLine(number: string, onError?: (number: string) => void) {
  Linking.openURL(`tel:${number.replace(/[^0-9]/g, '')}`).catch(() => onError?.(number));
}



function CrisisResourcesScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { showToast } = useToast();
  const onDialError = (number: string) => showToast(`Please dial ${number} manually.`, 'warning');
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
  return () => { mountedRef.current = false; };
  }, []);

  const [isLoading, setIsLoading] = React.useState(true);
  const [dbLines, setDbLines] = React.useState<any[]>([]);
  React.useEffect(() => {
    api.get('/resources?category=CRISIS_LINE&limit=20')
      .then(r => { if (r.data?.length) setDbLines(r.data || []); })
      .catch(() => {}).finally(() => setIsLoading(false));
  }, []);
  // Crisis lines from the resources directory that are not already listed above.
  const directoryLines = useMemo(() => {
    const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');
    const known = new Set(CRISIS_LINES.map(l => digits(l.number)));
    return dbLines.filter(r => r?.name && digits(r.phone) && !known.has(digits(r.phone)));
  }, [dbLines]);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    api.get('/resources?category=CRISIS_LINE&limit=20').then(r => { if (r.data) setDbLines(r.data); }).catch(() => {});
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 600);
  }, []);


  return (
    <ScrollView
      testID="crisis-resources-screen"
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
        accessibilityRole="button"
        style={styles.primaryBtn}
        onPress={() => callLine('988', onDialError)}
        activeOpacity={0.88}
        accessibilityLabel="Call 988 Suicide and Crisis Lifeline"
        accessibilityHint="Opens your phone to call the free 24/7 crisis line"
      >
        <AppIcon name="call-outline" size={20} color={colors.legal} />
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
          <View key={`GROUNDIN-${i}`} style={styles.groundingRow}>
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
          accessibilityRole="button"
          key={line.key ?? line.name}
          style={[styles.lineCard, { backgroundColor: colors.bgCard }]}
          onPress={() => callLine(line.number, onDialError)}
          activeOpacity={0.85}
          accessibilityLabel={`Call ${line.name}`}
          accessibilityHint={line.forWhom ?? line.desc}
        >
          <View style={[styles.lineDot, { backgroundColor: line.bg ?? COLORS.bgSubtle }]}>
            <AppIcon name="call-outline" size={20} color={colors.legal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineName, { color: colors.textPrimary }]}>{line.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineNumber, { color: line.color ?? COLORS.blue }]}>{line.number}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineFor, { color: colors.textMuted }]}>{line.forWhom ?? line.desc}</Text>
          </View>
        </TouchableOpacity>
      ))}

      {/* ── Additional lines from the resources directory ─────────────── */}
      {isLoading && <ActivityIndicator style={{ marginVertical: 8 }} color={colors.textMuted} />}
      {directoryLines.map(r => (
        <TouchableOpacity
          accessibilityRole="button"
          key={`db-${r.id ?? r.name}`}
          testID="crisis-directory-line"
          style={[styles.lineCard, { backgroundColor: colors.bgCard }]}
          onPress={() => callLine(String(r.phone), onDialError)}
          activeOpacity={0.85}
          accessibilityLabel={`Call ${r.name}`}
          accessibilityHint={r.description || undefined}
        >
          <View style={[styles.lineDot, { backgroundColor: COLORS.bgSubtle }]}>
            <AppIcon name="call-outline" size={20} color={colors.legal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineName, { color: colors.textPrimary }]}>{r.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineNumber, { color: colors.textBrand }]}>{r.phone}</Text>
            {!!r.description && (
              <Text maxFontSizeMultiplier={1.4} style={[styles.lineFor, { color: colors.textMuted }]}>{r.description}</Text>
            )}
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
          accessibilityRole="button"
          style={[styles.legalBtn, { backgroundColor: COLORS.navy }]}
          onPress={() => navigation.navigate('LawyersTab')}
          accessibilityLabel="Find a lawyer"
        >
          <AppIcon name="scale-outline" size={20} color={COLORS.navy} />
          <Text maxFontSizeMultiplier={1.4} style={styles.legalBtnText}>Find a Lawyer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.legalBtn, { backgroundColor: COLORS.bail }]}
          onPress={() => navigation.navigate('MoreTab', { screen: 'HelpNow' })}
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

      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: 16 },

  header: { marginBottom: 20 },
  headerTitle: {
    fontSize: 28, ...FONTS.black, color: colors.textBrand, marginBottom: 8,
  },
  headerSub: {
    fontSize: 14, color: colors.textMuted, lineHeight: 21,
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
    fontSize: 11, color: colors.textMuted, textAlign: 'center',
    marginBottom: 20, lineHeight: 16, paddingHorizontal: 8,
  },

  // Grounding exercises
  groundingCard: {
    borderRadius: RADIUS.lg, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  groundingLabel: {
    fontSize: 11, ...FONTS.black, color: colors.textMuted,
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
export default React.memo(CrisisResourcesScreen);