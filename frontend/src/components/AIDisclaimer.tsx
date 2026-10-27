/**
 * AIDisclaimer.tsx — Persistent UPL (Unauthorized Practice of Law) disclaimer
 *
 * Appears on every screen that shows AI-generated legal analysis.
 *
 * Legal background:
 *   UPL occurs when a non-attorney provides legal advice specific to a person's
 *   situation. Our AI provides legal INFORMATION, not legal ADVICE.
 *   This distinction, prominently displayed, is our primary legal protection.
 *
 * Design: non-intrusive banner at bottom of AI output, always visible.
 * First use: modal requiring acknowledgment (stored in MMKV, not re-shown).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { COLORS } from '../constants/theme';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { storage, storageReady } from '../utils/storage';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { IconLabel, ICONS, AppIcon } from './AppIcon';

const DISCLAIMER_KEY = 'upl_disclaimer_acknowledged_v1';

interface Props {
  variant?: 'banner' | 'inline' | 'modal';
  feature?: string;  // e.g. "AI Legal Chat", "Legal Research", "Motion Generator"
}

export function AIDisclaimer({ variant = 'banner', feature = t('x_aidisclaimer_ai_legal_analysis') }: Props) {
  const { colors } = useTheme();
  useLang();
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (variant !== 'modal') return;
    let active = true;
    storageReady.then(() => {
      const acknowledged = storage.getString(DISCLAIMER_KEY);
      if (active && !acknowledged) setShowModal(true);
    });
    return () => { active = false; };
  }, [variant]);

  const acknowledge = useCallback(() => {
    storage.set(DISCLAIMER_KEY, new Date().toISOString());
    setShowModal(false);
  }, []);

  if (variant === 'modal') {
    return (
      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        accessibilityViewIsModal
        accessibilityLabel={t('upl_a11y')}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.bg }]}>
            <IconLabel icon={ICONS.lawyer} textStyle={[styles.modalTitle, { color: colors.text }]}>{t('x_aidisclaimer_important_legal_notice')}</IconLabel>
            <ScrollView style={{ maxHeight: 280 }}>
              <Text style={[styles.modalBody, { color: colors.textMuted }]}>
                <Text style={{ fontWeight: '700' }}>{t('x_aidisclaimer_justice_gavel_provides_legal')}</Text>
                {' '}{t('x_aidisclaimer_feature_uses_ai_provide', { feature })}{' '}
                <Text style={{ fontWeight: '600' }}>{t('x_aidisclaimer_this_not')}</Text>
                {' '}{t('x_aidisclaimer_legal_advice_specific_situation')}{' '}
                <Text style={{ fontWeight: '600' }}>{t('x_aidisclaimer_important_limitations')}</Text>
                {' '}{t('x_aidisclaimer_ai_can_make_mistakes')}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.ackButton, { backgroundColor: colors.navy }]}
              onPress={acknowledge}
              accessibilityRole="button"
              accessibilityLabel={t('x_aidisclaimer_i_understand_continue')}
              accessibilityHint={t('x_aidisclaimer_acknowledges_legal_disclaimer_procee')}
            >
              <Text style={styles.ackButtonText}>{t('x_aidisclaimer_i_understand_continue_2')}</Text>
            </TouchableOpacity>
            <Text style={[styles.modalFooter, { color: colors.textMuted }]}>
              {t('x_aidisclaimer_this_notice_appears_once')}
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  if (variant === 'inline') {
    return (
      <View
        style={[styles.inlineBanner, { backgroundColor: (colors as any).surfaceAlt, borderColor: colors.border }]}
        accessibilityRole="text"
        accessibilityLabel={t('aid_inline_a11y')}
      >
        <AppIcon name={ICONS.alertNormal} size={14} color={colors.textMuted} style={styles.inlineIcon} />
        <Text style={[styles.inlineText, { color: colors.textMuted, flexShrink: 1 }]}>
          <Text style={{ fontWeight: '600' }}>{t('aid_inline_strong')}</Text> — {t('aid_inline_rest')}
          {' '}
          <Text style={{ textDecorationLine: 'underline' }}>{t('aid_what_this_means')}</Text>
        </Text>
      </View>
    );
  }

  // Default: banner variant
  return (
    <View
      style={[styles.banner, { backgroundColor: colors.bgSubtle, borderTopColor: colors.border }]}
      accessibilityRole="text"
      accessibilityLabel={t('aid_banner_a11y')}
    >
      <IconLabel icon={ICONS.alertNormal} textStyle={[styles.bannerText, { color: colors.textSecond }]} center>
        {t('aid_banner')}
      </IconLabel>
    </View>
  );
}

const styles = StyleSheet.create({
  banner:        { paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1 },
  bannerText:    { fontSize: 11, textAlign: 'center', lineHeight: 16 },
  inlineBanner:  { margin: 12, padding: 10, borderRadius: 8, borderWidth: 1, flexDirection: 'row' },
  inlineText:    { fontSize: 12, flex: 1, lineHeight: 17 },
  inlineIcon:    { marginEnd: 6, marginTop: 1 },
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard:     { borderRadius: 16, padding: 24, shadowColor: COLORS.black, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  modalTitle:    { fontSize: 20, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  modalBody:     { fontSize: 14, lineHeight: 22 },
  ackButton:     { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ackButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  modalFooter:   { fontSize: 10, textAlign: 'center', marginTop: 12 },
});

export default AIDisclaimer;
