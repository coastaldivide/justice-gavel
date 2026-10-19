/**
 * RightsCardScreen — "Know your rights" card for the person's state.
 *
 *  - Free, no account needed (core path step 1). The old subscription blur is
 *    gone: rights information is never behind a paywall.
 *  - Order of truth: the bundled general card (translated, always available,
 *    airplane mode included) → this phone's saved copy of the state's card →
 *    the server's sourced card (GET /api/rights/:state), saved for offline use.
 *  - Every section shows its source and "last reviewed" date; nothing claims a
 *    lawyer review until one is recorded. A state without sourced notes shows
 *    the general card plus "State-specific details not yet available for X".
 *  - State picked by GPS (once, with an explanation) or from the list.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import EmergencyStrip from '../components/EmergencyStrip';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t } from '../i18n';
import { RNShare } from '../utils/webCompat';
import { getUserState, setUserState, STATE_LIST, STATE_NAMES } from '../utils/userState';
import { detectAndSaveUserState } from '../services/location';
import {
  fetchRightsCard, getCachedRightsCard, reviewPendingNotice, type RightsCardData, type RightsSection,
} from '../services/corePath';

const GENERAL_SOURCES: Record<number, string> = {
  1: 'U.S. Constitution, 5th Amendment (as summarized in the Justice Gavel rights card)',
  2: 'U.S. Constitution, 6th Amendment (as summarized in the Justice Gavel rights card)',
  3: 'U.S. Constitution, 4th Amendment (as summarized in the Justice Gavel rights card)',
};
const CARD_SOURCE = 'Justice Gavel rights card — based on published state statutes and case law (as recorded April 2026)';
const BUNDLED_REVIEWED = '2026-04';
const SAY_KEYS = ['rs_say_1', 'rs_say_2', 'rs_say_3', 'rs_say_4', 'rs_say_5'];

/** The bundled general card in the app's language (works with no network). */
export function bundledGeneral(): RightsSection[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({
    key: `rc_${i}`, heading: t(`rc_h${i}`), body: t(`rc_b${i}`),
    source: GENERAL_SOURCES[i] || CARD_SOURCE, last_reviewed: BUNDLED_REVIEWED, lawyer_reviewed: false,
  }));
}

function monthLabel(d: string | null): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(d);
  if (!m) return d;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 15))).toLocaleDateString('en-US',
    m[3] ? { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function RightsCardScreen({ route }: ScreenProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [stateCode, setStateCode] = useState('');
  const [card, setCard] = useState<RightsCardData | null>(null);
  const [source, setSource] = useState<'bundled' | 'device' | 'live'>('bundled');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const english = t('rc_title') === 'Know Your Rights';

  const load = useCallback(async (code: string) => {
    setStateCode(code);
    const cached = await getCachedRightsCard(code || 'US');
    if (!mounted.current) return;
    if (cached) { setCard(cached.card); setSource('device'); setSavedAt(cached.at); }
    else { setCard(null); setSource('bundled'); setSavedAt(null); }
    try {
      const fresh = await fetchRightsCard(code || 'US');
      if (mounted.current) { setCard(fresh); setSource('live'); setSavedAt(null); }
    } catch { /* offline — bundled / saved copy stays on screen */ }
  }, []);

  useEffect(() => {
    (async () => {
      const fromRoute = (route?.params as { state?: string } | undefined)?.state;
      const saved = await getUserState();
      const code = fromRoute || saved?.code || '';
      await load(code);
      if (!code) {
        const detected = await detectAndSaveUserState({
          prompt: true,
          reason: 'Your rights and court rules depend on your state. Justice Gavel uses your location once to pick your state — you can also choose it from the list.',
        }).catch(() => null);
        if (detected && mounted.current) load(detected);
      }
    })();
  }, [load, route?.params]);

  const onRefresh = async () => { setRefreshing(true); await load(stateCode); if (mounted.current) setRefreshing(false); };

  const choose = async (code: string) => {
    setPicker(false);
    await setUserState(code);
    load(code);
  };

  // General sections: translated bundled text, with the server's source / review
  // metadata (and any reviewed database replacement) when we have it.
  const general: RightsSection[] = bundledGeneral().map(b => {
    const s = card?.general.find(x => x.key === b.key);
    if (!s) return b;
    // A database row (recorded source) that changes the text wins in English; in
    // other languages only a lawyer-reviewed replacement overrides the translation.
    const replaced = english ? (s.body !== b.body || s.heading !== b.heading) : s.lawyer_reviewed;
    return { ...b, ...(replaced ? { heading: s.heading, body: s.body } : {}), source: s.source, source_url: s.source_url, last_reviewed: s.last_reviewed, lawyer_reviewed: s.lawyer_reviewed, reviewed_by: s.reviewed_by };
  });
  const specific = card?.state_specific || [];
  const stateName = stateCode ? (STATE_NAMES[stateCode] || card?.state_name || stateCode) : '';
  const notice = !stateCode ? t('ja_choose_state')
    : card ? card.state_notice
      : reviewPendingNotice(stateName);

  const share = async () => {
    const lines = [
      `${t('rc_title')}${stateName ? ` — ${stateName}` : ''}`, '',
      ...SAY_KEYS.map(k => `“${t(k)}”`), '',
      ...general.map(s => `${s.heading}\n${s.body}\n(${t('rc_source')}: ${s.source})`),
      ...specific.map(s => `${s.heading}\n${s.body}\n(${t('rc_source')}: ${s.source})`),
      '', t('rc_footer'), 'https://justicegavel.app/rights',
    ];
    try { await RNShare.share({ title: t('rc_title'), message: lines.join('\n\n') }); }
    catch (e: any) { if (e?.message && e.message !== 'User did not share') showToast('Sharing is not available on this device.', 'error'); }
  };

  const Section = ({ s, testID }: { s: RightsSection; testID: string }) => (
    <View style={styles.section} testID={testID}>
      <Text maxFontSizeMultiplier={1.5} style={styles.sectionHeading}>{s.heading.replace(/^\d+\.\s*/, '')}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.sectionBody}>{s.body}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.sourceText} testID="rights-source">
        {t('rc_source')}: {s.source || '—'}
        {s.last_reviewed ? ` · ${t('rc_last_reviewed')}: ${monthLabel(s.last_reviewed)}` : ''}
        {s.lawyer_reviewed ? ` · Reviewed by ${s.reviewed_by}` : ` · ${t('rc_lawyer_pending')}`}
      </Text>
      {!!s.source_url && (
        <TouchableOpacity accessibilityRole="link" accessibilityLabel={`Open source for ${s.heading}`} onPress={() => Linking.openURL(String(s.source_url)).catch(() => {})}>
          <Text maxFontSizeMultiplier={1.4} style={styles.link}>{String(s.source_url)}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll} testID="rights-card-screen"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <EmergencyStrip compact />
      <Text maxFontSizeMultiplier={1.4} style={styles.title} accessibilityRole="header">{t('rc_page_title')}</Text>
      <TouchableOpacity accessibilityRole="button" testID="rights-state-picker" style={styles.stateBtn}
        accessibilityLabel={`${t('ja_state')}: ${stateName || t('ja_choose_state')}. Change`} onPress={() => setPicker(true)}>
        <Text maxFontSizeMultiplier={1.4} style={styles.stateBtnText}>📍 {stateName || t('ja_choose_state')}  ▾</Text>
      </TouchableOpacity>

      {source === 'device' && (
        <Text maxFontSizeMultiplier={1.4} style={styles.offline} testID="rights-offline">
          📴 {t('rc_offline_copy')}{savedAt ? ` (${monthLabel(savedAt.slice(0, 10))})` : ''}
        </Text>
      )}
      {!!notice && <Text maxFontSizeMultiplier={1.4} style={styles.notice} testID="rights-state-notice">ℹ️ {notice}</Text>}

      <View style={styles.scriptBox} testID="rights-script">
        <Text maxFontSizeMultiplier={1.2} style={styles.scriptLabel}>🗣 {t('ja_say')}</Text>
        {SAY_KEYS.map(k => <Text key={k} maxFontSizeMultiplier={1.6} style={styles.scriptLine}>“{t(k)}”</Text>)}
      </View>

      {specific.length > 0 && (
        <View testID="rights-state-sections">
          <Text maxFontSizeMultiplier={1.4} style={styles.groupTitle}>{t('rc_state_section')}: {stateName}</Text>
          {!english && <Text maxFontSizeMultiplier={1.4} style={styles.muted}>{t('rc_english_only')}</Text>}
          {specific.map(s => <Section key={s.key} s={s} testID="rights-state-section" />)}
        </View>
      )}

      <Text maxFontSizeMultiplier={1.4} style={styles.groupTitle}>{t('rc_subtitle')}</Text>
      {general.map(s => <Section key={s.key} s={s} testID="rights-section" />)}

      <TouchableOpacity accessibilityRole="button" testID="rights-share" style={styles.primaryBtn} onPress={share}>
        <Text maxFontSizeMultiplier={1.4} style={styles.primaryBtnText}>📤 Share this card</Text>
      </TouchableOpacity>
      <Text maxFontSizeMultiplier={1.4} style={styles.disclaimer}>⚖️ {t('rc_footer')}</Text>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)} accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>{t('ja_choose_state')}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {STATE_LIST.map(s => (
                <TouchableOpacity key={s.code} accessibilityRole="button" testID={`rights-state-${s.code}`}
                  style={[styles.stateRow, s.code === stateCode && styles.stateRowActive]} onPress={() => choose(s.code)}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.stateRowText}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setPicker(false)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { color: c.textPrimary, fontSize: 24, fontWeight: '900', marginTop: 8, marginBottom: 8 },
  stateBtn: { backgroundColor: c.bgCard, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, minHeight: 44, marginBottom: 10 },
  stateBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '700' },
  offline: { color: c.warnDark, backgroundColor: c.warnBg, borderRadius: 10, padding: 10, fontSize: 13, marginBottom: 8 },
  notice: { color: c.textPrimary, backgroundColor: c.infoBg, borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 8 },
  scriptBox: { backgroundColor: c.bgCard, borderRadius: 16, padding: 16, borderLeftWidth: 6, borderLeftColor: c.legalDark, marginVertical: 8 },
  scriptLabel: { color: c.textSecond, fontSize: 13, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  scriptLine: { color: c.textPrimary, fontSize: 22, lineHeight: 30, fontWeight: '800', marginBottom: 6 },
  groupTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  muted: { color: c.textMuted, fontSize: 13, marginBottom: 6 },
  section: { backgroundColor: c.bgCard, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
  sectionHeading: { color: c.textPrimary, fontSize: 16, fontWeight: '900', marginBottom: 6 },
  sectionBody: { color: c.textSecond, fontSize: 16, lineHeight: 23 },
  sourceText: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  link: { color: c.textBrand, fontSize: 12, textDecorationLine: 'underline', marginTop: 4 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center', minHeight: 52, marginTop: 12 },
  primaryBtnText: { color: c.white, fontSize: 17, fontWeight: '900' },
  secondaryBtn: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, paddingVertical: 14, alignItems: 'center', minHeight: 48, marginTop: 8 },
  secondaryBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
  disclaimer: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12, fontStyle: 'italic' },
  overlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetTitle: { color: c.textPrimary, fontSize: 20, fontWeight: '900', marginBottom: 8 },
  stateRow: { paddingVertical: 12, paddingHorizontal: 8, minHeight: 44, borderBottomWidth: 1, borderBottomColor: c.border },
  stateRowActive: { backgroundColor: c.infoBg },
  stateRowText: { color: c.textPrimary, fontSize: 16 },
});

export default React.memo(RightsCardScreen);
