/**
 * UPLDisclaimer — Non-dismissible Unauthorized Practice of Law shield
 *
 * Must appear on EVERY screen that displays AI-generated legal content.
 * Cannot be hidden, minimized, or removed by users.
 * Legal requirement: ABA Model Rule 5.5 / state UPL statutes.
 */
import React from 'react';
import { TINTS } from '../constants/theme';
import { View, Text, StyleSheet } from 'react-native';
import { t, useLang } from '../i18n';
import { AppIcon, IconLabel, ICONS } from './AppIcon';

interface Props {
  compact?: boolean;   // one-line version for tight spaces
  attorney?: boolean;  // attorney-platform variant
}

export default function UPLDisclaimer({ compact, attorney }: Props) {
  useLang();
  if (compact) {
    return (
      <View style={s.compact}>
        <IconLabel icon={ICONS.alertNormal} textStyle={s.compactText} maxFontSizeMultiplier={1.2}>
          {t('upl_compact')}
        </IconLabel>
      </View>
    );
  }
  return (
    <View style={s.banner} accessibilityRole="text" accessibilityLabel={t('upl_a11y')}>
      <AppIcon name={ICONS.alertNormal} size={18} color={TINTS.amber.text} style={s.icon} />
      <View style={s.textBlock}>
        <Text style={s.heading} maxFontSizeMultiplier={1.3}>
          {attorney ? t('upl_attorney_heading') : t('upl_heading')}
        </Text>
        <Text style={s.body} maxFontSizeMultiplier={1.3}>
          {attorney ? t('upl_attorney_body') : t('upl_body')}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  banner:      { flexDirection: 'row', backgroundColor: TINTS.amber.bg, borderLeftWidth: 3, borderLeftColor: TINTS.amber.border, padding: 12, margin: 12, marginTop: 0, borderRadius: 6 },
  icon:        { marginRight: 10, marginTop: 1 },
  textBlock:   { flex: 1 },
  heading:     { fontSize: 12, fontWeight: '700', color: TINTS.amber.text, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  body:        { fontSize: 11, color: TINTS.amber.text, lineHeight: 16 },
  compact:     { backgroundColor: TINTS.amber.bg, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: TINTS.amber.border },
  compactText: { fontSize: 11, color: TINTS.amber.text, textAlign: 'center' },
});