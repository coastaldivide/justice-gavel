/**
 * CourtGuideScreen — "Going to court: how to dress and act" (docs/COURT_GUIDE.md).
 *
 * Eight short sections (constants/courtGuide.ts): what to wear, what not to bring, security and
 * finding your courtroom, inside the courtroom, what to say and not say, children and support
 * people, running late or can't come, after your hearing. Each shows the official pages it comes
 * from and the date we checked them. Works offline and signed out (the text is in the app).
 *
 * Opened for a court date (`courtDateId`, signed in) it also shows "This court's posted rules"
 * when the server knows the court's own published rules (backend data/court_rules.js), with the
 * link and the date checked — otherwise only the general guide.
 *
 * Entry points: the court date (checklist + plan), Just arrested step 3, the day-before reminder
 * push, "Your case, step by step".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { api } from '../services/api';
import { getToken } from '../utils/secureStorage';
import { makeStyles } from './CourtDatesScreen';
import { IconLabel, ICONS, type IconName } from '../components/AppIcon';
import { UnreviewedNotice, recordedDate } from '../components/LegalSource';
import GuideSourceList from '../components/GuideSourceList';
import { COURT_GUIDE, COVER_KEYS, guideItemKeys, type CourtRule, type GuideLink, type GuideSectionId } from '../constants/courtGuide';

const SECTION_ICONS: Record<GuideSectionId, IconName> = {
  wear: ICONS.shirt, bring: ICONS.ban, security: ICONS.shield, inside: ICONS.courthouse,
  say: ICONS.speak, children: ICONS.family, late: ICONS.clock, after: ICONS.checkOutline,
};

/** "This court's posted rules" (also used on the court date). */
export function CourtRulesBox({ rules, styles, testID = 'court-rules' }: { rules: CourtRule[]; styles: any; testID?: string }) {
  const { colors } = useTheme();
  useLang();
  if (!rules.length) return null;
  return (
    <View style={[styles.box, { borderColor: colors.legalDark }]} testID={testID}>
      <IconLabel icon={ICONS.courthouse} color={colors.textPrimary} textStyle={styles.boxTitle}>{t('cgd_court_rules_title')}</IconLabel>
      <Text maxFontSizeMultiplier={1.5} style={styles.boxText}>{t('cgd_court_rules_body')}</Text>
      {rules.map(r => (
        <View key={r.id} style={{ marginTop: 10 }} testID={`${testID}-${r.id}`}>
          <TouchableOpacity accessibilityRole="link" style={styles.secondaryBtn} onPress={() => Linking.openURL(r.url).catch(() => {})}>
            <IconLabel center icon={ICONS.external} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>
              {t('cgd_court_rules_open', { court: `${r.court} — ${r.title}` })}
            </IconLabel>
          </TouchableOpacity>
          {!!r.covers?.length && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.boxText, { marginTop: 6 }]}>
              {t('cgd_covers', { list: r.covers.map(c => (COVER_KEYS[c] ? t(COVER_KEYS[c]) : null)).filter(Boolean).join(' · ') })}
            </Text>
          )}
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('cgd_rules_checked', { date: recordedDate(r.checked) })}</Text>
        </View>
      ))}
    </View>
  );
}

function CourtGuideScreen({ navigation, route }: ScreenProps): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const courtDateId = Number((route?.params as { courtDateId?: number | string } | undefined)?.courtDateId);
  const hasCourtDate = Number.isSafeInteger(courtDateId) && courtDateId > 0;
  const [rules, setRules] = useState<CourtRule[] | null>(null);
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<GuideSectionId, number>>>({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!hasCourtDate) return;
    (async () => {
      if (!(await getToken().catch(() => null))) return;
      try {
        const r = await api.get<{ court_rules?: CourtRule[] }>(`/court-dates/${courtDateId}`);
        if (mounted.current) setRules(Array.isArray(r.data?.court_rules) ? r.data.court_rules : []);
      } catch { /* offline or gone: the general guide still shows */ }
    })();
  }, [hasCourtDate, courtDateId]);

  const go = useCallback((link: GuideLink) => {
    const nav = navigation as any;
    if (link === 'rights') nav.navigate('RightsCard');
    else if (link === 'missed') nav.navigate('CourtDates', { guidance: 'missed' });
    else nav.navigate('CourtDates', { add: true });
  }, [navigation]);
  const linkLabel = (l: GuideLink) => t(l === 'rights' ? 'cgd_open_rights' : l === 'missed' ? 'cgd_open_missed' : 'cgd_open_court_dates');
  const linkIcon = (l: GuideLink): IconName => (l === 'rights' ? ICONS.rights : l === 'missed' ? ICONS.help : ICONS.calendarAdd);

  return (
    <ScrollView ref={scroller} style={styles.screen} contentContainerStyle={styles.scroll} testID="court-guide-screen">
      <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">{t('cgd_title')}</Text>
      <Text maxFontSizeMultiplier={1.5} style={styles.muted}>{t('cgd_intro')}</Text>
      <UnreviewedNotice inset={false} text={t('cgd_label')} testID="court-guide-label" />

      {hasCourtDate && rules && (rules.length
        ? <CourtRulesBox rules={rules} styles={styles} />
        : <Text maxFontSizeMultiplier={1.4} style={styles.muted} testID="court-rules-none">{t('cgd_rules_none')}</Text>)}

      <View style={[styles.chipsWrap, { marginTop: 12 }]} accessibilityLabel={t('cgd_jump_a11y')} testID="court-guide-jump">
        {COURT_GUIDE.map(s => (
          <TouchableOpacity key={s.id} accessibilityRole="button" style={styles.chip} testID={`court-guide-jump-${s.id}`}
            onPress={() => scroller.current?.scrollTo({ y: Math.max(0, (offsets.current[s.id] ?? 0) - 8), animated: true })}>
            <Text maxFontSizeMultiplier={1.3} style={styles.chipText}>{t(`cgd_${s.id}_title`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {COURT_GUIDE.map(s => (
        <View key={s.id} style={styles.box} testID={`court-guide-${s.id}`}
          onLayout={(e) => { offsets.current[s.id] = e.nativeEvent.layout.y; }}>
          <IconLabel icon={SECTION_ICONS[s.id]} color={colors.textPrimary} textStyle={styles.boxTitle}>
            <Text accessibilityRole="header">{t(`cgd_${s.id}_title`)}</Text>
          </IconLabel>
          {guideItemKeys(s).map(k => (
            <View key={k} style={{ flexDirection: 'row', marginBottom: 8 }}>
              <Text maxFontSizeMultiplier={1.5} style={[styles.boxText, { marginEnd: 8 }]} importantForAccessibility="no">•</Text>
              <Text maxFontSizeMultiplier={1.5} style={[styles.boxText, { flex: 1 }]}>{t(k)}</Text>
            </View>
          ))}
          {!!s.noteKey && (
            <View style={[styles.offline, { backgroundColor: colors.infoBg, marginTop: 4 }]} testID={`court-guide-${s.id}-note`}>
              <IconLabel icon={ICONS.idea} color={colors.textPrimary} textStyle={styles.boxText}>{t(s.noteKey)}</IconLabel>
            </View>
          )}
          {(s.links || []).map(l => (
            <TouchableOpacity key={l} accessibilityRole="button" testID={`court-guide-link-${l}`} style={styles.secondaryBtn} onPress={() => go(l)}>
              <IconLabel center icon={linkIcon(l)} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{linkLabel(l)}</IconLabel>
            </TouchableOpacity>
          ))}
          <GuideSourceList ids={s.sources} styles={styles} testID={`court-guide-${s.id}-sources`} />
        </View>
      ))}

      {hasCourtDate && (
        <TouchableOpacity accessibilityRole="button" testID="court-guide-back-to-date" style={styles.primaryBtn}
          onPress={() => (navigation as any).navigate('CourtDateDetail', { id: courtDateId })}>
          <IconLabel center icon={ICONS.calendar} color={colors.white} textStyle={styles.primaryBtnText} maxFontSizeMultiplier={1.3}>{t('cgd_open_court_date')}</IconLabel>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

export default React.memo(CourtGuideScreen);
