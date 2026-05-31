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
 * Entry points:
 *   1. CaseScreen → "Research" tab
 *   2. MotionLibraryScreen → "Research precedent" CTA
 *   3. Direct nav from Home
 */
import type { ScreenProps } from '../types/navigation';
import React, {
  useState, useEffect, useCallback, useRef, useMemo
} from 'react';
import { View, Text, Linking, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Platform, Clipboard, RefreshControl} from 'react-native';
import { api } from '../services/api';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme } from '../constants/theme';
import { useAuthGate } from '../components/AuthGate';
import LegalDisclaimerModal, { hasValidConsent } from '../components/LegalDisclaimerModal';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';

declare var loadHistory: any; // hoisted from component scope
declare var mountedRef: any; // hoisted from component scope
declare var onDiscussWithAI: any; // hoisted from component scope
declare var onRefresh: any; // hoisted from component scope
declare var refreshing: any; // hoisted from component scope
// ── Quick research prompts ────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  { label: 'Motion to suppress',  text: 'What are the legal standards for a successful motion to suppress? Cite key federal and state cases.' },
  { label: 'Probable cause stops',text: 'Cases where a motion to suppress was granted for a traffic stop without probable cause. Cite the cases and holdings.' },
  { label: 'Bail reduction',      text: 'What factors do courts consider when ruling on a motion for bail reduction? List the key cases.' },
  { label: 'Brady violations',    text: 'What constitutes a Brady violation and what is the remedy? Cite Brady v. Maryland and subsequent cases.' },
  { label: 'Speedy trial',        text: 'What are the Barker v. Wingo factors for speedy trial analysis? How do courts apply them?' },
  { label: 'Miranda exception',   text: 'What are the exceptions to Miranda warnings? When can statements be admitted despite no warning?' },
  { label: 'Search incident',     text: 'What is the scope of a search incident to arrest? Cite Chimel v. California and later developments.' },
  { label: 'Stop and frisk',      text: 'What is the legal standard for a Terry stop? What justifies a pat-down for weapons?' },
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message { role: 'user' | 'assistant'; content: string; created_at?: string; }
interface Session { id: number; title: string; updated_at: string; }
type Phase = 'paywall' | 'home' | 'searching' | 'thread' | 'history';

// ── Markdown + Citation renderer ─────────────────────────────────────────────
function MarkdownText({ text, style }: { text: string; style?: object }) {
  const { colors, isDark } = useTheme();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await loadHistory(); } catch {}
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 800);
  }, []);

  const citationBlue = COLORS.blue;
  const headingColor = COLORS.textPrimary;

  const openVerify = (citation: string) => {
    const q = encodeURIComponent(citation.trim());
    Linking.openURL('https://www.courtlistener.com/?q=' + q + '&type=o&order_by=score+desc').catch(() => {});
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
  const lines = text.split('\n');
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
      elements.push(<View key={key} style={{ height: 1, backgroundColor: COLORS.border, marginVertical: 10 }} />);
    } else if (!line.trim()) {
      elements.push(<View key={key} style={{ height: 10 }} />);
    } else {
      elements.push(<Text maxFontSizeMultiplier={1.4} key={key} selectable={true} style={[style, { lineHeight: 25, marginBottom: 2 }]}>{renderInline(line, key)}</Text>);
    }
  });

  return <View>{elements}</View>;
}

function HighlightedText({ text, style }: { text: string; style?: object }) {
  const { colors } = useTheme();
  // Match case citations: Name v. Name, 123 F.3d 456 (Court Year)
  const parts = text.split(/(\*[^*]+\*|\b[A-Z][a-z].*?v\..*?,\s*\d+\s+\S+\s+\d+\s*\([^)]+\))/g);

  const openVerify = (citation: string) => {
    // CourtListener full-text search -- free, comprehensive federal cases
    const q = encodeURIComponent(citation.trim());
    Linking.openURL(`https://www.courtlistener.com/?q=${q}&type=o&order_by=score+desc`).catch(() => {});
  };

  return (
    <Text maxFontSizeMultiplier={1.4} style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('*') && part.endsWith('*')) {
          return <Text maxFontSizeMultiplier={1.4} key={i} style={{ fontStyle: 'italic', color: COLORS.navy }}>{part.slice(1,-1)}</Text>;
        }
        if (/v\..*\d+\s+\S+\s+\d+/.test(part)) {
          // Tappable citation -- opens CourtListener for instant verification
          return (
            <Text maxFontSizeMultiplier={1.4}
              key={i}
              style={{ fontFamily: 'monospace', fontSize: 12, color: COLORS.navy,
                fontWeight: '700', textDecorationLine: 'underline' }}
              onPress={() => openVerify(part)}
              accessibilityRole="link"
              accessibilityLabel={`Verify citation: ${part}`}
              accessibilityHint="Opens CourtListener to verify this case citation"
            >
              {part} ↗
            </Text>
          );
        }
        return <Text maxFontSizeMultiplier={1.4} key={i}>{part}</Text>;
      })}
    </Text>
  );
}

// ── Message bubble (research thread) ─────────────────────────────────────────
function ResearchBubble({ msg }: { msg: Message }) {
  const styles = makeStyles(COLORS);
  const { colors, isDark } = useTheme();
  const isUser = msg.role === 'user';
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    return () => fadeAnim.stopAnimation();
  }, []);

  if (isUser) return (
    <Animated.View style={[styles.userBubble, { opacity: fadeAnim,
      backgroundColor: COLORS.bgSubtle,
      borderColor: COLORS.navy + '33' }]}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.userQuery, { color: COLORS.navy }]} selectable={true}>{msg.content}</Text>
    </Animated.View>
  );

  return (
    <Animated.View style={[styles.assistantBubble, { opacity: fadeAnim,
      backgroundColor: COLORS.bgCard, borderColor: COLORS.border }]}>
      {/* Research result header */}
      <View style={styles.resultHeader}
        testID="legal-research-screen">
        <View style={[styles.resultDot, { backgroundColor: COLORS.legal }]} />
        <Text maxFontSizeMultiplier={1.4} style={[styles.resultLabel, { color: COLORS.legal }]}>Research Result</Text>
      </View>

      {/* Knowledge cutoff banner -- every result, every time */}
      <View style={[styles.cutoffBanner, { backgroundColor: COLORS.warnBg,
        borderColor: COLORS.gold + '70' }]}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.cutoffText, { color: COLORS.warnDark }]}>
          ⚠️  Knowledge cutoff: August 2025 -- verify all citations before relying on them in court.
          Tap any underlined citation to check on CourtListener.
        </Text>
      </View>

      <MarkdownText
        text={msg.content}
        style={[styles.assistantText, { color: COLORS.textPrimary }]}
      />
      {/* Copy button */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity accessibilityRole="button"
          activeOpacity={0.6}
          style={[styles.copyBtn, { borderColor: COLORS.border, flex: 1 }]}
          onPress={() => { hapticSelection(); Clipboard.setString(msg.content); }}
          accessibilityLabel="Copy research result"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.copyBtnText, { color: COLORS.textMuted }]}>Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button"
          style={[styles.copyBtn, { borderColor: COLORS.navy, flex: 1 }]}
          onPress={async () => {
            try {
              const { default: Print } = await import('expo-print');
              const { default: Sharing } = await import('expo-sharing');
              const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
              const bodyHtml = msg.content.split('\n').map((line: string) => {
                if (!line.trim()) return '<p style="height:8px"></p>';
                const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                return '<p style="margin:0 0 10px">' + esc.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>') + '</p>';
              }).join('');
              const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.8;padding:1in 1.25in;color:#000}.hdr{border-bottom:1px solid #ccc;padding-bottom:8px;margin-bottom:20px;font-size:10pt;color:#555}.disc{background:#fff8e1;border:1px solid #f9a825;padding:8px;font-size:9pt;margin:16px 0}</style></head><body><div class="hdr">Justice Gavel Legal Research &middot; ' + today + '</div><div class="disc">AI research &mdash; verify all citations before relying on them in court. Knowledge cutoff August 2025.</div>' + bodyHtml + '</body></html>';
              const { uri } = await Print.printToFileAsync({ html, base64: false });
              const canShare = await Sharing.isAvailableAsync();
              if (canShare) {
                await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export Research', UTI: 'com.adobe.pdf' });
              } else {
                await Print.printAsync({ html });
              }
            } catch { Alert.alert('Export failed', 'Could not generate PDF.'); }
          }}
          accessibilityLabel="Export as PDF"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.copyBtnText, { color: COLORS.navy }]}>PDF Export</Text>
        </TouchableOpacity>
      </View>
      {/* Discuss with AI -- continue into Defender Mode chat with research context */}
      {onDiscussWithAI && (
        <TouchableOpacity
  accessibilityRole="button"
          style={[styles.copyBtn, { borderColor: COLORS.navy + '55', backgroundColor: COLORS.navy + '08' }]}
          onPress={() => onDiscussWithAI(msg.content)}
          accessibilityLabel="Discuss this research with AI"
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.copyBtnText, { color: COLORS.navy }]}>⚖️ Discuss with AI</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ── Paywall screen ────────────────────────────────────────────────────────────
function PaywallView({ onSubscribe, loading, colors }: any) {
  const styles = makeStyles(COLORS);
  return (
    <ScrollView contentContainerStyle={styles.paywallScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
      <UPLDisclaimer compact />
      <View style={[styles.paywallCard, {
        backgroundColor: COLORS.bgSubtle,
        borderColor: COLORS.navy + '33'
      }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.paywallIcon}>⚖️</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.paywallTitle, { color: COLORS.textPrimary }]}>
          AI Legal Research
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.paywallSub, { color: COLORS.textMuted }]}>
          Westlaw costs $100-500/mo and hasn't changed since 2005.
          Get case law, statutes, and legal standards in seconds.
        </Text>

        {/* Comparison table */}
        {[
          ['Westlaw',            '$100-500/mo', '❌'],
          ['Casetext',          '$65/mo',      '❌'],
          ['Harvey AI',         '$500+/mo',    '❌'],
          ['Justice Gavel Research', '$49.99/mo', '✅'],
        ].map(([name, price, check]) => (
          <View key={name} style={[styles.compareRow, {
            backgroundColor: check === '✅'
              ? (COLORS.legalBg)
              : COLORS.bgCard,
            borderColor: check === '✅' ? COLORS.legal + '55' : COLORS.border,
          }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.compareName, { color: check === '✅' ? COLORS.legal : COLORS.textSecond,
              fontWeight: check === '✅' ? '800' : '400' }]}>{name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.comparePrice, { color: check === '✅' ? COLORS.legal : COLORS.textMuted }]}>{price}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.compareCheck}>{check}</Text>
          </View>
        ))}

        {/* Features */}
        <View style={[styles.featureList, { borderColor: COLORS.border }]}>
          {[
            'Case law with full citations',
            'Jurisdiction-aware research',
            'Motion precedent & standards',
            'Constitutional law (4th, 5th, 6th)',
            'Sentencing ranges & factors',
            'Unlimited queries per month',
            'Threaded research sessions',
          ].map(f => (
            <View key={f} style={styles.featureRow}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureCheck, { color: COLORS.legal }]}>✓</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.featureText, { color: COLORS.textSecond }]}>{f}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity accessibilityRole="button"
          style={[styles.subscribeBtn, { backgroundColor: COLORS.navy }, loading && { opacity: 0.6 }]}
          onPress={() => onSubscribe('legal_research')}
          disabled={loading}
          accessibilityLabel="Subscribe to Legal Research for $49.99/mo"
        >
          {loading
            ? <ActivityIndicator color={COLORS.bgCard} />
            : <Text maxFontSizeMultiplier={1.4} style={styles.subscribeBtnText}>Start 14-Day Free Trial -- $49.99/mo</Text>}
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button"
          style={[styles.annualBtn, { borderColor: COLORS.navy + '55' }]}
          onPress={() => onSubscribe('legal_research_annual')}
          disabled={loading}
        >
          <Text maxFontSizeMultiplier={1.4} style={[styles.annualBtnText, { color: COLORS.navy }]}>
            Annual -- $374.99/yr · Save $224/yr
          </Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.4} style={[styles.paywallDisclaimer, { color: COLORS.textMuted }]}>
          Cancel anytime. Verify all citations independently before filing.
        </Text>
      </View>
    </ScrollView>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
const makeStyles = (colors: any) => StyleSheet.create({
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
  subscribeBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },
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
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  searchBtnText: { color: COLORS.bgCard, fontSize: 20, fontWeight: '300' },

  // History
  histRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, padding: 16, marginBottom: 8 },
  histIcon:  { fontSize: 20 },
  histTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', marginBottom: 2, lineHeight: 18 },
  histDate:  { fontSize: 11 },

  // New search button
  newSearchBtn:     { borderRadius: RADIUS.lg, paddingVertical: 13, paddingHorizontal: 24,
    alignItems: 'center', marginTop: 12 },
  newSearchBtnText: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },
  cutoffBanner:  { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 10 },
  cutoffText:    { fontSize: 11, lineHeight: 16 },
});
export default function LegalResearchScreen({ route, navigation }: ScreenProps) {
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [disclaimerVisible, setDisclaimerVisible] = React.useState(false);
  React.useEffect(() => { hasValidConsent().then(ok => { if (!ok) setDisclaimerVisible(true); }).catch(() => {}); }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const { requireAuth, AuthGateModal } = useAuthGate(navigation);
  const { initialQuery, caseContext } = (route?.params as import('../types/api').RouteParams) ?? {};

  const [phase,      setPhase]      = useState<Phase>('home');
  const [query,      setQuery]      = useState(initialQuery || '');
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [sessionId,  setSessionId]  = useState<number | null>(null);
  const [searching,  setSearching]  = useState(false);
  const [hasAccess,  setHasAccess]  = useState<boolean | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [history,    setHistory]    = useState<Session[]>([]);
  const [histLoading,setHistLoad]   = useState(false);

  const listRef = useRef<ScrollView>(null);

  // Check access on mount
  useEffect(() => {
    api.get('/research/status')
      .then(r => {
        setHasAccess(r.data?.has_access);
        if (!r.data?.has_access) setPhase('paywall');
      })
      .catch(() => setHasAccess(true)); // fail open in demo
  }, []);

  // Header buttons
  useEffect(() => {
    navigation.setOptions({
      title: phase === 'history' ? '📚 Research History' : '⚖️ Legal Research',
      headerRight: () => hasAccess && phase !== 'paywall' ? (
        <View style={{ flexDirection: 'row', gap: 16, marginRight: 14 }}>
          <TouchableOpacity accessibilityRole="button" onPress={loadHistory} accessibilityLabel="History">
            <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.navy, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>History</Text>
          </TouchableOpacity>
          {phase === 'thread' && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setMessages([]); setSessionId(null); setQuery(''); setPhase('home');
              }}
            >
              <Text maxFontSizeMultiplier={1.4} style={{ color: COLORS.navy, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' }}>New</Text>
            </TouchableOpacity>
          )}
        </View>
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
      ) : null,
    });
  }, [phase, hasAccess]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Auto-search if initial query provided
  useEffect(() => {
    if (initialQuery && hasAccess) runSearch(initialQuery);
  }, [hasAccess]);

  const subscribe = useCallback(async (tier: string) => {
    requireAuth(async () => {
      setSubLoading(true);
      try {
        await api.post('/billing/subscribe', { tier, provider_type: 'addon' });
        setHasAccess(true);
        setPhase('home');
        Alert.alert('Welcome!', 'Your Legal Research trial is active. Start searching.');
      } catch (e: any) {
        const msg = e.response?.data?.error || 'Could not start subscription.';
        Alert.alert('Subscription error', msg);
      } finally {
        setSubLoading(false);
      }
    });
  }, [requireAuth]);

  const loadHistory = useCallback(async () => {
    setHistLoad(true);
    try {
      const res = await api.get('/research/history');
      setHistory(res.data || []);
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
      Alert.alert(t('res_load_error'));
    }
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text || searching) return;
    setSearching(true);

    const userMsg: Message = { role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setPhase('thread');

    try {
      const res = await api.post('/research/ask', {
        query: text,
        session_id: sessionId,
        context: caseContext,
      });
      setSessionId(res.data?.session_id);
      const assistantMsg: Message = {
        role: 'assistant',
        content: res.data?.answer,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      const errMsg = e.response?.data?.error || 'Research failed. Check your connection.';
      if (e.response?.status === 402) {
        setPhase('paywall');
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠️ ' + errMsg + '\n\nPlease try again.',
        }]);
      }
    } finally {
      setSearching(false);
    }
  }, [searching, sessionId, caseContext]);

  // ── RENDER: Loading ───────────────────────────────────────────────────────
  if (hasAccess === null) return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ActivityIndicator style={{ flex: 1 }} color={COLORS.navy} />
    </View>
  );

  // ── RENDER: Paywall ───────────────────────────────────────────────────────
  if (phase === 'paywall') return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AuthGateModal />
      <PaywallView onSubscribe={subscribe} loading={subLoading} colors={colors} isDark={isDark} />
    </View>
  );

  // ── RENDER: History ───────────────────────────────────────────────────────
  if (phase === 'history') return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ padding: 16 }}>
      {histLoading
        ? <ActivityIndicator color={COLORS.navy} style={{ marginTop: 40 }} />
        : history.length === 0
        ? (
          <View style={styles.centreWrap}>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 40, marginBottom: 12 }}>📚</Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>No research yet</Text>
            <TouchableOpacity
  accessibilityRole="button"
              accessibilityLabel="Start Researching \u2192" onPress={() => setPhase('home')}
              >
              <Text maxFontSizeMultiplier={1.4} style={styles.newSearchBtnText}>Start Researching →</Text>
            </TouchableOpacity>
          </View>
        )
        : history.map(sess => (
          <TouchableOpacity accessibilityRole="button"
            key={sess.id}
            style={[styles.histRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            accessibilityLabel="\u2696\ufe0f" onPress={() => loadSession(sess)}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.histIcon}>⚖️</Text>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.histTitle, { color: colors.textPrimary }]}
                numberOfLines={2}>{sess.title}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.histDate, { color: colors.textMuted }]}>
                {new Date(sess.updated_at ?? 0).toLocaleDateString('en-US', {
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
              What do you need to research?
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={[styles.homeSub, { color: colors.textMuted }]}>
              Case law · Statutes · Constitutional standards · Sentencing
            </Text>

            {caseContext && (
              <View style={[styles.contextPill, {
                backgroundColor: COLORS.navy + '14',
                borderColor: COLORS.navy + '33'
              }]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.contextPillText, { color: COLORS.navy }]}
                  numberOfLines={1}>📁 {caseContext}</Text>
              </View>
            )}

            {/* Quick prompts */}
            <Text maxFontSizeMultiplier={1.4} style={[styles.quickLabel, { color: colors.textMuted }]}>
              Common research queries
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={styles.quickScroll} contentContainerStyle={{ gap: 8 }}>
              {QUICK_PROMPTS.map(p => (
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
              <Text maxFontSizeMultiplier={1.4} style={[styles.disclaimerText, { color: isDark ? colors.gold : colors.textSecond }]}>
                ⚠️  Always verify citations before filing. AI research may miss recent decisions. Use Westlaw or Lexis for appellate work.
              </Text>
            </View>
          </>
        )}

        {/* ── Thread ──────────────────────────────────────────────────────── */}
        {messages.map((msg, i) => (
          <ResearchBubble key={i} msg={msg} />
        ))}

        {/* Searching indicator */}
        {searching && (
          <View style={[styles.searchingRow, {
            backgroundColor: colors.bgCard,
            borderColor: colors.border
          }]}>
            <ActivityIndicator size="small" color={COLORS.legal} />
            <Text maxFontSizeMultiplier={1.4} style={[styles.searchingText, { color: colors.textMuted }]}>
              Searching case law and statutes…
            </Text>
          </View>
        )}
        <View style={{ height: 16 }} />

      <View style={{ backgroundColor:colors.bgCard, borderRadius:10,
        borderLeftWidth:4, borderLeftColor:colors.warn,
        padding:12, marginTop:12 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize:11, color:'#555', fontStyle:'italic', lineHeight:16 }}>
          ⚖️ AI legal research is not legal advice. Analysis may miss key issues or
          misinterpret jurisdiction-specific rules. Have an attorney review all documents.
        </Text>
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
            : 'e.g. Tennessee cases suppressing traffic stop evidence…'}
          placeholderTextColor={COLORS.textSecond}
          value={query}
          onChangeText={setQuery}
          multiline
          maxLength={2000}
          accessibilityLabel="Legal research query"
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
          accessibilityLabel="Run legal research"
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