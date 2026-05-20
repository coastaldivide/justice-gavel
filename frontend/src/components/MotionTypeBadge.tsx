/**
 * MotionTypeBadge.tsx — Motion category pill (suppress / dismiss / bail_reduction / etc.)
 * Extracted from MotionLibraryScreen for reuse in case documents view.
 */
import React from 'react';
import { View, Text } from 'react-native';

const MOTION_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  suppress:       { bg: '#FCE4EC', text: '#880E4F', label: 'Suppress Evidence' },
  bail_reduction: { bg: '#E3F2FD', text: '#0D47A1', label: 'Bail Reduction' },
  dismiss:        { bg: '#E8F5E9', text: '#1B5E20', label: 'Dismiss Charges' },
  continuance:    { bg: '#FFF3E0', text: '#E65100', label: 'Continuance' },
  discovery:      { bg: '#EDE7F6', text: '#4527A0', label: 'Discovery' },
  speedy_trial:   { bg: '#F3E5F5', text: '#6A1B9A', label: 'Speedy Trial' },
  acquittal:      { bg: '#E8F5E9', text: '#2E7D32', label: 'Acquittal' },
  reduce_sentence:{ bg: '#E8EAF6', text: '#283593', label: 'Reduce Sentence' },
};

type Props = { motionType: string };

export const MotionTypeBadge = React.memo(function MotionTypeBadge({ motionType }: Props) {
  const info = MOTION_COLORS[motionType] ?? { bg: '#F5F5F5', text: '#424242', label: motionType };
  return (
    <View style={{
      backgroundColor: info.bg, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
    }}>
      <Text maxFontSizeMultiplier={1.2}
        style={{ fontSize: 11, fontWeight: '700', color: info.text }}>
        {info.label}
      </Text>
    </View>
  );
})