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
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang, getLang } from '../i18n';
import { RNShare, COPIED_ACTION } from '../utils/webCompat';
import { getUserState, setUserState, localizedStateList, stateName as localStateName } from '../utils/userState';
import { detectAndSaveUserState } from '../services/location';
import { Analytics } from '../services/analytics';
import {
  fetchRightsCard, getCachedRightsCard, reviewPendingNotice, reviewedLabel as monthLabel, type RightsCardData, type RightsSection,
} from '../services/corePath';

const BUNDLED_REVIEWED = '2026-04';
const SAY_KEYS = ['rs_say_1', 'rs_say_2', 'rs_say_3', 'rs_say_4', 'rs_say_5'];

/** The bundled general card in the app's language (works with no network). Same text and sources as the server's. */
export function bundledGeneral(): RightsSection[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({
    key: `rc_${i}`, heading: t(`rc_h${i}`), body: t(`rc_b${i}`),
    source: i <= 3 ? t(`rc_src_${i}`) : t('rc_src_card'), last_reviewed: BUNDLED_REVIEWED, lawyer_reviewed: false,
    language: getLang(),
  }));
}

function RightsCardScreen({ route }: ScreenProps): React.JSX.Element {
  const lang = useLang();
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
    Analytics.track('rights_viewed', { state: code || 'US' });
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
          reason: t('rc_location_reason'),
        }).catch(() => null);
        if (detected && mounted.current) load(detected);
      }
    })();
  }, [load, route?.params]);

  // Language switched while open: show that language's saved copy, then the live card.
  const firstLang = useRef(true);
  useEffect(() => {
    if (firstLang.current) { firstLang.current = false; return; }
    load(stateCode);
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => { setRefreshing(true); await load(stateCode); if (mounted.current) setRefreshing(false); };

  const choose = async (code: string) => {
    setPicker(false);
    await setUserState(code);
    load(code);
  };

  // General sections: the bundled text in the app's language, with the server's
  // source / review metadata — and any database replacement — when we have it.
  // The server answers in our language (card.language); a section in another
  // language (a lawyer-reviewed English replacement) wins only when reviewed.
  const cardInLang = !!card && (card.language || 'en') === lang;
  const general: RightsSection[] = bundledGeneral().map(b => {
    const s = card?.general.find(x => x.key === b.key);
    if (!s) return b;
    const sameLang = (s.language || card?.language || 'en') === lang;
    const replaced = sameLang ? (s.body !== b.body || s.heading !== b.heading) : s.lawyer_reviewed;
    return {
      ...b,
      ...(replaced ? { heading: s.heading, body: s.body, language: s.language || 'en' } : {}),
      source: replaced || sameLang ? s.source : b.source, source_url: s.source_url,
      last_reviewed: s.last_reviewed, lawyer_reviewed: s.lawyer_reviewed, reviewed_by: s.reviewed_by,
    };
  });
  const specific = card?.state_specific || [];
  const specificOtherLang = specific.some(s => (s.language || card?.language || 'en') !== lang);
  const stateName = stateCode ? localStateName(stateCode, card?.state_name_local || card?.state_name) : '';
  const notice = !stateCode ? t('ja_choose_state')
    : cardInLang ? card?.state_notice ?? null
      : specific.length ? null : reviewPendingNotice(stateName);
  const states = localizedStateList();

  const share = async () => {
    const lines = [
      `${t('rc_title')}${stateName ? ` — ${stateName}` : ''}`, '',
      ...SAY_KEYS.map(k => `“${t(k)}”`), '',
      ...general.map(s => `${s.heading}\n${s.body}\n(${t('rc_source')}: ${s.source})`),
      ...specific.map(s => `${s.heading}\n${s.body}\n(${t('rc_source')}: ${s.source})`),
      '', t('rc_footer'), 'https://justicegavel.app/rights',
    ];
    try {
      const r = await RNShare.share({ title: t('rc_title'), message: lines.join('\n\n') });
      if (r?.action === COPIED_ACTION) showToast(t('rc_copied'), 'success');
    }
    catch (e: any) { if (e?.message && e.message !== 'User did not share') showToast(t('cp_share_unavailable'), 'error'); }
  };

  const Section = ({ s, testID }: { s: RightsSection; testID: string }) => (
    <View style={styles.section} testID={testID}>
      <Text maxFontSizeMultiplier={1.5} style={styles.sectionHeading}>{s.heading.replace(/^\d+\.\s*/, '')}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.sectionBody}>{s.body}</Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.sourceText} testID="rights-source">
        {t('rc_source')}: {s.source || '—'}
        {s.last_reviewed ? ` · ${t('rc_last_reviewed')}: ${monthLabel(s.last_reviewed)}` : ''}
        {s.lawyer_reviewed ? ` · ${t('rc_reviewed_by', { name: String(s.reviewed_by) })}` : ` · ${t('rc_lawyer_pending')}`}
      </Text>
      {!!s.source_url && (
        <TouchableOpacity accessibilityRole="link" accessibilityLabel={t('rc_open_source_a11y', { heading: s.heading })} onPress={() => Linking.openURL(String(s.source_url)).catch(() => {})}>
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
        accessibilityLabel={t('ja_state_a11y', { state: stateName || t('ja_choose_state') })} onPress={() => setPicker(true)}>
        <View style={styles.stateBtnRow}>
          <IconLabel icon={ICONS.location} color={colors.textPrimary} textStyle={styles.stateBtnText} style={{ flex: 1 }}>{stateName || t('ja_choose_state')}</IconLabel>
          <AppIcon name={ICONS.chevronDown} size={18} color={colors.textSecond} />
        </View>
      </TouchableOpacity>

      {/* The words first: the script sits right under the state picker. */}
      <View style={styles.scriptBox} testID="rights-script">
        <IconLabel icon={ICONS.speak} color={colors.textSecond} textStyle={styles.scriptLabel} maxFontSizeMultiplier={1.2} style={styles.scriptLabelRow}>{t('ja_say')}</IconLabel>
        {SAY_KEYS.map(k => <Text key={k} maxFontSizeMultiplier={1.6} style={styles.scriptLine}>“{t(k)}”</Text>)}
      </View>

      {/* Status notes as small footnotes below the words: still visible, never in front of them. */}
      {!!notice && (
        <View style={styles.footnote}>
          <IconLabel icon={ICONS.alertNormal} color={colors.textSecond} textStyle={styles.footnoteText} size={15} style={styles.footnoteRow} testID="rights-state-notice">{notice}</IconLabel>
        </View>
      )}
      {source === 'device' && (
        <View style={[styles.footnote, { borderLeftColor: colors.warnDark }]}>
          <IconLabel icon={ICONS.offline} color={colors.warnDark} textStyle={styles.footnoteText} size={15} style={styles.footnoteRow} testID="rights-offline">
            {t('rc_offline_copy')}{savedAt ? ` (${monthLabel(savedAt.slice(0, 10))})` : ''}
          </IconLabel>
        </View>
      )}

      {specific.length > 0 && (
        <View testID="rights-state-sections">
          <Text maxFontSizeMultiplier={1.4} style={styles.groupTitle}>{t('rc_state_section')}: {stateName}</Text>
          {specificOtherLang && <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="rights-english-only">{t('rc_english_only')}</Text>}
          {specific.map(s => <Section key={s.key} s={s} testID="rights-state-section" />)}
        </View>
      )}

      <Text maxFontSizeMultiplier={1.4} style={styles.groupTitle}>{t('rc_subtitle')}</Text>
      {general.map(s => <Section key={s.key} s={s} testID="rights-section" />)}

      <TouchableOpacity accessibilityRole="button" testID="rights-share" style={styles.primaryBtn} onPress={share}>
        <IconLabel center icon={ICONS.share} color={colors.white} textStyle={styles.primaryBtnText}>{t('rc_share_card')}</IconLabel>
      </TouchableOpacity>
      <IconLabel icon={ICONS.alertNormal} color={colors.textMuted} textStyle={styles.disclaimer} size={14} style={styles.disclaimerRow}>{t('rc_footer')}</IconLabel>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)} accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>{t('ja_choose_state')}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {states.map(s => (
                <TouchableOpacity key={s.code} accessibilityRole="button" testID={`rights-state-${s.code}`}
                  style={[styles.stateRow, s.code === stateCode && styles.stateRowActive]} onPress={() => choose(s.code)}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.stateRowText}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setPicker(false)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('close')}</Text>
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
  stateBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stateBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '700' },
  footnote: { borderLeftWidth: 3, borderLeftColor: c.info, paddingLeft: 10, paddingVertical: 2, marginBottom: 8 },
  footnoteRow: { alignItems: 'flex-start' },
  footnoteText: { color: c.textSecond, fontSize: 13, lineHeight: 19 },
  scriptBox: { backgroundColor: c.bgCard, borderRadius: 16, padding: 16, borderLeftWidth: 6, borderLeftColor: c.legalDark, marginTop: 2, marginBottom: 10 },
  scriptLabelRow: { marginBottom: 6 },
  scriptLabel: { color: c.textSecond, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
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
  disclaimerRow: { marginTop: 12, alignItems: 'flex-start' },
  disclaimer: { color: c.textMuted, fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  overlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetTitle: { color: c.textPrimary, fontSize: 20, fontWeight: '900', marginBottom: 8 },
  stateRow: { paddingVertical: 12, paddingHorizontal: 8, minHeight: 44, borderBottomWidth: 1, borderBottomColor: c.border },
  stateRowActive: { backgroundColor: c.infoBg },
  stateRowText: { color: c.textPrimary, fontSize: 16 },
});

export default React.memo(RightsCardScreen);
