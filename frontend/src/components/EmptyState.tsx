import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/theme';

interface Props {
  icon?:      string;
  title:      string;
  body?:      string;
  actionLabel?: string;
  onAction?:  () => void;
}

export default function EmptyState({ icon = '📭', title, body, actionLabel, onAction }: Props) {
  return (
    <View style={s.container}>
      <Text style={s.icon}>{icon}</Text>
      <Text style={s.title} maxFontSizeMultiplier={1.3}>{title}</Text>
      {!!body && <Text style={s.body} maxFontSizeMultiplier={1.3}>{body}</Text>}
      {!!actionLabel && !!onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={s.btn}
          onPress={onAction}
        >
          <Text style={s.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  icon:  { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 8 },
  body:  { fontSize: 14, color: COLORS.textSecond, textAlign: 'center', lineHeight: 20 },
  btn:   { marginTop: 20, backgroundColor: COLORS.navy, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
