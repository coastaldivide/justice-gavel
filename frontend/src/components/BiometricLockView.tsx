/**
 * BiometricLockView — Full-screen biometric lock UI
 *
 * Shown when useBiometricGate returns gated=true.
 * Matches the App.tsx biometric lock aesthetic.
 */
import React from 'react';
import { COLORS } from '../constants/theme';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useTheme } from '../constants/theme';
import { t, useLang } from '../i18n';
import { AppIcon, ICONS } from './AppIcon';

interface Props {
  onUnlock: () => Promise<void>;
  unlocking: boolean;
}

export const BiometricLockView = React.memo(function BiometricLockView({ onUnlock, unlocking }: Props) {
  useLang();
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppIcon name={ICONS.lock} size={48} color={colors.textBrand} style={styles.icon} />
      <Text maxFontSizeMultiplier={1.4}
        style={[styles.title, { color: colors.textPrimary }]}>
        {t('x_biometric_lock_view_locked')}
      </Text>
      <Text maxFontSizeMultiplier={1.4}
        style={[styles.sub, { color: colors.textMuted }]}>
        {t('x_biometric_lock_view_this_screen_contains_sensitive')}
      </Text>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.navy }]}
        onPress={onUnlock}
        disabled={unlocking}
        accessibilityRole="button"
        accessibilityLabel={t('x_biometric_lock_view_unlock_with_biometric')}
        activeOpacity={0.85}
      >
        {unlocking
          ? <ActivityIndicator color={colors.white} size="small" />
          : <Text maxFontSizeMultiplier={1.4} style={styles.btnText}>
              {t('x_biometric_lock_view_unlock')}
            </Text>
        }
      </TouchableOpacity>
    </View>
  );
})

const styles = StyleSheet.create({
  screen:  { flex:1, alignItems:'center', justifyContent:'center', padding:32 },
  icon:    { marginBottom:20 },
  title:   { fontSize:22, lineHeight:33, fontWeight:'700', marginBottom:8 },
  sub:     { fontSize:15, lineHeight:23, textAlign:'center', marginBottom:36 },
  btn:     { borderRadius:14, paddingHorizontal:40, paddingVertical:16,
             minWidth:160, alignItems:'center' },
  btnText: { color:COLORS.white, fontSize:16, lineHeight:24, fontWeight:'700' },
});
