/**
 * AmeelioCard — a short pointer to Ameelio on the family screens (build plan B10: partner, don't
 * build). Ameelio is a nonprofit that lets families send letters and photos and make video calls
 * to people in jails and prisons for free, where the facility works with Ameelio (it reaches
 * prisons through agreements with states and is not nationwide). Checked Oct 27 2026 against
 * Ameelio's own pages ("Ameelio for Loved Ones: Stay in touch with your loved ones for free") and
 * Stanford Social Innovation Review's profile of the nonprofit. No other claims; Justice Gavel is
 * not part of Ameelio.
 */
import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { AppIcon, ICONS } from './AppIcon';

export const AMEELIO_URL = 'https://www.ameelio.org';

export default function AmeelioCard({ testID = 'ameelio-card' }: { testID?: string }) {
  useLang();
  const { colors } = useTheme();
  const s = StyleSheet.create({
    card: { backgroundColor: colors.bgCard, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginVertical: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { color: colors.textPrimary, fontSize: 15, ...FONTS.semiBold, flex: 1 },
    body: { color: colors.textSecond, fontSize: 14, lineHeight: 20, marginTop: 6 },
    note: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
    link: { color: colors.textBrand, fontSize: 15, textDecorationLine: 'underline', marginTop: 8, minHeight: 44, textAlignVertical: 'center' },
  });
  return (
    <View style={s.card} testID={testID}>
      <View style={s.row}>
        <AppIcon name={ICONS.mail} size={20} color={colors.textBrand} />
        <Text maxFontSizeMultiplier={1.3} style={s.title}>{t('ame_title')}</Text>
      </View>
      <Text maxFontSizeMultiplier={1.4} style={s.body}>{t('ame_body')}</Text>
      <TouchableOpacity accessibilityRole="link" testID={`${testID}-link`} onPress={() => Linking.openURL(AMEELIO_URL).catch(() => {})}>
        <Text maxFontSizeMultiplier={1.4} style={s.link}>{t('ame_link')}</Text>
      </TouchableOpacity>
      <Text maxFontSizeMultiplier={1.4} style={s.note}>{t('ame_note')}</Text>
    </View>
  );
}
