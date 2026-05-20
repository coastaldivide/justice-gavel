/**
 * EmergencyStrip — 911 / 988 quick-call buttons
 * Add to any screen where a user may be in distress.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';

function call(num: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  Linking.openURL(`tel:${num}`).catch(() =>
    Alert.alert('Cannot call', `Please dial ${num} manually.`)
  );
}

function EmergencyStrip({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.strip, compact && styles.compact]}>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: '#B71C1C' }]}
        onPress={() => call('911')}
        accessibilityRole="button"
        accessibilityLabel="Call 911 emergency services">
        <Text maxFontSizeMultiplier={1.2} style={styles.btnText}>
          🚨 {compact ? '911' : 'CALL 911'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: '#1565C0' }]}
        onPress={() => call('988')}
        accessibilityRole="button"
        accessibilityLabel="Call 988 crisis and suicide lifeline">
        <Text maxFontSizeMultiplier={1.2} style={styles.btnText}>
          💙 {compact ? '988' : 'CRISIS 988'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  strip:   { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  compact: { paddingHorizontal: 8, paddingVertical: 4 },
  btn:     { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
});
export default React.memo(EmergencyStrip);
