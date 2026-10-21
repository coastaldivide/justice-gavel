import { AIDisclaimer } from '../components/AIDisclaimer';
import { escapeHtml } from '../utils/html';
import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import UPLDisclaimer from '../components/UPLDisclaimer';
/**
 * LegalResearchScreen -- AI Legal Research ($49/mo)
 *
 * Design direction: reference-grade precision.
 * Think: a well-designed legal database terminal -- dark sidebar,
 * clean white research area, monospace citations, professional density.
 * Feels like it belongs next to LexisNexis, not next to Instagram.
 *
 * The UX insight: legal research is non-linear. Attorneys ask a question,
 * get an answer, pivot, follow a citation, ask about a circuit split.
 * The interface must feel like a conversation with a knowledgeable
 * colleague, not a search engine returning blue links.
 *
 * Phases:
 *   paywall → home (new research) → searching → result (threaded)
 *   → history sidebar → session reload
 *
 * Access (GET /research/status): attorney accounts, and the paid plans that
 * include research (server `plans`, prices from GET /billing/tiers). Signed
 * out → SignInNeeded. A question is a job (POST /research/ask → poll); a
 * failed one shows the reason with "Try again" (nothing was saved).
 *
 * Entry points:
 *   1. CaseScreen → "Research" tab
 *   2. MotionLibraryScreen → "Research precedent" CTA
 *   3. Direct nav from Home
 */
import type { ScreenProps } from '../types/navigation';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Linking, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Animated, KeyboardAvoidingView, Platform, LayoutAnimation } from 'react-native';
import { unwrapList, api, apiErrorMessage } from '../services/api';
import { pollJob, JobError } from '../services/jobPoller';
import { SignInNeeded, useHasSession } from '../components/SignInNeeded';
import { t, useLang, perLang, locale }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme, themeColors } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import LegalDisclaimerModal, { hasValidConsent } from '../components/LegalDisclaimerModal';
import { hapticSelection, Clipboard } from '../utils/webCompat';

// ── Quick research prompts ────────────────────────────────────────────────────
const QUICK_PROMPTS = perLang(() => [
  { label: t('x_legal_research_motion_suppress'),  text: t('x_legal_research_what_legal_standards_successful') },
  { label: t('x_legal_research_probable_cause_stops'),text: t('x_legal_research_cases_where_motion_suppress') },
  { label: t('x_legal_research_bail_reduction'),      text: t('x_legal_research_what_factors_do_courts') },
  { label: t('x_legal_research_brady_violations'),    text: t('x_legal_research_what_constitutes_brady_violation') },
  { label: t('x_legal_research_speedy_trial'),        text: t('x_legal_research_what_barker_v_wingo') },
  { label: t('x_legal_research_miranda_exception'),   text: t('x_legal_research_what_exceptions_miranda_warnings') },
  { label: t('x_legal_research_search_incident'),     text: t('x_legal_research_what_scope_search_incident') },
  { label: t('x_legal_research_stop_frisk'),      text: t('x_legal_research_what_legal_standard_terry') },
]);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message { role: 'user' | 'assistant'; content: string; created_at?: string; error?: boolean; retryQuery?: string }
interface Tier { key: string; name: string; display_price?: string; monthly_cents?: number; billing?: string }
interface Session { id: number; title: string; updated_at: string; }
type Phase = 'paywall' | 'home' | 'searching' | 'thread' | 'history';

// ── Markdown + Citation renderer ─────────────────────────────────────────────
function MarkdownText({ text, style }: { text: string; style?: object }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();

  const citationBlue = COLORS.blue;
  const headingColor = colors.textPrimary;

  const openVerify = (citation: string) => {
    const q = encodeURIComponent(citation.trim());
    Linking.openURL('https://www.courtlistener.com/?q=' + q + '&type=o&order_by=score+desc').catch(() => showToast(t('action_failed'), 'error'));
  };

  const renderInline = (line: string, baseKey: string) => {
    const segments = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|[A-Z][A-Za-z ,&.']+v\.\s+[A-Z][A-Za-z ,&.']+,\s*\d+\s+\S+\s+\d+[^,;\s]*\s*\([^)]+\))/g);
    return segments.map((seg: string, si: number) => {
      const key = baseKey + '-' + si;
      if (seg.startsWith('**') && seg.endsWith('**')) {
        return <Text maxFontSizeMultiplier={1.4} key={key} style={{ fontFamily: 'Inter_700Bold', fontWeight: '700', color: headingColor }}>{seg.slice(2,-2)}</Text>;
      }
      if (seg.startsWith('*') && seg.endsWith('*') && !seg.startsWith('**')) {
        return <Text maxFontSizeMultiplier={1.4} key={key} style={{ fontStyle: 'italic', color: citationBlue }}>{seg.slice(1,-1)}</Text>;
      }
      if (/v\.\s+[A-Z].*\d+/.test(seg)) {
  return (
          <Text maxFontSizeMultiplier={1.4} key={key}
            style={{ fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: citationBlue,
              textDecorationLine: 'underline', fontSize: 14 }}
            onPress={() => openVerify(seg)}
            accessibilityRole="link">
            {seg}
          </Text>
        );
      }
      return <Text maxFontSizeMultiplier={1.4} key={key}>{seg}</Text>;
    });
  };

  const elements: React.ReactElement[] = [];
  const lines = String(text ?? '').split('\n');
  lines.forEach((line: string, i: number) => {
    const key = 'line-' + i;
    if (/^# /.test(line)) {
      elements.push(<Text maxFontSizeMultiplier={1.4} key={key} selectable={true} style={{ fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 18, lineHeight: 26, color: headingColor, marginTop: 16, marginBottom: 8 }}>{line.slice(2)}</Text>);
    } else if (/^## /.test(line)) {
      elements.push(<Text maxFontSizeMultiplier={1.4} key={key} selectable={true} style={{ fontFamily: 'Inter_700Bold', fontWeight: '700', fontSize: 16, lineHeight: 24, color: headingColor, marginTop: 12, marginBottom: 6 }}>{line.slice(3)}</Text>);
    } else if (/^### /.test(line)) {
      elements.push(<Text maxFontSizeMultiplier={1.4} key={key} selectable={true} style={{ fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 15, lineHeight: 22, color: headingColor, marginTop: 10, marginBottom: 4 }}>{line.slice(4)}</Text>);
    } else if (/^[-*] /.test(line)) {
      elements.push(
        <View key={key} style={{ flexDirection: 'row', marginBottom: 4, paddingLeft: 8 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: citationBlue, marginRight: 8, fontSize: 14 }}>{'•'}</Text>
          <Text maxFontSizeMultiplier={1.4} selectable={true} style={[style, { flex: 1, lineHeight: 22 }]}>{renderInline(line.slice(2), key)}</Text>
        </View>
      );
    } else if (/^\d+\. /.test(line)) {
      const numMatch = line.match(/^(\d+)\. (.*)/);
      if (numMatch) {
        elements.push(
          <View key={key} style={{ flexDirection: 'row', marginBottom: 4, paddingLeft: 8 }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: citationBlue, marginRight: 8, fontFamily: 'Inter_600SemiBold', fontWeight: '600', minWidth: 20 }}>{numMatch[1] + '.'}</Text>
            <Text maxFontSizeMultiplier={1.4} selectable={true} style={[style, { flex: 1, lineHeight: 22 }]}>{renderInline(numMatch[2], key)}</Text>
          </View>
        );
      }
    } else if (/^---+$/.test(line.trim())) {
      elements.push(<View key={key} style={{ height: 1, backgroundColor: colors.border, marginVertical: 10 }} />);
    } else if (!line.trim()) {
      elements.push(<View key={key} style={{ height: 10 }} />);
    } else {
      elements.push(<Text maxFontSizeMultiplier={1.4} key={key} selectable={true} style={[style, { lineHeight: 25, marginBottom: 2 }]}>{renderInline(line, key)}</Text>);
    }
  });

  return <View>{elements}</View>;
}


// ── Message bubble (research thread) ─────────────────────────────────────────
function ResearchBubble({ msg, onDiscussWithAI }: { msg: Message; onDiscussWithAI?: (content: string) => void }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const styles = makeStyles(colors);
  const isUser = msg.role === 'user';
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    return () => fadeAnim.stopAnimation();
  }, [fadeAnim]);

  if (isUser) return (
    <Animated.View style={[styles.userBubble, { opacity: fadeAnim,
      backgroundColor: colors.bgSubtle,
      borderColor: COLORS.navy + '33' }]}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.userQuery, { color: colors.textBrand }]} selectable={true}>{msg.content}</Text>
    </Animated.View>
  );

  return (
    <Animated.View style={[styles.assistantBubble, { opacity: fadeAnim,
      backgroundColor: colors.bgCard, borderColor: colors.border }]}>
      {/* Research result header */}
      <View style={styles.resultHeader}
        testID="legal-research-screen">
        <View style={[styles.resultDot, { backgroundColor: colors.legal }]} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.resultLabel, { color: colors.legal }]}>{t('x_legal_research_research_result')}</Text>
      </View>

      {/* Knowledge cutoff banner -- every result, every time */}
      <View style={[styles.cutoffBanner, { backgroundColor: colors.warnBg,
        borderColor: colors.gold + '70' }]}>
        <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={[styles.cutoffText, { color: colors.warnDark }]} maxFontSizeMultiplier={1.4}>{t('res_may_be_outdated')}</IconLabel>
      </View>

      <MarkdownText
        text={msg.content}
        style={[styles.assistantText, { color: colors.textPrimary }]}
      />
      {/* Copy button */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity accessibilityRole="button"
          activeOpacity={0.6}
          style={[styles.copyBtn, { borderColor: colors.border, flex: 1 }]}
          onPress={() => { hapticSelection(); Clipboard.setString(msg.content); }}
          accessibilityLabel={t('x_legal_research_copy_research_result')}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.copyBtnText, { color: colors.textMuted }]}>{t('copy')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button"
          style={[styles.copyBtn, { borderColor: COLORS.navy, flex: 1 }]}
          onPress={async () => {
            try {
              const Print = await import('expo-print');
              const Sharing = await import('expo-sharing');
              const today = new Date().toLocaleDateString(locale(), { year:'numeric', month:'long', day:'numeric' });
              const bodyHtml = msg.content.split('\n').map((line: string) => {
                if (!line.trim()) return '<p style="height:8px"></p>';
                const esc = escapeHtml(line);
                return '<p style="margin:0 0 10px">' + esc.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>') + '</p>';
              }).join('');
              const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.8;padding:1in 1.25in;color:#000}.hdr{border-bottom:1px solid #ccc;padding-bottom:8px;margin-bottom:20px;font-size:10pt;color:#555}.disc{background:#fff8e1;border:1px solid #f9a825;padding:8px;font-size:9pt;margin:16px 0}</style></head><body><div class="hdr">' + escapeHtml(t('x_legal_research_pdf_header', { date: today })) + '</div><div class="disc">' + escapeHtml(t('x_legal_research_pdf_disclaimer')) + '</div>' + bodyHtml + '</body></html>';
              const { uri } = await Print.printToFileAsync({ html, base64: false });
              const canShare = await Sharing.isAvailableAsync();
              if (canShare) {
                await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('x_legal_research_export_research'), UTI: 'com.adobe.pdf' });
              } else {
                await Print.printAsync({ html });
              }
            } catch { showToast(t('x_legal_research_could_not_generate_pdf')); }
          }}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.copyBtnText, { color: colors.textBrand }]}>{t('x_legal_research_pdf_export')}</Text>
        </TouchableOpacity>
      </View>
      {/* Discuss with AI -- continue into Defender Mode chat with research context */}
      {onDiscussWithAI && (
        <TouchableOpacity
  accessibilityRole="button"
          style={[styles.copyBtn, { borderColor: COLORS.navy + '55', backgroundColor: COLORS.navy + '08' }]}
          onPress={() => onDiscussWithAI(msg.content)}
          accessibilityLabel={t('x_legal_research_discuss_this_research_with')}
        >
          <IconLabel icon={ICONS.lawyer} textStyle={[styles.copyBtnText, { color: themeColors().textBrand }]} maxFontSizeMultiplier={1.4}>{t('res_discuss_ai')}</IconLabel>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ── Paywall: the real plans that include research ─────────────────────────────
function PaywallView({ plans, onPlans }: { plans: Tier[]; onPlans: () => void }) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <ScrollView contentContainerStyle={styles.paywallScroll} testID="research-paywall">
      <UPLDisclaimer compact />
      <View style={[styles.paywallCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <AppIcon name={ICONS.lawyer} size={20} color={themeColors().textBrand} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.paywallTitle, { color: colors.textPrimary }]}>{t('res_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.paywallSub, { color: colors.textMuted }]}>{t('res_paywall_sub')}</Text>

        <View style={[styles.featureList, { borderColor: colors.border }]}>
          {[
            t('x_legal_research_case_law_with_full'),
            t('x_legal_research_jurisdiction_aware_research'),
            t('x_legal_research_motion_precedent_standards'),
            t('x_legal_research_constitutional_law_4th_5th'),
            t('x_legal_research_threaded_research_sessions'),
          ].map(f => (
            <View key={f} style={styles.featureRow}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureCheck, { color: colors.legal }]}>✓</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureText, { color: colors.textSecond }]}>{f}</Text>
            </View>
          ))}
        </View>

        <Text maxFontSizeMultiplier={1.4} style={[styles.quickLabel, { color: colors.textMuted }]}>{t('res_paywall_plans')}</Text>
        {plans.map(p => (
          <View key={p.key} testID={`research-plan-${p.key}`} style={[styles.compareRow, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.compareName, { color: colors.textPrimary }]}>{p.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.comparePrice, { color: colors.textSecond }]}>
              {Number.isFinite(Number(p.monthly_cents)) ? t('res_price_month', { price: (Number(p.monthly_cents) / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' }) }) : ''}
            </Text>
          </View>
        ))}
        <Text maxFontSizeMultiplier={1.4} style={[styles.paywallDisclaimer, { color: colors.textMuted, marginBottom: 12 }]}>{t('res_paywall_attorneys')}</Text>

        <TouchableOpacity accessibilityRole="button" testID="research-see-plans"
          style={[styles.subscribeBtn, { backgroundColor: COLORS.navy }]} onPress={onPlans}>
          <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnText}>{t('res_see_plans')}</Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={[styles.paywallDisclaimer, { color: colors.textMuted }]}>{t('x_legal_research_cancel_anytime_verify_all')}</Text>
      </View>
      <AIDisclaimer variant="banner" />
    </ScrollView>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
const makeStyles = (colors: any = COLORS) => StyleSheet.create({
  screen:  { flex: 1 },
  centreWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, ...FONTS.heavy, marginBottom: 16 },

  // Paywall
  paywallScroll: { padding: 16, paddingBottom: 40 },
  paywallCard:   { borderRadius: RADIUS.xl, borderWidth: 1, padding: 20, ...SHADOW.sm },
  paywallIcon:   { fontSize: 44, textAlign: 'center', marginBottom: 10 },
  paywallTitle:  { fontSize: 22, ...FONTS.black, textAlign: 'center', marginBottom: 8 },
  paywallSub:    { fontSize: 12, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  compareRow:    { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md,
    borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 6 },
  compareName:   { flex: 1, fontSize: 12 },
  comparePrice:  { fontSize: 12, marginRight: 10 },
  compareCheck:  { fontSize: 16,
    lineHeight: 24, },
  featureList:   { borderRadius: RADIUS.md, borderWidth: 0.5, padding: 16, marginVertical: 16 },
  featureRow:    { flexDirection: 'row', gap: 8, marginBottom: 7, alignItems: 'flex-start' },
  featureCheck:  { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700', flexShrink: 0 },
  featureText:   { flex: 1, fontSize: 12, lineHeight: 18 },
  subscribeBtn:  { borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center',
    marginBottom: 8, ...SHADOW.sm },
  subscribeBtnText: { color: colors.textOnNavy, fontSize: 14, lineHeight: 21, ...FONTS.black },
  annualBtn:     { borderRadius: RADIUS.md, borderWidth: 1.5, paddingVertical: 11, alignItems: 'center', marginBottom: 10 },
  annualBtnText: { fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  paywallDisclaimer: { fontSize: 11, textAlign: 'center', lineHeight: 16 },

  // Home
  threadContent: { padding: 16, paddingBottom: 8 },
  homeContent:   { flexGrow: 1 },
  homeTitle:     { fontSize: 20, ...FONTS.black, marginBottom: 6 },
  homeSub:       { fontSize: 12, lineHeight: 20, marginBottom: 14 },
  contextPill:   { alignSelf: 'flex-start', borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
  contextPillText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  quickLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 8 },
  quickScroll:   { marginBottom: 14 },
  quickChip:     { paddingHorizontal: 16, paddingVertical: 9, borderRadius: RADIUS.pill,
    borderWidth: 1.5, flexShrink: 0 },
  quickChipText: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  disclaimerBox: { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginBottom: 16 },
  disclaimerText:{ fontSize: 11, lineHeight: 16 },

  // Thread
  userBubble:    { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 10 },
  userQuery:     { fontSize: 14, ...FONTS.heavy, lineHeight: 20 },
  assistantBubble: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 14, ...SHADOW.sm },
  resultHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  resultDot:     { width: 7, height: 7, borderRadius: 4.5 },
  resultLabel:   { fontSize: 11, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  assistantText: { fontSize: 15, lineHeight: 25, fontFamily: 'Inter_400Regular' },
  copyBtn:       { alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 10, marginTop: 10 },
  copyBtnText:   { fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  // Searching indicator
  searchingRow:  { flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 10 },
  searchingText: { fontSize: 12 },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 0.5,
  },
  queryInput: {
    flex: 1, borderWidth: 1.5, borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    fontSize: 14, maxHeight: 120, lineHeight: 20,
  },
  searchBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  searchBtnText: { color: colors.bgCard, fontSize: 20, fontWeight: '300' },

  // History
  histRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, padding: 16, marginBottom: 8 },
  histIcon:  { fontSize: 20 },
  histTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2, lineHeight: 18 },
  histDate:  { fontSize: 11 },

  // New search button
  newSearchBtn:     { borderRadius: RADIUS.lg, paddingVertical: 13, paddingHorizontal: 24,
    alignItems: 'center', marginTop: 12 },
  newSearchBtnText: { color: colors.textPrimary, fontSize: 14, lineHeight: 21, ...FONTS.black },
  cutoffBanner:  { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 10 },
  cutoffText:    { fontSize: 11, lineHeight: 16 },
});
function LegalResearchScreen({ route, navigation }: ScreenProps) {
  useLang();
  const { showToast } = useToast();
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [disclaimerVisible, setDisclaimerVisible] = React.useState(false);
  React.useEffect(() => { hasValidConsent().then(ok => { if (!ok) setDisclaimerVisible(true); }).catch(() => {}); }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const { AuthGateModal } = useAuthGate(navigation);
  const { hasSession, recheck } = useHasSession();
  const { initialQuery, caseContext } = (route?.params as import('../types/api').RouteParams) ?? {};

  const [phase,      setPhase]      = useState<Phase>('home');
  const [query,      setQuery]      = useState(initialQuery || '');
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [sessionId,  setSessionId]  = useState<number | null>(null);
  const [searching,  setSearching]  = useState(false);
  const [hasAccess,  setHasAccess]  = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState('');
  const [plans,      setPlans]      = useState<Tier[]>([]);
  const [history,    setHistory]    = useState<Session[]>([]);
  const [histLoading,setHistLoad]   = useState(false);

  const listRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Access: who may research, and the plans that include it.
  const checkAccess = useCallback(async () => {
    setStatusError('');
    try {
      const r = await api.get('/research/status');
      setHasAccess(!!r.data?.has_access);
      if (!r.data?.has_access) {
        setPhase('paywall');
        const wanted: string[] = Array.isArray(r.data?.plans) ? r.data.plans : [];
        const tiers = await api.get<{ tiers: Tier[] }>('/billing/tiers').catch(() => null);
        setPlans((tiers?.data?.tiers || []).filter(x => wanted.includes(x.key) && x.billing !== 'annual'));
      }
    } catch (e) {
      setStatusError(apiErrorMessage(e, t('res_load_error')));
    }
  }, []);
  useEffect(() => { if (hasSession) checkAccess(); }, [hasSession, checkAccess]);

  const loadHistory = useCallback(async () => {
    setHistLoad(true);
    try {
      const res = await api.get('/research/history');
      setHistory(unwrapList(res.data, 'history', 'sessions'));
      setPhase('history');
    } catch (e: any) { __DEV__ && console.warn(e?.message); }
    setHistLoad(false);
  }, []);

  const loadSession = useCallback(async (sess: Session) => {
    try {
      const res = await api.get(`/research/session/${sess.id}`);
      setMessages(res.data?.messages || []);
      setSessionId(sess.id);
      setPhase('thread');
      const _t1 = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 200); return () => clearTimeout(_t1);
    } catch {
      showToast(t('res_load_error'), 'error');
    }
  }, [showToast]);

  const runSearch = useCallback(async (q: string, { retry = false }: { retry?: boolean } = {}) => {
    const text = q.trim();
    if (!text || searching) return;
    setSearching(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setMessages(prev => {
      const kept = retry ? prev.filter(m => !m.error) : prev;
      return retry ? kept : [...kept, { role: 'user', content: text, created_at: new Date().toISOString() }];
    });
    setQuery('');
    setPhase('thread');

    try {
      const res = await api.post('/research/ask', { query: text, session_id: sessionId, context: caseContext }, { signal: ctrl.signal });
      if (res.data?.session_id) setSessionId(res.data.session_id);
      const job = await pollJob(String(res.data?.jobId), { signal: ctrl.signal, timeoutMs: 120_000 });
      const answer = String((job.result as { answer?: string } | null)?.answer || '');
      if (!answer) throw new JobError('ai_failed', t('x_legal_research_research_failed_check_connection'));
      setMessages(prev => [...prev, { role: 'assistant', content: answer, created_at: new Date().toISOString() }]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if ((e as { response?: { status?: number } })?.response?.status === 402) { setPhase('paywall'); checkAccess(); return; }
      const errMsg = e instanceof JobError ? e.message : apiErrorMessage(e, t('x_legal_research_research_failed_check_connection'));
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg, error: true, retryQuery: text }]);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      if (!ctrl.signal.aborted) setSearching(false);
    }
  }, [searching, sessionId, caseContext, checkAccess]);

  // Header buttons (declared after loadHistory, which they call)
  useEffect(() => {
    navigation.setOptions({
      title: phase === 'history' ? t('x_legal_research_research_history') : t('x_nav_legal_research'),
      headerRight: () => hasAccess && phase !== 'paywall' ? (
        <View style={{ flexDirection: 'row', gap: 16, marginRight: 14 }}>
          <TouchableOpacity accessibilityRole="button" onPress={loadHistory} accessibilityLabel={t('x_discovery_history')}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textBrand, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>{t('x_discovery_history')}</Text>
          </TouchableOpacity>
          {phase === 'thread' && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setMessages([]); setSessionId(null); setQuery(''); setPhase('home');
              }}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textBrand, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>{t('x_discovery_new')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null,
    });
  }, [colors.textBrand, phase, hasAccess, loadHistory, navigation]);

  // Auto-search once if an initial query was provided (when access is known).
  const autoSearchedRef = useRef(false);
  useEffect(() => {
    if (!initialQuery || !hasAccess || autoSearchedRef.current) return;
    autoSearchedRef.current = true;
    runSearch(initialQuery);
  }, [hasAccess, initialQuery, runSearch]);

  // ── RENDER: Signed out / loading / error ──────────────────────────────────
  if (hasSession === false) return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={{ padding: 16 }}>
      <SignInNeeded navigation={navigation} title={t('res_title')} body={t('res_signin_body')} onSignedIn={recheck} testID="research-sign-in" />
    </ScrollView>
  );
  if (statusError) return (
    <View style={[styles.screen, styles.centreWrap, { backgroundColor: colors.bg }]} testID="research-error">
      <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary, textAlign: 'center' }]}>{statusError}</Text>
      <TouchableOpacity accessibilityRole="button" style={[styles.subscribeBtn, { backgroundColor: COLORS.navy, paddingHorizontal: 24 }]} onPress={checkAccess}>
        <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnText}>{t('try_again')}</Text>
      </TouchableOpacity>
    </View>
  );
  if (hasAccess === null) return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ActivityIndicator style={{ flex: 1 }} color={themeColors().textBrand} />
    </View>
  );

  // ── RENDER: Paywall ───────────────────────────────────────────────────────
  if (phase === 'paywall') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AuthGateModal />
      <PaywallView plans={plans} onPlans={() => navigation.navigate('ConsumerSubscription')} />
    </View>
  );

  // ── RENDER: History ───────────────────────────────────────────────────────
  if (phase === 'history') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ padding: 16, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}>
      {histLoading
        ? <ActivityIndicator color={themeColors().textBrand} style={{ marginTop: 40 }} />
        : history.length === 0
        ? (
          <View style={styles.centreWrap}>
            <AppIcon name={ICONS.book} size={40} color={colors.textBrand} style={{ fontSize: 40, marginBottom: 12 }} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t('res_history_empty')}</Text>
            <TouchableOpacity
  accessibilityRole="button"
              accessibilityLabel={t('res_history_start')} onPress={() => setPhase('home')}
              >
              <Text maxFontSizeMultiplier={1.4} style={styles.newSearchBtnText}>{t('res_history_start')}</Text>
            </TouchableOpacity>
          </View>
        )
        : history.map(sess => (
          <TouchableOpacity accessibilityRole="button"
            key={sess.id}
            style={[styles.histRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            accessibilityLabel={sess.title} onPress={() => loadSession(sess)}
          >
            <AppIcon name={ICONS.lawyer} size={20} color={themeColors().textBrand} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.histTitle, { color: colors.textPrimary }]}
                numberOfLines={2}>{sess.title}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.histDate, { color: colors.textMuted }]}>
                {new Date(sess.updated_at ?? 0).toLocaleDateString(locale(), {
                  month: 'short', day: 'numeric', year: 'numeric'
                })}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[{ color: colors.textMuted, fontSize: 20 }]}>›</Text>
          </TouchableOpacity>
        ))
      }
    </ScrollView>
  );

  // ── RENDER: Home + Thread ─────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <AuthGateModal />

      {/* Thread / home scroll area */}
      <ScrollView
        ref={listRef}
        contentContainerStyle={[
          styles.threadContent,
          phase === 'home' && styles.homeContent,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Home state ──────────────────────────────────────────────────── */}
        {phase === 'home' && (
          <>
            <Text maxFontSizeMultiplier={1.4} style={[styles.homeTitle, { color: colors.textPrimary }]}>
              {t('res_home_title')}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.homeSub, { color: colors.textMuted }]}>
              {t('res_home_sub')}
            </Text>

            {caseContext && (
              <View style={[styles.contextPill, {
                backgroundColor: COLORS.navy + '14',
                borderColor: COLORS.navy + '33'
              }]}>
                <IconLabel icon={ICONS.cases} textStyle={[styles.contextPillText, { color: themeColors().textBrand }]} maxFontSizeMultiplier={1.4} numberOfLines={1}>{caseContext}</IconLabel>
              </View>
            )}

            {/* Quick prompts */}
            <Text maxFontSizeMultiplier={1.4} style={[styles.quickLabel, { color: colors.textMuted }]}>
              {t('x_legal_research_common_research_queries')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={styles.quickScroll} contentContainerStyle={{ gap: 8 }}>
              {QUICK_PROMPTS().map(p => (
                <TouchableOpacity
  accessibilityRole="button"
                  key={p.label}
                  style={[styles.quickChip, {
                    backgroundColor: colors.bgCard,
                    borderColor: colors.border,
                  }]}
                  onPress={() => runSearch(p.text)}
                  accessibilityLabel={p.label}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[styles.quickChipText, { color: colors.textPrimary }]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={[styles.disclaimerBox, {
              backgroundColor: isDark ? colors.bgCard : colors.warnBg,
              borderColor: colors.gold + '55'
            }]}>
              <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={[styles.disclaimerText, { color: isDark ? colors.gold : colors.textSecond }]} maxFontSizeMultiplier={1.4}>{t('x_legal_research_always_verify_citations_before')}</IconLabel>
            </View>
          </>
        )}

        {/* ── Thread ──────────────────────────────────────────────────────── */}
        {(messages ?? []).map((msg, i) => msg.error ? (
          <View key={`msg-${i}`} testID="research-error-msg" style={[styles.searchingRow, { backgroundColor: colors.bgCard, borderColor: colors.border, flexDirection: 'column', alignItems: 'flex-start' }]}>
            <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={[styles.searchingText, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{msg.content}</IconLabel>
            <TouchableOpacity accessibilityRole="button" testID="research-retry" disabled={searching}
              style={[styles.copyBtn, { borderColor: COLORS.navy }]} onPress={() => runSearch(msg.retryQuery || '', { retry: true })}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.copyBtnText, { color: colors.textBrand }]}>↻ {t('chat_retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ResearchBubble key={`msg-${i}`} msg={msg}
            onDiscussWithAI={msg.role === 'assistant'
              ? (content: string) => navigation.navigate('ChatTab', { mode: 'defender', caseContext: content.slice(0, 2000), caseTitle: t('legal_research') })
              : undefined} />
        ))}

        {/* Searching indicator */}
        {searching && (
          <View style={[styles.searchingRow, {
            backgroundColor: colors.bgCard,
            borderColor: colors.border
          }]}>
            <ActivityIndicator size="small" color={colors.legal} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.searchingText, { color: colors.textMuted }]}>
              {t('x_legal_research_searching_case_law_statutes')}
            </Text>
          </View>
        )}
        <View style={{ height: 16 }} />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.warn,
        padding:12, marginTop:12 }}>
        <IconLabel icon={ICONS.lawyer} textStyle={{ fontSize:11, color:colors.textSecond, fontStyle:'italic', lineHeight:16 }} maxFontSizeMultiplier={1.3}>{t('x_legal_research_ai_legal_research_not')}</IconLabel>
      </View>
      </ScrollView>

      {/* Input bar */}
      <View style={[styles.inputBar, {
        backgroundColor: isDark ? colors.tabBg : colors.bg,
        borderTopColor: colors.border,
      }]}>
        <TextInput
          style={[styles.queryInput, {
            backgroundColor: colors.bgCard,
            borderColor: colors.border,
            color: colors.textPrimary,
          }]}
          placeholder={phase === 'thread'
            ? t('res_placeholder_follow')
            : t('x_legal_research_e_g_tennessee_cases')}
          placeholderTextColor={colors.textSecond}
          value={query}
          onChangeText={setQuery}
          multiline
          maxLength={2000}
          onSubmitEditing={() => runSearch(query)}

          returnKeyType="next"
          blurOnSubmit
        />
        <TouchableOpacity
  accessibilityRole="button"
          style={[styles.searchBtn, {
            backgroundColor: query.trim() && !searching ? COLORS.navy : colors.border
          }]}
          onPress={() => runSearch(query)}
          disabled={!query.trim() || searching}
          accessibilityLabel={t('x_legal_research_run_legal_research')}
        >
          {searching
            ? <ActivityIndicator color={colors.bgCard} size="small" />
            : <Text maxFontSizeMultiplier={1.4} style={styles.searchBtnText}>→</Text>}
        </TouchableOpacity>
      </View>
      <LegalDisclaimerModal visible={disclaimerVisible} onAccept={() => setDisclaimerVisible(false)} featureContext="research" />
    </KeyboardAvoidingView>
  );

// ── Styles ────────────────────────────────────────────────────────────────────

// Module-level fallback for helper components
}
export default React.memo(LegalResearchScreen);