/**
 * MotionTypeBadge.tsx — Motion category pill (suppress / dismiss / bail_reduction / etc.)
 * Extracted from MotionLibraryScreen for reuse in case documents view.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { TINTS } from '../constants/theme';

const MOTION_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  suppress:       { ...TINTS.pink,     label: 'Suppress Evidence' },
  bail_reduction: { ...TINTS.blue,     label: 'Bail Reduction' },
  dismiss:        { ...TINTS.green,    label: 'Dismiss Charges' },
  continuance:    { ...TINTS.orange,   label: 'Continuance' },
  discovery:      { ...TINTS.violet,   label: 'Discovery' },
  speedy_trial:   { ...TINTS.purple,   label: 'Speedy Trial' },
  acquittal:      { ...TINTS.greenAlt, label: 'Acquittal' },
  reduce_sentence:{ ...TINTS.indigo,   label: 'Reduce Sentence' },
};

type Props = { motionType: string };

export const MotionTypeBadge = React.memo(function MotionTypeBadge({ motionType }: Props) {
  const info = MOTION_COLORS[motionType] ?? { ...TINTS.gray, label: motionType };
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