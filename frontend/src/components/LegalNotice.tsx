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
import { View, Text, StyleSheet, Linking } from 'react-native';
import { FONT, useTheme } from '../constants/theme';
import { t, perLang, useLang } from '../i18n';
import { AppIcon, ICONS } from './AppIcon';

type Context = 'general' | 'motions' | 'research' | 'forms' | 'expungement';

interface Props {
  context?: Context;
  style?: object;
}

const NOTICES = perLang((): Record<Context, string> => ({
  general:     t('x_legal_notice_general_legal_information_only'),
  motions:     t('x_legal_notice_ai_generated_draft_not'),
  research:    t('x_legal_notice_informational_purposes_only_laws'),
  forms:       t('x_legal_notice_official_government_forms_responsibl'),
  expungement: t('x_legal_notice_eligibility_rules_vary_by'),
}));

function LegalNotice({ context = 'general', style }: Props) {
  useLang();
  const { colors } = useTheme();
  const s = styles(colors, FONT);

  return (
    <View style={[s.container, style]}>
      <View style={s.row}>
      <AppIcon name={ICONS.alertNormal} size={13} color={colors.textMuted} style={s.icon} />
      <Text maxFontSizeMultiplier={1.4} style={s.notice}>
        {NOTICES()[context]}{' '}
        <Text
          maxFontSizeMultiplier={1.4}
          style={s.link}
          onPress={() => Linking.openURL('https://www.lawhelp.org/').catch(() => {})}
          accessibilityLabel={t('x_legal_notice_find_free_legal_help')} accessibilityRole="link"
        >
          {t('x_legal_notice_find_free_legal_help_2')}
        </Text>
      </Text>
      </View>
    </View>
  );
}

const styles = (C: any, F: typeof FONT) => StyleSheet.create({
  container: {
    backgroundColor: C.bgSubtle,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start' },
  icon: { marginEnd: 4, marginTop: 1 },
  notice: {
    flexShrink: 1,
    fontSize: 11,
    fontFamily: F.regular,
    color: C.textMuted,
    lineHeight: 16,
    textAlign: 'center',
  },
  link: {
    color: C.info,
    textDecorationLine: 'underline',
  },
});
export default React.memo(LegalNotice);
