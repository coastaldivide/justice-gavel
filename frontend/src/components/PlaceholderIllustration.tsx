/**
 * PlaceholderIllustration.tsx — Onboarding screen illustration slots
 *
 * Replace with real SVG illustrations from the designer.
 * Each type maps to a distinct visual concept for the onboarding flow.
 *
 * Usage: <PlaceholderIllustration type="gavel" size={160} />
 */
import React from 'react';
import { View, StyleSheet, Text } from 'react-native';

type IllustrationType = 'gavel' | 'shield' | 'lawyer' | 'phone' | 'check' | 'lock';

interface Props {
  type: IllustrationType;
  size?: number;
  color?: string;
}

const ICONS: Record<IllustrationType, string> = {
  gavel:  '⚖️',
  shield: '🛡️',
  lawyer: '👨‍💼',
  phone:  '📱',
  check:  '✅',
  lock:   '🔒',
};

const LABELS: Record<IllustrationType, string> = {
  gavel:  'Legal Guidance',
  shield: 'Your Rights',
  lawyer: 'Find a Lawyer',
  phone:  'Always Available',
  check:  'Know Your Options',
  lock:   'Private & Secure',
};

export const PlaceholderIllustration = React.memo(function PlaceholderIllustration({ type, size = 120, color = '#042C53' }: Props): React.JSX.Element {
  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2, borderColor: color }]}>
      <Text maxFontSizeMultiplier={1} style={[styles.icon, { fontSize: size * 0.38 }]}>
        {ICONS[type]}
      </Text>
      <Text maxFontSizeMultiplier={1} style={[styles.label, { color, fontSize: Math.max(10, size * 0.1) }]}>
        {LABELS[type]}
      </Text>
    </View>
  );
})

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(4,44,83,0.06)',
    // Replace with real illustration — this is a design placeholder
  },
  icon:  { marginBottom: 4 },
  label: { fontWeight: '600', textAlign: 'center', letterSpacing: 0.3 },
});

export default PlaceholderIllustration;
