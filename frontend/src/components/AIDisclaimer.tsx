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
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ScrollView, Platform,
} from 'react-native';
import { storage } from '../utils/storage';
import { useTheme } from '../constants/theme';

const DISCLAIMER_KEY = 'upl_disclaimer_acknowledged_v1';

interface Props {
  variant?: 'banner' | 'inline' | 'modal';
  feature?: string;  // e.g. "AI Legal Chat", "Legal Research", "Motion Generator"
}

export function AIDisclaimer({ variant = 'banner', feature = 'AI Legal Analysis' }: Props) {
  const { colors } = useTheme();
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (variant === 'modal') {
      const acknowledged = storage.getString(DISCLAIMER_KEY);
      if (!acknowledged) setShowModal(true);
    }
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
        accessibilityLabel="Legal disclaimer"
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.bg }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              ⚖️ Important Legal Notice
            </Text>
            <ScrollView style={{ maxHeight: 280 }}>
              <Text style={[styles.modalBody, { color: colors.textMuted }]}>
                <Text style={{ fontWeight: '700' }}>Justice Gavel provides legal information, not legal advice.</Text>
                {'\n\n'}
                The {feature} feature uses AI to provide general legal information
                based on publicly available law. This is educational content only.
                {'\n\n'}
                <Text style={{ fontWeight: '600' }}>This is NOT:</Text>
                {'\n'}
                • Legal advice specific to your situation{'\n'}
                • A substitute for an attorney{'\n'}
                • A lawyer-client relationship{'\n\n'}
                <Text style={{ fontWeight: '600' }}>Important limitations:</Text>
                {'\n'}
                • AI can make mistakes and may be out of date{'\n'}
                • Laws vary by jurisdiction and change frequently{'\n'}
                • Your situation may have facts that change the legal outcome{'\n\n'}
                For matters with significant consequences, always consult a
                licensed attorney in your jurisdiction.
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.ackButton, { backgroundColor: colors.navy }]}
              onPress={acknowledge}
              accessibilityRole="button"
              accessibilityLabel="I understand, continue"
              accessibilityHint="Acknowledges the legal disclaimer and proceeds to the feature"
            >
              <Text style={styles.ackButtonText}>I Understand — Continue</Text>
            </TouchableOpacity>
            <Text style={[styles.modalFooter, { color: colors.textFaint }]}>
              This notice appears once per device. Review our Terms for full disclaimer.
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  if (variant === 'inline') {
    return (
      <View
        style={[styles.inlineBanner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        accessibilityRole="text"
        accessibilityLabel="AI information disclaimer"
      >
        <Text style={[styles.inlineText, { color: colors.textMuted }]}>
          ⚖️ <Text style={{ fontWeight: '600' }}>AI information only</Text> — not legal advice.
          {' '}
          <Text style={{ textDecorationLine: 'underline' }}>What this means</Text>
        </Text>
      </View>
    );
  }

  // Default: banner variant
  return (
    <View
      style={[styles.banner, { backgroundColor: colors.navyLight ?? colors.surfaceAlt }]}
      accessibilityRole="text"
      accessibilityLabel="Legal information disclaimer"
    >
      <Text style={[styles.bannerText, { color: colors.textMuted }]}>
        ⚖️ This is legal information, not legal advice. Not a substitute for an attorney.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner:        { paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1 },
  bannerText:    { fontSize: 11, textAlign: 'center', lineHeight: 16 },
  inlineBanner:  { margin: 12, padding: 10, borderRadius: 8, borderWidth: 1, flexDirection: 'row' },
  inlineText:    { fontSize: 12, flex: 1, lineHeight: 17 },
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard:     { borderRadius: 16, padding: 24, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  modalTitle:    { fontSize: 20, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  modalBody:     { fontSize: 14, lineHeight: 22 },
  ackButton:     { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ackButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalFooter:   { fontSize: 10, textAlign: 'center', marginTop: 12 },
});

export default AIDisclaimer;
