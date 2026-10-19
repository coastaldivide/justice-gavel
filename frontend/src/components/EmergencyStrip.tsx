/**
 * EmergencyStrip — 911 / 988 quick-call buttons
 * Add to any screen where a user may be in distress.
 */
import React from 'react';
import { COLORS } from '../constants/theme';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { t, useLang } from '../i18n';

function call(num: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  Linking.openURL(`tel:${num}`).catch(() =>
    Alert.alert(t('cp_cannot_call'), t('cp_dial_manually', { num }))
  );
}

function EmergencyStrip({ compact = false }: { compact?: boolean }) {
  useLang();
  return (
    <View style={[styles.strip, compact && styles.compact]}>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: COLORS.emergencyDark }]}
        onPress={() => call('911')}
        accessibilityRole="button"
        accessibilityLabel={t('cp_call_911_a11y')}>
        <Text maxFontSizeMultiplier={1.2} style={styles.btnText}>
          🚨 {compact ? '911' : t('cp_call_911')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: COLORS.blue }]}
        onPress={() => call('988')}
        accessibilityRole="button"
        accessibilityLabel={t('cp_call_988_a11y')}>
        <Text maxFontSizeMultiplier={1.2} style={styles.btnText}>
          💙 {compact ? '988' : t('cp_crisis_988')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  strip:   { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  compact: { paddingHorizontal: 8, paddingVertical: 4 },
  btn:     { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: COLORS.white, fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
});
export default React.memo(EmergencyStrip);
