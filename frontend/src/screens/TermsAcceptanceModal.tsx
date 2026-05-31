import { HapticButton } from '../components/HapticButton';
import { AppIcon } from '../components/AppIcon';
/**
 * TermsAcceptanceModal
 *
 * Clickwrap ToS acceptance modal — shown on first login and whenever the ToS
 * version is updated. Replaces the passive "by continuing you agree" text.
 *
 * LEGAL REQUIREMENTS MET:
 *   ✓ Affirmative action required (cannot be dismissed without accepting)
 *   ✓ User must scroll to bottom before "I Agree" activates
 *   ✓ Two separate checkboxes — ToS agreement AND specific "not legal advice" acknowledgment
 *   ✓ Timestamped, versioned, platform-logged acceptance sent to backend
 *   ✓ Shown again automatically when ToS version changes
 *   ✓ Cannot proceed into the app without accepting
 *
 * USAGE:
 *   Called from the root navigator on every app launch.
 *   GET /api/auth/tos-status → { needs_acceptance: true } → show this modal
 *   On accept → POST /api/auth/accept-tos → dismiss and continue
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { useTheme } from '../constants/theme';
import api from '../services/api';

const TOS_VERSION = '2.1';  // Must match CURRENT_TOS_VERSION in auth.js

// ─── Summary sections shown in the modal ─────────────────────────────────────
// The full ToS is accessible via the "Read full Terms" link.
// This summary hits the legally critical points in plain language.
const SUMMARY_POINTS = [
  {
    icon: '⚖️',
    title: 'Not a Law Firm',
    body: 'Justice Gavel is a legal information platform, not a law firm. We do not provide legal advice and no attorney-client relationship is created by using this app.',
  },
  {
    icon: '🤖',
    title: 'AI May Be Wrong',
    body: 'Our AI assistant can make mistakes, hallucinate statutes, and misstate the law. Always verify information with a licensed attorney before acting on it.',
  },
  {
    icon: '📅',
    title: 'Deadlines Are Advisory',
    body: 'Deadline alerts, deadline calculations, and signal intelligence are informational only. Court rules vary. Verify every deadline with your attorney.',
  },
  {
    icon: '🔒',
    title: 'Your Data Is Secure',
    body: 'Case notes are AES-256 encrypted. We never sell your data. You can export or delete your data at any time from Settings.',
  },
  {
    icon: '📱',
    title: 'Recording Laws Vary',
    body: 'The Encounter Recorder feature is legal in some states and not others. You are responsible for complying with recording laws in your jurisdiction.',
  },
];

type Props = {
  visible: boolean;
  onAccepted: () => void;
  onDecline?: () => void;
};

export default function TermsAcceptanceModal({ visible, onAccepted }: Props) {
  const { colors } = useTheme();
  const s = styles(colors, TYPE, FONT);

  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [checkToS,         setCheckToS]         = useState(false);
  const [checkNoAdvice,    setCheckNoAdvice]     = useState(false);
  const [submitting,       setSubmitting]        = useState(false);
  const [error,            setError]             = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const canAccept = scrolledToBottom && checkToS && checkNoAdvice;

  const handleScroll = useCallback(({ nativeEvent }: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const atBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 30;
    if (atBottom && !scrolledToBottom) setScrolledToBottom(true);
  }, [scrolledToBottom]);

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
      onAccepted();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not record acceptance. Please try again.');
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
          <Text maxFontSizeMultiplier={1.4} style={s.headerTitle}>Before You Continue</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.headerSub}>
            Please read and agree to our Terms of Service.{'\n'}
            You only need to do this once.
          </Text>
        </View>

        {/* Scrollable content — must scroll to bottom to unlock "I Agree" */}
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          showsVerticalScrollIndicator={true}>

          {/* Key points in plain language */}
          <Text maxFontSizeMultiplier={1.4} style={s.sectionLabel}>What You Need to Know</Text>
          {SUMMARY_POINTS.map((pt, i) => (
            <View key={i} style={s.point}>
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
            onPress={() => Linking.openURL('https://justicegavel.app/terms').catch(() => {})}
            accessibilityLabel="Read the full Terms of Service"
          >
            <Text maxFontSizeMultiplier={1.4} style={s.fullTosLinkText}>📄 Read the full Terms of Service →</Text>
          </TouchableOpacity>

          {/* Scroll indicator */}
          {!scrolledToBottom && (
            <View style={s.scrollHint}>
              <Text maxFontSizeMultiplier={1.4} style={s.scrollHintText}>↓ Scroll to continue ↓</Text>
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

            style={s.checkRow}
            onPress={() => setCheckToS(v => !v)}
            accessibilityState={{ checked: checkToS }}
            accessibilityLabel="I have read and agree to the Terms of Service">
            <View style={[s.checkbox, checkToS && s.checkboxChecked]}>
              {checkToS && <Text maxFontSizeMultiplier={1.4} style={s.checkmark}>✓</Text>}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.checkLabel}>
              I have read and agree to the{' '}
              <Text maxFontSizeMultiplier={1.4} style={s.link}
                onPress={() => Linking.openURL('https://justicegavel.app/terms').catch(() => {})}>
                Terms of Service
              </Text>
            </Text>
          </TouchableOpacity>

          {/* Checkbox 2: The critical disclaimer — standalone affirmative act */}
          <TouchableOpacity
            accessibilityRole="button"

            style={s.checkRow}
            onPress={() => setCheckNoAdvice(v => !v)}
            accessibilityState={{ checked: checkNoAdvice }}
            accessibilityLabel="I understand Justice Gavel is not a law firm and does not provide legal advice">
            <View style={[s.checkbox, checkNoAdvice && s.checkboxChecked]}>
              {checkNoAdvice && <Text maxFontSizeMultiplier={1.4} style={s.checkmark}>✓</Text>}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.checkLabel}>
              I understand that{' '}
              <Text maxFontSizeMultiplier={1.4} style={s.bold}>Justice Gavel is not a law firm</Text>
              {' '}and nothing on this platform is legal advice. I will consult a licensed attorney for advice specific to my situation.
            </Text>
          </TouchableOpacity>

          {/* Scroll prompt when not yet at bottom */}
          {!scrolledToBottom && (
            <Text maxFontSizeMultiplier={1.4} style={s.scrollToUnlock}>
              Scroll through the summary above to unlock "I Agree"
            </Text>
          )}

          {/* Error */}
          {error && (
            <Text maxFontSizeMultiplier={1.4} style={s.errorText}>{error}</Text>
          )}

          {/* Accept button */}
          <TouchableOpacity accessibilityRole="button"
            style={[s.acceptBtn, (!canAccept || submitting) && s.acceptBtnDisabled]}
            onPress={handleAccept}
            disabled={!canAccept || submitting}
            accessibilityLabel="I Agree — accept Terms of Service"
            accessibilityState={{ disabled: !canAccept || submitting }}>
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text maxFontSizeMultiplier={1.4} style={s.acceptBtnText}>I Agree — Continue to Justice Gavel</Text>
            }
          </TouchableOpacity>

          <Text maxFontSizeMultiplier={1.4} style={s.versionNote}>Terms of Service v{TOS_VERSION} · Effective May 1, 2026</Text>
        </View>

      </View>
    </Modal>
  );
}

const styles = (colors: any, TYPE: any, FONT: any) => StyleSheet.create({
  container:          { flex: 1, backgroundColor: colors.background },
  header:             { paddingTop: 20, paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:        { fontSize: 22, fontFamily: FONT.bold, color: colors.text, marginBottom: 6 },
  headerSub:          { fontSize: 13, color: colors.subtext, lineHeight: 18 },
  scroll:             { flex: 1 },
  scrollContent:      { paddingHorizontal: 20, paddingTop: 16 },
  sectionLabel:       { fontSize: 12, fontFamily: FONT.bold, color: colors.gold, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  point:              { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
  pointIcon:          { fontSize: 22, marginRight: 12, marginTop: 2 },
  pointBody:          { flex: 1 },
  pointTitle:         { fontSize: 14, fontFamily: FONT.bold, color: colors.text, marginBottom: 3 },
  pointText:          { fontSize: 13, color: colors.subtext, lineHeight: 19 },
  fullTosLink:        { marginTop: 8, marginBottom: 16, alignItems: 'center', padding: 12, borderWidth: 1, borderColor: colors.gold, borderRadius: 8 },
  fullTosLinkText:    { fontSize: 13, color: colors.gold, fontFamily: FONT.bold },
  scrollHint:         { alignItems: 'center', paddingVertical: 8 },
  scrollHintText:     { fontSize: 12, color: colors.subtext, opacity: 0.7 },
  footer:             { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  checkRow:           { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  checkbox:           { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: colors.subtext, alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0 },
  checkboxChecked:    { backgroundColor: colors.gold, borderColor: colors.gold },
  checkmark:          { color: '#fff', fontSize: 13, fontFamily: FONT.bold },
  checkLabel:         { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },
  link:               { color: colors.gold, textDecorationLine: 'underline' },
  bold:               { fontFamily: FONT.bold },
  scrollToUnlock:     { fontSize: 12, color: colors.subtext, textAlign: 'center', marginBottom: 10 },
  errorText:          { fontSize: 12, color: colors.emergency, textAlign: 'center', marginBottom: 8 },
  acceptBtn:          { backgroundColor: colors.gold, borderRadius: 10, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  acceptBtnDisabled:  { opacity: 0.4 },
  acceptBtnText:      { color: '#fff', fontSize: 15, fontFamily: FONT.bold },
  versionNote:        { fontSize: 10, color: colors.subtext, textAlign: 'center', opacity: 0.7 },
});
