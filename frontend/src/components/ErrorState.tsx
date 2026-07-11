/**
 * ErrorState.tsx — Full-screen error recovery component
 * Usage: {error && <ErrorState message={error} onRetry={loadData} />}
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../constants/theme';

interface Props {
  message?:  string;
  onRetry?:  () => void;
  icon?:     string;
  fullScreen?: boolean;
}

export default function ErrorState({
  message    = 'Something went wrong. Please try again.',
  onRetry,
  icon       = '⚠️',
  fullScreen = false,
}: Props) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        s.container,
        fullScreen && s.fullScreen,
        { backgroundColor: fullScreen ? colors.primary : 'transparent' },
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      <Text style={s.icon}>{icon}</Text>
      <Text
        maxFontSizeMultiplier={1.3}
        style={[s.message, { color: colors.textPrimary }]}
      >
        {message}
      </Text>
      {onRetry && (
        <TouchableOpacity
          style={[s.retryBtn, { borderColor: colors.blue }]}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry — try again"
          accessibilityHint="Attempts to reload the data"
        >
          <Text style={[s.retryText, { color: colors.blue }]}>Try Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:  { alignItems: 'center', justifyContent: 'center', padding: 32 },
  fullScreen: { flex: 1 },
  icon:       { fontSize: 48, marginBottom: 16 },
  message:    { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 20, maxWidth: 280 },
  retryBtn:   { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12, minHeight: 44 },
  retryText:  { fontSize: 15, fontWeight: '700' },
});
