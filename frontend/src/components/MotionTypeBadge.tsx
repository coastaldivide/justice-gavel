/**
 * MotionTypeBadge.tsx — Motion category pill (suppress / dismiss / bail_reduction / etc.)
 * Extracted from MotionLibraryScreen for reuse in case documents view.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { TINTS } from '../constants/theme';
import { t, useLang, perLang } from '../i18n';

const MOTION_COLORS = perLang((): Record<string, { bg: string; text: string; label: string }> => ({
  suppress:       { ...TINTS.pink,     label: t('x_motion_type_badge_suppress_evidence') },
  bail_reduction: { ...TINTS.blue,     label: t('x_motion_type_badge_bail_reduction') },
  dismiss:        { ...TINTS.green,    label: t('x_motion_type_badge_dismiss_charges') },
  continuance:    { ...TINTS.orange,   label: t('x_motion_type_badge_continuance') },
  discovery:      { ...TINTS.violet,   label: t('x_motion_type_badge_discovery') },
  speedy_trial:   { ...TINTS.purple,   label: t('x_motion_type_badge_speedy_trial') },
  acquittal:      { ...TINTS.greenAlt, label: t('x_motion_type_badge_acquittal') },
  reduce_sentence:{ ...TINTS.indigo,   label: t('x_motion_type_badge_reduce_sentence') },
}));

type Props = { motionType: string };

export const MotionTypeBadge = React.memo(function MotionTypeBadge({ motionType }: Props) {
  useLang();
  const info = MOTION_COLORS()[motionType] ?? { ...TINTS.gray, label: motionType };
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