import { apiErrorMessage } from '../services/api';
import { useToast } from '../components/ToastProvider';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';
/**
 * TermsAcceptanceModal
 *
 * Clickwrap ToS acceptance modal — shown on first login and whenever the ToS
 * version is updated. Replaces the passive "by continuing you agree" text.
 *
 * LEGAL REQUIREMENTS MET:
 *   ✓ Affirmative action required (cannot be dismissed without accepting)
 *   ✓ User must have seen the whole summary before "I Agree" activates —
 *     either by scrolling to the end or, when the summary fits on screen
 *     (desktop web, tablets), because it is already fully visible. Requiring
 *     a scroll event that can never fire locked desktop users out (audit11 H10).
 *   ✓ Two separate checkboxes — ToS agreement AND specific "not legal advice" acknowledgment
 *   ✓ Timestamped, versioned, platform-logged acceptance sent to backend
 *   ✓ Shown again automatically when ToS version changes
 *   ✓ Cannot proceed into the app without accepting
 *
 * USAGE:
 *   Called from the root navigator on every app launch.
 *   GET /api/auth/tos-status → { needs_acceptance: true } → show this modal
 *   GET /api/auth/disclaimer/status → { required: true } (or any 451) → show it too
 *   On accept → POST /api/auth/accept-tos, then POST /api/auth/disclaimer/accept
 *   (the second checkbox IS the AI/not-legal-advice disclaimer) → dismiss.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform, Linking, LayoutAnimation} from 'react-native';
import { useTheme, TYPE, FONT } from '../constants/theme';
import api from '../services/api';
import { t, perLang, useLang } from '../i18n';

const TOS_VERSION = '2.1';  // Must match CURRENT_TOS_VERSION in auth.js

/** Distance from the end (px) that still counts as "read to the bottom". */
const BOTTOM_SLACK = 30;

/** True when the whole summary is visible without scrolling. */
export function contentFitsViewport(contentHeight: number, viewportHeight: number): boolean {
  return contentHeight <= viewportHeight + BOTTOM_SLACK;
}

// ─── Summary sections shown in the modal ─────────────────────────────────────
// The full ToS is accessible via the "Read full Terms" link.
// This summary hits the legally critical points in plain language.
const SUMMARY_POINTS = perLang(() => [
  {
    icon: '⚖️',
    title: t('x_terms_acceptance_modal_not_law_firm'),
    body: t('x_terms_acceptance_modal_justice_gavel_legal_information'),
  },
  {
    icon: '🤖',
    title: t('x_terms_acceptance_modal_ai_may_be_wrong'),
    body: t('x_terms_acceptance_modal_our_ai_assistant_can'),
  },
  {
    icon: '📅',
    title: t('x_terms_acceptance_modal_deadlines_advisory'),
    body: t('x_terms_acceptance_modal_deadline_alerts_deadline_calculation'),
  },
  {
    icon: '🔒',
    title: t('x_terms_acceptance_modal_data_secure'),
    body: t('x_terms_acceptance_modal_case_notes_aes_256'),
  },
  {
    icon: '📱',
    title: t('x_terms_acceptance_modal_recording_laws_vary'),
    body: t('x_terms_acceptance_modal_encounter_recorder_feature_legal'),
  },
]);

type Props = {
  visible: boolean;
  onAccepted: () => void;
  onDecline?: () => void;
};

function TermsAcceptanceModal({ visible, onAccepted, onDecline }: Props) {
  useLang();
  const { showToast } = useToast();
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const { colors } = useTheme();
  const s = styles(colors, TYPE, FONT);

  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [viewportH,        setViewportH]         = useState(0);
  const [contentH,         setContentH]          = useState(0);
  const [checkToS,         setCheckToS]         = useState(false);
  const [checkNoAdvice,    setCheckNoAdvice]     = useState(false);
  const [submitting,       setSubmitting]        = useState(false);
  const [error,            setError]             = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const canAccept = scrolledToBottom && checkToS && checkNoAdvice;

  const handleScroll = useCallback(({ nativeEvent }: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const atBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - BOTTOM_SLACK;
    if (atBottom && !scrolledToBottom) setScrolledToBottom(true);
  }, [scrolledToBottom]);

  // When everything fits in the viewport there is nothing to scroll and no
  // scroll event will ever fire — the user has already seen it all.
  React.useEffect(() => {
    if (!scrolledToBottom && viewportH > 0 && contentH > 0 && contentFitsViewport(contentH, viewportH)) {
      setScrolledToBottom(true);
    }
  }, [viewportH, contentH, scrolledToBottom]);

  const handleAccept = useCallback(async () => {
    if (!canAccept || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
          await api.post('/auth/accept-tos', {
        tos_version:       TOS_VERSION,
        scroll_completed:  true,
        checkbox_tos:      checkToS,
        checkbox_no_advice: checkNoAdvice,
        platform:          Platform.OS,
        device_id:         null, // privacy-preserving — not sending device ID
      });
      // The "not a law firm / not legal advice" checkbox is the AI disclaimer:
      // record it too, or every AI feature answers 451 disclaimer_required.
      await api.post('/auth/disclaimer/accept', {});
      onAccepted();
    } catch (e: any) {
      setError(apiErrorMessage(e, t('x_terms_acceptance_modal_could_not_record_acceptance')));
    } finally {
      setSubmitting(false);
    }
  }, [canAccept, submitting, checkToS, checkNoAdvice, onAccepted]);

  return (
    <Modal
      testID="terms-acceptance-modal"
      accessibilityViewIsModal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {/* cannot dismiss without accepting */}}>
      <View style={s.container}>

        {/* Header */}
        <View style={s.header}>
          <Text maxFontSizeMultiplier={1.4} style={s.headerTitle}>{t('x_legal_disclaimer_before_continue')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.headerSub}>
            {t('x_terms_acceptance_modal_please_read_agree_our')}
          </Text>
        </View>

        {/* Scrollable content — must scroll to bottom to unlock "I Agree" */}
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          onScroll={handleScroll}
          onLayout={e => setViewportH(e.nativeEvent.layout.height)}
          onContentSizeChange={(_w, h) => setContentH(h)}
          scrollEventThrottle={100}
          testID="tos-scroll"
          showsVerticalScrollIndicator={true}>

          {/* Key points in plain language */}
          <Text maxFontSizeMultiplier={1.4} style={s.sectionLabel}>{t('x_terms_acceptance_modal_what_need_know')}</Text>
          
          {SUMMARY_POINTS().length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>{t('x_court_forms_no_results_yet')}</Text>
            </View>
          )}
{SUMMARY_POINTS().map((pt, i) => (
            <View key={`point-${i}`} style={s.point}>
              <Text maxFontSizeMultiplier={1.4} style={s.pointIcon}>{pt.icon}</Text>
              <View style={s.pointBody}>
                <Text maxFontSizeMultiplier={1.4} style={s.pointTitle}>{pt.title}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.pointText}>{pt.body}</Text>
              </View>
            </View>
          ))}

          {/* Link to full ToS */}
          <TouchableOpacity
            accessibilityRole="link"
            style={s.fullTosLink}
            onPress={() => Linking.openURL('https://justicegavel.app/terms').catch(() => showToast(t('action_failed'), 'error'))}
            accessibilityLabel={t('x_terms_acceptance_modal_read_full_terms_service')}
          >
            <Text maxFontSizeMultiplier={1.4} style={s.fullTosLinkText}>{t('x_terms_acceptance_modal_read_full_terms_service_2')}</Text>
          </TouchableOpacity>

          {/* Scroll indicator */}
          {!scrolledToBottom && (
            <View style={s.scrollHint}>
              <Text maxFontSizeMultiplier={1.4} style={s.scrollHintText}>{t('x_terms_acceptance_modal_scroll_continue')}</Text>
            </View>
          )}

          {/* Spacer to ensure bottom is reachable */}
          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Checkboxes + Accept button */}
        <View style={s.footer}>

          {/* Checkbox 1: ToS agreement */}
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}

            style={s.checkRow}
            testID="tos-check-terms"
            onPress={() => setCheckToS(v => !v)}
            accessibilityState={{ checked: checkToS }}
            accessibilityLabel={t('x_terms_acceptance_modal_i_have_read_agree')}>
            <View style={[s.checkbox, checkToS && s.checkboxChecked]}>
              {checkToS && <Text maxFontSizeMultiplier={1.4} style={s.checkmark}>✓</Text>}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.checkLabel}>
              {t('x_terms_acceptance_modal_i_have_read_agree_2')}{' '}
              <Text maxFontSizeMultiplier={1.4} style={s.link}
                onPress={() => Linking.openURL('https://justicegavel.app/terms').catch(() => showToast(t('action_failed'), 'error'))}>
                {t('onb_terms_tos')}
              </Text>
            </Text>
          </TouchableOpacity>

          {/* Checkbox 2: The critical disclaimer — standalone affirmative act */}
          <TouchableOpacity
            accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}

            style={s.checkRow}
            testID="tos-check-no-advice"
            onPress={() => setCheckNoAdvice(v => !v)}
            accessibilityState={{ checked: checkNoAdvice }}
            accessibilityLabel={t('x_terms_acceptance_modal_i_understand_justice_gavel')}>
            <View style={[s.checkbox, checkNoAdvice && s.checkboxChecked]}>
              {checkNoAdvice && <Text maxFontSizeMultiplier={1.4} style={s.checkmark}>✓</Text>}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.checkLabel}>
              {t('x_terms_acceptance_modal_i_understand_that')}{' '}
              <Text maxFontSizeMultiplier={1.4} style={s.bold}>{t('x_terms_acceptance_modal_justice_gavel_not_law')}</Text>
              {' '}{t('x_terms_acceptance_modal_nothing_this_platform_legal')}
            </Text>
          </TouchableOpacity>

          {/* Scroll prompt when not yet at bottom */}
          {!scrolledToBottom && (
            <Text maxFontSizeMultiplier={1.4} style={s.scrollToUnlock}>
              {t('x_terms_acceptance_modal_scroll_through_summary_above')}
            </Text>
          )}

          {/* Error */}
          {error && (
            <Text maxFontSizeMultiplier={1.4} style={s.errorText}>{error}</Text>
          )}

          {/* Accept button */}
          <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
            style={[s.acceptBtn, (!canAccept || submitting) && s.acceptBtnDisabled]}
            onPress={handleAccept}
            testID="tos-accept-button"
            disabled={!canAccept || submitting}
            accessibilityLabel={t('x_terms_acceptance_modal_i_agree_accept_terms')}
            accessibilityState={{ disabled: !canAccept || submitting }}>
            {submitting
              ? <ActivityIndicator color={colors.white} />
              : <Text maxFontSizeMultiplier={1.4} style={s.acceptBtnText}>{t('x_terms_acceptance_modal_i_agree_continue_justice')}</Text>
            }
          </TouchableOpacity>

          <Text maxFontSizeMultiplier={1.4} style={s.versionNote}>{t('x_terms_acceptance_modal_terms_service_v_effective', { TOS_VERSION })}</Text>
          {onDecline && (
            <TouchableOpacity accessibilityRole="button" testID="tos-decline-button"
              accessibilityLabel={t('x_terms_acceptance_modal_decline_sign_out')} onPress={onDecline}
              style={s.declineBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text maxFontSizeMultiplier={1.4} style={s.declineText}>{t('x_terms_acceptance_modal_decline_sign_out')}</Text>
            </TouchableOpacity>
          )}
        </View>

      </View>
    </Modal>
  );
}

const styles = (colors: any, TYPE: Record<string, number>, FONT: Record<string, string>) => StyleSheet.create({
  container:          { flex: 1, backgroundColor: colors.bg, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%',},
  header:             { paddingTop: 20, paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:        { fontSize: 22, fontFamily: FONT.bold, color: colors.textPrimary, marginBottom: 6 },
  headerSub:          { fontSize: 13, color: colors.textSecond, lineHeight: 18 },
  scroll:             { flex: 1 },
  scrollContent:      { paddingHorizontal: 20, paddingTop: 16 },
  sectionLabel:       { fontSize: 12, fontFamily: FONT.bold, color: colors.goldText, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  point:              { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
  pointIcon:          { fontSize: 22, marginRight: 12, marginTop: 2 },
  pointBody:          { flex: 1 },
  pointTitle:         { fontSize: 14, fontFamily: FONT.bold, color: colors.textPrimary, marginBottom: 3 },
  pointText:          { fontSize: 13, color: colors.textSecond, lineHeight: 19 },
  fullTosLink:        { marginTop: 8, marginBottom: 16, alignItems: 'center', padding: 12, borderWidth: 1, borderColor: colors.gold, borderRadius: 8 },
  fullTosLinkText:    { fontSize: 13, color: colors.goldText, fontFamily: FONT.bold },
  scrollHint:         { alignItems: 'center', paddingVertical: 8 },
  scrollHintText:     { fontSize: 12, color: colors.textSecond, opacity: 0.7 },
  footer:             { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  checkRow:           { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  checkbox:           { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: colors.textSecond, alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0 },
  checkboxChecked:    { backgroundColor: colors.gold, borderColor: colors.gold },
  checkmark:          { color: colors.textOnGold, fontSize: 13, fontFamily: FONT.bold }, // design-audit-ignore: rendered only when checked (gold fill)
  checkLabel:         { flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 19 },
  link:               { color: colors.goldText, textDecorationLine: 'underline' },
  bold:               { fontFamily: FONT.bold },
  scrollToUnlock:     { fontSize: 12, color: colors.textSecond, textAlign: 'center', marginBottom: 10 },
  errorText:          { fontSize: 12, color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  acceptBtn:          { backgroundColor: colors.gold, borderRadius: 10, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  acceptBtnDisabled:  { opacity: 0.4 },
  acceptBtnText:      { color: colors.textOnGold, fontSize: 15, fontFamily: FONT.bold },
  versionNote:        { fontSize: 10, color: colors.textSecond, textAlign: 'center', opacity: 0.7 },
  declineBtn:         { alignSelf: 'center', marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  declineText:        { fontSize: 12, color: colors.textSecond, textDecorationLine: 'underline' },
});
export default React.memo(TermsAcceptanceModal);
