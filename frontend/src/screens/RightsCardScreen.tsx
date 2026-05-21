/**
 * RightsCardScreen -- "Know Your Rights" wallet card generator
 *
 * Flow:
 *   1. Detect user's state from GPS (or manual picker)
 *   2. Fetch state-specific rights card data from backend
 *   3. Render a beautiful wallet-sized card using React Native
 *   4. User taps "Share" → native share sheet (image + text)
 *   5. Also "Save to Camera Roll" option
 *
 * Free for Starter+ subscribers. Unsubscribed users see a preview + upgrade prompt.
 * Designed for TikTok virality: "Print this before you go out tonight"
 */
import EmergencyStrip from '../components/EmergencyStrip';
import React, { useState, useEffect, useRef } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Share, ActivityIndicator, Alert, RefreshControl} from 'react-native';
import { api } from '../services/api';
import { t }   from '../i18n';
import { COLORS, FONTS, RADIUS, SHADOW, useTheme} from '../constants/theme';
import { hapticImpact, hapticNotification, hapticSelection } from '../utils/webCompat';
import { getUserState, setUserState} from '../utils/userState';
import { detectAndSaveUserState } from '../services/location';
import * as secureStorage from '../utils/secureStorage';

declare var data: any;
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

type CardData = {
  state: string; title: string; subtitle: string;
  brandLine: string; rights: { heading: string; body: string }[];
  emergency: string[]; footer: string; generatedAt: string;
};

export default function RightsCardScreen({ navigation }: ScreenProps): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const [cardError, setCardError] = React.useState<string|null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await fetchCard(); } catch {}
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 800);
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [state, setState]       = useState('');
  const [card, setCard]         = useState<CardData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [sharing, setSharing]   = useState(false);
  const [isSubscriber, setIsSubscriber] = useState(false);
  const [showPicker, setShowPicker]     = useState(false);

  // Check subscription status
  useEffect(() => {
    secureStorage.getToken().then(async token => {
      if (!token) return;
      try {
        const res = await api.get('/billing/consumer/subscription');
        const sub = res.data?.subscription;
        if (sub && ['starter','pro','consumer_intel',
                    'starter_annual','pro_annual','consumer_intel_annual'].includes(sub.tier)) {
          setIsSubscriber(true);
        }
      } catch (e: any) { __DEV__ && console.warn(e?.message); }
    });

    // Load user's saved state preference -- set during onboarding or Settings
      getUserState().then(async saved => {
        // If no state saved yet, try to auto-detect from GPS silently
        let code = saved?.code || '';
        if (!code) {
          const detected = await detectAndSaveUserState().catch(() => null);
          code = detected || '';
        }
        setCard(buildFallbackCard(code));
        setState(code);
        fetchCard(code);
      }).catch(() => {
        setCard(buildFallbackCard(''));
        fetchCard('');
      });
  }, []);

  const fetchCard = async (st: string) => {
    // Do not show loading spinner -- static card already showing
    setState(st);
    try {
      const res = await api.get('/lessons/rights-card', { params: { state: st } });
      if (res.data?.rights?.length > 0) {
        setCard(res.data || null); // upgrade to API version only if richer
      }
    } catch {
      // Offline or API unavailable -- static card already displayed, no action needed
      if (!card) setCard(buildFallbackCard(st));
    }
  };

  // ── Full static rights card -- complete constitutional rights, no network needed ──
  // This renders immediately from the app bundle. fetchCard() overlays API content
  // when available but this is always the baseline -- jail lobby, no signal, no problem.
  const buildFallbackCard = (st: string): CardData => ({
    state: st,
    title: t('rc_title'),
    subtitle: t('rc_subtitle'),
    brandLine: t('rc_brand'),
    rights: [
      { heading: t('rc_h1'), body: t('rc_b1') },
      { heading: t('rc_h2'), body: t('rc_b2') },
      { heading: t('rc_h3'), body: t('rc_b3') },
      { heading: t('rc_h4'), body: t('rc_b4') },
      { heading: t('rc_h5'), body: t('rc_b5') },
      { heading: t('rc_h6'), body: t('rc_b6') },
      { heading: t('rc_h7'), body: t('rc_b7') },
      { heading: t('rc_h8'), body: t('rc_b8') },
    ],
    emergency: [t('rc_emergency_1'), t('rc_emergency_2')],
    footer: t('rc_footer'),
    generatedAt: new Date().toISOString().split('T')[0] });

  const shareCard = async () => {
    if (!card) return;
    setSharing(true);
    try {
      const shareText = buildShareText(card);
      await Share.share(
        {
          title: `Know Your Rights -- ${card.state}`,
          message: shareText },
        { dialogTitle: 'Share Your Rights Card' }
      );
    } catch (e: any) {
      if (e.message !== 'User did not share') {
        Alert.alert('Could not share', e.message);
      }
    } finally {
      setSharing(false);
    }
  };

  const buildShareText = (c: CardData): string => {
    const lines: string[] = [
      `📋 KNOW YOUR RIGHTS -- ${c.state}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      '',
      ...c.rights.map(r => `${r.heading}\n${r.body}`).join('\n\n').split('\n'),
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      ...c.emergency,
      '',
      c.brandLine,
      '',
      c.footer,
    ];
    return lines.join('\n');
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
    {cardError && (
      <View style={{margin:16,padding:14,backgroundColor:colors.surface,
        borderRadius:10,borderWidth:1,borderColor:colors.border}}>
        <Text style={{color:colors.danger,fontWeight:'700',fontSize:14}}>⚠ {cardError}</Text>
      </View>
    )}
      <EmergencyStrip compact={true} />

      {/* ── Not legal advice disclaimer ──────────────────────── */}
      <View style={styles.disclaimer}>
        <Text maxFontSizeMultiplier={1.3} style={styles.disclaimerText}>
          ⚖️ General legal information only -- not legal advice.
          Laws vary by jurisdiction and change over time.
          Always consult a licensed attorney for advice specific to your situation.
        </Text>
      </View>

      {/* Header */}
      <View style={styles.pageHeader}>
        <Text maxFontSizeMultiplier={1.4} style={styles.pageTitle}>{t('rc_page_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.pageSub}>
          Free wallet card for your state -- share before you go out tonight
        </Text>
      </View>

      {/* State picker */}
      <View style={styles.stateRow}>
        <Text maxFontSizeMultiplier={1.4} style={styles.stateLabel}>State:</Text>
        <TouchableOpacity
          style={styles.statePicker}
          onPress={() => setShowPicker(p => !p)}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={1.4} style={styles.statePickerText}>{state}  ▾</Text>
        </TouchableOpacity>
        {showPicker && (
          <View style={styles.stateDropdown}>
            <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
              {US_STATES.map(st => (
                <TouchableOpacity
                  accessibilityRole="button"
                  key={st}
                  style={[styles.stateDropdownRow, state === st && styles.stateDropdownRowActive]}
                  onPress={() => { setState(st); setUserState(st).catch(()=>{}); setShowPicker(false); fetchCard(st); }}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[styles.stateDropdownText, state === st && styles.stateDropdownTextActive]}>
                    {st}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Subscription gate -- preview for free users */}
      {!isSubscriber && (
        <View style={styles.gateBanner}>
          <Text maxFontSizeMultiplier={1.4} style={styles.gateBannerTitle}>{t('rc_gate_title')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.gateBannerBody}>
            Start a free 30-day trial to unlock your rights card, unlimited AI chat, full lawyer search, and more.
          </Text>
          <TouchableOpacity
            style={styles.gateBtn}
            onPress={() => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' })}
          accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.gateBtnText}>Start Free Trial →</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={styles.gatePreviewNote}>↓ Preview your rights card below</Text>
        </View>
      )}

      {/* The card itself */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.navy} size="large" />
      ) : card ? (
        <View style={[styles.card, !isSubscriber && styles.cardBlurred]}>

          {/* Card header */}
          <View style={styles.cardHeader}>
            <View style={styles.cardBrand}>
              <Text maxFontSizeMultiplier={1.4} style={styles.cardBrandText}>⚖️ JUSTICE GAVEL</Text>
            </View>
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: '800',
                  color: colors.gold, letterSpacing: 1.5, textAlign: 'center',
                  marginBottom: 6 }}>
                INNOCENT UNTIL PROVEN GUILTY
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.cardTitle}>{card.title}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.cardSubtitle}>{card.subtitle}</Text>
            <View style={styles.cardStateBadge}>
              <Text maxFontSizeMultiplier={1.4} style={styles.cardStateBadgeText}>STATE: {card.state}</Text>
            </View>
          </View>

          {/* Rights */}
          <View style={styles.cardBody}>
            {card.rights.map((right, i) => (
              <View key={i} style={styles.rightRow}>
                <View style={styles.rightNumberBadge}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rightNumberText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rightHeading}>{right.heading.replace(/^\d+\.\s*/, '')}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.rightBody}>{right.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Emergency footer */}
          <View style={styles.cardFooter}>
            {card.emergency.map((line, i) => (
              <Text maxFontSizeMultiplier={1.4} key={i} style={styles.emergencyLine}>{line}</Text>
            ))}
            <Text maxFontSizeMultiplier={1.4} style={styles.cardBrandLine}>{card.brandLine}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.cardLegalNote}>{card.footer}</Text>
          </View>

        </View>
      ) : null}

      {/* Blur overlay for non-subscribers */}
      {!isSubscriber && card && (
        <View style={styles.blurOverlay} pointerEvents="none">
          <Text maxFontSizeMultiplier={1.4} style={styles.blurOverlayText}>🔒 Subscribe to unlock full card + share</Text>
        </View>
      )}

      {/* Action buttons */}
      {card && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.shareBtn, (!isSubscriber || sharing) && styles.shareBtnDisabled]}
            onPress={isSubscriber ? shareCard : () => navigation.navigate('MoreTab', { screen: 'ConsumerSubscription' })}
          accessibilityRole="button"
            disabled={sharing}
            activeOpacity={0.85}
          >
            {sharing
              ? <ActivityIndicator color={colors.bgCard} />
              : <Text maxFontSizeMultiplier={1.4} style={styles.shareBtnText}>
                  {isSubscriber ? '📤  Share This Card' : '🔒  Subscribe to Share'}
                </Text>
            }
          </TouchableOpacity>

          {isSubscriber && (
            <TouchableOpacity style={styles.textShareBtn} onPress={shareCard}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.textShareBtnText}>Share as text (for SMS / iMessage)</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.stateChangeBtn}
            onPress={() => setShowPicker(p => !p)}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.stateChangeBtnText}>🗺  Change State</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Social share prompt */}
      <View style={styles.tiktokCard}>
        <Text maxFontSizeMultiplier={1.4} style={styles.tiktokTitle}>{t('rc_tiktok_title')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.tiktokBody}>
          "Print this before you go out tonight -- these are your rights if you get stopped."
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.tiktokBody}>
          Tag us @yourjusticegavel and we'll reshare. This card has helped thousands of people stay calm during a stop.
        </Text>
      </View>

      <View style={{ height: 40 }} />

      {/* Empty state */}
      {data?.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: colors?.textPrimary || colors.bg, textAlign: 'center' }}>No results found</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: colors?.textMuted || colors.steel, textAlign: 'center', lineHeight: 20 }}>Check your connection or try again.</Text>
        </View>
      )}
      </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 16 },

  pageHeader: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.xl,
    padding: 20, marginBottom: 16, ...SHADOW.md },
  pageTitle: { fontSize: 22, ...FONTS.black, color: COLORS.bgCard, marginBottom: 4 },
  pageSub:   { fontSize: 12, color: COLORS.steel, lineHeight: 18 },

  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, zIndex: 100 },
  stateLabel: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.navy },
  statePicker: {
    borderWidth: 1.5, borderColor: COLORS.navy, borderRadius: RADIUS.md,
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: COLORS.bgCard },
  statePickerText: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.navy },
  stateDropdown: {
    position: 'absolute', top: 44, left: 60, zIndex: 200,
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.lg,
    width: 100 },
  stateDropdownRow:       { paddingVertical: 10, paddingHorizontal: 16 },
  stateDropdownRowActive: { backgroundColor: COLORS.bg },
  stateDropdownText:      { fontSize: 14, lineHeight: 21, color: COLORS.textPrimary },
  stateDropdownTextActive:{ ...FONTS.heavy, color: COLORS.navy },

  gateBanner: {
    backgroundColor: '#FFA726', borderRadius: RADIUS.lg, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: '#F9A825' },
  gateBannerTitle: { fontSize: 15, lineHeight: 22, ...FONTS.heavy, color: COLORS.navy, marginBottom: 6 },
  gateBannerBody:  { fontSize: 12, color: COLORS.textSecond, lineHeight: 18, marginBottom: 12 },
  gateBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.md,
    paddingVertical: 11, alignItems: 'center', marginBottom: 8 },
  gateBtnText:      { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, ...FONTS.black },
  gatePreviewNote:  { fontSize: 11, color: COLORS.textMuted, textAlign: 'center' },

  // Card
  card: {
    borderRadius: RADIUS.xl, overflow: 'hidden',
    ...SHADOW.lg, marginBottom: 4 },
  cardBlurred: { opacity: 0.35 },

  cardHeader: {
    backgroundColor: COLORS.navy, padding: 16, alignItems: 'center' },
  cardBrand: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: RADIUS.pill,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  cardBrandText: { color: COLORS.bgCard, fontSize: 11, ...FONTS.black, letterSpacing: 1.5 },
  cardTitle:     { fontSize: 20, ...FONTS.black, color: COLORS.bgCard, textAlign: 'center', marginBottom: 4 },
  cardSubtitle:  { fontSize: 11, color: COLORS.steel, textAlign: 'center', marginBottom: 10 },
  cardStateBadge: {
    backgroundColor: COLORS.bail, borderRadius: RADIUS.pill,
    paddingHorizontal: 16, paddingVertical: 10 },
  cardStateBadgeText: { color: COLORS.bgCard, fontSize: 12, ...FONTS.black, letterSpacing: 1 },

  cardBody: { backgroundColor: COLORS.bgCard, padding: 14 },
  rightRow: {
    flexDirection: 'row', gap: 8, marginBottom: 12,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.bg },
  rightNumberBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center',
    marginTop: 1, flexShrink: 0 },
  rightNumberText: { color: COLORS.bgCard, fontSize: 11, ...FONTS.black },
  rightHeading:    { fontSize: 11, ...FONTS.black, color: COLORS.navy, marginBottom: 3, letterSpacing: 0.3 },
  rightBody:       { fontSize: 11, color: COLORS.textSecond, lineHeight: 16 },

  cardFooter: {
    backgroundColor: COLORS.bg, padding: 16 },
  emergencyLine:  { fontSize: 11, color: COLORS.steel, marginBottom: 3, ...FONTS.semi },
  cardBrandLine:  { fontSize: 11, color: COLORS.textMuted, marginTop: 8, textAlign: 'center' },
  cardLegalNote:  { fontSize: 11, color: colors.steel, marginTop: 4, textAlign: 'center', lineHeight: 13 },

  blurOverlay: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: 'rgba(255,255,255,0.0)',
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 20 },
  blurOverlayText: { fontSize: 12, lineHeight: 20, color: COLORS.navy, ...FONTS.heavy },

  actions: { marginBottom: 16, gap: 8 },
  shareBtn: {
    backgroundColor: COLORS.navy, borderRadius: RADIUS.lg,
    paddingVertical: 16, alignItems: 'center', ...SHADOW.md },
  shareBtnDisabled: { backgroundColor: COLORS.textMuted },
  shareBtnText:     { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, ...FONTS.black },
  textShareBtn:     { alignItems: 'center', paddingVertical: 10 },
  textShareBtnText: { fontSize: 12, lineHeight: 20, color: COLORS.steel, ...FONTS.semi },
  stateChangeBtn:   { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center' },
  stateChangeBtnText: { fontSize: 14, lineHeight: 21, color: COLORS.textSecond, ...FONTS.semi },

  tiktokCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADIUS.lg,
    padding: 16, marginBottom: 8, borderWidth: 1, borderColor: colors.bgCard },
  tiktokTitle: { fontSize: 14, lineHeight: 21, ...FONTS.heavy, color: COLORS.bgCard, marginBottom: 8 },
  tiktokBody:  { fontSize: 12, color: colors.steel, lineHeight: 17, marginBottom: 6 },

  disclaimer: {
    backgroundColor: COLORS.bgSubtle,
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warnDark,
  },
  disclaimerText: {
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
});
