/**
 * LegalDisclaimerModal.tsx
 *
 * Tier-1 standard disclaimer gate — same approach as LegalZoom, Rocket Lawyer,
 * and every other major legal self-help platform.
 *
 * THE CORRECT STANDARD (per ABA guidance and case law):
 *   Legal protection comes from the SUBSTANCE of the disclosure in your
 *   Terms of Service — not from UX friction. Clickwrap (single checkbox +
 *   ToS link) has been consistently upheld. Courts do not require scroll-through
 *   or multiple checkboxes.
 *
 * WHAT THIS DOES:
 *   - Shown once on first launch, then never again (same as LegalZoom/Rocket Lawyer)
 *   - Single, clear statement of what the app is and is not
 *   - Single checkbox: "I agree to the Terms of Service and Privacy Policy"
 *   - Links to ToS and Privacy Policy (where the full legal substance lives)
 *   - Persistent "Not legal advice" notice embedded in the app (not a gate)
 *
 * WHAT MOVED OUT OF THE GATE (into Terms of Service where it belongs):
 *   - Full no-attorney-client relationship language
 *   - Full liability limitation
 *   - Full AI content disclaimer
 *   - Full jurisdiction variance notice
 *   These are all in the ToS. Users can read them. The gate is not the place.
 *
 * VERSION: Increment CONSENT_VERSION when Terms change materially.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Linking,
  Platform,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../constants/theme';

// ── Versioning ────────────────────────────────────────────────────────────────
export const CONSENT_VERSION = '2.0';
const CONSENT_KEY = `jg_consent_v${CONSENT_VERSION}`;

// ── Storage helpers ───────────────────────────────────────────────────────────
export async function hasValidConsent(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(CONSENT_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function storeConsent(): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, 'true');
}

export async function clearConsent(): Promise<void> {
  await AsyncStorage.removeItem(CONSENT_KEY);
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  onAccept: () => void;
}

function LegalDisclaimerModal({ visible, onAccept }: Props) {
  const { colors, isDark } = useTheme()
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (visible) setAgreed(false);
  }, [visible]);

  const handleAccept = useCallback(async () => {
    if (!agreed) return;
    await storeConsent();
    onAccept();
  }, [agreed, onAccept]);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  const s = styles(COLORS, FONTS);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={() => {}}>
      <View style={s.root}>

        {/* ── Logo / Brand ── */}
        <View style={s.brand}>
          <Text maxFontSizeMultiplier={1.4} style={s.logo}>⚖️</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.appName}>Justice Gavel</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.tagline}>Legal self-help for everyone</Text>
        </View>

        {/* ── Core statement — clear, brief, human ── */}
        <View style={s.statement}>
          <Text maxFontSizeMultiplier={1.4} style={s.statementText}>
            Justice Gavel helps you understand your legal rights and navigate
            the justice system. We are{' '}
            <Text maxFontSizeMultiplier={1.4} style={s.bold}>not a law firm</Text>
            {' '}and nothing here is legal advice.
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[s.statementText, { marginTop: 12 }]}>
            For advice about your specific situation, please consult a{' '}
            <Text
              maxFontSizeMultiplier={1.4}
              style={s.link}
              onPress={() => openLink('https://www.lawhelp.org/')}
            >
              licensed attorney
            </Text>
            . Many offer free consultations.
          </Text>
        </View>

        {/* ── Single checkbox — LegalZoom standard ── */}
        <TouchableOpacity
          style={s.checkRow}
          onPress={() => setAgreed(v => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
          activeOpacity={0.7}
        >
          <View style={[s.checkBox, agreed && { backgroundColor: COLORS.navy, borderColor: COLORS.navy }]}>
            {agreed && (
              <Text maxFontSizeMultiplier={1.4} style={s.checkMark}>✓</Text>
            )}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={s.checkLabel}>
            I agree to the{' '}
            <Text
              maxFontSizeMultiplier={1.4}
              style={s.link}
              onPress={() => openLink('https://justicegavel.app/terms')}
            >
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text
              maxFontSizeMultiplier={1.4}
              style={s.link}
              onPress={() => openLink('https://justicegavel.app/privacy')}
            >
              Privacy Policy
            </Text>
            . I understand this app does not provide legal advice.
          </Text>
        </TouchableOpacity>

        {/* ── Get started ── */}
        <TouchableOpacity
          style={[s.btn, !agreed && s.btnDisabled]}
          onPress={handleAccept}
          disabled={!agreed}
          accessibilityRole="button"
          accessibilityLabel="Get started"
          accessibilityState={{ disabled: !agreed }}>
          <Text maxFontSizeMultiplier={1.4} style={[s.btnText, !agreed && s.btnTextDisabled]}>
            Get Started
          </Text>
        </TouchableOpacity>

        {/* ── Fine print ── */}
        <Text maxFontSizeMultiplier={1.4} style={s.fine}>
          Justice Gavel, Inc. · Not a law firm · No attorney-client relationship
        </Text>

      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = (C: any, F: any) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 80 : 60,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 52,
    marginBottom: 10,
  },
  appName: {
    fontSize: 28,
    fontFamily: F.bold,
    color: C.navy,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    fontFamily: F.regular,
    color: C.textMuted,
  },
  statement: {
    backgroundColor: C.bgCard,
    borderRadius: 14,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: C.border,
  },
  statementText: {
    fontSize: 15,
    fontFamily: F.regular,
    color: C.textPrimary,
    lineHeight: 23,
  },
  bold: {
    fontFamily: F.bold,
  },
  link: {
    color: C.blue,
    textDecorationLine: 'underline',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 28,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#CBD5E0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: F.regular,
    color: C.textPrimary,
    lineHeight: 21,
  },
  btn: {
    backgroundColor: C.navy,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 16,
  },
  btnDisabled: {
    backgroundColor: C.bgSubtle,
    borderWidth: 1,
    borderColor: C.border,
  },
  btnText: {
    fontSize: 16,
    fontFamily: F.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  btnTextDisabled: {
    color: C.textMuted,
  },
  fine: {
    fontSize: 11,
    fontFamily: F.regular,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
});
export default React.memo(LegalDisclaimerModal);
