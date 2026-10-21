/**
 * EmergencyStrip — 911 / 988 quick-call buttons, one tap to dial.
 *
 * A calm, compact row: tonal buttons with an outline, an icon and a clear
 * label (911 in emergency red, 988 in the info blue), never two big saturated
 * slabs — the screen's one urgent action stays the loudest thing on it.
 * `compact` shows just the numbers (top of a reading screen); `inset` drops
 * the side padding when the parent already has a gutter.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { AppIcon, ICONS } from './AppIcon';

function call(num: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  Linking.openURL(`tel:${num}`).catch(() =>
    Alert.alert(t('cp_cannot_call'), t('cp_dial_manually', { num }))
  );
}

function EmergencyStrip({ compact = false, inset = false }: { compact?: boolean; inset?: boolean }) {
  useLang();
  const { colors } = useTheme();
  const tones = {
    e911: { fg: colors.emergency, bg: colors.emergencyBg },
    e988: { fg: colors.info, bg: colors.infoBg },
  };
  return (
    <View style={[styles.strip, compact && styles.compact, inset && styles.inset]} testID="emergency-strip">
      <TouchableOpacity
        testID="strip-call-911"
        style={[styles.btn, { backgroundColor: tones.e911.bg, borderColor: tones.e911.fg }]}
        onPress={() => call('911')}
        accessibilityRole="button"
        accessibilityLabel={t('cp_call_911_a11y')}>
        <AppIcon name={ICONS.phoneFilled} size={17} color={tones.e911.fg} />
        <Text maxFontSizeMultiplier={1.2} style={[styles.btnText, { color: tones.e911.fg }]} numberOfLines={2}>
          {compact ? '911' : t('cp_call_911')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID="strip-call-988"
        style={[styles.btn, { backgroundColor: tones.e988.bg, borderColor: tones.e988.fg }]}
        onPress={() => call('988')}
        accessibilityRole="button"
        accessibilityLabel={t('cp_call_988_a11y')}>
        <AppIcon name={ICONS.crisis} size={17} color={tones.e988.fg} />
        <Text maxFontSizeMultiplier={1.2} style={[styles.btnText, { color: tones.e988.fg }]} numberOfLines={2}>
          {compact ? '988' : t('cp_crisis_988')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  strip:   { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  compact: { paddingHorizontal: 8, paddingVertical: 4 },
  inset:   { paddingHorizontal: 0 },
  btn:     { flex: 1, flexDirection: 'row', gap: 8, borderRadius: 12, borderWidth: 1.5, minHeight: 48, paddingHorizontal: 10,
             alignItems: 'center', justifyContent: 'center' },
  btnText: { fontWeight: '800', fontSize: 14, lineHeight: 17, letterSpacing: 0.3, flexShrink: 1, textAlign: 'center' },
});
export default React.memo(EmergencyStrip);
