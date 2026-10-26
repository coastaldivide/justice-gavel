/**
 * JustArrestedScreen — the "Just arrested?" core path, one step at a time:
 *
 *   1) Know your rights      — the 30-second "say / do not" script for the
 *                               person's state (big text), from the sourced
 *                               rights card; works offline and signed out.
 *   2) Find a lawyer AND a bail agent — opens the combined results (Help Now).
 *   3) Never miss a court date — signed in: add the date (reminders 7d/3d/1d/
 *                               morning-of, phone calendar); guest: a clear
 *                               "sign in to save it" prompt.
 *
 * Progress ("Step 2 of 3") is saved on the device and restored, so an
 * interrupted person comes back to the same step. 911 / 988 and "alert family"
 * stay on every step. Nothing here is new legal content: the script comes from
 * services/corePath (server: services/rightsContent.js) with its source.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ScreenProps } from '../types/navigation';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { getUserState, setUserState, localizedStateList, stateName as localStateName } from '../utils/userState';
import { getToken } from '../utils/secureStorage';
import { hapticImpact, RNShare, COPIED_ACTION } from '../utils/webCompat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAppAuth } from '../services/auth';
import { IllustrationRights } from '../components/Illustrations';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
import { Analytics } from '../services/analytics';
import {
  getCoreProgress, saveCoreProgress, setPendingRoute, fetchRightsCard, getCachedRightsCard, prefetchRights, reviewedLabel,
  type CoreStep, type RightsCardData,
} from '../services/corePath';

// Bundled script (same lines and keys as the server's SCRIPT) so step 1 works
// with no network on first open.
const SAY_KEYS = ['rs_say_1', 'rs_say_2', 'rs_say_3', 'rs_say_4', 'rs_say_5'];
const DONT_KEYS = ['rs_dont_1', 'rs_dont_2', 'rs_dont_3', 'rs_dont_4', 'rs_dont_5'];
const BUNDLED_LAST_REVIEWED = '2026-04';

/** Haptic tap; a device without haptics (or a test) must never break a step. */
function buzz() {
  try { Promise.resolve(hapticImpact()).catch(() => {}); } catch { /* no haptics here */ }
}

function JustArrestedScreen({ navigation }: ScreenProps): React.JSX.Element {
  const lang = useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [step, setStep] = useState<CoreStep>(1);
  const [done, setDone] = useState({ rights: false, help: false, court: false });
  const [stateCode, setStateCode] = useState<string>('');
  const [picker, setPicker] = useState(false);
  const [card, setCard] = useState<RightsCardData | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  const inMainApp = !!navigation.getParent?.()?.getState?.()?.routeNames?.includes('MoreTab');

  const loadCard = useCallback(async (code: string) => {
    const cached = await getCachedRightsCard(code || 'US');
    if (cached && mounted.current) setCard(cached.card);
    try {
      const fresh = await fetchRightsCard(code || 'US');
      if (mounted.current) setCard(fresh);
    } catch { /* offline: bundled script / cached copy stays */ }
  }, []);

  useEffect(() => { Analytics.track('core_started', { from_guest: !inMainApp }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A language switch: show this language's saved copy / fetch it.
  const firstLang = useRef(true);
  useEffect(() => {
    if (firstLang.current) { firstLang.current = false; return; }
    setCard(null); loadCard(stateCode);
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      const p = await getCoreProgress();
      if (!mounted.current) return;
      setStep(p.current); setDone(p.done);
      const st = await getUserState();
      const code = st?.code || '';
      if (mounted.current) setStateCode(code);
      loadCard(code);
      prefetchRights(code).catch(() => {});
      const tok = await getToken().catch(() => null);
      if (mounted.current) setSignedIn(!!tok);
    })();
  }, [loadCard]);

  const goStep = (n: CoreStep) => {
    buzz();
    setStep(n);
    saveCoreProgress({ current: n }).catch(() => {});
  };

  /** Open a MoreTab screen — from the guest stack, enter browse mode first and open it there. */
  const openScreen = async (screen: string, params?: Record<string, unknown>) => {
    buzz();
    if (!inMainApp) {
      await setPendingRoute(screen, params);
      await AsyncStorage.setItem('has_browsed', 'true').catch(() => {});
      setAppAuth('browsing');
      return;
    }
    (navigation as any).navigate('MoreTab', { screen, params });
  };

  const pickState = async (code: string) => {
    setPicker(false);
    setStateCode(code);
    await setUserState(code);
    loadCard(code);
  };

  const finishStep = async (mark: 'rights' | 'help' | 'court', next?: CoreStep) => {
    const p = await saveCoreProgress({ mark, current: next ?? step });
    if (mounted.current) { setDone(p.done); if (next) setStep(next); }
  };

  const call = (num: string) => {
    buzz();
    Linking.openURL(`tel:${num}`).catch(() => showToast(t('cp_dial_manually', { num }), 'warning'));
  };

  const alertFamily = async () => {
    Analytics.track('family_shared', { channel: Platform.OS === 'web' ? 'share' : 'app' });
    const msg = t('ja_alert_msg', { url: 'https://justicegavel.app/just-arrested' });
    const enc = encodeURIComponent(msg);
    if (Platform.OS === 'web') {
      // A browser can't open the WhatsApp app: the share sheet, else a copy to paste.
      const r = await RNShare.share({ message: msg, title: t('ja_alert_title') }).catch(() => null);
      if (r?.action === COPIED_ACTION) showToast(t('es_copied'), 'info');
      else if (r?.action !== 'sharedAction') showToast(t('cp_share_unavailable'), 'warning');
      return;
    }
    Linking.openURL(`whatsapp://send?text=${enc}`)
      .catch(() => Linking.openURL(`https://wa.me/?text=${enc}`))
      .catch(() => RNShare.share({ message: msg, title: t('ja_alert_title') }).catch(() => {}));
  };

  const script = card?.script;
  const sayLines = SAY_KEYS.map(k => t(k));
  const dontLines = DONT_KEYS.map(k => t(k));
  // The server's script source only when it is in the app's language.
  const scriptSource = script?.source && (card?.language || 'en') === lang ? script.source : t('rc_script_source');
  const scriptReviewed = script ? script.last_reviewed : BUNDLED_LAST_REVIEWED;
  const stateName = stateCode ? localStateName(stateCode) : '';
  const states = localizedStateList();
  const stepTitles = [t('ja_s1'), t('ja_s2'), t('ja_s3')];

  return (
    <View style={styles.screen} testID="just-arrested-screen">
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerTitle} accessibilityRole="header">{t('ja_title')}</Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.stepOf} testID="core-step-label">{t('ja_step_of', { n: step })}</Text>
        <View style={styles.stepRow} accessibilityRole="tablist">
          {([1, 2, 3] as CoreStep[]).map(n => {
            const isDone = n === 1 ? done.rights : n === 2 ? done.help : done.court;
            const active = n === step;
            return (
              <TouchableOpacity
                key={n}
                testID={`core-step-${n}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${t('ja_step_a11y', { n, title: stepTitles[n - 1] })}${isDone ? t('ja_done_a11y') : ''}`}
                style={[styles.stepPill, active && styles.stepPillActive]}
                onPress={() => goStep(n)}
              >
                <Text maxFontSizeMultiplier={1.2} style={[styles.stepPillText, active && styles.stepPillTextActive]}>
                  {isDone ? '✓ ' : `${n}. `}{stepTitles[n - 1]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} testID="core-step-body">
        {step === 1 && (
          <View testID="core-step-rights">
            <View style={{ alignItems: 'center' }}><IllustrationRights width={90} height={81} /></View>
            <Text maxFontSizeMultiplier={1.3} style={styles.stepTitle}>1. {t('ja_s1')}</Text>
            <TouchableOpacity accessibilityRole="button" testID="core-state-button" style={styles.stateBtn}
              accessibilityLabel={t('ja_state_a11y', { state: stateName || t('ja_choose_state') })} onPress={() => setPicker(true)}>
              <View style={styles.stateBtnRow}>
                <IconLabel icon={ICONS.location} color={colors.textPrimary} textStyle={styles.stateBtnText} maxFontSizeMultiplier={1.3} style={{ flex: 1 }}>
                  {t('ja_state')}: {stateName || t('ja_choose_state')}
                </IconLabel>
                <AppIcon name={ICONS.chevronDown} size={18} color={colors.textSecond} />
              </View>
            </TouchableOpacity>

            <View style={styles.sayBox} testID="core-script">
              <IconLabel icon={ICONS.speak} color={colors.textSecond} textStyle={styles.sayLabel} maxFontSizeMultiplier={1.2} style={styles.boxLabelRow}>{t('ja_say')}</IconLabel>
              {sayLines.map((l, i) => (
                <Text key={SAY_KEYS[i]} maxFontSizeMultiplier={1.6} style={styles.sayLine}>“{l}”</Text>
              ))}
            </View>
            <View style={styles.dontBox}>
              <IconLabel icon={ICONS.rights} color={colors.textSecond} textStyle={styles.dontLabel} maxFontSizeMultiplier={1.2} style={styles.boxLabelRow}>{t('ja_dont')}</IconLabel>
              {dontLines.map((l, i) => (
                <Text key={DONT_KEYS[i]} maxFontSizeMultiplier={1.6} style={styles.dontLine}>• {l}</Text>
              ))}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.sourceLine} testID="core-script-source">
              {t('rc_source')}: {scriptSource}{scriptReviewed ? ` · ${t('rc_last_reviewed')}: ${reviewedLabel(scriptReviewed)}` : ''} · {t('rc_lawyer_pending')}
            </Text>
            {!!card?.state_notice && stateCode && (card.language || 'en') === lang && (
              <View style={styles.notice}>
                <IconLabel icon={ICONS.alertNormal} color={colors.textPrimary} textStyle={styles.noticeText} testID="core-state-notice">{card.state_notice}</IconLabel>
              </View>
            )}

            <TouchableOpacity accessibilityRole="button" testID="core-open-rights-card" style={styles.secondaryBtn}
              onPress={() => { finishStep('rights'); openScreen('RightsCard'); }}>
              <IconLabel center icon={ICONS.clipboard} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('ja_full_card')}</IconLabel>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" testID="core-next-1" style={styles.primaryBtn}
              onPress={() => finishStep('rights', 2)}>
              <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('ja_next')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 2 && (
          <View testID="core-step-help">
            <Text maxFontSizeMultiplier={1.3} style={styles.stepTitle}>2. {t('ja_s2')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('ja_step2_body')}</Text>
            <TouchableOpacity accessibilityRole="button" testID="core-find-help" style={styles.primaryBtn}
              onPress={() => { finishStep('help'); openScreen('HelpNow'); }}>
              <IconLabel center icon={ICONS.lawyer} color={colors.white} textStyle={styles.primaryBtnText} maxFontSizeMultiplier={1.3}>{t('ja_find_help')}</IconLabel>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" testID="core-share-family" style={styles.secondaryBtn}
              onPress={() => openScreen('EmergencyShare')}>
              <IconLabel center icon={ICONS.family} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('ja_share_family')}</IconLabel>
            </TouchableOpacity>
            <View style={styles.navRow}>
              <TouchableOpacity accessibilityRole="button" style={styles.navBtn} onPress={() => goStep(1)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.navBtnText}>{t('ja_back')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" testID="core-next-2" style={[styles.navBtn, styles.navBtnPrimary]}
                onPress={() => finishStep('help', 3)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.navBtnPrimaryText}>{t('ja_next')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {step === 3 && (
          <View testID="core-step-court">
            <Text maxFontSizeMultiplier={1.3} style={styles.stepTitle}>3. {t('ja_s3')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.body}>{t('ja_step3_body')}</Text>
            {signedIn ? (
              <TouchableOpacity accessibilityRole="button" testID="core-add-court-date" style={styles.primaryBtn}
                onPress={() => { finishStep('court'); openScreen('CourtDates', { add: true }); }}>
                <IconLabel center icon={ICONS.calendar} color={colors.white} textStyle={styles.primaryBtnText} maxFontSizeMultiplier={1.3}>{t('ja_add_court')}</IconLabel>
              </TouchableOpacity>
            ) : (
              <View style={styles.signInBox} testID="core-court-sign-in">
                <IconLabel icon={ICONS.lock} color={colors.textPrimary} textStyle={styles.signInText}>{t('ja_court_signin')}</IconLabel>
                <TouchableOpacity accessibilityRole="button" testID="core-sign-up" style={styles.primaryBtn} onPress={() => openScreen('Register')}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{t('ja_create')}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" testID="core-sign-in" style={styles.secondaryBtn} onPress={() => openScreen('Login')}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('ja_sign_in')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {signedIn && (
              <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => openScreen('CourtDates')}>
                <IconLabel center icon={ICONS.calendar} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('ja_my_court_dates')}</IconLabel>
              </TouchableOpacity>
            )}
            <TouchableOpacity accessibilityRole="button" testID="core-missed" style={styles.secondaryBtn}
              onPress={() => openScreen('CourtDates', { guidance: 'missed' })}>
              <IconLabel center icon={ICONS.help} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('ja_missed')}</IconLabel>
            </TouchableOpacity>
            <View style={styles.navRow}>
              <TouchableOpacity accessibilityRole="button" style={styles.navBtn} onPress={() => goStep(2)}>
                <Text maxFontSizeMultiplier={1.3} style={styles.navBtnText}>{t('ja_back')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Always there: emergency numbers and the family alert */}
        <View style={styles.emergencyRow}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('cp_call_911_a11y')} style={styles.btn911} onPress={() => call('911')}>
            <IconLabel center icon={ICONS.phoneFilled} color={colors.emergency} textStyle={styles.emergencyText} maxFontSizeMultiplier={1.2}>{t('cp_call_911')}</IconLabel>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('cp_call_988_a11y')} style={styles.btn988} onPress={() => call('988')}>
            <IconLabel center icon={ICONS.crisis} color={colors.info} textStyle={styles.emergencyText} maxFontSizeMultiplier={1.2}>{t('cp_crisis_988')}</IconLabel>
          </TouchableOpacity>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('ja_alert_family_a11y')} style={styles.familyBtn} onPress={alertFamily}>
          <IconLabel center icon={ICONS.message} color={colors.white} textStyle={styles.familyBtnText} maxFontSizeMultiplier={1.3}>{t('ja_alert_family')}</IconLabel>
        </TouchableOpacity>
        <IconLabel icon={ICONS.alertNormal} color={colors.textMuted} textStyle={styles.disclaimer} size={14} style={styles.disclaimerRow}>
          {t('ja_disclaimer')}
        </IconLabel>
      </ScrollView>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)} accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.sheet} testID="core-state-picker">
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>{t('ja_choose_state')}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {states.map(s => (
                <TouchableOpacity key={s.code} accessibilityRole="button" testID={`core-state-${s.code}`}
                  style={[styles.stateRow, s.code === stateCode && styles.stateRowActive]} onPress={() => pickState(s.code)}>
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
    </View>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  header: { backgroundColor: c.emergencyDark, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { color: c.white, fontSize: 28, fontWeight: '900' },
  stepOf: { color: c.white, fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  stepRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  stepPill: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center', backgroundColor: c.navy },
  stepPillActive: { backgroundColor: c.bgCard },
  stepPillText: { color: c.white, fontSize: 13, fontWeight: '700' },
  stepPillTextActive: { color: c.textPrimary },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  stepTitle: { color: c.textPrimary, fontSize: 24, fontWeight: '900', marginBottom: 8 },
  body: { color: c.textSecond, fontSize: 17, lineHeight: 25, marginBottom: 12 },
  stateBtn: { backgroundColor: c.bgCard, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, minHeight: 44, marginBottom: 12 },
  stateBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stateBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '700' },
  boxLabelRow: { marginBottom: 8 },
  sayBox: { backgroundColor: c.bgCard, borderRadius: 16, padding: 16, borderLeftWidth: 6, borderLeftColor: c.legalDark, marginBottom: 12 },
  sayLabel: { color: c.textSecond, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  sayLine: { color: c.textPrimary, fontSize: 24, lineHeight: 32, fontWeight: '800', marginBottom: 8 },
  dontBox: { backgroundColor: c.bgCard, borderRadius: 16, padding: 16, borderLeftWidth: 6, borderLeftColor: c.emergencyDark, marginBottom: 8 },
  dontLabel: { color: c.textSecond, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  dontLine: { color: c.textPrimary, fontSize: 19, lineHeight: 27, fontWeight: '700', marginBottom: 4 },
  sourceLine: { color: c.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  notice: { backgroundColor: c.infoBg, borderRadius: 10, padding: 10, marginBottom: 8 },
  noticeText: { color: c.textPrimary, fontSize: 14, lineHeight: 20 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', minHeight: 52, marginTop: 8 },
  primaryBtnText: { color: c.white, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  secondaryBtn: { backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', minHeight: 48, marginTop: 8 },
  secondaryBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  navBtn: { flex: 1, backgroundColor: c.bgCard, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingVertical: 14, alignItems: 'center', minHeight: 48 },
  navBtnText: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
  navBtnPrimary: { backgroundColor: c.navy, borderColor: c.navy },
  navBtnPrimaryText: { color: c.white, fontSize: 16, fontWeight: '900' },
  signInBox: { backgroundColor: c.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.border },
  signInText: { color: c.textPrimary, fontSize: 17, lineHeight: 24, fontWeight: '600' },
  emergencyRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn911: { flex: 1, backgroundColor: c.emergencyBg, borderColor: c.emergency, borderWidth: 1.5, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 8, justifyContent: 'center', minHeight: 52 },
  btn988: { flex: 1, backgroundColor: c.infoBg, borderColor: c.info, borderWidth: 1.5, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 8, justifyContent: 'center', minHeight: 52 },
  emergencyText: { fontWeight: '800', fontSize: 15 },
  familyBtn: { backgroundColor: c.legalDark, borderRadius: 14, paddingVertical: 14, alignItems: 'center', minHeight: 48 },
  familyBtnText: { color: c.white, fontWeight: '800', fontSize: 15 },
  disclaimerRow: { marginTop: 12, alignItems: 'flex-start' },
  disclaimer: { color: c.textMuted, fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  overlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetTitle: { color: c.textPrimary, fontSize: 20, fontWeight: '900', marginBottom: 8 },
  stateRow: { paddingVertical: 12, paddingHorizontal: 8, minHeight: 44, borderBottomWidth: 1, borderBottomColor: c.border },
  stateRowActive: { backgroundColor: c.infoBg },
  stateRowText: { color: c.textPrimary, fontSize: 16 },
});

export default React.memo(JustArrestedScreen);
