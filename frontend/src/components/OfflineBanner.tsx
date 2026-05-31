import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export default function OfflineBanner() {
  const isOnline = useNetworkStatus();
  if (isOnline) return null;
  return (
    <View style={s.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={s.text} maxFontSizeMultiplier={1.2}>
        📡 You're offline — some features unavailable
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  banner: { backgroundColor: '#263238', paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center' },
  text:   { color: '#fff', fontSize: 12, fontWeight: '600' },
});
