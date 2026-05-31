/**
 * components/EmptyState.tsx — Professional empty state component
 *
 * Replaces blank screens and raw emoji with branded illustrations + copy.
 * Used across all list screens: cases, lawyers, messages, motions, etc.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/theme';
import { Illustration } from './Illustrations';

type IllustrationKey = keyof typeof Illustration;

interface EmptyStateProps {
  illustration?: IllustrationKey;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({
  illustration = 'EmptyCases',
  title,
  body,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  const Illus = Illustration[illustration];

  const handleAction = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAction?.();
  };

  return (
    <View style={[s.container, compact && s.compact]}>
      <Illus width={compact ? 140 : 200} height={compact ? 120 : 170} />
      <Text style={s.title} maxFontSizeMultiplier={1.2}>{title}</Text>
      <Text style={s.body} maxFontSizeMultiplier={1.1}>{body}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          style={s.btn}
          onPress={handleAction}
        >
          <Text style={s.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, paddingTop: 48 },
  compact:   { paddingTop: 24 },
  title:     { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center',
                marginTop: 20, marginBottom: 8, fontFamily: 'Inter_700Bold' },
  body:      { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 21,
                maxWidth: 280, fontFamily: 'Inter_400Regular' },
  btn:       { marginTop: 24, backgroundColor: COLORS.navy, paddingHorizontal: 28,
                paddingVertical: 13, borderRadius: 12 },
  btnText:   { color: '#fff', fontWeight: '700', fontSize: 15, fontFamily: 'Inter_700Bold' },
});

export default EmptyState;
