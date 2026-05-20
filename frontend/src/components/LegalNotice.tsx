/**
 * LegalNotice.tsx
 *
 * Persistent, unobtrusive "not legal advice" notice.
 * Shown as a subtle footer on every AI-generated content screen.
 *
 * This is how tier-1 companies handle ongoing disclosure:
 * not a gate the user has to get through, but a consistent
 * reminder that's always there when it's relevant.
 *
 * Usage:
 *   <LegalNotice />                        — standard footer
 *   <LegalNotice context="motions" />      — motion-specific note
 *   <LegalNotice context="research" />     — research-specific note
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useTheme } from '../constants/theme';

type Context = 'general' | 'motions' | 'research' | 'forms' | 'expungement';

interface Props {
  context?: Context;
  style?: object;
}

const NOTICES: Record<Context, string> = {
  general:     'General legal information only — not legal advice. Consult a licensed attorney for advice about your situation.',
  motions:     'AI-generated draft — not reviewed by an attorney. Review carefully before filing.',
  research:    'For informational purposes only. Laws change. Verify with current official sources.',
  forms:       'Official government forms. You are responsible for reviewing every field before filing.',
  expungement: 'Eligibility rules vary by state and case type. An attorney can advise on your specific situation.',
};

function LegalNotice({ context = 'general', style }: Props) {
  const { COLORS, FONTS } = useTheme();
  const s = styles(COLORS, FONTS);

  return (
    <View style={[s.container, style]}>
      <Text maxFontSizeMultiplier={1.4} style={s.notice}>
        ℹ️ {NOTICES[context]}{' '}
        <Text
          maxFontSizeMultiplier={1.4}
          style={s.link}
          onPress={() => Linking.openURL('https://www.lawhelp.org/').catch(() => {})}
          accessibilityLabel="Find free legal help" accessibilityRole="link"
        >
          Find free legal help →
        </Text>
      </Text>
    </View>
  );
}

const styles = (C: unknown, F: unknown) => StyleSheet.create({
  container: {
    backgroundColor: C.bgSubtle,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  notice: {
    fontSize: 11,
    fontFamily: F.regular,
    color: C.textMuted,
    lineHeight: 16,
    textAlign: 'center',
  },
  link: {
    color: C.blue,
    textDecorationLine: 'underline',
  },
});
export default React.memo(LegalNotice);
