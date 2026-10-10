/**
 * SampleRecordBadge — visible "Sample record" label for arrest rows the API
 * flags `is_sample: true`. Those rows only reach the app when the backend runs
 * with SHOW_SAMPLE_ARRESTS=true (demos); they are generated, not real bookings.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';

export function isSampleRecord(row: unknown): boolean {
  const v = (row as { is_sample?: unknown } | null | undefined)?.is_sample;
  return v === true || v === 1 || v === 't' || v === 'true';
}

export function SampleRecordBadge({ row }: { row: unknown }): React.JSX.Element | null {
  if (!isSampleRecord(row)) return null;
  return (
    <View
      testID="sample-record-badge"
      style={styles.badge}
      accessible
      accessibilityLabel="Sample record. This is generated demo data, not a real arrest."
    >
      <Text maxFontSizeMultiplier={1.4} style={styles.text}>Sample record · not a real arrest</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.warnBg,
    borderColor: COLORS.warnDark,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  text: { fontSize: 11, fontWeight: '700', color: COLORS.warnDark },
});

export default SampleRecordBadge;
