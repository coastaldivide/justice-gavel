import { useToast } from '../components/ToastProvider';
import { AppIcon, ICONS, type IconName } from '../components/AppIcon';
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
import { unwrapList, api } from '../services/api';
import { smsUrl } from '../services/sos';
import { getToken } from '../utils/secureStorage';
import React, { useMemo } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, RefreshControl, LayoutAnimation, ActivityIndicator } from 'react-native';
import { t, perLang, useLang }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme, themeColors } from '../constants/theme';

// ── Hotlines ──────────────────────────────────────────────────────────────────
// `dial` is what the phone dials; `sms` lines are text-only (Crisis Text Line);
// `number` is what the card shows. Organisation names are official names in
// the app's language where the organisation publishes one.
interface CrisisLine {
  key: string; name: string; number: string; dial?: string; sms?: { to: string; body: string };
  desc: string; primary?: boolean; color?: string; bg?: string;
}
const CRISIS_LINES = perLang((): CrisisLine[] => {
  const c = themeColors();
  return [
  { key: '988', name: t('x_emergency_share_988_suicide_crisis_lifeline'), number: '988', dial: '988',
    desc: t('x_crisis_resources_suicidal_thoughts_emotional_distress'), primary: true, color: c.info, bg: c.bgSubtle },
  { key: '211', name: t('crisis_line_211'), number: '211', dial: '211', desc: t('x_crisis_resources_housing_food_utilities_crisis') },
  { key: 'rainn', name: t('crisis_line_rainn'), number: '1-800-656-4673', dial: '18006564673', desc: t('x_crisis_resources_national_sexual_assault_hotline') },
  { key: 'trafficking', name: t('crisis_line_trafficking'), number: '1-888-373-7888', dial: '18883737888', desc: t('x_crisis_resources_national_human_trafficking_hotline') },
  { key: 'trans', name: 'Trans Lifeline', number: '1-877-565-8860', dial: '18775658860', desc: t('x_crisis_resources_peer_support_by_trans') },
  { key: 'text', name: 'Crisis Text Line', number: t('crisis_text_home'), sms: { to: '741741', body: 'HOME' }, desc: t('x_crisis_resources_text_based_crisis_support') },
  { key: 'samhsa', name: t('x_emergency_share_samhsa_national_helpline'), number: '1-800-662-4357', dial: '18006624357',
    desc: t('x_crisis_resources_substance_abuse_addiction_mental'), color: c.legalDark, bg: c.legalBg },
  { key: 'domestic', name: t('x_emergency_share_national_domestic_violence_hotline'), number: '1-800-799-7233', dial: '18007997233',
    desc: t('x_crisis_resources_domestic_violence_intimate_partner'), color: c.emergencyDark, bg: c.emergencyBg },
  // The Veterans Crisis Line is reached through 988, then pressing 1.
  { key: 'veterans', name: t('crisis_line_veterans'), number: t('crisis_988_press_1'), dial: '988',
    desc: `${t('x_crisis_resources_veterans_service_members_their')} ${t('x_crisis_resources_press_1_after_dialing')}`, color: c.info, bg: c.bgSubtle },
  { key: 'trevor', name: 'The Trevor Project', number: '1-866-488-7386', dial: '18664887386',
    desc: t('x_crisis_resources_lgbtq_young_people_crisis'), color: c.legalDark, bg: c.legalBg },
];
});

// ── Self-help grounding tips ──────────────────────────────────────────────────
const GROUNDING = perLang((): { icon: IconName; title: string; body: string }[] => [
  { icon: ICONS.breathe, title: t('crisis_breathe_title'), body: t('crisis_breathe_body') },
  { icon: ICONS.ground, title: t('crisis_ground_title'), body: t('crisis_ground_body') },
  { icon: ICONS.location, title: t('crisis_safe_title'), body: t('crisis_safe_body') },
]);

// Plain helper (no hooks): call (or text) a crisis line; report failure via
// onError so the caller can show the number to dial manually.
function callLine(line: Pick<CrisisLine, 'number' | 'dial' | 'sms'>, onError?: (number: string) => void) {
  const url = line.sms ? smsUrl(line.sms.to, line.sms.body) : `tel:${(line.dial || line.number).replace(/[^0-9]/g, '')}`;
  Linking.openURL(url).catch(() => onError?.(line.number));
}



function CrisisResourcesScreen({ navigation }: ScreenProps): React.JSX.Element {
  useLang();
  const { showToast } = useToast();
  const onDialError = (number: string) => showToast(t('x_crisis_resources_please_dial_manually', { number }), 'warning');
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mountedRef.current = true;
  return () => { mountedRef.current = false; };
  }, []);

  const [isLoading, setIsLoading] = React.useState(true);
  const [dbLines, setDbLines] = React.useState<any[]>([]);
  // The resources directory is for signed-in accounts; a guest sees the built-in lines only.
  const loadDirectory = React.useCallback(async () => {
    if (!(await getToken().catch(() => null))) return;
    try {
      const r = await api.get('/resources?category=CRISIS_LINE&limit=20');
      const lines = unwrapList(r.data, 'resources');
      if (lines.length && mountedRef.current) setDbLines(lines);
    } catch { /* offline: the built-in lines above stay */ }
  }, []);
  React.useEffect(() => {
    loadDirectory().finally(() => { if (mountedRef.current) setIsLoading(false); });
  }, [loadDirectory]);
  // Crisis lines from the resources directory that are not already listed above.
  const directoryLines = useMemo(() => {
    const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');
    const known = new Set(CRISIS_LINES().flatMap(l => [digits(l.dial), digits(l.number), digits(l.sms?.to)]).filter(Boolean));
    return dbLines.filter(r => r?.name && digits(r.phone) && !known.has(digits(r.phone)));
  }, [dbLines]);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    loadDirectory().finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [loadDirectory]);


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
          {t('crisis_header_sub')}
        </Text>
      </View>

      {/* ── 988 PRIMARY BUTTON ─────────────────────────────────────────── */}
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.primaryBtn}
        onPress={() => callLine({ number: '988', dial: '988' }, onDialError)}
        activeOpacity={0.88}
        accessibilityLabel={t('x_crisis_resources_call_988_suicide_crisis')}
        accessibilityHint={t('x_crisis_resources_opens_phone_call_free')}
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
        {GROUNDING().map((g, i) => (
          <View key={`GROUNDIN-${i}`} style={styles.groundingRow}>
            <AppIcon name={g.icon} size={24} color={colors.textBrand} style={styles.groundingIcon} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.groundingTitle, { color: colors.textPrimary }]}>{g.title}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.groundingBody,  { color: colors.textSecond }]}>{g.body}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── More crisis lines ──────────────────────────────────────────── */}
      <Text maxFontSizeMultiplier={1.4} style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('crisis_more_lines')}</Text>

      {CRISIS_LINES().filter(l => !l.primary).map(line => (
        <TouchableOpacity
          accessibilityRole="button"
          key={line.key}
          testID={`crisis-line-${line.key}`}
          style={[styles.lineCard, { backgroundColor: colors.bgCard }]}
          onPress={() => callLine(line, onDialError)}
          activeOpacity={0.85}
          accessibilityLabel={line.sms ? t('crisis_text_a11y', { name: line.name }) : t('hn_call_a11y', { name: line.name })}
          accessibilityHint={line.desc}
        >
          <View style={[styles.lineDot, { backgroundColor: line.bg ?? colors.bgSubtle }]}>
            <AppIcon name="call-outline" size={20} color={colors.legal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineName, { color: colors.textPrimary }]}>{line.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineNumber, { color: line.color ?? COLORS.blue }]}>{line.number}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.lineFor, { color: colors.textMuted }]}>{line.desc}</Text>
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
          onPress={() => callLine({ number: String(r.phone) }, onDialError)}
          activeOpacity={0.85}
          accessibilityLabel={t('hn_call_a11y', { name: r.name })}
          accessibilityHint={r.description || undefined}
        >
          <View style={[styles.lineDot, { backgroundColor: colors.bgSubtle }]}>
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
          accessibilityLabel={t('find_lawyer')}
        >
          <AppIcon name={ICONS.lawyer} size={20} color={COLORS.white} />
          <Text maxFontSizeMultiplier={1.4} style={styles.legalBtnText}>{t('lawyers_heading')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.legalBtn, { backgroundColor: COLORS.blue }]}
          onPress={() => navigation.navigate('MoreTab', { screen: 'HelpNow' })}
          accessibilityLabel={t('x_crisis_resources_get_immediate_help')}
        >
          <AppIcon name={ICONS.location} size={20} color={COLORS.white} />
          <Text maxFontSizeMultiplier={1.4} style={styles.legalBtnText}>{t('help_now')}</Text>
        </TouchableOpacity>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.footer, { color: colors.textMuted }]}>
        {t('x_crisis_resources_justice_gavel_connects_legal')}
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
  primaryBtnTitle: { fontSize: 22, ...FONTS.black, color: colors.white, letterSpacing: 0.3 },
  primaryBtnSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 3, lineHeight: 17 },
  primaryBtnArrow: { fontSize: 28, color: 'rgba(255,255,255,0.6)', ...FONTS.medium },

  primaryNote: {
    fontSize: 11, color: colors.textMuted, textAlign: 'center',
    marginBottom: 20, lineHeight: 16, paddingHorizontal: 8,
  },

  // Grounding exercises
  groundingCard: {
    borderRadius: RADIUS.lg, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: colors.border, ...SHADOW.sm,
  },
  groundingLabel: {
    fontSize: 11, ...FONTS.black, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12,
  },
  groundingRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border,
  },
  groundingIcon:  { marginTop: 1 },
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
    borderWidth: 1, borderColor: colors.border, ...SHADOW.sm,
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
  legalBtnText: { color: colors.white, fontSize: 12, lineHeight: 20, ...FONTS.black },

  footer: {
    fontSize: 11, textAlign: 'center', lineHeight: 17, paddingHorizontal: 12,
  },

});
export default React.memo(CrisisResourcesScreen);