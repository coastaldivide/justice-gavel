/**
 * SampleRecordBadge — visible "Sample record" label for arrest rows the API
 * flags `is_sample: true`. Those rows only reach the app when the backend runs
 * with SHOW_SAMPLE_ARRESTS=true (demos); they are generated, not real bookings.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, type ThemeColors } from '../constants/theme';
import { t, useLang } from '../i18n';

export function isSampleRecord(row: unknown): boolean {
  const v = (row as { is_sample?: unknown } | null | undefined)?.is_sample;
  return v === true || v === 1 || v === 't' || v === 'true';
}

export function SampleRecordBadge({ row }: { row: unknown }): React.JSX.Element | null {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (!isSampleRecord(row)) return null;
  return (
    <View
      testID="sample-record-badge"
      style={styles.badge}
      accessible
      accessibilityLabel={t('x_sample_record_badge_sample_record_this_generated')}
    >
      <Text maxFontSizeMultiplier={1.4} style={styles.text}>{t('x_sample_record_badge_sample_record_not_real')}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.warnBg,
    borderColor: colors.warnDark,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  text: { fontSize: 11, fontWeight: '700', color: colors.warnDark },
});

export default SampleRecordBadge;
