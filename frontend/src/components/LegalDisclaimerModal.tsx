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
import { COLORS, FONT } from '../constants/theme';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t, useLang } from '../i18n';
import { AppIcon, ICONS } from './AppIcon';

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
  try {
    await AsyncStorage.setItem(CONSENT_KEY, 'true');
  } catch {
    // Non-fatal — if storage fails, consent is re-asked on next launch
  }
}

export async function clearConsent(): Promise<void> {
  await AsyncStorage.removeItem(CONSENT_KEY);
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  onAccept: () => void;
  featureContext?: string;
  onDecline?: () => void;
}

function LegalDisclaimerModal({ visible, onAccept }: Props) {
  useLang();
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

  const s = styles(COLORS, FONT);

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
          <AppIcon name={ICONS.gavel} size={52} color={COLORS.gold} style={s.logo} />
          <Text maxFontSizeMultiplier={1.4} style={s.appName}>Justice Gavel</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.tagline}>{t('x_legal_disclaimer_modal_legal_self_help_everyone')}</Text>
        </View>

        {/* ── Core statement — clear, brief, human ── */}
        <View style={s.statement}>
          <Text maxFontSizeMultiplier={1.4} style={s.statementText}>
            {t('x_legal_disclaimer_modal_justice_gavel_helps_understand')}{' '}
            <Text maxFontSizeMultiplier={1.4} style={s.bold}>{t('x_legal_disclaimer_modal_not_law_firm')}</Text>
            {' '}{t('x_legal_disclaimer_modal_nothing_here_legal_advice')}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[s.statementText, { marginTop: 12 }]}>
            {t('x_legal_disclaimer_modal_advice_about_specific_situation')}{' '}
            <Text
              maxFontSizeMultiplier={1.4}
              style={s.link}
              onPress={() => openLink('https://www.lawhelp.org/')}
            >
              {t('x_legal_disclaimer_modal_licensed_attorney')}
            </Text>
            {t('x_legal_disclaimer_modal_many_offer_free_consultations')}
          </Text>
        </View>

        {/* ── Single checkbox — LegalZoom standard ── */}
        <TouchableOpacity
          style={s.checkRow}
          onPress={() => setAgreed(v => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel={t('x_legal_disclaimer_modal_i_agree_terms_service')}
          activeOpacity={0.7}
        >
          <View style={[s.checkBox, agreed && { backgroundColor: COLORS.navy, borderColor: COLORS.navy }]}>
            {agreed && (
              <Text maxFontSizeMultiplier={1.4} style={s.checkMark}>✓</Text>
            )}
          </View>
          <Text maxFontSizeMultiplier={1.4} style={s.checkLabel}>
            {t('x_legal_disclaimer_modal_i_agree')}{' '}
            <Text
              maxFontSizeMultiplier={1.4}
              style={s.link}
              onPress={() => openLink('https://justicegavel.app/terms')}
            >
              {t('onb_terms_tos')}
            </Text>
            {' '}{t('x_legal_disclaimer_modal_text')}{' '}
            <Text
              maxFontSizeMultiplier={1.4}
              style={s.link}
              onPress={() => openLink('https://justicegavel.app/privacy')}
            >
              {t('onb_terms_pp')}
            </Text>
            {t('x_legal_disclaimer_modal_i_understand_this_app')}
          </Text>
        </TouchableOpacity>

        {/* ── Get started ── */}
        <TouchableOpacity
          style={[s.btn, !agreed && s.btnDisabled]}
          onPress={handleAccept}
          disabled={!agreed}
          accessibilityRole="button"
          accessibilityLabel={t('x_legal_disclaimer_modal_get_started')}
          accessibilityState={{ disabled: !agreed }}>
          <Text maxFontSizeMultiplier={1.4} style={[s.btnText, !agreed && s.btnTextDisabled]}>
            {t('x_legal_disclaimer_modal_get_started_2')}
          </Text>
        </TouchableOpacity>

        {/* ── Fine print ── */}
        <Text maxFontSizeMultiplier={1.4} style={s.fine}>
          {t('x_legal_disclaimer_modal_justice_gavel_inc_not')}
        </Text>

      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = (C: any, F: typeof FONT) => StyleSheet.create({
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
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkMark: {
    color: COLORS.white,
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
    color: COLORS.white,
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
