/**
 * OfflineBanner.tsx — the one "No internet connection" banner (App.tsx shows
 * it above every screen while the device is offline). Tapping it opens the
 * "what still works offline" list. Text comes from the app's language.
 */
import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { AppIcon, ICONS } from './AppIcon';

interface Props { visible: boolean; onPress: () => void }

function OfflineBanner({ visible, onPress }: Props): React.JSX.Element | null {
  useLang();
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <TouchableOpacity
      testID="offline-banner"
      style={[styles.banner, { backgroundColor: colors.warnBg, borderBottomColor: colors.warn }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('home_offline_a11y')}
    >
      <AppIcon name={ICONS.offline} size={18} color={colors.warnDark} />
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={1.4} style={[styles.title, { color: colors.warnDark }]}>{t('no_internet')}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.sub, { color: colors.textSecond }]}>{t('home_offline_sub')}</Text>
      </View>
      <Text maxFontSizeMultiplier={1.4} style={[styles.see, { color: colors.warnDark }]}>{t('home_offline_see')}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: '700' },
  sub: { fontSize: 11, lineHeight: 16 },
  see: { fontSize: 12, fontWeight: '700', flexShrink: 0 },
});

OfflineBanner.displayName = 'OfflineBanner';
export default React.memo(OfflineBanner);
