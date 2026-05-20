/**
 * BiometricLockView — Full-screen biometric lock UI
 *
 * Shown when useBiometricGate returns gated=true.
 * Matches the App.tsx biometric lock aesthetic.
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useTheme } from '../constants/theme';

interface Props {
  onUnlock: () => Promise<void>;
  unlocking: boolean;
}

export const BiometricLockView = React.memo(function BiometricLockView({ onUnlock, unlocking }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={styles.icon}>🔒</Text>
      <Text maxFontSizeMultiplier={1.4}
        style={[styles.title, { color: colors.textPrimary }]}>
        Locked
      </Text>
      <Text maxFontSizeMultiplier={1.4}
        style={[styles.sub, { color: colors.textMuted }]}>
        This screen contains sensitive information.{'\n'}
        Authenticate to continue.
      </Text>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.navy }]}
        onPress={onUnlock}
        disabled={unlocking}
        accessibilityRole="button"
        accessibilityLabel="Unlock with biometric"
        activeOpacity={0.85}
      >
        {unlocking
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text maxFontSizeMultiplier={1.4} style={styles.btnText}>
              Unlock
            </Text>
        }
      </TouchableOpacity>
    </View>
  );
})

const styles = StyleSheet.create({
  screen:  { flex:1, alignItems:'center', justifyContent:'center', padding:32 },
  icon:    { fontSize:52, marginBottom:20 },
  title:   { fontSize:22, lineHeight:33, fontWeight:'700', marginBottom:8 },
  sub:     { fontSize:15, lineHeight:23, textAlign:'center', marginBottom:36 },
  btn:     { borderRadius:14, paddingHorizontal:40, paddingVertical:16,
             minWidth:160, alignItems:'center' },
  btnText: { color:'#fff', fontSize:16, lineHeight:24, fontWeight:'700' },
});
