import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
/**
 * IceDetentionScreen — ICE Detention Emergency Guide
 *
 * Target users:
 *   1. Person who was just detained by ICE
 *   2. Family member whose loved one was just detained
 *   3. DACA recipient arrested and needs to know immigration consequences
 *   4. Anyone who opened the door to ICE officers
 *
 * Design principles:
 *   - Works 100% OFFLINE — no API calls — always available
 *   - Bilingual English / Spanish toggle at the top
 *   - Panic-readable: big text, high contrast, action-first
 *   - Real phone numbers, real links (ACLU, NILC, RAICES, CLINIC)
 *   - Legally accurate: sourced from ACLU "Know Your Rights" (2024),
 *     National Immigration Law Center, Immigrant Legal Resource Center
 *   - All rights described apply under the 4th, 5th, 14th Amendments
 *     to ALL persons in the US regardless of immigration status
 */
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useTheme, COLORS, RADIUS, themeColors, type ThemeColors } from '../constants/theme';
import { hapticImpact, hapticSelection, RNShare, COPIED_ACTION } from '../utils/webCompat';
import { t, tl, useLang, type Lang } from '../i18n';
import { formatPhone, telUrl } from '../utils/contact';
import { SourceLine, UnreviewedNotice } from '../components/LegalSource';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';

// ── Content ────────────────────────────────────────────────────────────────────


// Text lives in src/i18n (iced_*). The screen shows the app language; the toggle
// switches this one page to English (or back) — e.g. to show it to someone else.
// Legal accuracy review (Oct 2026): the five call buttons here (RAICES, NILC, ACLU,
// ILRC, CLINIC) named numbers that could not be confirmed, and four of those groups
// are policy / training organisations that do not take calls from detained people.
// Only resources checked against the official EOIR pages remain:
//   EOIR Automated Case Information 1-800-898-7180 (justice.gov/eoir/contact-eoir)
//   EOIR List of Pro Bono Legal Service Providers (no phone; the list has the numbers)
const PHONES: (string | null)[] = ['1-800-898-7180', null];
const URLS = ['https://acis.eoir.justice.gov/en/', 'https://www.justice.gov/eoir/list-pro-bono-legal-service-providers'];
// The address ICE itself publishes for its Online Detainee Locator System
// (ICE ODLS brochure, ice.gov/doclib/news/library/factsheets/pdf/odls-brochure.pdf, checked 2026-10-20).
const LOCATOR_URL = 'https://www.ice.gov/locator';
const LOCATOR_SOURCE = 'ICE Online Detainee Locator System brochure (ice.gov)'; // i18n-exempt: the source's own title
const LOCATOR_CHECKED = '2026-10-20';
// The five rights cards, coloured from the active theme (read during render).
const RIGHTS = () => {
  const c = themeColors();
  return [
    { icon: ICONS.silent, color: c.emergency, bg: c.emergencyBg, bold: true },
    { icon: ICONS.lawyer, color: c.info, bg: c.infoBg, bold: false },
    { icon: ICONS.ban, color: c.textBrand, bg: c.bgSubtle, bold: false },
    { icon: ICONS.exit, color: c.warnDark, bg: c.warnBg, bold: false },
    { icon: ICONS.globe, color: c.legal, bg: c.legalBg, bold: false },
  ];
};
const ENDONYM: Record<Lang, string> = { en: 'English', es: 'Español', pt: 'Português', vi: 'Tiếng Việt' };

function content(lang: Lang) {
  const tx = (k: string) => tl(lang, k);
  return {
    title: tx('iced_title'),
    subtitle: tx('iced_subtitle'),
    rightsLabel: tx('iced_rights_label'),
    rights: RIGHTS().map((r, i) => ({ ...r, title: tx(`iced_r${i + 1}_title`), body: tx(`iced_r${i + 1}_body`) })),
    stepsTitle: tx('iced_steps_title'),
    steps: [1, 2, 3, 4, 5, 6].map(n => tx(`iced_step_${n}`)),
    locateTitle: tx('iced_locate_title'),
    locateDesc: tx('iced_locate_desc'),
    locateBtn: tx('iced_locate_btn'),
    locateUrl: LOCATOR_URL,
    legalTitle: tx('iced_legal_title'),
    resources: PHONES.map((phone, i) => ({ name: tx(`iced_res_${i + 1}_name`), desc: tx(`iced_res_${i + 1}_desc`), phone, url: URLS[i], highlight: i === 0 })),
    shareBtn: tx('iced_share_btn'),
    shareMsg: tx('iced_share_msg'),
    shareTitle: tx('iced_share_title'),
    webBtn: tx('iced_web_btn'),
    callA11y: (phone: string) => tl(lang, 'iced_call_a11y', { phone }),
    webA11y: tx('iced_web_a11y'),
    disclaimer: tx('iced_disclaimer'),
  };
}



// ── Component ──────────────────────────────────────────────────────────────────


function IceDetentionScreen(): React.JSX.Element {
  const { showToast } = useToast();
  const { colors } = useTheme();
  const appLang = useLang();
  // null = the app language; otherwise the language this page was switched to
  const [viewLang, setViewLang] = useState<Lang | null>(null);
  const lang: Lang = viewLang ?? appLang;
  const L = content(lang);
  const other: Lang = lang !== 'en' ? 'en' : (appLang !== 'en' ? appLang : 'es');
  const langBtn = ENDONYM[other];
  const s = makeStyles(colors);

  const toggleLang = useCallback(() => {
    hapticSelection();
    setViewLang(other === appLang ? null : other);
  }, [other, appLang]);

  const openLink = useCallback((url: string) => {
    hapticImpact();
    Linking.openURL(url).catch(() =>
      showToast(t('iced_open_url_failed'), 'warning')
    );
  }, [showToast]);

  const callNumber = useCallback((phone: string) => {
    const url = telUrl(phone);
    if (!url) return;
    hapticImpact();
    Linking.openURL(url).catch(() => showToast(t('cp_dial_manually', { num: formatPhone(phone) }), 'warning'));
  }, [showToast]);

  const shareInfo = useCallback(() => {
    hapticImpact();
    RNShare.share({ message: L.shareMsg, title: L.shareTitle })
      .then((r: { action?: string } | undefined) => { if (r?.action === COPIED_ACTION) showToast(t('cs2_copied'), 'success'); })
      .catch(() => showToast(t('action_failed'), 'error'));
  }, [L.shareMsg, L.shareTitle, showToast]);

  return (
    <ScrollView
      testID="ice-detention-screen"
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 48, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%'}}
      showsVerticalScrollIndicator={false}
    >
      {/* Language toggle */}
      <View style={s.langRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={s.langBtn} onPress={toggleLang} testID="ice-lang-toggle" accessibilityLabel={langBtn}>
          <IconLabel icon={ICONS.globe} textStyle={s.langBtnTxt} maxFontSizeMultiplier={1.4}>{langBtn}</IconLabel>
        </TouchableOpacity>
      </View>

      {/* Header */}
      <View style={s.header}>
        <AppIcon name={ICONS.alertHigh} size={44} color={colors.white} style={s.headerEmoji} />
        <Text style={s.headerTitle} maxFontSizeMultiplier={1.4}>{L.title}</Text>
        <Text style={s.headerSub} maxFontSizeMultiplier={1.4}>{L.subtitle}</Text>
      </View>

      <UnreviewedNotice lang={lang} text={tl(lang, 'iced_not_reviewed')} testID="ice-notice" />

      {/* Rights */}
      <Text style={[s.sectionLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{L.rightsLabel}</Text>
      {L.rights.map((r, i) => (
        <View key={`rights-${i}`} style={[s.rightCard, { backgroundColor: r.bg, borderColor: r.color }]}>
          <View style={s.rightTop}>
            <AppIcon name={r.icon} size={22} color={r.color} style={s.rightIcon} />
            <Text style={[s.rightTitle, { color: r.color }]} maxFontSizeMultiplier={1.4}>{r.title}</Text>
          </View>
          <Text style={[s.rightBody, r.bold && s.rightBodyBold, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>
            {r.body}
          </Text>
        </View>
      ))}

      <View style={{ paddingHorizontal: 16 }}>
        <SourceLine lang={lang} source={tl(lang, 'iced_rights_source')} testID="ice-rights-source" />
      </View>

      {/* Steps */}
      <Text style={[s.sectionLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{L.stepsTitle}</Text>
      {L.steps.map((step, i) => (
        <View key={`steps-${i}`} style={[s.stepRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={s.stepBubble}>
            <Text style={s.stepBubbleTxt} maxFontSizeMultiplier={1.4}>{i + 1}</Text>
          </View>
          <Text style={[s.stepTxt, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{step}</Text>
        </View>
      ))}

      {/* Detainee locator */}
      <Text style={[s.sectionLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{L.locateTitle}</Text>
      <View style={[s.locatorCard, { backgroundColor: colors.bgCard, borderColor: colors.legal }]}>
        <Text style={[s.locatorDesc, { color: colors.textSecond }]} maxFontSizeMultiplier={1.4}>{L.locateDesc}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
          style={s.locatorBtn}
          accessibilityLabel={L.locateBtn} onPress={() => openLink(L.locateUrl)}
          testID="ice-locator-btn"
        >
          <Text style={s.locatorBtnTxt} maxFontSizeMultiplier={1.4}>{L.locateBtn}</Text>
        </TouchableOpacity>
        <SourceLine lang={lang} source={LOCATOR_SOURCE} recorded={LOCATOR_CHECKED} verified={LOCATOR_CHECKED} testID="ice-locator-source" />
      </View>

      {/* Legal resources */}
      <Text style={[s.sectionLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{L.legalTitle}</Text>
      {L.resources.map((r, i) => (
        <View key={`resource-${i}`} style={[
          s.resourceCard,
          { backgroundColor: r.highlight ? colors.legalBg : colors.bgCard, borderColor: r.highlight ? colors.legal : colors.border },
        ]}>
          {r.highlight
            ? <IconLabel icon={ICONS.starFilled} iconColor={colors.goldText} textStyle={[s.resourceName, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{r.name}</IconLabel>
            : <Text style={[s.resourceName, { color: colors.textPrimary }]} maxFontSizeMultiplier={1.4}>{r.name}</Text>}
          <Text style={[s.resourceDesc, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>{r.desc}</Text>
          <View style={s.resourceBtns}>
            {r.phone ? (
            <TouchableOpacity
              accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              style={[s.callBtn, { backgroundColor: r.highlight ? colors.legal : COLORS.navy }]}
              accessibilityLabel={L.callA11y(r.phone)} onPress={() => callNumber(r.phone as string)}
              testID={`ice-call-${i}`}
            >
              <IconLabel icon={ICONS.phone} textStyle={s.callBtnTxt} maxFontSizeMultiplier={1.4}>{formatPhone(r.phone)}</IconLabel>
            </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
              style={[s.webBtn, { borderColor: colors.border }]}
              accessibilityLabel={L.webA11y} onPress={() => openLink(r.url)}
              testID={`ice-web-${i}`}
            >
              <Text style={[s.webBtnTxt, { color: colors.textSecond }]} maxFontSizeMultiplier={1.4}>{L.webBtn}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={{ paddingHorizontal: 16 }}>
        <SourceLine lang={lang} testID="ice-resources-source" />
      </View>

      {/* Share */}
      <TouchableOpacity
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={s.shareBtn} onPress={shareInfo} testID="ice-share-btn" accessibilityLabel={L.shareBtn}>
        <Text style={s.shareBtnTxt} maxFontSizeMultiplier={1.4}>{L.shareBtn}</Text>
      </TouchableOpacity>

      {/* Disclaimer */}
      <View style={[s.disclaimer, { backgroundColor: colors.warnBg, borderColor: colors.warn }]}>
        <Text style={[s.disclaimerTxt, { color: colors.textSecond }]} maxFontSizeMultiplier={1.4}>{L.disclaimer}</Text>
      </View>
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  screen:   { flex: 1 },

  langRow:    { flexDirection: 'row', justifyContent: 'flex-end', padding: 12, paddingBottom: 0 },
  langBtn:    { backgroundColor: COLORS.navy, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  langBtnTxt: { color: colors.textOnNavy, fontSize: 13, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  header:      { backgroundColor: colors.emergencyDark, padding: 24, paddingTop: 12, alignItems: 'center', gap: 6 },
  headerEmoji: { fontSize: 44 },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_900Black', fontWeight: '900', color: colors.bg, textAlign: 'center' },
  headerSub:   { fontSize: 13, color: colors.white, textAlign: 'center', lineHeight: 19 },

  sectionLabel: { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.5,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 8, paddingHorizontal: 16 },

  rightCard:      { marginHorizontal: 16, marginBottom: 10, borderRadius: RADIUS.lg, borderWidth: 2, padding: 14 },
  rightTop:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rightIcon:      { fontSize: 22 },
  rightTitle:     { fontSize: 13, fontFamily: 'Inter_900Black', fontWeight: '900', flex: 1, lineHeight: 19 },
  rightBody:      { fontSize: 13, lineHeight: 20 },
  rightBodyBold:  { fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 22 },

  stepRow:       { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginHorizontal: 16,
    marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12 },
  stepBubble:    { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.navy,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepBubbleTxt: { color: colors.textOnNavy, fontSize: 13, fontFamily: 'Inter_900Black', fontWeight: '900' },
  stepTxt:       { flex: 1, fontSize: 13, lineHeight: 20 },

  locatorCard: { marginHorizontal: 16, marginBottom: 10, borderRadius: RADIUS.lg, borderWidth: 2, padding: 16 },
  locatorDesc: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  locatorBtn:  { backgroundColor: colors.legal, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  locatorBtnTxt: { color: colors.textOnAccent, fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  resourceCard:  { marginHorizontal: 16, marginBottom: 10, borderRadius: RADIUS.lg, borderWidth: 1.5, padding: 14 },
  resourceName:  { fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 20, marginBottom: 3 },
  resourceDesc:  { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  resourceBtns:  { flexDirection: 'row', gap: 8 },
  callBtn:       { flex: 1, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  callBtnTxt:    { color: colors.bg, fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  webBtn:        { borderRadius: RADIUS.md, paddingVertical: 10, paddingHorizontal: 14,
    alignItems: 'center', borderWidth: 1 },
  webBtnTxt:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  shareBtn:    { marginHorizontal: 16, marginVertical: 16, backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center' },
  shareBtnTxt: { color: colors.textOnNavy, fontSize: 15, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  disclaimer:    { marginHorizontal: 16, borderRadius: RADIUS.md, borderWidth: 1, padding: 14 },
  disclaimerTxt: { fontSize: 11, lineHeight: 17 },
});
export default React.memo(IceDetentionScreen);
