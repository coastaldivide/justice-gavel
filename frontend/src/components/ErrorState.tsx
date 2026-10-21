/**
 * ErrorState.tsx — Full-screen error recovery component
 * Usage: {error && <ErrorState message={error} onRetry={loadData} />}
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { AppIcon, ICONS, type IconName } from './AppIcon';

interface Props {
  message?:  string;
  onRetry?:  () => void;
  icon?:     IconName;
  fullScreen?: boolean;
}

export default function ErrorState({
  message    = t('x_error_state_something_went_wrong_please'),
  onRetry,
  icon       = ICONS.statusWarn,
  fullScreen = false,
}: Props) {
  useLang();
  const { colors } = useTheme();

  return (
    <View
      style={[
        s.container,
        fullScreen && s.fullScreen,
        { backgroundColor: fullScreen ? colors.primary : 'transparent' },
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      <AppIcon name={icon} size={48} color={colors.warn} style={s.icon} />
      <Text
        maxFontSizeMultiplier={1.3}
        style={[s.message, { color: colors.textPrimary }]}
      >
        {message}
      </Text>
      {onRetry && (
        <TouchableOpacity
          style={[s.retryBtn, { borderColor: colors.blue }]}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t('x_error_state_retry_try_again')}
          accessibilityHint={t('x_error_state_attempts_reload_data')}
        >
          <Text style={[s.retryText, { color: colors.blue }]}>{t('help_now_error_retry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:  { alignItems: 'center', justifyContent: 'center', padding: 32 },
  fullScreen: { flex: 1 },
  icon:       { marginBottom: 16 },
  message:    { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 20, maxWidth: 280 },
  retryBtn:   { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12, minHeight: 44 },
  retryText:  { fontSize: 15, fontWeight: '700' },
});
